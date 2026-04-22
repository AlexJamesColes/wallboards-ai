'use client';
import type { WbWidget } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';

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

  if (columns.length === 0) return <div style={{ color: '#475569', fontSize: 12, paddingTop: 8 }}>No data</div>;

  // Rows auto-size to fill available vertical space when there are few rows,
  // and squish to a compact minimum when many rows must fit. CSS `height: 1px`
  // on the table gives it a target for its tbody rows to `height: auto` from.
  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit', flex: '1 0 auto' }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col} style={{ padding: '4px 6px', textAlign: 'left', color: '#64748b', fontWeight: 700, fontSize: '0.82em', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.035)' }}>
              {columns.map(col => (
                <td key={col} style={{ padding: '3px 6px', color: '#cbd5e1', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
