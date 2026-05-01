import { NextResponse } from 'next/server';
import { ensureDbReady, listDatasets, getDatasetData } from '@/lib/db';
import { runQuery } from '@/lib/mssql';
import { fetchZendeskMetric, isZendeskConfigured } from '@/lib/zendesk';
import {
  SALES_BOARD_1_WIDGETS,
  SALES_BOARD_1_TARGETS,
  SALES_BOARD_1_DIVISIONS,
  type WidgetSpec,
} from '@/lib/salesBoard1Spec';

export const dynamic = 'force-dynamic';

/**
 * Sales · Board 1 unified data endpoint.
 *
 * Fans out every widget spec in lib/salesBoard1Spec to its source
 * (MS-SQL, Noetica `division` dataset, Zendesk) in parallel and
 * returns one payload keyed by widget id. Designed for sub-second
 * total latency by issuing all calls at once and only blocking on
 * the slowest path (typically Zendesk search at ~400ms each).
 *
 * Response shape:
 *   {
 *     updated_at: string,
 *     widgets: { [id]: { value: number|null, rows?, error? } },
 *     targets: { [id]: number },
 *     reconciliation: { directExternalDelta: number, unclassifiedDivisions: string[] }
 *   }
 *
 * The view at app/_sales-board-1/SalesBoard1View renders by id —
 * widgets that fail (network blip, dataset missing, malformed query)
 * surface their `error` so the tile shows a soft-warning state rather
 * than blanking the whole board.
 */

type WidgetResult =
  | { id: string; value: number | null }                                          // big-number widgets
  | { id: string; rows: any[]; columns: string[] }                                // chart widgets
  | { id: string; placeholder: true; reason: string }                             // deferred sources
  | { id: string; error: string };

// ─── Per-source resolvers ────────────────────────────────────────────────

/** Read all rows of a dataset by name, case-insensitively. Returns
 *  empty array if the dataset hasn't landed yet (Noetica push pending). */
async function readDataset(name: string): Promise<any[]> {
  const datasets = await listDatasets();
  const ds = datasets.find(d => d.name.toLowerCase() === name.toLowerCase());
  if (!ds) return [];
  const data = await getDatasetData(ds.id);
  return (data?.data as any[]) || [];
}

/** Case-insensitive field lookup on a dataset row. Noetica may push
 *  PascalCase or UPPERCASE column names; we accept either. */
function readField(row: any, field: string): any {
  if (row[field] !== undefined) return row[field];
  const want = field.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === want) return row[k];
  }
  return undefined;
}

/** Test a row against a `where` filter. Equality and IN supported. */
function rowMatches(
  row: any,
  where: Record<string, string | number | { in: string[] }> | undefined,
): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    const actual = readField(row, key);
    if (typeof expected === 'object' && expected && 'in' in expected) {
      if (!expected.in.includes(String(actual))) return false;
    } else if (String(actual) !== String(expected)) {
      return false;
    }
  }
  return true;
}

function aggregateRows(rows: any[], field: string, agg: 'sum' | 'avg' | 'count'): number {
  if (agg === 'count') return rows.length;
  const values = rows
    .map(r => Number(readField(r, field)))
    .filter(v => Number.isFinite(v));
  if (values.length === 0) return 0;
  if (agg === 'sum') return values.reduce((s, v) => s + v, 0);
  if (agg === 'avg') return values.reduce((s, v) => s + v, 0) / values.length;
  return 0;
}

/** Read the first column of the first row as a scalar. SQL widgets that
 *  return one value (SUM, AVG, single-column SELECT) all reduce to this. */
function scalarFromQueryResult(result: { columns: string[]; rows: any[] }): number | null {
  const firstRow = result.rows[0];
  if (!firstRow) return null;
  const firstCol = result.columns[0];
  const v = firstRow?.[firstCol];
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Per-widget dispatch ────────────────────────────────────────────────

async function resolveWidget(
  spec: WidgetSpec,
  divisionRows: any[],   // pre-fetched once, shared across dataset widgets
): Promise<WidgetResult> {
  try {
    if (spec.source === 'placeholder') {
      return { id: spec.id, placeholder: true, reason: spec.reason };
    }

    if (spec.source === 'sql') {
      const result = await runQuery(spec.query);
      // Chart widgets keep the full rowset; big-number widgets reduce
      // to a scalar. The discriminator is `visual: 'bar-pair'`.
      if (spec.visual === 'bar-pair') {
        return { id: spec.id, rows: result.rows || [], columns: result.columns || [] };
      }
      return { id: spec.id, value: scalarFromQueryResult(result) };
    }

    if (spec.source === 'dataset') {
      // Currently only the `division` dataset is consumed by this
      // board, and we pre-fetch its rows once at the top of the
      // request. Generalising to arbitrary datasets is a future
      // extension — for now, hit the cache and short-circuit.
      const rows = spec.dataset.toLowerCase() === 'division'
        ? divisionRows
        : await readDataset(spec.dataset);
      const filtered = rows.filter(r => rowMatches(r, spec.where));
      const value = aggregateRows(filtered, spec.field, spec.agg);
      return { id: spec.id, value };
    }

    if (spec.source === 'zendesk') {
      if (!isZendeskConfigured()) {
        return { id: spec.id, error: 'Zendesk not configured' };
      }
      const result = await fetchZendeskMetric({
        metric:     spec.metric,
        time:       spec.time || 'all_time',
        zd_filters: spec.zd_filters,
      });
      return { id: spec.id, value: result.count };
    }

    return { id: (spec as any).id, error: 'Unknown widget source' };
  } catch (err: any) {
    return { id: spec.id, error: err?.message || String(err) };
  }
}

// ─── Reconciliation check ────────────────────────────────────────────────
//
// Direct + External should always sum to Z-ALL's BrokerageEarn. If the
// live dataset adds a new division code that isn't in either list it'll
// silently drop from the channel split; this check surfaces the drift
// in the response (and in console logs) so floor managers — or whoever
// reviews the board next — see it before it bleeds the Earn headline.

function reconcileDivisionSplit(rows: any[]): {
  directExternalDelta: number;
  unclassifiedDivisions: string[];
} {
  const known = new Set(SALES_BOARD_1_DIVISIONS.all.map(d => d.toUpperCase()));
  const seen = new Set<string>();
  let zAllEarn = 0;
  let directExternalEarn = 0;
  const unclassified: string[] = [];

  for (const r of rows) {
    const div = String(readField(r, 'Division') ?? '').toUpperCase();
    const earn = Number(readField(r, 'BrokerageEarn')) || 0;
    if (div === 'Z-ALL') {
      zAllEarn = earn;
      continue;
    }
    if (!div) continue;
    if (known.has(div)) {
      directExternalEarn += earn;
    } else if (!seen.has(div)) {
      seen.add(div);
      unclassified.push(div);
    }
  }

  const delta = +(zAllEarn - directExternalEarn).toFixed(2);
  if (Math.abs(delta) > 1 || unclassified.length > 0) {
    // Surface in server logs — Vercel etc. — so the drift doesn't sit
    // unnoticed. Soft warn; the board still renders.
    // eslint-disable-next-line no-console
    console.warn('[sales-board-1] Division reconciliation drift', {
      zAllEarn, directExternalEarn, delta, unclassified,
    });
  }
  return { directExternalDelta: delta, unclassifiedDivisions: unclassified };
}

// ─── Route handler ───────────────────────────────────────────────────────

export async function GET() {
  await ensureDbReady();

  // Pre-fetch the division dataset once. Every dataset widget on this
  // board reads from it, so doing one round-trip up front saves N-1
  // identical lookups during fan-out.
  const divisionRows = await readDataset('division');

  // Fan out every widget in parallel — Promise.all catches results,
  // resolveWidget swallows per-widget errors so one slow query can't
  // tank the whole board.
  const results = await Promise.all(
    SALES_BOARD_1_WIDGETS.map(spec => resolveWidget(spec, divisionRows)),
  );

  const widgets: Record<string, WidgetResult> = {};
  for (const r of results) widgets[r.id] = r;

  return NextResponse.json({
    updated_at:     new Date().toISOString(),
    widgets,
    targets:        SALES_BOARD_1_TARGETS,
    reconciliation: reconcileDivisionSplit(divisionRows),
  });
}
