/**
 * panel-state.ts — 面板的状态机与它的存档,同样全是纯函数(存取那两个除外)。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.2(拖动语义)、§3.3(持久化)。
 *
 * 状态机只有两个形态:
 *
 *   docked(默认)
 *     ├─ 拖面板头部 → floating
 *     └─ 拖左边缘  → 改宽度(仍是 docked)
 *
 *   floating
 *     ├─ 拖头部 → 移动;八个把手缩放
 *     ├─ 右缘落在视窗右缘 48px 内松手 → docked
 *     └─ 视窗缩小 → 夹回可视区
 *
 * 存 localStorage 不落库:面板几何是**这台设备**的事实,不是这个工作区的事实。13 吋笔电
 * 与 27 吋显示器要的数字不一样;落库会换来一次 schema 改动、一条迁移和一类跨设备打架的新
 * bug,好处是零(§3.3 已向 Founder 说明)。
 */

import {
  DEFAULT_LAUNCHER_ANCHOR,
  FALLBACK_VIEWPORT,
  LAUNCHER_SIZE,
  type FloatingRect,
  type LauncherAnchor,
  type Viewport,
  clampFloatingRect,
  clampLauncherAnchor,
  clampPanelWidth,
  defaultPanelWidth,
  floatingRectFromDocked,
  launcherPosition,
  normalizeViewport,
  shouldDockOnRelease,
  snapLauncher,
} from "./panel-geometry";

export type OttoPanelMode = "docked" | "floating";

export interface OttoPanelState {
  mode: OttoPanelMode;
  open: boolean;
  /** 停靠宽度。浮动时也留着 —— 吸回去要用的就是它。 */
  width: number;
  float: FloatingRect;
  launcher: LauncherAnchor;
}

/** §3.3 的键名。带 `:v1` 是为了将来换形状时能直接换键,而不是就地猜旧值。 */
export const OTTO_PANEL_STORAGE_KEY = "fikirtive:otto-panel:v1";

/**
 * 首开默认**收起**(FRONT-A14,Founder 2026-09-04 裁决,取代 Q3-A「首开默认开,之后按
 * 存档」——`docs/specs/wave2-shell.md` 已归档,原文原样保留,不改;新口径记在
 * `docs/specs/frontend-baseline.md` §5)。
 *
 * 触发:Codex 只读走查 QA-CRE-006 —— 存档里记着上一页留下的「开」,换到另一页(哪怕这一页
 * 商家从没跟 Otto 说过话)面板也跟着自动弹开,在这一面吃掉半屏。Q3-A 那句「开一次是最便宜的
 * 教学」今天已经不成立:面板挂在每一面上,商家早就见过它,不需要再靠首开硬教一次。
 *
 * 这个函数只兜「没有可信来源」的那一刻(真的第一次访问,或存档本身坏了读不出 `open`)——
 * 这两种情况都退**收起**。另外两条覆盖路径都不在这个函数里,各自已经是独立机制、这一票
 * 不用再造一份:
 *   · 商家上次留着开着 —— `parseOttoPanelState` 读到的存档 `open:true` 原样生效,这个
 *     函数根本不会被问到(§3.3 的既有存档语义没动一个字)。
 *   · 这一页有活动对话 —— `OttoPanelShell` 的 `forceOpenSignal`(深链 `?otto=1`)已经是
 *     「盖过存档,这次访问强开」的独立效果,不看这里的默认值。**假设**:「活动对话」取的
 *     就是这个既有的深链信号——面板体的会话数据(`activeThreadId`/消息)本来就要等面板真的
 *     开了才取数(见 `OttoPanelHost.tsx` 顶部),开之前没有更早的信号可读,深链是这套代码
 *     里唯一「这次到访确实带着一个 Otto 会话」的预取信号。
 *
 * 窄屏那条**过渡性**豁免(`PANEL_DEFAULT_OPEN_MIN_WIDTH`,W2-11 删移动层时一并清)因此
 * 也不用留在这里了 —— 默认本来就是收起,不必再单独压一次。
 */
export function defaultOttoPanelState(viewport: Viewport = FALLBACK_VIEWPORT): OttoPanelState {
  const vp = normalizeViewport(viewport);
  const width = defaultPanelWidth(vp.width);
  return {
    mode: "docked",
    open: false,
    width,
    float: floatingRectFromDocked(width, vp),
    launcher: { ...DEFAULT_LAUNCHER_ANCHOR },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把存档里读到的东西变成一个能用的状态。
 *
 * 坏掉的 JSON、被别的脚本写进去的字符串、少了一半字段的旧形状 —— 一律**不抛异常**,
 * 退回默认值,并且逐字段回退:只有 `width` 坏掉时不该把 launcher 的位置也一起丢掉。
 */
export function parseOttoPanelState(raw: string | null | undefined, viewport: Viewport = FALLBACK_VIEWPORT): OttoPanelState {
  const vp = normalizeViewport(viewport);
  const fallback = defaultOttoPanelState(vp);
  if (typeof raw !== "string" || raw.length === 0) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isRecord(parsed)) return fallback;

  const mode: OttoPanelMode = parsed.mode === "floating" ? "floating" : "docked";
  const open = typeof parsed.open === "boolean" ? parsed.open : fallback.open;
  const width =
    typeof parsed.width === "number" && Number.isFinite(parsed.width)
      ? clampPanelWidth(parsed.width, vp.width)
      : fallback.width;
  const float = isRecord(parsed.float)
    ? clampFloatingRect(parsed.float as Partial<FloatingRect>, vp)
    : floatingRectFromDocked(width, vp);
  const launcher = isRecord(parsed.launcher)
    ? clampLauncherAnchor(parsed.launcher as Partial<LauncherAnchor>)
    : fallback.launcher;

  return { mode, open, width, float, launcher };
}

/** 只存 §3.3 那五个字段。Expand 是这一刻的事,故意不进存档。 */
export function serializeOttoPanelState(state: OttoPanelState): string {
  return JSON.stringify({
    mode: state.mode,
    open: state.open,
    width: state.width,
    float: state.float,
    launcher: state.launcher,
  });
}

/**
 * 读存档。没有 `window`(服务端)、localStorage 被禁(隐私模式会直接抛)、值是垃圾 ——
 * 三种情况都只是「拿到默认值」,不是错误。
 */
export function readOttoPanelState(viewport: Viewport = FALLBACK_VIEWPORT): OttoPanelState {
  if (typeof window === "undefined") return defaultOttoPanelState(viewport);
  try {
    return parseOttoPanelState(window.localStorage.getItem(OTTO_PANEL_STORAGE_KEY), viewport);
  } catch {
    return defaultOttoPanelState(viewport);
  }
}

/** 写存档。写不进去(配额满、隐私模式)就算了 —— 面板不能因为记不住而不能用。 */
export function writeOttoPanelState(state: OttoPanelState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OTTO_PANEL_STORAGE_KEY, serializeOttoPanelState(state));
  } catch {
    /* 存档是锦上添花,不是能不能用的前提 */
  }
}

// ── 转换 ──────────────────────────────────────────────────────────────────────
// 每一条都是 (state, …) => state,不改入参。

export function setPanelOpen(state: OttoPanelState, open: boolean): OttoPanelState {
  return state.open === open ? state : { ...state, open };
}

/** `Cmd/Ctrl + J`,以及 launcher 与头部 ✕ 都走这一条。 */
export function togglePanelOpen(state: OttoPanelState): OttoPanelState {
  return { ...state, open: !state.open };
}

/** 拖左边缘。 */
export function setDockedWidth(state: OttoPanelState, width: number, viewport: Viewport = FALLBACK_VIEWPORT): OttoPanelState {
  const next = clampPanelWidth(width, normalizeViewport(viewport).width);
  return next === state.width ? state : { ...state, width: next };
}

/** 拖头部 → 脱离停靠。窗体从停靠时的宽度长出来,位置往左让开吸附阈值。 */
export function undockPanel(state: OttoPanelState, viewport: Viewport = FALLBACK_VIEWPORT): OttoPanelState {
  if (state.mode === "floating") return state;
  return { ...state, mode: "floating", float: floatingRectFromDocked(state.width, viewport) };
}

/** 吸回停靠。停靠宽度保持商家上次拖出来的那个数,不被浮动窗的宽度覆盖。 */
export function dockPanel(state: OttoPanelState): OttoPanelState {
  return state.mode === "docked" ? state : { ...state, mode: "docked" };
}

/** 浮动时拖着走 / 缩放:只更新矩形,永远夹在可视区内。 */
export function setFloatingRect(state: OttoPanelState, rect: Partial<FloatingRect>, viewport: Viewport = FALLBACK_VIEWPORT): OttoPanelState {
  return { ...state, mode: "floating", float: clampFloatingRect(rect, viewport) };
}

/** 松手:够近就回停靠,否则留在浮动。判定与提示线用的是同一个几何函数。 */
export function releaseFloatingPanel(
  state: OttoPanelState,
  rect: Partial<FloatingRect>,
  viewport: Viewport = FALLBACK_VIEWPORT,
): OttoPanelState {
  const clamped = clampFloatingRect(rect, viewport);
  if (shouldDockOnRelease(clamped, viewport)) {
    return { ...state, mode: "docked", float: clamped };
  }
  return { ...state, mode: "floating", float: clamped };
}

/** launcher 松手 → 吸到最近的边。`point` 是图标左上角。 */
export function releaseLauncher(
  state: OttoPanelState,
  point: { x: number; y: number },
  viewport: Viewport = FALLBACK_VIEWPORT,
): OttoPanelState {
  return { ...state, launcher: snapLauncher(point, viewport) };
}

/**
 * 视窗变了(拖窗口、转屏、开 devtools)。三样东西一起重新夹:停靠宽度、浮动矩形、
 * launcher 的落点 —— 少夹一样就是「永不飞出屏幕」漏一个口。
 */
export function reconcileViewport(state: OttoPanelState, viewport: Viewport = FALLBACK_VIEWPORT): OttoPanelState {
  const vp = normalizeViewport(viewport);
  const width = clampPanelWidth(state.width, vp.width);
  const float = clampFloatingRect(state.float, vp);
  // launcher 的 anchor 本来就是比例,视窗变了它自己会跟着走;只需要确认它仍在合法区间。
  const launcher = clampLauncherAnchor(state.launcher);
  if (width === state.width && launcher.edge === state.launcher.edge && launcher.y === state.launcher.y &&
      float.x === state.float.x && float.y === state.float.y && float.w === state.float.w && float.h === state.float.h) {
    return state;
  }
  return { ...state, width, float, launcher };
}

/** launcher 当前该画在哪(给 React 那层用,免得它自己再算一遍)。 */
export function launcherRect(state: OttoPanelState, viewport: Viewport = FALLBACK_VIEWPORT): { left: number; top: number; size: number } {
  return { ...launcherPosition(state.launcher, viewport), size: LAUNCHER_SIZE };
}
