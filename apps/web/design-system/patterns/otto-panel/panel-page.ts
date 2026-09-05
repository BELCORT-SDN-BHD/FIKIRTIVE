/**
 * panel-page.ts —— 面板「知道商家正在看哪一页」的那一层。纯函数,没有 React、没有取数。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4(上下文 chip、快捷 chips);票 #995(W2-8)。
 *
 * 这里一个路径字面量都没有:地址只有 `SHELL_ROUTES` 一份权威(#985/W2-0 落的那一份),
 * 页面名只有 `MERCHANT_NAV` 一份权威。换壳把某一面搬到新地址时,这个文件不用改 ——
 * 本仓最贵的一课就是同一个地址被抄进第二处之后两边各自漂移。
 *
 * 这一层只回答「这是哪一页 / 哪一个对象」(§3.5 原则 ④ 的 🟡):
 *   · 整条路径等于某个 SHELL_ROUTES → 这一档是**一页**,名字就是它在导航里的名字;
 *   · 路径是某个 SHELL_ROUTES 再加一段 id → 这一档是**一个对象**,只交出
 *     `{ objectKind, objectId }`。对象的真名字要读数据库,而纯函数里不许有取数。
 *
 * **它不说 Otto 读得到什么**(判官 r1 [P2] 的裁定至今成立):服务端没有任何读者会因为
 * 商家在看哪一页而改变这一轮的上下文,所以「On this page: X」那种写法会说假话。W2-8 因此
 * 不画 chip。FRONT-A14 之后头部只在打开的是一条**确知的画布对话**时写一句
 * 「Canvas · <画布名>」(见下方 `formatPanelScope` 上面那段):说的是「这段对话属于别处」,
 * 不是「Otto 看得见什么」—— 前者今天为真,后者仍要等 #879 step 2。
 */
import { GOAL_PRESETS, type GoalKey } from "@fikirtive/core/goals";
import { SHELL_ROUTES, everyNavDestination } from "@fikirtive/core/navigation";

export type ShellRouteKey = keyof typeof SHELL_ROUTES;

/** 哪些面底下挂着「一个对象一页」。今天只有战役有真的对象页(`/campaign/<id>`)。 */
const OBJECT_ROUTES = { campaign: "campaign" } as const;
type PanelObjectKind = (typeof OBJECT_ROUTES)[keyof typeof OBJECT_ROUTES];

/**
 * 一条 shell 路由底下**不是对象**的那些固定子段。
 *
 * 判官 r1 [P3]:`/campaign/calendar`、`/campaign/trends`、`/campaign/workbench` 是三个真的
 * 页面文件,不是三条战役。少了这一层,面板会拿 "calendar" 当 id 去查一次库(白跑一次查询,
 * 而且必然查不到 → 一个永远不出现的 chip)。
 *
 * 为什么是一份手写名单而不是「id 长得像不像 ULID」:id 的形状是战役那一侧的规矩
 * (`campaign-view-data.ts` 的 `ULID_PATTERN`),抄到这里就又多了一份会漂移的真相。
 * 这三段本身也在退场路上(规格书 §5.4:`/campaign/calendar` 收敛成重定向),名单只会变短。
 */
const NON_OBJECT_SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  campaign: ["calendar", "trends", "workbench"],
};

/** 一次匹配的结果:落在哪一条 shell 路由上,以及(如果有)它后面那一段对象 id。 */
type ShellRouteMatch = { key: ShellRouteKey; objectId?: string };

/** 传进来的可能带 query / hash,只看路径那一段;结尾的斜杠不算一段。 */
function pathOf(location: string): string {
  const path = location.split(/[?#]/)[0] ?? "";
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** 按 href 长度从长到短 —— `/create/canvas` 必须先于 `/create` 命中,否则画布会被当成 Create 的一个对象。 */
const ROUTES_LONGEST_FIRST: readonly (readonly [ShellRouteKey, string])[] = (
  Object.entries(SHELL_ROUTES) as [ShellRouteKey, string][]
).sort((a, b) => b[1].length - a[1].length);

/**
 * 这条地址落在哪一条 shell 路由上。
 *
 * 只按**整段**比:`/campaign` 命中 campaign,`/campaign/abc` 命中 campaign 且带 objectId,
 * `/campaigns` 一个都不命中。首页(`/`)只认全等 —— 每一条路径都以 `/` 开头,
 * 拿它做前缀会把整个站点都算成首页的对象。
 */
function matchShellRoute(location: string): ShellRouteMatch | null {
  const path = pathOf(location);
  if (!path) return null;
  for (const [key, href] of ROUTES_LONGEST_FIRST) {
    if (path === href) return { key };
    if (href === SHELL_ROUTES.home) continue;
    if (!path.startsWith(`${href}/`)) continue;
    const rest = path.slice(href.length + 1);
    // 再深一层就不是「这一页的对象」了(例如 `/campaign/abc/entries`),V1 不猜。
    if (!rest || rest.includes("/")) return { key };
    // 固定子段是一**页**,不是一个对象 —— 别拿它的名字当 id 去查库。
    if (NON_OBJECT_SEGMENTS[key]?.includes(rest)) return { key };
    return { key, objectId: rest };
  }
  return null;
}

/** 这一页是哪一页(今天没有人画它,理由见 `formatPanelScope` 上面那段;不描述 Otto 读得到什么)。 */
export type PanelContextSubject =
  /** 一页。`label` 就是它在导航里的名字(`Library`)。 */
  | { kind: "page"; routeKey: ShellRouteKey; label: string }
  /** 一个对象。名字要去数据库读,所以这里只给身份。 */
  | { kind: "object"; routeKey: ShellRouteKey; objectKind: PanelObjectKind; objectId: string };

/** 一条 shell 路由在导航树里的名字;这一格不在导航里(首页、画布、个人资料)就没有名字。 */
function navLabelForRoute(key: ShellRouteKey): string | null {
  return everyNavDestination().find((item) => item.key === key)?.label ?? null;
}

/**
 * 这一页该不该有上下文 chip,有的话说的是什么。
 *
 * 认不出来的地址、或者导航里没有名字的那几面(首页、个人资料),一律 `null` ——
 * 没有可说的就不说,不摆一个写着路径的 chip。
 */
export function panelContextSubject(location: string): PanelContextSubject | null {
  const match = matchShellRoute(location);
  if (!match) return null;
  const objectKind = OBJECT_ROUTES[match.key as keyof typeof OBJECT_ROUTES];
  if (match.objectId && objectKind) {
    return { kind: "object", routeKey: match.key, objectKind, objectId: match.objectId };
  }
  const label = navLabelForRoute(match.key);
  return label ? { kind: "page", routeKey: match.key, label } : null;
}

/**
 * 面板头部那一行标签的两段式写法。**分隔符只有这一处**(判官 nit:上一版在这里和
 * `OttoPanelHost` 各写了一遍「 · 」,两处迟早不一样)。名字空/只有空白就只剩第一段。
 */
export function formatPanelScope(scope: string, name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `${scope} · ${trimmed}` : scope;
}

/**
 * 为什么这里**没有**一个「Workspace · <页面名>」的常驻标签(判官 P2-4)。
 *
 * 上一版让面板头部每一页都挂一条横条。判官 r1 当初裁的是「不画」,而那一条横条对**面板
 * 自己的**对话来说不带任何新信息:商家就在那一页上,面板就是他刚点开的那一块 —— 它只是
 * 把他看得见的两件事又说了一遍,还占掉 320px 面板里的一整行,而且不在已批准的设计里。
 *
 * 现在只在**带新信息**的那一种情况下画:打开的是一条**确知**的画布对话时,头部写
 * 「Canvas · <画布名>」——「你现在接着聊的这一段属于别处」是商家在面板上读不到的事实,
 * 那正是 P1-010 报的第二半。工作区对话与来路不明的老行都不画。
 *
 * 「常驻 Workspace · <页面名> 横条要不要」已登记进 `docs/specs/frontend-baseline.md` §5,
 * 待 Founder 在 FRONT-A14 走查时裁。要接回来时,`panelContextSubject` 与它的围栏都还在。
 */

/**
 * 每一页给哪几颗快捷 chips。
 *
 * 值是 `goalKey` —— 与前门四个目标格子**同一个机制**(点一下,把这个目标的那句话作为
 * 这一轮的消息发出去,goalKey 随行去 seed 开场)。标签一个字都不在这里写:那是
 * `GOAL_PRESETS` 的活,写在这里就又多了一份会漂移的文案(#979)。
 */
const CHIP_GOALS_BY_ROUTE: Partial<Record<ShellRouteKey, readonly GoalKey[]>> = {
  home: ["plan-campaign", "sell-product", "make-video"],
  create: ["sell-product", "make-video", "get-followers"],
  library: ["make-video", "sell-product", "announce-sale"],
  brand: ["sell-product", "get-followers", "announce-sale"],
  campaign: ["plan-campaign", "announce-sale", "get-followers"],
  schedule: ["fill-week", "announce-sale", "make-video"],
  analytics: ["get-followers", "announce-sale", "make-video"],
  billing: ["sell-product", "announce-sale", "make-video"],
};

/** 认不出来的面给这一组 —— 前门四格里最常用的三个,不是一片空白。 */
const DEFAULT_CHIP_GOALS: readonly GoalKey[] = ["sell-product", "announce-sale", "make-video"];

export type PanelQuickChip = { goalKey: GoalKey; label: string };

/** 这一页底部那 3–4 颗 chips。标签从 `GOAL_PRESETS` 取,与商家点下去真正发出的话逐字相同。 */
export function panelQuickChips(location: string): PanelQuickChip[] {
  const match = matchShellRoute(location);
  const goals = (match && CHIP_GOALS_BY_ROUTE[match.key]) || DEFAULT_CHIP_GOALS;
  return goals.map((goalKey) => ({ goalKey, label: GOAL_PRESETS[goalKey].label }));
}
