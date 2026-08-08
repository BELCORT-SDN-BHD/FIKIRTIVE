import { it, expect, vi } from "vitest";
import { CONNECTION_BLOCKER_COPY } from "@fikirtive/core";
import { listPublishTargetsSkill, executeListPublishTargets } from "./list-publish-targets.js";

const ALL_OK = { instagram: "ok", facebook: "ok", x: "ok" } as const;

it("gate: free/read/internal → ungated", () => {
  expect(listPublishTargetsSkill.cost).toBe("free");
  expect(listPublishTargetsSkill.effect).toBe("read");
  expect(listPublishTargetsSkill.reach).toBe("internal");
  expect(listPublishTargetsSkill.needsApproval).toBe(false);
});

it("returns the owner's connected targets from the port", async () => {
  const listTargets = vi.fn(async () => ({
    targets: [{ id: "ig1", name: "My IG", channel: "instagram" }],
    channelStates: ALL_OK,
  }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(listTargets).toHaveBeenCalledTimes(1);
  expect(res.targets[0].id).toBe("ig1");
  expect(res.incomplete).toBeUndefined();
});

it("an unconnected owner gets an empty list (ads-only scope), not an error", async () => {
  const listTargets = vi.fn(async () => ({ targets: [], channelStates: ALL_OK }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(res.targets).toEqual([]);
  expect(res.incomplete).toBeUndefined();
});

// #741 r5 [P1] —— 名单是**逐渠道**的。某个渠道没读到,它就不在名单里;若照旧把整份名单
// 当成完整答案交给 Otto,Otto 就会替我们说出那句谎话:「你的 Instagram 一个账号都没连」。
it("有渠道没读到时:如实标注不完整,绝不把沉默当成「那个渠道没连」", async () => {
  const listTargets = vi.fn(async () => ({
    targets: [{ id: "fb1", name: "My Page", channel: "facebook" }],
    channelStates: { instagram: "unreadable", facebook: "ok", x: "ok" },
  }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(res.targets).toHaveLength(1);
  expect(res.incomplete).toEqual({ instagram: "unreadable" });
  expect(String(res.message)).toMatch(/instagram/i);
});

it("渠道连着但用不了:用共享权威的标签,不说「没连」", async () => {
  const listTargets = vi.fn(async () => ({
    targets: [],
    channelStates: { instagram: "needs_reconnect", facebook: "needs_reconnect", x: "ok" },
  }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(res.incomplete).toEqual({ instagram: "needs_reconnect", facebook: "needs_reconnect" });
  expect(String(res.message)).toContain(CONNECTION_BLOCKER_COPY.needs_reconnect.status);
});

it("整读都没到(没有任何渠道状态):不给出「一个都没连」的结论", async () => {
  const listTargets = vi.fn(async () => ({ targets: [], channelStates: {} }));
  const res: any = await executeListPublishTargets({}, { context: { schedule: { listTargets } } as any });
  expect(res.incomplete).toBeTruthy();
  expect(String(res.message)).toMatch(/couldn't|could not/i);
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeListPublishTargets({}, { context: {} as any });
  expect(res.error).toBeTruthy();
});
