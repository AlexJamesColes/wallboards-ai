import { NextResponse } from 'next/server';
import { ensureDbReady, getBoard, updateBoard, deleteBoard } from '@/lib/db';
import { withAdminKey } from '@/lib/adminAuth';
import { readJson } from '@/lib/guard';

export const dynamic = 'force-dynamic';

/**
 * Minimal admin actions on an existing board. Gated by WB_ADMIN_KEY —
 * the full editor was retired but two destructive moves still happen
 * occasionally:
 *
 *   PATCH /api/boards/<id>   { department: 'Sales' }
 *     Move a board between department groups on the home page. Only
 *     `department` is honoured; everything else (slug, name, widgets)
 *     is now defined in code and not editable here.
 *
 *   DELETE /api/boards/<id>
 *     Remove a board and its widgets. Cascading delete is handled by
 *     wb-db.deleteBoard.
 */

export const PATCH = withAdminKey(async (req, ctx) => {
  await ensureDbReady();
  const id = ctx.params.id as string;

  // Synthetic boards (sales-board-1, london-kiosk, …) have no DB row —
  // their department is set in lib/showcaseBoards.ts. Don't try to
  // update one; explain how to actually move it.
  if (id.startsWith('synthetic:') || id.startsWith('external:')) {
    return NextResponse.json({
      error: 'This board\'s config lives in lib/showcaseBoards.ts. Edit the catalogue and redeploy to move it.',
    }, { status: 400 });
  }

  const body = await readJson<{ department?: string | null }>(req);
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 });

  // Whitelist what the lightweight admin gate is allowed to touch — the
  // editor's gone, so this is intentionally just `department`. Pass null
  // through (clears the dept), but reject anything else.
  if (!('department' in body)) {
    return NextResponse.json({ error: 'Only `department` may be patched' }, { status: 400 });
  }
  const dept = body.department === null || body.department === ''
    ? null
    : String(body.department).slice(0, 100);

  const existing = await getBoard(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updated = await updateBoard(id, { department: dept });
  return NextResponse.json({ board: updated });
});

export const DELETE = withAdminKey(async (_req, ctx) => {
  await ensureDbReady();
  const id = ctx.params.id as string;
  const existing = await getBoard(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteBoard(id);
  return NextResponse.json({ ok: true });
});
