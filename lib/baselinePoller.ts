/**
 * Server-side rank-baseline poller.
 *
 * Runs in-process on the dyno so today's first-observed ranks get
 * recorded even if no TV is connected. Without this, the FIRST device
 * to load each day would seed baselines for everyone — anyone who
 * booked at 8am but wasn't observed until 10am would have a wrong
 * anchor.
 *
 * Behaviour:
 *   • Runs once 30s after the dyno boots (let warm-up finish), then
 *     every 2 minutes via setInterval.
 *   • For each showcase slug: load the board, find its main leaderboard
 *     widget, run the SQL query, sort booked agents by Income Today,
 *     INSERT new baselines via wb-db.recordBaselines (ON CONFLICT DO
 *     NOTHING — never overwrites, so client POSTs and worker writes
 *     coexist safely).
 *   • Day uses Europe/London local time so the rollover matches the
 *     sales floor's wall clock.
 *
 * Singleton — ensureBaselinePollerStarted() is safe to call repeatedly
 * (lib/db's ensureDbReady wires it in once).
 */

import { getBoardBySlug, recordBaselines } from './db';
import { SHOWCASE_BOARDS, type ShowcaseBoard } from './showcaseBoards';

let started = false;

const FIRST_TICK_DELAY_MS = 30_000;       // let the dyno warm up first
const TICK_INTERVAL_MS    = 2 * 60_000;   // every 2 minutes thereafter

function todayLondon(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function parseMoney(v: any): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/[£$,\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function cleanName(raw: string): string {
  return String(raw ?? '')
    .replace(/\p{Extended_Pictographic}(?:️)?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Run the leaderboard SQL for a single widget-backed slug. Returns
 *  the raw rows + name column so combined boards can stitch results
 *  together. Returns null if the board / widget can't be resolved. */
async function fetchSlugRows(slug: string): Promise<{
  rows: any[]; nameCol: string; incomeTodayCol: string;
} | null> {
  const { runQuery } = await import('./mssql');

  const board = await getBoardBySlug(slug);
  if (!board) return null;

  const tables = (board.widgets || []).filter(w =>
    w.type === 'table' && !(w.display_config as any)?.hide_header
  );
  tables.sort((a, b) => (b.col_span * b.row_span) - (a.col_span * a.row_span));
  const main = tables[0];
  if (!main || main.data_source_type !== 'sql') return null;

  const query = (main.data_source_config as any)?.query;
  if (!query) return null;

  const result = await runQuery(query);
  const cols   = result.columns || [];
  const rows   = result.rows    || [];
  if (cols.length === 0 || rows.length === 0) return null;

  const nameCol        = cols[0] || 'name';
  const incomeTodayCol = cols.find((c: string) => /income.*today|today.*income/i.test(c)) || '';
  if (!incomeTodayCol) return null;

  return { rows, nameCol, incomeTodayCol };
}

async function tickOne(board: ShowcaseBoard): Promise<void> {
  let combined: { rows: any[]; nameCol: string; incomeTodayCol: string } | null = null;

  if (board.data.type === 'widget') {
    combined = await fetchSlugRows(board.slug);
  } else if (board.data.type === 'combined') {
    // Concatenate every source's rows. We trust each source uses the
    // same column layout (they all come from variants of the same
    // showcase SQL); fall back to the first source's columns.
    const allRows: any[] = [];
    let nameCol = 'name';
    let incomeTodayCol = '';
    for (const sourceSlug of board.data.sources) {
      const part = await fetchSlugRows(sourceSlug);
      if (!part) continue;
      allRows.push(...part.rows);
      if (!incomeTodayCol) {
        nameCol        = part.nameCol;
        incomeTodayCol = part.incomeTodayCol;
      }
    }
    if (allRows.length > 0 && incomeTodayCol) {
      combined = { rows: allRows, nameCol, incomeTodayCol };
    }
  }

  if (!combined) return;

  // Booked agents (income today > 0), ranked by Income Today desc —
  // same ordering the showcase will apply, so the baseline matches
  // what the floor sees.
  const booked = combined.rows
    .map((r: any) => ({
      name:   cleanName(String(r[combined!.nameCol] ?? '')),
      income: parseMoney(r[combined!.incomeTodayCol]),
    }))
    .filter((a: { name: string; income: number }) => a.name && a.income > 0)
    .sort((a: { income: number }, b: { income: number }) => b.income - a.income);

  if (booked.length === 0) return;

  const entries = booked.map((a: { name: string }, i: number) => ({
    agent_key: a.name.toLowerCase(),
    rank:      i + 1,
  }));

  await recordBaselines(board.slug, todayLondon(), entries);
}

async function tick(): Promise<void> {
  for (const board of SHOWCASE_BOARDS) {
    try {
      await tickOne(board);
    } catch (e) {
      // Network blip on the SQL server, schema change, etc — log and
      // move on. Next tick will try again.
      console.error('[baselinePoller]', board.slug, e);
    }
  }
}

export function ensureBaselinePollerStarted(): void {
  if (started) return;
  if (typeof window !== 'undefined') return; // server-only safeguard
  started = true;
  setTimeout(() => { void tick(); }, FIRST_TICK_DELAY_MS);
  setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  console.log('[baselinePoller] scheduled — first tick in 30s, then every 2 min');
}
