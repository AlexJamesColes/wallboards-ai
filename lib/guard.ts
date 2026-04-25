import { NextResponse } from 'next/server';

export type RouteHandler = (req: Request, ctx: any) => Promise<Response>;

/**
 * Guard for the dataset-push endpoint. When `WB_PUSH_API_KEY` is set,
 * callers must present it via `Authorization: Bearer <key>`. With no
 * key configured the endpoint is open — fine for internal-only use.
 */
export function withPushApiKey(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    const apiKey = process.env.WB_PUSH_API_KEY;
    if (apiKey) {
      const auth = req.headers.get('authorization') || '';
      const token = auth.replace(/^Bearer\s+/i, '');
      if (token !== apiKey) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
      }
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
