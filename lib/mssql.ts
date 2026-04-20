import * as sql from 'mssql';

export interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
}

let pool: sql.ConnectionPool | null = null;

export function isMssqlConfigured(): boolean {
  return !!process.env.WB_MSSQL_HOST;
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  const config: sql.config = {
    server: process.env.WB_MSSQL_HOST!,
    port: parseInt(process.env.WB_MSSQL_PORT || '1433'),
    database: process.env.WB_MSSQL_DATABASE!,
    user: process.env.WB_MSSQL_USER!,
    password: process.env.WB_MSSQL_PASSWORD!,
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
  if (!isMssqlConfigured()) throw new Error('SQL Server not configured — set WB_MSSQL_HOST');
  const p = await getPool();
  const result = await p.request().query(query);
  const rows: Record<string, any>[] = result.recordset || [];
  return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows };
}
