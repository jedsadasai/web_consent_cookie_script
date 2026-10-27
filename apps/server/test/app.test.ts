import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    expect((await app.inject('/readyz')).statusCode).toBe(200);
    ctx.repo.healthy = false;
    expect((await app.inject('/readyz')).statusCode).toBe(503);
  });
});

describe('security headers', () => {
  it('sets strict defaults', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/healthz');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns JSON 404 without leaking details', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
});

describe('widget delivery', () => {
  it('serves consent.js cross-origin with caching and ETag', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/consent.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('max-age=3600');

    const cached = await app.inject({ url: '/consent.js', headers: { 'if-none-match': res.headers.etag as string } });
    expect(cached.statusCode).toBe(304);
  });

  it('serves the hashed URL as immutable and 404s unknown hashes', async () => {
    ({ app } = await makeApp());
    const ok = await app.inject('/v/abc123def4567890/consent.js');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toContain('immutable');
    expect((await app.inject('/v/0000000000000000/consent.js')).statusCode).toBe(404);

    const manifest = (await app.inject('/consent.manifest.json')).json();
    expect(manifest).toMatchObject({ integrity: 'sha384-test', url: '/v/abc123def4567890/consent.js' });
  });
});
