// @vitest-environment jsdom
/**
 * frontend-fse-202-billing-refresh —— Billing 正文与侧栏同数（frontend-baseline.md §5 :205，
 * FSE-202；S5 批量裁决 2026-09-12，#1358：「本版修——广播落地时一并刷新 Billing 正文（或正文
 * 与侧栏同源）；复测＝切前台后两处同数、hold 与 spend history 同步」）。
 *
 * 走查现象：同一张 Billing 页上侧栏与正文余额并排差 1 credit —— 切到前台 6 秒内侧栏追上了
 * DB，正文（balance / on hold / spend history）纹丝不动。根因：`BillingPage` 是一次性渲染的
 * server component，FSE-010 那条广播（`lib/balance-refresh.ts`）只驱动了侧栏那颗客户端组件。
 *
 * 修法：`app/billing/BillingLiveRefresh.tsx`——正文订阅与侧栏完全同一份信号
 * （`subscribeBalanceRefresh` 广播 + `visibilitychange`，同一条「只在可见时读」纪律），
 * 触发时用 `router.refresh()` 让 `BillingPage` 自己重新跑一遍已有的服务端读取（balance /
 * on hold / spend history 都在那次重读里，不是被单独补一条）。
 *
 * 挂法照抄 `library-failure-human-copy.test.ts` 的配方（`react-dom/client` 的 `createRoot` +
 * `act`，这个仓库没有 `@testing-library/react`）；`next/navigation` 的 `useRouter` 按同一份
 * 配方 mock；`@/lib/balance-refresh` 用真实模块（不 mock）——这条修法买的正是「正文接上真的
 * 那份信号」，mock 掉它就验不出接线本身。
 *
 * P2-1 复审加固（#1409）加了一道 200ms 尾随合并（组件源码内 `REFRESH_MERGE_MS`），所以这里
 * 全文件用 `vi.useFakeTimers()`：每个断言前先把窗口推过去（`vi.advanceTimersByTime(200)`），
 * 「连发多声只 refresh 一次」与「合并窗口过后才允许下一次」在最后一个 describe 块里单独钉住,
 * 其余用例只是把原有断言改成走完这道窗口。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { BillingLiveRefresh } = await import("@/app/billing/BillingLiveRefresh");
const { notifyBalanceRefresh } = await import("@/lib/balance-refresh");

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

let mounted: { root: Root; container: HTMLDivElement } | null = null;

function mountBillingLiveRefresh(): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(BillingLiveRefresh));
  });
  mounted = { root, container };
}

beforeEach(() => {
  refresh.mockClear();
  setVisibility("visible");
  vi.useFakeTimers();
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("frontend-baseline §5 :205 FSE-202 Billing 正文订阅与侧栏同一份信号", () => {
  it("frontend-baseline §5 :205 FSE-202 前台标签页收到广播就重读 Billing 正文", () => {
    mountBillingLiveRefresh();

    act(() => {
      notifyBalanceRefresh();
    });
    // P2-1:尾随合并窗口,200ms 内不读,窗口过后才真的 refresh 一次。
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("frontend-baseline §5 :205 FSE-202 后台标签页收到广播不重读,回到前台那一下 visibilitychange 才追上", () => {
    setVisibility("hidden");
    mountBillingLiveRefresh();

    act(() => {
      notifyBalanceRefresh();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(refresh).not.toHaveBeenCalled();

    // 切回前台:与侧栏一样,visibilitychange 本身也是一次重读的触发点(走查场景里那 6 秒)。
    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("frontend-baseline §5 :205 FSE-202 卸载之后不再重读(退订生效)", () => {
    mountBillingLiveRefresh();
    act(() => {
      mounted!.root.unmount();
    });
    mounted = null;

    act(() => {
      notifyBalanceRefresh();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("frontend-baseline §5 :205 FSE-202 与侧栏订阅同一组事件、同一条只在可见时读的纪律", () => {
    // 源码扫描:守的是「同一信号」这件事本身,不是把行为断言重复一遍。
    const billingSource = read("app/billing/BillingLiveRefresh.tsx");
    const navSource = read("components/global-navigation.tsx");

    expect(billingSource).toMatch(
      /import\s*\{[^}]*\bsubscribeBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/,
    );
    expect(billingSource).toMatch(/document\.visibilityState === "visible"/);
    expect(billingSource).toMatch(/addEventListener\("visibilitychange"/);
    expect(billingSource).toMatch(/router\.refresh\(\)/);

    // 侧栏那一份没有跟着这一票改过 —— 两处仍然是同一条信号,不是各读各的第二个来源。
    expect(navSource).toMatch(/subscribeBalanceRefresh\(loadIfVisible\)/);
  });

  it("frontend-baseline §5 :205 FSE-202 BillingPage 挂了这颗组件", () => {
    const pageSource = read("app/billing/page.tsx");

    expect(pageSource).toMatch(
      /import\s*\{\s*BillingLiveRefresh\s*\}\s*from\s*["']\.\/BillingLiveRefresh["']/,
    );
    expect(pageSource).toMatch(/<BillingLiveRefresh\s*\/>/);
  });
});

describe("frontend-baseline §5 :205 FSE-202 P2-1 尾随合并(#1409 判官复审加固)", () => {
  it("frontend-baseline §5 :205 FSE-202 P2-1 合并窗口内连发多声广播只 refresh 一次", () => {
    mountBillingLiveRefresh();

    // 一次结算常常连打好几声(reserve / settle / refund),买一个 10 卡 pack 一口气能到
    // 11 声 —— 这里用 5 声模拟那一串,逐声都在窗口内重排同一个计时器。
    act(() => {
      notifyBalanceRefresh();
      notifyBalanceRefresh();
      notifyBalanceRefresh();
      notifyBalanceRefresh();
      notifyBalanceRefresh();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("frontend-baseline §5 :205 FSE-202 P2-1 合并窗口过后再来一声,允许下一次 refresh", () => {
    mountBillingLiveRefresh();

    act(() => {
      notifyBalanceRefresh();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // 上一串已经停了、窗口也已经关掉 —— 下一声是新的一串,该照样触发一次新的 refresh。
    act(() => {
      notifyBalanceRefresh();
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("frontend-baseline §5 :205 FSE-202 P2-1 一串信号中途还没到 200ms 就不该提前 refresh", () => {
    mountBillingLiveRefresh();

    act(() => {
      notifyBalanceRefresh();
    });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
