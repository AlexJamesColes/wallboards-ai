import { NextResponse } from 'next/server';
import { isMssqlConfigured, runQuery } from '@/lib/mssql';
import { isZendeskConfigured, fetchZendesk } from '@/lib/zendesk';
import { ensureDbReady, listDatasets } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Read-only health check on the configured data sources. Used by the
 * /connections page so anyone can see at a glance whether each upstream
 * is wired up and responding. Public — the admin layer has been removed,
 * and the response only exposes "ok / not ok / why" without any creds.
 */
export async function GET() {
  await ensureDbReady();
  const datasets = await listDatasets();

  let mssql: { ok: boolean; error: string | null } = { ok: false, error: 'Not configured' };
  if (isMssqlConfigured()) {
    try { await runQuery('SELECT 1 AS ok'); mssql = { ok: true, error: null }; }
    catch (e: any) { mssql = { ok: false, error: e.message }; }
  } else {
    const missing: string[] = [];
    if (!process.env.WB_MSSQL_HOST) missing.push('WB_MSSQL_HOST');
    if (!process.env.MSSQL_GECKO_PASSWORD && !process.env.WB_MSSQL_PASSWORD) missing.push('MSSQL_GECKO_PASSWORD');
    mssql = { ok: false, error: `Missing env: ${missing.join(', ')}` };
  }

  let zendesk: { ok: boolean; error: string | null } = { ok: false, error: 'Not configured' };
  if (isZendeskConfigured()) {
    try { await fetchZendesk('account.json'); zendesk = { ok: true, error: null }; }
    catch (e: any) { zendesk = { ok: false, error: e.message }; }
  }

  return NextResponse.json({
    mssql,
    zendesk,
    noetica: {
      ok:    datasets.length > 0,
      error: datasets.length === 0 ? 'No datasets pushed yet' : null,
      count: datasets.length,
    },
  });
}
