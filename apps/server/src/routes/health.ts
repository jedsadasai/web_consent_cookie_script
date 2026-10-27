import type { FastifyInstance } from 'fastify';
import type { ConsentRepository } from '../domain.js';

export async function healthRoutes(app: FastifyInstance, opts: { repo: ConsentRepository }): Promise<void> {
  app.get('/healthz', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });

  app.get('/readyz', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      await opts.repo.ping();
      return { status: 'ready' };
    } catch (err) {
      req.log.warn({ err }, 'database not ready');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
