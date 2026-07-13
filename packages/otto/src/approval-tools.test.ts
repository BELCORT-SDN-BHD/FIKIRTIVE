import { it, expect } from "vitest";
import { APPROVAL_TOOL_NAMES, approvalRefOf, collectApprovalInterruptions } from "./approval-tools.js";

it("the closed set is exactly the registry's needsApproval=true skills (incl. generate + approveScheduledPost + generateReferences)", () => {
  expect(APPROVAL_TOOL_NAMES.has("generate")).toBe(true);
  expect(APPROVAL_TOOL_NAMES.has("approveScheduledPost")).toBe(true);
  expect(APPROVAL_TOOL_NAMES.has("generateReferences")).toBe(true);
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
  // generateReferences anchors on entityId (the exact prompt/count/mode ride the card's content hash).
  expect(approvalRefOf("generateReferences", { entityId: "ent-1", prompt: "x", count: 3 })).toBe("ent-1");
  expect(approvalRefOf("generateReferences", { prompt: "x" })).toBeNull(); // no entityId ⇒ dropped
});

it("collectApprovalInterruptions pulls generate, schedule, and refgen approvals with their parsed args, tolerant of item shape", () => {
  const res = collectApprovalInterruptions([
    { name: "generate", arguments: JSON.stringify({ cardId: "c1" }) },
    { rawItem: { name: "approveScheduledPost", arguments: JSON.stringify({ scheduledPostId: "p9" }) } },
    { name: "generateReferences", arguments: JSON.stringify({ entityId: "ent-1", prompt: "a red cap", count: 2 }) },
    { name: "listScheduledPosts", arguments: "{}" }, // not gated — skipped
    { name: "generateReferences", arguments: JSON.stringify({ prompt: "no entity" }) }, // refless — dropped
    { name: "generate", arguments: "not json" },      // malformed — skipped
    null,
  ]);
  expect(res).toEqual([
    { toolName: "generate", ref: "c1", args: { cardId: "c1" } },
    { toolName: "approveScheduledPost", ref: "p9", args: { scheduledPostId: "p9" } },
    { toolName: "generateReferences", ref: "ent-1", args: { entityId: "ent-1", prompt: "a red cap", count: 2 } },
  ]);
});
