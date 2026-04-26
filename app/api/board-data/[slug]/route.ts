import { NextResponse } from 'next/server';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import { runQuery } from '@/lib/mssql';
import { finalisePayload } from '@/lib/dataProcessor';
import { getShowcaseBoard } from '@/lib/showcaseBoards';
import { isSalesManager } from '@/lib/salesManagers';

export const dynamic = 'force-dynamic';

/**
 * Unified data endpoint for showcase boards. Whichever variant the
 * board uses (`widget` or `combined`), the response shape is identical
 * to the legacy /api/widgets/<id>/data — { columns, rows } after the
 * usual finalisePayload pass. ShowcaseView only ever needs to know its
 * slug, never its widget id.
 *
 *   GET /api/board-data/london-agents     → London's leaderboard rows
 *   GET /api/board-data/sales-group       → London + Guildford concat'd
 *
 * Synthetic boards (no wb_boards row) are resolved entirely from
 * lib/showcaseBoards. Widget boards still read their SQL from the
 * existing wb_widgets row attached to their slug.
 */

type ResolvedRows = {
  columns:        string[];
  rows:           any[];
  display_config: Record<string, any>;
  widget_type:    string;
};

/** Award emojis the per-office SQL pre-stamps onto the agent's name.
 *  All meaningless on a combined board until we re-derive them. */
const AWARD_EMOJIS = ['🥇', '🥈', '🥉', '🍪', '🔥', '🎉', '🚐', '🍺', '🍾'];
const RANK_MEDALS: string[] = ['🥇', '🥈', '🥉', '🍪'];

function parseMoney(v: any): number {
  if (v == null) return 0;
  const s = String(v).replace(/[£$,\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function stripAwards(name: string): string {
  let out = String(name ?? '');
  for (const e of AWARD_EMOJIS) out = out.split(e).join('');
  return out.replace(/\s+/g, ' ').trim();
}

/** Re-stamp award emojis on combined-board rows so a sales-group view
 *  shows the correct combined #1/#2/#3/#4 plus today's leaders rather
 *  than two of each from the per-office source data. Mutates rows in
 *  place — the columns stay the same. We only re-derive the awards
 *  whose source data we have (income MTD, income today, pol MTD, pol
 *  today). 🍺 (biggest pol today) and 🍾 (biggest pol MTD) are stripped
 *  but not re-added because the per-pol value isn't in the row data. */
function rederiveCombinedAwards(rows: any[], cols: string[]): void {
  if (rows.length === 0) return;
  const nameCol        = cols[0] || 'name';
  const incomeMtdCol   = cols.find(c => /income.*mtd|mtd.*income/i.test(c))
    || cols.find(c => /income/i.test(c) && !/today/i.test(c)) || '';
  const incomeTodayCol = cols.find(c => /income.*today|today.*income/i.test(c)) || '';
  const polMtdCol      = cols.find(c => /^pol.*mtd|mtd.*pol|^units.*mtd|mtd.*units/i.test(c))
    || cols.find(c => /^pol/i.test(c) && !/today/i.test(c)) || '';
  const polTodayCol    = cols.find(c => /pol.*today|today.*pol/i.test(c)) || '';

  // 1) Strip every per-office award emoji from every row's name.
  for (const r of rows) r[nameCol] = stripAwards(r[nameCol]);

  // 2) Sort by combined income MTD desc and stamp 🥇🥈🥉🍪 on the top 4.
  rows.sort((a, b) => parseMoney(b[incomeMtdCol]) - parseMoney(a[incomeMtdCol]));
  for (let i = 0; i < RANK_MEDALS.length && i < rows.length; i++) {
    rows[i][nameCol] = `${RANK_MEDALS[i]} ${rows[i][nameCol]}`;
  }

  // 3) Today's awards — given to the unique leader for each metric.
  //    Ties skip the award entirely (matches the existing client-side
  //    "tied accolades get stripped" behaviour for individual boards).
  const stampUniqueLeader = (col: string, emoji: string) => {
    if (!col) return;
    let bestVal = 0; let bestRow: any = null; let bestCount = 0;
    for (const r of rows) {
      const v = parseMoney(r[col]);
      if (v > bestVal) { bestVal = v; bestRow = r; bestCount = 1; }
      else if (v === bestVal && v > 0) { bestCount++; }
    }
    if (bestRow && bestCount === 1 && bestVal > 0) {
      bestRow[nameCol] = `${bestRow[nameCol]} ${emoji}`;
    }
  };
  stampUniqueLeader(incomeTodayCol, '🔥');
  stampUniqueLeader(polTodayCol,    '🎉');
  stampUniqueLeader(polMtdCol,      '🚐');
  // 🍺 (biggest pol today) and 🍾 (biggest pol MTD) deliberately not
  // restamped — the per-policy value isn't exposed in the row data so
  // we can't pick a combined leader. Better to omit than guess.
}

async function fetchWidgetRows(slug: string): Promise<ResolvedRows | null> {
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
  const columns = result.columns || [];
  const rows    = result.rows    || [];

  // Strip sales managers from the leaderboard rows. They don't compete
  // with their reports and would muddy the rankings (Cameron Nevins
  // showing at #14 with £51 etc). Source of truth: lib/salesManagers.
  const nameCol = columns[0] || 'name';
  const filtered = rows.filter((r: any) => !isSalesManager(String(r[nameCol] ?? '')));

  return {
    columns,
    rows: filtered,
    display_config: (main.display_config as any) || {},
    widget_type:    main.type,
  };
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  await ensureDbReady();
  const slug = params.slug;
  const config = getShowcaseBoard(slug);
  if (!config) {
    return NextResponse.json({ error: 'Unknown showcase board' }, { status: 404 });
  }

  if (config.data.type === 'widget') {
    const resolved = await fetchWidgetRows(slug);
    if (!resolved) {
      return NextResponse.json({ error: 'No leaderboard widget' }, { status: 404 });
    }
    return NextResponse.json(
      finalisePayload(resolved.rows, resolved.columns, resolved.display_config, resolved.widget_type as any),
    );
  }

  if (config.data.type === 'combined') {
    // Concat each source's rows. The first source that resolves wins
    // for column layout / display_config — they're variants of the
    // same showcase SQL so the schemas line up.
    let combined: ResolvedRows | null = null;
    for (const sourceSlug of config.data.sources) {
      const part = await fetchWidgetRows(sourceSlug);
      if (!part) continue;
      if (!combined) {
        combined = { ...part, rows: [...part.rows] };
      } else {
        combined.rows.push(...part.rows);
      }
    }
    if (!combined) {
      return NextResponse.json({ error: 'No source data' }, { status: 404 });
    }

    // Per-office award emojis are wrong on a combined view (London's
    // 🥇 and Guildford's 🥇 are both in the data, the de-duper strips
    // both, no one shows as #1). Strip them, then re-derive 🥇🥈🥉🍪
    // by combined rank and 🔥/🎉/🚐 from the merged data.
    rederiveCombinedAwards(combined.rows, combined.columns);

    return NextResponse.json(
      finalisePayload(combined.rows, combined.columns, combined.display_config, combined.widget_type as any),
    );
  }

  return NextResponse.json({ error: 'Unsupported source type' }, { status: 500 });
}
