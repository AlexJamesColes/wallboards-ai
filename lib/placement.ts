/**
 * Grid placement helpers for board widgets.
 *
 * The board grid is 1-indexed: a widget at col_start=1, row_start=1, col_span=2
 * occupies columns [1, 2] in row 1. A "slot" here is a candidate placement
 * (top-left col + row + width + height) — not a literal cell.
 */

export interface PlacedRect {
  /** Optional widget id; passed when checking against an existing widget so
   *  drag/resize can ignore the widget being moved. */
  id?:        string;
  col_start:  number;
  col_span:   number;
  row_start:  number;
  row_span:   number;
}

export interface BoardSize {
  cols: number;
  rows: number;
}

/** True if two rectangles share any cell. */
export function rectsOverlap(a: PlacedRect, b: PlacedRect): boolean {
  const aColEnd = a.col_start + a.col_span;
  const bColEnd = b.col_start + b.col_span;
  const aRowEnd = a.row_start + a.row_span;
  const bRowEnd = b.row_start + b.row_span;
  // Standard AABB intersection
  return a.col_start < bColEnd && b.col_start < aColEnd
      && a.row_start < bRowEnd && b.row_start < aRowEnd;
}

/** True if `candidate` collides with any other widget on the board. */
export function hasCollision(candidate: PlacedRect, others: PlacedRect[]): boolean {
  return others.some(o => o.id !== candidate.id && rectsOverlap(candidate, o));
}

/** True if the rectangle fits within the board's outer bounds. */
export function fitsBoard(rect: PlacedRect, board: BoardSize): boolean {
  return rect.col_start >= 1
      && rect.row_start >= 1
      && rect.col_start + rect.col_span - 1 <= board.cols
      && rect.row_start + rect.row_span - 1 <= board.rows;
}

/**
 * Find the first free slot on the board that fits a widget of the requested
 * size, scanning row-by-row from the top-left. Returns null if there's no
 * room — the caller should surface an error to the user.
 *
 * If the requested size is bigger than the board itself, falls back to a
 * 1×1 search so a "new widget" still gets placed somewhere visible.
 */
export function findFreeSlot(
  board:    BoardSize,
  existing: PlacedRect[],
  desiredColSpan: number,
  desiredRowSpan: number,
): { col_start: number; row_start: number; col_span: number; row_span: number } | null {
  const tryWith = (colSpan: number, rowSpan: number) => {
    if (colSpan > board.cols || rowSpan > board.rows) return null;
    for (let row = 1; row <= board.rows - rowSpan + 1; row++) {
      for (let col = 1; col <= board.cols - colSpan + 1; col++) {
        const candidate: PlacedRect = {
          col_start: col, col_span: colSpan,
          row_start: row, row_span: rowSpan,
        };
        if (!hasCollision(candidate, existing)) return { ...candidate };
      }
    }
    return null;
  };

  // Try the requested size first
  const requested = tryWith(desiredColSpan, desiredRowSpan);
  if (requested) return requested;

  // Fall back to 1×1 — better to drop something visible the user can resize
  // than to refuse outright when most of the board is already occupied.
  if (desiredColSpan > 1 || desiredRowSpan > 1) {
    const tiny = tryWith(1, 1);
    if (tiny) return tiny;
  }
  return null;
}
