import helmet from '@fastify/helmet';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { ConsentRepository } from './domain.js';
import { errorBody } from './lib/errors.js';
import type { SiteRegistry } from './lib/sites.js';
import { consentRoutes } from './routes/consent.js';
import { demoRoutes } from './routes/demo.js';
import { healthRoutes } from './routes/health.js';
import { loadWidget, widgetRoutes } from './routes/widget.js';

export interface AppConfig {
  sites: SiteRegistry;
  ipHashSecret: string;
  trustProxy: boolean | number | string[];
  rateLimit: { max: number; windowMs: number };
  hsts: boolean;
  enableDemo: boolean;
  widgetDir: string;
  demoDir: string;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(cfg: AppConfig, repo: ConsentRepository): Promise<FastifyInstance> {
  const { trustProxy } = cfg;
  const app = Fastify({
    logger: cfg.logger ?? false,
    // A hop count trusts only the N nearest proxies' X-Forwarded-For entries.
    trustProxy: typeof trustProxy === 'number' ? (_addr: string, hop: number) => hop < trustProxy : trustProxy,
    bodyLimit: 16 * 1024,
    requestTimeout: 15_000,
    connectionTimeout: 30_000,
    keepAliveTimeout: 65_000,
    return503OnClosing: true,
  });

  await app.register(helmet, {
    // API responses never render HTML; the demo route sets its own CSP.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: cfg.hsts ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  });

  app.setErrorHandler<FastifyError>((error, req, reply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err: error }, 'request failed');
      return reply.code(500).send(errorBody('INTERNAL', 'Internal server error'));
    }
    const code =
      status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : (error.code ?? 'BAD_REQUEST');
    return reply.code(status).send(errorBody(code, error.message));
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody('NOT_FOUND', 'Not found')));

  const asset = await loadWidget(cfg.widgetDir);
  if (!asset) app.log.warn({ dir: cfg.widgetDir }, 'widget bundle not found — run `npm run build`');

  await app.register(healthRoutes, { repo });
  await app.register(widgetRoutes, { asset });
  await app.register(consentRoutes, {
    prefix: '/api/v1',
    repo,
    sites: cfg.sites,
    ipHashSecret: cfg.ipHashSecret,
    rateLimit: cfg.rateLimit,
  });
  if (cfg.enableDemo) await app.register(demoRoutes, { dir: cfg.demoDir });

  app.addHook('onClose', async () => {
    await repo.close();
  });

  return app;
}
