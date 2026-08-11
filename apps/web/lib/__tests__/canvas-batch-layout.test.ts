import { describe, expect, it } from "vitest";
import {
  CANVAS_CARD_GAP,
  CANVAS_SPAWN_ORIGIN,
  canvasBatchFootprint,
  canvasBatchRects,
  canvasBatchSlotOffset,
  canvasRectsOverlap,
  freeCanvasRect,
  nearestFreeCanvasSlot,
  nextCanvasSpawnOrigin,
} from "../canvas-batch-layout";

const CARD = { w: 320, h: 320 };

describe("canvasBatchSlotOffset", () => {
  it("lays a four-image batch out as 2x2 around its primary card", () => {
    expect(canvasBatchSlotOffset(0, CARD)).toEqual({ dx: 0, dy: 0 });
    expect(canvasBatchSlotOffset(1, CARD)).toEqual({ dx: 340, dy: 0 });
    expect(canvasBatchSlotOffset(2, CARD)).toEqual({ dx: 0, dy: 340 });
    expect(canvasBatchSlotOffset(3, CARD)).toEqual({ dx: 340, dy: 340 });
    expect(CANVAS_CARD_GAP).toBe(20);
  });
});

describe("canvasBatchRects", () => {
  it("gives every card of a batch its own non-overlapping rectangle", () => {
    const rects = canvasBatchRects({ x: 80, y: 80, ...CARD }, 4);

    expect(rects).toHaveLength(4);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(canvasRectsOverlap(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });

  it("never returns fewer than one rectangle", () => {
    expect(canvasBatchRects({ x: 0, y: 0, ...CARD }, 0)).toHaveLength(1);
  });
});

describe("canvasBatchFootprint", () => {
  it("reserves the whole grid a batch will occupy", () => {
    expect(canvasBatchFootprint(1, CARD)).toEqual({ w: 320, h: 320 });
    expect(canvasBatchFootprint(2, CARD)).toEqual({ w: 660, h: 320 });
    expect(canvasBatchFootprint(3, CARD)).toEqual({ w: 660, h: 660 });
    expect(canvasBatchFootprint(4, CARD)).toEqual({ w: 660, h: 660 });
  });
});

describe("nextCanvasSpawnOrigin", () => {
  it("puts the first card of an empty board at the board origin", () => {
    expect(nextCanvasSpawnOrigin([], CARD)).toEqual({ x: 80, y: 80 });
    expect(CANVAS_SPAWN_ORIGIN).toEqual({ x: 80, y: 80 });
  });

  it("never lands on top of an existing card", () => {
    const board = [
      { x: 80, y: 80, ...CARD },
      { x: 420, y: 80, ...CARD },
    ];

    const spot = nextCanvasSpawnOrigin(board, CARD);

    expect(board.some((rect) => canvasRectsOverlap({ ...spot, ...CARD }, rect))).toBe(false);
  });

  it("reuses a gap left by a deleted card instead of drifting right forever", () => {
    // The old placement counted cards, so deleting the middle card left a permanent hole
    // AND pushed the next card onto an existing one.
    const board = [
      { x: 80, y: 80, ...CARD },
      { x: 760, y: 80, ...CARD },
    ];

    expect(nextCanvasSpawnOrigin(board, CARD)).toEqual({ x: 420, y: 80 });
  });

  it("finds room for a four-image batch that does not fit between existing cards", () => {
    const board = [
      { x: 80, y: 80, ...CARD },
      { x: 760, y: 80, ...CARD },
    ];

    const spot = nextCanvasSpawnOrigin(board, canvasBatchFootprint(4, CARD), {
      step: { x: CARD.w + CANVAS_CARD_GAP, y: CARD.h + CANVAS_CARD_GAP },
    });

    for (const rect of canvasBatchRects({ ...spot, ...CARD }, 4)) {
      expect(board.some((existing) => canvasRectsOverlap(rect, existing))).toBe(false);
    }
  });

  it("treats edge-to-edge cards as free, not overlapping", () => {
    expect(canvasRectsOverlap({ x: 0, y: 0, ...CARD }, { x: 320, y: 0, ...CARD })).toBe(false);
    expect(canvasRectsOverlap({ x: 0, y: 0, ...CARD }, { x: 319, y: 0, ...CARD })).toBe(true);
  });

  it("still returns a free-looking slot when the whole scanned area is full", () => {
    const board = Array.from({ length: 4 }, (_, i) => ({ x: 80 + i * 340, y: 80, ...CARD }));

    const spot = nextCanvasSpawnOrigin(board, CARD, { columns: 4, rows: 1 });

    expect(board.some((rect) => canvasRectsOverlap({ ...spot, ...CARD }, rect))).toBe(false);
  });
});

/**
 * Where a card made FROM another card lands (round-1 review P2-3).
 *
 * "Make video from this image", "More like this" and an edited prompt all produce a card that
 * belongs beside the card it came from. They used to take the same first-free-slot-on-the-board
 * scan as a brand-new generation, so on a busy board the new card appeared far away — the
 * merchant had to hunt for the thing they just paid for, and the line joining them ran across
 * the whole canvas.
 */
describe("nearestFreeCanvasSlot", () => {
  const SOURCE = { x: 1400, y: 1400, ...CARD };

  it("puts a derived card beside its source, not back at the board origin", () => {
    // The origin end of the board is wide open — a global scan would send this card to (80, 80).
    const board = [SOURCE];

    const spot = nearestFreeCanvasSlot(board, SOURCE, CARD);

    expect(spot).toEqual({ x: 1740, y: 1400 });
    expect(nextCanvasSpawnOrigin(board, CARD)).toEqual({ x: 80, y: 80 });
  });

  it("steps out to the next-closest free spot when the neighbours are taken", () => {
    const board = [
      SOURCE,
      { x: 1740, y: 1400, ...CARD }, // right
      { x: 1400, y: 1740, ...CARD }, // below
      { x: 1400, y: 1060, ...CARD }, // above
    ];

    const spot = nearestFreeCanvasSlot(board, SOURCE, CARD);

    expect(spot).toEqual({ x: 1060, y: 1400 });
    expect(board.some((rect) => canvasRectsOverlap({ ...spot!, ...CARD }, rect))).toBe(false);
  });

  it("never overlaps the source card or anything else, whatever the ring", () => {
    const board = [SOURCE, ...canvasBatchRects({ x: 1060, y: 1060, ...CARD }, 4)];

    const spot = nearestFreeCanvasSlot(board, SOURCE, CARD);

    expect(spot).not.toBeNull();
    expect(board.some((rect) => canvasRectsOverlap({ ...spot!, ...CARD }, rect))).toBe(false);
  });

  it("reserves room for a whole batch, not just one card", () => {
    const board = [SOURCE];
    const footprint = canvasBatchFootprint(4, CARD);

    const spot = nearestFreeCanvasSlot(board, SOURCE, footprint);

    expect(spot).not.toBeNull();
    for (const rect of canvasBatchRects({ ...spot!, ...CARD }, 4)) {
      expect(board.some((existing) => canvasRectsOverlap(rect, existing))).toBe(false);
    }
  });

  it("gives up rather than guessing when everything nearby is full", () => {
    // A completely packed neighbourhood: the caller falls back to the board-wide scan.
    const board = [];
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        board.push({ x: SOURCE.x + dx * 340, y: SOURCE.y + dy * 340, ...CARD });
      }
    }

    expect(nearestFreeCanvasSlot(board, SOURCE, CARD, { rings: 2 })).toBeNull();
  });
});

/**
 * #549 — the rule that runs at the moment a card is written, for every writer at once.
 * The functions above answer "where should this go?" for a caller who can see the board;
 * this one answers "may this go here?" for callers who cannot.
 */
describe("freeCanvasRect", () => {
  const OCCUPIED = { x: 80, y: 80, ...CARD };

  it("keeps a requested spot that is genuinely free", () => {
    const beside = { x: 420, y: 80, ...CARD };

    expect(freeCanvasRect([OCCUPIED], beside)).toEqual(beside);
  });

  it("keeps the spot on an empty board", () => {
    expect(freeCanvasRect([], OCCUPIED)).toEqual(OCCUPIED);
  });

  it("moves a card that would cover an existing one, and lands it beside instead", () => {
    const spot = freeCanvasRect([OCCUPIED], { ...OCCUPIED });

    expect(canvasRectsOverlap(spot, OCCUPIED)).toBe(false);
    expect(spot).toMatchObject(CARD);
    // Nearest-first: the free neighbour, not the far end of the board.
    expect(spot).toEqual({ x: 420, y: 80, ...CARD });
  });

  it("never returns a rectangle that touches anything, however crowded the board", () => {
    const board = [];
    for (let column = 0; column < 5; column += 1) {
      for (let row = 0; row < 5; row += 1) {
        board.push({ x: 80 + column * 340, y: 80 + row * 340, ...CARD });
      }
    }

    const spot = freeCanvasRect(board, { x: 80, y: 80, ...CARD });

    expect(board.some((rect) => canvasRectsOverlap(spot, rect))).toBe(false);
  });

  it("keeps a card of a different size clear of the ones already there", () => {
    const text = { x: 80, y: 80, w: 240, h: 120 };

    const spot = freeCanvasRect([OCCUPIED], text);

    expect(canvasRectsOverlap(spot, OCCUPIED)).toBe(false);
    expect(spot).toMatchObject({ w: 240, h: 120 });
  });

  it("hands back a rectangle it cannot reason about, untouched", () => {
    const nonsense = { x: 0, y: 0, w: 0, h: 0 };

    expect(freeCanvasRect([OCCUPIED], nonsense)).toEqual(nonsense);
  });
});
