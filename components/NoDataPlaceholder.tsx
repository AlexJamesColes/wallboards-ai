'use client';

interface Props { message?: string; }

/**
 * Shared "no data yet" placeholder rendered inside a widget when its
 * data source returned zero rows. Kept tiny and visually muted so it
 * doesn't fight other widgets on a dense wallboard.
 */
export default function NoDataPlaceholder({ message = 'No data' }: Props) {
  return <div style={{ color: '#475569', fontSize: 12, paddingTop: 8 }}>{message}</div>;
}
