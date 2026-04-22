import { NextResponse } from 'next/server';
import { withAdmin, readJson } from '@/lib/guard';
import { ensureDbReady, getBoard, createWidget } from '@/lib/db';
import { findFreeSlot } from '@/lib/placement';

export const POST = withAdmin(async (req, ctx) => {
  await ensureDbReady();
  const body = await readJson(req) || {};
  const board = await getBoard(ctx.params.id);
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  // Place the widget in the first free slot of the requested size.
  // If the user (or our drag UI) sent explicit coords, respect them — but
  // still refuse if they'd overlap an existing widget so a hand-edited
  // payload can't break the no-overlap invariant.
  const desiredColSpan = Math.max(1, Number(body.col_span) || 2);
  const desiredRowSpan = Math.max(1, Number(body.row_span) || 2);
  const slot = findFreeSlot(
    { cols: board.cols, rows: board.rows },
    board.widgets,
    desiredColSpan,
    desiredRowSpan,
  );
  if (!slot) {
    return NextResponse.json({
      error: 'There is no free space on this board for a new widget. Resize or remove a widget first, or switch to a larger grid.',
    }, { status: 409 });
  }

  const widget = await createWidget(ctx.params.id, {
    ...body,
    col_start: slot.col_start,
    row_start: slot.row_start,
    col_span:  slot.col_span,
    row_span:  slot.row_span,
  });
  return NextResponse.json({ widget }, { status: 201 });
});
