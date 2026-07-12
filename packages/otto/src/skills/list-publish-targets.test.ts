import { it, expect, vi } from "vitest";
import { listPublishTargetsSkill, executeListPublishTargets } from "./list-publish-targets.js";

it("gate: free/read/internal → ungated", () => {
  expect(listPublishTargetsSkill.cost).toBe("free");
  expect(listPublishTargetsSkill.effect).toBe("read");
  expect(listPublishTargetsSkill.reach).toBe("internal");
  expect(listPublishTargetsSkill.needsApproval).toBe(false);
});

it("returns the owner's connected targets from the port", async () => {
  const listTargets = vi.fn(async () => [{ id: "ig1", name: "My IG", channel: "instagram" }]);
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(listTargets).toHaveBeenCalledTimes(1);
  expect(res.targets[0].id).toBe("ig1");
});

it("an unconnected owner gets an empty list (ads-only scope), not an error", async () => {
  const listTargets = vi.fn(async () => []);
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(res.targets).toEqual([]);
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeListPublishTargets({}, { context: {} as any });
  expect(res.error).toBeTruthy();
});
