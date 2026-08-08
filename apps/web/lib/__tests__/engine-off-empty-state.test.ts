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

const {
  mockOwner, mockResolveDisabled, mockChatFindFirst, mockChatCreate, mockChatUpdate,
  mockChatCreateMany, mockThreadUpdate, mockActionEventCreate, db,
} = vi.hoisted(() => {
  const mockChatFindFirst = vi.fn();
  const mockChatCreate = vi.fn();
  const mockChatUpdate = vi.fn();
  const mockChatCreateMany = vi.fn();
  const mockThreadUpdate = vi.fn();
  const mockActionEventCreate = vi.fn();
  const db: Record<string, unknown> = {
    chatMessage: { findFirst: mockChatFindFirst, create: mockChatCreate, update: mockChatUpdate, createMany: mockChatCreateMany },
    chatThread: { update: mockThreadUpdate },
    actionEvent: { create: mockActionEventCreate },
    genJob: { findFirst: vi.fn().mockResolvedValue(null) },
    entity: { findMany: vi.fn().mockResolvedValue([]) },
    generation: { findMany: vi.fn().mockResolvedValue([]) },
    referenceImage: { count: vi.fn().mockResolvedValue(0) },
  };
  db.$executeRaw = vi.fn().mockResolvedValue(1);
  // coworkVaryCard 用数组形式的 $transaction([...]);分镜用回调形式。两种都要支持。
  db.$transaction = async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as Promise<unknown>[]);
  return {
    mockOwner: vi.fn(),
    mockResolveDisabled: vi.fn(),
    mockChatFindFirst,
    mockChatCreate,
    mockChatUpdate,
    mockChatCreateMany,
    mockThreadUpdate,
    mockActionEventCreate,
    db,
  };
});

vi.mock("../auth-guard", async () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("../model-registry", () => ({ resolveDisabledModels: mockResolveDisabled }));
vi.mock("@fikirtive/db", () => ({ prisma: db, Prisma: {}, refundReservation: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../gen-actions", () => ({ startCoworkGen: vi.fn() }));
vi.mock("../cowork-knowledge", () => ({ getEnhanceDirective: vi.fn() }));

import { getStoryboardVideoOptions, prepareStoryboardVideos } from "../storyboard-gate1-actions";
import { coworkVaryCard } from "../cowork-actions";

const OWNER = "owner-1";
const VIDEO_OFF = "Video generation is turned off right now.";
const IMAGE_OFF = "Image generation is turned off right now.";

/** 一张已铸好的 GEN_CARD —— 「Make another / Try again」克隆的就是它。 */
function genCard(kind: "image" | "video") {
  return {
    id: "gen-card-1",
    threadId: "t-1",
    payload: {
      kind,
      model: kind === "video" ? "seedance-2-mini" : "seedream",
      structuredPrompt: kind === "video" ? "a cat walks" : "a cat",
      entityIds: [],
      variantSel: {},
      params: kind === "video" ? { count: 1, durationSeconds: 5, resolution: "720p" } : { count: 1 },
      estimatedCredits: 11,
    },
    genJobId: null,
    thread: { projectId: "p-1", deletedAt: null, ownerId: OWNER },
  };
}

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

/** 让 chatMessage.findFirst 同时服务分镜卡与 GEN_CARD 两种查询。 */
function wireCards(varyKind: "image" | "video" = "video") {
  const sb = storyboardCard();
  const gc = genCard(varyKind);
  mockChatFindFirst.mockImplementation(async (args: { where?: { kind?: string }; orderBy?: unknown }) => {
    if (args?.where?.kind === "STORYBOARD_CARD") return sb;
    if (args?.where?.kind === "GEN_CARD") return gc;
    if (args?.orderBy) return { seq: 3 }; // seq 分配读
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockChatCreate.mockResolvedValue({});
  mockChatUpdate.mockResolvedValue({});
  mockChatCreateMany.mockResolvedValue({ count: 2 });
  mockThreadUpdate.mockResolvedValue({});
  mockActionEventCreate.mockResolvedValue({});
  wireCards();
});

describe("#647 T6 唯一视频引擎被关掉 ⇒ 分镜侧给诚实空态,零卡落库", () => {
  beforeEach(() => {
    mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>([...GEN_VIDEO_MODELS]) });
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
    mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>() });
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

// ---------------------------------------------------------------------------
// 修复轮 P1-1 —— 「Make another / Try again」这条入口曾经绕过整道闸
// ---------------------------------------------------------------------------
//
// 判官 r1 现场:`coworkVaryCard`(apps/web/lib/cowork-actions.ts)只校验旧卡的**结构**
// 就把 payload 原样克隆成一张新 GEN_CARD,从头到尾没读过后台开关。于是引擎全禁用时,
// 商家在结果卡上点一下 "Make another"(OttoResult.tsx)或在计划卡上点 "Try again"
// (OttoPlanCard.tsx),仍然会得到一张写着 11 credits、点下去必被花钱闸打回的卡 ——
// 票面③要消灭的那个病,在这条入口原封不动地复发了一次。
//
// 判据必须与另外三个入口**同一条**:`suggestModel({ kind, disabled })` 说没有引擎,
// 就一张卡都不落库,并给同一句人话。
describe("#647 T6 修复轮 P1-1:Make another / Try again 也走同一道闸", () => {
  it("视频卡:引擎全禁用 ⇒ 同一句人话,且一张卡都没落库", async () => {
    mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>([...GEN_VIDEO_MODELS]) });
    wireCards("video");
    const r = await coworkVaryCard({ cardId: "gen-card-1" });
    expect(r).toEqual({ error: VIDEO_OFF });
    expect(mockChatCreateMany).not.toHaveBeenCalled();
    expect(mockThreadUpdate).not.toHaveBeenCalled();
  });

  it("图片卡:图像引擎被关 ⇒ 图片那句人话,同样零卡落库", async () => {
    mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>(["seedream"]) });
    wireCards("image");
    const r = await coworkVaryCard({ cardId: "gen-card-1" });
    expect(r).toEqual({ error: IMAGE_OFF });
    expect(mockChatCreateMany).not.toHaveBeenCalled();
  });

  it("只关掉视频 ⇒ 图片卡照旧可以「再来一张」(空态不许误伤另一台引擎)", async () => {
    mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>([...GEN_VIDEO_MODELS]) });
    wireCards("image");
    const r = await coworkVaryCard({ cardId: "gen-card-1" });
    expect(r).toEqual({ threadId: "t-1" });
    expect(mockChatCreateMany).toHaveBeenCalledTimes(1);
  });

  it("什么都没关 ⇒ 视频卡照旧可以「再来一张」", async () => {
    mockResolveDisabled.mockResolvedValue({ disabled: new Set<string>() });
    wireCards("video");
    const r = await coworkVaryCard({ cardId: "gen-card-1" });
    expect(r).toEqual({ threadId: "t-1" });
    expect(mockChatCreateMany).toHaveBeenCalledTimes(1);
  });
});
