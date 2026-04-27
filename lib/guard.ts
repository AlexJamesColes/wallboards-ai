import { NextResponse } from 'next/server';

export type RouteHandler = (req: Request, ctx: any) => Promise<Response>;

/**
 * Guard for the dataset-push endpoint. Fails closed: requires
 * `WB_PUSH_API_KEY` env var to be set on the dyno AND every caller
 * to present it via `Authorization: Bearer <key>`. With no key
 * configured the endpoint refuses all requests with 503 — set the
 * env var to enable it.
 */
export function withPushApiKey(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    const apiKey = process.env.WB_PUSH_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Push endpoint disabled (WB_PUSH_API_KEY not set on the server)' },
        { status: 503 },
      );
    }
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== apiKey || token.length === 0) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }
    try {
      return await handler(req, ctx);
    } catch (e: any) {
      const status = e?.statusCode || 500;
      if (status === 500) console.error(e);
      return NextResponse.json({ error: status === 500 ? 'Server error' : e.message }, { status });
    }
  };
}

export async function readJson<T = any>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}
