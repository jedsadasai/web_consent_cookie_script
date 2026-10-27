import type sql from 'mssql';
import type { DbEnv } from '../env.js';

export function mssqlConfig(
  env: DbEnv,
  overrides: { user?: string; password?: string; database?: string } = {},
): sql.config {
  return {
    server: env.DB_SERVER,
    port: env.DB_PORT,
    database: overrides.database ?? env.DB_NAME,
    user: overrides.user ?? env.DB_USER,
    password: overrides.password ?? env.DB_PASSWORD,
    connectionTimeout: 15_000,
    requestTimeout: 15_000,
    pool: { max: env.DB_POOL_MAX, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: env.DB_ENCRYPT,
      trustServerCertificate: env.DB_TRUST_SERVER_CERT,
      enableArithAbort: true,
      appName: 'consent-api',
    },
  };
}
