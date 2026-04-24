import { NextResponse } from 'next/server';

/**
 * Live alert feed.
 *
 * Anything POSTed here appears in the wallboard's activity ticker within a
 * few seconds. Used to forward Teams sales alerts onto the TVs — IT just
 * point their existing webhook at this URL alongside Teams.
 *
 *   POST /api/alerts
 *     { "text": "Mitchell Crouch closed £4,500", "emoji": "💰", "source": "teams" }
 *
 *   GET  /api/alerts?since=<unix_ms>
 *     Returns alerts created after `since` so the kiosk can poll for new
 *     ones cheaply. Defaults to the last 15 minutes if `since` is omitted.
 *
 * Auth:
 *   If WB_PUSH_API_KEY is set, POST requires Authorization: Bearer <key>.
 *   GET is unauthenticated (same contract as widget data — kiosks are open).
 *
 * Storage:
 *   In-process ring buffer (last 200 alerts, 30-minute TTL). We don't need
 *   long-term history for a ticker, and in-memory avoids DB writes for what
 *   is essentially a pub/sub channel. Alerts are ephemeral by design — a
 *   restart wipes them and that's fine, future alerts work straight away.
 */

interface Alert {
  id:     string;
  text:   string;
  emoji:  string;
  source: string;
  at:     number;
}

const MAX_KEEP     = 200;
const TTL_MS       = 30 * 60 * 1000;
const buffer: Alert[] = (globalThis as any).__wbAlerts ||= [];

function gc() {
  const cutoff = Date.now() - TTL_MS;
  while (buffer.length && buffer[0].at < cutoff) buffer.shift();
}

function checkAuth(req: Request): NextResponse | null {
  const apiKey = process.env.WB_PUSH_API_KEY;
  if (!apiKey) return null;
  const auth  = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token !== apiKey) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  return null;
}

export async function POST(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = String(body?.text || body?.message || '').trim();
  if (!text) return NextResponse.json({ error: '"text" is required' }, { status: 400 });

  const alert: Alert = {
    id:     `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text:   text.slice(0, 240),
    emoji:  String(body?.emoji || '📣').slice(0, 6),
    source: String(body?.source || 'api').slice(0, 40),
    at:     Date.now(),
  };

  gc();
  buffer.push(alert);
  while (buffer.length > MAX_KEEP) buffer.shift();

  return NextResponse.json({ ok: true, id: alert.id });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sinceRaw  = searchParams.get('since');
  const since     = sinceRaw ? Number(sinceRaw) : Date.now() - 15 * 60 * 1000;
  gc();
  const alerts    = buffer.filter(a => a.at > since).slice(-50);
  return NextResponse.json({ alerts, now: Date.now() });
}
