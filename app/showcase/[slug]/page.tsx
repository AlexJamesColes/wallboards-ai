import { notFound } from 'next/navigation';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import ShowcaseView from './ShowcaseView';

export const dynamic = 'force-dynamic';

/**
 * Bespoke "showcase" rendering of any existing board — picks the main
 * leaderboard widget and renders it as a podium + card grid + ticker + team
 * target banner, instead of the generic table layout.
 *
 *   /showcase/london-agents   → fancy view
 *   /london-agents            → classic board (still works)
 */
export default async function ShowcasePage({ params }: { params: { slug: string } }) {
  await ensureDbReady();
  const board = await getBoardBySlug(params.slug);
  if (!board) notFound();

  // Pick the widget we'll drive the showcase off. Rule of thumb: the largest
  // table widget on the board that isn't a legend (hide_header = true) is
  // almost always the agent leaderboard.
  const tables = (board.widgets || []).filter(w =>
    w.type === 'table' && !(w.display_config as any)?.hide_header
  );
  tables.sort((a, b) => (b.col_span * b.row_span) - (a.col_span * a.row_span));
  const mainWidget = tables[0];

  if (!mainWidget) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1c', color: '#f1f5f9',
                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                   fontFamily: 'var(--font-raleway, sans-serif)', padding: 40,
                   textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>No leaderboard widget on this board.</div>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Showcase mode expects at least one table widget with a header.</div>
        </div>
      </div>
    );
  }

  return <ShowcaseView board={board} widgetId={mainWidget.id} />;
}
