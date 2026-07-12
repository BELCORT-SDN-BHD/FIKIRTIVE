import { it, expect, vi } from "vitest";
import { listScheduledPostsSkill, executeListScheduledPosts } from "./list-scheduled-posts.js";

it("gate: free/read/internal → ungated", () => {
  expect(listScheduledPostsSkill.cost).toBe("free");
  expect(listScheduledPostsSkill.effect).toBe("read");
  expect(listScheduledPostsSkill.reach).toBe("internal");
  expect(listScheduledPostsSkill.needsApproval).toBe(false);
});

it("returns the owner-scoped rows from the port and passes the window through", async () => {
  const list = vi.fn(async () => [
    { id: "p1", channel: "instagram", caption: "hi", status: "DRAFT", scheduledAt: "2026-07-10T09:00:00.000Z", scheduledTz: "UTC", approvedAt: null, mediaCount: 1, lastError: null },
  ]);
  const res: any = await executeListScheduledPosts({ from: "2026-07-01", to: "2026-07-31" }, { context: { schedule: { list } } as any });
  expect(list).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-07-31" });
  expect(res.posts[0].id).toBe("p1");
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeListScheduledPosts({}, { context: {} as any });
  expect(res.error).toBeTruthy();
});
