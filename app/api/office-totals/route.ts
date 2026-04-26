import { NextResponse } from 'next/server';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import { runQuery } from '@/lib/mssql';

export const dynamic = 'force-dynamic';

/**
 * Aggregated office totals for the bottom-toolbar stock ticker. Polled
 * every 60s from ShowcaseView regardless of which board is on screen,
 * so every TV sees the same OCBL / BISL strip.
 *
 * "Stock symbols":
 *   OCBL — One Call (London)
 *   BISL — Bridge Insurance Services (Guildford)
 */

interface OfficeConfig { ticker: string; name: string; slug: string; }
const OFFICES: OfficeConfig[] = [
  { ticker: 'OCBL', name: 'London',    slug: 'london-agents'    },
  { ticker: 'BISL', name: 'Guildford', slug: 'guildford-agents' },
];

interface OfficeTotals {
  ticker:      string;
  name:        string;
  incomeMtd:   number;
  incomeToday: number;
  agents:      number;
  /** Server-side false when the upstream SQL was unavailable; the
   *  client uses this to grey the row out instead of showing zeros
   *  that would look like a real "team's done nothing today" state. */
  ok:          boolean;
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
    incomeMtd: 0, incomeToday: 0, agents: 0, ok: false,
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
    const incomeMtdCol   = cols.find((c: string) => /income.*mtd|mtd.*income/i.test(c))
      || cols.find((c: string) => /income/i.test(c) && !/today/i.test(c)) || '';
    const incomeTodayCol = cols.find((c: string) => /income.*today|today.*income/i.test(c)) || '';

    const incomeMtd   = rows.reduce((s: number, r: any) => s + parseMoney(r[incomeMtdCol]),   0);
    const incomeToday = rows.reduce((s: number, r: any) => s + parseMoney(r[incomeTodayCol]), 0);

    return {
      ticker: office.ticker, name: office.name,
      incomeMtd, incomeToday, agents: rows.length, ok: true,
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
