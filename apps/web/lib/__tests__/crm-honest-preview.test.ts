// @vitest-environment jsdom
/**
 * CRM 折叠成诚实预览入口(#792)—— 双面围栏 + **能力真值核验**。
 *
 * Founder 裁决(2026-08-08):七扇 CRM 门收成一个「Customer(预览版)」入口,诚实说明消息
 * 渠道未接通、现在能做的是建客户档案。
 *
 * **r2 判词 P2 —— 这份围栏的第一版只核链接与关键词,所以它给一句假话开了绿灯**:页面写着
 * 「这些面都已完成,全都只差渠道」,而五面里没有一面是「只差渠道」。围栏当时问的是「有没有
 * 写卡点」,不是「写的卡点是不是真的」。差别就是这一票的全部内容。
 *
 * 所以现在分四层:
 *   ① **UI** —— 导轨只剩一格、点开前就说自己是预览、七个表面一个都没被藏起来;
 *   ② **能力真值** —— 页面上每一句卡点都必须在**实现里找得到证据**(那个永远失败的
 *      chokepoint 还在、那个只会写 simulated 的分支还在、那两个没接通的事实还在)。实现
 *      变了这里就红,红了就该回来改文案 —— 这正是「说的与做的」被绑在一起的地方;
 *   ③ **真行为** —— 「What works today」两面各跑一次真组件:联系人走真提交路径断言真 action
 *      收到的载荷,分群渲染真页面断言它自己承认哪两个事实没接通;
 *   ④ **Otto** —— 地图带同一句实话,而且**空渠道口径全仓一份**(r2 判词 P1:旧指令还在劝
 *      商家去连一条连不了的渠道)。
 *
 * 零后端、零生成:静态渲染 + 源码读取 + jsdom 里的真组件事件。
 */
import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { everyNavDestination, merchantNavMap, navLinkByKey } from "@fikirtive/core/navigation";
import {
  MESSAGING_STATUS_ASSISTANT,
  MESSAGING_STATUS_CANNOT_CONNECT,
  MESSAGING_STATUS_MERCHANT,
} from "@fikirtive/core/messaging-status";
import { MerchantShellContent } from "@/components/global-navigation";
import CustomersPreviewPage, { IN_PREVIEW, WORKS_TODAY } from "@/components/crm/customers-preview-page";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/otto"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/tenant-actions", () => ({
  stopImpersonatingTenant: vi.fn(),
}));

// 联系人那条真行为断言要驱动**真的**提交路径,所以只把它最外层那两个 server action 换成
// 探针 —— 组件、表单、事件、状态全部是真的。
vi.mock("@/lib/crm-actions", () => ({
  createContact: vi.fn(),
  importContacts: vi.fn(),
}));
vi.mock("@/lib/crm-view-data", () => ({
  listContacts: vi.fn(async () => ({ ok: true, contacts: [], total: 0, nextCursor: null })),
}));

import ContactsPage from "@/components/crm/contacts-page";
import { sendStatePresentation } from "@/components/crm/reports/report-format";
import SegmentsPage from "@/components/crm/segments-page";
import { createContact } from "@/lib/crm-actions";

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

/** 折叠掉的那七个表面。它们的**路由一页没删** —— 引擎原地保留,等一处一处接通。 */
const FOLDED_CRM_SURFACES: readonly string[] = [
  "/crm/inbox",
  "/crm/contacts",
  "/crm/segments",
  "/crm/templates",
  "/crm/broadcasts",
  "/crm/workflows",
  "/crm/reports",
];

const CUSTOMERS = navLinkByKey("customers");
/** 那句实话本身。围栏的每一条都指着它,所以先在这里断一次它真的存在。 */
const PREVIEW_TRUTH = CUSTOMERS.preview ?? "";

const ALL_ENTRIES = [...WORKS_TODAY, ...IN_PREVIEW];
const ENTRY_BY_HREF = new Map(ALL_ENTRIES.map((entry) => [entry.href, entry]));
const IN_PREVIEW_HREFS = IN_PREVIEW.map((entry) => entry.href);

function entry(href: string) {
  const found = ENTRY_BY_HREF.get(href);
  if (!found) throw new Error(`预览页没有 ${href} 这一条`);
  return found;
}

function source(relativeToWebRoot: string): string {
  return readFileSync(path.join(WEB_ROOT, relativeToWebRoot), "utf8");
}

/** 实现不一定住在 apps/web 里 —— Routine 的写入点在 packages/db。 */
function repoSource(relativeToRepoRoot: string): string {
  return readFileSync(path.join(REPO_ROOT, relativeToRepoRoot), "utf8");
}

/**
 * 从 `openIndex` 处那个 `{` 起,取到与它配对的 `}` —— 括号配平,且跳过字符串与注释。
 *
 * r4 判词 P2:上一版靠「下一个 `\n  }`」猜函数体边界,而 evidence 又整文件搜。于是一条
 * 「实现里必须有这个形状」的断言,可以被文件里**任何**地方的同形文本喂饱 —— 包括一段类型
 * 声明。判定范围必须是真实现那一块,才谈得上「实现变了就红」。
 */
function balancedBlockFrom(text: string, openIndex: number): string {
  let depth = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  throw new Error("这个块没有闭合");
}

/** 某个标记之后的第一个 `{ … }` 块 —— 用来钉住一次真正的写入(而不是整份文件)。 */
function blockAfter(text: string, marker: string): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`找不到 ${marker}`);
  const open = text.indexOf("{", at + marker.length);
  if (open < 0) throw new Error(`${marker} 后面没有块`);
  return balancedBlockFrom(text, open);
}

/** 取一个具名函数的函数体 —— 断言「这一支永远失败」时必须只看这一支。 */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 ${name}`);

  // 先跳过参数表(它自己可能带括号),函数体是它后面的第一个 `{`。
  let depth = 0;
  let i = text.indexOf("(", start);
  for (; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const open = text.indexOf("{", i);
  if (open < 0) throw new Error(`${name} 没有函数体`);
  return balancedBlockFrom(text, open);
}

function renderShell(pathname: string): string {
  return renderToStaticMarkup(
    createElement(
      MerchantShellContent,
      { pathname, signOutAction: vi.fn(async () => undefined) },
      createElement("div", null, "Page content"),
    ),
  );
}

/** 渲染出来的 markup 会把 `'` 之类转成实体,所以文案比对一律在**解码后的文字**上做 —— 否则
 *  一个撇号就能让「这句话画到页面上了没有」这条围栏永远绿或永远红。 */
function decode(markup: string): string {
  return markup
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const previewMarkup = decode(renderToStaticMarkup(createElement(CustomersPreviewPage)));

const ottoInstructionsText = readFileSync(
  path.join(REPO_ROOT, "packages/otto/src/__snapshots__/otto-instructions.golden.txt"),
  "utf8",
);

/* ── ① UI 一面 ─────────────────────────────────────────────────────────────── */

describe("导轨上只剩一格,而且它先说自己是预览", () => {
  it("七扇 CRM 门在导轨里一扇都不剩", () => {
    const markup = renderShell("/campaign");

    const stillInTheRail = FOLDED_CRM_SURFACES.filter((href) => markup.includes(`href="${href}"`));
    expect(stillInTheRail, "折叠没做完:这些子门还在主导航上").toEqual([]);
  });

  it("剩下的那一格通向预览页", () => {
    expect(renderShell("/campaign")).toContain(`href="${CUSTOMERS.href}"`);
    expect(CUSTOMERS.href).toBe("/crm");
  });

  it("点开之前就看得到 Preview —— 徽章画的是权威源里的那句实话", () => {
    // 先证明有对象:实话是空的,底下每一条 toContain 都会白白通过。
    expect(PREVIEW_TRUTH.length, "Customers 这扇门没有那句实话").toBeGreaterThan(40);

    const markup = renderShell("/campaign");
    expect(markup).toContain(">Preview<");
    expect(markup).toContain(PREVIEW_TRUTH);
  });

  it("能力齐的门不许长出 Preview 徽章(徽章只跟着 preview 字段走)", () => {
    const markup = renderShell("/campaign");
    const badges = markup.match(/>Preview</g) ?? [];
    const previewDoors = everyNavDestination().filter((item) => item.preview);

    expect(badges.length).toBe(previewDoors.length);
  });

  it("站在任何一个 CRM 表面上,亮的都是这一格", () => {
    for (const surface of ["/crm", ...FOLDED_CRM_SURFACES]) {
      expect(renderShell(surface), surface).toMatch(
        // r3:预览门的 title 现在带着那句实话(见「各断点都诚实」那一组),所以按前缀匹配。
        new RegExp(`aria-current="page" title="${CUSTOMERS.label} — Preview\\.`),
      );
    }
  });
});

/* ── 各断点都诚实:徽章的可见性由**真编译出来的 CSS** 说了算(r3 判词 P1-1)────────── */

/**
 * r2 的围栏只断言「服务端 HTML 里有那枚徽章」。徽章带着 `lg:hidden xl:inline-flex`,标签带着
 * `lg:hidden xl:inline` —— 于是 1024–1279(最常见的笔电宽度)那一档,导轨只剩一个没有任何
 * 说明的图标,而围栏照绿。**HTML 里存在 ≠ 屏幕上看得见**,这一组补的就是这半句。
 *
 * 判定不靠我重写一份 Tailwind 语义,而是把这些类名喂给**产品自己那条 Tailwind v4 管线**
 * (@tailwindcss/node,`next build` 用的同一个编译器,做法与 design-tokens.test.ts 一致),
 * 再从编译出来的 CSS 里读每个断点下的 `display`。
 */
const RAIL_TIERS = [
  { width: 375, what: "手机抽屉" },
  { width: 800, what: "平板" },
  { width: 1100, what: "笔电(图标档,判词点名的那一档)" },
  { width: 1440, what: "宽屏" },
] as const;

/**
 * 一个工具类生成的那条 `display` 规则(以及它属于哪个断点)。
 *
 * Tailwind v4 把断点写成**嵌套**在类规则里的 `@media`:
 *   `.lg\:block { @media (width >= 64rem) { display: block } }`
 * 所以判定是「找到这个类的规则块,再看 display 落在块内哪一层」,不是去切顶层 @media。
 * 不生成 display 的类(例如 `shrink-0`)返回 null。
 */
function displayRuleOf(css: string, token: string): { minWidth: number; display: string } | null {
  const selector = `.${token.replace(/([:.[\]/])/g, "\\$1")}`;
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;

  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
    i += 1;
  }
  const body = css.slice(open + 1, i - 1);

  const nested = /@media\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/.exec(body);
  if (nested) {
    const display = /display:\s*([^;}]+)/.exec(nested[2]);
    if (!display) return null;
    const rem = /width\s*>=\s*([\d.]+)rem/.exec(nested[1]);
    const px = /width\s*>=\s*([\d.]+)px/.exec(nested[1]);
    return {
      minWidth: rem ? Number(rem[1]) * 16 : px ? Number(px[1]) : 0,
      display: display[1].trim(),
    };
  }

  const display = /display:\s*([^;}]+)/.exec(body);
  return display ? { minWidth: 0, display: display[1].trim() } : null;
}

/** 这串 class 在 `width` 这个宽度下,元素的 display 是什么 —— 断点最大的那条赢。 */
function displayAt(css: string, className: string, width: number): string {
  const applicable = className
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => displayRuleOf(css, token))
    .filter((rule): rule is { minWidth: number; display: string } => rule !== null)
    .filter((rule) => rule.minWidth <= width)
    .sort((left, right) => left.minWidth - right.minWidth);
  return applicable.at(-1)?.display ?? "inline";
}

function visibleAt(css: string, className: string, width: number): boolean {
  return displayAt(css, className, width) !== "none";
}

/** 产品自己那条 Tailwind v4 管线(与 design-tokens.test.ts 同一条路)。 */
async function compileUtilities(candidates: string[]): Promise<string> {
  const require_ = createRequire(path.join(WEB_ROOT, "package.json"));
  const requireFromPostcss = createRequire(require_.resolve("@tailwindcss/postcss"));
  const { compile } = await import(
    pathToFileURL(requireFromPostcss.resolve("@tailwindcss/node")).href
  );
  const entry = path.join(WEB_ROOT, "app/globals.css");
  const compiler = await compile(await readFile(entry, "utf8"), {
    base: path.dirname(entry),
    onDependency: () => {},
  });
  return compiler.build(candidates);
}

/** 导轨里 Customers 那一行的 markup —— 只在这一行里找诚实标识,免得别处的字混进来。 */
function customersRailRow(): string {
  const markup = renderShell("/campaign");
  const start = markup.indexOf(`href="${CUSTOMERS.href}"`);
  expect(start, "导轨里找不到 Customers 那一行").toBeGreaterThan(-1);
  const open = markup.lastIndexOf("<a", start);
  const end = markup.indexOf("</a>", start);
  return markup.slice(open, end);
}

describe("Preview 在每一个断点都说得出口(r3 判词 P1-1)", () => {
  const row = customersRailRow();
  // 徽章与那颗点:两块可见的诚实标识,各管一段宽度。
  const badgeClass = /<span[^>]*class="([^"]*)"[^>]*>Preview</.exec(row)?.[1] ?? "";
  const dotClass = /<span[^>]*data-preview-dot[^>]*class="([^"]*)"/.exec(row)
    ?? /<span[^>]*class="([^"]*)"[^>]*data-preview-dot/.exec(row);
  const previewDotClass = dotClass?.[1] ?? "";

  let css = "";

  beforeAll(async () => {
    css = await compileUtilities([
      ...badgeClass.split(/\s+/),
      ...previewDotClass.split(/\s+/),
      "bg-warning",
      // 自检用的合成类,必须与产品用的是同一批语义。
      "hidden",
      "block",
      "lg:block",
      "xl:hidden",
      "lg:hidden",
      "xl:inline-flex",
    ]);
  }, 60_000);

  it("两块标识都真的在这一行里(找不到就等于底下全是空转)", () => {
    expect(badgeClass, "徽章不在 Customers 那一行").not.toBe("");
    expect(previewDotClass, "图标档那颗点不在 Customers 那一行").not.toBe("");
  });

  // 自检①:判定器逮得住 —— 一个在该宽度下确实被藏起来的类,必须被判为不可见。
  it("判定器逮得住:lg:hidden 在 1100 判不可见,xl:inline-flex 在 1440 判可见", () => {
    expect(displayAt(css, "hidden lg:hidden xl:inline-flex", 1100)).toBe("none");
    expect(visibleAt(css, "hidden lg:hidden xl:inline-flex", 1100)).toBe(false);
    expect(visibleAt(css, "hidden lg:hidden xl:inline-flex", 1440)).toBe(true);
  });

  // 自检②:判定器不误伤 —— 只在中间那一档出现的写法,必须两头判不可见、中间判可见。
  it("判定器不误伤:hidden lg:block xl:hidden 只在 1024–1279 可见", () => {
    expect(visibleAt(css, "hidden lg:block xl:hidden", 800)).toBe(false);
    expect(visibleAt(css, "hidden lg:block xl:hidden", 1100)).toBe(true);
    expect(visibleAt(css, "hidden lg:block xl:hidden", 1440)).toBe(false);
    // 没有任何 display 工具类时不许瞎判成隐藏。
    expect(visibleAt(css, "shrink-0 rounded-full", 1100)).toBe(true);
  });

  it.each(RAIL_TIERS.map((tier) => [tier.width, tier.what] as const))(
    "%dpx(%s):这一行至少有一块看得见的诚实标识",
    (width) => {
      const visible = [
        ["badge", badgeClass],
        ["dot", previewDotClass],
      ].filter(([, className]) => visibleAt(css, className, width));

      expect(
        visible.map(([name]) => name),
        `${width}px 下 Customers 只剩一个没有说明的入口 —— 「点开之前就诚实」在这一档失效了`,
      ).not.toEqual([]);
    },
  );

  it("而且它的名字在**每一个**宽度都带着实话(徽章有没有地方画都一样)", () => {
    const row = customersRailRow();

    // 无障碍名字与 tooltip 不吃宽度,所以它们是那句实话的底线。
    expect(row).toContain(`aria-label="${CUSTOMERS.label} (preview)"`);
    expect(row).toContain(`title="${CUSTOMERS.label} — Preview. ${PREVIEW_TRUTH}"`);
  });

  it("那颗点是真的画得出来的 —— 尺寸与颜色都编译得出规则", () => {
    // display 判定说它「在这一档不是 none」,但一个拼错的颜色类会让它照样看不见。
    // 所以再核一层:它的每个类都真的生成了声明,而且真有背景色。
    const tokens = previewDotClass.split(/\s+/).filter(Boolean);
    const dead = tokens.filter((token) => {
      const selector = `.${token.replace(/([:.[\]/])/g, "\\$1")}`;
      return !css.includes(`${selector} {`);
    });
    expect(dead, "这些类名没编译出任何规则(多半是拼错了)").toEqual([]);

    const background = css.slice(css.indexOf(".bg-warning {"));
    expect(background.slice(0, 120)).toMatch(/background-color:/);
  });

  it("能力齐的门不许被这套标识碰到", () => {
    const markup = renderShell("/campaign");
    const campaignAt = markup.indexOf('href="/campaign"');
    const campaignRow = markup.slice(markup.lastIndexOf("<a", campaignAt), markup.indexOf("</a>", campaignAt));

    expect(campaignRow).not.toContain("data-preview-dot");
    expect(campaignRow).not.toContain("aria-label=");
    expect(campaignRow).toContain('title="Campaign"');
  });
});

describe("预览页先说实话,再指路", () => {
  it("第一屏就说渠道连不上 —— 与导轨读的是同一句", () => {
    expect(previewMarkup).toContain(PREVIEW_TRUTH);
    expect(previewMarkup).toContain(">Preview<");
  });

  it("折叠掉的七个表面一个都没被藏起来 —— 都还进得去", () => {
    const unreachable = FOLDED_CRM_SURFACES.filter(
      (href) => !previewMarkup.includes(`href="${href}"`),
    );
    expect(unreachable, "这些页面活着,却在产品里没有门了").toEqual([]);
  });

  it("七个表面每一个都写了自己的卡点 —— 不许只在页首写一句总的", () => {
    for (const href of FOLDED_CRM_SURFACES) {
      const row = entry(href);
      expect(row.works.length, `${href} 没写今天真的做得到什么`).toBeGreaterThan(30);
      expect(row.blocked.length, `${href} 没写今天真实卡在哪`).toBeGreaterThan(30);
      expect(previewMarkup, `${href} 的卡点没画到页面上`).toContain(row.blocked);
    }
  });

  it("不再说「全都只差渠道」—— 五个卡点各不相同(r2 判词 P1)", () => {
    const blocked = IN_PREVIEW_HREFS.map((href) => entry(href).blocked);

    // 五句互不相同:一句复制五遍就是「只差一根线」的另一种写法。
    expect(new Set(blocked).size).toBe(blocked.length);
    expect(previewMarkup).not.toMatch(/the same missing piece|all (?:of them )?stop at the same/i);
    // 第一屏必须明说「就算接上渠道也还不够」,否则读者仍会读成单一卡点。
    expect(previewMarkup).toMatch(/on its own would still not be enough/i);
  });

  it("不承诺工期,也不写「coming soon」", () => {
    expect(previewMarkup).not.toMatch(/coming soon/i);
    expect(previewMarkup).not.toMatch(
      /\bby (?:Q[1-4]|January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
    );
  });

  it("死路有出口 —— 商家读完实话,还有一个人可以找(#771 出口层)", () => {
    expect(previewMarkup).toContain("mailto:");
  });

  it("「连不上渠道」这个产品事实全仓只有一个常量(r3 判词 P2-1)", () => {
    // 这句话原来有两份:crm-channel-connection.ts 自己声明了一份,messaging-status.ts 又一份,
    // 而预览页把两份**前后脚渲染了出来**。收编之后,声明只剩 core 里那一个。
    expect(source("lib/crm-channel-connection.ts")).not.toMatch(
      /=\s*"Messaging channels are not available to connect yet\."/,
    );
    expect(MESSAGING_STATUS_MERCHANT.startsWith(MESSAGING_STATUS_CANNOT_CONNECT)).toBe(true);

    // 三个调用点都读 core 那一份,谁都不再手写这句话。
    for (const file of [
      "components/crm/inbox/inbox-list-page.tsx",
      "components/crm/inbox/inbox-templates-page.tsx",
      "lib/crm-channel-connection.ts",
    ]) {
      expect(source(file), file).toContain("MESSAGING_STATUS_CANNOT_CONNECT");
      expect(source(file), `${file} 又手抄了一遍`).not.toContain(
        `"${MESSAGING_STATUS_CANNOT_CONNECT}"`,
      );
    }

    // 预览页不再把同一件事说两遍:那句话是 door.preview 的第一句,页面只渲染 door.preview。
    const sentenceCount = previewMarkup.split(MESSAGING_STATUS_CANNOT_CONNECT).length - 1;
    expect(sentenceCount, "同一个事实在预览页上出现了不止一次").toBe(1);
  });
});

/* ── ② 能力真值:每一句卡点都在实现里找得到证据 ─────────────────────────────── */

/**
 * 左边是页面上的说法,右边是实现里的证据。
 *
 * `evidence` 全部命中 = 这句卡点今天成立;任何一条不再命中 = 那个卡点被接通了(或被挪走了),
 * 围栏立刻红,**页面上那句话必须跟着改**。这就是判词 P2 要的那种绑定:围栏核的不是「写没写」,
 * 是「写的是不是真的」。
 */
const CAPABILITY_TRUTH: readonly {
  readonly href: string;
  readonly what: string;
  readonly evidence: readonly {
    /** 相对 apps/web;`repo: true` 时相对仓库根(实现不一定住在 web 里)。 */
    readonly file: string;
    readonly repo?: boolean;
    readonly probe: RegExp;
    /** 只看这个具名函数的函数体 —— 断言「这一支永远失败」时必须只看这一支。 */
    readonly slice?: string;
    /** 只看这个标记后面那一个 `{ … }` 块 —— 用来钉住一次真正的写入。 */
    readonly block?: string;
    /** 反向证据:出现即说明卡点没了(例如写得出 `simulated: false`)。 */
    readonly absent?: RegExp;
  }[];
  /** 页面那句 `blocked` 必须说到的事。 */
  readonly claim: RegExp;
}[] = [
  {
    href: "/crm/inbox",
    what: "回复送出是一个永远失败的 chokepoint(没有承载体)",
    evidence: [
      {
        file: "lib/customer-inbox-service.ts",
        slice: "submitConversationReply",
        probe: /fail\("SEND_PATH_UNAVAILABLE"\)/,
      },
    ],
    claim: /sending a reply is refused/i,
  },
  {
    href: "/crm/templates",
    what: "送审这条路没建,版本永远拿不到批准",
    evidence: [
      {
        file: "lib/customer-inbox-service.ts",
        slice: "submitTemplateReview",
        probe: /fail\("TEMPLATE_SUBMISSION_UNAVAILABLE"\)/,
      },
      // 模板页自己也这么说 —— 同一个事实两处,不许一处改了另一处不知道。
      { file: "components/crm/inbox/inbox-templates-page.tsx", probe: /provider submission isn't available yet/ },
    ],
    claim: /approval is not built|stays? unapproved/i,
  },
  {
    href: "/crm/broadcasts",
    what: "真发无条件失败,唯一会动的是模拟分支",
    evidence: [
      {
        file: "lib/customer-broadcast-service.ts",
        slice: "submitBroadcastRun",
        probe: /fail\("SEND_PATH_UNAVAILABLE"\)/,
      },
    ],
    claim: /real send is refused|simulated-sent/i,
  },
  {
    href: "/crm/workflows",
    what: "唯一那次写入把 simulated 钉死为 true,写不出别的",
    evidence: [
      // r3 判词 P2-2:原来这一条只搜另一页的一句文案 —— 拿文案证明文案。真身在这里。
      // r4 判词 P3:并且**真正的写入只有一处** —— `tx.routineRun.createMany`。所以断言钉在
      // 那一次写入的 data 块上,不再整文件搜。
      {
        file: "packages/db/src/workflow-engine.ts",
        repo: true,
        block: "tx.routineRun.createMany(",
        probe: /simulated: true/,
      },
      // 另一处 `simulated: true` 在 `expected` 里 —— 那是**比对记录**,不是写入:
      // `sameRunComparison` 拿它核对落库结果,所以写入一旦漂移就会被它拦下。两处一起钉,
      // 「写入是模拟的」这件事才既写得对、也核得住。
      {
        file: "packages/db/src/workflow-engine.ts",
        repo: true,
        block: "const expected: RoutineRunRecord =",
        probe: /simulated: true/,
      },
      // 全文件写得出 false 的那一天,这一条红 —— 那正是回来改这句文案的时刻。
      {
        file: "packages/db/src/workflow-engine.ts",
        repo: true,
        probe: /simulated/,
        absent: /simulated:\s*false/,
      },
    ],
    claim: /every run is simulated/i,
  },
  {
    href: "/crm/reports",
    what: "报告服务把 delivered / read / failed 三个轴钉死成 unknown+null",
    evidence: [
      // r3 判词 P2-2:同样不再拿另一页的句子当证据。真身是报告服务返回的形状。
      // r4 判词 P2:而且必须**只看那个函数体**。整文件搜时,同一份文件顶上的 `Report` 类型
      // 声明里也写着 delivered/read/failed —— 把真返回值改错,类型声明照样喂饱断言。
      {
        file: "lib/customer-broadcast-report-service.ts",
        slice: "getCustomerBroadcastReport",
        probe: /delivered: \{ status: "unknown", value: null \}/,
      },
      {
        file: "lib/customer-broadcast-report-service.ts",
        slice: "getCustomerBroadcastReport",
        probe: /read: \{ status: "unknown", value: null \}/,
      },
      {
        file: "lib/customer-broadcast-report-service.ts",
        slice: "getCustomerBroadcastReport",
        probe: /failed: \{ status: "unknown", value: null \}/,
      },
    ],
    claim: /no provider receipts are connected/i,
  },
];

describe("每一句卡点都绑着实现里的证据(r2 判词 P2)", () => {
  it.each(CAPABILITY_TRUTH.map((row) => [row.href, row] as const))(
    "%s 的说法与实现对得上",
    (href, row) => {
      for (const item of row.evidence) {
        const whole = item.repo ? repoSource(item.file) : source(item.file);
        const text = item.slice
          ? functionBody(whole, item.slice)
          : item.block
            ? blockAfter(whole, item.block)
            : whole;
        expect(
          text,
          `${href}:${row.what} —— 这条证据在 ${item.file} 里没了。卡点接通了就回预览页改那句话`,
        ).toMatch(item.probe);
        if (item.absent) {
          expect(
            text,
            `${href}:${item.file} 里出现了 ${item.absent} —— 卡点松了,预览页那句话必须跟着改`,
          ).not.toMatch(item.absent);
        }
      }
      expect(entry(href).blocked, `${href} 的文案没说到 ${row.what}`).toMatch(row.claim);
    },
  );

  it("广播只写得出模拟的发送状态 —— 出现真发状态就红", () => {
    const states = new Set(
      [...source("lib/customer-broadcast-service.ts").matchAll(/sendState: "([a-z_]+)"/g)].map(
        (match) => match[1],
      ),
    );

    expect([...states].sort()).toEqual(["pending", "simulated_sent", "skipped_ineligible"]);
  });

  it("分群没接通的正好是页面点名的那两个事实", () => {
    const declared = /const UNAVAILABLE_FACTS = \{([^}]*)\}/.exec(source("lib/segment-actions.ts"))?.[1] ?? "";
    const facts = [...declared.matchAll(/(\w+):/g)].map((match) => match[1]).sort();

    expect(facts, "分群的事实接通情况变了").toEqual(["lastOrderAt", "tags"]);
    // 页面必须点名这两个,而且不许把它们写进「做得到」那一句。
    const segments = entry("/crm/segments");
    expect(segments.blocked).toMatch(/last order recency/i);
    expect(segments.blocked).toMatch(/tags/i);
    expect(segments.works).not.toMatch(/last order|tag/i);
  });

  it("分群那条规则说的是「已知退订」,不是「联系得上」(r3 判词 P1-2)", () => {
    // 规则的真身:phrase 只会说 known opt-out,页面上那两个选项也是。DND 开着的联系人**留在**
    // 分群里(segment-actions 那条断言守着),所以「按能不能联系分群」是一句对外的假话。
    const rules = source("lib/segment-actions.ts");
    expect(rules).toContain("contact is not a known opt-out");
    expect(rules).toContain("contact is a known opt-out");
    expect(source("components/crm/segments-page.tsx")).toContain("Not known opt-out");

    const segments = entry("/crm/segments");
    expect(segments.works, "分群那句话没说到「已知退订」").toMatch(/known opt-out/i);
    expect(
      segments.works,
      "分群那句话又把「已知退订」说成了「联系得上」—— DND 开着的联系人仍在群里",
    ).not.toMatch(/contact(ed|able)|reach(able)?|whether they can be/i);
  });

  /* ── r4 判词 P1:同一把尺子,扫描面扩一档 ─────────────────────────────────────
   *
   * r3 只量了预览页与导轨,于是 `segments-page.tsx` 那行 `N contactable` 计数漏了网 —— 它数
   * 的是 `!isKnownOptOut(truth)`,DND 开着的联系人照算,所以「contactable」是这个数没做过的
   * 承诺。同一句假话换个页面就躲过去,说明尺子太短,不是文案太多。
   *
   * 现在扫**整个 CRM 商家面**。禁的是**说法**,不是变量名:同一个词出现在
   * `preview.contactableCount`、`contact.contactable`、`value="contactable"` 里都放行,因为它
   * 们是机器读的;裸着出现在一行字中间(前后都不是标识符/引号的一部分)才是说给商家听的。
   */
  const OVERPROMISE =
    /contactabl\w*|contactability|reachabl\w*|can be contacted|able to contact|can reach|able to reach|reach(?:es|ed)? (?:them|him|her|the customer|the contact|customers|contacts)/i;

  /**
   * 商家真读得到的字 —— 用 **TypeScript AST** 取,不再靠「前后是不是标识符」猜(r6 判词 P1)。
   *
   * r4 那把尺子有三种稳定绕过,判官逐一验过:
   *   ① `<p>{"contact" + "able"}</p>` —— 拼接起来才成词,单看字面量谁都不违规;
   *   ② `<input readOnly value="contactable" />` —— `value=` 被一刀切当机器值放行,可它就是
   *      商家眼睛里的那行字;
   *   ③ `<button aria-label="Reachable contacts" />` —— 无障碍名字是**朗读出来的文案**。
   * 加上词族本身漏了 `can reach` 一整族。
   *
   * 所以判定改成语义的:问「这段字符串会不会被商家读到/听到」,而不是「它长得像不像代码」。
   * 会被读到的有四类:
   *   · JSX 文本节点;
   *   · 会被朗读或悬停读到的属性:aria-label / aria-description / aria-describedby 的文本 /
   *     title / placeholder / alt;
   *   · **非 hidden input 上的 `value=`**(`<input type="hidden">` 才是机器值);
   *   · 以及以上任意一处**拼得出字面量的表达式**。
   * 变量名、props 键名、`value` 在 hidden input 上、类型里的字符串联合,都不在此列。
   *
   * r8(r7 判词 P1-2)—— r6 把表达式拍成**一条**字符串,这在声明的能力范围内仍有两种绕过,
   * 判官各给了可复现的样本:
   *   ① 模板串里的三元:``{`${ready ? "reach" : "email"}able contacts`}`` ——
   *      页面真显示 "reachable contacts",而 r6 把两支拍成 "reach\nemail" 再接后缀,
   *      拼出来的是 "reach\nemailable contacts",词族一个都碰不到。嵌套三元同理。
   *   ② 同文件里的 const:`const label = "Reachable contacts"; <button aria-label={label} />`
   *      —— 标识符取不出字面量,整句直接丢掉。
   *
   * 修法是把「一条字符串」换成「**所有可能的字符串**」:
   *   · `expand()` 返回一个数组,三元取**两支的并集**,拼接与模板串做**笛卡尔积**,
   *     所以每一种真正会显示出来的组合都被单独拿去过词族(嵌套靠递归自然覆盖);
   *   · 同文件内 `const 名字 = 字面量` 收进一张表,标识符按表展开(**只认 const,只认本文件**)。
   * 组合数封顶,超了就**抛错**而不是截断 —— 截断本身会变成新的藏身处。
   *
   * r9(r8 判词)—— 上面那版在自己声明的能力范围内还漏三处,判官各给了可复现的样本:
   *   ① 常量表按名字只留**最后一次**绑定:同文件稍后一个同名局部 `const label = "Account"`
   *      就把前面 `aria-label={label}` 那句 "Reachable contacts" 盖掉,返回空集。现在同名的
   *      **每一次绑定都展开取并集** —— 不解析词法作用域,而是让围栏的错误方向只能是「多报」;
   *   ② `const label = "Reachable contacts" as const`(以及 `satisfies`)拆不开壳,读不到里头
   *      的字面量。现在 `as` / `satisfies` 一律拆包再读;
   *   ③ 上限只在笛卡尔积那条路上查,纯嵌套三元靠**并集**长到 258 支也一声不响地全返回。
   *      现在并集与笛卡尔积认同一把尺,并且**并集不去重** —— 去重会把上限架空。
   *
   * ── 这把尺子的能力边界(如实写明,不假装盖满)────────────────────────────────
   * 覆盖:字面量、模板串、`+` 拼接、三元(含嵌套)、同文件 const 字符串(同名多绑定取并集)、
   * `as const` / `satisfies` 壳、以上任意嵌套组合。
   * **不覆盖**(判官 r7 已裁定超出本次声明边界,不在本轮修法内):
   *   · `String.fromCharCode(...)` 之类的**逐字符构造**;
   *   · 数组 `.join("")` / `.map().join()` 之类的**集合拼装**;
   *   · 跨文件导入的常量、函数返回值、i18n 查表 —— 值不在本文件里,单文件解析看不见。
   * 这三类都能把一句过度承诺送到页面上而本围栏不响。写在这里是为了让下一个人知道
   * 「绿」代表什么、不代表什么;真要盖,得换成类型检查器级别的常量求值,不是再加一条正则。
   *
   * 做法沿用 #848 已经合并的先例(instructions-nav-map.test.ts 的 `ts.createSourceFile`):
   * 手搓状态机数不清嵌套模板串,AST 数得清。
   */
  /** 一个表达式的组合数上限。超了宁可抛错也不截断 —— 截断会变成新的藏身处。 */
  const MAX_EXPANSIONS = 256;

  function merchantVisibleStrings(fileSource: string, fileName = "surface.tsx"): string[] {
    const tree = ts.createSourceFile(fileName, fileSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const spoken: string[] = [];

    /**
     * 同文件内 `const 名字 = <拼得出字面量的表达式>`。只收 const:let/var 会被改写,
     * 「这个名字在这里是什么字」就不再是单文件能回答的问题了。
     *
     * r9(r8 判词 P1)—— 同一个名字在同一文件里可以绑好几次(不同作用域)。原先按名字只留
     * **最后一次**绑定,于是后出现的同名局部 const 会把前面那句实话盖掉。这里不解析词法
     * 作用域,而是把同名的**每一次绑定都收下**、展开时取并集:围栏允许多报,不允许漏报。
     */
    const constants = new Map<string, ts.Expression[]>();
    (function collect(node: ts.Node): void {
      if (
        ts.isVariableStatement(node) &&
        (node.declarationList.flags & ts.NodeFlags.Const) !== 0
      ) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            const bound = constants.get(declaration.name.text);
            if (bound) bound.push(declaration.initializer);
            else constants.set(declaration.name.text, [declaration.initializer]);
          }
        }
      }
      ts.forEachChild(node, collect);
    })(tree);

    /**
     * 组合数封顶。r9(r8 判词 P2)—— 原先只有笛卡尔积那条路查上限,纯嵌套三元是**并集**
     * 增长,258 支照样一声不响地全返回。两条路现在认同一把尺。
     */
    function guardSize(size: number): void {
      if (size > MAX_EXPANSIONS) {
        throw new Error(
          `${fileName}: 一个表达式的分支组合超过 ${MAX_EXPANSIONS} 种,围栏无法逐一核对。` +
            `把它拆开写 —— 围栏宁可红,也不截断(截断等于给下一句过度承诺留了藏身处)。`,
        );
      }
    }

    /** 笛卡尔积:左边每一种 × 右边每一种。 */
    function product(left: string[], right: string[]): string[] {
      guardSize(left.length * right.length);
      return left.flatMap((prefix) => right.map((suffix) => prefix + suffix));
    }

    /** 并集:每一支都可能显示出来,各自独立过词族。**不去重** —— 去重会把上限架空。 */
    function union(branches: string[][]): string[] {
      const all = branches.flat();
      guardSize(all.length);
      return all;
    }

    /** 这个表达式**所有可能显示出来**的字面量组合。取不出字面量的部分当空串。 */
    function expand(node: ts.Node, seen: ReadonlySet<string> = new Set()): string[] {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
      if (ts.isTemplateExpression(node)) {
        let out = [node.head.text];
        for (const span of node.templateSpans) {
          out = product(product(out, expand(span.expression, seen)), [span.literal.text]);
        }
        return out;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return product(expand(node.left, seen), expand(node.right, seen));
      }
      if (ts.isParenthesizedExpression(node)) return expand(node.expression, seen);
      // `as const` / `satisfies X` 只是类型层的壳,里头还是同一句字(r8 判词 P1)。
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return expand(node.expression, seen);
      // 三元:两支都可能显示出来,所以是**并集**,各自独立过词族。嵌套靠递归。
      if (ts.isConditionalExpression(node)) {
        return union([expand(node.whenTrue, seen), expand(node.whenFalse, seen)]);
      }
      if (ts.isJsxExpression(node)) return node.expression ? expand(node.expression, seen) : [""];
      // 同文件 const:同名的**每一次绑定**都展开取并集(不解析作用域,宁可多报)。
      // `seen` 防自引用死循环。
      if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
        const next = new Set([...seen, node.text]);
        return union(constants.get(node.text)!.map((binding) => expand(binding, next)));
      }
      // 属性访问、调用、导入来的名字 —— 取不出字面量,当它没有字(见上面的能力边界)。
      return [""];
    }

    /** 这个属性名是「读给商家听的」还是「给机器的值」。 */
    function spokenAttribute(attribute: ts.JsxAttribute, element: ts.JsxTagNameExpression, attributes: ts.JsxAttributes): boolean {
      const name = attribute.name.getText();
      if (["aria-label", "aria-description", "title", "placeholder", "alt"].includes(name)) return true;
      if (name !== "value") return false;
      // `value=` 只在**非 hidden input** 上才是商家看得到的字。
      const tag = element.getText();
      if (!/^(?:input|textarea|Input|Textarea)$/.test(tag)) return false;
      const type = attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && property.name.getText() === "type",
      );
      if (!type?.initializer) return true;
      // `type={x ? "hidden" : "text"}`:只要**有可能**不是 hidden,就按看得见处理(fail closed)。
      return !expand(type.initializer).every((value) => value === "hidden");
    }

    const push = (values: string[]): void => {
      for (const value of values) {
        const text = value.trim();
        if (text) spoken.push(text);
      }
    };

    function visit(node: ts.Node): void {
      if (ts.isJsxText(node)) {
        const text = node.text.trim();
        if (text) spoken.push(text);
      } else if (ts.isJsxExpression(node) && node.expression && node.parent && !ts.isJsxAttribute(node.parent)) {
        // JSX 里的表达式:只有拼得出字面量的才是字(`{count}` 拼不出,自然不算)。
        push(expand(node.expression));
      } else if (ts.isJsxAttribute(node) && node.initializer) {
        const owner = node.parent;
        const element = ts.isJsxSelfClosingElement(owner.parent) || ts.isJsxOpeningElement(owner.parent)
          ? owner.parent.tagName
          : undefined;
        if (element && spokenAttribute(node, element, owner)) push(expand(node.initializer));
      }
      ts.forEachChild(node, visit);
    }

    visit(tree);
    return spoken;
  }

  /** 商家读得到、又对能力过度承诺的那几句。 */
  function overpromisingLines(fileSource: string, fileName?: string): string[] {
    return merchantVisibleStrings(fileSource, fileName).filter((text) => OVERPROMISE.test(text));
  }

  function crmSurfaces(): string[] {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) return walk(full);
        return full.endsWith(".tsx") ? [full] : [];
      });
    return walk(path.join(WEB_ROOT, "components/crm"));
  }

  // ── 自检①:三种绕过 + 两类实词,一条都不许溜 ─────────────────────────────
  it("尺子自检:逮得住 r6 判官点名的三种绕过", () => {
    // ① 字符串拼接
    expect(overpromisingLines('<p>{"contact" + "able"}</p>')).toHaveLength(1);
    expect(overpromisingLines("<p>{`reach` + `able` + ` today`}</p>")).toHaveLength(1);
    // ② 非 hidden input 上的 value = 商家看得到的字
    expect(overpromisingLines('<input readOnly value="contactable" />')).toHaveLength(1);
    // ③ 无障碍名字 = 朗读出来的文案
    expect(overpromisingLines('<button aria-label="Reachable contacts" />')).toHaveLength(1);
    expect(overpromisingLines('<button title="Contacts we can reach" />')).toHaveLength(1);
    expect(overpromisingLines('<input placeholder="Search contactable people" />')).toHaveLength(1);
  });

  it("尺子自检:逮得住 r7 判官点名的两种绕过(模板串里的三元 · 同文件 const)", () => {
    // ① 模板串里的三元 —— 页面真显示 "reachable contacts",r6 那把尺子看到的是
    //    "reach\nemailable contacts",一个词族都碰不到。
    expect(overpromisingLines('<p>{`${ready ? "reach" : "email"}able contacts`}</p>')).toEqual([
      "reachable contacts",
    ]);
    // 嵌套三元:每一支都得独立成句去过词族。
    expect(
      overpromisingLines('<p>{`${a ? (b ? "reach" : "mail") : "call"}able today`}</p>'),
    ).toEqual(["reachable today"]);
    // 三元在 `+` 拼接里、以及三元的另一支才是违规的形状,都逮得住。
    expect(overpromisingLines('<p>{(ok ? "contact" : "mail") + "able"}</p>')).toEqual(["contactable"]);
    expect(overpromisingLines('<p>{`${ok ? "email" : "reach"}able contacts`}</p>')).toEqual([
      "reachable contacts",
    ]);

    // ② 同文件 const 传给 JSX 属性 —— r6 直接把标识符丢掉。
    expect(
      overpromisingLines('const label = "Reachable contacts";\n<button aria-label={label} />'),
    ).toEqual(["Reachable contacts"]);
    // const 指向 const,以及 const 里本身就藏着三元。
    expect(
      overpromisingLines('const word = "contactable";\nconst label = word;\n<p>{label}</p>'),
    ).toEqual(["contactable"]);
    expect(
      overpromisingLines('const label = ok ? "Reachable contacts" : "Everyone";\n<p>{label}</p>'),
    ).toEqual(["Reachable contacts"]);
  });

  it("尺子自检:同名 const 后来居上,盖不掉前面那句实话(r8 判词 P1)", () => {
    // 常量表按名字只存**最后一次**绑定,同文件稍后一个同名局部 `const label = "Account"`
    // 就把前面那句实话覆盖掉,整句过度承诺一声不响地过关(判官复现:aria-label 实际是
    // "Reachable contacts",围栏读成 "Account",结果返回空集)。
    // 改法取保守语义:同名的**每一次绑定都展开,取并集**。宁可多报一句,也不因为没解析
    // 词法作用域而漏掉一句 —— 围栏的错误方向只能是「多报」。
    const laterOverride = [
      'const label = "Reachable contacts";',
      "<button aria-label={label} />",
      "function Toolbar() {",
      '  const label = "Account";',
      "  return <span>{label}</span>;",
      "}",
    ].join("\n");
    expect(overpromisingLines(laterOverride), "同名 const 覆盖不该让这句溜过去").toContain(
      "Reachable contacts",
    );

    // 反过来也一样:先声明的是机器值,后声明的才是那句实话。
    const earlierMachineValue = [
      'const label = "contactable";',
      '<SelectItem value={label}>Not known opt-out</SelectItem>',
      "function Toolbar() {",
      '  const label = "Reachable contacts";',
      "  return <button aria-label={label} />;",
      "}",
    ].join("\n");
    expect(overpromisingLines(earlierMachineValue)).toContain("Reachable contacts");
  });

  it("尺子自检:`as const` / `satisfies` 只是类型层的壳,里头还是同一句字(r8 判词 P1)", () => {
    expect(
      overpromisingLines('const label = "Reachable contacts" as const;\n<button aria-label={label} />'),
    ).toEqual(["Reachable contacts"]);
    expect(
      overpromisingLines(
        'const label = "Reachable contacts" satisfies string;\n<button aria-label={label} />',
      ),
    ).toEqual(["Reachable contacts"]);
    // 壳也可能直接套在 JSX 里的表达式上,或者套在拼接的一支上。
    expect(overpromisingLines('<p>{"contactable" as const}</p>')).toEqual(["contactable"]);
    expect(overpromisingLines('<p>{("contact" as const) + "able"}</p>')).toEqual(["contactable"]);
  });

  it("尺子自检:分支炸开时宁可红,也不悄悄截断", () => {
    // 截断本身会变成藏身处:留一个「组合太多就只看前 N 种」的口子,第 N+1 种就是下一次绕过。
    const manyBranches = `<p>{\`${"${a?'x':'y'}".repeat(9)}\`}</p>`;
    expect(() => overpromisingLines(manyBranches)).toThrow(/围栏无法逐一核对/);

    // r8 判词 P2 —— 上限原先只在笛卡尔积那条路上查,纯嵌套三元是**并集**增长,258 支照样
    // 一声不响地全返回。两条路得认同一把尺:超了就抛错,不截断也不静默。
    let nested = '"y"';
    for (let index = 0; index < 257; index += 1) nested = `(a ? "x" : ${nested})`;
    expect(() => overpromisingLines(`<p>{${nested}}</p>`)).toThrow(/围栏无法逐一核对/);
  });

  it("尺子自检:can reach 一族(r6 判官点名的两处实词形状)", () => {
    for (const line of [
      "<p>A broadcast counts only the contacts it can reach on the channel it sends from.</p>",
      "<p>This count covers the contacts this broadcast can reach on its channel.</p>",
      "<p>We reach them on WhatsApp.</p>",
      "<p>everyone here is reachable today</p>",
    ]) {
      expect(overpromisingLines(line), `「${line}」必须被逮住`).toHaveLength(1);
    }
  });

  it("尺子自检:机器读的那些同名东西,一个都不误伤", () => {
    const machineOnly = [
      "const n = preview.contactableCount;",
      "<p>{contact.contactable ? a : b}</p>",
      '<SelectItem value="contactable">Not known opt-out</SelectItem>',
      '<SelectItem value="not_contactable">Known opt-out</SelectItem>',
      '<input type="hidden" value="contactable" />',
      "function f({ contactableCount }: { contactableCount: number }) { return null; }",
      'type Rule = { kind: "contactability"; value: "contactable" | "not_contactable" };',
      "<Badge data-state=\"contactable\">Included</Badge>",
      // r8 —— 新展开能力自带的两类误伤风险,各誊一个形状钉住:
      // 同文件 const 是**机器值**,而且送去的是机器读的位置(不是 aria/title/可见 value)。
      'const RULE = "contactable";\n<SelectItem value={RULE}>Not known opt-out</SelectItem>',
      'const STATE = "contactable";\n<input type="hidden" value={STATE} />',
      'const CONTACTABLE_KEY = "contactable";\nconst counts = { [CONTACTABLE_KEY]: 4 };',
      // 三元两支都是机器值,展开出来的每一种也都还是机器值。
      '<input type="hidden" value={ok ? "contactable" : "not_contactable"} />',
      // 同名的 const 只是个数字/函数,展开取不出字面量,不该凭名字定罪。
      "const contactableCount = matched.length;\n<p>{contactableCount}</p>",
    ];
    for (const line of machineOnly) {
      expect(overpromisingLines(line), `「${line}」不该被逮`).toEqual([]);
    }
  });

  it("扫描面本身没瘸 —— 真的走遍了 CRM 的商家面,而且真读出了字", () => {
    const files = crmSurfaces();
    expect(files.length, "components/crm 下一个面都没扫到").toBeGreaterThanOrEqual(10);

    // 读不出字的扫描器会让底下那条永远绿。这里钉住它确实读到了页面上的话。
    const spoken = files.flatMap((file) => merchantVisibleStrings(readFileSync(file, "utf8"), file));
    expect(spoken.length).toBeGreaterThan(200);
    expect(spoken.join("\n")).toContain("known opt-out excluded");
  });

  it("CRM 面上没有一处把「不是已知退订」说成「联系得上 / 送得到」(r4 判词 P1 · r6 扩面)", () => {
    const offenders = crmSurfaces().flatMap((file) =>
      overpromisingLines(readFileSync(file, "utf8"), file).map(
        (line) => `${path.relative(WEB_ROOT, file)}: ${line.slice(0, 120)}`,
      ),
    );

    expect(
      offenders,
      "这些字对商家承诺了「联系得上 / 送得到」。产品知道的只有:这条渠道上有没有一个" +
        "**渠道已确认的身份**(customer-broadcast-service.ts),以及同意台账怎么判——" +
        "而这个纪元根本发不出去,所以「送得到」没有任何一处能兑现。",
    ).toEqual([]);
  });

  it("人群那句只描述人群 —— 同意口径决定谁被排除,不决定谁在人群里(r7 判词 P1-1)", () => {
    // 服务真身:广播的人群只被**一个**条件收窄,而且是渠道身份,不是同意。
    const service = source("lib/customer-broadcast-service.ts");
    expect(service).toContain("if (sendTargets.length === 0) continue;");
    expect(service).toContain("countExcludedByConsent(reachable, validated.value, evaluatedAt)");

    // 而同意是**门**不是筛子:商家专门去找退订者时,已知退订者留在选择里。
    // 所以「人群里没有已知退订」这句话,对冻结人群和对这个计数都不成立
    // ——这个计数本身正是从已知退订者里数出来的。
    expect(source("lib/consent-authority.ts")).toContain('return optedOut ? !matchesAs("opt_in") : true;');

    // 于是两个面的人群句子里,一个同意口径的词都不许有。
    const populationSentences = [
      ["components/crm/segments-page.tsx", /A broadcast counts only the contacts[^.]*\./],
      ["components/crm/broadcasts/broadcast-detail-page.tsx", /This count covers the contacts[^.]*\./],
    ] as const;
    for (const [file, pattern] of populationSentences) {
      const found = source(file).match(pattern);
      expect(found, `${file} 里找不到那句人群句`).toBeTruthy();
      expect(found![0], `${file} 的人群句把同意口径写进了人群`).not.toMatch(
        /opt-?out|consent|contactabl/i,
      );
    }
  });

  it("那个计数改口之后,说的正是它数的东西", () => {
    // 数的是 `!isKnownOptOut(truth)`,标签就只能说这件事。
    expect(source("lib/segment-actions.ts")).toContain("const contactable = !isKnownOptOut(truth);");
    expect(source("components/crm/segments-page.tsx")).toContain("with no known opt-out");
  });

  it("对外不许泄露内部状态名 —— 模拟发送用展示层那个词(r3 判词 P2-3)", () => {
    // 内部列值是 `simulated_sent`;商家读到的词早就有了(投递报告页的展示层)。
    expect(sendStatePresentation("simulated_sent").label).toBe("Simulated attempt");
    expect(previewMarkup).toContain(sendStatePresentation("simulated_sent").label.toLowerCase());

    // 内部值本身(以及它换个连字符的伪装)一律不许出现在商家面前。
    for (const leaked of ["simulated_sent", "simulated-sent", "skipped_ineligible", "send_unavailable"]) {
      expect(previewMarkup, `预览页把内部状态名 ${leaked} 端给了商家`).not.toContain(leaked);
    }
    // 预览页从展示层读,不自己写一份译法。
    expect(source("components/crm/customers-preview-page.tsx")).toContain("sendStatePresentation");
  });

  it("联系人手动录入的号码确实是「未验证」,页面照实说", () => {
    // 号码等级的权威在 core;页面不许把「商家自己录的」说成可用于广播的号码。
    expect(source("components/crm/contacts-page.tsx")).toContain("saved as not verified");
    expect(entry("/crm/contacts").blocked).toMatch(/not verified/i);
    expect(entry("/crm/contacts").blocked).toMatch(/broadcast/i);
  });
});

/* ── ③ 真行为:「What works today」那两面真的做得到 ─────────────────────────── */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

/** React 记着它上次写进受控元素的值,会吞掉「没变」的事件 —— 走原型 setter 写。 */
function setNativeValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
}

describe("「What works today」不是自称:真组件跑一遍", () => {
  it("联系人:填名字提交,真的走到 createContact,载荷正是页面承诺的那件事", async () => {
    vi.mocked(createContact).mockResolvedValue({
      ok: true,
      contactId: "c1",
      possibleDuplicates: [],
    } as never);

    const dom = await mount(
      createElement(ContactsPage, {
        initialState: { ok: true, contacts: [], total: 0, nextCursor: null },
      } as never),
    );

    const nameInput = dom.querySelector<HTMLInputElement>('input[aria-label="Contact name"]');
    expect(nameInput, "新建联系人的输入框不在了").toBeTruthy();
    await act(async () => {
      setNativeValue(nameInput!, "Aisyah");
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      nameInput!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // 真提交路径:一次调用,载荷是手工来源的一条新档案 —— 没有渠道参与,所以它今天就成立。
    expect(createContact).toHaveBeenCalledTimes(1);
    expect(createContact).toHaveBeenCalledWith({
      name: "Aisyah",
      lifecycleStage: "New",
      source: "manual",
    });
    // 而且它不会顺手编造号码或同意 —— 这正是 blocked 那一句说的。
    expect(dom.textContent).toContain("No phone number or consent was inferred.");
  });

  it("分群:真页面自己承认哪两个事实没接通,而且承认的与预览页写的是同一件事", () => {
    const markup = renderToStaticMarkup(
      createElement(SegmentsPage, {
        initialState: {
          ok: true,
          segments: [],
          totalContactCount: 0,
          nextSegmentId: "01J0000000000000000000000A",
          nextSegmentProof: "proof",
          unavailableFacts: { lastOrderAt: true, tags: true },
        },
      } as never),
    );

    // 真页面自己承认的两个断点,与预览页写的是同一件事。
    expect(markup).toContain("Last order recency and tags are not connected yet");
    // 而且它自己数得出来:五个事实里接通了三个 —— 与 UNAVAILABLE_FACTS 的两条互为补数。
    // tags 或 last order 哪天接通了,这条与预览页那句话会一起红。
    const unavailable = (/const UNAVAILABLE_FACTS = \{([^}]*)\}/.exec(source("lib/segment-actions.ts"))?.[1] ?? "")
      .match(/(\w+):/g)?.length ?? 0;
    expect(markup).toContain(`${5 - unavailable} / 5`);
    // 规则构建器是真的渲染出来的(不是一张静态说明图)。
    expect(markup).toContain('aria-label="Rule 1 type"');
    expect(entry("/crm/segments").works).toMatch(/lifetime spend/i);
  });
});

/* ── 产品事实核对:「连不上渠道」不是页面自称 ───────────────────────────────── */

describe("「连不上渠道」是产品事实,不只是页面上的一句话", () => {
  it("Connections 里 Messaging 那一行没有任何可点的东西", () => {
    const connections = source("components/otto/OttoConnections.tsx");
    const row = connections.slice(
      connections.indexOf("function MessagingRow"),
      connections.indexOf("export default function OttoConnections"),
    );

    expect(row).toContain("Not available yet");
    // 它能连的那一天这条会红 —— 那正是该回来把 preview 删掉的时刻。
    expect(row).not.toMatch(/href=|onClick=/);
  });

  it("产品事实变了,预览门就该跟着删 —— 这里把两者绑在一起", () => {
    if (source("components/otto/OttoConnections.tsx").includes("Not available yet")) {
      expect(PREVIEW_TRUTH, "渠道还没通,这扇门却不再说自己是预览").not.toBe("");
    }
  });
});

/* ── ④ Otto 一面 ───────────────────────────────────────────────────────────── */

describe("Otto 说的与导轨画的是同一件事", () => {
  it("Otto 读到的地图里,Customers 那一行带着那句实话", () => {
    expect(ottoInstructionsText).toContain(PREVIEW_TRUTH);
    expect(merchantNavMap()).toContain(PREVIEW_TRUTH);
  });

  it("地图里不再有七扇 CRM 子门(Otto 不会把商家送去一个折叠掉的名字)", () => {
    for (const href of FOLDED_CRM_SURFACES) {
      expect(ottoInstructionsText, `${href} 还在 Otto 的地图里`).not.toContain(`(${href})`);
    }
  });

  it("空渠道口径全仓只有一份 —— 导轨、预览页与 Otto 读的是同一个常量(r2 判词 P1)", () => {
    expect(PREVIEW_TRUTH).toBe(MESSAGING_STATUS_MERCHANT);
    expect(ottoInstructionsText).toContain(MESSAGING_STATUS_ASSISTANT);
    expect(source("components/crm/customers-preview-page.tsx")).not.toContain(
      MESSAGING_STATUS_MERCHANT,
    );
  });

  it("Otto 再也不会劝商家去连一条连不上的渠道", () => {
    // 「never tell them to connect one」是禁令,不是指令 —— 只抓没有 never 在前面的祈使写法。
    expect(ottoInstructionsText).not.toMatch(
      /suggest connecting one|(?<!never )tell (?:the user|them) to connect one/i,
    );
    expect(ottoInstructionsText).toMatch(/NOT a to-do for the merchant/);
    expect(ottoInstructionsText).toContain(CUSTOMERS.label);
  });
});
