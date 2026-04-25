import { NextResponse } from 'next/server';
import { isMssqlConfigured, runQuery } from '@/lib/mssql';
import { isZendeskConfigured, fetchZendesk } from '@/lib/zendesk';
import { ensureDbReady, listDatasets } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Read-only health check on the configured data sources. Used by the
 * /connections page so anyone can see at a glance whether each upstream
 * is wired up and responding. Public — the admin layer has been removed,
 * and the response only exposes "ok / not ok / why" plus identifying
 * names (database name, Zendesk subdomain, dataset names) — no
 * credentials and no internal hostnames.
 */
export async function GET() {
  await ensureDbReady();

  // ── MS-SQL ────────────────────────────────────────────────────────────
  let mssql: {
    ok: boolean; error: string | null;
    database?: string; user?: string;
  } = { ok: false, error: 'Not configured' };

  if (isMssqlConfigured()) {
    const database = process.env.WB_MSSQL_DATABASE || 'Gecko';
    const user     = process.env.WB_MSSQL_USER     || 'AiBoardUser';
    try {
      await runQuery('SELECT 1 AS ok');
      mssql = { ok: true, error: null, database, user };
    } catch (e: any) {
      mssql = { ok: false, error: e.message, database, user };
    }
  } else {
    const missing: string[] = [];
    if (!process.env.WB_MSSQL_HOST) missing.push('WB_MSSQL_HOST');
    if (!process.env.MSSQL_GECKO_PASSWORD && !process.env.WB_MSSQL_PASSWORD) missing.push('MSSQL_GECKO_PASSWORD');
    mssql = { ok: false, error: `Missing env: ${missing.join(', ')}` };
  }

  // ── Zendesk ───────────────────────────────────────────────────────────
  let zendesk: {
    ok: boolean; error: string | null;
    subdomain?: string; accountName?: string;
  } = { ok: false, error: 'Not configured' };

  if (isZendeskConfigured()) {
    const subdomain = process.env.WB_ZENDESK_SUBDOMAIN;
    try {
      const account: any = await fetchZendesk('account.json');
      // Zendesk's /account.json returns { account: { name, subdomain, ... } }
      const accountName = account?.account?.name || undefined;
      zendesk = { ok: true, error: null, subdomain, accountName };
    } catch (e: any) {
      zendesk = { ok: false, error: e.message, subdomain };
    }
  }

  // ── Datasets ──────────────────────────────────────────────────────────
  const datasets = await listDatasets();
  const noetica: {
    ok: boolean; error: string | null;
    count: number; names: string[];
  } = {
    ok:    datasets.length > 0,
    error: datasets.length === 0 ? 'No datasets pushed yet' : null,
    count: datasets.length,
    names: datasets.map(d => d.name).sort((a, b) => a.localeCompare(b)),
  };

  return NextResponse.json({ mssql, zendesk, noetica });
}
