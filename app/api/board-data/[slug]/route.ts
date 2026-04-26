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
    return NextResponse.json(
      finalisePayload(combined.rows, combined.columns, combined.display_config, combined.widget_type as any),
    );
  }

  return NextResponse.json({ error: 'Unsupported source type' }, { status: 500 });
}
