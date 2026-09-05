/**
 * canvas-single-conversation —— 一张画布就是它那一条按时间的 Conversation。
 *
 * 规格：`docs/specs/frontend-baseline.md` 验收 **FRONT-A15**（画布控件与已批准的设计一致）。
 * 触发＝Codex 只读走查 **QA-CRE-FE9-005**（P1，Stage 7）：画布上按 `New conversation` 会清掉
 * 当前 thread 并把它从 URL 上摘掉，而画布**没有 thread list / switcher** —— 于是旧对话
 * 「写得进、找不回」，只能靠浏览器 Back。Founder 2026-09-04 07:05 裁决：beta 先收掉这颗键，
 * 多对话切换列表登记下一轮。
 *
 * 这一份读的是**真源码的形状**，而且是逐块读，不是整文件 grep：
 *   · 画布那一支（`canvasLayout ?` 之后的 dock header）里不许再有这颗键；
 *   · 侧栏那一支必须**照旧**有 —— 那一面有自己的 `OttoThreadList`，旧对话找得回，
 *     所以这次收的是画布，不是把能力一刀切掉（切掉了这条断言会红）；
 *   · 画布那两处接线（`CanvasOttoOverlay`、`NorthstarCanvasWorkspace`）不许再传这个 prop，
 *     免得留下一个传进去没人用的死参数。
 *
 * 真浏览器那一头由既有旅程守着（`e2e/journeys/14-canvas-toolbar-reachable.spec.ts` 直接操作
 * 这个 dock header，`16-otto-canvas-seam.spec.ts` / `17-canvas-selection.spec.ts` 走画布）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.join(WEB_ROOT, file), "utf8");

/**
 * 把 `OttoChatStream` 那个 header 的两支切出来。
 *
 * 判据必须只看**画布那一支**：整文件 grep 会被侧栏那一支的同名按钮骗过去（它该在，也确实在），
 * 于是「画布收掉了没有」这件事就永远测不出来。
 */
function headerBranches(): { canvas: string; sidebar: string } {
  const stream = source("components/otto/OttoChatStream.tsx");
  // 锚点用 dock 自己那个独一份的 className —— 文件里 `{canvasLayout ? (` 不止一处，
  // 从第一处切会把别的块一起圈进来，判据就假了。
  const CANVAS_DOCK = 'className="otto-chat-header pointer-events-auto';
  const dock = stream.indexOf(CANVAS_DOCK);
  expect(dock, "OttoChatStream 里应该有画布那条 dock header").toBeGreaterThan(-1);
  const split = stream.indexOf("\n      ) : (", dock);
  expect(split, "画布 header 分支应该有 else 支").toBeGreaterThan(dock);
  const end = stream.indexOf("\n      )}", split);
  expect(end, "画布 header 分支应该收口").toBeGreaterThan(split);
  return { canvas: stream.slice(dock, split), sidebar: stream.slice(split, end) };
}

describe("FRONT-A15 —— 画布上没有 New conversation，一张画布一条对话", () => {
  it("FRONT-A15: 画布的 dock header 里没有 New conversation 控件", () => {
    const { canvas } = headerBranches();

    expect(canvas).not.toContain("New conversation");
    expect(canvas).not.toContain("onNewConversation");
    expect(canvas).not.toContain("MessageSquarePlus");
    // 这一支该有的东西还在：可折叠的 Conversation 与它的条数。
    expect(canvas).toContain("Conversation");
    expect(canvas).toContain("canvasHistoryOpen");
  });

  it("FRONT-A15: 侧栏那一支照旧有 New conversation —— 收的是画布，不是把能力一刀切掉", () => {
    const { sidebar } = headerBranches();

    expect(sidebar).toContain("New conversation");
    expect(sidebar).toContain("onNewConversation");
    // 侧栏找得回旧对话，靠的就是它自己那份列表 —— 这才是画布与它的区别。
    expect(source("components/otto/panel/OttoPanelConversation.tsx")).toContain("onNewConversation");
    expect(source("components/otto/panel/OttoThreadList.tsx").length).toBeGreaterThan(0);
  });

  it("FRONT-A15: 画布那两处接线不再传 onNewConversation —— 不留传进去没人用的死参数", () => {
    expect(source("components/canvas/CanvasOttoOverlay.tsx")).not.toContain("onNewConversation");
    expect(source("components/canvas/NorthstarCanvasWorkspace.tsx")).not.toContain("onNewConversation");
  });
});
