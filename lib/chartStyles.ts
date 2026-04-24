/**
 * Shared Recharts theme.
 *
 * Each Wallboards chart widget (line / bar / hbar) used to inline these
 * style objects, so changing the tooltip background or axis colour required
 * editing three files. Importing from here keeps them in sync.
 */

export const CHART_GRID_PROPS = {
  strokeDasharray: '3 3',
  stroke: 'rgba(255,255,255,0.05)',
} as const;

export const CHART_AXIS_TICK = { fill: '#475569', fontSize: 10 } as const;

/** Y-axis tick for charts where the label is the category (e.g. hbar). */
export const CHART_LABEL_AXIS_TICK = { fill: '#94a3b8', fontSize: 10 } as const;

export const CHART_TOOLTIP_STYLE = {
  background: '#0f172a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#f1f5f9',
  fontSize: 12,
} as const;

export const CHART_TOOLTIP_CURSOR = { fill: 'rgba(99,102,241,0.08)' } as const;

/** Brand palette used for charts. Index 0 is the strongest emphasis. */
export const CHART_COLORS = ['#6366f1', '#818cf8', '#a5b4fc', 'rgba(99,102,241,0.45)'] as const;
