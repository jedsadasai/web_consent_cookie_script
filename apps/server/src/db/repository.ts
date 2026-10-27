import sql from 'mssql';
import type { ConsentRecord, ConsentRepository, InsertResult } from '../domain.js';

/** SQL Server error numbers for unique constraint / unique index violations. */
const UNIQUE_VIOLATIONS = new Set([2627, 2601]);

const INSERT_SQL = `
INSERT INTO dbo.ConsentRecord
  (EventId, ConsentId, SiteKey, SubjectId, Action, Necessary, Preferences, Analytics, Marketing,
   PolicyVersion, Language, PageUrl, IpTruncated, IpHash, UserAgent)
VALUES
  (@EventId, @ConsentId, @SiteKey, @SubjectId, @Action, @Necessary, @Preferences, @Analytics, @Marketing,
   @PolicyVersion, @Language, @PageUrl, @IpTruncated, @IpHash, @UserAgent);`;

function errorNumber(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { number?: unknown; originalError?: { info?: { number?: unknown } } };
  const n = e.number ?? e.originalError?.info?.number;
  return typeof n === 'number' ? n : undefined;
}

export function createMssqlRepository(config: sql.config): ConsentRepository {
  let poolPromise: Promise<sql.ConnectionPool> | null = null;

  /** Lazily connect; on failure forget the promise so the next call retries. */
  function getPool(): Promise<sql.ConnectionPool> {
    if (!poolPromise) {
      const pool = new sql.ConnectionPool(config);
      pool.on('error', () => {
        /* surfaced through failed requests */
      });
      poolPromise = pool.connect().catch((err: unknown) => {
        poolPromise = null;
        throw err;
      });
    }
    return poolPromise;
  }

  return {
    async insert(r: ConsentRecord): Promise<InsertResult> {
      const pool = await getPool();
      const req = pool
        .request()
        .input('EventId', sql.UniqueIdentifier, r.eventId)
        .input('ConsentId', sql.UniqueIdentifier, r.consentId)
        .input('SiteKey', sql.NVarChar(64), r.siteKey)
        .input('SubjectId', sql.NVarChar(128), r.subjectId)
        .input('Action', sql.VarChar(16), r.action)
        .input('Necessary', sql.Bit, r.necessary)
        .input('Preferences', sql.Bit, r.preferences)
        .input('Analytics', sql.Bit, r.analytics)
        .input('Marketing', sql.Bit, r.marketing)
        .input('PolicyVersion', sql.NVarChar(32), r.policyVersion)
        .input('Language', sql.VarChar(8), r.language)
        .input('PageUrl', sql.NVarChar(2048), r.pageUrl)
        .input('IpTruncated', sql.VarChar(45), r.ipTruncated)
        .input('IpHash', sql.Char(64), r.ipHash)
        .input('UserAgent', sql.NVarChar(512), r.userAgent);
      try {
        await req.query(INSERT_SQL);
        return 'created';
      } catch (err) {
        const n = errorNumber(err);
        if (n !== undefined && UNIQUE_VIOLATIONS.has(n)) return 'duplicate';
        throw err;
      }
    },

    async ping(): Promise<void> {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok;');
    },

    async close(): Promise<void> {
      const pending = poolPromise;
      poolPromise = null;
      const pool = pending ? await pending.catch(() => null) : null;
      await pool?.close();
    },
  };
}
