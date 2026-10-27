import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from '../lib/errors.js';

export interface WidgetAsset {
  body: Buffer;
  version: string;
  hash: string;
  integrity: string;
  etag: string;
}

/** Load the built widget into memory once; returns null if it has not been built. */
export async function loadWidget(dir: string): Promise<WidgetAsset | null> {
  try {
    const [body, manifestRaw] = await Promise.all([
      readFile(join(dir, 'consent.min.js')),
      readFile(join(dir, 'consent.manifest.json'), 'utf8'),
    ]);
    const m = JSON.parse(manifestRaw) as { version?: unknown; hash?: unknown; integrity?: unknown };
    if (typeof m.hash !== 'string' || typeof m.integrity !== 'string' || typeof m.version !== 'string') return null;
    return { body, version: m.version, hash: m.hash, integrity: m.integrity, etag: `"${m.hash}"` };
  } catch {
    return null;
  }
}

const SHORT_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export async function widgetRoutes(app: FastifyInstance, opts: { asset: WidgetAsset | null }): Promise<void> {
  const { asset } = opts;

  const sendScript = (req: FastifyRequest, reply: FastifyReply, cacheControl: string) => {
    if (!asset) return reply.code(404).send(errorBody('NOT_BUILT', 'Widget has not been built'));
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('cache-control', cacheControl)
      .header('etag', asset.etag)
      // Embeddable from any site; `*` without credentials also enables SRI (crossorigin="anonymous").
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('access-control-allow-origin', '*');
    if (req.headers['if-none-match'] === asset.etag) return reply.code(304).send();
    return reply.send(asset.body);
  };

  app.get('/consent.js', (req, reply) => sendScript(req, reply, SHORT_CACHE));

  app.get<{ Params: { hash: string } }>('/v/:hash/consent.js', (req, reply) => {
    if (!asset || req.params.hash !== asset.hash) {
      return reply.code(404).send(errorBody('NOT_FOUND', 'Unknown widget version'));
    }
    return sendScript(req, reply, IMMUTABLE_CACHE);
  });

  app.get('/consent.manifest.json', (_req, reply) => {
    if (!asset) return reply.code(404).send(errorBody('NOT_BUILT', 'Widget has not been built'));
    return reply
      .header('cache-control', 'no-cache')
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('access-control-allow-origin', '*')
      .send({
        version: asset.version,
        hash: asset.hash,
        integrity: asset.integrity,
        url: `/v/${asset.hash}/consent.js`,
      });
  });
}
