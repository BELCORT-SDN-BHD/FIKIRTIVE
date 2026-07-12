import { it, expect, vi } from "vitest";
import { cancelScheduledPostSkill, executeCancelScheduledPost } from "./cancel-scheduled-post.js";

it("gate: free/write/internal → ungated (cancel is not an external write)", () => {
  expect(cancelScheduledPostSkill.cost).toBe("free");
  expect(cancelScheduledPostSkill.effect).toBe("write");
  expect(cancelScheduledPostSkill.reach).toBe("internal");
  expect(cancelScheduledPostSkill.needsApproval).toBe(false);
});

it("goes through the owner-scoped cancel port with the post id", async () => {
  const cancel = vi.fn(async () => ({ ok: true as const }));
  const res = await executeCancelScheduledPost({ scheduledPostId: "p2" }, { context: { schedule: { cancel } } as any });
  expect(cancel).toHaveBeenCalledWith({ scheduledPostId: "p2" });
  expect(res).toEqual({ ok: true });
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeCancelScheduledPost({ scheduledPostId: "p2" }, { context: {} as any });
  expect(res.error).toBeTruthy();
});

it("relays a state-machine refusal verbatim", async () => {
  const cancel = vi.fn(async () => ({ error: "This post can't be cancelled from its current state." }));
  const res: any = await executeCancelScheduledPost({ scheduledPostId: "p2" }, { context: { schedule: { cancel } } as any });
  expect(res.error).toMatch(/current state/);
});
