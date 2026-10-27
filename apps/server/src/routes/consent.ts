import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { consentBodySchema, type ConsentRecord, type ConsentRepository } from '../domain.js';
import { errorBody, HttpError } from '../lib/errors.js';
import { hashIp, normalizeIp, truncateIp } from '../lib/ip.js';
import type { SiteRegistry } from '../lib/sites.js';

export interface ConsentRouteOptions {
  repo: ConsentRepository;
  sites: SiteRegistry;
  ipHashSecret: string;
  rateLimit: { max: number; windowMs: number };
}

const MAX_BODY_BYTES = 4 * 1024;
const MAX_USER_AGENT = 512;

/** Keep only origin + path, and only if it belongs to the submitting origin. */
export function sanitizePageUrl(value: string | undefined, origin: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== origin) return null;
    return `${url.origin}${url.pathname}`.slice(0, 2048);
  } catch {
    return null;
  }
}

/**
 * The widget runs on public pages, so there is no secret it could hold.
 * Instead of a token, the API relies on: a server-enforced Origin allowlist
 * per site key, CORS, rate limiting, tiny body limit, strict schema and
 * idempotent event IDs.
 */
export async function consentRoutes(app: FastifyInstance, opts: ConsentRouteOptions): Promise<void> {
  const { repo, sites, ipHashSecret } = opts;

  await app.register(cors, {
    origin: (origin, cb) => cb(null, typeof origin === 'string' && sites.isKnownOrigin(origin)),
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
    maxAge: 600,
    strictPreflight: true,
  });

  await app.register(rateLimit, {
    max: opts.rateLimit.max,
    timeWindow: opts.rateLimit.windowMs,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(429, 'RATE_LIMITED', `Too many requests, retry in ${Math.ceil(ctx.ttl / 1000)}s`),
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.post('/consent', { bodyLimit: MAX_BODY_BYTES }, async (req, reply) => {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !sites.isKnownOrigin(origin)) {
      return reply.code(403).send(errorBody('ORIGIN_NOT_ALLOWED', 'Origin not allowed'));
    }

    const parsed = consentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody('VALIDATION', 'Invalid consent payload'));
    }
    const body = parsed.data;

    if (!sites.allows(body.siteKey, origin)) {
      return reply.code(403).send(errorBody('ORIGIN_NOT_ALLOWED', 'Origin not allowed for this site'));
    }

    // req.ip honours TRUST_PROXY; the client never supplies its own IP.
    const ip = normalizeIp(req.ip);
    const userAgent = req.headers['user-agent'];

    const record: ConsentRecord = {
      eventId: body.eventId,
      consentId: body.consentId,
      siteKey: body.siteKey,
      subjectId: body.subjectId ?? null,
      action: body.action,
      necessary: true,
      preferences: body.categories.preferences,
      analytics: body.categories.analytics,
      marketing: body.categories.marketing,
      policyVersion: body.policyVersion,
      language: body.language,
      pageUrl: sanitizePageUrl(body.pageUrl, origin),
      ipTruncated: truncateIp(ip),
      ipHash: ip ? hashIp(ip, ipHashSecret) : null,
      userAgent: typeof userAgent === 'string' && userAgent ? userAgent.slice(0, MAX_USER_AGENT) : null,
    };

    const result = await repo.insert(record);
    return reply.code(result === 'created' ? 201 : 200).send({ status: result });
  });
}
