'use client';
import type { WbWidget } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';
import NoDataPlaceholder from '@/components/NoDataPlaceholder';

interface Props { widget: WbWidget; data: any; }

interface ColumnFormat {
  column:        string;
  prefix?:       string;
  suffix?:       string;
  decimals?:     'auto' | number | string;
  abbreviation?: 'auto' | 'none' | 'K' | 'M' | 'B';
}

export default function TableWidget({ widget, data }: Props) {
  const columns: string[] = data?.columns || [];
  const rows: any[] = data?.rows || [];
  const cfg     = (widget.display_config as any) || {};
  const formats: ColumnFormat[] = Array.isArray(cfg.column_formats) ? cfg.column_formats : [];
  const formatFor = (col: string) => formats.find(f => f.column === col);

  function renderCell(col: string, value: any): string {
    if (value === null || value === undefined) return '—';
    const fmt = formatFor(col);
    if (!fmt) return String(value);
    const n = Number(value);
    if (isNaN(n)) return String(value); // non-numeric — show as-is
    // Re-use formatNumber with this column's settings mapped into its config shape
    const decimals = fmt.decimals === undefined || fmt.decimals === 'auto' || fmt.decimals === ''
      ? 'auto'
      : Number(fmt.decimals);
    const prefix = fmt.prefix || '';
    const suffix = fmt.suffix || '';
    const formatted = formatNumber(n, {
      num_abbreviation: fmt.abbreviation ?? 'none',
      num_decimals:     decimals as any,
    });
    return `${prefix}${formatted}${suffix}`;
  }

  if (columns.length === 0) return <NoDataPlaceholder />;

  // Per-column: numeric columns (including any explicit column_format) get
  // right-aligned cells and headers, so numbers stack neatly underneath each
  // other instead of hanging left with ragged widths.
  function isNumericColumn(col: string): boolean {
    if (formatFor(col)) return true; // explicit format → treat as numeric
    const sample = rows.find(r => r[col] !== null && r[col] !== undefined);
    if (!sample) return false;
    const v = sample[col];
    return typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '');
  }

  // Rows auto-size to fill available vertical space when there are few rows,
  // and squish to a compact minimum when many rows must fit.
  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit', flex: '1 0 auto' }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col} style={{
                padding: '4px 8px',
                textAlign: isNumericColumn(col) ? 'right' : 'left',
                color: '#94a3b8', fontWeight: 600, fontSize: '0.85em',
                borderBottom: '1px solid rgba(99,102,241,0.18)',
                whiteSpace: 'nowrap',
                letterSpacing: '-0.005em',
              }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              {columns.map(col => (
                <td key={col} style={{
                  padding: '4px 8px',
                  textAlign: isNumericColumn(col) ? 'right' : 'left',
                  color: '#e2e8f0', maxWidth: 200,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: isNumericColumn(col) ? 600 : 500,
                }}>
                  {renderCell(col, row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
