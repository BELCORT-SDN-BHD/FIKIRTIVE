import { it, expect, vi } from "vitest";
import { editScheduledPostSkill, executeEditScheduledPost } from "./edit-scheduled-post.js";

it("gate: free/write/internal → ungated", () => {
  expect(editScheduledPostSkill.cost).toBe("free");
  expect(editScheduledPostSkill.effect).toBe("write");
  expect(editScheduledPostSkill.reach).toBe("internal");
  expect(editScheduledPostSkill.needsApproval).toBe(false);
});

it("forwards ONLY the provided fields (mediaGenerationIds → media) through the shared update port", async () => {
  const update = vi.fn(async () => ({ ok: true as const }));
  await executeEditScheduledPost(
    { scheduledPostId: "p3", caption: "New copy", mediaGenerationIds: ["g1", "g2"] },
    { context: { schedule: { update } } as any },
  );
  expect(update).toHaveBeenCalledWith({
    scheduledPostId: "p3",
    patch: { caption: "New copy", media: ["g1", "g2"] },
  });
});

it("debt-72 invariant is INHERITED: the skill relays whatever the shared action returns (re-consent lives there)", async () => {
  // The material-edit→DRAFT/clear-approvedAt rule is enforced by updateScheduledPost, not re-implemented
  // here; the skill just forwards and relays. We assert the pass-through, no second copy of the rule.
  const update = vi.fn(async () => ({ ok: true as const }));
  const res = await executeEditScheduledPost(
    { scheduledPostId: "p3", scheduledAt: "2026-07-10T09:00:00Z" },
    { context: { schedule: { update } } as any },
  );
  expect(update).toHaveBeenCalledWith({ scheduledPostId: "p3", patch: { scheduledAt: "2026-07-10T09:00:00Z" } });
  expect(res).toEqual({ ok: true });
});

it("refuses an empty patch (nothing to change) without calling the port", async () => {
  const update = vi.fn(async () => ({ ok: true as const }));
  const res: any = await executeEditScheduledPost({ scheduledPostId: "p3" }, { context: { schedule: { update } } as any });
  expect(update).not.toHaveBeenCalled();
  expect(res.error).toBeTruthy();
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeEditScheduledPost({ scheduledPostId: "p3", caption: "x" }, { context: {} as any });
  expect(res.error).toBeTruthy();
});
