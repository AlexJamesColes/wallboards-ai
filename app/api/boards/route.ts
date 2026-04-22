import { NextResponse } from 'next/server';
import { withAdmin, readJson } from '@/lib/guard';
import { ensureDbReady, listBoards, createBoard } from '@/lib/db';

export const GET = withAdmin(async () => {
  await ensureDbReady();
  return NextResponse.json({ boards: await listBoards() });
});

export const POST = withAdmin(async (req) => {
  await ensureDbReady();
  const body = await readJson(req);
  const board = await createBoard(body?.name || 'New Board', body?.department ?? null);
  return NextResponse.json({ board }, { status: 201 });
});
