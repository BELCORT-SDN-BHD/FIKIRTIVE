/**
 * creation §5 :178 —— 人工那一面的「挂 Library 图」($0)。
 *
 * 这里跑的是**真的** `resolveOwnedReferenceRefs`(只把 prisma 换成替身),因为这一条要证的
 * 正是它那一格:商家 @ 选的 typed refs 怎么变成规范身份(`Generation.id`),以及**别家店的
 * id 在这里变不成任何东西**。把解析器一起 mock 掉,跨租户那条就只剩一句自说自话。
 *
 * 钱路那一半(挂图进报价材料、跨租户在铸卡层再拒一次)在
 * `storyboard-gate1-actions.test.ts` 的 `creation §5 :178` 那一组。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoryboardCardPayload } from "@fikirtive/otto";

const { mockOwner, mockFindFirst, mockUpdate, mockGenJobFindFirst, mockExecuteRaw, mockGenerationFindMany, mockEntityFindMany } =
  vi.hoisted(() => ({
    mockOwner: vi.fn(),
    mockFindFirst: vi.fn(),
    mockUpdate: vi.fn(),
    mockGenJobFindFirst: vi.fn(),
    mockExecuteRaw: vi.fn(),
    mockGenerationFindMany: vi.fn(),
    mockEntityFindMany: vi.fn(),
  }));

vi.mock("../auth-guard", async () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@fikirtive/db", () => {
  const client = {
    chatMessage: { findFirst: mockFindFirst, update: mockUpdate },
    genJob: { findFirst: mockGenJobFindFirst },
    generation: { findMany: mockGenerationFindMany },
    entity: { findMany: mockEntityFindMany },
    $executeRaw: mockExecuteRaw,
  };
  return { prisma: { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) }, Prisma: {} };
});

import { setShotReferences } from "../storyboard-actions";

const OWNER = "owner-1";

function card(payload: StoryboardCardPayload) {
  return { id: "card-1", threadId: "t-1", payload, thread: { ownerId: OWNER, deletedAt: null } };
}

function payload2(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", entityIds: ["actor-1"] },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
    ],
  };
}

/**
 * 真库那一趟 `generation.findMany` 的行为,如实复刻:
 *   · where 带 `ownerId` ⇒ 别家店的行读不出来(**跨租户的全部机制就是这一格**);
 *   · `generation:` 认 `Generation.id`(且 source ≠ UPLOAD);
 *   · `upload:` 认 `Asset.id`(且 source = UPLOAD),回的是**摄取它的那一行 Generation**。
 */
type Row = { id: string; assetId: string; source: string; ownerId: string; ext: string };
const ROWS: Row[] = [
  { id: "gen-mine", assetId: "asset-mine", source: "GENERATION", ownerId: OWNER, ext: "png" },
  { id: "gen-upload", assetId: "asset-upload", source: "UPLOAD", ownerId: OWNER, ext: "jpg" },
  { id: "gen-clip", assetId: "asset-clip", source: "GENERATION", ownerId: OWNER, ext: "mp4" },
  { id: "gen-audio", assetId: "asset-audio", source: "UPLOAD", ownerId: OWNER, ext: "mp3" },
  { id: "gen-theirs", assetId: "asset-theirs", source: "GENERATION", ownerId: "owner-2", ext: "png" },
];

function wireGenerationReads() {
  mockGenerationFindMany.mockImplementation(
    async (args: { where: { ownerId: string; OR?: { id?: { in: string[] }; assetId?: { in: string[] } }[] } }) => {
      const wantedGenIds = new Set(args.where.OR?.flatMap((o) => o.id?.in ?? []) ?? []);
      const wantedAssetIds = new Set(args.where.OR?.flatMap((o) => o.assetId?.in ?? []) ?? []);
      return ROWS.filter(
        (r) =>
          r.ownerId === args.where.ownerId &&
          ((r.source !== "UPLOAD" && wantedGenIds.has(r.id)) ||
            (r.source === "UPLOAD" && wantedAssetIds.has(r.assetId))),
      ).map((r) => ({
        id: r.id,
        assetId: r.assetId,
        source: r.source,
        promptText: `prompt ${r.id}`,
        projectId: "p-src",
        project: { name: "Canvas A" },
        asset: { originalFilename: `${r.id}.${r.ext}`, ext: r.ext },
      }));
    },
  );
}

function savedShots(): StoryboardCardPayload["shots"] {
  return (mockUpdate.mock.calls[0]![0].data.payload as StoryboardCardPayload).shots;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockUpdate.mockResolvedValue({});
  mockExecuteRaw.mockResolvedValue(1);
  mockGenJobFindFirst.mockResolvedValue(null); // 子卡背后没有任何作业(没花过钱)
  mockEntityFindMany.mockResolvedValue([]);
  wireGenerationReads();
  mockFindFirst.mockImplementation(async (args: { where?: { kind?: string } }) =>
    args?.where?.kind === "STORYBOARD_CARD" ? card(payload2()) : null,
  );
});

describe("creation §5 :178 —— 人工面:给一镜挂 Library 图", () => {
  it("creation §5 :178 / CREATE-A2: @ 选的图落成规范身份(上传件落的是摄取它的那一行 Generation)", async () => {
    const res = await setShotReferences({
      cardId: "card-1",
      index: 0,
      refs: ["generation:gen-mine", "upload:asset-upload"],
    });

    expect("payload" in res).toBe(true);
    // `upload:` 的 wire 带的是 Asset id,落进 payload 的却是 `gen-upload` —— 客户端猜不出这一步。
    expect(savedShots()[0]!.referenceGenerationIds).toEqual(["gen-mine", "gen-upload"]);
    expect(savedShots()[1]!.referenceGenerationIds).toBeUndefined();
  });

  it("creation §5 :178 / CREATE-A10: 别家店的那张图 ⇒ 整次拒绝、零写入(双租户)", async () => {
    const res = await setShotReferences({ cardId: "card-1", index: 0, refs: ["generation:gen-theirs"] });

    expect(res).toEqual({
      error: "One of those isn't one of your images any more — pick another. Nothing was changed.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    // 那一趟读带的是本店的 ownerId —— 跨租户的全部机制就在这一格上。
    expect(mockGenerationFindMany.mock.calls[0]![0].where.ownerId).toBe(OWNER);
  });

  it("creation §5 :178 / CREATE-A10: 同一个 id 在它自己那家店读得出来 —— 拒的是归属,不是这张图", async () => {
    mockOwner.mockResolvedValue({ ownerId: "owner-2" });
    mockFindFirst.mockImplementation(async (args: { where?: { kind?: string } }) =>
      args?.where?.kind === "STORYBOARD_CARD"
        ? { id: "card-1", threadId: "t-1", payload: payload2(), thread: { ownerId: "owner-2", deletedAt: null } }
        : null,
    );

    const res = await setShotReferences({ cardId: "card-1", index: 0, refs: ["generation:gen-theirs"] });

    expect("payload" in res).toBe(true);
    expect(savedShots()[0]!.referenceGenerationIds).toEqual(["gen-theirs"]);
  });

  it("creation §5 :178 / CREATE-A2: 挂一支片子当参考照 ⇒ 拒绝并说清该挑什么,零写入", async () => {
    const res = await setShotReferences({ cardId: "card-1", index: 0, refs: ["generation:gen-clip"] });

    expect(res).toEqual({
      error: "A clip can't be a reference photo for a shot — pick an image instead. Nothing was changed.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("creation §5 :178 / CREATE-A2: 当不了参考的格式(上传的音频)⇒ 拒绝的是格式,不是「这文件没了」", async () => {
    const res = await setShotReferences({ cardId: "card-1", index: 0, refs: ["upload:asset-audio"] });

    expect(res).toEqual({
      error: "One of those files can't be used as a reference — pick an image instead. Nothing was changed.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("creation §5 :178: 空清单 = 把这一镜挂的图全部取下", async () => {
    const p = payload2();
    p.shots[0]!.referenceGenerationIds = ["gen-mine"];
    mockFindFirst.mockImplementation(async (args: { where?: { kind?: string } }) =>
      args?.where?.kind === "STORYBOARD_CARD" ? card(p) : null,
    );

    const res = await setShotReferences({ cardId: "card-1", index: 0, refs: [] });

    expect("payload" in res).toBe(true);
    expect("referenceGenerationIds" in savedShots()[0]!).toBe(false);
    // 一次都不该去查库:没有 ref 要解析。
    expect(mockGenerationFindMany).not.toHaveBeenCalled();
  });

  it("creation §5 :178 / CREATE-A2: 这一镜的片子还在跑 ⇒ 编辑被在途闸拦住,零写入", async () => {
    const p = payload2();
    p.shots[0]!.videoCardId = "vc0";
    mockFindFirst.mockImplementation(async (args: { where?: { kind?: string } }) =>
      args?.where?.kind === "STORYBOARD_CARD" ? card(p) : null,
    );
    mockGenJobFindFirst.mockResolvedValue({
      id: "job-1",
      status: "GENERATING",
      generationIds: [],
      lastFrameAssetId: null,
      projectId: "p1",
      threadId: "t-1",
    });

    const res = await setShotReferences({ cardId: "card-1", index: 0, refs: ["generation:gen-mine"] });

    expect(res).toEqual({ error: "That video is still being made — wait for it to finish, then edit this shot." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("creation §5 :178: 镜头序号越界 ⇒ 零写入", async () => {
    const res = await setShotReferences({ cardId: "card-1", index: 9, refs: ["generation:gen-mine"] });
    expect(res).toEqual({ error: "That shot no longer exists." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
