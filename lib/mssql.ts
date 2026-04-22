import * as sql from 'mssql';

export interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
}

let pool: sql.ConnectionPool | null = null;

// Resolved config values with sensible defaults for the Gecko database.
// Only HOST needs to be set manually — user/db/port have known defaults,
// password uses IT's pre-existing MSSQL_GECKO_PASSWORD env var (with a
// WB_MSSQL_PASSWORD fallback for any future installs).
function getConfig() {
  return {
    host:     process.env.WB_MSSQL_HOST || '',
    port:     parseInt(process.env.WB_MSSQL_PORT || '1433', 10),
    database: process.env.WB_MSSQL_DATABASE || 'Gecko',
    user:     process.env.WB_MSSQL_USER     || 'AiBoardUser',
    password: process.env.MSSQL_GECKO_PASSWORD || process.env.WB_MSSQL_PASSWORD || '',
  };
}

export function isMssqlConfigured(): boolean {
  const c = getConfig();
  return !!(c.host && c.password);
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  const c = getConfig();
  const config: sql.config = {
    server:   c.host,
    port:     c.port,
    database: c.database,
    user:     c.user,
    password: c.password,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      connectTimeout: 15000,
      requestTimeout: 30000,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  };
  pool = await new sql.ConnectionPool(config).connect();
  return pool;
}

export async function runQuery(query: string): Promise<QueryResult> {
  const c = getConfig();
  if (!c.host)     throw new Error('SQL Server not configured — set WB_MSSQL_HOST');
  if (!c.password) throw new Error('SQL Server not configured — set MSSQL_GECKO_PASSWORD');
  const p = await getPool();
  const result = await p.request().query(query);
  const rows: Record<string, any>[] = result.recordset || [];
  return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows };
}
