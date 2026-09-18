// @vitest-environment jsdom
/**
 * R3-F27 —— 面板还在把会话取回来的那几秒,不许是一块哑的灰。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5 的 2026-09-18 登记行
 * (Founder 2026-09-18 裁(对谈):修)。现场:
 * `docs/audits/fullstack-staging-2026-09-14/findings-catalog.md` R3-F27 ——
 * 商家批完一单、回到首页想看看跑得怎么样,面板正文空白;那不是加载态、不是错误态,
 * 就是空白(原句:「A merchant checking on a running job in that window sees nothing」)。
 *
 * 病根不在「等」本身(取数就是要时间),在**这一等没有说出口**:骨架下面原来只有一条
 * `sr-only`,屏幕上一个字都没有。同一场等待的另一半 —— 分包还没到时的
 * `ConversationFallback`(`OttoPanelHost.tsx`)—— 一直都是一句看得见的话。两半说同一句,
 * 商家才不会把「还在开」读成「没了」。
 *
 * 红→绿:修之前 `[data-otto-panel-conversation="loading"]` 里那句话挂着 `sr-only`,
 * 这个文件的第一条断言(看得见)读到的是 null。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 这个文件只看「还没取回来」那一态 —— 会话流与前门在这一态下一个都不渲染,
 *  挡住它们只是为了不把整条流式链拖进 jsdom。 */
vi.mock("@/components/otto/OttoChatStream", () => ({ OttoChatStream: () => null }));
vi.mock("@/components/otto/OttoFrontDoor", () => ({ OttoFrontDoor: () => null }));

const { OttoPanelConversation } = await import("@/components/otto/panel/OttoPanelConversation");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WAITING_LINE = "Opening your conversation…";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderLoading(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(OttoPanelConversation, {
    state: { status: "loading" },
    onThreadStarted: () => {},
    onStreamStart: () => {},
    onThreadUpdate: () => {},
    onActiveThreadChange: () => {},
    onPendingFirstSent: () => {},
  })));
  return container;
}

describe("R3-F27 面板取数那几秒要说出口", () => {
  it("R3-F27 — 等待态有一句看得见的话,不是只有 sr-only", async () => {
    const el = await renderLoading();
    const wait = el.querySelector<HTMLElement>('[data-otto-panel-conversation="loading"]')!;

    const visible = [...wait.querySelectorAll<HTMLElement>("*")].find(
      (node) => node.textContent?.trim() === WAITING_LINE && !node.classList.contains("sr-only"),
    );

    expect(visible).toBeDefined();
  });

  it("R3-F27 — 与分包等待那一半说的是同一句话(两半不许各说各的)", async () => {
    // `ConversationFallback` 就在 Host 里,逐字同一句 —— 商家在一次打开里可能先后看到
    // 这两块,换一句话就是换一种说法。
    const host = readFileSync(
      path.join(path.resolve(__dirname, "../.."), "components/otto/panel/OttoPanelHost.tsx"),
      "utf8",
    );

    expect(host).toContain(WAITING_LINE);
  });
});
