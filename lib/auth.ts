import { cookies } from 'next/headers';
import { createHash, timingSafeEqual } from 'crypto';

export const SESSION_COOKIE = 'wb_session';
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function makeSessionToken(): string {
  const pw = process.env.WB_ADMIN_PASSWORD || '';
  const secret = process.env.WB_SESSION_SECRET || 'dev-secret';
  return createHash('sha256').update(pw + ':' + secret).digest('hex');
}

export function isAuthenticated(): boolean {
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) return false;
    const expected = makeSessionToken();
    return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function checkPassword(input: string): boolean {
  const expected = process.env.WB_ADMIN_PASSWORD || '';
  if (!expected || !input) return false;
  try {
    const a = Buffer.from(input.padEnd(expected.length));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return input === expected;
    return timingSafeEqual(a, b) && input === expected;
  } catch {
    return false;
  }
}

export function getSessionToken(): string {
  return makeSessionToken();
}

// For use in API route handlers — reads cookie from the raw request
// instead of next/headers (which can behave differently in Route Handlers).
export function isAuthenticatedFromRequest(req: Request): boolean {
  try {
    const cookieHeader = req.headers.get('cookie') || '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      })
    );
    const token = cookies[SESSION_COOKIE];
    if (!token) return false;
    const expected = makeSessionToken();
    return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
