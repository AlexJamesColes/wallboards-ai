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
import { SHOWCASE_SLUGS } from './showcaseSlugs';

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

async function tickOne(slug: string): Promise<void> {
  // runQuery is dynamically imported so client bundles never see it
  // (this file is server-only via the require('../wb-db') chain in db.ts)
  const { runQuery } = await import('./mssql');

  const board = await getBoardBySlug(slug);
  if (!board) return;

  const tables = (board.widgets || []).filter(w =>
    w.type === 'table' && !(w.display_config as any)?.hide_header
  );
  tables.sort((a, b) => (b.col_span * b.row_span) - (a.col_span * a.row_span));
  const main = tables[0];
  if (!main) return;
  if (main.data_source_type !== 'sql') return;

  const query = (main.data_source_config as any)?.query;
  if (!query) return;

  const result = await runQuery(query);
  const cols   = result.columns || [];
  const rows   = result.rows    || [];
  if (cols.length === 0 || rows.length === 0) return;

  const nameCol        = cols[0] || 'name';
  const incomeTodayCol = cols.find((c: string) => /income.*today|today.*income/i.test(c)) || '';
  if (!incomeTodayCol) return;

  // Same shape the showcase produces — booked agents (income today > 0),
  // ranked by Income Today desc.
  const booked = rows
    .map((r: any) => ({
      name:   cleanName(String(r[nameCol] ?? '')),
      income: parseMoney(r[incomeTodayCol]),
    }))
    .filter((a: { name: string; income: number }) => a.name && a.income > 0)
    .sort((a: { income: number }, b: { income: number }) => b.income - a.income);

  if (booked.length === 0) return;

  const entries = booked.map((a: { name: string }, i: number) => ({
    agent_key: a.name.toLowerCase(),
    rank:      i + 1,
  }));

  const day = todayLondon();
  await recordBaselines(slug, day, entries);
}

async function tick(): Promise<void> {
  for (const slug of SHOWCASE_SLUGS) {
    try {
      await tickOne(slug);
    } catch (e) {
      // Network blip on the SQL server, schema change, etc — log and
      // move on. Next tick will try again.
      console.error('[baselinePoller]', slug, e);
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
