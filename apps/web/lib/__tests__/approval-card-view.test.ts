/**
 * R1 rider assertion (B4 debt-70 card chain): the approval card renders the consent OBJECT —
 * channel / scheduled time / caption summary — never a bare id. approvalCardView is the single
 * rendering source for OttoApprovalCard, so these assertions ARE the card-content contract.
 */
import { describe, it, expect } from "vitest";
import { approvalCardView, approvalCardResolutionText, asApprovalCardPayload, type ApprovalCardPayload } from "@/lib/approval-card-view";

const PAYLOAD: ApprovalCardPayload = {
  toolName: "approveScheduledPost",
  ref: "post_abc123",
  status: "pending",
  summary: {
    channel: "instagram",
    caption: "Golden hour at the atelier — new collection drops Friday.",
    scheduledAt: "2026-07-15T01:00:00.000Z",
    scheduledTz: "Asia/Kuala_Lumpur",
    mediaCount: 2,
  },
};

describe("approvalCardView — R1: the card shows WHAT is being approved, not a bare id", () => {
  it("renders channel, scheduled local time (with tz), media count, and the caption", () => {
    const view = approvalCardView(PAYLOAD);
    const body = [view.title, ...view.detailLines, view.captionExcerpt ?? ""].join("\n");
    expect(body).toContain("Instagram");                       // channel
    expect(body).toContain("Asia/Kuala_Lumpur");               // tz-anchored schedule time
    expect(body).toMatch(/Jul 15|Jul 14/);                     // the scheduled date, human-formatted
    expect(body).toContain("2 media items attached");          // media count
    expect(view.captionExcerpt).toContain("Golden hour");      // the copy being published
    // R1 core: the bare ref/id must NOT be the card's content.
    expect(body).not.toContain("post_abc123");
    expect(view.summaryMissing).toBe(false);
  });

  it("truncates a long caption to an excerpt", () => {
    const long = "x".repeat(500);
    const view = approvalCardView({ ...PAYLOAD, summary: { ...PAYLOAD.summary!, caption: long } });
    expect(view.captionExcerpt!.length).toBeLessThanOrEqual(181);
    expect(view.captionExcerpt!.endsWith("…")).toBe(true);
  });

  it("a missing summary is said honestly (post deleted), still no bare id", () => {
    const view = approvalCardView({ ...PAYLOAD, summary: null });
    expect(view.summaryMissing).toBe(true);
    const body = [view.title, ...view.detailLines].join("\n");
    expect(body).toMatch(/couldn't be loaded/i);
    expect(body).not.toContain("post_abc123");
  });
});

describe("asApprovalCardPayload", () => {
  it("parses a persisted payload and defaults unknown status to pending", () => {
    const parsed = asApprovalCardPayload({ toolName: "approveScheduledPost", ref: "p1", status: "weird", summary: null });
    expect(parsed).toMatchObject({ toolName: "approveScheduledPost", ref: "p1", status: "pending", summary: null });
  });
  it("rejects non-approval payloads", () => {
    expect(asApprovalCardPayload({ prompt: "a GEN_CARD payload" })).toBeNull();
    expect(asApprovalCardPayload(null)).toBeNull();
  });
});

// ── #524 r6(判官 r5 P1-A'②):`failed` 有两句话,不是一句 ────────────────────────────
//
// r5 的卡面对每一张 failed 卡都写「nothing was charged」。可 SDK 恢复是**先跑已批准的工具、
// 再进下一次模型调用** —— 工具完全可能已经建了并付了一单,然后模型才抛错。那句话于是成了
// 一句商家看不穿的假话。哪一句能说,由账本证出来的 `chargeVerdict` 决定。
describe("approvalCardResolutionText — the failed card only claims a zero it can prove (#524 r6)", () => {
  const failed = (chargeVerdict?: "zero" | "unknown"): ApprovalCardPayload => ({
    toolName: "generateReferences",
    ref: "ent_1",
    status: "failed",
    summary: null,
    ...(chargeVerdict ? { chargeVerdict } : {}),
  });

  it("proven zero says so, in the merchant's own words", () => {
    const text = approvalCardResolutionText(failed("zero"))!;
    expect(text).toContain("nothing was charged");
    expect(text).toContain("Ask Otto to set it up again");
  });

  it("unproven NEVER claims a zero — it says what is true and where to look", () => {
    const text = approvalCardResolutionText(failed("unknown"))!;
    expect(text).not.toContain("nothing was charged");
    expect(text).toContain("may already have been charged");
    expect(text).toContain("Billing");
  });

  it("an absent verdict reads as unproven — the fail-closed arm is the sentence that promises less", () => {
    expect(approvalCardResolutionText(failed())).toBe(approvalCardResolutionText(failed("unknown")));
    // …and asApprovalCardPayload is where that default is applied, so a card written before the
    // field existed can never be rendered as a proven zero.
    expect(asApprovalCardPayload({ toolName: "x", ref: "r", status: "failed" })!.chargeVerdict).toBe("unknown");
    expect(asApprovalCardPayload({ toolName: "x", ref: "r", status: "failed", chargeVerdict: "zero" })!.chargeVerdict).toBe("zero");
    expect(asApprovalCardPayload({ toolName: "x", ref: "r", status: "failed", chargeVerdict: "nonsense" })!.chargeVerdict).toBe("unknown");
  });

  it("the other resolutions are unchanged, and a pending card has no resolution sentence at all", () => {
    expect(approvalCardResolutionText({ ...failed(), status: "approved" })).toBe("Approved — it will publish as scheduled.");
    expect(approvalCardResolutionText({ ...failed(), status: "rejected" })).toBe("Declined — nothing was published.");
    expect(approvalCardResolutionText({ ...failed(), status: "expired" })).toContain("expired");
    expect(approvalCardResolutionText({ ...failed(), status: "pending" })).toBeNull();
  });
});
