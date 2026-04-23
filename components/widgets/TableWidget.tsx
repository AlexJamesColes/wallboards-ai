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

/**
 * Table widget rendered as a flex-column of grid rows (not an HTML <table>).
 *
 * The <table> version used overflow-y: auto and fixed row heights, which
 * meant a widget with 35 agent rows scrolled off a TV viewport instead of
 * shrinking. This div-based version uses flex: 1 1 0 on each row so rows
 * share the available height equally, clamped between a readable minimum
 * and a generous maximum. On a tall widget with few rows, rows grow. On
 * a short widget with many rows, rows squish. Never scrolls unless even
 * the minimum row height can't all fit.
 */
export default function TableWidget({ widget, data }: Props) {
  const columns: string[] = data?.columns || [];
  const rows: any[] = data?.rows || [];
  const cfg     = (widget.display_config as any) || {};
  const formats: ColumnFormat[] = Array.isArray(cfg.column_formats) ? cfg.column_formats : [];
  const formatFor = (col: string) => formats.find(f => f.column === col);

  if (columns.length === 0) return <NoDataPlaceholder />;

  function isNumericColumn(col: string): boolean {
    if (formatFor(col)) return true;
    const sample = rows.find(r => r[col] !== null && r[col] !== undefined);
    if (!sample) return false;
    const v = sample[col];
    return typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '');
  }

  function renderCell(col: string, value: any): string {
    if (value === null || value === undefined) return '—';
    const fmt = formatFor(col);
    if (!fmt) return String(value);
    const n = Number(value);
    if (isNaN(n)) return String(value);
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

  // Column widths — first column (usually Agent name) gets extra weight; the
  // rest share the remaining space equally. minmax(0, ...) is essential so
  // grid columns can shrink below content width (otherwise they blow out).
  const gridCols = columns
    .map((_, i) => (i === 0 ? 'minmax(0, 2.5fr)' : 'minmax(0, 1fr)'))
    .join(' ');

  const cellBase: React.CSSProperties = {
    padding: '2px 8px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    display: 'flex', alignItems: 'center',
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontSize: 'inherit' }}>
      {/* Header row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        borderBottom: '1px solid rgba(99,102,241,0.18)',
        flexShrink: 0,
      }}>
        {columns.map(col => (
          <div key={col} style={{
            ...cellBase,
            padding: '4px 8px',
            color: '#94a3b8', fontWeight: 600, fontSize: '0.85em',
            letterSpacing: '-0.005em',
            justifyContent: isNumericColumn(col) ? 'flex-end' : 'flex-start',
          }}>
            {col}
          </div>
        ))}
      </div>

      {/* Body rows — flex: 1 1 0 so they share height equally and shrink
          when there are many; minHeight keeps them readable */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            flex: '1 1 0',
            minHeight: 18,
            maxHeight: 48,
            borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined,
          }}>
            {columns.map(col => (
              <div key={col} style={{
                ...cellBase,
                color: '#e2e8f0',
                fontWeight: isNumericColumn(col) ? 600 : 500,
                justifyContent: isNumericColumn(col) ? 'flex-end' : 'flex-start',
              }}>
                {renderCell(col, row[col])}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
