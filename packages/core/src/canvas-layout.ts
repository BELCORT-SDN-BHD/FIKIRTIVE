/**
 * canvas-batch-layout — WHERE a canvas card lands. Pure geometry, no spend, no I/O.
 *
 * Two jobs, one file so they cannot drift apart:
 *
 * 1. A batch of images from ONE paid job is laid out as a small grid anchored at the
 *    primary card (`canvasBatchRects`). The same offsets are used by the browser that
 *    optimistically shows the batch and by the WORKER that durably writes it when the paid
 *    job settles (#601) — they used to be two hand-written copies of `(i % 2, i / 2)`.
 *
 * 2. A new card picks the first free slot on the board (`nextCanvasSpawnOrigin`) instead
 *    of counting cards. Counting produced overlapping cards as soon as anything was
 *    deleted or a batch put more than one card on the board, and an overlapped card is
 *    an invisible card the merchant already paid for (#547 A2).
 *
 * 3. A card made FROM another card lands NEXT TO it (`nearestFreeCanvasSlot`). The board-wide
 *    scan is right for a brand-new generation and wrong for a derived one: on a busy board it
 *    put the new video far from the image it was made from, so the merchant had to hunt for
 *    what they had just paid for.
 *
 * 4. Whatever a caller ASKS for, the card it puts down never covers a card that is already
 *    there (`freeCanvasRect`). 1–3 are the rule; this is the rule applied at the moment of the
 *    write, which is the only place every writer passes through (#549).
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

/** How far out from a source card we look for a free spot before giving up. */
export const CANVAS_NEIGHBOUR_RINGS = 4;

export type CanvasNeighbourOptions = {
  /** Grid pitch. Defaults to whichever is wider/taller of the source card and the new card. */
  step?: { x: number; y: number };
  rings?: number;
};

/**
 * The free spot closest to `anchor` — where a card made FROM the anchor card belongs.
 *
 * Candidates sit on a grid centred on the source card and are tried nearest-first, so the new
 * card ends up touching its parent whenever there is room. Ties (the four direct neighbours are
 * all the same distance on a square card) resolve right → below → above → left, the order a
 * reader's eye already follows.
 *
 * Returns null when the whole searched neighbourhood is occupied; the caller then falls back to
 * the board-wide scan rather than this function inventing a far-away spot of its own.
 */
export function nearestFreeCanvasSlot(
  occupied: readonly CanvasRect[],
  anchor: CanvasRect,
  footprint: { w: number; h: number },
  options: CanvasNeighbourOptions = {},
): { x: number; y: number } | null {
  const step = options.step ?? {
    x: Math.max(anchor.w, footprint.w) + CANVAS_CARD_GAP,
    y: Math.max(anchor.h, footprint.h) + CANVAS_CARD_GAP,
  };
  const rings = Math.max(1, Math.floor(options.rings ?? CANVAS_NEIGHBOUR_RINGS));

  const candidates: Array<{ x: number; y: number; distance: number; dx: number; dy: number }> = [];
  for (let dy = -rings; dy <= rings; dy += 1) {
    for (let dx = -rings; dx <= rings; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = anchor.x + dx * step.x;
      const y = anchor.y + dy * step.y;
      // Distance between card centres, so a taller new card is not judged by its top-left corner.
      const cx = x + footprint.w / 2 - (anchor.x + anchor.w / 2);
      const cy = y + footprint.h / 2 - (anchor.y + anchor.h / 2);
      candidates.push({ x, y, distance: cx * cx + cy * cy, dx, dy });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || b.dx - a.dx || b.dy - a.dy);

  for (const candidate of candidates) {
    const rect: CanvasRect = { x: candidate.x, y: candidate.y, w: footprint.w, h: footprint.h };
    if (!occupied.some((existing) => canvasRectsOverlap(rect, existing))) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return null;
}

/**
 * The spot a NEW card may actually take, given what is already on the board (#549).
 *
 * Everything above answers "where should this go?" for one caller who can see the board. This
 * answers the question the DATABASE has to answer, for every caller at once: the requested spot
 * is honoured whenever it is genuinely free — a card made from another card asks to sit beside
 * it, and that is the merchant's own intent — and is moved to the nearest free spot when it is
 * not. It never returns a rectangle that lies on top of an existing card.
 *
 * Why that matters more than tidiness: a card already on the board is usually a picture the
 * merchant PAID for, and a covered card is an unreachable card — the picture underneath cannot
 * be clicked, and keyboard focus lands on it while the eye sees the one on top, so the merchant
 * acts on the wrong card. "New work never buries paid work" is the rule; this is where it holds.
 *
 * A requested rectangle with no usable size or position is returned untouched: nothing can be
 * reasoned about it, and inventing a spot would be a second opinion about a caller's data.
 */
export function freeCanvasRect(
  occupied: readonly CanvasRect[],
  requested: CanvasRect,
): CanvasRect {
  const usable = Number.isFinite(requested.x) && Number.isFinite(requested.y)
    && Number.isFinite(requested.w) && Number.isFinite(requested.h)
    && requested.w > 0 && requested.h > 0;
  if (!usable) return requested;
  if (!occupied.some((rect) => canvasRectsOverlap(requested, rect))) return requested;

  const footprint = { w: requested.w, h: requested.h };
  const beside = nearestFreeCanvasSlot(occupied, requested, footprint);
  if (beside) return { ...beside, ...footprint };
  // The whole neighbourhood is taken — fall back to the board-wide scan rather than let this
  // function invent a spot of its own.
  const origin = nextCanvasSpawnOrigin(occupied, footprint, {
    step: { x: footprint.w + CANVAS_CARD_GAP, y: footprint.h + CANVAS_CARD_GAP },
  });
  return { ...origin, ...footprint };
}
