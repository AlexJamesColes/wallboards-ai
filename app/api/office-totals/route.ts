import { NextResponse } from 'next/server';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import { runQuery } from '@/lib/mssql';
import { isSalesManager } from '@/lib/salesManagers';

export const dynamic = 'force-dynamic';

/**
 * Aggregated office totals for the bottom-toolbar trading tape. Polled
 * every 60s from ShowcaseView regardless of which board is on screen,
 * so every TV sees the same OCBL / BISL strip.
 *
 * Four headline figures per office:
 *   • incomePerAgent  — avg income MTD per agent who's contributed
 *   • unitsPerAgent   — avg units MTD per agent who's contributed
 *   • incomeTotalMtd  — sum of income MTD
 *   • unitsTotalMtd   — sum of units MTD
 *
 * "Active agent" denominator = anyone with non-zero income MTD. That's
 * the "people actually earning money" weight the floor wanted, so the
 * per-agent figures don't get diluted by people who haven't booked at
 * all this month.
 *
 * Sales managers are excluded everywhere — they don't compete and would
 * distort the per-agent average for whichever office had more managers
 * in seats today. List in lib/salesManagers.
 *
 * Stock symbols:
 *   OCBL — One Call (London)
 *   BISL — Bridge Insurance Services (Guildford)
 */

interface OfficeConfig { ticker: string; name: string; slug: string; }
const OFFICES: OfficeConfig[] = [
  { ticker: 'OCBL', name: 'London',    slug: 'london-agents'    },
  { ticker: 'BISL', name: 'Guildford', slug: 'guildford-agents' },
];

interface OfficeTotals {
  ticker:           string;
  name:             string;
  /** Sum of Income MTD across non-manager agents. */
  incomeTotalMtd:   number;
  /** Sum of Policies MTD across non-manager agents. */
  unitsTotalMtd:    number;
  /** Total non-manager agents on the board (informational). */
  agents:           number;
  /** Subset of `agents` who have non-zero income MTD — the per-agent
   *  denominator. */
  activeAgents:     number;
  /** Income MTD ÷ activeAgents. 0 when nobody's earned anything yet. */
  incomePerAgent:   number;
  /** Units MTD ÷ activeAgents. */
  unitsPerAgent:    number;
  /** False when the upstream SQL was unavailable; the client greys the
   *  row out rather than showing zeros that would read as "nobody's
   *  earned anything". */
  ok:               boolean;
}

function parseMoney(v: any): number {
  if (v == null) return 0;
  const s = String(v).replace(/[£$,\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function fetchOffice(office: OfficeConfig): Promise<OfficeTotals> {
  const empty: OfficeTotals = {
    ticker: office.ticker, name: office.name,
    incomeTotalMtd: 0, unitsTotalMtd: 0,
    agents: 0, activeAgents: 0,
    incomePerAgent: 0, unitsPerAgent: 0,
    ok: false,
  };
  try {
    const board = await getBoardBySlug(office.slug);
    if (!board) return empty;
    const tables = (board.widgets || []).filter(w =>
      w.type === 'table' && !(w.display_config as any)?.hide_header
    );
    tables.sort((a, b) => (b.col_span * b.row_span) - (a.col_span * a.row_span));
    const main = tables[0];
    if (!main || main.data_source_type !== 'sql') return empty;
    const query = (main.data_source_config as any)?.query;
    if (!query) return empty;

    const result = await runQuery(query);
    const cols   = result.columns || [];
    const rows   = result.rows    || [];
    const nameCol      = cols[0] || 'name';
    const incomeMtdCol = cols.find((c: string) => /income.*mtd|mtd.*income/i.test(c))
      || cols.find((c: string) => /income/i.test(c) && !/today/i.test(c)) || '';
    const unitsMtdCol  = cols.find((c: string) => /^pol.*mtd|mtd.*pol|^units.*mtd|mtd.*units/i.test(c))
      || cols.find((c: string) => /^pol/i.test(c) && !/today/i.test(c)) || '';

    const agents = rows.filter((r: any) => !isSalesManager(String(r[nameCol] ?? '')));

    const incomeTotalMtd = agents.reduce((s: number, r: any) => s + parseMoney(r[incomeMtdCol]), 0);
    const unitsTotalMtd  = agents.reduce((s: number, r: any) => s + parseMoney(r[unitsMtdCol]),  0);
    const activeAgents   = agents.filter((r: any) => parseMoney(r[incomeMtdCol]) > 0).length;

    // Per-agent denominator = total non-manager agents on the board.
    // We avoid the activeAgents (income MTD > 0) denominator so a new
    // starter with £0 doesn't artificially inflate the per-agent figure
    // mid-month — the comparison should reflect real team capacity.
    const denom = agents.length;
    const incomePerAgent = denom > 0 ? incomeTotalMtd / denom : 0;
    const unitsPerAgent  = denom > 0 ? unitsTotalMtd  / denom : 0;

    return {
      ticker: office.ticker, name: office.name,
      incomeTotalMtd, unitsTotalMtd,
      agents: agents.length, activeAgents,
      incomePerAgent, unitsPerAgent,
      ok: true,
    };
  } catch (e) {
    console.error('[office-totals]', office.ticker, e);
    return empty;
  }
}

export async function GET() {
  await ensureDbReady();
  const offices = await Promise.all(OFFICES.map(fetchOffice));
  return NextResponse.json({ offices });
}
