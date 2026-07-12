import { it, expect } from "vitest";
import { APPROVAL_TOOL_NAMES, approvalRefOf, collectApprovalInterruptions } from "./approval-tools.js";

it("the closed set is exactly the registry's needsApproval=true skills (incl. generate + approveScheduledPost)", () => {
  expect(APPROVAL_TOOL_NAMES.has("generate")).toBe(true);
  expect(APPROVAL_TOOL_NAMES.has("approveScheduledPost")).toBe(true);
  // Non-gated skills stay OUT — e.g. a $0 read/internal-write must never be matched.
  expect(APPROVAL_TOOL_NAMES.has("listScheduledPosts")).toBe(false);
  expect(APPROVAL_TOOL_NAMES.has("cancelScheduledPost")).toBe(false);
  expect(APPROVAL_TOOL_NAMES.has("schedulePosts")).toBe(false);
});

it("approvalRefOf binds each gated tool to its own argument", () => {
  expect(approvalRefOf("generate", { cardId: "c1" })).toBe("c1");
  expect(approvalRefOf("approveScheduledPost", { scheduledPostId: "p1" })).toBe("p1");
  expect(approvalRefOf("generate", {})).toBeNull();
  expect(approvalRefOf("approveScheduledPost", { scheduledPostId: "" })).toBeNull();
  expect(approvalRefOf("cancelScheduledPost", { scheduledPostId: "p1" })).toBeNull(); // not gated
});

it("collectApprovalInterruptions pulls both generate and schedule approvals, tolerant of item shape", () => {
  const res = collectApprovalInterruptions([
    { name: "generate", arguments: JSON.stringify({ cardId: "c1" }) },
    { rawItem: { name: "approveScheduledPost" }, arguments: JSON.stringify({ scheduledPostId: "p9" }) },
    { name: "listScheduledPosts", arguments: "{}" }, // not gated — skipped
    { name: "generate", arguments: "not json" },      // malformed — skipped
    null,
  ]);
  expect(res).toEqual([
    { toolName: "generate", ref: "c1" },
    { toolName: "approveScheduledPost", ref: "p9" },
  ]);
});
