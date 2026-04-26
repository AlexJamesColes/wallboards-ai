import { NextResponse } from 'next/server';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import { runQuery } from '@/lib/mssql';
import { isSalesManager } from '@/lib/salesManagers';

export const dynamic = 'force-dynamic';

/**
 * Aggregated office totals for the bottom-toolbar stock ticker. Polled
 * every 60s from ShowcaseView regardless of which board is on screen,
 * so every TV sees the same OCBL / BISL strip.
 *
 * "Stock symbols":
 *   OCBL — One Call (London)
 *   BISL — Bridge Insurance Services (Guildford)
 *
 * Sales managers are excluded from every figure here — they don't
 * compete and counting them would distort the per-agent average for
 * whichever office has more managers in seats today. The list lives
 * in lib/salesManagers.
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
  incomeMtd:        number;
  /** Sum of Income Today across non-manager agents. */
  incomeToday:      number;
  /** Count of non-manager agents on the board (denominator for "/agent"). */
  agents:           number;
  /** Subset of `agents` who have actually booked today (income > 0).
   *  This is the "weighted by people earning" the floor wanted. */
  activeAgents:     number;
  /** Income MTD ÷ activeAgents — the fair-comparison number. 0 when
   *  nobody's booked yet. */
  incomeMtdPerActive:   number;
  /** Income Today ÷ activeAgents — today's pace per earner. */
  incomeTodayPerActive: number;
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
    incomeMtd: 0, incomeToday: 0,
    agents: 0, activeAgents: 0,
    incomeMtdPerActive: 0, incomeTodayPerActive: 0,
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
    const nameCol        = cols[0] || 'name';
    const incomeMtdCol   = cols.find((c: string) => /income.*mtd|mtd.*income/i.test(c))
      || cols.find((c: string) => /income/i.test(c) && !/today/i.test(c)) || '';
    const incomeTodayCol = cols.find((c: string) => /income.*today|today.*income/i.test(c)) || '';

    const agents = rows.filter((r: any) => !isSalesManager(String(r[nameCol] ?? '')));

    const incomeMtd   = agents.reduce((s: number, r: any) => s + parseMoney(r[incomeMtdCol]),   0);
    const incomeToday = agents.reduce((s: number, r: any) => s + parseMoney(r[incomeTodayCol]), 0);
    const activeAgents = agents.filter((r: any) => parseMoney(r[incomeTodayCol]) > 0).length;

    const incomeMtdPerActive   = activeAgents > 0 ? incomeMtd   / activeAgents : 0;
    const incomeTodayPerActive = activeAgents > 0 ? incomeToday / activeAgents : 0;

    return {
      ticker: office.ticker, name: office.name,
      incomeMtd, incomeToday,
      agents: agents.length, activeAgents,
      incomeMtdPerActive, incomeTodayPerActive,
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
