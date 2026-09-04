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
 * 卡顶那条操作条离卡上沿多远 —— 三张卡(Image / Video / Text)的 `NodeToolbar offset` 读的
 * 就是这一个数,所以它在这里只有一份。
 */
export const CANVAS_NODE_TOOLBAR_OFFSET = 22;

/**
 * 操作条自己的高度 —— 一行图标按钮,`cv-node-action-group` 不额外加高(globals.css 只给它
 * 圆角与投影)。来源:`NodeToolbarIconButton` 一律 `size="icon-xs"`,而 `icon-xs` 是
 * `size-8` = 32px(`design-system/primitives/button.tsx` 的 size 变体表)。
 * 生产构建 1440×900 实测同一个数(2026-09-04 探针:操作条 y=18…50,高 32)。
 *
 * 为什么是抄来的常量而不是量出来的:第一次摆板时一张卡都没被选中,屏幕上根本没有操作条可量
 * (`NodeToolbar` 只在选中时渲染)。所以这里只能按已知的按钮尺寸留位置 —— 改了 `icon-xs`
 * 的定义就要回来改这一个数,`__tests__/front-a15-canvas-selection.test.ts` 里照实测抄的那
 * 两个数是这件事的看守。
 */
export const CANVAS_NODE_TOOLBAR_HEIGHT = 32;

/**
 * 操作条从卡的上沿往上伸多少 —— 摆板时上边至少要空出这么多。
 *
 * 病根(本机与 CI 实证 2026-09-04,e2e 旅程 17 第⑤步间歇红):摆板只让开了「钉在画板上的
 * 覆盖层」,没让开**卡自己带的那条操作条**。于是最上面一排卡被摆在离画板上沿只有
 * `CANVAS_FIT_GAP` 的地方,它的操作条(卡上沿往上 22+32=54px)整条伸到画板外面 ——
 * 实测 Download 键落在 y=18…50,而画板从 y=48 才开始、上面那 48px 是应用外壳的顶栏:
 * 操作条被顶栏盖住,商家看不见也点不到(`document.elementFromPoint` 在按钮正中取到的是
 * `<header>`)。所以「让开覆盖层」的清单里必须算上这一条:它和别的覆盖层一样,是画板上
 * 一块不能压卡的地方,只不过它贴的是画板自己的上沿。
 *
 * 同一个 24px 还让旅程 17 的第①步(在卡外面 24px 起手框选)时红时绿:最上排卡摆在 y=72 时,
 * 起手点正落在 y=48 —— 顶栏与画板的那条缝上,按下去有时按在顶栏上,框选就不发生
 * (本机修前 5 次留了记录的预跑全红:3 次红在第⑤步的 Download,2 次红在第①步的框选)。
 * 两处是同一个病根。
 *
 * 卡被商家自己拖到画板顶上时操作条一样会出界 —— 那是另一件事(操作条该翻到卡下面),
 * 不在这一票里。
 */
export const CANVAS_NODE_TOOLBAR_REACH = CANVAS_NODE_TOOLBAR_OFFSET + CANVAS_NODE_TOOLBAR_HEIGHT;

/**
 * 「还没量到画板」时的画板 —— 宽高为 0,`canvasFitPadding` 见到它就只回基础留白。
 *
 * 从前这里的兜底是一个光秃秃的 `0.22`(比例),于是「量不到」的那一次摆板用的是另一套规矩。
 * 一份安全区只能有一个来源,兜底也不例外。
 */
export const CANVAS_FIT_EMPTY_RECT: CanvasFitRect = {
  left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0,
};

/**
 * 画布左上角那张 Otto 卡的记号 —— **两种形态各挂一次**。
 *
 * 画布上的 Otto 有两副面孔:还没开对话时是门厅(`OttoFrontDoor`),开了对话是对话流
 * (`OttoChatStream` 的 `OttoTurnCard`)。两边在左上角画的是同一张卡(都是
 * `absolute left-4 top-4 w-[280px]`,连空态那句话都是同一句),但从前只有对话流那一张带
 * `aria-label="Otto current turn"`。摆板按 `aria-label` 找它,于是**商家还没开口的那一次**
 * 什么也没找到:左边一寸都没让,最上排的卡就摆进这张卡底下。
 *
 * 实证(2026-09-04,生产构建 1440×900,e2e 探针):门厅那张卡占 x=16…296 / y=64…172,
 * 摆板算出的左留白只有 `CANVAS_FIT_GAP`,文字卡落在 x=256 —— 卡的左上角压在卡片底下,
 * 在它外面 24px 起手框选,`elementFromPoint` 取到的是门厅卡的表头(旅程 17 第①步)。
 *
 * 底部输入框早就是这么解决的(`CANVAS_OTTO_DOCK_ATTR`,`lib/canvas-otto-dock.ts`:
 * 「两种画布 Otto 形态各挂一次,所以工作区不必知道当下是哪一种」)—— 左上角这张卡沿用同一条
 * 规矩,而不是让摆板去认两个记号。`aria-label` 留着不动:那是 e2e 旅程 16／18 在用的名字。
 */
export const CANVAS_OTTO_CORNER_ATTR = "data-canvas-otto-corner";

/**
 * 画布上「钉住不动」的东西 —— 谁挡住画,谁就在这张单子里。
 *
 * Otto 那三块用的是它们自己已有的记号(`data-canvas-otto-dock` 由 `lib/canvas-otto-dock.ts`
 * 定义、左上角那张卡由上面这一份定义,两个都由 Otto 组件贴上;`.otto-chat-header` 是
 * globals.css 里的真类名)。
 */
export const CANVAS_FIT_OVERLAY_SELECTORS: readonly string[] = [
  `[${CANVAS_OTTO_CORNER_ATTR}]`,
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
 * 上边的基础留白比别的三边多一条操作条(`CANVAS_NODE_TOOLBAR_REACH`):最上面那排卡的操作条
 * 长在卡的上沿之外,不给它留位置,它就伸到画板外、被应用外壳的顶栏盖住。
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
  if (!(board.width > 0) || !(board.height > 0)) {
    padding.top += CANVAS_NODE_TOOLBAR_REACH;
    return padding;
  }

  for (const overlay of overlays) {
    if (!(overlay.width > 0) || !(overlay.height > 0)) continue;
    // 完全在画板之外的东西挡不住任何一张卡。
    if (overlay.right <= board.left || overlay.left >= board.right) continue;
    if (overlay.bottom <= board.top || overlay.top >= board.bottom) continue;
    const edge = assignEdge(board, overlay);
    const reach = Math.ceil(intrusion(board, overlay, edge)) + gap;
    if (reach > padding[edge]) padding[edge] = reach;
  }

  // 最上面那排卡的操作条长在卡的上沿之外 —— 顶上让开的东西再多,也还要在它之外再空出这一条,
  // 否则操作条不是伸出画板(被顶栏盖住)就是压在顶部的覆盖层底下。
  padding.top += CANVAS_NODE_TOOLBAR_REACH;

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
