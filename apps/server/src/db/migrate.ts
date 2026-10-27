/**
 * One-shot schema migration runner (run as a privileged login, not the API login):
 *   node dist/db/migrate.js
 * Applies migrations/NNN_*.sql in order, each in a transaction, tracked in dbo.SchemaMigrations.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { z } from 'zod';
import { dbEnvSchema, formatEnvError } from '../env.js';
import { mssqlConfig } from './config.js';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const migrateEnvSchema = dbEnvSchema.extend({
  MIGRATE_DB_USER: z.string().min(1).optional(),
  MIGRATE_DB_PASSWORD: z.string().min(1).optional(),
  /** Dev convenience: CREATE DATABASE if missing (needs dbcreator). */
  MIGRATE_CREATE_DB: bool,
  /** e.g. 130 to emulate SQL Server 2016 on a newer dev server. */
  MIGRATE_COMPAT_LEVEL: z.coerce.number().int().refine((n) => [130, 140, 150, 160].includes(n)).optional(),
  /** Dev convenience: create DB_USER as a least-privilege login with INSERT/SELECT only. */
  MIGRATE_APP_LOGIN: bool,
  MIGRATIONS_DIR: z.string().default(fileURLToPath(new URL('../../migrations', import.meta.url))),
});

type MigrateEnv = z.infer<typeof migrateEnvSchema>;

const LOGIN_RE = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;

export function splitBatches(script: string): string[] {
  return script
    .split(/^\s*GO\s*;?\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.replace(/--.*$/gm, '').trim() !== '');
}

async function ensureDatabase(env: MigrateEnv, admin: sql.config): Promise<void> {
  const pool = await new sql.ConnectionPool({ ...admin, database: 'master' }).connect();
  try {
    await pool
      .request()
      .input('name', sql.NVarChar(128), env.DB_NAME)
      .query(`
IF DB_ID(@name) IS NULL
BEGIN
  DECLARE @sql NVARCHAR(MAX) = N'CREATE DATABASE ' + QUOTENAME(@name);
  EXEC sys.sp_executesql @sql;
END`);
    if (env.MIGRATE_COMPAT_LEVEL) {
      await pool
        .request()
        .input('name', sql.NVarChar(128), env.DB_NAME)
        .input('level', sql.Int, env.MIGRATE_COMPAT_LEVEL)
        .query(`
DECLARE @sql NVARCHAR(MAX) =
  N'ALTER DATABASE ' + QUOTENAME(@name) + N' SET COMPATIBILITY_LEVEL = ' + CAST(@level AS NVARCHAR(4));
EXEC sys.sp_executesql @sql;`);
    }
  } finally {
    await pool.close();
  }
}

async function ensureAppLogin(pool: sql.ConnectionPool, env: MigrateEnv): Promise<void> {
  const login = env.DB_USER;
  if (!LOGIN_RE.test(login) || login.toLowerCase() === 'sa') {
    throw new Error('MIGRATE_APP_LOGIN: DB_USER must be a dedicated login name (not sa)');
  }
  await pool
    .request()
    .input('login', sql.NVarChar(128), login)
    .input('pwd', sql.NVarChar(128), env.DB_PASSWORD)
    .query(`
DECLARE @sql NVARCHAR(MAX);
IF SUSER_ID(@login) IS NULL
BEGIN
  SET @sql = N'CREATE LOGIN ' + QUOTENAME(@login) + N' WITH PASSWORD = ' + QUOTENAME(@pwd, N'''') + N', CHECK_POLICY = ON';
  EXEC sys.sp_executesql @sql;
END
IF DATABASE_PRINCIPAL_ID(@login) IS NULL
BEGIN
  SET @sql = N'CREATE USER ' + QUOTENAME(@login) + N' FOR LOGIN ' + QUOTENAME(@login);
  EXEC sys.sp_executesql @sql;
END
SET @sql = N'GRANT INSERT, SELECT ON dbo.ConsentRecord TO ' + QUOTENAME(@login);
EXEC sys.sp_executesql @sql;`);
  console.log(`[migrate] least-privilege login "${login}" ready (INSERT, SELECT on dbo.ConsentRecord)`);
}

export async function migrate(env: MigrateEnv): Promise<void> {
  const admin = mssqlConfig(env, {
    user: env.MIGRATE_DB_USER ?? env.DB_USER,
    password: env.MIGRATE_DB_PASSWORD ?? env.DB_PASSWORD,
  });

  if (env.MIGRATE_CREATE_DB) await ensureDatabase(env, admin);

  const pool = await new sql.ConnectionPool(admin).connect();
  try {
    await pool.request().query(`
IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NULL
  CREATE TABLE dbo.SchemaMigrations (
    Name      NVARCHAR(255) NOT NULL CONSTRAINT PK_SchemaMigrations PRIMARY KEY,
    AppliedAt DATETIME2(3)  NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAt DEFAULT SYSUTCDATETIME()
  );`);

    const applied = new Set(
      (await pool.request().query<{ Name: string }>('SELECT Name FROM dbo.SchemaMigrations;')).recordset.map((r) => r.Name),
    );
    const files = (await readdir(env.MIGRATIONS_DIR)).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip    ${file}`);
        continue;
      }
      const batches = splitBatches(await readFile(join(env.MIGRATIONS_DIR, file), 'utf8'));
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        for (const batch of batches) await new sql.Request(tx).batch(batch);
        await new sql.Request(tx)
          .input('name', sql.NVarChar(255), file)
          .query('INSERT INTO dbo.SchemaMigrations (Name) VALUES (@name);');
        await tx.commit();
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await tx.rollback().catch(() => undefined);
        throw err;
      }
    }

    if (env.MIGRATE_APP_LOGIN) await ensureAppLogin(pool, env);
  } finally {
    await pool.close();
  }
}

const invokedDirectly = /[\\/]migrate\.(js|ts)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  const parsed = migrateEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(`[migrate] invalid environment:\n${formatEnvError(parsed.error)}`);
    process.exit(1);
  }
  migrate(parsed.data).then(
    () => {
      console.log('[migrate] done');
      process.exit(0);
    },
    (err: unknown) => {
      console.error('[migrate] failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
