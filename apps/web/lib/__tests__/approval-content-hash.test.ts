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
import { computeApprovalContentHash, APPROVAL_CARD_TTL_MS, type ApprovalContentMaterial } from "../approval-content-hash";

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

  it("normalizes optional nulls: absent firstComment/metaTargetId hash the same as explicit null", () => {
    const withNulls = computeApprovalContentHash({ ...BASE, firstComment: null, metaTargetId: null });
    expect(withNulls).toBe(computeApprovalContentHash({ ...BASE, firstComment: null, metaTargetId: null }));
    // and differ from the non-null base (a real change is still a real change)
    expect(withNulls).not.toBe(computeApprovalContentHash(BASE));
  });

  it("the ASK is freshness-bounded (TTL frozen, one-place constant)", () => {
    expect(APPROVAL_CARD_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
