import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export async function GET() {
  const res = NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
