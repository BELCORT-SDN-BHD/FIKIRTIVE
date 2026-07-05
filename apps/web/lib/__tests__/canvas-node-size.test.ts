import { describe, expect, it } from "vitest";
import {
  canvasMediaNodeSize,
  hasCanvasNodeSizeChanged,
  isDefaultCanvasMediaNodeSize,
} from "../canvas-node-size";

describe("canvasMediaNodeSize", () => {
  it("fits portrait media into a true portrait canvas node", () => {
    expect(canvasMediaNodeSize({ width: 1080, height: 1920 }, { w: 320, h: 320 })).toEqual({
      w: 180,
      h: 320,
    });
  });

  it("fits landscape media into a true landscape canvas node", () => {
    expect(canvasMediaNodeSize({ width: 1920, height: 1080 }, { w: 320, h: 320 })).toEqual({
      w: 320,
      h: 180,
    });
  });

  it("leaves square media square", () => {
    expect(canvasMediaNodeSize({ width: 1024, height: 1024 }, { w: 320, h: 320 })).toEqual({
      w: 320,
      h: 320,
    });
  });

  it("does not override a user-resized node", () => {
    expect(canvasMediaNodeSize({ width: 1080, height: 1920 }, { w: 260, h: 360 })).toEqual({
      w: 260,
      h: 360,
    });
  });

  it("keeps the current size until media dimensions are known", () => {
    expect(canvasMediaNodeSize({ width: null, height: 1920 }, { w: 320, h: 320 })).toEqual({
      w: 320,
      h: 320,
    });
  });
});

describe("canvas media size helpers", () => {
  it("detects the default placeholder size", () => {
    expect(isDefaultCanvasMediaNodeSize({ w: 320, h: 320 })).toBe(true);
    expect(isDefaultCanvasMediaNodeSize({ w: 318.5, h: 321.5 })).toBe(true);
    expect(isDefaultCanvasMediaNodeSize({ w: 320, h: 240 })).toBe(false);
  });

  it("uses a small epsilon when comparing node sizes", () => {
    expect(hasCanvasNodeSizeChanged({ w: 320, h: 180 }, { w: 320.2, h: 180.2 })).toBe(false);
    expect(hasCanvasNodeSizeChanged({ w: 320, h: 180 }, { w: 320, h: 181 })).toBe(true);
  });
});
