import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * Theme persistence endpoint — mirrors the dashboard's
 * /api/me/theme so the verbatim-copied ThemeToggle component's
 * fire-and-forget fetch succeeds.
 *
 * Sets a `theme` cookie at the wallboards origin so subsequent
 * SSR loads can paint the right mode on first paint (FOUC fix).
 * The actual UI flip is driven by ThemeToggle's localStorage +
 * className manipulation; this endpoint exists purely to persist
 * across reloads / SSR.
 *
 * Not authenticated — the cookie is per-browser, no privacy
 * implications, and gating it would couple this endpoint to the
 * MSAL client unnecessarily.
 */

export async function POST(req: Request) {
  let theme: string | undefined;
  try {
    const body = await req.json();
    theme = body?.theme;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  if (theme !== 'light' && theme !== 'dark') {
    return NextResponse.json({ error: 'theme must be "light" or "dark"' }, { status: 400 });
  }

  cookies().set('theme', theme, {
    path:     '/',
    maxAge:   60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: false, // ThemeToggle reads classList, not the cookie itself; keeping it readable is fine.
  });

  return NextResponse.json({ ok: true });
}
