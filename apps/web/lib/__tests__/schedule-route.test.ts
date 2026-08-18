// @vitest-environment jsdom
/**
 * schedule-route.test.ts —— Schedule 变真路由(W2-3,规格书 `docs/specs/wave2-shell.md` §4.6、Q4-A)。
 *
 * 这一票钉四件商家看得见的事:
 *   ① `/schedule` 是一条**真路由**:未登录进不去,登录了拿到的是**自己**的东西;
 *   ② `/schedule/analytics` 是同一页的第二个页签(Q4-A),不是第八个导航格;
 *   ③ 页签是**地址**不是本地状态,而且用 `ui/tabs` 画 —— role/aria/键盘由原语负责,不手搓;
 *   ④ 那颗永久 disabled、title 写着 "Coming soon" 的死按钮已经删了,而且加不回来。
 *
 * 全程零后端、零生成:身份、数据读取与排期的 server action 全是假件,一个积分都花不出去。
 *
 * 【Stack A】导航权威(`MERCHANT_NAV`)这一票一个字不动,所以旧的 `/otto?view=schedule`
 * 与 `?view=analytics` 照常;这里只证明新门自己立住了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

const WEB_ROOT = path.resolve(__dirname, "../..");

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  push: vi.fn(),
  pathname: { current: "/schedule" },
  requireOwner: vi.fn(),
  getEntities: vi.fn(),
  getRecentGenerationThumbs: vi.fn(),
  getMyAds: vi.fn(),
  listBrandRecords: vi.fn(),
  getAnalytics: vi.fn(),
  // 排期屏自己客户端读的那几发 —— 假件,不碰数据库也不发任何东西。
  listScheduledPosts: vi.fn(),
  listOwnerTargets: vi.fn(),
  createScheduledPost: vi.fn(),
  updateScheduledPost: vi.fn(),
  approveScheduledPost: vi.fn(),
  cancelScheduledPost: vi.fn(),
  getMetaConnection: vi.fn(),
  getOwnerSettings: vi.fn(),
  setOwnerSetting: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname.current,
}));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/data", () => ({
  getEntities: mocks.getEntities,
  getRecentGenerationThumbs: mocks.getRecentGenerationThumbs,
  getMyAds: mocks.getMyAds,
}));
vi.mock("@/lib/brand-record-actions", () => ({ listBrandRecords: mocks.listBrandRecords }));
vi.mock("@/lib/analytics-actions", () => ({ getAnalytics: mocks.getAnalytics }));
vi.mock("@/lib/dto", () => ({ toEntityDTO: (entity: unknown) => entity }));
vi.mock("@/lib/schedule-actions", () => ({
  listScheduledPosts: mocks.listScheduledPosts,
  listOwnerTargets: mocks.listOwnerTargets,
  createScheduledPost: mocks.createScheduledPost,
  updateScheduledPost: mocks.updateScheduledPost,
  approveScheduledPost: mocks.approveScheduledPost,
  cancelScheduledPost: mocks.cancelScheduledPost,
}));
vi.mock("@/lib/meta-actions", () => ({ getMetaConnection: mocks.getMetaConnection }));
vi.mock("@/lib/owner-settings-actions", () => ({
  getOwnerSettings: mocks.getOwnerSettings,
  setOwnerSetting: mocks.setOwnerSetting,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SchedulePage = (await import("@/app/schedule/page")).default;
const AnalyticsPage = (await import("@/app/schedule/analytics/page")).default;
const { ScheduleTabs, SCHEDULE_TABS, scheduleTabForPath } = await import("@/components/schedule/schedule-tabs");
const { ScheduleSurface } = await import("@/components/schedule/schedule-surface");
const { OttoSchedule } = await import("@/components/otto/OttoSchedule");

const SIGNED_IN = { email: "nurul@warungnurul.my", ownerId: "org_nurul" };
const IG_TARGET = { id: "ig-1", name: "Kopi Kita", channel: "instagram" as const };

/**
 * 页签壳 + 一段内容。`createElement` 的 children 只能走第三参(eslint react/no-children-prop),
 * 而组件签名把 children 标成必填,两边对不上;所以这里用一个 children 可选的等价类型去调它。
 */
function tabsAround(child: React.ReactElement): React.ReactElement {
  const Shell = ScheduleTabs as (props: { children?: React.ReactNode }) => React.ReactNode;
  return createElement(Shell, null, child);
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(element: React.ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
  // 冲掉 mount 时那几发并行的 server-action promise。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.pathname.current = SHELL_ROUTES.schedule;
  mocks.requireOwner.mockResolvedValue(SIGNED_IN);
  mocks.getEntities.mockResolvedValue([]);
  mocks.getRecentGenerationThumbs.mockResolvedValue([]);
  mocks.getMyAds.mockResolvedValue([]);
  mocks.listBrandRecords.mockResolvedValue([]);
  mocks.getAnalytics.mockResolvedValue({ state: "notConnected" });
  mocks.listScheduledPosts.mockResolvedValue([]);
  mocks.listOwnerTargets.mockResolvedValue({
    targets: [IG_TARGET],
    channelStates: { instagram: "ok", facebook: "ok", x: "ok" },
  });
  mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
  mocks.getOwnerSettings.mockResolvedValue({ autoPublish: false, timezone: "Asia/Kuala_Lumpur" });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

/* ── ① 两条路由是真的在盘上 ─────────────────────────────────────────────────── */

describe("Schedule 与 Analytics 各有一个真的路由文件(规格书 §2.2)", () => {
  // 地址不手抄:从权威源 SHELL_ROUTES 推出文件位置,常量改了这条就跟着改。
  it.each([
    ["schedule", SHELL_ROUTES.schedule],
    ["analytics", SHELL_ROUTES.analytics],
  ])("%s → %s 有 page.tsx", (_key, href) => {
    const route = path.join(WEB_ROOT, "app", href.replace(/^\//, ""), "page.tsx");
    expect(existsSync(route), `${href} 没有路由文件`).toBe(true);
  });

  it("Analytics 是 Schedule 页下面那一层,不是另一扇门(Q4-A)", () => {
    expect(SHELL_ROUTES.analytics.startsWith(`${SHELL_ROUTES.schedule}/`)).toBe(true);
    expect(existsSync(path.join(WEB_ROOT, "app/schedule/layout.tsx")), "两个页签没有共用的一层壳").toBe(true);
  });

  it("等待画面用 ui/skeleton,不再手搓一个 animate-pulse 方块(规格书 §5.6 ③)", () => {
    const loading = readFileSync(path.join(WEB_ROOT, "app/schedule/loading.tsx"), "utf8");
    expect(loading).toContain("@/components/ui/skeleton");
    expect(loading, "手搓骨架又回来了").not.toContain("animate-pulse");
  });
});

/* ── ② 门后面是自己的东西,没登录进不去 ────────────────────────────────────── */

describe("/schedule 是一条真路由", () => {
  it("未登录 → 送去登录页,一个字节的排期都不交出去", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });
    await expect(SchedulePage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getEntities).not.toHaveBeenCalled();
  });

  it("登录了 → 备的是这个 ownerId 自己的 Library 清单(租户不越界)", async () => {
    mocks.getRecentGenerationThumbs.mockResolvedValue([
      { id: "gen-1", projectId: "proj-1", assetId: "asset-1", src: "https://cdn.test/a.png", kind: "image", prompt: "Raya promo" },
    ]);
    const element = (await SchedulePage()) as React.ReactElement<{ stuffItems: { id: string }[] }>;

    for (const read of [mocks.getEntities, mocks.getRecentGenerationThumbs, mocks.getMyAds, mocks.listBrandRecords]) {
      expect(read).toHaveBeenCalledWith(SIGNED_IN.ownerId);
    }
    // 搬家不换组件:这一页交给的仍是那一个唯一权威日历。
    expect(element.type).toBe(ScheduleSurface);
    expect(element.props.stuffItems.map((i) => i.id)).toEqual(["gen:gen-1"]);
  });
});

describe("/schedule/analytics 是同一页的第二个页签", () => {
  it("未登录 → 送去登录页", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });
    await expect(AnalyticsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getAnalytics).not.toHaveBeenCalled();
  });

  it("读不到 Meta 的时候交给视图的是 notConnected —— 不编数字", async () => {
    const element = (await AnalyticsPage()) as React.ReactElement<{ initial: { state: string } }>;
    expect(element.props.initial).toEqual({ state: "notConnected" });
  });

  it("Meta 那一头炸了也不炸页面,仍然是 notConnected", async () => {
    mocks.getAnalytics.mockRejectedValue(new Error("meta down"));
    const element = (await AnalyticsPage()) as React.ReactElement<{ initial: { state: string } }>;
    expect(element.props.initial).toEqual({ state: "notConnected" });
  });
});

/* ── ③ 页签:地址驱动 + ui/tabs 的可访问性 ─────────────────────────────────── */

describe("页内两个页签(Q4-A)", () => {
  it("页签的地址来自权威源,不是页面里手写的第二份", () => {
    expect(SCHEDULE_TABS.map((t) => t.href)).toEqual([SHELL_ROUTES.schedule, SHELL_ROUTES.analytics]);
    expect(SCHEDULE_TABS.map((t) => t.label)).toEqual(["Schedule", "Analytics"]);
  });

  it("当前页签由地址决定 —— 刷新回得来,分享给得出去", () => {
    expect(scheduleTabForPath(SHELL_ROUTES.schedule)).toBe("schedule");
    expect(scheduleTabForPath(SHELL_ROUTES.analytics)).toBe("analytics");
    expect(scheduleTabForPath(`${SHELL_ROUTES.analytics}/anything`)).toBe("analytics");
    expect(scheduleTabForPath("/somewhere-else")).toBe("schedule");
  });

  it("画出来的是真 tablist:两颗 tab、选中的只有一颗、各自指向自己的地址", async () => {
    await mount(tabsAround(createElement("div", { "data-testid": "panel-child" }, "Schedule body")));

    const tablist = container!.querySelector('[role="tablist"]');
    expect(tablist, "没有 tablist").toBeTruthy();
    const tabs = Array.from(container!.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(["Schedule", "Analytics"]);
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual([SHELL_ROUTES.schedule, SHELL_ROUTES.analytics]);
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("在 Analytics 地址上,选中的那颗换成 Analytics", async () => {
    mocks.pathname.current = SHELL_ROUTES.analytics;
    await mount(tabsAround(createElement("div", null, "Analytics body")));

    const tabs = Array.from(container!.querySelectorAll('[role="tab"]'));
    expect(tabs.find((t) => t.getAttribute("aria-selected") === "true")?.textContent).toBe("Analytics");
  });

  it("内容躺在一个真的 tabpanel 里,并且由选中的那颗 tab 命名(读屏器说得出自己在哪一页)", async () => {
    await mount(tabsAround(createElement("div", { "data-testid": "panel-child" }, "Schedule body")));

    const panel = container!.querySelector('[role="tabpanel"]');
    expect(panel, "内容不在 tabpanel 里").toBeTruthy();
    expect(panel!.querySelector('[data-testid="panel-child"]'), "页签壳把内容吞了").toBeTruthy();

    const labelledBy = panel!.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const selected = container!.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected!.getAttribute("id")).toBe(labelledBy);
  });

  it("页签不是手搓的 —— 用的是 ui/tabs 与真 <Link>(规格书 §5.6 ②)", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/schedule/schedule-tabs.tsx"), "utf8");
    expect(source).toContain('from "@/components/ui/tabs"');
    expect(source).toContain('from "next/link"');
    expect(source, "又手写了一个 role=tablist").not.toContain('role="tablist"');
    expect(source, "又手写了一个 role=tab").not.toContain('role="tab"');
  });
});

/* ── ④ 诚实收口:那颗死按钮删了,而且加不回来 ─────────────────────────────── */

/**
 * 围栏扫的是**本票的改动面**(规格书 §7.1「全仓没有 Coming soon」在本票的落点)。
 *
 * 大小写敏感,钉的是规格书写下的那句商家可见的文案 "Coming soon"。同一个文件里
 * `capsBlurb()` 还有一句小写的 "media coming soon",它挂在 `maxMediaCount <= 0` 那条
 * 分支上 —— 今天只有 X 是 0,而 X 被 `CONNECTABLE_CHANNEL_META` 挡在这块屏之外,所以
 * 那句话画不出来。它属于渠道文案那一票(W2-4 Connections 多渠道版式),不在本票范围内,
 * 已随交接单独上报;本围栏不替它签字,也不给它开豁免名单。
 */
const HONESTY_SCAN: readonly string[] = [
  "components/otto/OttoSchedule.tsx",
  "components/otto/OttoAnalytics.tsx",
  "components/schedule/schedule-tabs.tsx",
  "components/schedule/schedule-surface.tsx",
  "components/schedule/analytics-surface.tsx",
  "components/schedule/otto-view-navigation.ts",
  "app/schedule/layout.tsx",
  "app/schedule/loading.tsx",
  "app/schedule/page.tsx",
  "app/schedule/analytics/page.tsx",
];

describe("没通电的能力照实说(规格书 §4.6、§7.1)", () => {
  it.each(HONESTY_SCAN)("%s 里没有一句 Coming soon", (relative) => {
    const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
    // 这个文件自己也带这几个字(注释与断言),所以扫的是产品代码,不扫围栏自己。
    expect(source.includes("Coming soon"), `${relative} 又替某个还没排期的能力许了诺`).toBe(false);
  });

  it("那颗永久 disabled 的 “Ask Otto to write it” 按钮不在了", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/otto/OttoSchedule.tsx"), "utf8");
    expect(source).not.toContain("Ask Otto to write it");
  });

  it("发布关着的实话仍然逐字来自权威常量,不在这块屏上另写一份", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/otto/OttoSchedule.tsx"), "utf8");
    expect(source).toContain("@fikirtive/core/schedule-draft");
    for (const name of ["publishPreviewBadge", "publishSurfaceCopy", "publishSurfaceLines"]) {
      expect(source, `${name} 不再从权威源来`).toContain(name);
    }
  });

  it("composer 画出来的文案区里,没有任何一颗按不下去的按钮替 Otto 许诺", async () => {
    await mount(createElement(OttoSchedule, { stuffItems: [], onNavigate: () => {} }));

    const newPost = Array.from(document.body.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("New post"),
    );
    expect(newPost, "排期屏上没有 New post").toBeTruthy();
    await act(async () => {
      newPost!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // composer 走 Radix Portal,内容落在 document.body 上。
    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    expect(dialog, "composer 没开起来").toBeTruthy();
    expect(dialog!.querySelector("textarea"), "文案框不见了 —— 删按钮不许把字段一起带走").toBeTruthy();
    expect(dialog!.textContent).not.toContain("Ask Otto to write it");
    expect(document.body.querySelector('[title*="Coming soon"]')).toBeNull();
  });
});
