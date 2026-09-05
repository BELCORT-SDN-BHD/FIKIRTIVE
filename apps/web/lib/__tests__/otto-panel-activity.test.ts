// @vitest-environment jsdom
/**
 * FRONT-A14 —— 侧栏面板展开信号的**客户端这一侧**,直接测(#1200 判官 P2-3)。
 *
 * 规格:`docs/specs/frontend-baseline.md` §5(FRONT-A14)。
 *
 * 这一层今天只有两句承诺,而在这个文件之前它们一条测试都没有,全靠上游那条真库测试
 * (`otto-panel-expand-signal.test.ts`,测的是服务端判据)间接照到:
 *   ① **读不到就当「没有」** —— 网络断、401、答的不是 JSON,一律 `false`。面板是随处
 *      可见的一层壳,它的展开信号读不出来只该让面板保持收起,不该把商家正在看的那一页
 *      也一起带走。
 *   ② **客户端一个参数都不传** —— 尤其没有 `ownerId`:租户只信服务端 principal
 *      (`requireOwner()`)。这一条是拿真实的请求 URL 断言的,不是读代码。
 *
 * 外加这一轮新增的第三句:**商家自己关过面板,这一程就不再自动展开**(判官 P2-4)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  OTTO_PANEL_DISMISSED_KEY,
  fetchPanelThreadPending,
  panelDismissedThisSession,
  rememberPanelDismissed,
} from "../otto-panel-activity";

/** 装一个假的 `fetch`,把它收到的 URL 与 init 留下来给断言。 */
function stubFetch(impl: (url: string, init?: RequestInit) => unknown): { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  });
  return { calls };
}

function jsonResponse(body: unknown, ok = true): unknown {
  return { ok, json: async () => body };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FRONT-A14 展开信号:客户端这一次读", () => {
  it("FRONT-A14 — 问的是 /api/otto/thread-activity,一个参数都不带(尤其没有 ownerId)", async () => {
    const stub = stubFetch(() => jsonResponse({ pending: true }));

    await fetchPanelThreadPending();

    expect(stub.calls).toHaveLength(1);
    // 逐字:带上任何 query 都算破契约 —— project 与租户都由服务端 principal 决定。
    expect(stub.calls[0].url).toBe("/api/otto/thread-activity");
    expect(stub.calls[0].url).not.toContain("?");
    expect(stub.calls[0].url.toLowerCase()).not.toContain("ownerid");
    // 展开信号是「此刻」的判断,不能吃缓存里的旧答案。
    expect(stub.calls[0].init?.cache).toBe("no-store");
  });

  it("FRONT-A14 — 服务端说 pending:true 才算「有」", async () => {
    stubFetch(() => jsonResponse({ pending: true }));

    expect(await fetchPanelThreadPending()).toBe(true);
  });

  it("FRONT-A14 — pending 是 false、缺这一格、或者根本不是对象,都读成「没有」", async () => {
    stubFetch(() => jsonResponse({ pending: false }));
    expect(await fetchPanelThreadPending()).toBe(false);

    stubFetch(() => jsonResponse({}));
    expect(await fetchPanelThreadPending()).toBe(false);

    stubFetch(() => jsonResponse(null));
    expect(await fetchPanelThreadPending()).toBe(false);

    // 「pending: "true"」是一个字符串,不是那一格契约说的布尔。
    stubFetch(() => jsonResponse({ pending: "true" }));
    expect(await fetchPanelThreadPending()).toBe(false);
  });

  it("FRONT-A14 — 读失败一律当「没有」:非 2xx、网络断、答的不是 JSON,都不抛", async () => {
    stubFetch(() => jsonResponse({ error: "Not authorized." }, false));
    expect(await fetchPanelThreadPending()).toBe(false);

    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchPanelThreadPending()).toBe(false);

    stubFetch(() => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    }));
    expect(await fetchPanelThreadPending()).toBe(false);
  });

  it("FRONT-A14 — 卸载时的取消信号原样交给 fetch", async () => {
    const stub = stubFetch(() => jsonResponse({ pending: true }));
    const controller = new AbortController();

    await fetchPanelThreadPending(controller.signal);

    expect(stub.calls[0].init?.signal).toBe(controller.signal);
  });
});

describe("FRONT-A14 商家自己关过面板就不再自动展开(判官 P2-4)", () => {
  it("FRONT-A14 — 没关过时是 false,关过之后这一程都是 true", () => {
    expect(panelDismissedThisSession()).toBe(false);

    rememberPanelDismissed();

    expect(panelDismissedThisSession()).toBe(true);
    // 记号存 sessionStorage:寿命是这一个标签页这一程,不写进 localStorage 跨天生效。
    expect(window.sessionStorage.getItem(OTTO_PANEL_DISMISSED_KEY)).toBe("1");
    expect(window.localStorage.getItem(OTTO_PANEL_DISMISSED_KEY)).toBeNull();
  });

  it("FRONT-A14 — sessionStorage 用不了(隐私模式会直接抛)时不炸,当「没关过」", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("The operation is insecure.");
      },
    });

    try {
      expect(() => rememberPanelDismissed()).not.toThrow();
      expect(panelDismissedThisSession()).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });
});
