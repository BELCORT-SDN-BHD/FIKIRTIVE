/**
 * quote-version 的纯判词（规格 docs/specs/creation-engine.md §5 :170，FSE-012；Founder
 * 2026-09-10 裁 #1307）。
 *
 * **追溯落在 §5 :170 + #1307，不认领任何验收编号**——§2 验收表里没有一行覆盖「旧报价版本
 * 提交被拒绝并刷新」（理由与 `apps/web/lib/__tests__/creation-quote-version-ledger.test.ts`
 * 文件头那段相同）。
 *
 * 承重的那一条是**归一化**：客户端手上那份 payload 过了 `parsePlanCardPayload`（缺席的
 * count 被补成 1、未知字段被丢掉），服务端手上那份是库里的原始 JSON。两边算出同一串，
 * 是这道闸能用的全部前提——算不出同一串，商家每一次批准都会被误判成「价变了」。
 */
import { describe, expect, it } from "vitest";
import { cardQuoteVersion } from "./quote-version.js";

const CARD = {
  kind: "image",
  model: "seedream-4-0",
  structuredPrompt: "A pandan kaya jar",
  params: { aspectRatio: "1:1", count: 1 },
  estimatedCredits: 1,
};

describe("creation §5 :170 FSE-012 报价版本指纹", () => {
  it("creation §5 :170 FSE-012 同一份报价算两次是同一串", () => {
    expect(cardQuoteVersion(CARD)).toBe(cardQuoteVersion({ ...CARD }));
  });

  it("creation §5 :170 FSE-012 决定价格的每一格变了都换一串", () => {
    const base = cardQuoteVersion(CARD);
    expect(cardQuoteVersion({ ...CARD, params: { ...CARD.params, count: 2 } })).not.toBe(base);
    expect(cardQuoteVersion({ ...CARD, params: { ...CARD.params, aspectRatio: "4:5" } })).not.toBe(base);
    expect(cardQuoteVersion({ ...CARD, fineDetail: true })).not.toBe(base);
    expect(cardQuoteVersion({ ...CARD, estimatedCredits: 2 })).not.toBe(base);
    expect(cardQuoteVersion({ ...CARD, kind: "video" })).not.toBe(base);
    expect(cardQuoteVersion({ ...CARD, params: { ...CARD.params, durationSeconds: 5 } })).not.toBe(base);
    expect(cardQuoteVersion({ ...CARD, params: { ...CARD.params, resolution: "1080p" } })).not.toBe(base);
    expect(cardQuoteVersion({ ...CARD, params: { ...CARD.params, audio: true } })).not.toBe(base);
  });

  it("creation §5 :170 FSE-012 与报价无关的那些格改了不换串", () => {
    const base = cardQuoteVersion(CARD);
    expect(cardQuoteVersion({ ...CARD, structuredPrompt: "Something else entirely" })).toBe(base);
    expect(cardQuoteVersion({ ...CARD, specChips: ["2048 × 2048", "1:1"] })).toBe(base);
  });

  it("creation §5 :170 FSE-012 型号那一格不参与:DTO 会丢掉它,算进去等于刷新后批不动", () => {
    // `toChatMessageDTO` 出于供应商保密把 `model` 与 `reason` 丢掉,所以浏览器手上那份
    // 永远没有型号。指纹一旦读它,服务端(有)与客户端(没有)就永远算不出同一串。
    const { model: _dropped, ...withoutModel } = CARD;
    expect(cardQuoteVersion(withoutModel)).toBe(cardQuoteVersion(CARD));
    expect(cardQuoteVersion({ ...CARD, model: "some-other-engine" })).toBe(cardQuoteVersion(CARD));
  });

  it("creation §5 :170 FSE-012 客户端解析过的那份与库里原始那份算出同一串", () => {
    // `parsePlanCardPayload` 会把缺席的 count 补成 1、丢掉自己不认识的格。归一化就是为了
    // 让这两份仍然算出同一串 —— 否则每一次批准都会被误判成「价变了」。
    const raw = { kind: "image", model: "seedream-4-0", params: { aspectRatio: "1:1" }, estimatedCredits: 1, options: { maxCount: 4 } };
    const parsed = { kind: "image", model: "seedream-4-0", params: { aspectRatio: "1:1", count: 1 }, estimatedCredits: 1 };
    expect(cardQuoteVersion(parsed)).toBe(cardQuoteVersion(raw));
  });

  it("creation §5 :170 FSE-012 读不懂的 payload 照样算得出一串,不抛", () => {
    expect(cardQuoteVersion(null)).toHaveLength(16);
    expect(cardQuoteVersion("not a card")).toHaveLength(16);
    expect(cardQuoteVersion({ params: [] })).toHaveLength(16);
  });
});
