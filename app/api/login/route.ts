import { NextResponse } from 'next/server';
import { checkPassword, getSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!checkPassword(body.password || '')) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, getSessionToken(), {
    httpOnly: true, sameSite: 'lax', maxAge: SESSION_MAX_AGE, path: '/',
  });
  return res;
}
