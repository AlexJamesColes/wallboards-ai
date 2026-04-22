'use client';
import type { WbWidget } from '@/lib/db';

interface Props { widget: WbWidget; data: any; }

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardWidget({ widget, data }: Props) {
  const rows: any[] = data?.rows || [];
  const columns: string[] = data?.columns || [];

  if (rows.length === 0) return <div style={{ color: '#475569', fontSize: 12, paddingTop: 8 }}>No data</div>;

  const nameCol = columns[0] || '';
  const valueCol = columns.find(c => c !== nameCol && !isNaN(Number(rows[0]?.[c]))) || columns[1] || '';

  const sorted = [...rows].sort((a, b) => Number(b[valueCol] || 0) - Number(a[valueCol] || 0));

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sorted.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 8, background: i < 3 ? `rgba(16,185,129,${0.08 - i * 0.02})` : 'rgba(255,255,255,0.02)', border: `1px solid ${i === 0 ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.04)'}` }}>
          <span style={{ fontSize: i < 3 ? '1.2em' : '0.9em', width: 24, textAlign: 'center', flexShrink: 0, color: '#475569', fontWeight: 700 }}>
            {i < 3 ? MEDALS[i] : `${i + 1}`}
          </span>
          <span style={{ flex: 1, fontSize: 'inherit', fontWeight: i < 3 ? 700 : 500, color: i < 3 ? '#f1f5f9' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(row[nameCol] ?? '—')}
          </span>
          <span style={{ fontSize: '1.1em', fontWeight: 800, color: i === 0 ? '#10b981' : '#64748b', flexShrink: 0 }}>
            {valueCol ? Number(row[valueCol] || 0).toLocaleString() : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
