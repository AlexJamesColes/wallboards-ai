import { NextResponse } from 'next/server';
import { withPushApiKey, readJson } from '@/lib/guard';
import { ensureDbReady, upsertDataset, setDatasetData, listDatasets, getDatasetData } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function handlePush(req: Request, ctx: any): Promise<Response> {
  await ensureDbReady();
  const body = await readJson(req);
  const rows: any[] = body?.data || [];
  const dataset = await upsertDataset(ctx.params.name);
  await setDatasetData(dataset.id, rows);
  return NextResponse.json({ ok: true, count: rows.length });
}

// POST / PATCH / PUT all do the same thing — fully replace the dataset
// rows under <name>. PUT is accepted because most REST clients reach
// for it first when the semantics are "upsert by name", and 405-ing
// them just costs a round-trip of confusion.
export const POST  = withPushApiKey(handlePush);
export const PATCH = withPushApiKey(handlePush);
export const PUT   = withPushApiKey(handlePush);

/**
 * Read-only view of whatever's currently stored under this dataset
 * name. Powers the /datasets/<name> test board so you can verify
 * pushes are landing without firing up a SQL client. Public — the
 * data here is whatever the upstream push agent decided to send,
 * same visibility as the showcase boards.
 */
export async function GET(
  _req: Request,
  { params }: { params: { name: string } },
) {
  await ensureDbReady();
  const datasets = await listDatasets();
  const ds = datasets.find(d => d.name === params.name);
  if (!ds) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  }
  const dataRow = await getDatasetData(ds.id);
  const rows: any[]     = dataRow?.data       ?? [];
  const updatedAt: any  = dataRow?.updated_at ?? null;
  return NextResponse.json({
    name:       ds.name,
    schema:     ds.schema || [],
    rows,
    count:      rows.length,
    updated_at: updatedAt,
  });
}
