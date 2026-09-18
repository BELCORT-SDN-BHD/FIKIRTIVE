/**
 * R3-F28 围栏（另一半）—— 对话那两条 effect 的**依赖表**不许再长出第三项。
 *
 * 为什么这道围栏要存在。R3-F28 的第二刀只修了画布这一侧：把交给对话的回调钉成稳定身份
 * （`components/canvas/NorthstarCanvasWorkspace.tsx`、`components/canvas/CanvasOttoOverlay.tsx`），
 * 由 `canvas-seam-callback-stability-r3f28.test.ts` 逐条钉住。可这道接缝是两头的：只要
 * `components/otto/OttoChatStream.tsx` 那两条 effect 的依赖表里混进第四个、第五个每渲染都换
 * 身份的值（一个行内箭头、一个现建的数组或对象），上游钉得再稳也白钉 —— 而那一天所有行为
 * 测试照样全绿，因为多一项依赖不改变任何一次渲染的产出，只是把 effect 重新上膛。
 *
 * 这两条 effect 特殊在：它们都**回头改画布这一层的 state**（一条把「这条对话有没有付费任务
 * 在跑」报回画板，一条消化画板刚递过来的引用）。依赖每渲染都换 ⇒ effect 每渲染都重跑 ⇒ 每次
 * 都 setState —— 就是 React 自己那句 "Maximum update depth exceeded ... one of the dependencies
 * changes on every render"（生产构建 `Minified React error #185`）的形状。
 *
 * 所以用**源码扫描**：这不是行为缺陷，是形状缺陷，只有读源码拦得住（与
 * `save-failed-copy-single-source.test.ts` 同一条路数）。这道围栏**不动**
 * `OttoChatStream.tsx` 一个字，它只是站在门口数依赖。
 *
 * 红→绿演练（实做，做完还原）：往任一依赖表里加一项（例如 `thread`）⇒ 对应那条当场红并把
 * 读到的整张依赖表打印出来。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const CHAT_STREAM = "components/otto/OttoChatStream.tsx";

const src = fs.readFileSync(path.join(WEB_ROOT, CHAT_STREAM), "utf8");

/**
 * 读「这句调用所在的那条 effect」的依赖表。
 *
 * 按行号钉会在别人上面插一行的那天变成假绿，所以锚点是那句调用本身（全文各只出现一次，
 * 下面第一条断言就是在钉这一点），依赖表取它之后**最近**的那个 `}, [...]);`。
 */
function depsOfEffectEndingWith(marker: string): string[] {
  const at = src.indexOf(marker);
  expect(at, `${CHAT_STREAM} 里找不到这句调用：${marker}`).toBeGreaterThan(-1);
  expect(src.indexOf(marker, at + 1), `这句调用出现了不止一次，锚点不再唯一：${marker}`).toBe(-1);
  const closing = /\n\s*\}, \[([^\]]*)\]\);/.exec(src.slice(at));
  expect(closing, `这句调用后面没有跟着一条 useEffect 的依赖表：${marker}`).not.toBeNull();
  return closing![1]!.split(",").map((entry) => entry.trim()).filter(Boolean);
}

describe("R3-F28 · 对话那两条回调 effect 的依赖表", () => {
  it("「报告这条对话有没有付费任务在跑」那条只依赖 generationActive 与那个回调本身", () => {
    expect(
      depsOfEffectEndingWith("onGenerationActivityChange?.(generationActive);"),
      "依赖表变了：多一项每渲染都换身份的值，画布那一侧钉稳的回调就白钉了（R3-F28 第二刀）",
    ).toEqual(["generationActive", "onGenerationActivityChange"]);
  });

  it("「消化画板递过来的引用」那条只依赖 composerReferences 与那个回调本身", () => {
    expect(
      depsOfEffectEndingWith("onComposerReferencesConsumed?.(incoming.map"),
      "依赖表变了：多一项每渲染都换身份的值，画布那一侧钉稳的回调就白钉了（R3-F28 第二刀）",
    ).toEqual(["composerReferences", "onComposerReferencesConsumed"]);
  });
});
