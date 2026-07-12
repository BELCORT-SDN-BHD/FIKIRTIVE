import { it, expect, vi } from "vitest";
import { approveScheduledPostSkill, executeApproveScheduledPost } from "./approve-scheduled-post.js";
import { deriveNeedsApproval } from "../skill.js";

// debt-70 三断言 (B4 spec §五 5.1) + gate.

it("gate: free/write/external → needsApproval MACHINE-derived true (assertion ③: no self-approve path)", () => {
  expect(approveScheduledPostSkill.cost).toBe("free");
  expect(approveScheduledPostSkill.effect).toBe("write");
  expect(approveScheduledPostSkill.reach).toBe("external");
  // Machine-derived — the derivation law, not a hand flag, forces approval. Otto cannot route around it.
  expect(deriveNeedsApproval("free", "write", "external")).toBe(true);
  expect(approveScheduledPostSkill.needsApproval).toBe(true);
});

it("assertion ②: on execute (approval-card resume) it goes through the SAME owner-scoped approve action, threading the hash-time snapshot (AR2 处方1)", async () => {
  const approve = vi.fn(async () => ({ ok: true as const }));
  const ctx = {
    schedule: { approve },
    approvalConsent: { scheduledPostId: "p1", expectedUpdatedAt: "2026-07-12T10:00:00.000Z" },
  };
  const res = await executeApproveScheduledPost({ scheduledPostId: "p1" }, { context: ctx as any });
  expect(approve).toHaveBeenCalledTimes(1);
  // The snapshot comes from ctx (server-injected at hash-verification), NEVER from model args.
  expect(approve).toHaveBeenCalledWith({ scheduledPostId: "p1", expectedUpdatedAt: "2026-07-12T10:00:00.000Z" });
  expect(res).toEqual({ ok: true });
});

it("AR2 处方1 fail-closed: no ctx.approvalConsent (any non-card path) → refuse, port never called", async () => {
  const approve = vi.fn(async () => ({ ok: true as const }));
  const res: any = await executeApproveScheduledPost({ scheduledPostId: "p1" }, { context: { schedule: { approve } } as any });
  expect(approve).not.toHaveBeenCalled();
  expect(res.error).toMatch(/approval card/i);
});

it("AR2 处方1 fail-closed: consent snapshot for a DIFFERENT post → refuse, port never called", async () => {
  const approve = vi.fn(async () => ({ ok: true as const }));
  const ctx = {
    schedule: { approve },
    approvalConsent: { scheduledPostId: "p_OTHER", expectedUpdatedAt: "2026-07-12T10:00:00.000Z" },
  };
  const res: any = await executeApproveScheduledPost({ scheduledPostId: "p1" }, { context: ctx as any });
  expect(approve).not.toHaveBeenCalled();
  expect(res.error).toMatch(/approval card/i);
});

it("assertion ①: with no approve port injected it writes nothing and reports gracefully", async () => {
  const res: any = await executeApproveScheduledPost({ scheduledPostId: "p1" }, { context: {} as any });
  expect(res.error).toBeTruthy();
});

it("relays a port error (e.g. owner-scope / state-machine refusal) verbatim, no throw", async () => {
  const approve = vi.fn(async () => ({ error: "This post can't be approved from its current state." }));
  const ctx = {
    schedule: { approve },
    approvalConsent: { scheduledPostId: "p1", expectedUpdatedAt: "2026-07-12T10:00:00.000Z" },
  };
  const res: any = await executeApproveScheduledPost({ scheduledPostId: "p1" }, { context: ctx as any });
  expect(res.error).toMatch(/current state/);
});
