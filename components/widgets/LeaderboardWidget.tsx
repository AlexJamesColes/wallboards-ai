'use client';
import type { WbWidget } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';
import NoDataPlaceholder from '@/components/NoDataPlaceholder';

interface Props { widget: WbWidget; data: any; }

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardWidget({ widget, data }: Props) {
  const rows: any[]       = data?.rows    || [];
  const columns: string[] = data?.columns || [];
  const cfg = (widget.display_config as any) || {};

  if (rows.length === 0) return <NoDataPlaceholder />;

  const nameCol  = columns[0] || '';
  const valueCol = columns.find(c => c !== nameCol && !isNaN(Number(rows[0]?.[c]))) || columns[1] || '';
  const hideMedals: boolean = !!cfg.hide_medals;

  const sorted = [...rows].sort((a, b) => Number(b[valueCol] || 0) - Number(a[valueCol] || 0));

  // ── Highlight mode ─────────────────────────────────────────────────────────
  // When there's only 1 row and medals are hidden (the "Top earner today",
  // "1st place MTD" pattern), render the row as a full-widget stacked layout:
  // name on top, value dominating below. This is what Gecko does for winner-
  // highlight widgets and is what makes them read from across a room.
  if (hideMedals && sorted.length === 1) {
    const row = sorted[0];
    return (
      <div style={{
        height: '100%', width: '100%',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'stretch',
        gap: '2cqh',
        padding: '0 2cqw',
      }}>
        <div style={{
          fontSize: 'clamp(12px, 7cqmin, 22px)',
          fontWeight: 500,
          color: '#e2e8f0',
          lineHeight: 1.1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          letterSpacing: '-0.01em',
        }}>
          {String(row[nameCol] ?? '—')}
        </div>
        <div style={{
          fontSize: 'clamp(22px, 24cqmin, 96px)',
          fontWeight: 800,
          color: '#f8fafc',
          lineHeight: 1,
          letterSpacing: '-0.025em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {valueCol ? formatNumber(Number(row[valueCol] || 0), cfg) : ''}
        </div>
      </div>
    );
  }

  // ── List mode ─────────────────────────────────────────────────────────────
  // Rows adapt to available vertical space: grow up to ~72px each when there's
  // room, squish down to ~26px when many rows need to fit, scroll if even
  // that can't hold them.
  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {sorted.map((row, i) => {
        const isTop = i < 3;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '2px 2px',
            flex: '1 1 0',
            minHeight: 26,
            maxHeight: 72,
            borderBottom: i < sorted.length - 1 ? '1px solid rgba(255,255,255,0.045)' : undefined,
          }}>
            {!hideMedals && (
              <span style={{
                width: 22, textAlign: 'center', flexShrink: 0,
                fontSize: isTop ? '1em' : '0.82em',
                color: isTop ? undefined : '#64748b',
                fontWeight: 700, lineHeight: 1,
              }}>
                {isTop ? MEDALS[i] : `${i + 1}`}
              </span>
            )}
            <span style={{
              flex: 1, minWidth: 0,
              fontSize: '0.95em',
              fontWeight: isTop ? 600 : 500,
              color: isTop ? '#f8fafc' : '#e2e8f0',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {String(row[nameCol] ?? '—')}
            </span>
            <span style={{
              fontSize: '1em', fontWeight: 700,
              color: isTop ? '#c4b5fd' : '#cbd5e1',
              flexShrink: 0, lineHeight: 1,
              textAlign: 'right',
            }}>
              {valueCol ? formatNumber(Number(row[valueCol] || 0), cfg) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
