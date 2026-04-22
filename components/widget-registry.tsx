'use client';

import type { WbWidget } from '@/lib/db';
import type { WbWidgetType } from '@/lib/widget-types';

import NumberWidget      from './widgets/NumberWidget';
import GaugeWidget       from './widgets/GaugeWidget';
import LineChartWidget   from './widgets/LineChartWidget';
import BarChartWidget    from './widgets/BarChartWidget';
import HBarChartWidget   from './widgets/HBarChartWidget';
import LeaderboardWidget from './widgets/LeaderboardWidget';
import TableWidget       from './widgets/TableWidget';

/**
 * Maps each widget type string to the component that renders it. Keeps
 * WidgetRenderer's dispatch as a single map lookup instead of a long
 * if-chain that could silently miss a type.
 */
export type WidgetComponent = React.ComponentType<{ widget: WbWidget; data: any }>;

export const WIDGET_COMPONENTS: Record<WbWidgetType, WidgetComponent> = {
  number:      NumberWidget,
  gauge:       GaugeWidget,
  line:        LineChartWidget,
  bar:         BarChartWidget,
  hbar:        HBarChartWidget,
  leaderboard: LeaderboardWidget,
  table:       TableWidget,
};
