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

  // Sizes scale with the widget's own box (via container-type: size on
  // WidgetRenderer). cqmin = the smaller of inline/block so wide-but-short
  // cells don't blow up vertically.
  //
  // Length-aware multiplier: a short value like "8" wants a big font, but
  // "£1,234,567" needs to shrink so it fits the width of a narrow cell.
  // Otherwise tall-narrow widgets (e.g. LDN Earn MTD at 2 cols × 3 rows)
  // compute a huge font off cqmin and the wide value overflows the width
  // into an ellipsis.
  const valueStr = formatNumber(num, cfg);
  const len = valueStr.length;
  const mul = len >= 9 ? 13 : len >= 7 ? 16 : len >= 5 ? 20 : 26;
  const valueFontSize    = `clamp(22px, ${mul}cqmin, 112px)`;
  const subtitleFontSize = 'clamp(11px,  6cqmin,  22px)';

  // Gecko puts the subtitle (agent name) directly above the big number, not
  // below — the value is always the anchor. Left-aligned so everything
  // lines up flush to the card edge and the widget fills its space instead
  // of floating in the middle.
  return (
    <div style={{
      height: '100%', width: '100%',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'stretch',
      padding: '0 2cqw',
      gap: '2cqh',
      border: `2px solid ${borderColor}`,
      borderRadius: 10,
      boxShadow: goal !== null ? `0 0 20px ${glowColor}` : undefined,
      transition: 'border-color 0.3s, box-shadow 0.3s',
      overflow: 'hidden',
    }}>
      {subtitle && (
        <div style={{
          fontSize: subtitleFontSize,
          color: '#e2e8f0', fontWeight: 500,
          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: 1.1,
          letterSpacing: '-0.005em',
        }}>{subtitle}</div>
      )}
      <div style={{
        fontSize: valueFontSize, fontWeight: 800, color: '#f8fafc',
        lineHeight: 1, letterSpacing: '-0.025em',
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {valueStr}
      </div>
      {goal !== null && (
        <div style={{
          fontSize: subtitleFontSize, color: '#64748b', fontWeight: 500,
          lineHeight: 1.2,
        }}>
          Goal: {formatNumber(goal, cfg)}
        </div>
      )}
    </div>
  );
}
