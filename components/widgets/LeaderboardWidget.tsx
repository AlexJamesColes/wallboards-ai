'use client';
import type { WbWidget } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';
import NoDataPlaceholder from '@/components/NoDataPlaceholder';

interface Props { widget: WbWidget; data: any; }

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardWidget({ widget, data }: Props) {
  const rows: any[]    = data?.rows    || [];
  const columns: string[] = data?.columns || [];
  const cfg = (widget.display_config as any) || {};

  if (rows.length === 0) return <NoDataPlaceholder />;

  const nameCol  = columns[0] || '';
  const valueCol = columns.find(c => c !== nameCol && !isNaN(Number(rows[0]?.[c]))) || columns[1] || '';
  const hideMedals: boolean = !!cfg.hide_medals;

  const sorted = [...rows].sort((a, b) => Number(b[valueCol] || 0) - Number(a[valueCol] || 0));

  // Rows adapt to available vertical space:
  //   - When there's room, each row grows up to ~56px so names have space to
  //     breathe (matches Geckoboard's comfortable spacing with few entries).
  //   - When many rows need to fit, flex-shrink lets them squish down to
  //     a compact 26px each; overflow scrolls once even that runs out.
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
            maxHeight: 56,
            borderBottom: i < sorted.length - 1 ? '1px solid rgba(255,255,255,0.045)' : undefined,
          }}>
            {!hideMedals && (
              <span style={{
                width: 22, textAlign: 'center', flexShrink: 0,
                fontSize: isTop ? '1em' : '0.82em',
                color: isTop ? undefined : '#475569',
                fontWeight: 700, lineHeight: 1,
              }}>
                {isTop ? MEDALS[i] : `${i + 1}`}
              </span>
            )}
            <span style={{
              flex: 1, minWidth: 0,
              fontSize: '0.95em',
              fontWeight: isTop ? 600 : 500,
              color: isTop ? '#f1f5f9' : '#cbd5e1',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {String(row[nameCol] ?? '—')}
            </span>
            <span style={{
              fontSize: '0.95em', fontWeight: 700,
              color: isTop ? '#a5b4fc' : '#94a3b8',
              flexShrink: 0, lineHeight: 1,
            }}>
              {valueCol ? formatNumber(Number(row[valueCol] || 0), cfg) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
