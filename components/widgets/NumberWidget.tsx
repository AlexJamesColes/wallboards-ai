'use client';
import type { WbWidget } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';

interface Props { widget: WbWidget; data: any; }

export default function NumberWidget({ widget, data }: Props) {
  const value = data?.value ?? (Array.isArray(data?.rows) && data.rows.length > 0 ? Object.values(data.rows[0])[0] : null);
  const num = value !== null && value !== undefined ? Number(value) : null;
  const cfg = (widget.display_config as any) || {};
  const goal = cfg.goal !== undefined ? Number(cfg.goal) : null;
  // Subtitle can come from display_config (static) or from the data payload
  // (dynamic — e.g. a row like { top_earner: "Fuad Olaiya", total: 3892 }
  // returns the name as data.subtitle).
  const subtitle = cfg.subtitle || data?.subtitle || '';

  let borderColor = 'transparent';
  let glowColor = 'transparent';
  if (goal !== null && num !== null) {
    if (num >= goal) { borderColor = '#10b981'; glowColor = 'rgba(16,185,129,0.3)'; }
    else if (num >= goal * 0.9) { borderColor = '#f59e0b'; glowColor = 'rgba(245,158,11,0.3)'; }
    else { borderColor = '#f87171'; glowColor = 'rgba(248,113,113,0.3)'; }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `2px solid ${borderColor}`, borderRadius: 10, boxShadow: goal !== null ? `0 0 20px ${glowColor}` : undefined, transition: 'border-color 0.3s, box-shadow 0.3s', padding: 8 }}>
      <div style={{ fontSize: 'clamp(28px, 5vw, 56px)', fontWeight: 800, color: '#f1f5f9', lineHeight: 1, letterSpacing: '-0.02em' }}>
        {formatNumber(num, cfg)}
      </div>
      {goal !== null && (
        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
          Goal: {formatNumber(goal, cfg)}
        </div>
      )}
      {subtitle && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}
