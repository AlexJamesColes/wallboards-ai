import { NextResponse } from 'next/server';
import { ensureDbReady, listBoards } from '@/lib/db';
import { SHOWCASE_BOARDS, isSyntheticBoard } from '@/lib/showcaseBoards';

export const dynamic = 'force-dynamic';

/**
 * Public board directory — no auth. Returns the minimum a viewer needs
 * to pick a wallboard from the /browse landing page. Two sources are
 * merged:
 *
 *   • Real DB boards from `wb_boards` (each one editable via the
 *     admin gate, has its own widgets, lives at /:slug or /view/:token).
 *   • Synthetic showcase boards from lib/showcaseBoards — code-defined
 *     combined views (e.g. sales-group). These have no DB row; their
 *     `id` is just their slug, prefixed so admin actions can't act on
 *     them by mistake.
 *
 * Sensitive bits like SQL queries / push keys / widget configs are NOT
 * exposed.
 */
export async function GET() {
  await ensureDbReady();
  const dbBoards = await listBoards();
  const dbOut = dbBoards.map(b => ({
    id:         b.id,
    name:       b.name,
    slug:       b.slug,
    slug_token: b.slug_token,
    department: b.department || null,
    synthetic:  false,
    url:        b.slug ? `/${b.slug}` : `/view/${b.slug_token}`,
  }));

  // Inject synthetic showcase boards. They land in the same listing the
  // browse page already renders, so departments / search / recents all
  // just work without further code.
  const syntheticOut = SHOWCASE_BOARDS
    .filter(b => isSyntheticBoard(b.slug))
    .map(b => ({
      id:         `synthetic:${b.slug}`,
      name:       b.name,
      slug:       b.slug,
      slug_token: '',
      department: b.department,
      synthetic:  true,
      url:        `/${b.slug}`,
    }));

  return NextResponse.json({ boards: [...dbOut, ...syntheticOut] });
}
