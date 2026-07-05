export const DEFAULT_CANVAS_MEDIA_NODE_SIDE = 320;
export const MIN_CANVAS_MEDIA_NODE_WIDTH = 140;
export const MIN_CANVAS_MEDIA_NODE_HEIGHT = 90;

export type CanvasMediaDimensions = {
  width?: number | null;
  height?: number | null;
};

export type CanvasNodeSize = {
  w: number;
  h: number;
};

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isDefaultCanvasMediaNodeSize(
  size: CanvasNodeSize,
  defaultSide = DEFAULT_CANVAS_MEDIA_NODE_SIDE,
): boolean {
  return (
    positiveFinite(size.w) &&
    positiveFinite(size.h) &&
    Math.abs(size.w - defaultSide) <= 2 &&
    Math.abs(size.h - defaultSide) <= 2
  );
}

export function hasCanvasNodeSizeChanged(
  a: CanvasNodeSize,
  b: CanvasNodeSize,
  epsilon = 0.5,
): boolean {
  return Math.abs(a.w - b.w) > epsilon || Math.abs(a.h - b.h) > epsilon;
}

export function canvasMediaNodeSize(
  media: CanvasMediaDimensions,
  current: CanvasNodeSize,
  defaultSide = DEFAULT_CANVAS_MEDIA_NODE_SIDE,
): CanvasNodeSize {
  if (!isDefaultCanvasMediaNodeSize(current, defaultSide)) return current;
  if (!positiveFinite(media.width) || !positiveFinite(media.height)) return current;

  const ratio = media.width / media.height;
  if (!positiveFinite(ratio)) return current;

  if (ratio >= 1) {
    let h = Math.round(defaultSide / ratio);
    let w = defaultSide;
    if (h < MIN_CANVAS_MEDIA_NODE_HEIGHT) {
      h = MIN_CANVAS_MEDIA_NODE_HEIGHT;
      w = Math.round(h * ratio);
    }
    return { w, h };
  }

  let w = Math.round(defaultSide * ratio);
  let h = defaultSide;
  if (w < MIN_CANVAS_MEDIA_NODE_WIDTH) {
    w = MIN_CANVAS_MEDIA_NODE_WIDTH;
    h = Math.round(w / ratio);
  }
  return { w, h };
}
