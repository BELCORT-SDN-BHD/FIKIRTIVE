/**
 * canvas-batch-layout — WHERE a canvas card lands. Pure geometry, no spend, no I/O.
 *
 * Two jobs, one file so they cannot drift apart:
 *
 * 1. A batch of images from ONE paid job is laid out as a small grid anchored at the
 *    primary card (`canvasBatchRects`). The same offsets are used by the browser that
 *    placed the batch and by the server-side recovery that re-places a batch whose
 *    browser went away — they used to be two hand-written copies of `(i % 2, i / 2)`.
 *
 * 2. A new card picks the first free slot on the board (`nextCanvasSpawnOrigin`) instead
 *    of counting cards. Counting produced overlapping cards as soon as anything was
 *    deleted or a batch put more than one card on the board, and an overlapped card is
 *    an invisible card the merchant already paid for (#547 A2).
 */

export type CanvasRect = { x: number; y: number; w: number; h: number };

/** Gap between neighbouring cards, in board units. Matches the historical 340 = 320 + 20 step. */
export const CANVAS_CARD_GAP = 20;
/** A batch wraps to a new row after this many cards (2×2 for the 4-image maximum). */
export const CANVAS_BATCH_COLUMNS = 2;
/** Where the first card of an empty board goes. */
export const CANVAS_SPAWN_ORIGIN = { x: 80, y: 80 } as const;

/** Offset of the index-th card of a batch from the batch's primary card. */
export function canvasBatchSlotOffset(
  index: number,
  size: { w: number; h: number },
  columns: number = CANVAS_BATCH_COLUMNS,
): { dx: number; dy: number } {
  const cols = Math.max(1, Math.floor(columns));
  const i = Math.max(0, Math.floor(index));
  return {
    dx: (i % cols) * (size.w + CANVAS_CARD_GAP),
    dy: Math.floor(i / cols) * (size.h + CANVAS_CARD_GAP),
  };
}

/** The rectangle a whole batch occupies, so a spawn slot can be reserved for all of it. */
export function canvasBatchFootprint(
  count: number,
  size: { w: number; h: number },
  columns: number = CANVAS_BATCH_COLUMNS,
): { w: number; h: number } {
  const cols = Math.max(1, Math.floor(columns));
  const n = Math.max(1, Math.floor(count));
  const usedCols = Math.min(cols, n);
  const usedRows = Math.ceil(n / cols);
  return {
    w: usedCols * size.w + (usedCols - 1) * CANVAS_CARD_GAP,
    h: usedRows * size.h + (usedRows - 1) * CANVAS_CARD_GAP,
  };
}

/** Every card rectangle of a batch whose primary card sits at `origin`. */
export function canvasBatchRects(
  origin: CanvasRect,
  count: number,
  columns: number = CANVAS_BATCH_COLUMNS,
): CanvasRect[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, index) => {
    const { dx, dy } = canvasBatchSlotOffset(index, origin, columns);
    return { x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h };
  });
}

/** Do two cards overlap? Edge-to-edge touching is not an overlap. */
export function canvasRectsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export type CanvasSpawnOptions = {
  origin?: { x: number; y: number };
  /** Grid pitch. Defaults to one card plus the gap, so slots stay dense. */
  step?: { x: number; y: number };
  columns?: number;
  rows?: number;
};

/**
 * First grid slot whose `footprint` touches nothing already on the board.
 *
 * Scans left→right then top→bottom from the board origin. When the scanned area is full
 * it returns the slot one column past the end rather than stacking on an existing card.
 */
export function nextCanvasSpawnOrigin(
  occupied: readonly CanvasRect[],
  footprint: { w: number; h: number },
  options: CanvasSpawnOptions = {},
): { x: number; y: number } {
  const origin = options.origin ?? CANVAS_SPAWN_ORIGIN;
  const step = options.step ?? {
    x: footprint.w + CANVAS_CARD_GAP,
    y: footprint.h + CANVAS_CARD_GAP,
  };
  const columns = Math.max(1, Math.floor(options.columns ?? 40));
  const rows = Math.max(1, Math.floor(options.rows ?? 40));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const candidate: CanvasRect = {
        x: origin.x + column * step.x,
        y: origin.y + row * step.y,
        w: footprint.w,
        h: footprint.h,
      };
      if (!occupied.some((rect) => canvasRectsOverlap(candidate, rect))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }
  return { x: origin.x + columns * step.x, y: origin.y };
}
