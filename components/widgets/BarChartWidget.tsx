'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { WbWidget } from '@/lib/db';
import NoDataPlaceholder from '@/components/NoDataPlaceholder';
import { CHART_GRID_PROPS, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE, CHART_COLORS } from '@/lib/chartStyles';

interface Props { widget: WbWidget; data: any; }

export default function BarChartWidget({ widget, data }: Props) {
  const rows: any[] = data?.rows || [];
  const columns: string[] = data?.columns || [];
  const cfg = widget.display_config || {};

  if (rows.length === 0) return <NoDataPlaceholder />;

  const xKey = cfg.x_key || columns[0] || '';
  const yKey = cfg.y_key || columns.find(c => c !== xKey) || columns[1] || '';

  return (
    <div style={{ height: '100%', minHeight: 80 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...CHART_GRID_PROPS} />
          <XAxis dataKey={xKey} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis              tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Bar dataKey={yKey} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
