/**
 * #647 T6 —— 引擎被后台关掉时,网页侧每一个铸卡入口的**诚实空态**。
 *
 * 缺陷现场:`suggestModel` 收下 `disabled` 却从不使用。分镜闸②因此照旧选中那台被关掉的
 * 引擎、照旧算出时长与价钱、照旧把一张写着 credits 的子卡落进对话里。商家点下去,才在
 * spend 闸吃一个「That model is currently turned off」。$0 铸的卡不等于没有代价 ——
 * 它在商家眼里是一个可以点的承诺。
 *
 * 这个文件用**真的** core/otto(不 mock 选型,不 mock 铸卡),只把身份、后台开关与 prisma
 * 换成夹具,所以它测的是真接线:关掉唯一那台视频引擎之后,分镜侧一张卡都不许落库。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GEN_VIDEO_MODELS } from "@fikirtive/core";

const { mockOwner, mockResolveDisabled, mockChatFindFirst, mockChatCreate, mockChatUpdate, db } = vi.hoisted(() => {
  const mockChatFindFirst = vi.fn();
  const mockChatCreate = vi.fn();
  const mockChatUpdate = vi.fn();
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate, update: mockChatUpdate },
    genJob: { findFirst: vi.fn().mockResolvedValue(null) },
    entity: { findMany: vi.fn().mockResolvedValue([]) },
    generation: { findMany: vi.fn().mockResolvedValue([]) },
    referenceImage: { count: vi.fn().mockResolvedValue(0) },
  };
  db.$executeRaw = vi.fn().mockResolvedValue(1);
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return {
    mockOwner: vi.fn(),
    mockResolveDisabled: vi.fn(),
    mockChatFindFirst,
    mockChatCreate,
    mockChatUpdate,
    db,
  };
});

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: mockResolveDisabled }));
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {} }));

import { getStoryboardVideoOptions, prepareStoryboardVideos } from "../storyboard-gate1-actions";

const OWNER = "owner-1";
const VIDEO_OFF = "Video generation is turned off right now.";

/** 一张分镜卡:一个镜头已有首帧、还没有片子 —— 闸② 眼里最标准的「该铸一张视频子卡」。 */
function storyboardCard() {
  return {
    id: "card-1",
    threadId: "t-1",
    payload: {
      storyboardTitle: "Ad",
      shots: [
        { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameGenerationId: "gen-ff0" },
      ],
    },
    thread: { ownerId: OWNER, deletedAt: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockChatCreate.mockResolvedValue({});
  mockChatUpdate.mockResolvedValue({});
  const card = storyboardCard();
  mockChatFindFirst.mockImplementation(async (args: { where?: { kind?: string } }) =>
    args?.where?.kind === "STORYBOARD_CARD" ? card : null,
  );
});

describe("#647 T6 唯一视频引擎被关掉 ⇒ 分镜侧给诚实空态,零卡落库", () => {
  beforeEach(() => {
    mockResolveDisabled.mockResolvedValue(new Set<string>([...GEN_VIDEO_MODELS]));
  });

  it("时长选项读:不再报一份根本交付不了的档位表,而是明说不可用", async () => {
    const r = await getStoryboardVideoOptions();
    expect(r).toEqual({ error: VIDEO_OFF });
  });

  it("闸②铸卡:返回同一句人话,而且**一张子卡都没落库**", async () => {
    const r = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(r).toEqual({ error: VIDEO_OFF });
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it("空态文案是 English sentence case,且不出现任何引擎/供应商名(引擎保密)", async () => {
    const r = await getStoryboardVideoOptions();
    expect(JSON.stringify(r)).not.toMatch(/seedream|seedance|byteplus|bytedance|fal|kling|veo/iu);
    expect(VIDEO_OFF).toMatch(/^[A-Z][^.!?]*\.$/u); // 一句话,首字母大写,其余小写起头
  });
});

describe("#647 T6 引擎没关时一切照旧(空态不许误伤正常路)", () => {
  beforeEach(() => {
    mockResolveDisabled.mockResolvedValue(new Set<string>());
  });

  it("时长选项照常返回在产引擎的真实档位", async () => {
    const r = await getStoryboardVideoOptions();
    expect(r).not.toHaveProperty("error");
    expect((r as { durations: number[] }).durations).toContain(5);
  });

  it("闸②照常铸出视频子卡", async () => {
    const r = await prepareStoryboardVideos({ cardId: "card-1" });
    expect(r).not.toHaveProperty("error");
    expect(mockChatCreate).toHaveBeenCalled();
  });
});
