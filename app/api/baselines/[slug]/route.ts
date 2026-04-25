import { NextRequest, NextResponse } from 'next/server';
import { ensureDbReady, recordBaselines, getBaselines } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Per-board, per-day rank baselines for the showcase ▲N/▼N chips.
 *
 *   POST /api/baselines/<slug>
 *     body: { entries: [{ agent_key: string, rank: number }, ...] }
 *     → server inserts each (board, today, agent) ON CONFLICT DO NOTHING,
 *       then returns the canonical map of all entries for today.
 *
 *   GET /api/baselines/<slug>
 *     → returns the day's map without writing anything.
 *
 * Day is computed in Europe/London local time so baselines roll over at
 * UK midnight regardless of the dyno's UTC clock — matches what the sales
 * floor sees on their wall clock.
 */

function todayLondon(): string {
  // en-CA gives the YYYY-MM-DD ISO format we want for the DATE column.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  await ensureDbReady();
  const day = todayLondon();
  const baselines = await getBaselines(params.slug, day);
  return NextResponse.json({ date: day, baselines });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  await ensureDbReady();
  let body: any = null;
  try { body = await req.json(); } catch { /* fall through */ }
  if (!body || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const entries = body.entries
    .filter((e: any) => typeof e?.agent_key === 'string' && Number.isFinite(e?.rank))
    .map((e: any) => ({ agent_key: e.agent_key, rank: Number(e.rank) }));
  const day = todayLondon();
  await recordBaselines(params.slug, day, entries);
  const baselines = await getBaselines(params.slug, day);
  return NextResponse.json({ date: day, baselines });
}
