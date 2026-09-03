/**
 * canvas-fit-padding —— 「Fit to screen」要给固定覆盖层让出多少像素。纯函数,无 I/O,无花费。
 *
 * 病根(Codex 真机走查 QA-CRE-008,2026-09-03,生产构建 1440×900):`fitView` 收到的是一个
 * 标量 `padding: 0.22`,而标量在 React Flow 里的意思是「四边各留 22% 视口」——上下左右对称。
 * 画布上钉着的东西一个都不对称:Otto 当前轮卡在左上(280px 宽)、Otto 输入框在下方正中
 * (实测 620×209)、画布自己的工具条纵列在它上面一条、模式条与缩放簇在右侧。对称留白因此
 * 一边多、一边不够:实测「Fit to screen」之后,一张视频卡 45% 被压在覆盖层底下,点它落在
 * Otto 输入框的披露句上 —— 卡没被选中,上一张图的操作条还留在屏幕上(走查记的正是这一幕)。
 *
 * 为什么是量出来的、不是写死的偏移:这些覆盖层会长高会变宽(输入框附引用、报错;工具条多出
 * 「N selected」一行;对话历史展开)。写死的偏移在它们长大的第一天就重新遮住画。同一个道理
 * 已经在 `lib/canvas-otto-dock.ts` 上用过一次 —— 这里是同一条规矩的第二个消费者。
 *
 * 这个模块只做算术:给它画板的矩形和覆盖层的矩形,它回答四边各要留多少像素。谁去量、量谁,
 * 由 FlowCanvas 用下面这份选择器清单决定。
 */

/** 一个矩形,字段与 `DOMRect` 同名,所以 `getBoundingClientRect()` 可以直接传进来。 */
export type CanvasFitRect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

export type CanvasFitPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * 覆盖层之外还要留的一点空隙。
 *
 * 16px = 已批准 pattern 给覆盖层的画板内缩(`CanvasReference.tsx` 的 `left-4` / `bottom-4`,
 * 生产上 Otto 当前轮卡与画布输入框用的也是这一个数);8px = 覆盖层纵列自己行与行之间的间距
 * (globals.css `.gb .cv-bottom-stack { gap: 8px }`)。两个数都来自现有来源,不是新发明的。
 */
export const CANVAS_FIT_GAP = 24;

/**
 * 画布上「钉住不动」的东西 —— 谁挡住画,谁就在这张单子里。
 *
 * Otto 那三块用的是它们自己已有的记号(`data-canvas-otto-dock` 由 `lib/canvas-otto-dock.ts`
 * 定义并由 Otto 组件贴上;当前轮卡的 `aria-label` 是 e2e 旅程 16 已经在用的那一个;
 * `.otto-chat-header` 是 globals.css 里的真类名),所以这一段不必去改 Otto 自己的文件。
 */
export const CANVAS_FIT_OVERLAY_SELECTORS: readonly string[] = [
  "[aria-label='Otto current turn']",
  "[data-canvas-otto-dock]",
  ".otto-chat-header",
  ".cv-bottom-stack",
  ".cv-mode-rail",
  ".cv-zoom-cluster",
  ".cv-lineage",
];

/** 两边加起来最多吃掉画板的多少 —— 再多就没有地方放画了,`fitView` 会算出负数区域。 */
const MAX_CONSUMED = 0.8;

/**
 * 一个覆盖层贴着哪条边。
 *
 * 四个方向各算「它从那条边往里伸了多少」,再按各自那条轴的画板长度归一化,取最小的一个。
 * 归一化是必要的:左上角那张 280×235 的卡,从上边伸进来 251px、从左边伸进来 296px,只看绝对
 * 值会判给「上」,于是整条上边被抬掉 251px;按比例算,296/1440 < 251/852,判给「左」——
 * 这也正是已批准 pattern 对它的说法(「300px 让开 Otto 在左边留的那一列」)。
 */
function assignEdge(board: CanvasFitRect, overlay: CanvasFitRect): keyof CanvasFitPadding {
  const intrusions: Array<{ edge: keyof CanvasFitPadding; px: number; span: number }> = [
    { edge: "left", px: overlay.right - board.left, span: board.width },
    { edge: "right", px: board.right - overlay.left, span: board.width },
    { edge: "top", px: overlay.bottom - board.top, span: board.height },
    { edge: "bottom", px: board.bottom - overlay.top, span: board.height },
  ];
  let best = intrusions[0]!;
  for (const candidate of intrusions) {
    if (candidate.px / candidate.span < best.px / best.span) best = candidate;
  }
  return best.edge;
}

/** 一个覆盖层从它贴着的那条边往里伸了多少像素。 */
function intrusion(board: CanvasFitRect, overlay: CanvasFitRect, edge: keyof CanvasFitPadding): number {
  if (edge === "left") return overlay.right - board.left;
  if (edge === "right") return board.right - overlay.left;
  if (edge === "top") return overlay.bottom - board.top;
  return board.bottom - overlay.top;
}

/**
 * 四边各留多少像素,才能让「Fit to screen」摆出来的画一寸都不压在覆盖层底下。
 *
 * 与画板不相交的覆盖层不算数(它已经在画板外了);算出来的两边之和被夹在画板的 80% 以内,
 * 免得极矮/极窄的窗口里 `fitView` 拿到一块负面积。
 */
export function canvasFitPadding(
  board: CanvasFitRect,
  overlays: readonly CanvasFitRect[],
  gap: number = CANVAS_FIT_GAP,
): CanvasFitPadding {
  const padding: CanvasFitPadding = { top: gap, right: gap, bottom: gap, left: gap };
  if (!(board.width > 0) || !(board.height > 0)) return padding;

  for (const overlay of overlays) {
    if (!(overlay.width > 0) || !(overlay.height > 0)) continue;
    // 完全在画板之外的东西挡不住任何一张卡。
    if (overlay.right <= board.left || overlay.left >= board.right) continue;
    if (overlay.bottom <= board.top || overlay.top >= board.bottom) continue;
    const edge = assignEdge(board, overlay);
    const reach = Math.ceil(intrusion(board, overlay, edge)) + gap;
    if (reach > padding[edge]) padding[edge] = reach;
  }

  return {
    ...clampAxis(padding.left, padding.right, board.width),
    ...clampAxisY(padding.top, padding.bottom, board.height),
  };
}

function clampAxis(left: number, right: number, width: number): { left: number; right: number } {
  const budget = width * MAX_CONSUMED;
  const total = left + right;
  if (total <= budget) return { left, right };
  const scale = budget / total;
  return { left: Math.floor(left * scale), right: Math.floor(right * scale) };
}

function clampAxisY(top: number, bottom: number, height: number): { top: number; bottom: number } {
  const { left: scaledTop, right: scaledBottom } = clampAxis(top, bottom, height);
  return { top: scaledTop, bottom: scaledBottom };
}

/**
 * 交给 React Flow 的形状 —— **必须带 `px`**。
 *
 * `fitView` 的 padding 里,一个**光秃秃的数字是比例,不是像素**
 * (`@xyflow/system` 的 `parsePadding`:`(viewport - viewport / (1 + padding)) * 0.5`)。
 * 把 `left: 320` 直接递进去,它读成「320 倍视口」,算出来一边就要留 718px,两边加起来把 1440px
 * 的画板吃干净,缩放被夹到 `minZoom`,整块板缩成一排小方块 —— 本次施工中途实测过一次,卡片从
 * 282px 缩到 32px。所以像素单位在这里写死一次,调用方不必再记得。
 */
export type CanvasFitPaddingPx = {
  top: `${number}px`;
  right: `${number}px`;
  bottom: `${number}px`;
  left: `${number}px`;
};

export function canvasFitPaddingPx(padding: CanvasFitPadding): CanvasFitPaddingPx {
  return {
    top: `${padding.top}px`,
    right: `${padding.right}px`,
    bottom: `${padding.bottom}px`,
    left: `${padding.left}px`,
  };
}
