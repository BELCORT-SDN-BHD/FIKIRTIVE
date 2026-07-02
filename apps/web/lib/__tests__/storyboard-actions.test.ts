import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoryboardCardPayload } from "@fikirtive/otto";

const { mockOwner, mockFindFirst, mockUpdate } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { chatMessage: { findFirst: mockFindFirst, update: mockUpdate } },
  Prisma: {},
}));

import { editShotPrompt, addShot, deleteShot, reorderShots } from "../storyboard-actions";

const OWNER = "owner-1";
function card(payload: StoryboardCardPayload) {
  return { id: "card-1", threadId: "t-1", payload, thread: { ownerId: OWNER, deletedAt: null } };
}
function payload3(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameGenerationId: "gen0" },
      { index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
      { index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockUpdate.mockResolvedValue({});
});

describe("editShotPrompt", () => {
  it("owner-scoped 载入 + 回写清了 firstFrameGenerationId 的 payload", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await editShotPrompt({ cardId: "card-1", index: 0, firstFramePrompt: "NEW" });
    // 载入必须按 id + ownerId + kind owner-scoped
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "card-1", ownerId: OWNER, kind: "STORYBOARD_CARD", deletedAt: null }) }),
    );
    expect("payload" in res).toBe(true);
    if ("payload" in res) {
      expect(res.payload.shots[0].firstFramePrompt).toBe("NEW");
      expect(res.payload.shots[0].firstFrameGenerationId).toBeUndefined();
    }
    // 回写到同一 cardId,且不碰 genJob
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "card-1" } }));
    const data = mockUpdate.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(["payload"]); // 只改 payload,绝不动 genJobId
  });

  it("requireOwner 失败 → 直接返回 error,不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await editShotPrompt({ cardId: "card-1", index: 0, firstFramePrompt: "NEW" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("卡片不存在(或非本人)→ error,不回写", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await editShotPrompt({ cardId: "card-1", index: 0, firstFramePrompt: "NEW" });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("非法入参 → error,不碰 DB", async () => {
    const res = await editShotPrompt({ cardId: "", index: -1 } as unknown as { cardId: string; index: number });
    expect("error" in res).toBe(true);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("两个 prompt 字段都不传 → error,不碰 DB", async () => {
    const res = await editShotPrompt({ cardId: "card-1", index: 0 });
    expect("error" in res).toBe(true);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe("addShot", () => {
  it("追加并回写", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await addShot({ cardId: "card-1", firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect("payload" in res && res.payload.shots).toHaveLength(4);
  });
  it("到上限(8)拒绝", async () => {
    const full = payload3();
    full.shots = Array.from({ length: 8 }, (_, i) => ({ index: i, firstFramePrompt: `ff${i}`, videoPrompt: `v${i}` }));
    mockFindFirst.mockResolvedValue(card(full));
    const res = await addShot({ cardId: "card-1", firstFramePrompt: "x", videoPrompt: "y" });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteShot", () => {
  it("删并回写", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await deleteShot({ cardId: "card-1", index: 1 });
    expect("payload" in res && res.payload.shots).toHaveLength(2);
  });
  it("不允许删到 0(只剩 1 时拒绝)", async () => {
    const one = payload3();
    one.shots = [one.shots[0]];
    mockFindFirst.mockResolvedValue(card(one));
    const res = await deleteShot({ cardId: "card-1", index: 0 });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("reorderShots", () => {
  it("重排并回写", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await reorderShots({ cardId: "card-1", order: [2, 0, 1] });
    expect("payload" in res && res.payload.shots.map((s) => s.firstFramePrompt)).toEqual(["ff2", "ff0", "ff1"]);
  });

  it("非法排列(长度不对)→ error,不回写", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await reorderShots({ cardId: "card-1", order: [0, 1] });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("requireOwner 失败 → 直接返回 error,不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    const res = await reorderShots({ cardId: "card-1", order: [2, 0, 1] });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("卡片不存在(或非本人)→ error,不回写", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await reorderShots({ cardId: "card-1", order: [2, 0, 1] });
    expect("error" in res).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
