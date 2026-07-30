/**
 * spend-visibility-seams — 「钱动了商家看得见」的两道缝(#550)。
 *
 * 这两个缺陷都不是逻辑写错,是缝断了,而断缝只存在于人的记忆里:
 *
 *   缝 ①(余额新鲜度):每个扣费点都已经在喊 onBalanceRefresh,但 #513 A 组把余额
 *     收进唯一的全局导航之后,那个喊声只更新 OttoApp 内部一个没人再渲染的 state。
 *     全局导航自己只在 mount 时取一次余额 —— 于是整场停在旧数字(S2/S6 实测滞后
 *     DB 84s+,直到整页重载)。
 *
 *   缝 ②(Evolve 价签):Evolve 走的是图生视频的付费路径,却是唯一一个触发前不报价的
 *     入口,且 aria-label 说 image、placeholder 说 video,商家判断不出这一下 1 还是 8
 *     积分。这里断言:价签渲染、文案不再自相矛盾、且价格只能来自服务端报价
 *     (packages/core 定价),UI 里不准出现价格字面量。
 *
 * 第一轮跨族密封复审(gpt-5.6-sol)判 FAIL 时点破:逐个文件手写断言封不住回归 ——
 * 六类付费入口漏接信号,而当时的测试全绿。所以下面 SPEND ENTRY ENUMERATION 那节改成
 * 机器枚举:扫描每一个 import 了扣费 server action 的客户端文件,任何一个没接余额信号
 * 就红。豁免簿是有界的、带理由的、且会自失效(接上了却还留在簿子里也红)。
 *
 * 已知局限:词法扫描(fs+regex)。经变量/拼接构造的调用能逃过 —— 但正反两向断言让
 * 「悄悄漏一个」需要同时绕开两张网。
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

const GLOBAL_NAVIGATION = "components/global-navigation.tsx";
const OTTO_APP = "components/otto/OttoApp.tsx";
const OTTO_NAV = "components/otto/OttoNav.tsx";
const OTTO_PAGE = "app/otto/page.tsx";
const DETAIL_PANEL = "components/asset/DetailPanel.tsx";
const ADD_ASSET_DIALOG = "components/otto/stuff/AddAssetDialog.tsx";
const RESEARCH_CARD = "components/otto/ResearchCard.tsx";
const IMAGE_NODE = "components/canvas/nodes/ImageNode.tsx";
const FLOW_CANVAS = "components/canvas/FlowCanvas.tsx";

/** A user-facing credit price written as a literal, e.g. "8 credits" / "1 credit".
 *  Pricing lives in configuration + packages/core; UI may only render a quote. */
const CREDIT_PRICE_LITERAL = /\d[\d,.]*\s*credits?\b/i;

// ---------------------------------------------------------------------------
// SPEND ENTRY ENUMERATION — the regression net (round-1 review P1③ / P2②).
// ---------------------------------------------------------------------------

/** Client-callable server actions that RESERVE credits. Traced from the reserve sites:
 *  lib/gen-actions.ts + lib/refgen-actions.ts call reserveCredits directly; the Otto
 *  metered paths (ottoTurn / ottoApprove / coworkGenerate / coworkVaryCard) and the
 *  campaign batch (confirmCampaignGeneration → factory-batch → startGen) reserve
 *  downstream. Importing one of these into a client surface = that surface can charge. */
const SPEND_ACTIONS = [
  "confirmCampaignGeneration",
  "coworkGenerate",
  "coworkVaryCard",
  "ottoApprove",
  "ottoTurn",
  "startGen",
  "startRefGen",
];

/** A file "announces" if it publishes the signal itself or calls a wired-in callback. */
const ANNOUNCES = /notifyBalanceRefresh\(\)|onBalanceRefresh(?:\?\.)?\(\)/;

// There is no exemption list. There was one for exactly as long as three spend entries
// (OttoFrontDoor / OttoMemory / OttoPlanCard) sat inside another session's ACTIVE
// task-ownership claim and this task physically could not write them; #555 wired all three
// and merged them to main (92aedcae), and the list's own self-invalidating assertion is what
// went red to say so. The fence now applies to every spend entry with no escape hatch —
// re-introducing one should take a deliberate, argued change to this file.

function walkSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walkSources(full);
    return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}

/** Value-import clauses only — an `import type {...}` never calls anything. */
function valueImportClauses(src: string): string[] {
  return [...src.matchAll(/^\s*import\s+(?!type\b)([\s\S]*?)from\s+["'][^"']+["']/gm)].map((m) => m[1]!);
}

type SpendEntry = { file: string; actions: string[]; announces: boolean };

/** Only a CLIENT surface can announce — a "use server" module and an app/api route
 *  handler both run on the server, where the browser-side signal has no subscribers.
 *  Narrowed deliberately: a guard that can go red for a legitimate reason is a guard the
 *  next person weakens. */
function isClientSurface(file: string, src: string): boolean {
  if (file.startsWith("app/api/")) return false;
  return !/^\s*["']use server["'];/.test(src);
}

function spendEntries(): SpendEntry[] {
  return ["components", "app"]
    .flatMap((root) => walkSources(path.join(WEB_ROOT, root)))
    .map((full) => {
      const src = readFileSync(full, "utf8");
      const clauses = valueImportClauses(src);
      const actions = SPEND_ACTIONS.filter((action) =>
        clauses.some((clause) => new RegExp(`\\b${action}\\b`).test(clause)),
      );
      return { file: path.relative(WEB_ROOT, full), actions, announces: ANNOUNCES.test(src), src };
    })
    .filter((entry) => entry.actions.length > 0 && isClientSurface(entry.file, entry.src))
    .map(({ file, actions, announces }) => ({ file, actions, announces }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

describe("spend entry enumeration (#550 — round-1 review P1③ / P2②)", () => {
  it("finds the spend entries at all (a silently empty net would pass everything)", () => {
    const entries = spendEntries();
    expect(entries.length).toBeGreaterThanOrEqual(10);

    const files = entries.map((entry) => entry.file);
    expect(files).toContain(DETAIL_PANEL);
    expect(files).toContain("components/otto/TemplateModal.tsx");
    expect(files).toContain("components/campaign/campaign-confirm-page.tsx");
    expect(files).toContain("components/otto/OttoApprovalCard.tsx");
  });

  it("every client surface that can charge announces the balance change — no exemptions", () => {
    const unannounced = spendEntries()
      .filter((entry) => !entry.announces)
      .map((entry) => entry.file);

    expect(unannounced, "a paid entry point with no balance signal re-opens #550").toEqual([]);
  });
});

describe("balance freshness seam (#550 ①)", () => {
  it("the global navigation subscribes to the balance-refresh signal, not just a one-shot fetch", () => {
    const src = read(GLOBAL_NAVIGATION);

    expect(src).toMatch(/import\s*\{[^}]*\bsubscribeBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    expect(src).toMatch(/subscribeBalanceRefresh\(/);
    expect(src).toMatch(/getMyAccount\(\)/);
  });

  it("the global navigation drops out-of-order responses (round-1 review P1①)", () => {
    const src = read(GLOBAL_NAVIGATION);

    // A slow earlier read must never repaint over a newer balance — otherwise a
    // "refresh" can put an OLDER number on screen than the one already there.
    expect(src).toMatch(/import\s*\{[^}]*\bcreateLatestReadGate\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    expect(src).toMatch(/createLatestReadGate\(\)/);
    expect(src).toMatch(/isLatest\(\)/);
  });

  it("OttoApp announces unconditionally — no fragile read can swallow it (round-1 review P1② / P2①)", () => {
    const src = read(OTTO_APP);

    expect(src).toMatch(/import\s*\{[^}]*\bnotifyBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    const body = src.match(/refreshBalance\s*=\s*useCallback\(async \(\) => \{([\s\S]*?)\n {2}\}\s*,\s*\[\]\)/)?.[1];
    expect(body, "refreshBalance must still be the single funnel every consumer calls").toBeDefined();
    expect(body).toMatch(/notifyBalanceRefresh\(\)/);
    // The nav owns the read now. A pre-read here would both double every fetch and let a
    // throw swallow the whole announcement.
    expect(body).not.toMatch(/getMyAccount/);
    expect(body).not.toMatch(/await/);
  });

  it("the dead balanceCredits plumbing is gone (nothing has rendered it since #513 A组)", () => {
    for (const file of [OTTO_APP, OTTO_NAV, OTTO_PAGE]) {
      expect(read(file), `${file} still carries the unrendered balanceCredits state`).not.toMatch(
        /balanceCredits/,
      );
    }
  });

  it("the asset detail panel announces its own paid starts (regen, animate, edit)", () => {
    const src = read(DETAIL_PANEL);

    expect(src).toMatch(/import\s*\{[^}]*\bnotifyBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    // Three paid entry points x two money moments each (the hold when startGen accepts,
    // then the settle/refund when the job resolves).
    expect(src.match(/notifyBalanceRefresh\(\)/g) ?? []).toHaveLength(6);
  });

  it("the reference-generation dialog announces on both outcomes (round-1 review P2③)", () => {
    const src = read(ADD_ASSET_DIALOG);

    expect(src).toMatch(/import\s*\{[^}]*\bnotifyBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    // In a finally: a refused or failed start can still have moved (and refunded) money.
    expect(src).toMatch(/\}\s*finally\s*\{[\s\S]*?notifyBalanceRefresh\(\)/);
  });

  it("research announces when the worker settles, not only when it is approved", () => {
    const src = read(RESEARCH_CARD);

    // Approve returns a jobId BEFORE the worker spends, so the approve-time callback
    // alone always reports a pre-charge balance.
    expect(src).toMatch(/import\s*\{[^}]*\bnotifyBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    expect(src).toMatch(/notifyBalanceRefresh\(\)/);
  });
});

describe("Evolve price tag seam (#550 ②)", () => {
  it("the Evolve bar renders a cost hint before the merchant can trigger it", () => {
    const src = read(IMAGE_NODE);

    expect(src).toMatch(/evolveCostHint\?:\s*string/);
    expect(src).toMatch(/\{d\.evolveCostHint\}/);
  });

  it("the Evolve bar no longer contradicts itself about what it produces", () => {
    const src = read(IMAGE_NODE);
    const ariaLabels = [...src.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!);
    const evolveLabel = ariaLabels.find((label) => /evolve|imagine|make a video|video/i.test(label));

    expect(evolveLabel).toBeDefined();
    expect(evolveLabel).toMatch(/video/i);
    expect(ariaLabels).not.toContain("Evolve this image");
  });

  it("FlowCanvas prices Evolve from the same server quote as the video confirm", () => {
    const src = read(FLOW_CANVAS);

    expect(src).toMatch(/import\s*\{[\s\S]*?\bgenCostHint\b[\s\S]*?\}\s*from\s*["']@\/lib\/canvas-gen-costs["']/);
    expect(src).toMatch(/evolveCostHint\s*=\s*genCostHint\(costQuote\?\.videoCredits\)/);
    expect(src).toMatch(/evolveBarVisible/);
    expect(src).toMatch(/if \(composerVisible \|\| evolveBarVisible \|\| pendingAnimateId !== null \|\| t2vOpen\) refreshCostQuote\(\)/);
  });

  it("no canvas price is written as a literal in the UI", () => {
    for (const file of [IMAGE_NODE, FLOW_CANVAS]) {
      expect(read(file), `${file} must render prices from the server quote only`).not.toMatch(
        CREDIT_PRICE_LITERAL,
      );
    }
  });
});
