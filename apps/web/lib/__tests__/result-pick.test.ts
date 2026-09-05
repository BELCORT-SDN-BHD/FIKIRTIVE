import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { readPick, writePick } from "@/lib/result-pick";

// Use a simple in-memory localStorage mock for jsdom-less environments.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k in store) delete store[k]; },
};
/**
 * 这一整套 apps/web 的 vitest 是 `singleThread`(见 `vitest.config.ts` 里的说明):459 个
 * 文件排队跑在**同一个 globalThis** 上。原写法是
 * `Object.defineProperty(globalThis, "window", { value, writable: true })` —— 漏了
 * `configurable`,它默认 false,于是这个只有 localStorage 的假 window 从这一刻起
 * **永久钉死**在全局上,后面几百个文件都摘不掉。两类后果,全量里都真实发生过:
 *   ① 后面任何 node 环境文件再 `vi.stubGlobal("window", …)`,当场
 *      「Cannot redefine property: window」(`nav-rail-state` / `otto-panel-state`);
 *   ② 后面任何按 `typeof window !== "undefined"` 分流的库(`next/image`、Prisma 客户端、
 *      Next 的 server 模块)都会改走浏览器分支,再撞上这个没有 `location` 的空壳 ——
 *      这就是「单跑绿、全量红」那一家子假红的来源。
 * 改成仓库里其它同类用例的写法:`vi.stubGlobal` + 文件结束还原。
 */
vi.stubGlobal("window", { localStorage: localStorageMock });
afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => localStorageMock.clear());

describe("writePick / readPick", () => {
  it("round-trips an index", () => {
    writePick("gen_abc123", 2);
    expect(readPick("gen_abc123")).toBe(2);
  });

  it("returns null for unknown id", () => {
    expect(readPick("gen_unknown")).toBeNull();
  });

  it("returns null for corrupt storage value", () => {
    store["otto:pick:gen_bad"] = "notanumber";
    expect(readPick("gen_bad")).toBeNull();
  });

  it("overwrites previous pick", () => {
    writePick("gen_xyz", 0);
    writePick("gen_xyz", 3);
    expect(readPick("gen_xyz")).toBe(3);
  });

  /**
   * 存储被禁或写满的浏览器上,`getItem`／`setItem` 自己就抛。这一格只是个方便 ——
   * 判官 #1210 P2-2／P2-3 实测:读侧的这条路与写侧整个都没有钉子,把 try/catch 拆掉
   * 全绿。下面两条各钉一边:抛出来的那一下不许冒到调用方(素材面板)身上。
   */
  it("readPick 在 getItem 直接抛时当作没挑过,自己不抛", () => {
    const getItem = vi.spyOn(localStorageMock, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    try {
      expect(() => readPick("gen_blocked")).not.toThrow();
      expect(readPick("gen_blocked")).toBeNull();
    } finally {
      getItem.mockRestore();
    }
  });

  it("writePick 在 setItem 抛 QuotaExceededError 时吞掉,自己不抛", () => {
    const setItem = vi.spyOn(localStorageMock, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    try {
      expect(() => writePick("gen_full", 2)).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
    // 记不住:下次读回来是「没挑过」,而不是一个半截的值。
    expect(readPick("gen_full")).toBeNull();
  });

  it("isolates picks by id", () => {
    writePick("gen_a", 0);
    writePick("gen_b", 1);
    expect(readPick("gen_a")).toBe(0);
    expect(readPick("gen_b")).toBe(1);
  });
});
