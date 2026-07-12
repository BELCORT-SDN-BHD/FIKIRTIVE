import { it, expect, vi } from "vitest";
import { sharePostPreviewSkill, executeSharePostPreview } from "./share-post-preview.js";

it("gate: free/write/INTERNAL → ungated (minting a share link touches no external platform)", () => {
  expect(sharePostPreviewSkill.cost).toBe("free");
  expect(sharePostPreviewSkill.effect).toBe("write");
  expect(sharePostPreviewSkill.reach).toBe("internal");
  // internal write ≠ external publish → NOT gated (contrast approveScheduledPost's external write).
  expect(sharePostPreviewSkill.needsApproval).toBe(false);
});

it("mints via the owner-scoped port and returns the link", async () => {
  const sharePreview = vi.fn(async () => ({
    token: "tok.sig",
    url: "https://app.example/s/tok.sig",
    expiresAt: "2026-07-14T00:00:00.000Z",
  }));
  const res: any = await executeSharePostPreview(
    { scheduledPostId: "p1" },
    { context: { schedule: { sharePreview } } as any },
  );
  expect(sharePreview).toHaveBeenCalledWith({ scheduledPostId: "p1" });
  expect(res.url).toContain("tok.sig");
});

it("relays the server's error for a post the caller does not own (越权 → error, no link)", async () => {
  const sharePreview = vi.fn(async () => ({ error: "Post not found." }));
  const res: any = await executeSharePostPreview(
    { scheduledPostId: "not-mine" },
    { context: { schedule: { sharePreview } } as any },
  );
  expect(res.error).toBe("Post not found.");
  expect(res.url).toBeUndefined();
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeSharePostPreview({ scheduledPostId: "p1" }, { context: {} as any });
  expect(res.error).toBeTruthy();
});
