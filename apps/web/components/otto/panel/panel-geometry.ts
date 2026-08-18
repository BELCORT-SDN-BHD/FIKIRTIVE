/**
 * panel-geometry.ts — 每一个尺寸决定都在这里,而且全是纯函数。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.1–§3.2。
 *
 * 为什么把几何抽成没有 React、没有 DOM 的一层:面板的难点不是画,是「拖到哪、夹到哪、
 * 吸到哪」。这些判断放在事件处理器里就只能靠人手拖着验;放在这里就能被断言钉死
 * (`clampPanelWidth(280) === 320` 这一类),而 React 那层只剩「读指针、调这里、写 state」。
 *
 * 所有函数对同样的输入永远给同样的输出,不读 `window`。视窗尺寸一律**当参数传**,
 * 没有传就用 `FALLBACK_VIEWPORT` —— 服务端渲染那一帧不知道视窗有多大,而首帧必须画得出来。
 */

/** 视窗尺寸。只在调用点从 `window` 读一次,再往下全靠传。 */
export interface Viewport {
  width: number;
  height: number;
}

/** 停靠面板宽度下限:再窄审批卡的金额与按钮就塞不下(§3.1)。 */
export const PANEL_MIN_WIDTH = 320;
/** 停靠面板宽度上限:`min(720px, 50vw)`。 */
export const PANEL_MAX_WIDTH_PX = 720;
export const PANEL_MAX_WIDTH_RATIO = 0.5;

/** 默认停靠宽度:`clamp(360px, 25vw, 560px)`。 */
export const PANEL_DEFAULT_WIDTH_MIN = 360;
export const PANEL_DEFAULT_WIDTH_RATIO = 0.25;
export const PANEL_DEFAULT_WIDTH_MAX = 560;

/** Expand 临时宽度:`min(960px, 60vw)`。不持久化 —— 它是这一刻的事,不是这台设备的事。 */
export const PANEL_EXPANDED_WIDTH_PX = 960;
export const PANEL_EXPANDED_WIDTH_RATIO = 0.6;

/** 左缘缩放手柄的命中区(hover 时视觉加宽,命中区不变)。 */
export const PANEL_RESIZE_HANDLE_PX = 6;

/** 浮动窗尺寸约束:最小 320 × 360,最大 720 × 90vh。 */
export const FLOAT_MIN_WIDTH = 320;
export const FLOAT_MIN_HEIGHT = 360;
export const FLOAT_MAX_WIDTH = 720;
export const FLOAT_MAX_HEIGHT_RATIO = 0.9;

/** 浮动窗右缘落在视窗右缘这么近以内松手 = 吸回停靠。 */
export const DOCK_SNAP_PX = 48;

/** 脱离停靠时把窗体往左推开这么多,免得一松手又立刻被吸回去(> DOCK_SNAP_PX)。 */
export const UNDOCK_OFFSET_PX = 72;

/** launcher 圆形图标直径与它离边缘的留白。 */
export const LAUNCHER_SIZE = 48;
export const LAUNCHER_MARGIN = 24;

/** 没有 `window` 时(SSR 首帧、纯函数测试)假定的视窗。 */
export const FALLBACK_VIEWPORT: Viewport = { width: 1440, height: 900 };

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** 视窗尺寸也可能来自存档或一个还没布局完的窗口,先把它变成一个能算的数。 */
export function normalizeViewport(viewport: Partial<Viewport> | undefined | null): Viewport {
  const width =
    viewport && Number.isFinite(viewport.width) && (viewport.width as number) > 0
      ? (viewport.width as number)
      : FALLBACK_VIEWPORT.width;
  const height =
    viewport && Number.isFinite(viewport.height) && (viewport.height as number) > 0
      ? (viewport.height as number)
      : FALLBACK_VIEWPORT.height;
  return { width, height };
}

/**
 * 停靠宽度上限。
 *
 * 下限优先:视窗窄到 50vw 都不足 320px 时(桌面端几乎见不到,但 devtools 拖窄就会遇到),
 * 宁可让面板占超过一半,也不让审批卡塞不下 —— 塞不下就是读不懂金额,那是钱路问题。
 */
export function maxPanelWidth(viewportWidth: number = FALLBACK_VIEWPORT.width): number {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : FALLBACK_VIEWPORT.width;
  return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH_PX, vw * PANEL_MAX_WIDTH_RATIO));
}

/** `clamp(360px, 25vw, 560px)`,再过一遍上下限。 */
export function defaultPanelWidth(viewportWidth: number = FALLBACK_VIEWPORT.width): number {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : FALLBACK_VIEWPORT.width;
  const preferred = clamp(vw * PANEL_DEFAULT_WIDTH_RATIO, PANEL_DEFAULT_WIDTH_MIN, PANEL_DEFAULT_WIDTH_MAX);
  return clampPanelWidth(preferred, vw);
}

/** 把任意一个宽度(拖出来的、存档里的、坏掉的)夹进 `[320, min(720, 50vw)]`。 */
export function clampPanelWidth(width: number, viewportWidth: number = FALLBACK_VIEWPORT.width): number {
  const max = maxPanelWidth(viewportWidth);
  if (!Number.isFinite(width)) return Math.round(clamp(defaultPanelWidth(viewportWidth), PANEL_MIN_WIDTH, max));
  return Math.round(clamp(width, PANEL_MIN_WIDTH, max));
}

/** Expand 按下时的宽度:`min(960px, 60vw)`,故意越过常规上限 —— 它是临时的。 */
export function expandedPanelWidth(viewportWidth: number = FALLBACK_VIEWPORT.width): number {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : FALLBACK_VIEWPORT.width;
  return Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_EXPANDED_WIDTH_PX, vw * PANEL_EXPANDED_WIDTH_RATIO)));
}

/** 拖左缘:指针的 x 就决定了宽度(面板贴着右缘)。 */
export function widthFromResizePointer(clientX: number, viewportWidth: number = FALLBACK_VIEWPORT.width): number {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : FALLBACK_VIEWPORT.width;
  return clampPanelWidth(vw - clientX, vw);
}

/** 浮动窗的矩形:x/y 是左上角,w/h 是尺寸,全部是 CSS 像素。 */
export interface FloatingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingBounds {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

export function floatingBounds(viewport: Viewport = FALLBACK_VIEWPORT): FloatingBounds {
  const vp = normalizeViewport(viewport);
  return {
    minW: FLOAT_MIN_WIDTH,
    maxW: Math.max(FLOAT_MIN_WIDTH, Math.min(FLOAT_MAX_WIDTH, vp.width)),
    minH: FLOAT_MIN_HEIGHT,
    maxH: Math.max(FLOAT_MIN_HEIGHT, Math.min(vp.height * FLOAT_MAX_HEIGHT_RATIO, vp.height)),
  };
}

/**
 * 把浮动窗夹回可视区 —— 「永不飞出屏幕」这条验收就是这一个函数。
 *
 * 视窗缩小后要重新跑一次:先夹尺寸,再夹位置,顺序反过来会把窗体压在右下角。
 */
export function clampFloatingRect(rect: Partial<FloatingRect>, viewport: Viewport = FALLBACK_VIEWPORT): FloatingRect {
  const vp = normalizeViewport(viewport);
  const bounds = floatingBounds(vp);
  const w = clamp(Number(rect?.w), bounds.minW, bounds.maxW);
  const h = clamp(Number(rect?.h), bounds.minH, bounds.maxH);
  const x = clamp(Number(rect?.x), 0, Math.max(0, vp.width - w));
  const y = clamp(Number(rect?.y), 0, Math.max(0, vp.height - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** 松手时:窗体右缘离视窗右缘 ≤ 48px 就回到停靠。 */
export function shouldDockOnRelease(rect: FloatingRect, viewport: Viewport = FALLBACK_VIEWPORT): boolean {
  const vp = normalizeViewport(viewport);
  return vp.width - (rect.x + rect.w) <= DOCK_SNAP_PX;
}

/** 拖着走的时候画那条 2px 落点提示线,判定与松手用的是同一个函数。 */
export function shouldShowDockHint(rect: FloatingRect, viewport: Viewport = FALLBACK_VIEWPORT): boolean {
  return shouldDockOnRelease(rect, viewport);
}

/** 从停靠脱离:窗体接着停靠时的宽度长出来,并往左让开吸附阈值。 */
export function floatingRectFromDocked(width: number, viewport: Viewport = FALLBACK_VIEWPORT): FloatingRect {
  const vp = normalizeViewport(viewport);
  const w = clamp(width, FLOAT_MIN_WIDTH, floatingBounds(vp).maxW);
  return clampFloatingRect(
    {
      x: vp.width - w - UNDOCK_OFFSET_PX,
      y: LAUNCHER_MARGIN,
      w,
      h: vp.height - LAUNCHER_MARGIN * 2,
    },
    vp,
  );
}

/** 浮动窗八个缩放把手。 */
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export const RESIZE_HANDLE_CURSOR: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/**
 * 拖一个把手:给起始矩形与位移,算出新矩形。
 *
 * 北/西两侧的把手同时改位置与尺寸;尺寸一旦顶到下限,位置就得停住,否则窗体会在
 * 「已经不能再小」的时候继续往右/往下爬 —— 那就是那种拖着拖着窗口自己跑掉的 bug。
 */
export function resizeFloatingRect(
  rect: FloatingRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  viewport: Viewport = FALLBACK_VIEWPORT,
): FloatingRect {
  const vp = normalizeViewport(viewport);
  const bounds = floatingBounds(vp);
  const movesWest = handle.includes("w");
  const movesNorth = handle.includes("n");

  const rawW = handle.includes("e") ? rect.w + dx : movesWest ? rect.w - dx : rect.w;
  const rawH = handle.includes("s") ? rect.h + dy : movesNorth ? rect.h - dy : rect.h;

  const w = clamp(rawW, bounds.minW, bounds.maxW);
  const h = clamp(rawH, bounds.minH, bounds.maxH);
  const x = movesWest ? rect.x + rect.w - w : rect.x;
  const y = movesNorth ? rect.y + rect.h - h : rect.y;

  return clampFloatingRect({ x, y, w, h }, vp);
}

/** launcher 停在哪条边、以及在那条边上的高低。`y` 永远在 `[0, 1]`。 */
export type LauncherEdge = "left" | "right";

export interface LauncherAnchor {
  edge: LauncherEdge;
  y: number;
}

/** launcher 顶边能走的范围。上下各留 24px,免得贴住浏览器边框。 */
function launcherTopRange(viewport: Viewport): { min: number; max: number } {
  const min = LAUNCHER_MARGIN;
  const max = Math.max(min, viewport.height - LAUNCHER_SIZE - LAUNCHER_MARGIN);
  return { min, max };
}

/**
 * 松手 → 吸到最近的左/右边缘,保留高低。
 *
 * `point` 是 launcher 左上角的位置(不是指针位置);判边看的是它的圆心落在哪半边。
 */
export function snapLauncher(
  point: { x: number; y: number },
  viewport: Viewport = FALLBACK_VIEWPORT,
): LauncherAnchor {
  const vp = normalizeViewport(viewport);
  const centreX = Number.isFinite(point?.x) ? point.x + LAUNCHER_SIZE / 2 : vp.width;
  const edge: LauncherEdge = centreX <= vp.width / 2 ? "left" : "right";
  const range = launcherTopRange(vp);
  const span = range.max - range.min;
  const top = Number.isFinite(point?.y) ? point.y : range.max;
  const y = span <= 0 ? 0 : clamp((top - range.min) / span, 0, 1);
  return { edge, y };
}

/** 默认落点:右下角,和今天那颗 `fixed right-4 bottom-4` 的 Otto 按钮同一处。 */
export const DEFAULT_LAUNCHER_ANCHOR: LauncherAnchor = { edge: "right", y: 1 };

/** 存档里的 anchor 也可能是坏的 —— 边不认识、y 是 NaN 或越界,都在这里收口。 */
export function clampLauncherAnchor(anchor: Partial<LauncherAnchor> | undefined | null): LauncherAnchor {
  const edge: LauncherEdge = anchor?.edge === "left" ? "left" : "right";
  const rawY = Number(anchor?.y);
  const y = Number.isFinite(rawY) ? clamp(rawY, 0, 1) : DEFAULT_LAUNCHER_ANCHOR.y;
  return { edge, y };
}

/** anchor → 真正要写进 style 的像素位置。 */
export function launcherPosition(
  anchor: LauncherAnchor,
  viewport: Viewport = FALLBACK_VIEWPORT,
): { left: number; top: number } {
  const vp = normalizeViewport(viewport);
  const safe = clampLauncherAnchor(anchor);
  const range = launcherTopRange(vp);
  const top = range.min + safe.y * (range.max - range.min);
  const left = safe.edge === "left" ? LAUNCHER_MARGIN : Math.max(LAUNCHER_MARGIN, vp.width - LAUNCHER_SIZE - LAUNCHER_MARGIN);
  return { left: Math.round(left), top: Math.round(top) };
}
