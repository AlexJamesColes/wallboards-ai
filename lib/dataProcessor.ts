/**
 * Generic post-fetch data processing applied to widget data before it's
 * sent to the kiosk view. Lives outside the route handler so other code
 * paths (or future tests) can use it.
 *
 * Three pieces, each does one thing:
 *   - applyFilters: drop rows that don't match display_config.filters
 *   - selectColumns: project to display_config.show_columns (in order)
 *   - finalisePayload: shape the response for number widgets
 *     (count-rows, value-key auto-detect, subtitle from sibling column).
 */

export type Filter = { field: string; op: string; value: string };

export interface DisplayConfig {
  filters?:      Filter[];
  show_columns?: string[];
  count_rows?:   boolean;
  value_key?:    string;
  subtitle?:     string;
  [k: string]:   any;
}

export interface ProcessedPayload {
  columns:   string[];
  rows:      any[];
  value?:    number;
  subtitle?: string;
}

export function applyFilters(rows: any[], filters?: Filter[]): any[] {
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

export function selectColumns(
  rows: any[],
  allCols: string[],
  showCols?: string[],
): { columns: string[]; rows: any[] } {
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

/**
 * Produce the response payload for a widget after filtering + column selection.
 * For number widgets, this auto-picks the first numeric column as the value
 * (so `SELECT name, amount` works regardless of column order) and surfaces
 * the first sibling string column as a subtitle (so the agent's name shows
 * under their number).
 */
export function finalisePayload(
  rows: any[],
  allCols: string[],
  displayConfig: DisplayConfig | null | undefined,
  type: string,
): ProcessedPayload {
  const cfg       = displayConfig || {};
  const filtered  = applyFilters(rows, cfg.filters);
  const projected = selectColumns(filtered, allCols, cfg.show_columns);
  const { columns, rows: finalRows } = projected;

  if (type !== 'number') return { columns, rows: finalRows };

  if (cfg.count_rows) return { columns, rows: finalRows, value: finalRows.length };

  const row0 = finalRows[0] || {};
  const numericCol = columns.find(c => {
    const v = row0[c];
    return v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
  });
  const valueKey    = cfg.value_key || numericCol || columns[0];
  const subtitleCol = columns.find(c => c !== valueKey && typeof row0[c] === 'string');
  const subtitle    = cfg.subtitle || (subtitleCol ? row0[subtitleCol] : undefined);

  return {
    columns, rows: finalRows,
    value:    Number(row0[valueKey]) || 0,
    subtitle: subtitle || undefined,
  };
}
