import { notFound } from 'next/navigation';
import type { WbBoard } from '@/lib/db';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import { getShowcaseBoard, isSyntheticBoard } from '@/lib/showcaseBoards';
import KioskView from '../view/[token]/KioskView';
import ShowcaseView from '../showcase/[slug]/ShowcaseView';
import AgentStatesView from '../_agent-states/AgentStatesView';
import SalesBoard1View from '../_sales-board-1/SalesBoard1View';

export const dynamic = 'force-dynamic';

/**
 * Root-level human-readable kiosk route.
 *
 *   https://wallboards.insuretec.ai/sales-london → board where slug = 'sales-london'
 *
 * Three cases are handled in order:
 *   1. Synthetic showcase boards (e.g. sales-group) — have no DB row;
 *      a fake board is built from lib/showcaseBoards config and the
 *      data is fetched via /api/board-data/<slug>.
 *   2. Real DB boards listed in SHOWCASE_BOARDS — render ShowcaseView
 *      using their leaderboard widget's slug.
 *   3. Real DB boards not opted into the showcase — render the legacy
 *      kiosk widget grid.
 */
export default async function SlugKioskPage({ params }: { params: { slug: string } }) {
  await ensureDbReady();

  // (1) Synthetic showcase board — no DB lookup needed.
  if (isSyntheticBoard(params.slug)) {
    const config = getShowcaseBoard(params.slug)!;

    // Agent-states variant has its own view — entirely different shape
    // (status grid, not a leaderboard) so it doesn't fit through
    // ShowcaseView's podium/cards/ticker pipeline.
    if (config.data.type === 'agent-states') {
      return (
        <AgentStatesView
          slug={config.slug}
          title={config.name}
          department={config.department}
        />
      );
    }

    // Dashboard variant — multi-widget director overview (Sales · Board 1
    // and friends). Each board's widget specs live in their own module
    // referenced by `widgetSpecKey`; the view fetches /api/<slug> which
    // fans out to MS-SQL / Noetica / Zendesk in parallel.
    if (config.data.type === 'dashboard') {
      return (
        <SalesBoard1View
          title={config.name}
          department={config.department}
        />
      );
    }

    const fake: WbBoard = {
      id:             `synthetic:${config.slug}`,
      slug_token:     '',
      slug:           config.slug,
      name:           config.name,
      department:     config.department,
      cols:           4,
      rows:           3,
      background:     '#0a0f1c',
      created_by:     null,
      display_config: {},
      widgets:        [],
    };
    return (
      <ShowcaseView
        board={fake}
        slug={config.slug}
        defaultTarget={config.defaultTarget}
      />
    );
  }

  const board = await getBoardBySlug(params.slug);
  if (!board) notFound();

  // (2) Widget-backed showcase board.
  if (getShowcaseBoard(params.slug)) {
    return (
      <ShowcaseView
        board={board}
        slug={params.slug}
      />
    );
  }

  // (3) Legacy kiosk fallback.
  return <KioskView board={board} />;
}
