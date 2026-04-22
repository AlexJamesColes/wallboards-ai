import { NextResponse } from 'next/server';
import { ensureDbReady, getWidget, getDatasetData, listDatasets } from '@/lib/db';
import { runQuery } from '@/lib/mssql';
import { fetchZendesk, fetchZendeskMetric } from '@/lib/zendesk';

// No auth — called by the public kiosk view

type Filter = { field: string; op: string; value: string };

/** Apply display_config filters to a row array */
function applyFilters(rows: any[], filters: Filter[]): any[] {
  if (!filters?.length) return rows;
  return rows.filter(row =>
    filters.every(f => {
      if (!f.field || !f.op) return true;
      const rowVal = String(row[f.field] ?? '');
      const v      = String(f.value ?? '');
      switch (f.op) {
        case '=':        return rowVal.toLowerCase() === v.toLowerCase();
        case '!=':       return rowVal.toLowerCase() !== v.toLowerCase();
        case 'in':       return v.split(',').map(x => x.trim().toLowerCase()).includes(rowVal.toLowerCase());
        case 'not in':   return !v.split(',').map(x => x.trim().toLowerCase()).includes(rowVal.toLowerCase());
        case '>':        return Number(row[f.field]) >  Number(v);
        case '<':        return Number(row[f.field]) <  Number(v);
        case '>=':       return Number(row[f.field]) >= Number(v);
        case '<=':       return Number(row[f.field]) <= Number(v);
        case 'contains': return rowVal.toLowerCase().includes(v.toLowerCase());
        default:         return true;
      }
    })
  );
}

/** Restrict to selected columns (in order) */
function selectColumns(rows: any[], allCols: string[], showCols?: string[]): { columns: string[]; rows: any[] } {
  if (!showCols?.length) return { columns: allCols, rows };
  const cols = showCols.map(c => c.trim()).filter(c => allCols.includes(c));
  if (!cols.length) return { columns: allCols, rows };
  return {
    columns: cols,
    rows: rows.map(row => {
      const r: Record<string, any> = {};
      cols.forEach(c => { r[c] = row[c]; });
      return r;
    }),
  };
}

/** Apply all display_config post-processing: filters → column selection */
function processRows(rows: any[], allCols: string[], displayConfig: any, type: string) {
  const filters:  Filter[]  = displayConfig?.filters      || [];
  const showCols: string[]  = displayConfig?.show_columns || [];
  const countRows: boolean  = !!displayConfig?.count_rows;

  const filtered = applyFilters(rows, filters);
  const { columns, rows: finalRows } = selectColumns(filtered, allCols, showCols);

  if (type === 'number') {
    if (countRows) {
      return NextResponse.json({ value: finalRows.length, columns, rows: finalRows });
    }
    const valueKey = displayConfig?.value_key || columns[0];
    return NextResponse.json({ value: Number(finalRows[0]?.[valueKey]) || 0, columns, rows: finalRows });
  }
  return NextResponse.json({ columns, rows: finalRows });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await ensureDbReady();
    const widget = await getWidget(params.id);
    if (!widget) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data_source_type, data_source_config, display_config, type } = widget;
    const dcfg = display_config as any;

    // ── SQL ──────────────────────────────────────────────────────────────────
    if (data_source_type === 'sql') {
      const query = (data_source_config as any)?.query;
      if (!query) return NextResponse.json({ columns: [], rows: [], value: null });
      const result = await runQuery(query);
      return processRows(result.rows, result.columns, dcfg, type);
    }

    // ── Dataset (Noetica push) ────────────────────────────────────────────────
    if (data_source_type === 'dataset') {
      const datasetName = (data_source_config as any)?.dataset;
      if (!datasetName) return NextResponse.json({ columns: [], rows: [] });
      const datasets = await listDatasets();
      const ds = datasets.find(d => d.name === datasetName);
      if (!ds) return NextResponse.json({ columns: [], rows: [] });
      const dataRow = await getDatasetData(ds.id);
      const rows: any[] = dataRow?.data || [];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return processRows(rows, columns, dcfg, type);
    }

    // ── Zendesk ───────────────────────────────────────────────────────────────
    if (data_source_type === 'zendesk') {
      const dsc = data_source_config as any;

      // Metric mode (friendly UI)
      if (dsc?.mode === 'metric' || dsc?.metric) {
        const result = await fetchZendeskMetric(dsc);
        // For number widgets without an explicit value_key, surface the total count
        if (type === 'number' && !dcfg?.count_rows && !dcfg?.value_key) {
          return processRows([{ count: result.count }], ['count'], { ...dcfg, value_key: 'count' }, type);
        }
        return processRows(result.rows, result.columns, dcfg, type);
      }

      // Raw mode (legacy / advanced)
      const path = dsc?.path;
      if (!path) return NextResponse.json({ columns: [], rows: [] });
      const data  = await fetchZendesk(path);
      const key   = dsc?.key || Object.keys(data).find((k: string) => Array.isArray(data[k]));
      const rows: any[] = key ? data[key] : [data];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return processRows(rows, columns, dcfg, type);
    }

    return NextResponse.json({ columns: [], rows: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
