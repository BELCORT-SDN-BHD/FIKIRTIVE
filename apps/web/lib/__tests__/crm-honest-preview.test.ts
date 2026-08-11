/**
 * CRM 折叠成诚实预览入口(#792)—— 双面围栏。
 *
 * Founder 裁决(2026-08-08):七扇 CRM 门收成一个「Customer(预览版)」入口,诚实说明消息
 * 渠道未接通、现在能做的是建客户档案。
 *
 * 这份围栏钉的是商家看得见的结果,不是内部函数:
 *   ① **UI 一面** —— 导轨上只剩一格,而且那一格在点开之前就说了自己是预览;预览页把渠道
 *      连不上这件事写在第一屏;七个 CRM 表面一个都没被关进小黑屋(折叠 ≠ 藏起来);现在
 *      真的做得到的事排在最上面。
 *   ② **Otto 一面** —— Otto 读到的界面地图带着同一句实话,并被明令:被问怎么给客人发消息
 *      时先说实话,再指向这一页。
 *
 * 外加一条**产品事实**的核对:预览页说「连不上渠道」,靠的不是文案自称,而是产品里真的
 * 没有任何一条连接路径(Connections 的 Messaging 整段写着 Not available yet)。文案与事实
 * 一起钉,才不会有一天事实变了、文案还在原地。
 *
 * 全程零后端、零生成:只做静态渲染与源码读取。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { everyNavDestination, merchantNavMap, navLinkByKey } from "@fikirtive/core/navigation";
import { MerchantShellContent } from "@/components/global-navigation";
import CustomersPreviewPage from "@/components/crm/customers-preview-page";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/otto"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("@/lib/tenant-actions", () => ({
  stopImpersonatingTenant: vi.fn(),
}));

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

/** 折叠掉的那七个表面。它们的**路由一页没删** —— 引擎原地保留,等渠道通电。 */
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

function renderShell(pathname: string): string {
  return renderToStaticMarkup(
    createElement(
      MerchantShellContent,
      { pathname, signOutAction: vi.fn(async () => undefined) },
      createElement("div", null, "Page content"),
    ),
  );
}

function renderPreviewPage(): string {
  return renderToStaticMarkup(createElement(CustomersPreviewPage));
}

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
    const markup = renderPreviewPage();

    expect(markup).toContain(PREVIEW_TRUTH);
    expect(markup).toContain(">Preview<");
  });

  it("现在真的做得到的事在页面上,而且说明白它不需要渠道", () => {
    const markup = renderPreviewPage();

    expect(markup).toContain('href="/crm/contacts"');
    expect(markup).toContain('href="/crm/segments"');
    expect(markup).toContain("What works today");
  });

  it("折叠掉的七个表面一个都没被藏起来 —— 都还进得去", () => {
    const markup = renderPreviewPage();

    const unreachable = FOLDED_CRM_SURFACES.filter((href) => !markup.includes(`href="${href}"`));
    expect(unreachable, "这些页面活着,却在产品里没有门了").toEqual([]);
  });

  it("每一个等渠道的表面都写明了它今天做不到什么", () => {
    const source = readFileSync(
      path.join(WEB_ROOT, "components/crm/customers-preview-page.tsx"),
      "utf8",
    );
    // 「建好了、等渠道」那一组,每一条都要有自己的实话 —— 不许只在页首写一句总的。
    const waiting = source.slice(source.indexOf("WAITING_ON_A_CHANNEL"), source.indexOf("function EntryRow"));
    for (const href of FOLDED_CRM_SURFACES.filter((h) => h !== "/crm/contacts" && h !== "/crm/segments")) {
      const at = waiting.indexOf(`"${href}"`);
      expect(at, `${href} 不在等渠道那一组里`).toBeGreaterThan(-1);
      expect(waiting.slice(at, at + 600), `${href} 没写今天做不到什么`).toMatch(
        /today|no channel|cannot|there (?:is|are) no|nothing/i,
      );
    }
  });

  it("不承诺工期,也不写「coming soon」", () => {
    const markup = renderPreviewPage();

    expect(markup).not.toMatch(/coming soon/i);
    expect(markup).not.toMatch(/\bby (?:Q[1-4]|January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  });

  it("死路有出口 —— 商家读完实话,还有一个人可以找(#771 出口层)", () => {
    const markup = renderPreviewPage();

    expect(markup).toContain("mailto:");
  });
});

/* ── 产品事实核对:文案不是自称,是有根据的 ─────────────────────────────────── */

describe("「连不上渠道」是产品事实,不只是页面上的一句话", () => {
  it("Connections 里 Messaging 仍然是 not available —— 没有任何一条连接路径", () => {
    const connections = readFileSync(
      path.join(WEB_ROOT, "components/otto/OttoConnections.tsx"),
      "utf8",
    );

    // Messaging 那一行整行没有任何可点的东西:没有链接、没有 onClick。它能连的那一天,
    // 这条会红 —— 那正是该回来把 preview 删掉的时刻。
    const row = connections.slice(
      connections.indexOf("function MessagingRow"),
      connections.indexOf("export default function OttoConnections"),
    );
    expect(row).toContain("Not available yet");
    expect(row).not.toMatch(/href=|onClick=/);
  });

  it("产品事实变了,预览门就该跟着删 —— 这里把两者绑在一起", () => {
    // 谓语很朴素:只要 Messaging 还写着 not available,Customers 就必须挂着 preview。
    const connections = readFileSync(
      path.join(WEB_ROOT, "components/otto/OttoConnections.tsx"),
      "utf8",
    );
    if (connections.includes("Not available yet")) {
      expect(PREVIEW_TRUTH, "渠道还没通,这扇门却不再说自己是预览").not.toBe("");
    }
  });
});

/* ── ② Otto 一面 ───────────────────────────────────────────────────────────── */

describe("Otto 说的与导轨画的是同一件事", () => {
  const instructions = readFileSync(
    path.join(REPO_ROOT, "packages/otto/src/__snapshots__/otto-instructions.golden.txt"),
    "utf8",
  );

  it("Otto 读到的地图里,Customers 那一行带着那句实话", () => {
    expect(instructions).toContain(PREVIEW_TRUTH);
    expect(merchantNavMap()).toContain(PREVIEW_TRUTH);
  });

  it("地图里不再有七扇 CRM 子门(Otto 不会把商家送去一个折叠掉的名字)", () => {
    for (const href of FOLDED_CRM_SURFACES) {
      expect(instructions, `${href} 还在 Otto 的地图里`).not.toContain(`(${href})`);
    }
  });

  it("Otto 被明令:问到怎么给客人发消息,先说实话再指路", () => {
    expect(instructions).toMatch(/PREVIEW/);
    expect(instructions).toMatch(/how to message a customer/i);
    expect(instructions).toContain(CUSTOMERS.label);
  });
});
