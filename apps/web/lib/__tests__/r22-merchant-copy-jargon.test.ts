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
 *   ① **渲染态**:Settings 的十一段、Otto IQ 的六屏,逐个真的渲染出来,断言商家读得到的
 *      那一串里没有这一族词。fixture 与生产两条路都走一遍 —— 上一版正是生产那条路上
 *      挂着「Backend adapter unavailable」。
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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

/** 商家眼睛看到的那一串:标签剥掉、实体还原、空白折叠。 */
function visibleText(markup: string): string {
  return markup
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
    (section, fixture) => {
      const text = visibleText(
        renderToStaticMarkup(
          createElement(R22SettingsShell, { data: SETTINGS_DATA, initialSection: section, fixture } as never),
        ),
      );
      expect(offenders(text), `商家读得到工程词 —— 请把这句翻成人话,别删掉诚实`).toEqual([]);
    },
  );
});

describe("Otto IQ 商家可见文案没有工程词", () => {
  it.each(OTTO_IQ_PANES.flatMap((pane) => [[pane, true] as const, [pane, false] as const]))(
    "%s(fixture=%s)",
    (pane, fixture) => {
      const text = visibleText(
        renderToStaticMarkup(
          createElement(R22OttoIQView, { initialMemory: [], initialPane: pane, fixture } as never),
        ),
      );
      expect(offenders(text), `商家读得到工程词 —— 请把这句翻成人话,别删掉诚实`).toEqual([]);
    },
  );
});

/**
 * 弹层里那些回执与放弃草稿的说明句,SSR 一屏渲染不到(它们要商家先按一下才出现)。
 * 这条源码闸补的正是那一半:句子形状的字面量里不许有这一族词。
 */
describe("两份源码里,句子形状的字面量没有工程词", () => {
  it.each([
    ["Settings", "components/settings/R22SettingsShell.tsx"],
    ["Otto IQ", "components/otto-iq/R22OttoIQView.tsx"],
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
