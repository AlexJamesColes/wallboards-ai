'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import type { WbWidget } from '@/lib/db';
import NoDataPlaceholder from '@/components/NoDataPlaceholder';
import {
  CHART_GRID_PROPS, CHART_AXIS_TICK, CHART_LABEL_AXIS_TICK,
  CHART_TOOLTIP_STYLE, CHART_TOOLTIP_CURSOR, CHART_COLORS,
} from '@/lib/chartStyles';

interface Props { widget: WbWidget; data: any; }

export default function HBarChartWidget({ widget, data }: Props) {
  const rows: any[] = data?.rows || [];
  const columns: string[] = data?.columns || [];
  const cfg = (widget.display_config as any) || {};

  if (rows.length === 0) return <NoDataPlaceholder />;

  // x_key = label column (rendered on Y axis in horizontal layout)
  // y_key = numeric column (rendered on X axis in horizontal layout)
  const labelKey  = cfg.x_key || columns[0] || '';
  const valueKey  = cfg.y_key || columns.find((c: string) => c !== labelKey) || columns[1] || '';

  // Sort descending by value so the biggest bar is on top
  const sorted = [...rows].sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0));

  return (
    <div style={{ height: '100%', minHeight: 80 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={sorted} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid {...CHART_GRID_PROPS} horizontal={false} />
          <XAxis type="number"   tick={CHART_AXIS_TICK}       axisLine={false} tickLine={false} />
          <YAxis type="category" tick={CHART_LABEL_AXIS_TICK} axisLine={false} tickLine={false} dataKey={labelKey} width={90} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_TOOLTIP_CURSOR} />
          <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={28}>
            {sorted.map((_: any, i: number) => (
              <Cell key={i} fill={CHART_COLORS[Math.min(i, CHART_COLORS.length - 1)]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
