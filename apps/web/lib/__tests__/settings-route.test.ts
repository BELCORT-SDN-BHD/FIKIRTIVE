// @vitest-environment jsdom
/**
 * settings-route.test.ts —— W2-4:Settings 真路由 + Connections 多渠道版式
 * (规格书 `docs/specs/wave2-shell.md` §4.7,工单 #989)。
 *
 * 四段,各钉这一票的一条验收:
 *
 *   ① **两扇真门**:`/settings` 与 `/settings/connections` 各有自己的 `page.tsx`,
 *      地址由权威常量 `SHELL_ROUTES` 推出来(测试里不手抄第二遍),内容是**搬家**——
 *      渲染的还是 `OttoAccount` / `OttoConnections` 那两份实现,没长出第二套设置面。
 *      等待画面走 `ui/skeleton`(规格书 §5.6 ③)。
 *      外加 Stack A 纪律(§6.3):导航权威一个字没动。
 *
 *   ② **门是关着的**:没登录 → 回 `/login`,而且**在读任何数据之前**;登录了 → 读的是
 *      服务端 session 那个身份,页面不接、也不转发任何客户端传来的 ownerId。
 *
 *   ③ **多渠道版式**:Publishing 分区逐行渲染 `CHANNEL_META`(顺序也来自它),每一个可连
 *      渠道各有**自己**的开关(accessible name 里带自己的渠道名),两行状态不同就各说各的;
 *      X 行说 “Not available yet” 且**一个按钮都不画**。
 *      顶部那句实话**引用**权威(`PUBLISH_PREVIEW_COPY`)而不是抄一份。
 *
 *   ④ **不承诺时间**:改动面里没有 “coming soon” 这一族措辞 —— 包括 W2-3 交接过来的
 *      那句渠道能力 blurb(“Text posts · media coming soon”),它已经搬进渠道 meta 层。
 *
 * 零后端、零生成:文件系统 + 纯函数 + 一次真挂载。
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { publishSurfaceCopy } from "@fikirtive/core/schedule-draft";
import {
  CHANNEL_META,
  channelCapabilityBlurb,
  isConnectableChannel,
  publishingChannelRows,
} from "@/lib/channels/channel-meta";
import type { AccountInfo } from "@/lib/account-actions";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "../..");

const source = (relative: string) => readFileSync(join(WEB_ROOT, relative), "utf8");

/**
 * 注释不算数。下面几条围栏钉的是「界面上不许再有这个形状」,而讲清楚为什么不许,就得把那个
 * 形状的名字写出来 —— 一条读整份源码的断言会被自己那段说明噎死(第一版就是这么红的)。
 * 所以先把注释剥掉,再看剩下的代码。
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const code = (relative: string) => withoutComments(source(relative));

/** 权威常量 → app router 里的目录。`/settings` → `app/settings`,`/settings/connections` → `app/settings/connections`。 */
function routeDir(href: string): string {
  return join("app", ...href.split("/").filter(Boolean));
}

const PREFERENCES_DIR = routeDir(SHELL_ROUTES.preferences);
const CONNECTIONS_DIR = routeDir(SHELL_ROUTES.connections);

// ───────────────────────────────────────────────────────────────────────────────
// 测试替身:两张页面都是 Server Component,它们唯一的服务端动作是「关门」。
// ───────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getMyAccount: vi.fn(),
  redirect: vi.fn((href: string) => {
    // 真的 `redirect()` 靠抛出中断渲染。这里照做,否则「回登录页」的分支会继续往下跑,
    // 测出来的就不是产品的行为。
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  getAccountViewData: vi.fn(),
  getMetaConnection: vi.fn(),
  disconnectMeta: vi.fn(),
  getMetaInsights: vi.fn(),
  setAdsAutonomy: vi.fn(),
  setAdsWritesPaused: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/account-view-data", () => ({ getAccountViewData: mocks.getAccountViewData }));
vi.mock("@/lib/meta-actions", () => ({
  getMetaConnection: mocks.getMetaConnection,
  disconnectMeta: mocks.disconnectMeta,
  getMetaInsights: mocks.getMetaInsights,
}));
vi.mock("@/lib/otto-client-actions", () => ({
  setAdsAutonomy: mocks.setAdsAutonomy,
  setAdsWritesPaused: mocks.setAdsWritesPaused,
}));

const { default: PreferencesPage } = await import("@/app/settings/page");
const { default: ConnectionsPage } = await import("@/app/settings/connections/page");
const { default: OttoConnections } = await import("@/components/otto/OttoConnections");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT: AccountInfo = {
  email: "owner@acme.test",
  displayName: "Amina",
  organizationName: "Acme Studio",
  isFounder: false,
  balance: 120,
  reserved: 0,
  balanceUsd: 12,
  recent: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, "", "/settings/connections");
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

// ───────────────────────────────────────────────────────────────────────────────
// ① 两扇真门,内容是搬家不是重写
// ───────────────────────────────────────────────────────────────────────────────

describe("W2-4 ① `/settings` 与 `/settings/connections` 是真路由", () => {
  it("权威常量指的两个地址下面各真有一个 page.tsx —— 地址不在这里手抄第二遍", () => {
    expect(SHELL_ROUTES.preferences, "常量本身被改了,下面的推导就全落空").toBe("/settings");
    expect(SHELL_ROUTES.connections).toBe("/settings/connections");
    for (const dir of [PREFERENCES_DIR, CONNECTIONS_DIR]) {
      expect(existsSync(join(WEB_ROOT, dir, "page.tsx")), `${dir}/page.tsx 不存在`).toBe(true);
    }
  });

  it("Connections 住在 Preferences 下面 —— 分组关系写在地址里,不靠导航来表达", () => {
    expect(SHELL_ROUTES.connections.startsWith(`${SHELL_ROUTES.preferences}/`)).toBe(true);
  });

  it("两页渲染的都是搬过来的那一份实现,没有第二套设置面", () => {
    const prefs = source(join(PREFERENCES_DIR, "page.tsx"));
    expect(prefs).toContain('from "@/components/otto/OttoAccount"');
    expect(prefs).toContain("<OttoAccount");

    const connections = source(join(CONNECTIONS_DIR, "page.tsx"));
    expect(connections).toContain('from "@/components/otto/OttoConnections"');
    expect(connections).toContain("<OttoConnections");
  });

  it("等待画面走 ui/skeleton,不手搓那一份 pulse 配方(规格书 §5.6 ③)", () => {
    for (const dir of [PREFERENCES_DIR, CONNECTIONS_DIR]) {
      const loading = join(dir, "loading.tsx");
      expect(existsSync(join(WEB_ROOT, loading)), `${loading} 不存在`).toBe(true);
      expect(source(loading)).toContain('from "@/components/ui/skeleton"');
      expect(code(loading), "手搓骨架又回来了").not.toContain("animate-pulse");
    }
  });

  it("Stack A:导航权威一个字没动 —— MERCHANT_NAV 里今天还指着旧地址", async () => {
    // 这条不是「没做完」,是这一票的边界(规格书 §6.3):新旧路由并存,导航指过来是切换
    // 总票 W2-11 的活。写成断言,是因为「顺手把导航也改了」正是让并行几路互相踩的那一步。
    const { MERCHANT_NAV } = await import("@fikirtive/core/navigation");
    const tree = JSON.stringify(MERCHANT_NAV);
    expect(tree, "导航权威被这一票改了 —— 那是 W2-11 的活").not.toContain('"/settings"');
    expect(tree).not.toContain('"/settings/connections"');
    // 而旧壳照常:两个旧视图地址还在导航里,商家今天走的还是那条路。
    expect(tree).toContain("/otto?view=account");
    expect(tree).toContain("/otto?view=connections");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// ② 门是关着的:身份只从服务端 session 来
// ───────────────────────────────────────────────────────────────────────────────

describe("W2-4 ② 两页的入口闸", () => {
  it.each([
    ["/settings", () => PreferencesPage()],
    ["/settings/connections", () => ConnectionsPage()],
  ])("%s:没登录就回 /login", async (_href, render) => {
    mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });

    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    // 关门要在读数据**之前** —— 先读后关等于没关。
    expect(mocks.getMyAccount).not.toHaveBeenCalled();
    expect(mocks.getAccountViewData).not.toHaveBeenCalled();
  });

  it("/settings:登录了就读账户,而且读的是 session 那个身份 —— 页面不传 ownerId", async () => {
    mocks.requireOwner.mockResolvedValue({ ownerId: "org_acme", email: ACCOUNT.email });
    mocks.getMyAccount.mockResolvedValue(ACCOUNT);

    const element = await PreferencesPage();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getMyAccount).toHaveBeenCalledTimes(1);
    // 一个参数都没有:租户身份只能是 getMyAccount 自己 requireOwner() 出来的那一个,
    // 页面没有任何机会把别人的 ownerId 递进去。
    expect(mocks.getMyAccount).toHaveBeenCalledWith();
    expect(element).toBeTruthy();
  });

  it("两页的源码里都没有 ownerId —— 不接客户端传来的租户身份,也没有 searchParams 可以传", () => {
    for (const dir of [PREFERENCES_DIR, CONNECTIONS_DIR]) {
      const page = code(join(dir, "page.tsx"));
      expect(page, `${dir}/page.tsx 出现了 ownerId`).not.toMatch(/\bownerId\b/);
      expect(page, `${dir}/page.tsx 开始接 searchParams`).not.toMatch(/\bsearchParams\b/);
    }
  });

  it("账户读不出来时传 null,让组件说实话 —— 不编一个空账户出来", async () => {
    mocks.requireOwner.mockResolvedValue({ ownerId: "org_acme", email: ACCOUNT.email });
    mocks.getMyAccount.mockResolvedValue({ error: "Could not load your organization." });

    const element = await PreferencesPage();
    // OttoAccount 收到 null 时渲染 "Could not load your account."(组件既有行为)。
    const props = (element as unknown as { props: { children: { props: { account: unknown } } } }).props;
    expect(props.children.props.account).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// ③ 多渠道版式:一行一个渠道,一个渠道一个开关
// ───────────────────────────────────────────────────────────────────────────────

/** 服务端那一次读回来的渠道状态。默认三个渠道全都没连。 */
const DISCONNECTED = [
  { id: "instagram", label: "Instagram", status: "not_connected" as const, targets: [], connectUrl: "/api/meta/authorize" },
  { id: "facebook", label: "Facebook", status: "not_connected" as const, targets: [], connectUrl: "/api/meta/authorize" },
  { id: "x", label: "X", status: "not_connected" as const, targets: [], connectUrl: "/api/x/authorize" },
];

async function mountConnections(channels: unknown[] = DISCONNECTED): Promise<HTMLDivElement> {
  mocks.getAccountViewData.mockResolvedValue({
    settings: {},
    channels,
    shelf: { packs: [] },
    adsAutonomy: "ASK",
    canPublish: false,
    meta: { connected: false },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(OttoConnections)));
  // 组件挂载后用 queueMicrotask 起那一次 load()。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function publishingRows(dom: HTMLElement): HTMLElement[] {
  const section = dom.querySelector<HTMLElement>('[data-section="publishing"]');
  expect(section, "Publishing 分区不见了").toBeTruthy();
  return Array.from(section!.querySelectorAll<HTMLElement>("[data-channel]"));
}

describe("W2-4 ③ Publishing 逐行渲染 CHANNEL_META", () => {
  it("有哪几行、什么顺序,都来自渠道权威 —— 不是那一次网络读回来什么就画什么", async () => {
    const dom = await mountConnections();
    const rendered = publishingRows(dom).map((row) => row.dataset.channel);

    // 逐条对着权威比,不在测试里手抄一份渠道名单。
    expect(rendered).toEqual(CHANNEL_META.map((c) => c.id));
    // 而且真有三个:少于两个的话,「多渠道版式」这句话本身就没被验到。
    expect(rendered.length).toBeGreaterThanOrEqual(3);
  });

  it("每一个可连渠道各有自己的开关 —— 没有一颗全局开关替三个渠道回答", async () => {
    const dom = await mountConnections();
    const rows = publishingRows(dom);

    const controlsPerRow = rows.map((row) => Array.from(row.querySelectorAll("a, button")));
    const connectable = CHANNEL_META.filter((c) => isConnectableChannel(c.id));

    // 可连渠道的控件总数 = 可连渠道数。一颗管全部的开关只会数出 1。
    expect(controlsPerRow.flat().length).toBe(connectable.length);

    for (const meta of connectable) {
      const row = rows.find((r) => r.dataset.channel === meta.id);
      expect(row, `${meta.label} 那一行不见了`).toBeTruthy();
      const controls = Array.from(row!.querySelectorAll("a, button"));
      expect(controls, `${meta.label} 这一行没有自己的开关`).toHaveLength(1);
      // 开关自报家门:读屏听到的是「Connect Instagram」,不是三声一样的「Connect」。
      const name = controls[0].getAttribute("aria-label") ?? controls[0].textContent ?? "";
      expect(name, `${meta.label} 的开关没说自己管哪个渠道`).toContain(meta.label);
    }
  });

  it("两个渠道状态不同,就各说各的 —— 一个全局开关做不到这件事", async () => {
    const dom = await mountConnections([
      // Instagram 连着但缺页面权限(要重连),Facebook 好好的。
      { id: "instagram", label: "Instagram", status: "connected", targets: [], blocker: "needs_page_permission", connectUrl: "/api/meta/authorize" },
      { id: "facebook", label: "Facebook", status: "connected", targets: ["Acme Page"], connectUrl: "/api/meta/authorize" },
      { id: "x", label: "X", status: "not_connected", targets: [], connectUrl: "/api/x/authorize" },
    ]);
    const rows = publishingRows(dom);
    const control = (id: string) => rows.find((r) => r.dataset.channel === id)!.querySelector("a, button");

    expect(control("instagram")!.textContent).toBe("Reconnect");
    expect(control("instagram")!.getAttribute("aria-label")).toBe("Reconnect Instagram");
    expect(control("facebook")!.textContent).toBe("Manage");
    expect(control("facebook")!.getAttribute("aria-label")).toBe("Manage Facebook");
    // 同一时刻两个渠道两种状态:这就是「按渠道」的判据。
    expect(control("instagram")!.textContent).not.toBe(control("facebook")!.textContent);
  });

  it("X 那一行说 “Not available yet”,而且一个按钮都不画(围栏)", async () => {
    const dom = await mountConnections();
    for (const meta of CHANNEL_META.filter((c) => !isConnectableChannel(c.id))) {
      const row = publishingRows(dom).find((r) => r.dataset.channel === meta.id);
      expect(row, `${meta.label} 那一行不见了`).toBeTruthy();
      expect(row!.textContent).toContain(meta.label);
      expect(row!.textContent).toContain("Not available yet");
      // 画一颗按不出结果的 Connect,就是这一票要挡的那件事。
      expect(row!.querySelector("a, button"), `${meta.label} 画了一颗假按钮`).toBeNull();
      // 连去那条不存在的 OAuth 路由的链接更不许有。
      expect(dom.querySelector('a[href="/api/x/authorize"]')).toBeNull();
    }
  });

  // 判官 P2-1:这条原本只钉纯函数(`publishingChannelRows` 会不会少一行),而**屏幕上**
  // 少不少一行是另一回事 —— 当时组件对 state 为 null 的可连渠道整行渲染 null,判官探针喂
  // [instagram, x] 时 Facebook 那一行凭空消失。所以现在挂真组件、看真 DOM。
  it("那一次读少回来一个渠道,屏幕上也不少一行 —— 它说自己没读到,不是不见了", async () => {
    // 服务端只带回了 Instagram 与 X:Facebook 既不能说连着,也不能说没连。
    const dom = await mountConnections([
      { id: "instagram", label: "Instagram", status: "not_connected", targets: [], connectUrl: "/api/meta/authorize" },
      { id: "x", label: "X", status: "not_connected", targets: [], connectUrl: "/api/x/authorize" },
    ]);
    const rows = publishingRows(dom);

    // ① 行还在,而且还是那三行、那个顺序。
    expect(rows.map((r) => r.dataset.channel)).toEqual(CHANNEL_META.map((c) => c.id));

    // ② 那一行说的是「没读到」,不是编一个状态出来。降级态 ≠ 真空态。
    const facebook = rows.find((r) => r.dataset.channel === "facebook")!;
    expect(facebook.textContent).toContain("Facebook");
    expect(facebook.textContent, "读不到却报了一个状态").not.toMatch(/Not connected|Connected(?!\w)/);
    expect(facebook.textContent).toContain("couldn’t read this connection");

    // ③ 而且给得出下一步:Retry 走的就是本页那一次 load()。
    const retry = facebook.querySelector("button");
    expect(retry, "读不到又没有下一步 —— 那是死路").toBeTruthy();
    expect(retry!.getAttribute("aria-label")).toBe("Retry Facebook");

    // 纯函数那一层同样钉住(屏幕上少一行的病根就在这一层被读错的时候)。
    const pure = publishingChannelRows([{ id: "instagram" }]);
    expect(pure.map((r) => r.id)).toEqual(CHANNEL_META.map((c) => c.id));
    expect(pure.find((r) => r.id === "facebook")!.state).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// ③b 两份渠道名单必须一致(判官 P3-2)
// ───────────────────────────────────────────────────────────────────────────────

describe("W2-4 ③b registry 与 CHANNEL_META 是同一份名单", () => {
  // 这一票把版式的来源从「服务端回来什么」换成了 CHANNEL_META,漂移的代价因此变高:
  // registry 里注册了、CHANNEL_META 里没有的渠道,商家一行都看不到(静默消失);反过来
  // CHANNEL_META 有、registry 没有的,那一行永远读不到状态。两边必须逐条对齐。
  //
  // 不 import registry.ts:它 transitively 拉 prisma 与 `server-only`(x.ts → auth-guard),
  // 那是服务端模块,在这个 jsdom 套件里 import 它要靠一串与本条无关的替身,替身本身就会
  // 变成漂移的藏身处。这里读两份**源码**,拿的是真的注册表与真的 id。
  it("注册了哪几个渠道,CHANNEL_META 就有哪几行,顺序也一样", () => {
    const registry = source("lib/channels/registry.ts");
    const registered = [...registry.matchAll(/registerChannel\((\w+)\)/g)].map((m) => m[1]);
    expect(registered.length, "registry.ts 里一个 registerChannel 都没扫到 —— 围栏读空了").toBeGreaterThan(0);

    // 适配器模块名不是权威,模块里那个 `id:` 才是。
    const registeredIds = registered.map((moduleName) => {
      const adapter = source(`lib/channels/${moduleName}.ts`);
      const id = /\bid:\s*"([^"]+)"/.exec(adapter);
      expect(id, `lib/channels/${moduleName}.ts 里没找到 id`).toBeTruthy();
      return id![1];
    });

    expect(registeredIds).toEqual(CHANNEL_META.map((c) => c.id));
  });
});

describe("W2-4 ③ 顶部那句实话", () => {
  it("说出来了,而且是**引用**权威,不是抄一份", async () => {
    const dom = await mountConnections();
    const text = dom.textContent ?? "";
    const copy = publishSurfaceCopy();

    // ①「今天连不上 Instagram / Facebook」②「排期本身仍然是真的」—— 规格书 §4.7 要的两件事。
    expect(text, "连接页仍然没说今天连不上").toContain(copy.why);
    expect(text, "连接页没说排期本身仍然是真的").toContain(copy.real);

    // 抄一份的代价就是漂移:PUBLISHING_AVAILABLE 翻面那天,抄的那份不会跟着变。
    const src = source("components/otto/OttoConnections.tsx");
    expect(src, "那句话被抄进组件里了 —— 引用它,别复制它").not.toContain(copy.why);
    expect(src).not.toContain(copy.real);
    expect(src).toContain("publishSurfaceCopy()");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// ④ 不承诺时间 + 这一面不再承诺通知
// ───────────────────────────────────────────────────────────────────────────────

describe("W2-4 ④ 改动面里没有没人排期的承诺", () => {
  const CHANGED_SURFACES = [
    join(PREFERENCES_DIR, "page.tsx"),
    join(PREFERENCES_DIR, "loading.tsx"),
    join(CONNECTIONS_DIR, "page.tsx"),
    join(CONNECTIONS_DIR, "loading.tsx"),
    "components/otto/OttoConnections.tsx",
    "lib/channels/channel-meta.ts",
  ];

  it.each(CHANGED_SURFACES)("%s 里没有 “coming soon” 这一族措辞", (file) => {
    // 剥掉注释再看:钉的是**商家读得到的字**。注释里引用一句已经删掉的旧措辞(“为什么删的”)
    // 是留档,不是承诺 —— 把它也判红,只会逼下一个人把删除的理由一起抹掉。
    expect(code(file)).not.toMatch(/coming soon|available soon|next (week|month)/i);
  });

  it("渠道能力那句话不再替 X 承诺「媒体快来了」——它只说今天是什么", () => {
    // W2-3 交接过来的一条:`maxMediaCount <= 0` 那一档原本写着 “Text posts · media coming soon”。
    // 它说的是渠道能力,所以搬进了渠道 meta 层,和 CHANNEL_META 住在一起。
    for (const meta of CHANNEL_META) {
      const blurb = channelCapabilityBlurb(meta.capabilities);
      expect(blurb, `${meta.label} 的能力说明在承诺时间`).not.toMatch(/soon|coming/i);
      expect(blurb.length, `${meta.label} 的能力说明空了`).toBeGreaterThan(0);
    }
    // 没有媒体能力的那一档,只留事实那半句。
    expect(channelCapabilityBlurb({ postTypes: ["text-link"], maxMediaCount: 0, supportsFirstComment: false, supportsNativeSchedule: false }))
      .toBe("Text posts only");
  });

  it("Preferences 这一面不渲染任何通知承诺(#791-2 删过,别回来)", () => {
    // 导航文案里那句 “Set your spend cap, notifications and posting defaults.” 还留着一个
    // “notifications”,但它在导航权威文件里 —— 按 Stack A 归 W2-11 改,这里只钉页面本身。
    const sections = source("components/otto/settings/sections.tsx");
    const rendered = sections
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(rendered, "通知开关又回来了 —— 产品里没有邮件发送器,也没有站内通道").not.toMatch(/notif/i);
  });
});
