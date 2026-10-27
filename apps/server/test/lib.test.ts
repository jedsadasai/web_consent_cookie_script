import { describe, expect, it } from 'vitest';
import { splitBatches } from '../src/db/migrate.js';
import { parseTrustProxy } from '../src/env.js';
import { hashIp, normalizeIp, truncateIp } from '../src/lib/ip.js';
import { SiteRegistry } from '../src/lib/sites.js';

describe('ip', () => {
  it('truncates IPv4 to /24 and unwraps mapped addresses', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0');
    expect(truncateIp('::ffff:203.0.113.77')).toBe('203.0.113.0');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });

  it('truncates IPv6 to /48', () => {
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(truncateIp('2001:db8::1')).toBe('2001:db8:0::');
    expect(truncateIp('::1')).toBe('0:0:0::');
    expect(truncateIp('64:ff9b::192.0.2.1')).toBe('64:ff9b:0::');
  });

  it('returns null for garbage', () => {
    expect(truncateIp('not-an-ip')).toBeNull();
  });

  it('hashes deterministically with the secret', () => {
    const a = hashIp('203.0.113.77', 's'.repeat(32));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('::ffff:203.0.113.77', 's'.repeat(32))).toBe(a);
    expect(hashIp('203.0.113.77', 't'.repeat(32))).not.toBe(a);
  });
});

describe('SiteRegistry', () => {
  it('parses sites and normalises origins', () => {
    const r = SiteRegistry.parse('rjh=https://www.rajthanee.com/, https://rajthanee.com ; demo=http://localhost:8080');
    expect(r.allows('rjh', 'https://www.rajthanee.com')).toBe(true);
    expect(r.allows('rjh', 'http://localhost:8080')).toBe(false);
    expect(r.isKnownOrigin('http://localhost:8080')).toBe(true);
  });

  it('rejects invalid specs', () => {
    expect(() => SiteRegistry.parse('')).toThrow();
    expect(() => SiteRegistry.parse('bad key=https://a.example')).toThrow();
    expect(() => SiteRegistry.parse('a=https://a.example/path')).toThrow();
    expect(() => SiteRegistry.parse('a=ftp://a.example')).toThrow();
  });
});

describe('parseTrustProxy', () => {
  it('never allows blanket trust', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.1')).toEqual(['10.0.0.0/8', '172.16.0.1']);
    expect(() => parseTrustProxy('true')).toThrow();
  });
});

describe('splitBatches', () => {
  it('splits on GO lines and drops comment-only batches', () => {
    const batches = splitBatches('-- header\nSELECT 1;\nGO\n\nSELECT 2;\ngo\n-- trailing\n');
    expect(batches).toHaveLength(2);
    expect(batches[1]).toBe('SELECT 2;');
  });
});
