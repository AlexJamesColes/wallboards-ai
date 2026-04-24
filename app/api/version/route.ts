import { NextResponse } from 'next/server';

// Captured once when the Node process boots — survives across requests but
// changes on every Heroku release (new dyno = new process = new start time).
const BOOT_ID =
  process.env.HEROKU_RELEASE_VERSION ||
  process.env.HEROKU_SLUG_COMMIT       ||
  String(Date.now());

/**
 * Lightweight "what's running right now?" endpoint used by the kiosk view
 * to detect when a new build has shipped and auto-reload so TVs never get
 * stuck on a stale bundle.
 */
export async function GET() {
  return NextResponse.json({ id: BOOT_ID });
}
