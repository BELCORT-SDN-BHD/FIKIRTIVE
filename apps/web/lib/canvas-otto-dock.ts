/**
 * 画布底部那一根纵列要为 Otto 输入框让出多少高度 —— **只有这一份**。
 *
 * 病根(2026-09-03 Founder 六面走查 D1):画布底部有两样东西钉在同一个角落。一样是
 * FlowCanvas 自己的工具条纵列(`.cv-bottom-stack`,z-index 5,`bottom: 20px`),另一样是
 * Otto 覆盖层(`absolute inset-0`,z-index 30)里那个 `bottom-4` 的输入框。输入框那条
 * block-end 附加栏(Attach / Enter to send / Send)本身可点,于是它把所有瞄准下面工具的
 * 指针全接走了:1280×800、1440×900、1440×1024、1920×1080 四个视口上,八颗工具按钮中心的
 * `elementFromPoint()` 返回的都是那条附加栏。处理函数一个没坏,商家就是碰不到它们。
 *
 * 为什么不是「把工具条透过去」:`pointer-events: none` 只会把不可点的那一块换成 Otto 输入框
 * 自己的某一块 —— 缺陷换个人受,不是修好。
 *
 * 为什么是一个量出来的数、不是一个写死的偏移:Otto 输入框会长高(附引用、贴图片、报错),
 * 写死的偏移在它长高的第一天就重新盖住工具条。这里量的是**画布底边到输入框顶边**的距离,
 * 所以 `bottom-4` 那 16px 内缩和输入框自己的高度一起被算进去,谁改了哪一样都不用同步。
 *
 * 谁写、谁读:`NorthstarCanvasWorkspace` 是唯一同时挂着 FlowCanvas 与 Otto 覆盖层的地方,
 * 由它把这个数写成 `<main>` 上的 CSS 变量;`.gb .cv-bottom-stack` 读它。变量没被写(画布
 * 在没有 Otto 覆盖层的场合渲染)时回落 `0px`,版式与今天一字不差。
 */

/** `<main>` 上那个变量的名字 —— 写的一侧与 globals.css 读的一侧钉同一份字面量。 */
export const CANVAS_OTTO_DOCK_VAR = "--cv-otto-dock";

/** Otto 画布输入框那一块的记号。两种画布 Otto 形态(未开对话的门厅、已开对话的对话流)
 *  各挂一次,所以工作区不必知道当下是哪一种。 */
export const CANVAS_OTTO_DOCK_ATTR = "data-canvas-otto-dock";

/**
 * 画布底边到 Otto 输入框顶边的距离,像素、向上取整到整数。
 *
 * 负数会被夹回 0:输入框在极矮视口里可能被推到画布底边以下,那时该让的高度是 0,而不是把
 * 工具条往下推出画布(推出去就等于又点不到了)。
 */
export function canvasOttoDockPx(
  surface: { readonly bottom: number },
  dock: { readonly top: number },
): number {
  return Math.max(0, Math.round(surface.bottom - dock.top));
}
