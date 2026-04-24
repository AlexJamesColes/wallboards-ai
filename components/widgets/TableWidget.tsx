'use client';
import type { WbWidget } from '@/lib/db';

interface Props { widget: WbWidget; data: any; }

/**
 * A Geckoboard-style leaderboard table. Rendered as CSS grid (not <table>)
 * so we can give the first column (usually the name/label) flex-grow while
 * numeric columns stay content-width and right-aligned. This avoids the
 * wasteland of whitespace that <table width:100%> produces when the numeric
 * data is much narrower than the first column.
 */
export default function TableWidget({ widget, data }: Props) {
  const columns: string[] = data?.columns || [];
  const rows:    any[]    = data?.rows    || [];
  const cfg = (widget.display_config as any) || {};
  const hideHeader = !!cfg.hide_header;

  if (columns.length === 0) return <div style={{ color: '#475569', fontSize: 12, paddingTop: 8 }}>No data</div>;

  // Decide which columns are numeric — right-align and keep content-width.
  const isNumeric = (col: string) => {
    const sample = rows.slice(0, 8).map(r => r[col]).find(v => v !== null && v !== undefined && v !== '');
    if (sample === undefined) return false;
    const s = String(sample).trim();
    return /^[£$€¥]?\s*-?[\d,]+(?:\.\d+)?%?$/.test(s);
  };
  const numericCols = new Set(columns.filter(isNumeric));

  // First column: flex-grow (1fr). Remaining: content-width (auto), so they
  // cluster tightly on the right and the label column uses the rest of the row.
  const gridCols = columns
    .map((_, i) => (i === 0 ? 'minmax(120px, 1fr)' : 'auto'))
    .join(' ');

  const cellBase: React.CSSProperties = {
    padding: '3px 10px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.25,
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {!hideHeader && (
        <div style={{
          display: 'grid', gridTemplateColumns: gridCols,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          color: '#64748b', fontWeight: 700, fontSize: '0.78em',
          textTransform: 'uppercase', letterSpacing: '0.05em',
          position: 'sticky', top: 0, background: 'inherit', zIndex: 1,
        }}>
          {columns.map(col => (
            <div key={col} style={{
              ...cellBase,
              padding: '4px 10px',
              textAlign: numericCols.has(col) ? 'right' : 'left',
            }}>{col}</div>
          ))}
        </div>
      )}
      <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column' }}>
        {rows.map((row, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: gridCols,
            borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.035)' : undefined,
            flex: '1 1 0', minHeight: 24, maxHeight: 48, alignItems: 'center',
            color: '#cbd5e1',
          }}>
            {columns.map(col => (
              <div key={col} style={{
                ...cellBase,
                textAlign: numericCols.has(col) ? 'right' : 'left',
                fontVariantNumeric: numericCols.has(col) ? 'tabular-nums' : undefined,
                color: numericCols.has(col) ? '#e2e8f0' : '#cbd5e1',
              }}>
                {row[col] !== null && row[col] !== undefined ? String(row[col]) : '—'}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
