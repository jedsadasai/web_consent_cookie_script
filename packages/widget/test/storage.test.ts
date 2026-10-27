import { afterEach, describe, expect, it } from 'vitest';
import { COOKIE_NAME, clearConsent, decodeConsent, encodeConsent, readConsent, writeConsent } from '../src/storage';
import type { StoredConsent } from '../src/types';

const sample: StoredConsent = {
  v: '2026-10',
  id: '2f1c7a4e-6b1d-4f7a-9a51-0c3c1f7e5b2a',
  cats: { necessary: true, preferences: false, analytics: true, marketing: false },
  ts: 1_790_000_000_000,
};

afterEach(() => clearConsent());

describe('storage', () => {
  it('round-trips consent through the cookie', () => {
    writeConsent(sample, 365);
    expect(document.cookie).toContain(`${COOKIE_NAME}=`);
    expect(readConsent()).toEqual(sample);
  });

  it('encodes as base64url without padding or unsafe characters', () => {
    expect(encodeConsent(sample)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('treats malformed or tampered values as no consent', () => {
    expect(decodeConsent('not-base64!!')).toBeNull();
    expect(decodeConsent(btoa(JSON.stringify({ ...sample, id: 'x' })))).toBeNull();
    expect(decodeConsent(btoa(JSON.stringify({ ...sample, v: '<script>' })))).toBeNull();
    expect(decodeConsent(btoa(JSON.stringify({ ...sample, cats: { analytics: 'yes' } })))).toBeNull();
  });

  it('always forces necessary=true', () => {
    const raw = encodeConsent({ ...sample, cats: { ...sample.cats, necessary: false } });
    expect(decodeConsent(raw)?.cats.necessary).toBe(true);
  });

  it('clears the cookie', () => {
    writeConsent(sample, 365);
    clearConsent();
    expect(readConsent()).toBeNull();
  });
});
