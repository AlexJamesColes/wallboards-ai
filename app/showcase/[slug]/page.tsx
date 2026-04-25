import { notFound } from 'next/navigation';
import type { WbBoard } from '@/lib/db';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import { getShowcaseBoard, isSyntheticBoard } from '@/lib/showcaseBoards';
import ShowcaseView from './ShowcaseView';

export const dynamic = 'force-dynamic';

/**
 * Explicit "/showcase/<slug>" route. Mirrors the public /<slug> route's
 * showcase rendering, including support for synthetic combined boards
 * (e.g. sales-group).
 */
export default async function ShowcasePage({ params }: { params: { slug: string } }) {
  await ensureDbReady();

  if (isSyntheticBoard(params.slug)) {
    const config = getShowcaseBoard(params.slug)!;
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

  if (!getShowcaseBoard(params.slug)) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1c', color: '#f1f5f9',
                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                   fontFamily: 'var(--font-raleway, sans-serif)', padding: 40,
                   textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>This board isn't a showcase board.</div>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Add its slug to lib/showcaseBoards to enable showcase rendering.</div>
        </div>
      </div>
    );
  }

  return (
    <ShowcaseView
      board={board}
      slug={params.slug}
    />
  );
}
