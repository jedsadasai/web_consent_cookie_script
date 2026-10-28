import { buildApp } from './app.js';
import { mssqlConfig } from './db/config.js';
import { createMssqlRepository } from './db/repository.js';
import { loadEnv, parseTrustProxy } from './env.js';
import { SiteRegistry } from './lib/sites.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const repo = createMssqlRepository(mssqlConfig(env));

  const app = await buildApp(
    {
      sites: SiteRegistry.parse(env.SITES),
      ipHashSecret: env.IP_HASH_SECRET,
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
      rateLimit: { max: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
      hsts: env.HSTS,
      enableDemo: env.ENABLE_DEMO,
      widgetDir: env.WIDGET_DIR,
      demoDir: env.DEMO_DIR,
      policyUrl: env.POLICY_URL,
      theme: env.THEME,
      logger: {
        level: env.LOG_LEVEL,
        // Never log personal data or credentials.
        redact: {
          paths: ['req.remoteAddress', 'req.remotePort', 'req.headers.cookie', 'req.headers.authorization'],
          remove: true,
        },
      },
    },
    repo,
  );

  // Warm up the pool, but keep serving (readyz reports 503) if the DB is not up yet.
  repo.ping().then(
    () => app.log.info('database connection established'),
    (err: unknown) => app.log.warn({ err }, 'database not reachable yet; will retry on demand'),
  );

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
