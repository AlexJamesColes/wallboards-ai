'use client';
import { PieChart, Pie, Cell } from 'recharts';
import type { WbWidget } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';

interface Props { widget: WbWidget; data: any; }

export default function GaugeWidget({ widget, data }: Props) {
  const cfg = (widget.display_config as any) || {};
  const rows: any[]    = data?.rows    || [];
  const columns: string[] = data?.columns || [];

  const valueKey = cfg.value_key || columns[0] || '';
  const rawValue = data?.value ?? (rows[0]?.[valueKey] ?? 0);
  const value    = Number(rawValue) || 0;

  const min   = Number(cfg.gauge_min ?? 0);
  const max   = Number(cfg.gauge_max ?? 100);
  const label = cfg.gauge_label || '';

  // Clamp to range
  const clamped  = Math.min(Math.max(value, min), max);
  const fraction = max === min ? 0 : (clamped - min) / (max - min);

  // Colour zones: 0–60% green, 60–80% amber, 80–100% red
  function zoneColor(f: number) {
    if (f < 0.6)  return '#22c55e';
    if (f < 0.8)  return '#f59e0b';
    return '#ef4444';
  }
  const fillColor = zoneColor(fraction);

  // Semicircle gauge via PieChart
  // Total arc = 180°.  startAngle=180, endAngle=0 draws left→right.
  const filledDeg = fraction * 180;
  const emptyDeg  = 180 - filledDeg;

  const pieData = [
    { name: 'filled', value: filledDeg  },
    { name: 'empty',  value: emptyDeg   },
    { name: 'base',   value: 180        }, // invisible bottom half
  ];

  const formatted = formatNumber(value, cfg);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <div style={{ position: 'relative', width: 160, height: 90, flexShrink: 0 }}>
        <PieChart width={160} height={160} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Pie
            data={pieData}
            cx={80}
            cy={90}
            startAngle={180}
            endAngle={0}
            innerRadius={52}
            outerRadius={76}
            dataKey="value"
            strokeWidth={0}
            isAnimationActive={true}
          >
            <Cell fill={fillColor} />
            <Cell fill="rgba(255,255,255,0.07)" />
            <Cell fill="transparent" />
          </Pie>
        </PieChart>

        {/* Centre value label */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          textAlign: 'center',
          lineHeight: 1,
        }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: fillColor }}>
            {formatted}
          </span>
        </div>
      </div>

      {/* Min / max labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: 152, marginTop: 2 }}>
        <span style={{ fontSize: 10, color: '#475569' }}>{min.toLocaleString()}</span>
        <span style={{ fontSize: 10, color: '#475569' }}>{max.toLocaleString()}</span>
      </div>

      {label && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, textAlign: 'center' }}>{label}</div>
      )}
    </div>
  );
}
