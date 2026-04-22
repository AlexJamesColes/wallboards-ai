/**
 * Canonical list of departments for Wallboards Pro.
 *
 * Kept in its own file so it can be imported from client components
 * (e.g. BoardEditor.tsx) without dragging in the pg-based lib/db.ts
 * and crashing the webpack bundle with "Can't resolve 'tls'".
 */

export const WB_DEPARTMENTS = [
  'Operations',
  'Sales',
  'Renewals',
  'Customer Services',
  'Internal Audit',
  'SME',
  'Fleet',
  'Ancillary',
] as const;

export type WbDepartment = typeof WB_DEPARTMENTS[number];
