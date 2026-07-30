/**
 * spend-visibility-seams — 「钱动了商家看得见」的两道缝(#550)。
 *
 * 这两个缺陷都不是逻辑写错,是缝断了,而断缝只存在于人的记忆里:
 *
 *   缝 ①(余额新鲜度):每个扣费点都已经在喊 onBalanceRefresh,但 #513 A 组把余额
 *     收进唯一的全局导航之后,那个喊声只更新 OttoApp 内部一个没人再渲染的 state。
 *     全局导航自己只在 mount 时取一次余额 —— 于是整场停在旧数字(S2/S6 实测滞后
 *     DB 84s+,直到整页重载)。这里断言:导航订阅信号,扣费点发信号。
 *
 *   缝 ②(Evolve 价签):Evolve 走的是图生视频的付费路径,却是唯一一个触发前不报价的
 *     入口,且 aria-label 说 image、placeholder 说 video,商家判断不出这一下 1 还是 8
 *     积分。这里断言:价签渲染、文案不再自相矛盾、且价格只能来自服务端报价
 *     (packages/core 定价),UI 里不准出现价格字面量。
 *
 * 已知局限:词法扫描(fs+regex)。经变量/拼接构造的价格字面量能逃过 —— 但两道断言
 * (必须引用 genCostHint + 不准出现数字+credits)让绕过需要同时躲开两张网。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

const GLOBAL_NAVIGATION = "components/global-navigation.tsx";
const OTTO_APP = "components/otto/OttoApp.tsx";
const DETAIL_PANEL = "components/asset/DetailPanel.tsx";
const ADD_ASSET_DIALOG = "components/otto/stuff/AddAssetDialog.tsx";
const IMAGE_NODE = "components/canvas/nodes/ImageNode.tsx";
const FLOW_CANVAS = "components/canvas/FlowCanvas.tsx";

/** A user-facing credit price written as a literal, e.g. "8 credits" / "1 credit".
 *  Pricing lives in configuration + packages/core; UI may only render a quote. */
const CREDIT_PRICE_LITERAL = /\d[\d,.]*\s*credits?\b/i;

describe("balance freshness seam (#550 ①)", () => {
  it("the global navigation subscribes to the balance-refresh signal, not just a one-shot fetch", () => {
    const src = read(GLOBAL_NAVIGATION);

    expect(src).toMatch(/import\s*\{[^}]*\bsubscribeBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    // Subscribed inside the same effect that does the initial load, and torn down with it.
    expect(src).toMatch(/subscribeBalanceRefresh\(/);
    expect(src).toMatch(/getMyAccount\(\)/);
  });

  it("OttoApp announces every balance refresh it performs", () => {
    const src = read(OTTO_APP);

    expect(src).toMatch(/import\s*\{[^}]*\bnotifyBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    // The announcement must sit inside refreshBalance — the single funnel every
    // onBalanceRefresh consumer (canvas gens, Otto turns, plan/pack/research cards) ends at.
    expect(src).toMatch(/refreshBalance\s*=\s*useCallback\(async \(\) => \{[\s\S]*?notifyBalanceRefresh\(\)[\s\S]*?\}\s*,\s*\[\]\)/);
  });

  it("the asset detail panel announces its own paid starts (regen, animate, edit)", () => {
    const src = read(DETAIL_PANEL);

    expect(src).toMatch(/import\s*\{[^}]*\bnotifyBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    // Three paid entry points x two money moments each (the hold when startGen accepts,
    // then the settle/refund when the job resolves) — the same two-point pattern the
    // canvas generations already use. DetailPanel is mounted from FlowCanvas,
    // TemplateModal and OttoStuff, so it announces directly rather than threading a prop
    // through all three.
    expect(src.match(/notifyBalanceRefresh\(\)/g) ?? []).toHaveLength(6);
  });

  it("the reference-generation dialog announces its charge", () => {
    const src = read(ADD_ASSET_DIALOG);

    expect(src).toMatch(/import\s*\{[^}]*\bnotifyBalanceRefresh\b[^}]*\}\s*from\s*["']@\/lib\/balance-refresh["']/);
    // startRefGen reserves on acceptance; the announcement must follow the accepted call,
    // not the error branch.
    expect(src).toMatch(/await startRefGen\([\s\S]*?if \("error" in res\) \{[\s\S]*?\}\s*\n\s*(?:\/\/[^\n]*\n\s*)*notifyBalanceRefresh\(\)/);
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

    // The action starts a paid image->video generation, so the label that names the box
    // must say video — "Evolve this image" over a video-priced action is what left the
    // merchant unable to tell 1 credit from 8.
    expect(evolveLabel).toBeDefined();
    expect(evolveLabel).toMatch(/video/i);
    expect(ariaLabels).not.toContain("Evolve this image");
  });

  it("FlowCanvas prices Evolve from the same server quote as the video confirm", () => {
    const src = read(FLOW_CANVAS);

    expect(src).toMatch(/import\s*\{[\s\S]*?\bgenCostHint\b[\s\S]*?\}\s*from\s*["']@\/lib\/canvas-gen-costs["']/);
    expect(src).toMatch(/evolveCostHint\s*=\s*genCostHint\(costQuote\?\.videoCredits\)/);
    // …and the quote must actually be loaded while that bar is on screen, the same rule
    // the image composer already follows (its cost sits next to Generate with no confirm).
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
