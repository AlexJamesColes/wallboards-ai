import { NextResponse } from 'next/server';
import { REPORT_COOKIE } from '@/lib/reportAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL('/canx-refund-report', req.url);
  const res = NextResponse.redirect(url);
  res.cookies.delete(REPORT_COOKIE);
  return res;
}
