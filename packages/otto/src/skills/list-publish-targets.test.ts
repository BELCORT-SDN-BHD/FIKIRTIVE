import { it, expect, vi } from "vitest";
import { listPublishTargetsSkill, executeListPublishTargets } from "./list-publish-targets.js";

it("gate: free/read/internal → ungated", () => {
  expect(listPublishTargetsSkill.cost).toBe("free");
  expect(listPublishTargetsSkill.effect).toBe("read");
  expect(listPublishTargetsSkill.reach).toBe("internal");
  expect(listPublishTargetsSkill.needsApproval).toBe(false);
});

it("returns the owner's connected targets from the port", async () => {
  const listTargets = vi.fn(async () => ({ targets: [{ id: "ig1", name: "My IG", channel: "instagram" }] }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(listTargets).toHaveBeenCalledTimes(1);
  expect(res.targets[0].id).toBe("ig1");
});

it("an unconnected owner gets an empty list (ads-only scope), not an error", async () => {
  const listTargets = vi.fn(async () => ({ targets: [] }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(res.targets).toEqual([]);
});

// #741 判官 r3 [P1] —— 同一句谎话不许换张嘴说。人工界面修好了,Otto 若还把「读不到」
// 当成空列表,商家问 Otto「我连了哪些账号」照样会被告知「一个都没连」。
it("读不到时不给空列表 —— Otto 拿到的是「没查到」,不是「你一个都没连」", async () => {
  const listTargets = vi.fn(async () => ({ unavailable: true as const }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(res.targets).toBeUndefined();
  expect(res.unavailable).toBe(true);
  expect(String(res.message)).toMatch(/couldn't check/i);
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeListPublishTargets({}, { context: {} as any });
  expect(res.error).toBeTruthy();
});
