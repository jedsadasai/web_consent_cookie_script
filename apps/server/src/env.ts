import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const fromRoot = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

export const dbEnvSchema = z.object({
  DB_SERVER: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]{1,128}$/, 'DB_NAME may contain letters, digits and _ only'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_ENCRYPT: bool(true),
  DB_TRUST_SERVER_CERT: bool(false),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

const envSchema = dbEnvSchema.extend({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** `false`, a hop count (e.g. `1`), or a comma-separated list of proxy IPs/CIDRs. Never `true`. */
  TRUST_PROXY: z.string().default('false'),
  /** `siteKey=https://a.example,https://b.example;other=https://c.example` */
  SITES: z.string().min(1),
  IP_HASH_SECRET: z.string().min(32, 'IP_HASH_SECRET must be at least 32 characters'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  HSTS: bool(true),
  ENABLE_DEMO: bool(false),
  WIDGET_DIR: z.string().default(fromRoot('packages/widget/dist')),
  DEMO_DIR: z.string().default(fromRoot('demo')),
});

export type Env = z.infer<typeof envSchema>;
export type DbEnv = z.infer<typeof dbEnvSchema>;

export function formatEnvError(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

/** Validate process.env once at startup and fail fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${formatEnvError(parsed.error)}`);
  }
  return parsed.data;
}

export function parseTrustProxy(value: string): boolean | number | string[] {
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') {
    throw new Error('TRUST_PROXY=true trusts any X-Forwarded-For value; use a hop count or proxy IP/CIDR list');
  }
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
