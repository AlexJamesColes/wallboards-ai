'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import type { WbWidget } from '@/lib/db';

interface Props { widget: WbWidget; data: any; }

export default function HBarChartWidget({ widget, data }: Props) {
  const rows: any[] = data?.rows || [];
  const columns: string[] = data?.columns || [];
  const cfg = (widget.display_config as any) || {};

  if (rows.length === 0) return <div style={{ color: '#475569', fontSize: 12, paddingTop: 8 }}>No data</div>;

  // x_key = label column (rendered on Y axis in horizontal layout)
  // y_key = numeric column (rendered on X axis in horizontal layout)
  const labelKey  = cfg.x_key || columns[0] || '';
  const valueKey  = cfg.y_key || columns.find((c: string) => c !== labelKey) || columns[1] || '';

  // Sort descending by value so the biggest bar is on top
  const sorted = [...rows].sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0));

  return (
    <div style={{ height: '100%', minHeight: 80 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={sorted}
          margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey={labelKey}
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: '#f1f5f9',
              fontSize: 12,
            }}
            cursor={{ fill: 'rgba(99,102,241,0.08)' }}
          />
          <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={28}>
            {sorted.map((_: any, i: number) => (
              <Cell
                key={i}
                fill={i === 0 ? '#6366f1' : i === 1 ? '#818cf8' : i === 2 ? '#a5b4fc' : 'rgba(99,102,241,0.45)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
