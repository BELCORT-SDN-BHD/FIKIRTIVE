import { describe, expect, it } from "vitest";
import {
  CANVAS_CARD_GAP,
  CANVAS_SPAWN_ORIGIN,
  canvasBatchFootprint,
  canvasBatchRects,
  canvasBatchSlotOffset,
  canvasRectsOverlap,
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
