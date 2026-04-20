import { NextResponse } from 'next/server';
import { withPushApiKey } from '@/lib/guard';
import { ensureDbReady, upsertDataset, deleteDataset } from '@/lib/db';

export const PUT = withPushApiKey(async (req, ctx) => {
  await ensureDbReady();
  const body = await req.json().catch(() => ({}));
  const dataset = await upsertDataset(ctx.params.name, body?.fields || body?.schema || []);
  return NextResponse.json({ dataset });
});

export const DELETE = withPushApiKey(async (_req, ctx) => {
  await ensureDbReady();
  await deleteDataset(ctx.params.name);
  return NextResponse.json({ ok: true });
});
