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
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { everyNavDestination, merchantNavMap, navLinkByKey } from "@fikirtive/core/navigation";
import { MESSAGING_STATUS_ASSISTANT, MESSAGING_STATUS_MERCHANT } from "@fikirtive/core/messaging-status";
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

/** 取一个具名函数的函数体 —— 断言「这一支永远失败」时必须只看这一支。 */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  const end = text.indexOf("\n  }", start);
  return text.slice(start, end < 0 ? text.length : end);
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
        new RegExp(`aria-current="page" title="${CUSTOMERS.label}"`),
      );
    }
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

  it("「连不上渠道」那一句用的是全仓唯一那份措辞,不是自己又写一遍", () => {
    const page = source("components/crm/customers-preview-page.tsx");
    expect(page).toContain("CHANNEL_CONNECT_UNAVAILABLE_NOTE");
    expect(page).not.toContain("Messaging channels are not available to connect yet.");
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
  readonly evidence: readonly { readonly file: string; readonly probe: RegExp; readonly slice?: string }[];
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
      // 页面自己也这么说 —— 两处同一个事实,不许一处改了另一处不知道。
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
    what: "每一次 run 都是模拟,投递与花费断开",
    evidence: [
      {
        file: "components/crm/workflows/workflow-list-page.tsx",
        probe: /Provider delivery and spend are disconnected/,
      },
    ],
    claim: /every run is simulated/i,
  },
  {
    href: "/crm/reports",
    what: "没有 provider 回执,三个结果永远 Unknown",
    evidence: [
      {
        file: "components/crm/reports/broadcast-report-list-page.tsx",
        probe: /Provider receipts are not connected/,
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
        const text = item.slice
          ? functionBody(source(item.file), item.slice)
          : source(item.file);
        expect(
          text,
          `${href}:${row.what} —— 这条证据在 ${item.file} 里没了。卡点接通了就回预览页改那句话`,
        ).toMatch(item.probe);
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
