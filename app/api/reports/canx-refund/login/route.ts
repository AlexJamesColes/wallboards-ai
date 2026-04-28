import { NextResponse } from 'next/server';
import {
  REPORT_COOKIE,
  REPORT_COOKIE_MAX_AGE,
  checkReportPassword,
  getReportToken,
  isReportAuthConfigured,
} from '@/lib/reportAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isReportAuthConfigured()) {
    return NextResponse.json(
      { error: 'Report access is not configured on the server' },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  if (!checkReportPassword(body?.password || '')) {
    return NextResponse.json({ error: 'Incorrect access key' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(REPORT_COOKIE, getReportToken(), {
    httpOnly: true, sameSite: 'lax', maxAge: REPORT_COOKIE_MAX_AGE, path: '/',
  });
  return res;
}
