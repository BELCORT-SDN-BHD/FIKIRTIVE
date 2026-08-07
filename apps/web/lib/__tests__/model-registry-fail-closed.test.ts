/**
 * #647 T6 修复轮 P1-3 —— **开关读不到 ≠ 什么都没关**(网页侧)。
 *
 * 判官 r1 现场:`resolveDisabledModels`(apps/web/lib/model-registry.ts)把**一切** DB 错误
 * 吞掉并返回空集合,注释还把这件事写成一条特性(「fail-closed-to-typed-menu」)。可这个
 * 「typed menu」拦的是「这个模型存不存在」,拦不了「这个模型现在允不允许卖」—— 后台开关
 * 是**唯一**能表达后者的地方。于是「库里全禁用 + 配置查询瞬时失败」这一刻:
 * Otto/分镜照旧铸出付费卡,`startGen` 照旧放行扣款。开关成了一个查询一抖就自动打开的锁。
 *
 * 钱路的规矩这个仓库已经裁过(#652/#657 同族):**结果不明就不许前进**。所以读不到开关
 * 状态时,唯一诚实的答案是「暂时做不了,等一下再试」,而不是「那就当没关吧」。
 *
 * 这个文件**不 mock resolver** —— 它让 prisma 那一次 overlay 查询直接抛,然后问真入口:
 * 你会不会照样落卡。判官点名的正是「接线测试 mock 了 resolver,没盖这个边界」。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockOverlayFindMany, mockChatFindFirst, mockChatCreate, mockChatUpdate, mockChatCreateMany, mockThreadUpdate, db } =
  vi.hoisted(() => {
    const mockOverlayFindMany = vi.fn();
    const mockChatFindFirst = vi.fn();
    const mockChatCreate = vi.fn();
    const mockChatUpdate = vi.fn();
    const mockChatCreateMany = vi.fn();
    const mockThreadUpdate = vi.fn();
    const db: Record<string, unknown> = {
      modelRegistryOverlay: { findMany: mockOverlayFindMany },
      chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate, update: mockChatUpdate, createMany: mockChatCreateMany },
      chatThread: { update: mockThreadUpdate },
      actionEvent: { create: vi.fn().mockResolvedValue({}) },
      genJob: { findFirst: vi.fn().mockResolvedValue(null) },
      entity: { findMany: vi.fn().mockResolvedValue([]) },
      generation: { findMany: vi.fn().mockResolvedValue([]) },
      referenceImage: { count: vi.fn().mockResolvedValue(0) },
    };
    db.$executeRaw = vi.fn().mockResolvedValue(1);
    db.$transaction = async (arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as Promise<unknown>[]);
    return { mockOwner: vi.fn(), mockOverlayFindMany, mockChatFindFirst, mockChatCreate, mockChatUpdate, mockChatCreateMany, mockThreadUpdate, db };
  });

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {}, refundReservation: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../gen-actions", () => ({ startCoworkGen: vi.fn() }));
vi.mock("../cowork-knowledge", () => ({ getEnhanceDirective: vi.fn() }));
// 注意:`../model-registry` **没有**被 mock —— 这个文件测的就是它。

import { getStoryboardVideoOptions, prepareStoryboardVideos } from "../storyboard-gate1-actions";
import { coworkVaryCard } from "../cowork-actions";
import { resolveDisabledModels } from "../model-registry";

const OWNER = "owner-1";
/** 读不到开关 ≠ 被关掉。两句话必须能分辨:一个是「有人关了它」,一个是「我们现在不知道」。 */
const TEMPORARILY = "Generation is temporarily unavailable — please try again in a moment.";

function storyboardCard() {
  return {
    id: "card-1",
    threadId: "t-1",
    payload: {
      storyboardTitle: "Ad",
      shots: [{ shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameGenerationId: "gen-ff0" }],
    },
    thread: { ownerId: OWNER, deletedAt: null },
  };
}

function genCard() {
  return {
    id: "gen-card-1",
    threadId: "t-1",
    payload: {
      kind: "video", model: "seedance-2-fast", structuredPrompt: "a cat walks",
      entityIds: [], variantSel: {}, params: { count: 1, durationSeconds: 5, resolution: "720p" }, estimatedCredits: 11,
    },
    genJobId: null,
    thread: { projectId: "p-1", deletedAt: null, ownerId: OWNER },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockChatCreate.mockResolvedValue({});
  mockChatUpdate.mockResolvedValue({});
  mockChatCreateMany.mockResolvedValue({ count: 2 });
  mockThreadUpdate.mockResolvedValue({});
  const sb = storyboardCard();
  const gc = genCard();
  mockChatFindFirst.mockImplementation(async (args: { where?: { kind?: string }; orderBy?: unknown }) => {
    if (args?.where?.kind === "STORYBOARD_CARD") return sb;
    if (args?.where?.kind === "GEN_CARD") return gc;
    if (args?.orderBy) return { seq: 3 };
    return null;
  });
});

describe("#647 T6 修复轮 P1-3:开关查询失败 ⇒ fail closed(网页侧)", () => {
  beforeEach(() => {
    mockOverlayFindMany.mockRejectedValue(new Error("connection terminated unexpectedly"));
  });

  it("resolver 自己不再把故障翻译成「空集合」—— 它如实报「不知道」", async () => {
    const r = await resolveDisabledModels();
    expect(r).toEqual({ error: TEMPORARILY });
  });

  it("分镜时长选项读:不报档位表,报「暂时不可用」", async () => {
    const r = await getStoryboardVideoOptions();
    expect(r).toEqual({ error: TEMPORARILY });
  });

  it("分镜闸②:零子卡落库,零父卡改写", async () => {
    const r = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(r).toEqual({ error: TEMPORARILY });
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("Make another / Try again:零卡落库", async () => {
    const r = await coworkVaryCard({ cardId: "gen-card-1" });
    expect(r).toEqual({ error: TEMPORARILY });
    expect(mockChatCreateMany).not.toHaveBeenCalled();
    expect(mockThreadUpdate).not.toHaveBeenCalled();
  });

  it("文案分得清「被关掉」与「读不到」,且不出现任何引擎/供应商名", async () => {
    const r = await getStoryboardVideoOptions();
    expect(JSON.stringify(r)).not.toMatch(/seedream|seedance|byteplus|bytedance|fal|kling|veo/iu);
    expect(TEMPORARILY).not.toBe("Video generation is turned off right now.");
    expect(TEMPORARILY).toMatch(/^[A-Z]/u);
  });
});

describe("#647 T6 修复轮 P1-3:读得到时行为逐字不变(可用性只在故障形状收紧)", () => {
  it("查询正常返回空 ⇒ 什么都没关,分镜照常给真实档位并铸卡", async () => {
    mockOverlayFindMany.mockResolvedValue([]);
    const opts = await getStoryboardVideoOptions();
    expect(opts).not.toHaveProperty("error");
    expect((opts as { durations: number[] }).durations).toContain(5);

    const prep = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(prep).not.toHaveProperty("error");
    expect(mockChatCreate).toHaveBeenCalled();
  });

  it("查询正常返回禁用行 ⇒ 仍是「被关掉」那一句(与读不到区分开)", async () => {
    mockOverlayFindMany.mockResolvedValue([{ modelId: "seedance-2-fast" }]);
    const r = await getStoryboardVideoOptions();
    expect(r).toEqual({ error: "Video generation is turned off right now." });
  });

  it("查询正常时 resolver 只回在册 id(未知 id 照旧在解析边界被丢掉)", async () => {
    mockOverlayFindMany.mockResolvedValue([{ modelId: "seedance-2-fast" }, { modelId: "kling" }, { modelId: "" }]);
    const r = await resolveDisabledModels();
    expect("disabled" in r).toBe(true);
    if (!("disabled" in r)) return;
    expect([...r.disabled]).toEqual(["seedance-2-fast"]);
  });
});
