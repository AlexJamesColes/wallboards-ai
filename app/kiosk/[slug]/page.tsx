import { redirect, notFound } from 'next/navigation';
import { getShowcaseBoard } from '@/lib/showcaseBoards';

/**
 * Kiosk slideshow entry point. The TV bookmarks /kiosk/<rotation-slug>
 * and this redirects to the first source in the rotation with the
 * `?rotate=&step=&interval=` query params useKioskRotation knows how
 * to follow. From then on the rotation is self-perpetuating — each
 * source view lands a fresh URL with the next step number, so the
 * bookmark only ever fires once per session.
 */
export default function KioskRotationPage({ params }: { params: { slug: string } }) {
  const config = getShowcaseBoard(params.slug);
  if (!config || config.data.type !== 'rotation') notFound();

  const sources    = config.data.sources;
  const intervalMs = config.data.intervalMs ?? 60_000;
  if (!sources || sources.length === 0) notFound();

  const first = sources[0];
  const target =
    `/${encodeURIComponent(first)}` +
    `?rotate=${encodeURIComponent(params.slug)}` +
    `&step=0` +
    `&interval=${intervalMs}`;
  redirect(target);
}
