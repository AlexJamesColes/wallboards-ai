import { notFound } from 'next/navigation';
import { ensureDbReady, getBoardBySlug } from '@/lib/db';
import KioskView from '../view/[token]/KioskView';

export const dynamic = 'force-dynamic';

/**
 * Root-level human-readable kiosk route.
 *
 *   https://wallboards.insuretec.ai/sales-london → board where slug = 'sales-london'
 *
 * Static routes (/admin, /login, /view, /api) take precedence over this
 * dynamic segment in Next.js, so the reserved-word protection lives in
 * the slug-input validator in BoardEditor. If one still slipped through,
 * this route just returns 404 for the unknown slug.
 */
export default async function SlugKioskPage({ params }: { params: { slug: string } }) {
  await ensureDbReady();
  const board = await getBoardBySlug(params.slug);
  if (!board) notFound();
  return <KioskView board={board} />;
}
