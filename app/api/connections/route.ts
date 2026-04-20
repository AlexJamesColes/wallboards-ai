import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/guard';
import { isMssqlConfigured, runQuery } from '@/lib/mssql';
import { isZendeskConfigured, fetchZendesk } from '@/lib/zendesk';
import { ensureDbReady, listDatasets } from '@/lib/db';

export const GET = withAdmin(async () => {
  await ensureDbReady();
  const datasets = await listDatasets();

  let mssql: any = { ok: false, error: 'Not configured' };
  if (isMssqlConfigured()) {
    try { await runQuery('SELECT 1 AS ok'); mssql = { ok: true, error: null }; }
    catch (e: any) { mssql = { ok: false, error: e.message }; }
  }

  let zendesk: any = { ok: false, error: 'Not configured' };
  if (isZendeskConfigured()) {
    try { await fetchZendesk('account.json'); zendesk = { ok: true, error: null }; }
    catch (e: any) { zendesk = { ok: false, error: e.message }; }
  }

  return NextResponse.json({
    mssql,
    zendesk,
    noetica: { ok: datasets.length > 0, error: datasets.length === 0 ? 'No datasets pushed yet' : null, count: datasets.length },
  });
});
