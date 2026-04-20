import { NextResponse } from 'next/server';
import { withAdmin, readJson } from '@/lib/guard';
import { ensureDbReady, updateWidget, deleteWidget } from '@/lib/db';

export const PATCH = withAdmin(async (req, ctx) => {
  await ensureDbReady();
  const body = await readJson(req);
  const widget = await updateWidget(ctx.params.id, body || {});
  return NextResponse.json({ widget });
});

export const DELETE = withAdmin(async (_req, ctx) => {
  await ensureDbReady();
  await deleteWidget(ctx.params.id);
  return NextResponse.json({ ok: true });
});
