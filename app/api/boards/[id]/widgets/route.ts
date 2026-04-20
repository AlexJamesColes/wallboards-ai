import { NextResponse } from 'next/server';
import { withAdmin, readJson } from '@/lib/guard';
import { ensureDbReady, createWidget } from '@/lib/db';

export const POST = withAdmin(async (req, ctx) => {
  await ensureDbReady();
  const body = await readJson(req);
  const widget = await createWidget(ctx.params.id, body || {});
  return NextResponse.json({ widget }, { status: 201 });
});
