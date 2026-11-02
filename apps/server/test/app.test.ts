import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/env.js';
import { makeApp, widgetFixture } from './helpers.js';

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

  it.each(['/', '/robots.txt', '/sitemap.xml'])('marks the 404 for %s as not storable', async (url) => {
    ({ app } = await makeApp());
    const res = await app.inject(url);
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps the cache lifetime a route sets for itself', async () => {
    ({ app } = await makeApp());
    expect((await app.inject('/consent.js')).headers['cache-control']).toContain('max-age=3600');
    expect((await app.inject('/consent.manifest.json')).headers['cache-control']).toBe('no-cache');
  });

  it.each([
    ['TRACE', '/'],
    ['TRACE', '/api/v1/consent'],
    ['PUT', '/api/v1/consent'],
    ['DELETE', '/consent.js'],
    ['PATCH', '/healthz'],
  ] as const)('refuses %s %s with 405 and no echo', async (method, url) => {
    ({ app } = await makeApp());
    const res = await app.inject({ method, url, headers: { 'x-probe': 'echo-me', 'max-forwards': '0' } });
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD, POST, OPTIONS');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    expect(res.body).not.toContain('echo-me');
  });

  it('leaves HEAD on routes working', async () => {
    ({ app } = await makeApp());
    expect((await app.inject({ method: 'HEAD', url: '/healthz' })).statusCode).toBe(200);
  });
});

describe('POLICY_URL env', () => {
  const base = {
    DB_SERVER: 'db',
    DB_NAME: 'ConsentDB',
    DB_USER: 'u',
    DB_PASSWORD: 'p',
    SITES: `a=https://a.example`,
    IP_HASH_SECRET: 'x'.repeat(32),
  };

  it('keeps the secure defaults when optional variables are unset', () => {
    expect(loadEnv(base)).toMatchObject({
      DB_PORT: 1433,
      DB_ENCRYPT: true,
      DB_TRUST_SERVER_CERT: false,
      DB_POOL_MAX: 10,
      NODE_ENV: 'production',
      PORT: 8080,
      TRUST_PROXY: 'false',
      RATE_LIMIT_MAX: 60,
      RATE_LIMIT_WINDOW_MS: 60_000,
      HSTS: true,
      ENABLE_DEMO: false,
    });
  });

  it('parses booleans strictly and rejects a short IP_HASH_SECRET', () => {
    expect(loadEnv({ ...base, DB_ENCRYPT: 'false', HSTS: '0', ENABLE_DEMO: '1' })).toMatchObject({
      DB_ENCRYPT: false,
      HSTS: false,
      ENABLE_DEMO: true,
    });
    expect(() => loadEnv({ ...base, DB_ENCRYPT: 'no' })).toThrow(/DB_ENCRYPT/);
    expect(() => loadEnv({ ...base, IP_HASH_SECRET: 'short' })).toThrow(/IP_HASH_SECRET/);
    expect(() => loadEnv({ ...base, DB_PORT: '70000' })).toThrow(/DB_PORT/);
  });

  it('accepts http(s), treats empty as unset and rejects other schemes', () => {
    expect(loadEnv({ ...base, POLICY_URL: 'https://a.example/policy' }).POLICY_URL).toBe('https://a.example/policy');
    expect(loadEnv({ ...base, POLICY_URL: '' }).POLICY_URL).toBeUndefined();
    expect(loadEnv(base).POLICY_URL).toBeUndefined();
    expect(() => loadEnv({ ...base, POLICY_URL: 'javascript:alert(1)' })).toThrow(/POLICY_URL/);
  });

  it('accepts THEME auto/light/dark, defaults to auto and rejects anything else', () => {
    expect(loadEnv(base).THEME).toBe('auto');
    expect(loadEnv({ ...base, THEME: '' }).THEME).toBe('auto');
    expect(loadEnv({ ...base, THEME: ' Dark ' }).THEME).toBe('dark');
    expect(loadEnv({ ...base, THEME: 'light' }).THEME).toBe('light');
    expect(() => loadEnv({ ...base, THEME: 'blue' })).toThrow(/THEME/);
  });

  it('accepts DEFAULT_LANGUAGE auto/th/en, defaults to th and rejects anything else', () => {
    expect(loadEnv(base).DEFAULT_LANGUAGE).toBe('th');
    expect(loadEnv({ ...base, DEFAULT_LANGUAGE: '' }).DEFAULT_LANGUAGE).toBe('th');
    expect(loadEnv({ ...base, DEFAULT_LANGUAGE: ' EN ' }).DEFAULT_LANGUAGE).toBe('en');
    expect(loadEnv({ ...base, DEFAULT_LANGUAGE: 'auto' }).DEFAULT_LANGUAGE).toBe('auto');
    expect(() => loadEnv({ ...base, DEFAULT_LANGUAGE: 'fr' })).toThrow(/DEFAULT_LANGUAGE/);
    expect(() => loadEnv({ ...base, DEFAULT_LANGUAGE: 'en_US:en' })).toThrow(/DEFAULT_LANGUAGE/);
  });

  it('ignores the locale variables LANG and LANGUAGE', () => {
    expect(loadEnv({ ...base, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US:en' }).DEFAULT_LANGUAGE).toBe('th');
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

  const slotted = 'var u="__CC_DEFAULT_POLICY_URL__";';

  it('injects POLICY_URL into the bundle and recomputes hash and integrity', async () => {
    ({ app } = await makeApp({
      widgetDir: widgetFixture(slotted),
      policyUrl: 'https://www.rajthanee.com/policy/privacy-policy-cookie',
    }));
    const res = await app.inject('/consent.js');
    expect(res.body).toBe('var u="https://www.rajthanee.com/policy/privacy-policy-cookie";');

    const manifest = (await app.inject('/consent.manifest.json')).json() as { hash: string; integrity: string; url: string };
    expect(manifest.integrity).toBe(`sha384-${createHash('sha384').update(res.rawPayload).digest('base64')}`);
    expect(manifest.hash).not.toBe('abc123def4567890');
    expect(res.headers.etag).toBe(`"${manifest.hash}"`);
    expect((await app.inject(manifest.url)).statusCode).toBe(200);
    expect((await app.inject('/v/abc123def4567890/consent.js')).statusCode).toBe(404);
  });

  it('percent-encodes non-ASCII policy URLs', async () => {
    ({ app } = await makeApp({ widgetDir: widgetFixture(slotted), policyUrl: 'https://www.rajthanee.com/th/นโยบาย' }));
    const res = await app.inject('/consent.js');
    expect(res.body).toMatch(/^var u="https:\/\/www\.rajthanee\.com\/th\/%E0%B8%[0-9A-F%]+";$/);
  });

  it('serves the bundle unchanged without POLICY_URL', async () => {
    ({ app } = await makeApp({ widgetDir: widgetFixture(slotted) }));
    expect((await app.inject('/consent.js')).body).toBe(slotted);
    expect((await app.inject('/consent.manifest.json')).json()).toMatchObject({ integrity: 'sha384-test' });
  });

  const themed = 'var u="__CC_DEFAULT_POLICY_URL__",t="__CC_DEFAULT_THEME__";';

  it('injects THEME alongside POLICY_URL and recomputes integrity', async () => {
    ({ app } = await makeApp({ widgetDir: widgetFixture(themed), policyUrl: 'https://a.example/p', theme: 'dark' }));
    const res = await app.inject('/consent.js');
    expect(res.body).toBe('var u="https://a.example/p",t="dark";');
    const manifest = (await app.inject('/consent.manifest.json')).json() as { integrity: string };
    expect(manifest.integrity).toBe(`sha384-${createHash('sha384').update(res.rawPayload).digest('base64')}`);
  });

  it('leaves the theme slot alone for THEME=auto', async () => {
    ({ app } = await makeApp({ widgetDir: widgetFixture(themed), theme: 'auto' }));
    expect((await app.inject('/consent.js')).body).toBe(themed);
    expect((await app.inject('/consent.manifest.json')).json()).toMatchObject({ integrity: 'sha384-test' });
  });

  const localized = 'var l="__CC_DEFAULT_LANGUAGE__";';

  it('injects DEFAULT_LANGUAGE and recomputes hash and integrity', async () => {
    ({ app } = await makeApp({ widgetDir: widgetFixture(localized), language: 'en' }));
    const res = await app.inject('/consent.js');
    expect(res.body).toBe('var l="en";');
    const manifest = (await app.inject('/consent.manifest.json')).json() as { hash: string; integrity: string };
    expect(manifest.integrity).toBe(`sha384-${createHash('sha384').update(res.rawPayload).digest('base64')}`);
    expect(manifest.hash).not.toBe('abc123def4567890');
  });

  it('leaves the language slot alone for DEFAULT_LANGUAGE=th', async () => {
    ({ app } = await makeApp({ widgetDir: widgetFixture(localized), language: 'th' }));
    expect((await app.inject('/consent.js')).body).toBe(localized);
    expect((await app.inject('/consent.manifest.json')).json()).toMatchObject({ integrity: 'sha384-test' });
  });
});
