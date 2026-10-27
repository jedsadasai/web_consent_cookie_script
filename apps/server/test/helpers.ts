import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type AppConfig } from '../src/app.js';
import type { ConsentRecord, ConsentRepository } from '../src/domain.js';
import { SiteRegistry } from '../src/lib/sites.js';

export const ORIGIN = 'https://www.hospital.example';

export class MemoryRepository implements ConsentRepository {
  readonly rows: ConsentRecord[] = [];
  healthy = true;

  async insert(record: ConsentRecord) {
    if (this.rows.some((r) => r.eventId === record.eventId)) return 'duplicate' as const;
    this.rows.push(record);
    return 'created' as const;
  }
  async ping() {
    if (!this.healthy) throw new Error('db down');
  }
  async close() {}
}

export function widgetFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'widget-'));
  writeFileSync(join(dir, 'consent.min.js'), 'console.log("widget")');
  writeFileSync(
    join(dir, 'consent.manifest.json'),
    JSON.stringify({ version: '1.0.0', hash: 'abc123def4567890', integrity: 'sha384-test' }),
  );
  return dir;
}

export async function makeApp(overrides: Partial<AppConfig> = {}) {
  const repo = new MemoryRepository();
  const app = await buildApp(
    {
      sites: SiteRegistry.parse(`hospital=${ORIGIN};other=https://other.example`),
      ipHashSecret: 'x'.repeat(32),
      trustProxy: false,
      rateLimit: { max: 100, windowMs: 60_000 },
      hsts: true,
      enableDemo: false,
      widgetDir: widgetFixture(),
      demoDir: '/nonexistent',
      ...overrides,
    },
    repo,
  );
  return { app, repo };
}

export function payload(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    consentId: randomUUID(),
    siteKey: 'hospital',
    action: 'custom',
    categories: { necessary: true, preferences: false, analytics: true, marketing: false },
    policyVersion: '2026-10',
    language: 'th',
    pageUrl: `${ORIGIN}/th/appointment?hn=12345#top`,
    ...overrides,
  };
}
