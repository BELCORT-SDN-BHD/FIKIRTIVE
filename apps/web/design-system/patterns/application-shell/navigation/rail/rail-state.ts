/**
 * rail-state.ts —— 左导轨的形态与它的存档。全是纯函数(存取那两个除外)。
 *
 * 规格:`docs/specs/wave2-shell.md` §5.3。
 *
 * 导轨只有**一层**:240px 带标签,商家可以手动收成 64px 图标。今天那套「按宽度自动换形态」
 * (`lg:` 图标 / `xl:` 标签 + 1024–1279px 的横向页签兜底)不在这里重写 —— 它制造的分叉正是
 * 这一票要终结的东西:同一份导航在三个宽度上长成三种样子,每一种都要自己的高亮规则、自己的
 * 分组展开法、自己的一份测试。宽度不再决定形态,**商家**决定形态。
 *
 * 存 localStorage 不落库,与面板同理(§3.3 已向 Founder 说明):导轨宽窄是**这台设备**的
 * 事实,不是这个工作区的事实。13 吋笔电上收起来,27 吋显示器上摊开,是同一个人的两个正确
 * 选择;落库只会让它们互相打架,还要换来一次 schema 改动和一条迁移。
 */

/** 带标签的那一层。 */
export const RAIL_WIDTH_EXPANDED = 240;
/** 商家自己收起来之后的那一层:只剩图标。 */
export const RAIL_WIDTH_COLLAPSED = 64;

/**
 * 存档键。带 `:v1` 与面板同一个理由:将来换形状时直接换键,而不是就地猜旧值该怎么读。
 */
export const NAV_RAIL_STORAGE_KEY = "fikirtive:nav-rail:v1";

export interface NavRailState {
  /** true = 64px 图标层。默认 false —— 第一次进来看得见每一格的名字。 */
  collapsed: boolean;
}

export function defaultNavRailState(): NavRailState {
  return { collapsed: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把存档里读到的东西变成一个能用的形态。
 *
 * 坏掉的 JSON、被别的脚本写成字符串的值、少了字段的旧形状 —— 一律**不抛异常**,退回默认。
 * 导轨是商家进任何一页都要看到的东西,它绝不能因为一个存档字节坏掉而整页白屏。
 */
export function parseNavRailState(raw: string | null | undefined): NavRailState {
  const fallback = defaultNavRailState();
  if (typeof raw !== "string" || raw.length === 0) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isRecord(parsed)) return fallback;

  return {
    collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : fallback.collapsed,
  };
}

export function serializeNavRailState(state: NavRailState): string {
  return JSON.stringify({ collapsed: state.collapsed });
}

/**
 * 读存档。没有 `window`(服务端渲染)、localStorage 被禁(隐私模式直接抛)、值是垃圾 ——
 * 三种情况都只是「拿到默认值」,不是错误。
 */
export function readNavRailState(): NavRailState {
  if (typeof window === "undefined") return defaultNavRailState();
  try {
    return parseNavRailState(window.localStorage.getItem(NAV_RAIL_STORAGE_KEY));
  } catch {
    return defaultNavRailState();
  }
}

/** 写存档。写不进去(配额满、隐私模式)就算了 —— 导轨不能因为记不住而不能用。 */
export function writeNavRailState(state: NavRailState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAV_RAIL_STORAGE_KEY, serializeNavRailState(state));
  } catch {
    /* 存档是锦上添花,不是能不能用的前提 */
  }
}

// ── 转换 ──────────────────────────────────────────────────────────────────────
// 每一条都是 (state, …) => state,不改入参。

export function setNavRailCollapsed(state: NavRailState, collapsed: boolean): NavRailState {
  return state.collapsed === collapsed ? state : { ...state, collapsed };
}

/** 导轨头部那颗按钮走这一条。 */
export function toggleNavRailCollapsed(state: NavRailState): NavRailState {
  return { ...state, collapsed: !state.collapsed };
}

/** 这一刻导轨该有多宽。主内容让开的也是这个数,所以只算一次。 */
export function navRailWidth(state: NavRailState): number {
  return state.collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH_EXPANDED;
}
