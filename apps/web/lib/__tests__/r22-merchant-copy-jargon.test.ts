// @vitest-environment jsdom
/**
 * r22-merchant-copy-jargon.test.ts —— Settings 与 Otto IQ 两面,商家眼前不许有工程词。
 *
 * 病灶(B-1):这两面把「诚实原则」写成了工程师黑话怼在商家眼前 ——「Backend adapter
 * unavailable」「No invoice in this fixture」「Production delivery still requires a durable
 * server receipt」「Export and deletion need the backend data-rights contract」。
 * 诚实没有错,措辞错了:商家读不懂 receipt 是什么,更不知道 fixture 是谁,也不知道
 * adapter 是哪一个零件。改法是**把诚实翻成人话**,不是把诚实删掉 —— 每一句仍然写明
 * 「这里没真的存 / 没真的发」,只是用商家读得懂的字。
 *
 * 这份文件是同一件事的防退步闸,两条:
 *   ① **渲染态**:Settings 的十一段、Otto IQ 的六屏,逐个**真的挂载**出来,断言商家读得到
 *      的那一串里没有这一族词。fixture 与生产两条路都走一遍 —— 上一版正是生产那条路上
 *      挂着「Backend adapter unavailable」,而那 41 句里的绝大多数活在 fixture 那条路上。
 *      这里必须挂载(jsdom + act)而不是 `renderToStaticMarkup`:两面的 fixture 分支都要
 *      等第一个 effect 跑完才吐真内容,SSR 一屏只能拿到「Loading…」那一层,验的是空气
 *      (这条正是变异自检第一发抓出来的 —— 源码闸红了,而 SSR 版的渲染闸绿着)。
 *   ② **源码态**:文件里任何**四个词以上**的字符串字面量都不许含这一族词。四词这道闸把
 *      标识符、sessionStorage 的键、className、路由参数天然挡在外面(它们都是单词或短
 *      片段),留下的正是句子形状的商家文案。工程标识没有被删,它们仍然是标识符。
 *
 * 变异自检(逐条实做,做完还原,红 → 绿):
 *   · 把 notifications 那句改回 "…still requires a durable server receipt." ⇒ ①② 全红;
 *   · 把 Invoices 那格改回 "No invoice in this fixture" ⇒ ① 红(三词,②按设计不管它);
 *   · 把 Otto IQ 的导出回执改回 "…need the backend data-rights contract." ⇒ ② 红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { R22SettingsSection } from "@/components/settings/R22SettingsShell";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/settings"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
}));

vi.mock("@/components/otto/panel/OttoPanelShell", () => ({
  useOttoPanelControls: () => ({ openPanel: vi.fn(), closePanel: vi.fn() }),
}));

const { R22SettingsShell } = await import("@/components/settings/R22SettingsShell");
const { R22OttoIQView } = await import("@/components/otto-iq/R22OttoIQView");

const WEB_ROOT = path.resolve(__dirname, "../..");

/** 被赶出商家视线的工程词族(与 `r22-canvas-human-copy.test.ts` 同一族,各封各的面)。 */
const ENGINEER_WORDS = /\b(fixtures?|backends?|adapters?|durable|receipts?|contracts?|non-production|frontend)\b/i;

const SETTINGS_SECTIONS = [
  "preferences",
  "profile",
  "notifications",
  "security",
  "connected",
  "workspace",
  "members",
  "roles",
  "connections",
  "billing",
  "domains",
] as const satisfies readonly R22SettingsSection[];

const OTTO_IQ_PANES = ["hub", "voice", "audiences", "sources", "style", "visual"] as const;

const SETTINGS_DATA = {
  workspaceName: "Batik House",
  displayName: "Nadia",
  email: "nadia@batikhouse.my",
  balance: 1240,
  recent: [],
  accountReadable: true,
  spendCapCredits: 40,
  channels: [],
  timezone: "Asia/Kuala_Lumpur",
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.sessionStorage.clear();
});

/**
 * 真的挂载一屏,把商家读得到的那一串还回来。
 *
 * 两面的 fixture 分支都要等第一个 effect 跑完(Settings 的 `fixtureReady`、Otto IQ 的
 * `fixtureWorkspaceId`)才吐真内容,所以这里不能用 SSR —— 那样拿到的只有「Loading…」。
 */
async function visibleTextOf(element: Parameters<Root["render"]>[0]): Promise<string> {
  await act(async () => root!.render(element));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  // 走 innerHTML 剥标签,不走 textContent:后者把相邻元素的字**粘**在一起
  // (`…in this fixtureView invoices`),`\bfixture\b` 的词尾边界就没了,闸会静默漏掉。
  // 这条是变异自检第二发抓出来的 —— 源码闸红了,渲染闸绿着,而两者验的是同一句话。
  return (host!.innerHTML ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function offenders(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((chunk) => ENGINEER_WORDS.test(chunk));
}

describe("Settings 商家可见文案没有工程词", () => {
  it.each(SETTINGS_SECTIONS.flatMap((section) => [[section, true] as const, [section, false] as const]))(
    "%s(fixture=%s)",
    async (section, fixture) => {
      const text = await visibleTextOf(
        createElement(R22SettingsShell, { data: SETTINGS_DATA, initialSection: section, fixture } as never),
      );
      expect(text, "这一段一个字都没渲染出来 —— 这条闸在核对空气").not.toBe("");
      expect(offenders(text), "商家读得到工程词 —— 请把这句翻成人话,别删掉诚实").toEqual([]);
    },
  );
});

describe("Otto IQ 商家可见文案没有工程词", () => {
  it.each(OTTO_IQ_PANES.flatMap((pane) => [[pane, true] as const, [pane, false] as const]))(
    "%s(fixture=%s)",
    async (pane, fixture) => {
      const text = await visibleTextOf(
        createElement(R22OttoIQView, { initialMemory: [], initialPane: pane, fixture } as never),
      );
      expect(text, "这一屏一个字都没渲染出来 —— 这条闸在核对空气").not.toBe("");
      expect(offenders(text), "商家读得到工程词 —— 请把这句翻成人话,别删掉诚实").toEqual([]);
    },
  );
});

/**
 * 货币单位:数字后面一律 `cr`,不写 `credits`(Founder 2026-08-26 裁决,同一条钉在
 * `components/approvals/approvals-fixture.ts` 的 `credits()`)。
 *
 * 这条只管**数字后面的单位** ——「Billing and credits」「Recent credit activity」是功能名,
 * 不是金额,照旧写英文全词;把它们也改成 cr 只会让页面读不通。
 */
// 第一个字符必须是数字:写成 `[\d,]+` 会让「channels, credits」里那个逗号也算一笔金额。
const AMOUNT_IN_WORDS = /\b\d[\d,]*\s+credits?\b/i;

describe("Settings 与 Home 的金额单位写 cr,不写 credits", () => {
  it.each(SETTINGS_SECTIONS.flatMap((section) => [[section, true] as const, [section, false] as const]))(
    "Settings %s(fixture=%s)",
    async (section, fixture) => {
      const text = await visibleTextOf(
        createElement(R22SettingsShell, { data: SETTINGS_DATA, initialSection: section, fixture } as never),
      );
      expect(text, "这一段一个字都没渲染出来 —— 这条闸在核对空气").not.toBe("");
      expect(text.match(AMOUNT_IN_WORDS), "金额后面还写着 credits —— 全站单位是 cr").toBeNull();
    },
  );

  /**
   * 这条扫的是**整份源码**,不只是字符串字面量 —— Top up 下拉那三档(`<option>200 cr</option>`)
   * 是 JSX 文本节点,不是字面量,而它们只在弹层打开之后才渲染,渲染闸也够不着。
   * 两头都够不着的地方,只剩全文扫这一招(变异自检第三发抓出来的正是这一格)。
   */
  it("Settings 整份源码里没有「数字 + credits」", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/settings/R22SettingsShell.tsx"), "utf8");
    expect(source.match(new RegExp(AMOUNT_IN_WORDS.source, "gi")), "金额后面还写着 credits —— 全站单位是 cr").toBeNull();
  });

  it("Home 的样张余额也是 cr —— 今天没有渲染路径,但那正是一颗数据雷", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/home/HomeView.tsx"), "utf8");
    expect(source, "R22HomeFixture 的 credits 又写回 credits 了").not.toMatch(/readOk\("[\d,]+ credits"\)/);
  });
});

/**
 * 弹层里那些回执与放弃草稿的说明句,SSR 一屏渲染不到(它们要商家先按一下才出现)。
 * 这条源码闸补的正是那一半:句子形状的字面量里不许有这一族词。
 */
/**
 * 措辞归真 2026-08-26(Founder 亲验「apply to all」)之后,这条源码闸从两份扩到**十份** ——
 * beta 五门 + Otto 面板 + 壳共用零件的每一个文案文件。
 *
 * 为什么必须扩:上一版只有 Settings 与 Otto IQ 进闸,于是 Notifications 那句
 * 「This frontend is ready for the server-backed feed … Until that adapter exists …」
 * 在闸外活了下来 —— 同一族词、同一种病,只因为文件不在名单里就没人管。变异自检第四发
 * 抓的正是这一格:把那句话改回去,扩栏前一条测试都不红。
 */
describe("beta 五门 + Otto 面板 + 壳共用零件的源码里,句子形状的字面量没有工程词", () => {
  it.each([
    ["Settings", "components/settings/R22SettingsShell.tsx"],
    ["Otto IQ", "components/otto-iq/R22OttoIQView.tsx"],
    ["Notifications", "components/notifications/R22NotificationsView.tsx"],
    ["Help", "components/help/R22HelpView.tsx"],
    ["Library", "components/library/R22LibraryView.tsx"],
    ["Home copy", "components/home/home-data.ts"],
    ["Otto answer", "components/otto/panel/otto-answer.ts"],
  ] as const)("%s", (_name, relative) => {
    const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
    const literals = source.match(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
    const sentences = literals
      .map((literal) => literal.slice(1, -1))
      .filter((body) => body.trim().split(/\s+/).filter(Boolean).length >= 4);
    expect(sentences.length, "一句四词以上的字面量都没圈到 —— 这条闸在核对空气").toBeGreaterThan(5);
    expect(sentences.filter((body) => ENGINEER_WORDS.test(body)), "商家文案里还留着工程词").toEqual([]);
  });
});
