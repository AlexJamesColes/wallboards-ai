/**
 * Single source of truth for the set of widget types.
 *
 * Kept dependency-free so it can be imported from server code (lib/db.ts,
 * API routes), client components (BoardEditor's dropdown), and the
 * component-side registry (components/widget-registry.tsx) without dragging
 * pg or recharts into the wrong bundle.
 *
 * To add a new widget type:
 *   1. Add it here (value + label).
 *   2. Add the actual component to components/widget-registry.tsx.
 *   3. (Optional) handle any type-specific config in the editor / API.
 *
 * The TypeScript union and the editor dropdown options are derived from
 * this list automatically — you don't have to update three places.
 */

export const WIDGET_TYPES = [
  { value: 'number',      label: 'Number'                                },
  { value: 'gauge',       label: 'Gauge (Geck-O-Meter)'                  },
  { value: 'line',        label: 'Line chart'                            },
  { value: 'bar',         label: 'Column chart (vertical bars)'          },
  { value: 'hbar',        label: 'Bar chart (horizontal bars)'           },
  { value: 'leaderboard', label: 'Leaderboard'                           },
  { value: 'table',       label: 'Table'                                 },
] as const;

export type WbWidgetType = typeof WIDGET_TYPES[number]['value'];
