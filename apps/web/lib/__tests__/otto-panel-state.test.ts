/**
 * #994 (W2-7) — Otto 面板的状态机与它的存档。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.2(拖动语义)、§3.3(持久化)、§7.1。
 *
 * 两条最重要的:
 *  ① 存档在 localStorage,键 `fikirtive:otto-panel:v1`,**坏掉的 JSON 不炸,退默认值**。
 *     面板几何是这台设备的事实,不是这个工作区的事实 —— 所以它不落库,也就没有迁移能救它,
 *     解析这一关必须自己扛住任何垃圾输入。
 *  ② 停靠 ⇄ 浮动的每一次转换都不改商家拖出来的停靠宽度:脱离再吸回,宽度还是那个宽度。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OTTO_PANEL_STORAGE_KEY,
  defaultOttoPanelState,
  dockPanel,
  launcherRect,
  parseOttoPanelState,
  readOttoPanelState,
  reconcileViewport,
  releaseFloatingPanel,
  releaseLauncher,
  serializeOttoPanelState,
  setDockedWidth,
  setFloatingRect,
  setPanelOpen,
  togglePanelOpen,
  undockPanel,
  writeOttoPanelState,
} from "@/components/otto/panel/panel-state";
import { defaultPanelWidth } from "@/components/otto/panel/panel-geometry";

const WIDE = { width: 1440, height: 900 };

function stubStorage(seed: Record<string, string> = {}, overrides: Partial<Storage> = {}) {
  const store: Record<string, string> = { ...seed };
  const localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    ...overrides,
  };
  vi.stubGlobal("window", { localStorage });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultOttoPanelState", () => {
  /**
   * FRONT-A14(Founder 2026-09-04 裁决,取代 Q3-A「首开默认开,之后按存档」——
   * `docs/specs/frontend-baseline.md` §5 2026-09-04 行;`docs/specs/wave2-shell.md`
   * 已归档,原文不动)。触发:Codex 只读走查 QA-CRE-006,存档里记着的旧「开」在别的
   * 商家面上自动弹开,吃掉 Create 极简页半屏。
   *
   * 这个函数只兜「没有可信来源」的那一刻:真的第一次访问,或存档坏了读不出 `open`。
   * 「商家上次留着开着」与「这一页有活动对话」两条覆盖路径不在这个函数里 ——
   * 前者是 `parseOttoPanelState` 读到的存档 `open:true` 原样生效,后者是
   * `OttoPanelShell` 的强开信号(`forceOpenSignal`,§3.3 之外的独立效果),由
   * `OttoPanelHost` 挂载时问一次服务端(`lib/thread-activity.ts` 的
   * `hasPendingPanelThread`;2026-09-04 那一轮的 `?otto=1` 近似已由本轮换成真信号)。
   * 两条都在 `otto-panel-mount.test.ts` 的「默认开合(FRONT-A14)」一组里按真实到访路径钉。
   */
  it("FRONT-A14: 没有可信来源的默认收起(第一次访问,不管视窗多宽)", () => {
    for (const viewport of [WIDE, { width: 375, height: 812 }, { width: 1024, height: 800 }]) {
      expect(defaultOttoPanelState(viewport).open, JSON.stringify(viewport)).toBe(false);
    }
    expect(defaultOttoPanelState(WIDE).mode).toBe("docked");
    expect(defaultOttoPanelState(WIDE).width).toBe(defaultPanelWidth(WIDE.width));
  });

  it("parks the launcher bottom-right, where today's Otto button already sits", () => {
    expect(defaultOttoPanelState(WIDE).launcher).toEqual({ edge: "right", y: 1 });
  });

  it("只压默认,不压能力:商家自己开得起来,而且开完照样存得住", () => {
    const opened = setPanelOpen(defaultOttoPanelState(WIDE), true);
    expect(opened.open).toBe(true);
    expect(parseOttoPanelState(serializeOttoPanelState(opened), WIDE).open).toBe(true);
  });
});

describe("持久化 (§3.3)", () => {
  it("uses the spec's key and nothing else", () => {
    expect(OTTO_PANEL_STORAGE_KEY).toBe("fikirtive:otto-panel:v1");
  });

  it("round-trips the five persisted fields", () => {
    const state = releaseLauncher(
      setDockedWidth(defaultOttoPanelState(WIDE), 480, WIDE),
      { x: 20, y: 400 },
      WIDE,
    );

    expect(parseOttoPanelState(serializeOttoPanelState(state), WIDE)).toEqual(state);
  });

  it("does not persist Expand — it is this moment, not this device", () => {
    const stored = JSON.parse(serializeOttoPanelState(defaultOttoPanelState(WIDE)));

    expect(Object.keys(stored).sort()).toEqual(["float", "launcher", "mode", "open", "width"]);
  });

  it("falls back to defaults on corrupt JSON instead of throwing", () => {
    expect(() => parseOttoPanelState("{not json at all", WIDE)).not.toThrow();
    expect(parseOttoPanelState("{not json at all", WIDE)).toEqual(defaultOttoPanelState(WIDE));
    expect(parseOttoPanelState("null", WIDE)).toEqual(defaultOttoPanelState(WIDE));
    expect(parseOttoPanelState("[1,2,3]", WIDE)).toEqual(defaultOttoPanelState(WIDE));
    expect(parseOttoPanelState('"a string"', WIDE)).toEqual(defaultOttoPanelState(WIDE));
    expect(parseOttoPanelState(null, WIDE)).toEqual(defaultOttoPanelState(WIDE));
  });

  it("repairs a half-written record field by field", () => {
    // width 坏掉不该把 launcher 的位置也一起丢掉。
    const state = parseOttoPanelState(
      JSON.stringify({ mode: "floating", open: false, width: "wide", launcher: { edge: "left", y: 0.4 } }),
      WIDE,
    );

    expect(state.mode).toBe("floating");
    expect(state.open).toBe(false);
    expect(state.width).toBe(defaultPanelWidth(WIDE.width));
    expect(state.launcher).toEqual({ edge: "left", y: 0.4 });
  });

  it("clamps stored geometry that no longer fits this screen", () => {
    const state = parseOttoPanelState(
      JSON.stringify({ mode: "floating", open: true, width: 5000, float: { x: 3000, y: 3000, w: 5000, h: 5000 }, launcher: { edge: "right", y: 9 } }),
      { width: 1024, height: 700 },
    );

    expect(state.width).toBe(512);
    expect(state.float.x + state.float.w).toBeLessThanOrEqual(1024);
    expect(state.float.y + state.float.h).toBeLessThanOrEqual(700);
    expect(state.launcher.y).toBe(1);
  });

  it("reads what it wrote through localStorage", () => {
    const store = stubStorage();
    const state = setDockedWidth(defaultOttoPanelState(WIDE), 500, WIDE);

    writeOttoPanelState(state);

    expect(JSON.parse(store[OTTO_PANEL_STORAGE_KEY]).width).toBe(500);
    expect(readOttoPanelState(WIDE)).toEqual(state);
  });

  it("reads defaults — not an exception — when the stored value is garbage", () => {
    stubStorage({ [OTTO_PANEL_STORAGE_KEY]: "}{" });

    expect(readOttoPanelState(WIDE)).toEqual(defaultOttoPanelState(WIDE));
  });

  it("survives a storage that throws (private mode, quota)", () => {
    stubStorage(
      {},
      {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    );

    expect(readOttoPanelState(WIDE)).toEqual(defaultOttoPanelState(WIDE));
    expect(() => writeOttoPanelState(defaultOttoPanelState(WIDE))).not.toThrow();
  });

  it("returns defaults on the server, where there is no localStorage at all", () => {
    expect(readOttoPanelState(WIDE)).toEqual(defaultOttoPanelState(WIDE));
    expect(() => writeOttoPanelState(defaultOttoPanelState(WIDE))).not.toThrow();
  });
});

describe("停靠 ⇄ 浮动状态机 (§3.2)", () => {
  const docked = setDockedWidth(defaultOttoPanelState(WIDE), 480, WIDE);

  it("dragging the header leaves the dock", () => {
    expect(undockPanel(docked, WIDE).mode).toBe("floating");
  });

  // 落点用字面量算,不用 `DOCK_SNAP_PX` —— 用同一个常数造输入又验结果,阈值改成任何值都还是绿的。
  it("releasing inside the right 48px band comes back to the dock", () => {
    const floating = undockPanel(docked, WIDE);
    const nearRight = { ...floating.float, x: WIDE.width - floating.float.w - 40 };

    expect(releaseFloatingPanel(floating, nearRight, WIDE).mode).toBe("docked");
  });

  it("releasing outside the band stays floating", () => {
    const floating = undockPanel(docked, WIDE);
    const clear = { ...floating.float, x: WIDE.width - floating.float.w - 60 };

    expect(releaseFloatingPanel(floating, clear, WIDE).mode).toBe("floating");
  });

  it("keeps the dragged docked width across detach and re-dock", () => {
    // G3 的那句判定:面板宽度拖过一次,换页仍是那个宽度 —— 中间脱离过也一样。
    const floating = setFloatingRect(undockPanel(docked, WIDE), { x: 100, y: 100, w: 620, h: 700 }, WIDE);
    const back = dockPanel(floating);

    expect(back.mode).toBe("docked");
    expect(back.width).toBe(480);
  });

  it("clamps a floating move into the viewport instead of trusting the pointer", () => {
    const floating = setFloatingRect(undockPanel(docked, WIDE), { x: 9999, y: -500, w: 420, h: 640 }, WIDE);

    expect(floating.float.x + floating.float.w).toBeLessThanOrEqual(WIDE.width);
    expect(floating.float.y).toBeGreaterThanOrEqual(0);
  });
});

describe("reconcileViewport (视窗缩小)", () => {
  it("pulls both the docked width and the floating window back into the smaller screen", () => {
    const wide = setFloatingRect(
      setDockedWidth(undockPanel(defaultOttoPanelState(WIDE), WIDE), 700, WIDE),
      { x: 700, y: 100, w: 700, h: 780 },
      WIDE,
    );

    const small = reconcileViewport(wide, { width: 1024, height: 640 });

    expect(small.width).toBe(512);
    expect(small.float.x + small.float.w).toBeLessThanOrEqual(1024);
    expect(small.float.y + small.float.h).toBeLessThanOrEqual(640);
  });

  it("is a no-op when nothing needs moving", () => {
    const state = defaultOttoPanelState(WIDE);
    expect(reconcileViewport(state, WIDE)).toBe(state);
  });
});

describe("开合与 launcher", () => {
  it("toggles open without losing the mode", () => {
    const floating = setPanelOpen(undockPanel(defaultOttoPanelState(WIDE), WIDE), true);
    const closed = togglePanelOpen(floating);

    expect(closed.open).toBe(false);
    expect(closed.mode).toBe("floating");
    expect(togglePanelOpen(closed).open).toBe(true);
  });

  it("setPanelOpen returns the same object when nothing changes", () => {
    const state = defaultOttoPanelState(WIDE);
    expect(setPanelOpen(state, false)).toBe(state);
  });

  it("snaps a released launcher to an edge and keeps its height", () => {
    const state = releaseLauncher(defaultOttoPanelState(WIDE), { x: 40, y: 300 }, WIDE);

    expect(state.launcher.edge).toBe("left");
    expect(launcherRect(state, WIDE).left).toBe(24);
    expect(launcherRect(state, WIDE).top).toBe(300);
  });
});
