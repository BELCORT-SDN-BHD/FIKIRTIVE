/**
 * #992 (W2-10) —— 导轨的形态状态机与它的存档。
 *
 * 规格:`docs/specs/wave2-shell.md` §5.3。
 *
 * 这个文件只钉纯函数,所以每一条断言都读得出「为什么」而不是「渲染出来长这样」:
 *   ① 一层导轨只有两个数字 —— 240 与 64,别处不许再写第二遍;
 *   ② 存档坏掉不许炸:导轨是每一页都要画的东西,一个坏字节不能换来整页白屏;
 *   ③ 服务端没有 `window` —— 读存档在那里必须是「拿到默认值」,不是抛异常。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NAV_RAIL_STORAGE_KEY,
  RAIL_WIDTH_COLLAPSED,
  RAIL_WIDTH_EXPANDED,
  defaultNavRailState,
  navRailWidth,
  parseNavRailState,
  readNavRailState,
  serializeNavRailState,
  setNavRailCollapsed,
  toggleNavRailCollapsed,
  writeNavRailState,
} from "@/components/navigation/rail/rail-state";

/** 这个套件跑在 node 环境里(没有 window),所以要用 localStorage 的地方自己装一个。 */
function withFakeWindow(store: Map<string, string>, options: { throwOnWrite?: boolean } = {}) {
  const fake = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.throwOnWrite) throw new Error("QuotaExceededError");
        store.set(key, value);
      },
    },
  };
  vi.stubGlobal("window", fake);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("一层导轨,两个数字 (§5.3)", () => {
  it("is 240px with labels and 64px as icons — and nothing in between", () => {
    expect(RAIL_WIDTH_EXPANDED).toBe(240);
    expect(RAIL_WIDTH_COLLAPSED).toBe(64);
    expect(navRailWidth({ collapsed: false })).toBe(RAIL_WIDTH_EXPANDED);
    expect(navRailWidth({ collapsed: true })).toBe(RAIL_WIDTH_COLLAPSED);
  });

  it("starts open, so a merchant sees the name of every section on their first visit", () => {
    expect(defaultNavRailState()).toEqual({ collapsed: false });
  });
});

describe("形态转换", () => {
  it("toggles both ways and never mutates the state handed in", () => {
    const open = defaultNavRailState();
    const shut = toggleNavRailCollapsed(open);

    expect(shut.collapsed).toBe(true);
    expect(open.collapsed).toBe(false);
    expect(toggleNavRailCollapsed(shut).collapsed).toBe(false);
  });

  it("returns the same object when the merchant asks for what they already have", () => {
    const open = defaultNavRailState();

    expect(setNavRailCollapsed(open, false)).toBe(open);
    expect(setNavRailCollapsed(open, true)).not.toBe(open);
    expect(setNavRailCollapsed(open, true).collapsed).toBe(true);
  });
});

describe("存档 (§5.3 —— localStorage,不落库)", () => {
  it("uses the spec's key shape", () => {
    expect(NAV_RAIL_STORAGE_KEY).toBe("fikirtive:nav-rail:v1");
  });

  it("round-trips the merchant's choice", () => {
    expect(parseNavRailState(serializeNavRailState({ collapsed: true }))).toEqual({ collapsed: true });
    expect(parseNavRailState(serializeNavRailState({ collapsed: false }))).toEqual({ collapsed: false });
  });

  it("falls back to the default on every shape of broken value — and never throws", () => {
    const broken = [
      "{ this is not json",
      "",
      "null",
      "[]",
      '"collapsed"',
      "42",
      JSON.stringify({ collapsed: "yes" }),
      JSON.stringify({ collapsed: 1 }),
      JSON.stringify({}),
      null,
      undefined,
    ];

    for (const raw of broken) {
      expect(() => parseNavRailState(raw)).not.toThrow();
      expect(parseNavRailState(raw), `broken value: ${String(raw)}`).toEqual({ collapsed: false });
    }
  });

  it("reads and writes the real key through window.localStorage", () => {
    const store = new Map<string, string>();
    withFakeWindow(store);

    writeNavRailState({ collapsed: true });

    expect(JSON.parse(store.get(NAV_RAIL_STORAGE_KEY)!)).toEqual({ collapsed: true });
    expect(readNavRailState()).toEqual({ collapsed: true });
  });

  it("survives a localStorage that refuses to write (private mode, full quota)", () => {
    const store = new Map<string, string>();
    withFakeWindow(store, { throwOnWrite: true });

    expect(() => writeNavRailState({ collapsed: true })).not.toThrow();
    expect(store.size).toBe(0);
  });

  it("hands back the default on the server, where there is no window at all", () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");

    expect(readNavRailState()).toEqual({ collapsed: false });
    expect(() => writeNavRailState({ collapsed: true })).not.toThrow();
  });
});
