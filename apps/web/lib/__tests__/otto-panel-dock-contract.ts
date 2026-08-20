/**
 * 「Dock, don't cover」的机器判定,写一次(#994 判官 r1 P2-1)。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.5 ①,G2 —— 整份规格里唯一一条「不许有」。
 *
 * **为什么不能只看 inline style。** 原来这条判定是 `expect(panel.style.position).toBe("")`。
 * 它测的是「行内没写 position」,而停靠形态的定位**全在 className 里**(`sticky top-0 …`),
 * 加上 jsdom 不加载样式表 —— 于是把 `sticky` 换成 `absolute right-0`(挤当场变盖)之后,
 * 40 条断言一条都不红。一条永远为真的断言比没有断言更坏:它让人以为这里有围栏。
 *
 * 所以判定改成读 class:停靠形态**必须**是 `sticky`,并且**不许**出现 `fixed` / `absolute`。
 * 这三个词就是「脱不脱离文档流」的全部分野 —— `sticky` 仍然占位、仍然把主内容挤窄;
 * 另外两个不占位,主内容不再让开,面板就落到了页面上面。
 *
 * 为什么不用 `getComputedStyle`:jsdom 不跑 Tailwind,算出来的永远是 `static`,
 * 那样这条判定又会变成一条永远为真(或永远为假)的断言。class 是这里唯一有信息的那一层。
 *
 * 不是 `*.test.ts`,vitest 不会收集它;用到的测试自己 import。
 */
import { expect } from "vitest";

/** 脱离文档流的两种定位。停靠形态出现任何一个,就是「盖」而不是「挤」。 */
const OUT_OF_FLOW = /\b(fixed|absolute)\b/;
/** 停靠形态该有的那一个:占位,但页面往下滚时头部不跟着滚走。 */
const STICKY = /\bsticky\b/;

/**
 * 停靠中的面板仍然待在文档流里 —— 它占宽度,所以主内容是被挤窄的,不是被盖住的。
 *
 * @param panel `[data-otto-panel]` 元素,`data-otto-panel-mode="docked"` 时才调。
 */
export function expectDockedStaysInFlow(panel: HTMLElement): void {
  expect(panel.getAttribute("data-otto-panel-mode"), "只有停靠形态适用这条判定").toBe("docked");
  // 行内也不许偷偷写一个 —— class 与 style 两条路都得堵。
  expect(panel.style.position, "停靠形态的行内 position").toBe("");
  expect(panel.className, `停靠形态必须是 sticky:${panel.className}`).toMatch(STICKY);
  expect(panel.className, `停靠形态不许脱离文档流:${panel.className}`).not.toMatch(OUT_OF_FLOW);
}

/**
 * 浮动形态反过来:它**必须**是 `fixed`(自由窗),而且这一形态下主内容不再被挤 ——
 * 但它同样不许遮住主内容(§3.2:半透明边框 + 阴影,下面看得见、点得到)。
 */
export function expectFloatingIsFixed(panel: HTMLElement): void {
  expect(panel.getAttribute("data-otto-panel-mode")).toBe("floating");
  expect(panel.style.position).toBe("fixed");
}
