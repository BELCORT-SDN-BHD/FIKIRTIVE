/**
 * home-page.test.ts —— Home 的围栏(换壳规格书 `docs/specs/wave2-shell.md` §4.1 / §7.1,W2-6)。
 *
 * 这一页是整波换壳里**唯一**的新页面,而它最容易犯的错这个仓库已经犯过一次:#609 把旧的
 * 沉浸式首页砍掉,就是因为它摆了一屏样板经营数据(写死余额、编造的决策队列)。所以这里钉的
 * 不是「代码长什么样」,是**商家会看到什么**:
 *
 *   ① 五块的数据全部来自 §4.1 那张表里的既有函数 —— import 枚举逐条对账,多一个少一个都红。
 *   ② `getAnalytics` 不在这一页的 import 图上 —— 整张图翻一遍,不是只看第一层。
 *   ③ 空账号渲染出来的是**诚实的空**:`Nothing here yet` + 装备清单,一块数字磁贴都没有。
 *   ④ 有排期时,发布关着的那句实话**逐字**来自核心的 `PUBLISH_PREVIEW_COPY.fact`。
 *
 * 变异自查(逐一实做,做完全部还原):
 *   - 往 `HomeEntry.tsx` 加一行 `import { getAnalytics } from "@/lib/analytics-actions"`
 *     ⇒ ① 的枚举对账红(多出一个数据源)且 ② 的 import 图红(点名 lib/analytics-actions.ts)。
 *   - 往空账号的 Home 上塞一块「本月触达 1,240」磁贴 ⇒ ③ 红(空账号渲染出了数字磁贴)。
 *   两条都验过会红,这份绿才是在说事实。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PUBLISH_PREVIEW_COPY, PUBLISHING_AVAILABLE } from "@fikirtive/core/schedule-draft";
import { canvasHref } from "@/components/canvas/canvas-href";

// StartSomething 是这一页里唯一的客户端件(开工输入框,规格书 Q2-A 的共享实现)。
// 渲染它要的两样东西在 node 环境里没有,按这个仓库既有的做法 mock 掉。
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), redirect: vi.fn() }));
vi.mock("@/lib/actions", () => ({ createProject: vi.fn() }));

const WEB_ROOT = path.resolve(__dirname, "../..");

/** 注释里的东西是历史,不是代码 —— 对账前一律剥掉。 */
function sourceOf(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ── ① import 枚举对账 ───────────────────────────────────────────────────────── */

/** Home 组件族 —— 这一页的全部源码,一个文件都不许漏在对账之外。 */
const HOME_FAMILY = [
  "app/home/page.tsx",
  "app/home/loading.tsx",
  "components/home/HomeEntry.tsx",
  "components/home/HomeView.tsx",
  "components/home/home-data.ts",
] as const;

type ImportMap = Record<string, string[]>;

/** 把一个文件里 `import ... from "moduleId"` 的**名字**收出来(默认导入、具名导入、type 导入
 *  一视同仁:一个 type 导入照样把那个模块拉进图里)。 */
function importsOf(source: string): { moduleId: string; names: string[] }[] {
  const out: { moduleId: string; names: string[] }[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    const clause = match[2];
    const moduleId = match[3];
    const names: string[] = [];
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    if (braces) {
      for (const raw of braces[1].split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }
    const defaultName = clause.replace(/\{[\s\S]*?\}/, "").replace(/,/g, "").trim();
    if (defaultName && !defaultName.startsWith("*")) names.push(defaultName);
    out.push({ moduleId, names });
  }
  return out;
}

/** 整个 Home 组件族从**数据层与权威层**(`@/lib/*` 与 `@fikirtive/core*`)拿的每一个名字。
 *  UI 原语、react、next、图标不在内 —— 它们不是数据。 */
function homeDataLayerImports(): ImportMap {
  const map: ImportMap = {};
  for (const file of HOME_FAMILY) {
    for (const { moduleId, names } of importsOf(sourceOf(file))) {
      if (!moduleId.startsWith("@/lib/") && !moduleId.startsWith("@fikirtive/core")) continue;
      map[moduleId] = [...new Set([...(map[moduleId] ?? []), ...names])].sort();
    }
  }
  return map;
}

/**
 * 规格书 §4.1 那张表的机器版 —— 五块各自的真实来源,**全部是今天就在跑的既有函数**。
 * 这一票的硬纪律是「一个新数据函数都不写」,所以这份名单同时是上限:多一个数据源就红。
 */
const HOME_DATA_SOURCES: ImportMap = {
  // ① 开场:问候的名字 + credits 余额
  "@/lib/otto-greeting": ["OTTO_GENERIC_GREETING_NAME", "ottoGreetingName", "ottoGreetingNameFromProfile"],
  //   `ottoGreetingNameFromProfile` 收一个「读名字的函数」当参数(它自己带 catch),
  //   传进去的就是 /otto 页面今天传的那一个。
  "@/lib/profile-names": ["getMyProfileNames"],
  "@/lib/account-actions": ["getMyAccount"],
  // ② 接着做:最近的画布 + 最近生成的缩略图
  "@/lib/data": ["getProjects", "getRecentGenerationThumbs"],
  // ③ 接下来发什么:未来 7 天的排期 + 发布状态实话(实话由核心常量说)
  "@/lib/schedule-actions": ["listScheduledPosts"],
  "@fikirtive/core/schedule-draft": ["PUBLISHING_AVAILABLE", "publishSurfaceCopy"],
  // ④ 进行中的战役
  "@/lib/campaign-view-data": ["listCampaigns"],
  // ⑤ 把 Otto 装备好
  "@/lib/memory-actions": ["listMemory"],
  "@/lib/brand-record-actions": ["listBrandRecords"],
  "@/lib/otto-onboarding": ["ottoOnboardingComplete", "ottoOnboardingFacts"],

  // ── 以下不是数据源,是既有的展示/身份权威。列在这里是为了让上面那张表**封闭**:
  //    任何一个没写在这份名单里的 @/lib 导入都会让对账红。
  "@/lib/auth-guard": ["requireOwner"],                                   // 租户身份的唯一来源
  "@/lib/credit-format": ["creditsLabel"],                                // 余额措辞(#973 的口径)
  "@/lib/my-date-format": ["MY_DATE_FORMAT", "MY_TIME_ZONE"],             // 日期与时区,只此一份
  "@/lib/schedule-view": ["formatDayHeading", "formatTime", "partsInTz", "statusPill"], // 排期面的写法
  "@/lib/social-labels": ["socialPlatformLabel"],                         // 渠道名字的唯一定义
  "@/lib/campaign-lifecycle": ["CAMPAIGN_STATUS_BADGE", "CAMPAIGN_STATUS_LABELS", "isCampaignStatus"],
  "@fikirtive/core/navigation": ["navLinkByKey"],                         // 路径只由导航权威写
};

/** §4.1 表里逐行写着的九个数据来源。 */
const SPEC_TABLE_FUNCTIONS = [
  "ottoGreetingNameFromProfile",
  "getMyAccount",
  "getProjects",
  "getRecentGenerationThumbs",
  "listScheduledPosts",
  "listCampaigns",
  "listMemory",
  "listBrandRecords",
  "ottoOnboardingFacts",
] as const;

describe("Home 的五块数据全部来自既有函数(规格书 §4.1)", () => {
  it("组件族的每一个文件都还在 —— 少一个,下面的对账就在核对一份残缺的清单", () => {
    for (const file of HOME_FAMILY) {
      expect(existsSync(path.join(WEB_ROOT, file)), `${file} 不见了`).toBe(true);
    }
  });

  it("数据层的 import 逐条就是 §4.1 那张表 —— 多一个数据源就红", () => {
    expect(homeDataLayerImports()).toEqual(HOME_DATA_SOURCES);
  });

  it("§4.1 表里的九个来源,一个不少地被真的用上了", () => {
    const used = new Set(Object.values(homeDataLayerImports()).flat());
    const missing = SPEC_TABLE_FUNCTIONS.filter((name) => !used.has(name));
    expect(missing, "这几块的数据没有来源,或者来源被换成了别的东西").toEqual([]);
  });

  it("九个来源全是**既有**函数:每一个都由它所在的既有模块导出", async () => {
    const byName = new Map<string, string>();
    for (const [moduleId, names] of Object.entries(HOME_DATA_SOURCES)) {
      for (const name of names) if (!byName.has(name)) byName.set(name, moduleId);
    }
    for (const fn of SPEC_TABLE_FUNCTIONS) {
      const moduleId = byName.get(fn)!;
      const relative = `${moduleId.replace("@/", "")}.ts`;
      const source = sourceOf(relative);
      expect(
        new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`).test(source),
        `${fn} 不是 ${relative} 里既有的导出 —— 这一票不许新写数据函数`,
      ).toBe(true);
    }
  });

  it("Home 自己不查库:组件族里没有任何一行直接读 Prisma", () => {
    for (const file of HOME_FAMILY) {
      const source = sourceOf(file);
      expect(source, `${file} 直接连上了数据库`).not.toContain("@fikirtive/db");
      expect(source, `${file} 直接用了 prisma`).not.toMatch(/\bprisma\./);
    }
  });
});

/* ── ② getAnalytics 不在 import 图上 ─────────────────────────────────────────── */

/** 把 `@/x` 与相对路径解析成真文件(第三方与 workspace 包不进图 —— 它们不是这一页的源码)。 */
function resolveFirstParty(fromFile: string, moduleId: string): string | null {
  let base: string;
  if (moduleId.startsWith("@/")) base = path.join(WEB_ROOT, moduleId.slice(2));
  else if (moduleId.startsWith(".")) base = path.resolve(path.dirname(fromFile), moduleId);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate).length >= 0) return candidate;
      } catch {
        /* 目录 —— 继续试下一个候选 */
      }
    }
  }
  return null;
}

/** 从这一页的路由文件出发,把整张一方 import 图走完。 */
function homeImportGraph(): string[] {
  const start = path.join(WEB_ROOT, "app/home/page.tsx");
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift()!;
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { moduleId } of importsOf(source)) {
      const next = resolveFirstParty(file, moduleId);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

describe("Home 上没有一个 Meta 数字(规格书 §4.1「绝对不出现的东西」)", () => {
  it("整张 import 图翻一遍:analytics 的读取点一个都碰不到", () => {
    const graph = homeImportGraph();
    // 图本身要真的走开了 —— 只有一个文件的话,下面两条断言就是在核对空气。
    expect(graph.length).toBeGreaterThan(10);

    const analyticsModules = graph.filter((file) => file.includes("analytics-actions"));
    expect(analyticsModules, "Home 的 import 图碰到了 analytics 读取模块").toEqual([]);

    const offenders = graph.filter((file) => {
      const stripped = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return stripped.includes("getAnalytics");
    });
    expect(offenders.map((f) => path.relative(WEB_ROOT, f)), "这些文件在 Home 的图上,而它们读 Meta").toEqual([]);
  });
});

/* ── ③④ 渲染 ────────────────────────────────────────────────────────────────── */

const EMPTY_ACCOUNT_DATA = {
  greeting: "Good morning, Aisha",
  creditsLabel: "20 credits",
  billingHref: "/billing",
  billingLabel: "Billing & credits",
  canvases: [],
  thumbs: [],
  upcoming: [],
  campaigns: [],
  equipment: [
    { key: "brand", label: "Teach Otto your brand", hint: "Voice, rules, audience — Otto uses it every time", done: false, href: "/otto?view=memory" },
    { key: "products", label: "Add what you sell", hint: "Otto can only write about products it knows", done: false, href: "/otto?view=memory" },
  ],
};

async function renderHome(data: unknown): Promise<string> {
  const { HomeView } = await import("@/components/home/HomeView");
  return renderToStaticMarkup(createElement(HomeView, { data } as never));
}

/** 商家可见的字(标签/属性里的机器串不算) —— 数字磁贴要在这一层判。 */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

describe("空账号看到的是诚实的空(规格书 §4.1)", () => {
  it("那一句实话在,装备清单在", async () => {
    const text = visibleText(await renderHome(EMPTY_ACCOUNT_DATA));
    expect(text).toContain("Nothing here yet — start your first canvas.");
    expect(text).toContain("Teach Otto your brand");
    expect(text).toContain("Add what you sell");
    // 开场那一行是真的:余额来自 getMyAccount,不是一个磁贴上的装饰数字。
    expect(text).toContain("You have 20 credits.");
  });

  it("一块数字磁贴都没有:没有 Meta、没有营收/订单/客户数、没有「今日决策队列」", async () => {
    const text = visibleText(await renderHome(EMPTY_ACCOUNT_DATA)).toLowerCase();
    for (const forbidden of [
      "reach", "impressions", "engagement", "followers", "click-through", "ctr",
      "revenue", "sales", "orders", "customers", "contacts",
      "this month", "last 30 days", "decisions", "today's queue",
    ]) {
      expect(text, `空账号的 Home 上出现了「${forbidden}」`).not.toContain(forbidden);
    }
    // 余额之外,页面上不该再有第二个数字 —— 磁贴的本质就是「一个没有出处的数」。
    const numbers = (text.match(/\d[\d,.]*/g) ?? []).filter((n) => n !== "20");
    expect(numbers, "空账号的 Home 上出现了来路不明的数字").toEqual([]);
  });

  it("没有东西的两块整块不出现,而不是摆一个空壳子", async () => {
    const text = visibleText(await renderHome(EMPTY_ACCOUNT_DATA));
    expect(text).not.toContain("What goes out next");
    expect(text).not.toContain("Campaigns in progress");
  });
});

describe("有东西的账号:五块都画得出来", () => {
  it("画布、缩略图、排期、战役各就各位;装备做完了就没有第五块", async () => {
    const markup = await renderHome({
      ...EMPTY_ACCOUNT_DATA,
      canvases: [{ id: "proj-1", name: "Raya promo", updatedLabel: "12 Aug 2026" }],
      thumbs: [{ id: "gen-1", projectId: "proj-1", src: "/files/a.png", kind: "image", prompt: "Croffle set" }],
      upcoming: [{ id: "post-1", dayLabel: "Wed, Jul 10", timeLabel: "9:05 AM", channelLabel: "Instagram", statusLabel: "Scheduled", caption: "Back on Friday." }],
      campaigns: [{ id: "camp-1", name: "Raya 2026", goal: "Sell the croffle set", statusLabel: "Active", badge: "success", href: "/campaign/camp-1" }],
      equipment: null,
    });
    const text = visibleText(markup);

    expect(text).toContain("Raya promo");
    expect(text).toContain("Raya 2026");
    expect(text).toContain("Wed, Jul 10");
    expect(text).not.toContain("Nothing here yet");
    // 装备清单做完就整块消失。
    expect(text).not.toContain("Get Otto ready");
    // 画布与缩略图都点得回那张画布 —— 地址由权威源拼,这一页不自己写路径。
    expect(markup).toContain(`href="${canvasHref("proj-1")}"`);
    expect(markup).toContain('src="/files/a.png"');
  });
});

describe("有排期时,发布关着的实话逐字来自核心常量(规格书 §7.1)", () => {
  const withSchedule = {
    ...EMPTY_ACCOUNT_DATA,
    upcoming: [
      {
        id: "post-1",
        dayLabel: "Wed, Jul 10",
        timeLabel: "9:05 AM",
        channelLabel: "Instagram",
        statusLabel: "Scheduled",
        caption: "Croffle set is back on Friday.",
      },
    ],
  };

  it("那一句就是 PUBLISH_PREVIEW_COPY.fact,一个字不差", async () => {
    expect(PUBLISHING_AVAILABLE, "发布已经通电了,这条断言要按新事实改写").toBe(false);
    const text = visibleText(await renderHome(withSchedule));
    expect(text).toContain("What goes out next");
    expect(text).toContain("Wed, Jul 10");
    expect(text).toContain(PUBLISH_PREVIEW_COPY.fact);
  });

  it("这一页没有自己写第二份发布措辞", async () => {
    const source = sourceOf("components/home/HomeView.tsx");
    expect(source).not.toContain("Publishing is not switched on");
    expect(source).toContain("publishSurfaceCopy()");
  });
});

/* ── 五块的规则(纯函数) ─────────────────────────────────────────────────────── */

describe("Home 的规则(components/home/home-data.ts)", () => {
  it("问候按**商家的**钟点说,不是服务器的", async () => {
    const { homeGreeting } = await import("@/components/home/home-data");
    // 2026-08-18 01:00Z = 吉隆坡 09:00(UTC+8)。服务器读 UTC 会说 Good morning 也没错,
    // 所以再取一个两边会分家的时刻:15:00Z = 吉隆坡 23:00。
    expect(homeGreeting("Aisha Rahman", new Date("2026-08-18T01:00:00Z"))).toBe("Good morning, Aisha");
    expect(homeGreeting("Aisha Rahman", new Date("2026-08-18T15:00:00Z"))).toBe("Good evening, Aisha");
    expect(homeGreeting("Aisha Rahman", new Date("2026-08-18T06:00:00Z"))).toBe("Good afternoon, Aisha");
  });

  it("名字解析不出来时就不带名字 —— 不说 “Good morning, there”", async () => {
    const { homeGreeting } = await import("@/components/home/home-data");
    expect(homeGreeting("there", new Date("2026-08-18T01:00:00Z"))).toBe("Good morning");
  });

  it("「接下来发什么」不把已经发出去/取消掉的算进来", async () => {
    const { upcomingPosts } = await import("@/components/home/home-data");
    const row = (id: string, status: string) => ({
      id, status, channel: "instagram", caption: "c",
      scheduledAt: new Date("2026-08-19T02:00:00Z"), scheduledTz: "Asia/Kuala_Lumpur",
    });
    const got = upcomingPosts([row("a", "SCHEDULED"), row("b", "PUBLISHED"), row("c", "CANCELLED"), row("d", "DRAFT")]);
    expect(got.map((p) => p.id)).toEqual(["a", "d"]);
    expect(got[0].timeLabel).toBe("10:00 AM"); // 按这条排期自己的时区
  });

  it("窗口就是「从此刻起 7 天」", async () => {
    const { upcomingWindow } = await import("@/components/home/home-data");
    const now = new Date("2026-08-18T00:00:00Z");
    expect(upcomingWindow(now)).toEqual({ from: "2026-08-18T00:00:00.000Z", to: "2026-08-25T00:00:00.000Z" });
  });

  it("「进行中的战役」不含收了工的那些", async () => {
    const { openCampaigns } = await import("@/components/home/home-data");
    const row = (id: string, status: string) => ({ id, status, name: id, goal: "g" });
    const got = openCampaigns([row("a", "ACTIVE"), row("b", "DONE"), row("c", "DRAFT"), row("d", "CANCELLED")], "/campaign");
    expect(got.map((c) => c.id)).toEqual(["a", "c"]);
    expect(got.map((c) => c.statusLabel)).toEqual(["Active", "Draft"]);
    // 地址由调用方从导航权威源拼好递进来 —— Home 不自己写第二份 `/campaign`(§1.3)。
    expect(got.map((c) => c.href)).toEqual(["/campaign/a", "/campaign/c"]);
  });

  it("装备清单做完就整块消失,没做完就照实说哪一格还欠着", async () => {
    const { equipmentSteps } = await import("@/components/home/home-data");
    expect(equipmentSteps({ brandMemoryCount: 2, productCount: 1, brandHref: "/brand" })).toBeNull();

    const half = equipmentSteps({ brandMemoryCount: 2, productCount: 0, brandHref: "/brand" });
    expect(half).not.toBeNull();
    expect(half!.map((s) => [s.key, s.done])).toEqual([["brand", true], ["products", false]]);
  });
});
