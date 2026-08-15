// @vitest-environment jsdom
/**
 * 画布头部与全局导航侧栏的余额同步(#932)。
 *
 * 复现:画布顶栏自己的 `refreshBalance`(NorthstarCanvasWorkspace.tsx)只重读自己的
 * `balance` state,从没喊出 `notifyBalanceRefresh()` —— 而全局导航侧栏是这枚共享信号
 * 唯一的订阅者(见 global-navigation.tsx / lib/balance-refresh.ts)。出图/出片结算时,
 * `useCanvasGen` 照常回调 `onBalanceRefresh`,画布头部的数字对了,但侧栏那份订阅从没
 * 被叫醒,停在旧数字直到商家手动刷新整页(#550 同一根因的新发作)。
 *
 * 这里不重新搭一整块 FlowCanvas/@xyflow(那是 northstar-canvas-convergence.test.ts 的
 * 覆盖范围);只把 FlowCanvas 换成一个把 `onBalanceRefresh` 交出来的替身，直接模拟内核
 * 结算时会做的那一次调用，断言两件事同时发生：①画布头部自己的读数刷新，②共享信号真的
 * 传到了一个订阅者（站在全局导航侧栏的位置）—— 一次结算，两块显示同一拍对齐。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyAccount: vi.fn(),
  onBalanceRefresh: { current: null as null | (() => void | Promise<void>) },
}));

vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));

// FlowCanvas itself is the mature kernel covered elsewhere; this file only needs the one
// prop the bug lives on. Capturing it (instead of invoking `useCanvasGen`'s own settle path)
// keeps this test aimed at the seam between the header and the shared signal, not a second
// copy of the kernel's own generation tests.
vi.mock("@/components/canvas/FlowCanvas", () => ({
  default: ({ onBalanceRefresh }: { onBalanceRefresh?: () => void | Promise<void> }) => {
    mocks.onBalanceRefresh.current = onBalanceRefresh ?? null;
    return null;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { NorthstarCanvasWorkspace } = await import("@/components/canvas/NorthstarCanvasWorkspace");
const { subscribeBalanceRefresh } = await import("@/lib/balance-refresh");

const RUNTIME_CONTEXT = {
  projects: [{ id: "p1", name: "Kedai Kopi" }],
  threads: [{ id: "t1", projectId: "p1", title: "Morning shots", updatedAt: "2026-08-01T00:00:00.000Z", pinnedAt: null }],
  activeProjectId: "p1",
  activeThreadId: "t1",
  initialBalance: 1240,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.getMyAccount.mockResolvedValue({ balance: 1180 });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.onBalanceRefresh.current = null;
  vi.clearAllMocks();
});

async function renderWorkspace(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(NorthstarCanvasWorkspace, { runtimeContext: RUNTIME_CONTEXT }));
  });
}

describe("canvas header balance refresh also reaches the global-navigation sidebar (#932)", () => {
  it("shows the pre-settle balance on arrival, from the server-supplied initial value", async () => {
    await renderWorkspace();

    expect(container!.textContent).toContain("1,240 credits");
  });

  it("a settle event updates the header AND wakes a sidebar-style subscriber in the same call", async () => {
    await renderWorkspace();
    expect(mocks.onBalanceRefresh.current).toBeTypeOf("function");

    // Stand in for global-navigation's subscribed `load()` — the only other place a
    // balance renders on this screen.
    const sidebarListener = vi.fn();
    const unsubscribe = subscribeBalanceRefresh(sidebarListener);

    try {
      // The exact call useCanvasGen makes when a hold is placed or a generation resolves.
      await act(async () => {
        await mocks.onBalanceRefresh.current!();
      });

      // ① The shared signal fired — the sidebar's listener would have re-read the ledger too.
      expect(sidebarListener).toHaveBeenCalledTimes(1);
      // ② The header kept its own read and shows the settled number, not the stale mount value.
      expect(mocks.getMyAccount).toHaveBeenCalled();
      expect(container!.textContent).toContain("1,180 credits");
      expect(container!.textContent).not.toContain("1,240 credits");
    } finally {
      unsubscribe();
    }
  });

  it("announces even if its own local read is still in flight (no fragile read can swallow the signal)", async () => {
    await renderWorkspace();
    let resolveAccount: (value: { balance: number }) => void = () => {};
    mocks.getMyAccount.mockReturnValueOnce(new Promise((resolve) => { resolveAccount = resolve; }));

    const sidebarListener = vi.fn();
    const unsubscribe = subscribeBalanceRefresh(sidebarListener);

    try {
      let settled = false;
      const pending = act(async () => {
        await mocks.onBalanceRefresh.current!();
      }).then(() => { settled = true; });

      // The shared signal must not wait on this component's own slow fetch.
      expect(sidebarListener).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      resolveAccount({ balance: 1180 });
      await pending;
    } finally {
      unsubscribe();
    }
  });
});
