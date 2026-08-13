/**
 * B0-29 — ApprovalRequest semantic consolidation ("正名收口"), unit level.
 *
 * B0-29 freezes the minimal ApprovalRequest for kind=PUBLISH: a payload-hash binding whose drift
 * (any material edit after the ask) invalidates the approval, with the SKILL and the human BUTTON
 * consuming ONE approval object — no second approval system.
 *
 * Decision recorded here (card-carrier equivalence, per spec §八 "冻契约不冻实现" + the human-entry
 * rule "复用 approveScheduledPost，不许自建第二套审批"): #268 already carries this whole semantic on
 * the durable APPROVAL_CARD ChatMessage — payload.toolName="approveScheduledPost" IS the PUBLISH
 * approval kind, payload.contentHash is THIS hash, drift hard-refuses at approve time, and BOTH the
 * Otto skill (ctx.schedule.approve) and the human Approve button resume into the SAME
 * approveScheduledPost server action against the SAME hash + ctx.approvalConsent snapshot. So the
 * APPROVAL_CARD row IS the minimal ApprovalRequest; NO separate table is added (a dedicated,
 * queryable ApprovalRequest table for the notification-center surface remains a founder-adjudicated
 * additive option, not built here). The "skill == button, same object" assertion lives in the
 * integration test otto-actions.test.ts (universal-branch test ②: hash-verified → CAS consume →
 * resume → same server action). This file pins the hash-binding + drift-invalidation contract at the
 * pure-function level (the piece that had no direct test).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  computeApprovalContentHash,
  computeRefgenApprovalContentHash,
  refgenApprovalHashFromArgs,
  factoryBatchApprovalHashFromArgs,
  APPROVAL_CARD_TTL_MS,
  type ApprovalContentMaterial,
  type RefgenApprovalMaterial,
} from "../approval-content-hash";

const BASE: ApprovalContentMaterial = {
  channel: "instagram",
  scheduledAt: "2026-07-20T09:00:00.000Z",
  caption: "launch day!",
  firstComment: "link in bio",
  metaTargetId: "ig_123",
  mediaGenerationIds: ["g1", "g2"],
};

describe("B0-29 approval content hash — binding + drift invalidation (kind=PUBLISH)", () => {
  it("is deterministic: identical material → identical hash (the approval object is stable)", () => {
    expect(computeApprovalContentHash(BASE)).toBe(computeApprovalContentHash({ ...BASE }));
  });

  it("drift on ANY material field changes the hash → approval invalidated, must re-approve", () => {
    const base = computeApprovalContentHash(BASE);
    expect(computeApprovalContentHash({ ...BASE, channel: "facebook" })).not.toBe(base);
    expect(computeApprovalContentHash({ ...BASE, scheduledAt: "2026-07-20T10:00:00.000Z" })).not.toBe(base);
    expect(computeApprovalContentHash({ ...BASE, caption: "launch day!!" })).not.toBe(base);
    expect(computeApprovalContentHash({ ...BASE, firstComment: "different" })).not.toBe(base);
    expect(computeApprovalContentHash({ ...BASE, metaTargetId: "ig_999" })).not.toBe(base);
  });

  it("media DRIFT and media REORDER both change the hash (carousel order is material)", () => {
    const base = computeApprovalContentHash(BASE);
    expect(computeApprovalContentHash({ ...BASE, mediaGenerationIds: ["g1"] })).not.toBe(base);
    expect(computeApprovalContentHash({ ...BASE, mediaGenerationIds: ["g2", "g1"] })).not.toBe(base);
  });

  it("normalizes optional nulls: fields ABSENT at runtime hash the same as explicit null (?? null)", () => {
    // NODE-275 收口5: the earlier version compared two identical explicit-null inputs (a self-
    // comparison proving nothing). This builds an object whose firstComment/metaTargetId keys are
    // genuinely MISSING at runtime (undefined via property access) and asserts the function's
    // `?? null` normalization makes it hash-equal to the explicit-null form.
    const missing = {
      channel: BASE.channel,
      scheduledAt: BASE.scheduledAt,
      caption: BASE.caption,
      mediaGenerationIds: BASE.mediaGenerationIds,
    } as unknown as ApprovalContentMaterial; // keys absent — runtime undefined
    const withNulls = computeApprovalContentHash({ ...BASE, firstComment: null, metaTargetId: null });
    expect(computeApprovalContentHash(missing)).toBe(withNulls);
    // and differ from the non-null base (a real change is still a real change)
    expect(withNulls).not.toBe(computeApprovalContentHash(BASE));
  });

  it("the ASK is freshness-bounded (TTL frozen, one-place constant)", () => {
    expect(APPROVAL_CARD_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// debt-68 (PR #279 P1): generateReferences has no mutable DB row — its consent object IS the exact
// parked tool-call args (entityId/prompt/count/mode). The hash binds them so a same-entity arg swap
// (e.g. the prompt changed after the human saw the card) hard-refuses at approve time (anti-flip).
describe("refgen approval content hash — binds the EXACT parked args (debt-68 anti-flip)", () => {
  const REFGEN_BASE: RefgenApprovalMaterial = {
    entityId: "ent-1",
    prompt: "a red cap on a wooden table",
    count: 3,
    mode: "REFSHEET",
    variantName: null,
  };

  it("is deterministic: identical args → identical hash", () => {
    expect(computeRefgenApprovalContentHash(REFGEN_BASE)).toBe(computeRefgenApprovalContentHash({ ...REFGEN_BASE }));
  });

  it("a change to ANY bound field changes the hash (entityId / prompt / count / mode / variantName)", () => {
    const base = computeRefgenApprovalContentHash(REFGEN_BASE);
    expect(computeRefgenApprovalContentHash({ ...REFGEN_BASE, entityId: "ent-2" })).not.toBe(base);
    expect(computeRefgenApprovalContentHash({ ...REFGEN_BASE, prompt: "a BLUE cap" })).not.toBe(base);
    expect(computeRefgenApprovalContentHash({ ...REFGEN_BASE, count: 4 })).not.toBe(base);
    expect(computeRefgenApprovalContentHash({ ...REFGEN_BASE, mode: "BASE" })).not.toBe(base);
    expect(computeRefgenApprovalContentHash({ ...REFGEN_BASE, variantName: "Red dress" })).not.toBe(base);
  });

  // #781 — a styling variant is saved under the name the user approved, and that name is what they
  // will ask for later ("use the red dress one"). Swapping it after the card was minted changes what
  // they consented to, so it is bound like every other material field.
  it("the variant name is material: two VARIANT asks that differ only in name hash differently", () => {
    const variantAsk = { ...REFGEN_BASE, count: 1, mode: "VARIANT" as const };
    const red = computeRefgenApprovalContentHash({ ...variantAsk, variantName: "Red dress" });
    const beach = computeRefgenApprovalContentHash({ ...variantAsk, variantName: "Beach look" });
    expect(red).not.toBe(beach);
    // and the same ask hashes the same every time (a re-park of one call reuses its card)
    expect(computeRefgenApprovalContentHash({ ...variantAsk, variantName: "Red dress" })).toBe(red);
  });

  // #781 r2 P2 — a card minted BEFORE the variant name existed must still be approvable after the
  // deploy. The approve path finds the parked call BY hash, so a re-hashed old card matches nothing
  // and the merchant is told "That card isn't awaiting approval." while the card sits there looking
  // pending — a sentence about a card that IS pending, and one they can do nothing about. The name is
  // appended only when there is one, so an unnamed ask serializes exactly as it did before #781.
  it("an unnamed ask hashes exactly as it did before the variant name existed (old cards survive the deploy)", () => {
    const legacy = (m: { entityId: string; prompt: string; count: number | null; mode: string | null }) =>
      createHash("sha256")
        .update(JSON.stringify(["generateReferences", m.entityId, m.prompt, m.count, m.mode]), "utf8")
        .digest("hex");
    const refsheet = { entityId: "ent-1", prompt: "a red cap on a wooden table", count: 3, mode: "REFSHEET" };
    expect(computeRefgenApprovalContentHash({ ...refsheet, variantName: null })).toBe(legacy(refsheet));
    // …including the shapes that carry no count/mode at all
    const bare = { entityId: "ent-1", prompt: "x", count: null, mode: null };
    expect(computeRefgenApprovalContentHash({ ...bare, variantName: null })).toBe(legacy(bare));
    // and a NAMED ask is still its own consent object — anti-flip is untouched by the compatibility
    expect(computeRefgenApprovalContentHash({ ...refsheet, count: 1, mode: "VARIANT", variantName: "Red dress" })).not.toBe(
      legacy({ ...refsheet, count: 1, mode: "VARIANT" }),
    );
  });

  it("raw parked args carry the variant name into the hash (the single normalization sees it)", () => {
    const args = { entityId: "ent-1", prompt: "in a red evening gown", count: 1, mode: "VARIANT" };
    const named = refgenApprovalHashFromArgs({ ...args, variantName: "Red dress" });
    const renamed = refgenApprovalHashFromArgs({ ...args, variantName: "Gold gown" });
    const unnamed = refgenApprovalHashFromArgs(args);
    expect(named).not.toBeNull();
    expect(named).not.toBe(renamed);
    expect(named).not.toBe(unnamed);
  });

  it("normalizes optional count/mode: keys ABSENT at runtime hash the same as explicit null (?? null)", () => {
    const withNulls = computeRefgenApprovalContentHash({ entityId: "ent-1", prompt: "x", count: null, mode: null, variantName: null });
    const missing = { entityId: "ent-1", prompt: "x" } as unknown as RefgenApprovalMaterial; // count/mode absent
    expect(computeRefgenApprovalContentHash(missing)).toBe(withNulls);
    // a set count/mode is still a real difference (a real change stays a real change)
    expect(computeRefgenApprovalContentHash({ entityId: "ent-1", prompt: "x", count: 3, mode: "REFSHEET", variantName: null })).not.toBe(withNulls);
  });

  it("is domain-tagged: a refgen hash can never collide with a scheduled-post hash", () => {
    // Even with deliberately overlapping field values, the domain tag keeps the two hash spaces disjoint.
    const refgen = computeRefgenApprovalContentHash({ entityId: "instagram", prompt: "launch day!", count: null, mode: null, variantName: null });
    const post = computeApprovalContentHash({
      channel: "instagram",
      scheduledAt: "launch day!",
      caption: "",
      firstComment: null,
      metaTargetId: null,
      mediaGenerationIds: [],
    });
    expect(refgen).not.toBe(post);
  });
});

// ---------------------------------------------------------------------------
// #777 —— 批准面:商家批的是「一组连贯的图」,那就不能被当成「N 张散图」执行。
//
// 批准卡的内容指纹绑的是**停泊下来的那份 tool 参数**。组图开关是参数的一部分,所以
// 它必须真的改变指纹 —— 否则一张为「一组」签下的卡,可以在恢复执行时被换成散图,
// 而钱一分不少地照扣。这是 P2「同一个 ref 两次停泊」纪律在这张票上的具体形态。
// ---------------------------------------------------------------------------
describe("#777 批准绑定:组图开关是消费同意的一部分", () => {
  const grid = (cell: Record<string, unknown>) => ({
    mode: "grid",
    batchId: "bat-1",
    cells: [{ type: "gen", prompt: "one model, four angles", count: 4, ...cell }],
  });

  it("同一份参数 → 同一个指纹(卡是稳定的)", () => {
    expect(factoryBatchApprovalHashFromArgs(grid({ coherentSet: true })))
      .toBe(factoryBatchApprovalHashFromArgs(grid({ coherentSet: true })));
  });

  it("开关一动,指纹就变 —— 批一组图不可能被当成批散图(两个方向都要成立)", () => {
    const set = factoryBatchApprovalHashFromArgs(grid({ coherentSet: true }));
    const spread = factoryBatchApprovalHashFromArgs(grid({}));
    const explicitOff = factoryBatchApprovalHashFromArgs(grid({ coherentSet: false }));
    expect(set).not.toBe(spread);
    expect(set).not.toBe(explicitOff);
  });

  it("variant 模式同理:base 上的开关照样进指纹", () => {
    const args = (coherentSet?: boolean) => ({
      mode: "variant",
      batchId: "bat-1",
      base: { prompt: "one model", count: 3, ...(coherentSet === undefined ? {} : { coherentSet }) },
      variants: [{}, {}],
    });
    expect(factoryBatchApprovalHashFromArgs(args(true))).not.toBe(factoryBatchApprovalHashFromArgs(args()));
  });
});
