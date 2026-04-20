import { NextResponse } from 'next/server';
import { withAdmin, readJson } from '@/lib/guard';
import { ensureDbReady, getBoard, updateBoard, deleteBoard } from '@/lib/db';

export const GET = withAdmin(async (_req, ctx) => {
  await ensureDbReady();
  const board = await getBoard(ctx.params.id);
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ board });
});

export const PATCH = withAdmin(async (req, ctx) => {
  await ensureDbReady();
  const body = await readJson(req);
  const board = await updateBoard(ctx.params.id, body || {});
  return NextResponse.json({ board });
});

export const DELETE = withAdmin(async (_req, ctx) => {
  await ensureDbReady();
  await deleteBoard(ctx.params.id);
  return NextResponse.json({ ok: true });
});
