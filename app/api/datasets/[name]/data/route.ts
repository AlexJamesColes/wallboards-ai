import { NextResponse } from 'next/server';
import { withPushApiKey, readJson } from '@/lib/guard';
import { ensureDbReady, upsertDataset, setDatasetData } from '@/lib/db';

async function handlePush(req: Request, ctx: any): Promise<Response> {
  await ensureDbReady();
  const body = await readJson(req);
  const rows: any[] = body?.data || [];
  const dataset = await upsertDataset(ctx.params.name);
  await setDatasetData(dataset.id, rows);
  return NextResponse.json({ ok: true, count: rows.length });
}

export const POST = withPushApiKey(handlePush);
export const PATCH = withPushApiKey(handlePush);
