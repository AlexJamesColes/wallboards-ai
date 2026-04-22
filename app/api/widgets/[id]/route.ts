import { NextResponse } from 'next/server';
import { withAdmin, readJson } from '@/lib/guard';
import { ensureDbReady, getWidget, getBoard, updateWidget, deleteWidget } from '@/lib/db';
import { hasCollision, fitsBoard } from '@/lib/placement';

export const PATCH = withAdmin(async (req, ctx) => {
  await ensureDbReady();
  const body = await readJson(req) || {};

  // If position/size changed, validate the new rect against the board.
  // Drag-to-move and drag-to-resize only ever send the four position fields,
  // so the cheap collision check runs on those.
  const positionChange = ['col_start', 'row_start', 'col_span', 'row_span'].some(k => body[k] !== undefined);
  if (positionChange) {
    const current = await getWidget(ctx.params.id);
    if (!current) return NextResponse.json({ error: 'Widget not found' }, { status: 404 });
    const board = await getBoard(current.board_id);
    if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

    const next = {
      id:        current.id,
      col_start: body.col_start ?? current.col_start,
      row_start: body.row_start ?? current.row_start,
      col_span:  body.col_span  ?? current.col_span,
      row_span:  body.row_span  ?? current.row_span,
    };
    if (!fitsBoard(next, { cols: board.cols, rows: board.rows })) {
      return NextResponse.json({ error: 'Widget would extend off the board.' }, { status: 409 });
    }
    if (hasCollision(next, board.widgets)) {
      return NextResponse.json({ error: 'That position overlaps another widget.' }, { status: 409 });
    }
  }

  const widget = await updateWidget(ctx.params.id, body);
  return NextResponse.json({ widget });
});

export const DELETE = withAdmin(async (_req, ctx) => {
  await ensureDbReady();
  await deleteWidget(ctx.params.id);
  return NextResponse.json({ ok: true });
});
