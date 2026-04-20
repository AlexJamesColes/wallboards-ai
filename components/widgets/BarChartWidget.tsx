'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { WbWidget } from '@/lib/db';

interface Props { widget: WbWidget; data: any; }

export default function BarChartWidget({ widget, data }: Props) {
  const rows: any[] = data?.rows || [];
  const columns: string[] = data?.columns || [];
  const cfg = widget.display_config || {};

  if (rows.length === 0) return <div style={{ color: '#475569', fontSize: 12, paddingTop: 8 }}>No data</div>;

  const xKey = cfg.x_key || columns[0] || '';
  const yKey = cfg.y_key || columns.find(c => c !== xKey) || columns[1] || '';

  return (
    <div style={{ height: '100%', minHeight: 80 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey={xKey} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }} />
          <Bar dataKey={yKey} fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
