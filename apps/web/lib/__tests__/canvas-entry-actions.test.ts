import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
  projectFindFirst: vi.fn(),
  projectCreate: vi.fn(),
  projectUpdate: vi.fn(),
  entityFindMany: vi.fn(),
  generationFindMany: vi.fn(),
  threadFindFirst: vi.fn(),
  threadCreate: vi.fn(),
  eventFindFirst: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mocks.requireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst, create: mocks.projectCreate, update: mocks.projectUpdate },
    chatThread: { findFirst: mocks.threadFindFirst, create: mocks.threadCreate },
    actionEvent: { findFirst: mocks.eventFindFirst, create: mocks.eventCreate },
    entity: { findMany: mocks.entityFindMany },
    generation: { findMany: mocks.generationFindMany },
    $transaction: mocks.transaction,
  },
}));

const { createCanvasConversation, ensureCanvasDraft, getCanvasConversationHandoff } = await import("@/lib/canvas-entry-actions");

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_ID = `canvas_${REQUEST_ID}`;
const THREAD_ID = `thread_${REQUEST_ID}`;
const HANDOFF_ID = `handoff_${REQUEST_ID}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ ownerId: "owner-1", email: "owner@example.test" });
  mocks.projectFindFirst.mockResolvedValue(null);
  mocks.threadFindFirst.mockResolvedValue(null);
  mocks.eventFindFirst.mockResolvedValue(null);
  mocks.projectCreate.mockResolvedValue({ id: PROJECT_ID });
  mocks.projectUpdate.mockResolvedValue({ id: PROJECT_ID });
  mocks.entityFindMany.mockResolvedValue([]);
  mocks.generationFindMany.mockResolvedValue([]);
  mocks.threadCreate.mockResolvedValue({ id: THREAD_ID });
  mocks.eventCreate.mockResolvedValue({ id: HANDOFF_ID });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    project: { findFirst: mocks.projectFindFirst, create: mocks.projectCreate, update: mocks.projectUpdate },
    chatThread: { findFirst: mocks.threadFindFirst, create: mocks.threadCreate },
    actionEvent: { findFirst: mocks.eventFindFirst, create: mocks.eventCreate },
  }));
});

describe("createCanvasConversation", () => {
  it("atomically creates one Canvas, one empty Conversation and one durable handoff", async () => {
    const result = await createCanvasConversation({
      prompt: "  Make four Raya product photos  ",
      requestId: REQUEST_ID,
    });

    expect(result).toEqual({ projectId: PROJECT_ID, threadId: THREAD_ID, handoffId: HANDOFF_ID });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.projectCreate).toHaveBeenCalledWith({
      data: { id: PROJECT_ID, ownerId: "owner-1", name: "Make four Raya product photos" },
      select: { id: true },
    });
    expect(mocks.threadCreate).toHaveBeenCalledWith({
      // FRONT-A14:画布入口开的对话登记成 `canvas` —— 侧栏面板只自动续它自己开的那一批,
      // 不写这一格,这条对话会在商家的每一页上被当成「你刚才在聊的那条」摊开(P1-010)。
      data: { id: THREAD_ID, ownerId: "owner-1", projectId: PROJECT_ID, title: "Make four Raya product photos", surface: "canvas" },
      select: { id: true },
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: {
        id: HANDOFF_ID,
        ownerId: "owner-1",
        projectId: PROJECT_ID,
        type: "canvas.create-handoff",
        payload: { prompt: "Make four Raya product photos", threadId: THREAD_ID },
      },
    });
  });

  it("returns the same owned handoff on a retry instead of creating a second Canvas", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      id: HANDOFF_ID,
      projectId: PROJECT_ID,
      payload: { prompt: "Make four Raya product photos", threadId: THREAD_ID },
    });
    mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID });
    mocks.threadFindFirst.mockResolvedValue({ id: THREAD_ID });

    await expect(createCanvasConversation({
      prompt: "Make four Raya product photos",
      requestId: REQUEST_ID,
    })).resolves.toEqual({ projectId: PROJECT_ID, threadId: THREAD_ID, handoffId: HANDOFF_ID });

    expect(mocks.projectCreate).not.toHaveBeenCalled();
    expect(mocks.threadCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("refuses blank prompts and malformed request identities before writing", async () => {
    await expect(createCanvasConversation({ prompt: "   ", requestId: REQUEST_ID })).resolves.toEqual({
      error: "Describe what you want to create.",
    });
    await expect(createCanvasConversation({ prompt: "A poster", requestId: "not-a-uuid" })).resolves.toEqual({
      error: "Couldn't start that Canvas — please try again.",
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("getCanvasConversationHandoff", () => {
  it("returns a prompt only when the handoff, Canvas and Conversation all belong together", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      id: HANDOFF_ID,
      projectId: PROJECT_ID,
      payload: { prompt: "Make four Raya product photos", threadId: THREAD_ID },
    });

    await expect(getCanvasConversationHandoff({
      ownerId: "owner-1",
      handoffId: HANDOFF_ID,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
    })).resolves.toEqual({
      prompt: "Make four Raya product photos",
      entityIds: [],
      sourceGenerationIds: [],
      referenceVideoGenerationIds: [],
    });

    expect(mocks.eventFindFirst).toHaveBeenCalledWith({
      where: {
        id: HANDOFF_ID,
        ownerId: "owner-1",
        projectId: PROJECT_ID,
        type: "canvas.create-handoff",
      },
      select: { payload: true },
    });
  });

  it("fails closed when the durable payload points at another Conversation", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      payload: { prompt: "A poster", threadId: "thread-other" },
    });

    await expect(getCanvasConversationHandoff({
      ownerId: "owner-1",
      handoffId: HANDOFF_ID,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
    })).resolves.toBeNull();
  });
});

/**
 * FRONT-A14 —— 起步页参考契约的**服务端**那一半(规格 `docs/specs/frontend-baseline.md` §7.3⑨)。
 *
 * 这一节钉的是「商家在 Create 上挂的参考,真的以类型化 ID 落进 handoff 行,而且读回来的时候
 * 归属重查过」。三件事各自能单独变红:
 *   ① 写入形状 —— payload 里是 `{type, id}`,不是裸字符串、不是图片 URL;
 *   ② 读回解形 —— 实体进 `entityIds`,图片进 `sourceGenerationIds`,影片进
 *      `referenceVideoGenerationIds`(媒体形态按 `lib/library-types.ts` 那一条规则判);
 *   ③ 归属 —— 客户端自报的 id 只是定位参数,不是这个租户的就当不存在(少挂一件,好过替
 *      商家把别人的东西塞进他自己那一轮)。
 */
describe("createCanvasConversation:起步页挂的参考", () => {
  it("FRONT-A14:选中的引用以类型化 ID 落进 handoff payload,不是裸字符串", async () => {
    await createCanvasConversation({
      prompt: "Put her in the new hoodie",
      requestId: REQUEST_ID,
      references: [
        { type: "generation", id: "gen-1" },
        { type: "product", id: "ent-1" },
      ],
    });

    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: {
        id: HANDOFF_ID,
        ownerId: "owner-1",
        projectId: PROJECT_ID,
        type: "canvas.create-handoff",
        payload: {
          prompt: "Put her in the new hoodie",
          threadId: THREAD_ID,
          references: [
            { type: "generation", id: "gen-1" },
            { type: "product", id: "ent-1" },
          ],
        },
      },
    });
  });

  it("FRONT-A14:形状不对的引用列表整笔拒绝,不写半条 handoff", async () => {
    // 裸字符串、没有 type、type 不在契约表里 —— 三种都不许悄悄丢掉再照常开画布。
    for (const references of [["gen-1"], [{ id: "gen-1" }], [{ type: "url", id: "gen-1" }]]) {
      await expect(createCanvasConversation({
        prompt: "A poster",
        requestId: REQUEST_ID,
        references,
      })).resolves.toEqual({ error: "Couldn't start that Canvas — please try again." });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  /**
   * 判官 #1242 P1-2:上限从前是**合计** 8。商家挂 3 张图(媒体侧封顶 8,没超)再 `@` 6 件实体
   * (画布首轮那一侧按 `MAX_GEN_ENTITIES` = 8 卡,也没超),合计 9 —— 起步页整笔被拒,屏幕上只有
   * 一句通用的「请再试一次」,而再试永远不会成功。那是这一页新造的一条口径。现在两本分开数,
   * 与画布同一个口径。
   */
  it("FRONT-A14:媒体与实体各数各的上限 —— 3 图 + 6 实体(合计 9)照常开画布", async () => {
    const references = [
      ...Array.from({ length: 3 }, (_, i) => ({ type: "generation", id: `gen-${i}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ type: "product", id: `ent-${i}` })),
    ];

    await expect(createCanvasConversation({
      prompt: "Put her in the new hoodie",
      requestId: REQUEST_ID,
      references,
    })).resolves.toEqual({ projectId: PROJECT_ID, threadId: THREAD_ID, handoffId: HANDOFF_ID });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.eventCreate.mock.calls[0]![0].data.payload.references).toEqual(references);
  });

  it("FRONT-A14:任何一本自己超了才拒 —— 9 件媒体拒,9 件实体也拒", async () => {
    for (const references of [
      Array.from({ length: 9 }, (_, i) => ({ type: "generation", id: `gen-${i}` })),
      Array.from({ length: 9 }, (_, i) => ({ type: "product", id: `ent-${i}` })),
    ]) {
      await expect(createCanvasConversation({
        prompt: "A poster",
        requestId: REQUEST_ID,
        references,
      })).resolves.toEqual({ error: "Couldn't start that Canvas — please try again." });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("FRONT-A14:草稿画布(先挂参考后送出)被收编成同一块,不开第二块", async () => {
    // `ensureCanvasDraft` 已经用同一个 requestId 开过这块画布 —— 这时只改名字。
    mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID });

    await expect(createCanvasConversation({
      prompt: "Make four Raya product photos",
      requestId: REQUEST_ID,
    })).resolves.toEqual({ projectId: PROJECT_ID, threadId: THREAD_ID, handoffId: HANDOFF_ID });

    expect(mocks.projectCreate).not.toHaveBeenCalled();
    expect(mocks.projectUpdate).toHaveBeenCalledWith({
      where: { id_ownerId: { id: PROJECT_ID, ownerId: "owner-1" } },
      data: { name: "Make four Raya product photos" },
      select: { id: true },
    });
  });
});

describe("ensureCanvasDraft", () => {
  it("FRONT-A14:起步页上传前先开画布,同一个 requestId 只开一块", async () => {
    await expect(ensureCanvasDraft({ requestId: REQUEST_ID })).resolves.toEqual({ projectId: PROJECT_ID });
    expect(mocks.projectCreate).toHaveBeenCalledWith({
      data: { id: PROJECT_ID, ownerId: "owner-1", name: "New canvas" },
      select: { id: true },
    });

    // 第二次点 Upload image:画布已经在了,不再建。
    mocks.projectCreate.mockClear();
    mocks.projectFindFirst.mockResolvedValue({ id: PROJECT_ID });
    await expect(ensureCanvasDraft({ requestId: REQUEST_ID })).resolves.toEqual({ projectId: PROJECT_ID });
    expect(mocks.projectCreate).not.toHaveBeenCalled();
  });

  it("FRONT-A14:requestId 形状不对就不碰数据库", async () => {
    await expect(ensureCanvasDraft({ requestId: "not-a-uuid" })).resolves.toEqual({
      error: "Couldn't start that Canvas — please try again.",
    });
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
    expect(mocks.projectCreate).not.toHaveBeenCalled();
  });
});

describe("getCanvasConversationHandoff:引用解形与归属", () => {
  beforeEach(() => {
    mocks.eventFindFirst.mockResolvedValue({
      id: HANDOFF_ID,
      projectId: PROJECT_ID,
      payload: {
        prompt: "Put her in the new hoodie",
        threadId: THREAD_ID,
        references: [
          { type: "generation", id: "gen-img" },
          { type: "generation", id: "gen-vid" },
          { type: "product", id: "ent-1" },
        ],
      },
    });
  });

  it("FRONT-A14:实体进 entityIds,图片与影片各进各的那一份", async () => {
    mocks.entityFindMany.mockResolvedValue([{ id: "ent-1" }]);
    mocks.generationFindMany.mockResolvedValue([
      { id: "gen-img", asset: { ext: "PNG" } },
      { id: "gen-vid", asset: { ext: "mp4" } },
    ]);

    await expect(getCanvasConversationHandoff({
      ownerId: "owner-1",
      handoffId: HANDOFF_ID,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
    })).resolves.toEqual({
      prompt: "Put her in the new hoodie",
      entityIds: ["ent-1"],
      sourceGenerationIds: ["gen-img"],
      referenceVideoGenerationIds: ["gen-vid"],
    });
  });

  it("FRONT-A14:不是这个租户的 id 一件都不挂 —— 归属按 ownerId 重查,不信 payload", async () => {
    // 库里一件都查不到(别人的、或者已经删了)。
    mocks.entityFindMany.mockResolvedValue([]);
    mocks.generationFindMany.mockResolvedValue([]);

    await expect(getCanvasConversationHandoff({
      ownerId: "owner-1",
      handoffId: HANDOFF_ID,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
    })).resolves.toEqual({
      prompt: "Put her in the new hoodie",
      entityIds: [],
      sourceGenerationIds: [],
      referenceVideoGenerationIds: [],
    });
    expect(mocks.entityFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["ent-1"] }, ownerId: "owner-1", deletedAt: null },
      select: { id: true },
    });
    expect(mocks.generationFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["gen-img", "gen-vid"] }, ownerId: "owner-1", deletedAt: null },
      select: { id: true, asset: { select: { ext: true } } },
    });
  });
});
