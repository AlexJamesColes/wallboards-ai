import { NextResponse } from 'next/server';
import { withAdmin, readJson } from '@/lib/guard';
import { ensureDbReady, getBoard, getBoardBySlug, updateBoard, deleteBoard } from '@/lib/db';

const SLUG_PATTERN  = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['admin','login','logout','view','api','_next','favicon.ico']);

export const GET = withAdmin(async (_req, ctx) => {
  await ensureDbReady();
  const board = await getBoard(ctx.params.id);
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ board });
});

export const PATCH = withAdmin(async (req, ctx) => {
  await ensureDbReady();
  const body = (await readJson(req)) || {};

  // Validate + normalise slug if being set
  if (body.slug !== undefined) {
    if (body.slug === null || body.slug === '') {
      body.slug = null;
    } else {
      const s = String(body.slug).toLowerCase().trim();
      if (!SLUG_PATTERN.test(s)) {
        return NextResponse.json({ error: 'Slug must be 1–60 chars, a–z, 0–9 and hyphens, not starting or ending with a hyphen.' }, { status: 400 });
      }
      if (RESERVED_SLUGS.has(s)) {
        return NextResponse.json({ error: `"${s}" is a reserved word — pick another slug.` }, { status: 400 });
      }
      const clash = await getBoardBySlug(s);
      if (clash && clash.id !== ctx.params.id) {
        return NextResponse.json({ error: `Slug "${s}" is already in use on another board.` }, { status: 409 });
      }
      body.slug = s;
    }
  }

  const board = await updateBoard(ctx.params.id, body);
  return NextResponse.json({ board });
});

export const DELETE = withAdmin(async (_req, ctx) => {
  await ensureDbReady();
  await deleteBoard(ctx.params.id);
  return NextResponse.json({ ok: true });
});
