import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, ORIGIN, payload } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const post = (a: FastifyInstance, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  a.inject({ method: 'POST', url: '/api/v1/consent', headers: { 'content-type': 'application/json', ...headers }, payload: JSON.stringify(body) });

describe('POST /api/v1/consent', () => {
  it('stores a minimised record and returns 201', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const res = await post(app, payload(), { origin: ORIGIN, 'user-agent': 'Mozilla/5.0 test' });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ status: 'created' });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['cache-control']).toBe('no-store');

    const row = ctx.repo.rows[0]!;
    expect(row.pageUrl).toBe(`${ORIGIN}/th/appointment`); // query + hash stripped
    expect(row.ipTruncated).toBe('127.0.0.0');
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.userAgent).toBe('Mozilla/5.0 test');
    expect(row).toMatchObject({ necessary: true, analytics: true, marketing: false, action: 'custom' });
  });

  it('is idempotent on eventId', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    const body = payload();
    expect((await post(app, body)).statusCode).toBe(201);
    const again = await post(app, body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'duplicate' });
    expect(ctx.repo.rows).toHaveLength(1);
  });

  it('rejects missing or unknown origins', async () => {
    ({ app } = await makeApp());
    expect((await post(app, payload(), {})).statusCode).toBe(403);
    const res = await post(app, payload(), { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects an origin that belongs to a different site key', async () => {
    ({ app } = await makeApp());
    const res = await post(app, payload({ siteKey: 'other' }));
    expect(res.statusCode).toBe(403);
  });

  it('drops a pageUrl from another origin', async () => {
    const ctx = await makeApp();
    app = ctx.app;
    await post(app, payload({ pageUrl: 'https://evil.example/x' }));
    expect(ctx.repo.rows[0]!.pageUrl).toBeNull();
  });

  it.each([
    ['unknown field', { ip: '1.2.3.4' }],
    ['necessary=false', { categories: { necessary: false, preferences: false, analytics: false, marketing: false } }],
    ['bad action', { action: 'maybe' }],
    ['bad uuid', { eventId: 'not-a-uuid' }],
    ['PII-like subject id', { subjectId: 'Somchai Jaidee <a@b.c>' }],
  ])('returns 400 for %s', async (_name, override) => {
    ({ app } = await makeApp());
    const res = await post(app, payload(override));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('returns 413 for oversized bodies', async () => {
    ({ app } = await makeApp());
    const res = await post(app, payload({ pageUrl: `${ORIGIN}/${'a'.repeat(5000)}` }));
    expect(res.statusCode).toBe(413);
  });

  it('rate-limits per client IP', async () => {
    ({ app } = await makeApp({ rateLimit: { max: 2, windowMs: 60_000 } }));
    expect((await post(app, payload())).statusCode).toBe(201);
    expect((await post(app, payload())).statusCode).toBe(201);
    const res = await post(app, payload());
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('answers CORS preflight only for allowed origins', async () => {
    ({ app } = await makeApp());
    const preflight = (origin: string) =>
      app!.inject({
        method: 'OPTIONS',
        url: '/api/v1/consent',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      });
    const ok = await preflight(ORIGIN);
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    const bad = await preflight('https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
