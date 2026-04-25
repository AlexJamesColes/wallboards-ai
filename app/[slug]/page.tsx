import { notFound } from 'next/navigation';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import { SHOWCASE_SLUGS } from '@/lib/showcaseSlugs';
import KioskView from '../view/[token]/KioskView';
import ShowcaseView from '../showcase/[slug]/ShowcaseView';

export const dynamic = 'force-dynamic';

const SHOWCASE_SLUG_SET: Set<string> = new Set(SHOWCASE_SLUGS);

/**
 * Root-level human-readable kiosk route.
 *
 *   https://wallboards.insuretec.ai/sales-london → board where slug = 'sales-london'
 *
 * Static routes (/admin, /login, /view, /api, /showcase) take precedence
 * over this dynamic segment in Next.js, so the reserved-word protection
 * lives in the slug-input validator in BoardEditor. If one still slipped
 * through, this route returns 404 for the unknown slug.
 */
export default async function SlugKioskPage({ params }: { params: { slug: string } }) {
  await ensureDbReady();
  const board = await getBoardBySlug(params.slug);
  if (!board) notFound();

  // Showcase opt-in — pick the dominant table widget and render the fancy
  // view. Fall back to classic kiosk if there isn't a usable widget.
  if (SHOWCASE_SLUG_SET.has(params.slug)) {
    const tables = (board.widgets || []).filter(w =>
      w.type === 'table' && !(w.display_config as any)?.hide_header
    );
    tables.sort((a, b) => (b.col_span * b.row_span) - (a.col_span * a.row_span));
    const main = tables[0];
    if (main) return <ShowcaseView board={board} widgetId={main.id} />;
  }

  return <KioskView board={board} />;
}
