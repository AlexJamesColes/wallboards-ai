import { NextResponse } from 'next/server';
import { ensureDbReady, listBoards } from '@/lib/db';

/**
 * Public board directory — no auth. Returns the minimum a viewer needs
 * to pick a wallboard from the /browse landing page (id, name, public
 * URL, declared display type). Sensitive bits like SQL queries / push
 * keys / widget configs are NOT exposed.
 */
export async function GET() {
  await ensureDbReady();
  const boards = await listBoards();
  const out = boards.map(b => {
    const dc = (b.display_config as any) || {};
    const displayType: 'mobile' | 'desktop' = dc.display_type === 'mobile' ? 'mobile' : 'desktop';
    return {
      id:           b.id,
      name:         b.name,
      slug:         b.slug,
      slug_token:   b.slug_token,
      department:   b.department || null,
      display_type: displayType,
      // Public URL — prefer the human slug when set, fall back to the
      // UUID kiosk view.
      url:          b.slug ? `/${b.slug}` : `/view/${b.slug_token}`,
    };
  });
  return NextResponse.json({ boards: out });
}
