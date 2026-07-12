/**
 * R1 rider assertion (B4 debt-70 card chain): the approval card renders the consent OBJECT —
 * channel / scheduled time / caption summary — never a bare id. approvalCardView is the single
 * rendering source for OttoApprovalCard, so these assertions ARE the card-content contract.
 */
import { describe, it, expect } from "vitest";
import { approvalCardView, asApprovalCardPayload, type ApprovalCardPayload } from "@/lib/approval-card-view";

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
