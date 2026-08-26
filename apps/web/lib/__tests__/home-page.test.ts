/**
 * home-page.test.ts —— Home(`/`)的围栏。
 *
 * ── 退役立碑(Founder 2026-08-25 授权的旧架构归位)────────────────────────────────
 *
 * 这份文件原本钉的是换壳规格书 `docs/specs/wave2-shell.md` §4.1 / §7.1(W2-6)的
 * **五块仪表盘 Home**:①开场 ②接着做 ③接下来发什么 ④进行中的战役 ⑤把 Otto 装备好。
 * 围绕那五块有十七条断言:空账号的诚实空态("Nothing here yet — start your first canvas."
 * + 装备清单)、有东西时五块各就各位、五块各自的「读不出来」句、发布关着的实话逐字来自
 * `PUBLISH_PREVIEW_COPY.fact`、整页文案金样逐句对账。
 *
 * **那个规格已经被 Founder 亲自换掉了。** 2026-08-24 检查点,Founder 在三个方向里选定
 * direction 2(原话「2 很棒」),R22 Data-first Home 上位:今天的 `/` 是一屏**连接与真实
 * 数据**的门面 —— 连接闸(未连 → 引导连一个渠道)、问候、诚实的读取降级横幅、以及一句
 * 「没有验证过的数据就不画数字」。五块仪表盘在这一版里一块都没有。
 *
 * 所以那十七条不是「写错了要改对」,是**对象没了**:再改写只会得到一份钉着幽灵的绿。
 * 逐条退役理由:
 *   · 五块的空态/有东西/整块消失(6 条)—— 五个块都不存在了;
 *   · 五块各自的「读不出来」句(6 条)—— R22 把六句降级话收成**一句**整页横幅
 *     (`HOME_COPY.workspaceDataUnreadable`),它同时明说「不许由此推断出一个空态」,
 *     原则(降级 ≠ 空态,判官 r1 P3-1)因此**更强**地被钉着,只是钉在一句话上;
 *   · 发布实话两条(§7.1)—— R22 Home 不再谈发布,那句实话住在排期面与连接面;
 *   · 文案金样逐句对账(5 条)—— 见下面「④」:金样辖区按同一裁决**缩编**,只管状态句。
 *
 * 没退役、照旧有效的(它们钉的东西一个字没变):
 *   ① 数据来源枚举对账 —— Home 仍然「一个新数据函数都不写」;
 *   ② `getAnalytics` 不在这一页的 import 图上 —— Home 上没有一个 Meta 数字;
 *   ⑤ 降级只有一条路(`attempt()`),手写 catch 一个不许有;
 *   ⑦ 导航 key 真的存在;以及 `home-data.ts` 那几条纯函数规则。
 *
 * 新增、对齐 R22 现实的:③ 连接闸与诚实状态、④ 状态句只从 HOME_COPY 来。
 *
 * ── 一条上报,不在这次动 ────────────────────────────────────────────────────────
 * `HomeEntry` 仍然照旧读那八份数据并拼出整个 `HomeData`,而 `HomeView` 今天只用到
 * `data.greeting` 与那六个 `.ok` 标志(拼出那一条横幅)—— canvases / thumbs / upcoming /
 * campaigns / equipment / credits 的**值**一个都没有被渲染。那是一条活着但无人消费的管道,
 * 已上报,按「只报不删」处置:下面 ① 照旧对账它,因为它确实还在跑。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navLinkByKey } from "@fikirtive/core/navigation";
import { HOME_COPY, readOk, UNREADABLE, type HomeData } from "@/components/home/home-data";
import { HomeView, type HomeConnection } from "@/components/home/HomeView";

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
  // `(home)` 是一个路由组:不进地址(这一页仍是 `/`),只把 `loading.tsx` 的 Suspense
  // 边界圈在这一页身上,不让 Home 的骨架盖到全 app(理由全文在 `app/(home)/page.tsx`)。
  "app/(home)/page.tsx",
  "app/(home)/loading.tsx",
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
 * Home 全部数据来源的机器版 —— **全部是今天就在跑的既有函数**。
 * 这一页的硬纪律始终是「一个新数据函数都不写」,所以这份名单同时是上限:多一个数据源就红。
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
  // ③ 接下来发什么:未来 7 天的排期
  "@/lib/schedule-actions": ["listScheduledPosts"],
  // ④ 进行中的战役
  "@/lib/campaign-view-data": ["listCampaigns"],
  // ⑤ 把 Otto 装备好
  "@/lib/memory-actions": ["listMemory"],
  "@/lib/brand-record-actions": ["listBrandRecords"],
  "@/lib/otto-onboarding": ["ottoOnboardingComplete", "ottoOnboardingFacts"],
  // ⑥ 连接状态(R22 Data-first Home 的正题)—— 同样是既有读取:`/settings/connections`
  //    今天读的就是它。`MetaConnectionResult` 是它的返回类型,`HomeView` 只拿类型不拿实现。
  "@/lib/meta-actions": ["MetaConnectionResult", "getMetaConnection"],

  // ── 以下不是数据源,是既有的展示/身份权威。列在这里是为了让上面那张表**封闭**:
  //    任何一个没写在这份名单里的 @/lib 导入都会让对账红。
  "@/lib/auth-guard": ["requireOwner"],                                   // 租户身份的唯一来源
  "@/lib/credit-format": ["creditsLabel"],                                // 余额措辞(#973 的口径)
  "@/lib/my-date-format": ["MY_DATE_FORMAT", "MY_TIME_ZONE"],             // 日期与时区,只此一份
  "@/lib/schedule-view": ["formatDayHeading", "formatTime", "partsInTz", "statusPill"], // 排期面的写法
  "@/lib/social-labels": ["socialPlatformLabel"],                         // 渠道名字的唯一定义
  // 战役状态那张表(#710「the ONE campaign status table」)C7 从 `@/lib/` 搬进了 core ——
  // 同一张表换了住址,因为 packages/otto 够不着 apps/web,而 Otto 也要读它。
  "@fikirtive/core/campaign-lifecycle": ["CAMPAIGN_STATUS_BADGE", "CAMPAIGN_STATUS_LABELS", "isCampaignStatus"],
  "@fikirtive/core/navigation": ["navLinkByKey"],                         // 路径只由导航权威写
};

/** 受控 Entry 逐个读的十个来源。 */
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
  "getMetaConnection",
] as const;

describe("Home 的数据全部来自既有函数", () => {
  it("组件族的每一个文件都还在 —— 少一个,下面的对账就在核对一份残缺的清单", () => {
    for (const file of HOME_FAMILY) {
      expect(existsSync(path.join(WEB_ROOT, file)), `${file} 不见了`).toBe(true);
    }
  });

  it("数据层的 import 逐条就是那张表 —— 多一个数据源就红", () => {
    expect(homeDataLayerImports()).toEqual(HOME_DATA_SOURCES);
  });

  it("表里的十个来源,一个不少地被真的用上了", () => {
    const used = new Set(Object.values(homeDataLayerImports()).flat());
    const missing = SPEC_TABLE_FUNCTIONS.filter((name) => !used.has(name));
    expect(missing, "这几块的数据没有来源,或者来源被换成了别的东西").toEqual([]);
  });

  it("十个来源全是**既有**函数:每一个都由它所在的既有模块导出", async () => {
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
        `${fn} 不是 ${relative} 里既有的导出 —— 这一页不许新写数据函数`,
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
  const start = path.join(WEB_ROOT, "app/(home)/page.tsx");
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

describe("Home 上没有一个 Meta 数字", () => {
  it("整张 import 图翻一遍:analytics 的读取点一个都碰不到", () => {
    const graph = homeImportGraph();
    // 图本身要真的走开了 —— 只走到几个文件的话,下面两条断言就是在核对空气。
    // 2026-08-18 实测 79 个一方文件(含 lib/channels、meta-graph、meta-insights 这些 Meta 管道)。
    // 这里钉的是**下限**而不是那个数:图会随无关模块的 import 变动,钉死它只会带来无关的红。
    expect(graph.length, "import 图只走到这么几个文件 —— 这条围栏没有真的翻过 lib 层").toBeGreaterThan(50);

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

/* ── ③ R22 Data-first Home:连接闸与诚实状态 ─────────────────────────────────── */

const BASE_DATA: HomeData = {
  greeting: "Good morning, Aisha",
  credits: readOk("20 credits"),
  billingHref: "/billing",
  billingLabel: "Billing & credits",
  canvases: readOk([]),
  thumbs: readOk([]),
  upcoming: readOk([]),
  campaigns: readOk([]),
  equipment: readOk([]),
};

/** 同一个账号,但这一刻有一块读不出来。它和「都读到了」必须长得不一样。 */
const DEGRADED_DATA: HomeData = { ...BASE_DATA, canvases: UNREADABLE };

function render(connection: HomeConnection, data: HomeData = BASE_DATA): string {
  return renderToStaticMarkup(createElement(HomeView, { data, connection } as never));
}

/** 商家眼睛看到的那一串,不是 HTML 转义之后的那一串。
 *
 *  `couldn't` 在 markup 里是 `couldn&#x27;t`,`Billing & credits` 是 `Billing &amp; credits`。
 *  不还原就等于拿两套写法对账,围栏会在一个撇号上假红 —— 而它要判的是**商家读到了什么**。
 *  先剥标签再还原(顺序反了,一个还原出来的 `<` 会被当成标签);`&amp;` 放最后,否则
 *  `&amp;#x27;` 会被解成撇号。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 商家可见的字(标签/属性里的机器串不算)。 */
function visibleText(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
}

describe("连接闸:没连上就引导去连,不假装已经连上", () => {
  it("没连上:引导连第一个渠道,而且给得出跳过的路", () => {
    const text = visibleText(render({ kind: "not_connected" }));

    expect(text).toContain("Connect your first channel");
    expect(text).toContain("Skip for now");
    // 连不了的渠道照实说,而不是画一颗按不出结果的按钮。
    expect(text).toContain(HOME_COPY.channelNotAvailable);
  });

  it("过期了说重连,不说「没连过」", () => {
    const text = visibleText(render({ kind: "needs_reconnect" }));

    expect(text).toContain("Reconnect your channel");
    expect(text).not.toContain("Connect your first channel");
  });

  it("读不到连接状态时既不说连上也不说没连,且不给一颗会说谎的连接按钮", () => {
    const text = visibleText(render({ kind: "unknown", message: HOME_COPY.connectionStatusUnreadable }));

    expect(text).toContain(HOME_COPY.connectionStatusUnavailableHeading);
    expect(text).toContain(HOME_COPY.connectionStatusUnavailableBody);
    // 读不到状态,已有的连接不许被顺手标成断开。
    expect(text).toContain(HOME_COPY.nothingMarkedDisconnected);
    expect(text).not.toContain("Connect your first channel");
  });

  it("连上了但 Meta 这一刻联系不上:说联系不上,不把连接标成断开", () => {
    const text = visibleText(render({ kind: "connected", accountLabel: "Meta account", transient: true }));

    expect(text).toContain(HOME_COPY.metaUnreachable);
    expect(text).toContain(HOME_COPY.connectionVerifiedLabel);
  });
});

describe("问候来自数据,不是渲染层自己拼的", () => {
  it("屏上那一句就是 data.greeting", () => {
    expect(visibleText(render({ kind: "not_connected" }))).toContain("Good morning, Aisha");
    expect(visibleText(render({ kind: "not_connected" }, { ...BASE_DATA, greeting: "Good evening" }))).toContain("Good evening");
  });
});

describe("读不出来 ≠ 没有(判官 r1 P3-1,R22 版:一句整页横幅)", () => {
  it("有一块读不出来时,页面明说读不出来,并且明说不许由此推断出一个空态", () => {
    const text = visibleText(render({ kind: "not_connected" }, DEGRADED_DATA));

    expect(text).toContain(HOME_COPY.workspaceDataUnreadable);
    expect(HOME_COPY.workspaceDataUnreadable, "那句横幅改用人话说「不猜」,判官 [P2-2] 之后不再说 inferred").toContain("Nothing is guessed in its place");
  });

  it("全部读到了就不说那句 —— 降级态与正常态渲染出来的字不一样", () => {
    const healthy = visibleText(render({ kind: "not_connected" }, BASE_DATA));
    const degraded = visibleText(render({ kind: "not_connected" }, DEGRADED_DATA));

    expect(healthy).not.toContain(HOME_COPY.workspaceDataUnreadable);
    expect(healthy).not.toBe(degraded);
  });

  it("六块里任何一块读不出来,都算数 —— 没有一块被漏在横幅之外", () => {
    const blocks: Array<keyof HomeData> = ["credits", "canvases", "thumbs", "upcoming", "campaigns", "equipment"];
    for (const block of blocks) {
      const text = visibleText(render({ kind: "not_connected" }, { ...BASE_DATA, [block]: UNREADABLE }));
      expect(text, `${block} 读不出来,页面却什么都没说`).toContain(HOME_COPY.workspaceDataUnreadable);
    }
  });
});

describe("没有验证过的数据就不画数字", () => {
  it("没连上时:一个 Meta 数字都没有", () => {
    const text = visibleText(render({ kind: "not_connected" }));

    // Home 收静(Founder 2026-08-25 批的样张):这一句从常驻段落退场,迁到 Performance
    // 卡标题的悬停提示里(见下面「Home 收静」那一段的③)。可见文本里不该再有它。
    expect(text, "这句该在 tooltip 里,不该常驻").not.toContain(HOME_COPY.performanceVerifiedOnlyBody);
    for (const forbidden of ["48.2K", "4.8%", "Last 30 days", "+12.6%"]) {
      expect(text, `没连上的 Home 上出现了「${forbidden}」`).not.toContain(forbidden);
    }
  });

  it("连上了但还没拿到验证过的数据集:照实说,不拿一个数填坑", () => {
    const text = visibleText(render({ kind: "connected", accountLabel: "Meta account", transient: false }));

    expect(text).toContain(HOME_COPY.performanceUnavailableReady);
    expect(text).toContain(HOME_COPY.performanceUnavailableReadyBody);
    expect(text).not.toContain("48.2K");
  });

  it("样本数据只跟着显式的 fixture 走,生产路径一个字都碰不到", () => {
    const markup = renderToStaticMarkup(createElement(HomeView, {
      data: BASE_DATA,
      connection: { kind: "verified_fixture", accountLabel: "@batikhouse" },
    } as never));
    expect(markup).not.toContain("Prototype · sample data");
  });
});

/* ── ③ᐟ Home 收静(Founder 2026-08-25 批的样张:14 句常驻降到 4 句)──────────────
 *
 * 样张的减法逐条钉在这里:①连接卡「即将连接」那句解释话整句退场(页头那句灰已经说完
 * 这件事);②四步时间线收成一行步进器,任何时刻只站得住一句说明;③「What Otto will
 * analyse」三句说明迁进 tooltip,常驻的只剩三枚芯片标签;④徽章去掉内部代号。
 * 功能等量 —— 删的是常驻的字,不是背后的判断或点击行为。 */
describe("Home 收静:常驻说明句降到最少(Founder 2026-08-25 批的样张)", () => {
  /** 这一轮从「常驻」退场的五句字面量 —— 三句整句删除,一句被新措辞取代,一句迁进
   *  tooltip(见上面「没有验证过的数据就不画数字」那条)。connect-first 渲染下一个字都
   *  不该再看见。 */
  const RETIRED_SENTENCES = [
    "Otto will use your real publishing history to find patterns and recommend what to make next.",
    "Connect a channel to see real performance",
    "Start a post or campaign now. Otto will improve suggestions once a channel is connected.",
    "You can add brand context and more channels later.",
    "Optional setup never blocks creation or marks itself complete.",
  ];

  it("① connect-first 渲染下,被删的五句字面量一个都不在可见输出里", () => {
    const text = visibleText(render({ kind: "not_connected" }));
    for (const sentence of RETIRED_SENTENCES) {
      expect(text, `退场了的句子还在:「${sentence}」`).not.toContain(sentence);
    }
  });

  /** 四步的说明句原文 —— 与 `HomeView.tsx` 里 `CONNECTION_STEPS` 逐字一致。任何时刻只有
   *  当前那一步的说明会被渲染,其余三句留在代码里但不上屏。 */
  const STEP_DESCRIPTIONS = [
    "Choose a channel to get started",
    "We’ll securely verify your access",
    "We’ll import your publishing history",
    "Otto learns what is working for you",
  ];

  it("② 步进器:disconnected 时只站得住「Not connected」那一句说明", () => {
    const text = visibleText(render({ kind: "not_connected" }));
    const present = STEP_DESCRIPTIONS.filter((sentence) => text.includes(sentence));
    expect(present, "disconnected 时上屏的步说明不止一句(或不是一句)").toEqual(["Choose a channel to get started"]);
  });

  it("② 步进器:ready 时只站得住「Ready」那一句说明", () => {
    const text = visibleText(render({ kind: "connected", accountLabel: "Meta account", transient: false }));
    const present = STEP_DESCRIPTIONS.filter((sentence) => text.includes(sentence));
    expect(present, "ready 时上屏的步说明不止一句(或不是一句)").toEqual(["Otto learns what is working for you"]);
  });

  /**
   * ③ 「Otto will analyse」整块撤下(Founder 裁决 2026-08-26)。
   *
   * 上一版这条钉的是「三句说明迁进 tooltip、三枚标签留在屏上」。裁决把整块拿掉了:
   * beta 不给商家看点不动的承诺,那块卡占着洞察网格一半的版面讲一件还没发生的事。
   * 所以这条翻面 —— 钉的不再是「说明在哪」,是**整块零渲染**:标签、说明句、容器
   * class,一个都不许回来。Analytics 那扇门回来的时候连同这条一起改。
   *
   * 记法照 `r22-beta-nav-scope.test.ts` 的惯例:裁决出处写在断言旁边,不写在别处。
   */
  const ANALYSIS_COPY = [
    "Identify your best performing content and formats",
    "Understand what resonates with your audience",
    "Find your optimal posting times and consistency",
  ];

  it("③ 「Otto will analyse」承诺块整块零渲染(Founder 裁决 2026-08-26)", () => {
    for (const connection of [{ kind: "not_connected" } as const, { kind: "connected", accountLabel: "Meta account", transient: false } as const]) {
      const markup = render(connection);
      const text = visibleText(markup);
      expect(text, "承诺块的标题还在屏上").not.toContain("Otto will analyse");
      for (const sentence of ANALYSIS_COPY) {
        expect(text, `承诺块的说明句还在屏上:「${sentence}」`).not.toContain(sentence);
      }
      for (const label of ["Top content", "Audience response", "Publishing rhythm"]) {
        expect(text, `承诺块的芯片还在屏上:「${label}」`).not.toContain(label);
      }
      expect(markup, "承诺块的容器还画着 —— 它是空的,但版面还被它占着").not.toContain("r22-home-analysis");
    }

    const view = sourceOf("components/home/HomeView.tsx");
    expect(view, "ANALYSIS_ITEMS 又长回来了").not.toContain("ANALYSIS_ITEMS");
    // 网格里只剩 Performance 一张卡,得让它占满 —— 否则右边留半格空,比留着那块卡更难看。
    expect(view, "洞察网格没收成单栏").toContain('r22-home-insight-grid is-single');
  });

  it("④ 徽章去掉了内部代号,只留 fixture 披露那半句", () => {
    const markup = renderToStaticMarkup(createElement(HomeView, {
      data: BASE_DATA,
      connection: { kind: "not_connected" },
      fixture: true,
    } as never));
    expect(markup).toContain("Prototype · sample data");
    expect(markup, "内部代号「Soft Prism」还留在徽章里").not.toContain("Soft Prism");
  });
});

/* ── ③ᐟᐟ Home 收尾:ready 态三句说明迁 tooltip(地基法 5 授权)─────────────────
 *
 * 「Connection verified / Publishing permissions / Otto context」三个标签底下的常驻句
 * (`connectionVerifiedScope` / `publishingPermissionsScope` / `ottoContextScope`)迁为
 * 各自标签上的 tooltip。标签本身(label)不动,还是常驻;退场的只是标签下面那一句常驻说明。
 * 句子原文一字不改,只换住处 —— 这一段钉的就是「不在常驻文本里」。
 *
 * Tooltip 内容走 Radix `Portal`,在没有 `document` 的 SSR 环境下不会渲染进
 * `renderToStaticMarkup` 的输出(其余三处 tooltip —— Performance 标题、分析芯片 —— 已经是
 * 这个先例)。所以「真的迁进 tooltip 了」这一半靠源码断言:`HomeView.tsx` 里这三句必须真的
 * 喂给了 `<TooltipContent>`,不是被静默删掉。 */
describe("Home 收尾:ready 态连接卡三句说明迁 tooltip(地基法 5 授权)", () => {
  const READY_SUMMARY_SENTENCES = [
    HOME_COPY.connectionVerifiedScope,
    HOME_COPY.publishingPermissionsScope,
    HOME_COPY.ottoContextScope,
  ];

  it("ready 态渲染里,三句说明不在常驻可见文本里", () => {
    const text = visibleText(render({ kind: "connected", accountLabel: "Meta account", transient: false }));
    for (const sentence of READY_SUMMARY_SENTENCES) {
      expect(text, `这句该在 tooltip 里,不该常驻:「${sentence}」`).not.toContain(sentence);
    }
    // 标签本身没有退场 —— 退场的只是标签下面那句常驻说明。
    for (const label of [HOME_COPY.connectionVerifiedLabel, HOME_COPY.publishingPermissionsLabel, HOME_COPY.ottoContextLabel]) {
      expect(text, `标签不见了:「${label}」`).toContain(label);
    }
  });

  it("三句说明真的喂给了各自标签的 TooltipContent,不是被删掉了", () => {
    const view = sourceOf("components/home/HomeView.tsx");
    for (const key of ["connectionVerifiedScope", "publishingPermissionsScope", "ottoContextScope"] as const) {
      expect(view, `HOME_COPY.${key} 没有被喂进 TooltipContent`).toContain(`<TooltipContent>{HOME_COPY.${key}}</TooltipContent>`);
    }
  });
});

/* ── ④ 状态句只从 HOME_COPY 来(金样辖区缩编版) ─────────────────────────────── */

/**
 * Founder 2026-08-25 裁决:`HOME_COPY` **缩辖区不退休** —— 只管「说系统真话」的状态句
 * (读不出来 / 读不到状态 / 权限与 Meta 授权范围 / 钱),装饰性标题句解放。
 *
 * 旧围栏是**整页逐句金样**:渲染出来的每一段字都得在清单里。它治的是判官 r1 P2-1 那种
 * 「一个数字都没有的编造」。R22 Home 的版面由 Founder 亲自定稿,标题、按钮名、引导语
 * 逐句报到只会把每一次文案微调变成一次围栏改动 —— 那不是围栏,是摩擦。
 *
 * 换成**只扫状态句形状**:渲染层里凡是带真话标记(could not / unavailable / verified /
 * permission / granted by Meta …)的句子,必须是 `HOME_COPY` 里的一条。装饰句怎么写都行,
 * 但产品对商家说「我们读不到 / 我们验证过 / Meta 给了这些权限」的那一刻,措辞只有一个出处。
 */
const TRUTH_MARKERS = /could not|couldn['’]t|cannot|unavailable|not available|verified|permission|granted by Meta|Nothing was|Nothing has been|No empty state|No success|No password|No connection action|does not invent|only available|profiles you can authorize|Only the selected/i;

/** 渲染层里商家读得到的每一句候选:JSX 裸文字节点 + 带空格的成句字符串字面量。
 *  单词型字面量(class 名、枚举值、图标名)进不来 —— 它们不是说给商家听的话。 */
function proseOf(source: string): string[] {
  const bare = [...source.matchAll(/>\s*([A-Za-z][A-Za-z',.\- ]{6,})\s*</g)].map((m) => m[1].trim());
  const quoted = [...source.matchAll(/"([A-Z][^"\n]*\s[^"\n]*)"/g)].map((m) => m[1].trim());
  return [...new Set([...bare, ...quoted])];
}

describe("状态句只从 HOME_COPY 来(Founder 2026-08-25 缩辖区裁决)", () => {
  it("渲染层里没有一句裸的状态话 —— 全部经金样", () => {
    const view = sourceOf("components/home/HomeView.tsx");
    const strays = proseOf(view).filter((sentence) => TRUTH_MARKERS.test(sentence));

    expect(
      strays,
      "这些「说系统真话」的句子直接写在渲染里 —— 按 2026-08-25 裁决,它们必须住进 HOME_COPY",
    ).toEqual([]);
  });

  it("围栏本身没有空转:那把尺子确实认得出状态句", () => {
    // 拿金样里真实的几条去试尺子。全都认不出的话,上面那条就是在核对空气。
    for (const sentence of [
      HOME_COPY.workspaceDataUnreadable,
      HOME_COPY.connectionStatusUnavailableHeading,
      HOME_COPY.metaUnreachable,
      HOME_COPY.publishingPermissionsScope,
      HOME_COPY.connectSuccessBody,
    ]) {
      expect(TRUTH_MARKERS.test(sentence), `尺子认不出这一句:${sentence}`).toBe(true);
    }
    // 装饰句不该被这把尺子抓住 —— 抓住了就等于把辖区又撑回整页。
    for (const decoration of ["Pick up where you left off", "What Otto will analyse", "Create without data", "Syncing data"]) {
      expect(TRUTH_MARKERS.test(decoration), `尺子把装饰句也抓了:${decoration}`).toBe(false);
    }
  });

  /**
   * R22 Home 今天真在用的那批状态句,一条都不许是死条目。
   *
   * 不含金样里那六条五块专用的降级话(`creditsUnreadable` / `canvasesUnreadable` /
   * `thumbsUnreadable` / `scheduleUnreadable` / `campaignsUnreadable` / `equipmentUnreadable`)
   * —— 它们按裁决仍在辖区内(unreadable / 钱那一类),但描述的是 R22 已经裁掉的五个块,
   * 今天一句都不渲染。那是上面立碑里那条「活着但无人消费的管道」的一部分,只报不删。
   */
  const LEGACY_FIVE_BLOCK_KEYS = [
    "creditsUnreadable", "canvasesUnreadable", "thumbsUnreadable",
    "scheduleUnreadable", "campaignsUnreadable", "equipmentUnreadable",
  ];

  it("R22 在用的每一条状态句,渲染层真的引用了它", () => {
    const view = sourceOf("components/home/HomeView.tsx");
    const unused = Object.keys(HOME_COPY)
      .filter((key) => !LEGACY_FIVE_BLOCK_KEYS.includes(key))
      .filter((key) => !view.includes(`HOME_COPY.${key}`));

    expect(unused, "金样里长出了没人用的状态句 —— 要么接上,要么别加").toEqual([]);
  });

  it("渲染层不自己重打一份金样里的句子 —— 引用它,别复制它", () => {
    const view = sourceOf("components/home/HomeView.tsx");
    for (const [key, sentence] of Object.entries(HOME_COPY)) {
      expect(view, `${key} 被抄进渲染层了`).not.toContain(`"${sentence}"`);
    }
  });
});

/* ── ⑤ 降级只有一条路(未退役,一个字没改) ──────────────────────────────────── */

/**
 * 判官 r1 P3-1 的根 —— 入口只有**一条**降级路。
 *
 * 第一版这条围栏只认 `catch(() => [])` 那一种写法,于是一次自查演练当场穿了过去:
 * 把 `attempt(() => getProjects(ownerId))` 换成
 * `getProjects(ownerId).then(v => ({ok:true, value:v})).catch(() => ({ok:true, value:[]}))`
 * —— 同样是把「不知道」写成了「没有」,围栏却全绿。所以这里钉的是**形状**:
 * 手写的 catch 一个都不许有,每个读取都必须在那唯一的 helper 里面,
 * 而那个 helper 只落到 `UNREADABLE`。
 */
describe("读不出来 ≠ 没有:入口只有一条降级路", () => {
  it("八个读取全走 attempt(),手写 catch 一个都没有", () => {
    const source = sourceOf("components/home/HomeEntry.tsx");

    expect(
      [...source.matchAll(/\.catch\(/g)].length,
      "有读取自己接住了故障 —— 那正是「顺手返回一个空值」的入口",
    ).toBe(0);

    // 名字那一个除外:`ottoGreetingNameFromProfile` 自带 catch,而它的降级是一句通用问候,
    // 不是一个关于商家的空态。
    for (const fn of [
      "getMyAccount",
      "getProjects",
      "getRecentGenerationThumbs",
      "listScheduledPosts",
      "listCampaigns",
      "listMemory",
      "listBrandRecords",
      "getMetaConnection",
    ]) {
      expect(
        new RegExp(`attempt\\((\\(\\)\\s*=>\\s*)?${fn}\\b`).test(source),
        `${fn} 没走 attempt() —— 它自己决定了故障时长什么样`,
      ).toBe(true);
    }

    // 空值不许被包成「读到了」。
    expect(source, "把一个空值包成了「读到了」").not.toMatch(/readOk\(\s*(\[\]|\{\s*\})\s*\)/);
    expect(source, "把一个空值包成了「读到了」").not.toMatch(/ok:\s*true[\s\S]{0,40}value:\s*(\[\]|\{\s*\})/);
    expect(source).toContain("UNREADABLE");
  });

  it("那个 helper 本身只会落到 UNREADABLE —— 它是这条路唯一的出口", () => {
    const source = sourceOf("components/home/HomeEntry.tsx");
    const helper = /async function attempt<T>\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(helper, "attempt() 不见了,上面那条围栏就在核对一个不存在的形状").toContain("UNREADABLE");
    expect(helper).toContain("readOk");
    expect(helper, "helper 里出现了空值兜底").not.toMatch(/\[\]/);
  });
});

/* ── ⑦ 导航 key 必须真的存在(未退役,一个字没改) ───────────────────────────── */

/**
 * 判官 r1 P3-3 —— `navLinkByKey` 找不到 key 会 throw,而它在 `HomeEntry` 里连调三次:
 * 谁把导航树上的一个 key 改了名,Home 就整页 500。
 *
 * 修法选的是**围栏**而不是兜底地址:一条编出来的 URL 会静静把商家送到一扇不存在的门前,
 * 而那正是这一波换壳要根治的病(§1.3)。key 改名是一次 CI 红,不是一次线上 500。
 */
describe("Home 用到的三个导航 key 都在权威源里(判官 r1 P3-3)", () => {
  const KEYS = ["billing", "brand", "campaign"] as const;

  it.each(KEYS)("navLinkByKey(\"%s\") 取得到,且有真地址", (key) => {
    const link = navLinkByKey(key);
    expect(link.href.startsWith("/"), `${key} 的地址不是一条真路径`).toBe(true);
    expect(link.label.length).toBeGreaterThan(0);
  });

  it("HomeEntry 用的就是这三个 key,不多不少 —— 多一个就得先在这里报到", () => {
    const source = sourceOf("components/home/HomeEntry.tsx");
    const used = [...source.matchAll(/navLinkByKey\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    expect(used, "HomeEntry 换了导航 key,而围栏还在钉旧的那几个").toEqual([...KEYS].sort());
  });
});

/* ── 规则(纯函数,未退役) ──────────────────────────────────────────────────── */

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
