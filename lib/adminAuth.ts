/**
 * Tiny admin gate for the few destructive actions we kept after the
 * editor was removed (delete a board, move its department).
 *
 * Auth is a single shared secret in `WB_ADMIN_KEY`. Clients send it as
 * `Authorization: Bearer <key>`. If the env var isn't set, every admin
 * endpoint refuses — fail closed.
 */

import { NextResponse } from 'next/server';
import type { RouteHandler } from './guard';

export function isAdminRequest(req: Request): boolean {
  const adminKey = process.env.WB_ADMIN_KEY;
  if (!adminKey) return false;
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return token === adminKey && token.length > 0;
}

export function withAdminKey(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    if (!process.env.WB_ADMIN_KEY) {
      return NextResponse.json(
        { error: 'Admin actions disabled (WB_ADMIN_KEY not set)' },
        { status: 503 },
      );
    }
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      return await handler(req, ctx);
    } catch (e: any) {
      const status = e?.statusCode || 500;
      if (status === 500) console.error(e);
      return NextResponse.json(
        { error: status === 500 ? 'Server error' : e.message },
        { status },
      );
    }
  };
}
