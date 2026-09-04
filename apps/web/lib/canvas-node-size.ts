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

/**
 * 一张已经停下来、又没有画面可量的卡该占多大(FRONT-A15)。
 *
 * 病根(Codex 真机走查 QA-CRE-008):`canvasMediaNodeSize` 只有在**量得到媒体**时才把默认的
 * 320×320 正方形收成媒体的比例。失败／取消／超时／找不到的卡永远没有媒体可量,于是它就一直
 * 是那个正方形 —— 实测同一块板上,一张失败卡 320×320,旁边两张出好的卡 320×180,失败卡高出
 * 78%,把工作区往覆盖层里顶。
 *
 * 已批准的设计夹具没有给失败卡另外一个尺寸(`CanvasReference.tsx` 里失败只是画面上的一层
 * 覆盖,卡还是那张卡的宽高),所以这里按派工书的兜底口径办:**和这块板上正常卡一样的外形**。
 * 【假设】正常卡取 16:9 —— 走查那块板上两张出好的图/视频量出来都是 320×180,而 180 是从既有的
 * `DEFAULT_CANVAS_MEDIA_NODE_SIDE` 算出来的,不是另写一个数。若 Founder 要另一个失败卡外形,
 * 改这一个函数即可,不必再翻组件。
 */
export const TERMINAL_CANVAS_NODE_RATIO = 16 / 9;

export function canvasTerminalNodeSize(
  current: CanvasNodeSize,
  defaultSide = DEFAULT_CANVAS_MEDIA_NODE_SIDE,
): CanvasNodeSize {
  // 商家自己拖过尺寸的卡不动 —— 与 `canvasMediaNodeSize` 同一条规矩。
  if (!isDefaultCanvasMediaNodeSize(current, defaultSide)) return current;
  const h = Math.max(MIN_CANVAS_MEDIA_NODE_HEIGHT, Math.round(defaultSide / TERMINAL_CANVAS_NODE_RATIO));
  return { w: defaultSide, h };
}
