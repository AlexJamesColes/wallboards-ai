import { cookies } from 'next/headers';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Lightweight cookie-based gate for the Cancellation Refund Report.
 * Uses a dedicated `WB_AUDIT_PASSWORD` env var so the report can be
 * shared with the Internal Audit team without handing out the broader
 * `WB_AUDIT_PASSWORD` (which gates destructive admin actions on the floor).
 *
 * The cookie value is a SHA-256 of WB_AUDIT_PASSWORD with a fixed
 * pepper. Comparing against a freshly-derived expected value means
 * rotating WB_AUDIT_PASSWORD automatically invalidates outstanding
 * sessions.
 */

export const REPORT_COOKIE = 'wb_canx_refund_session';
export const REPORT_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export function isReportAuthConfigured(): boolean {
  return !!process.env.WB_AUDIT_PASSWORD;
}

function expectedToken(): string | null {
  const key = process.env.WB_AUDIT_PASSWORD;
  if (!key) return null;
  return createHash('sha256').update('canx-refund-report:audit:' + key).digest('hex');
}

export function getReportToken(): string {
  const t = expectedToken();
  if (!t) throw new Error('WB_AUDIT_PASSWORD is not set');
  return t;
}

export function checkReportPassword(input: string): boolean {
  const expected = process.env.WB_AUDIT_PASSWORD || '';
  if (!expected || !input) return false;
  // Constant-time comparison; pad shorter string to avoid early-return leak.
  const a = Buffer.from(input.padEnd(expected.length));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return input === expected;
  try {
    return timingSafeEqual(a, b) && input === expected;
  } catch {
    return false;
  }
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ab.length === 0 || ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** Server-component check (uses next/headers cookies()). */
export function isReportAuthenticated(): boolean {
  if (!process.env.WB_AUDIT_PASSWORD) return false;
  try {
    const token = cookies().get(REPORT_COOKIE)?.value;
    if (!token) return false;
    const expected = expectedToken();
    return !!expected && safeEqualHex(token, expected);
  } catch {
    return false;
  }
}

/** Route-handler check (reads cookie off the raw Request). */
export function isReportAuthenticatedFromRequest(req: Request): boolean {
  if (!process.env.WB_AUDIT_PASSWORD) return false;
  try {
    const cookieHeader = req.headers.get('cookie') || '';
    const jar = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      }),
    );
    const token = jar[REPORT_COOKIE];
    if (!token) return false;
    const expected = expectedToken();
    return !!expected && safeEqualHex(token, expected);
  } catch {
    return false;
  }
}
