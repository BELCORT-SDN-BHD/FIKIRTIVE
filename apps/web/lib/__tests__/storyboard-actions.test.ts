import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoryboardCardPayload } from "@fikirtive/otto";

const { mockOwner, mockFindFirst, mockUpdate, mockGenJobFindFirst, mockExecuteRaw } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockGenJobFindFirst: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: (await import("./__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
// #782 r15:editShotPrompt 变成「锁 + 锁内重读 + 在途闸 + 写」的一笔事务(与闸① 五个 RMW
// 同款家法),所以这里的 prisma 替身也要有 $transaction / $executeRaw / genJob。tx 与顶层
// 共用同一组 mock —— 断言仍然只看「读了什么、写了没有」。
vi.mock("@fikirtive/db", () => {
  const client = {
    chatMessage: { findFirst: mockFindFirst, update: mockUpdate },
    genJob: { findFirst: mockGenJobFindFirst },
    $executeRaw: mockExecuteRaw,
  };
  return {
    prisma: { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) },
    Prisma: {},
  };
});
// addShot mints a shotId via newId — stub only newId deterministic (partial mock: the otto
// barrel also imports MAX_GEN_PROMPT etc. from core at load, so keep the real exports).
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => "new-shot-id",
}));

import { editShotPrompt, addShot, deleteShot, reorderShots, setStoryboardContinuity } from "../storyboard-actions";

const OWNER = "owner-1";
function card(payload: StoryboardCardPayload) {
  return { id: "card-1", threadId: "t-1", payload, thread: { ownerId: OWNER, deletedAt: null } };
}
function payload3(): StoryboardCardPayload {
  return {
    storyboardTitle: "Ad",
    shots: [
      { shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", firstFrameGenerationId: "gen0" },
      { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
      { shotId: "s2", index: 2, firstFramePrompt: "ff2", videoPrompt: "v2" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ ownerId: OWNER });
  mockUpdate.mockResolvedValue({});
  mockExecuteRaw.mockResolvedValue(1);
  mockGenJobFindFirst.mockResolvedValue(null); // 默认:子卡背后没有任何作业(从没花过钱)
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

  it("三个可改字段都不传 → error,不碰 DB(G-block:含 durationSeconds)", async () => {
    const res = await editShotPrompt({ cardId: "card-1", index: 0 });
    expect("error" in res).toBe(true);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("只传 durationSeconds → 有效编辑(写入时长,清视频两键,保留帧引用)", async () => {
    const p = payload3();
    // s0 carries a paid frame + a video pointer; a duration change stales only the video.
    (p.shots[0] as Record<string, unknown>).videoGenerationId = "vg0";
    mockFindFirst.mockResolvedValue(card(p));
    const res = await editShotPrompt({ cardId: "card-1", index: 0, durationSeconds: 10 });
    expect("payload" in res).toBe(true);
    if ("payload" in res) {
      expect(res.payload.shots[0].durationSeconds).toBe(10);
      expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen0"); // frame preserved
      expect("videoGenerationId" in res.payload.shots[0]).toBe(false);  // video stale
    }
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("durationSeconds 越界(0 / 61 / 非整)→ error,不碰 DB", async () => {
    for (const d of [0, 61, 5.5]) {
      const res = await editShotPrompt({ cardId: "card-1", index: 0, durationSeconds: d });
      expect("error" in res).toBe(true);
    }
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe("addShot", () => {
  it("追加并回写(ACTION 层铸的 shotId 落到新镜头)", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await addShot({ cardId: "card-1", firstFramePrompt: "ffN", videoPrompt: "vN" });
    expect("payload" in res && res.payload.shots).toHaveLength(4);
    if ("payload" in res) expect(res.payload.shots[3].shotId).toBe("new-shot-id");
  });
  it("到上限(8)拒绝", async () => {
    const full = payload3();
    full.shots = Array.from({ length: 8 }, (_, i) => ({ shotId: `s${i}`, index: i, firstFramePrompt: `ff${i}`, videoPrompt: `v${i}` }));
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

describe("#782 setStoryboardContinuity —— 人工那一面的接续开关($0)", () => {
  it("开 → 回写 continuity:true,镜头一格不动", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await setStoryboardContinuity({ cardId: "card-1", continuity: true });
    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.continuity).toBe(true);
    expect(res.payload.shots).toEqual(payload3().shots);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "card-1" });
  });

  it("关 → 不落键", async () => {
    mockFindFirst.mockResolvedValue(card({ ...payload3(), continuity: true }));
    const res = await setStoryboardContinuity({ cardId: "card-1", continuity: false });
    if (!("payload" in res)) throw new Error("expected payload");
    expect("continuity" in res.payload).toBe(false);
  });

  it("入参不合法 / 卡不在 → 零写入", async () => {
    expect(await setStoryboardContinuity({ cardId: "card-1" })).toEqual({ error: "That change isn't valid." });
    mockFindFirst.mockResolvedValue(null);
    expect(await setStoryboardContinuity({ cardId: "card-1", continuity: true })).toEqual({ error: "Card not found." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("未登录 → 原样回 gate 的错,不读卡不写卡", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    expect(await setStoryboardContinuity({ cardId: "card-1", continuity: true })).toEqual({ error: "unauthorized" });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #782 r15(判官 r14 P1)—— 编辑不许把付过钱的在途作业变成孤儿
// ---------------------------------------------------------------------------
//
// 判官钉出的时序:商家为某一镜的视频付了钱(reserve)→ 作业在跑(慢相解锁了编辑)→ 商家
// 改一句 videoPrompt / 改时长 → 纯变换把 `videoCardId` 删掉 → sync 只沿当前 videoCardId
// 找作业,那条作业 settle 之后的产出对父分镜**永久不可达** → prepare 见「这一镜没产出、
// 也没指针」就铸一张新子卡,新子卡是新的 `cowork:<childId>` 幂等域 → 商家再确认一次 =
// 第二笔账。代码里「编辑与 spend 互斥」的注释在服务端从来没有成真过。
//
// 这一组把那句注释变成服务端事实:在途就拒绝,零写入,指针原样留着。
describe("#782 r15 editShotPrompt —— 在途付费作业面前,编辑必须让路", () => {
  const VIDEO_BUSY = "That video is still being made — wait for it to finish, then edit this shot.";
  const FRAME_BUSY = "That first frame is still being made — wait for it to finish, then edit this shot.";

  /** s0 带一张已付费的首帧 + 一个指向在途视频子卡的指针(判官时序的起点)。 */
  function paidShot(): StoryboardCardPayload {
    return {
      storyboardTitle: "Ad",
      shots: [
        {
          shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", durationSeconds: 5,
          firstFrameCardId: "fc0", firstFrameGenerationId: "gen0",
          videoCardId: "vc0",
        },
        { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
      ],
    };
  }

  /** 按 where 分派 chatMessage.findFirst:父卡 / 子卡(GEN_CARD)/ 投递(GEN_RESULT)。 */
  function routeChatMessage(p: StoryboardCardPayload, opts?: { deliveredGenerationId?: string }) {
    mockFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const w = args.where;
      if (w.kind === "STORYBOARD_CARD") return card(p);
      if (w.kind === "GEN_CARD") return { genJobId: null }; // 走 cowork:<id> 幂等键那条读法
      if (w.kind === "GEN_RESULT") {
        return opts?.deliveredGenerationId
          ? { payload: { generationIds: [opts.deliveredGenerationId] } }
          : null;
      }
      return null;
    });
  }

  it("视频作业 GENERATING(付过钱、还在跑)+ 改 videoPrompt → 拒绝、零写入、指针留着", async () => {
    routeChatMessage(paidShot());
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });

    expect(res).toEqual({ error: VIDEO_BUSY });
    // 零写入 = 那条付费作业的**唯一**指针原样活着:sync 照旧沿它把产出接回来,
    // 而 prepare 照旧沿它走复用分支 —— 第二个幂等域没有被铸造出来的机会。
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("视频作业 QUEUED + 只改 durationSeconds → 同样拒绝(时长变也会删视频两键)", async () => {
    routeChatMessage(paidShot());
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "QUEUED", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({ cardId: "card-1", index: 0, durationSeconds: 10 });

    expect(res).toEqual({ error: VIDEO_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("视频作业 DONE 但产出还没落到 payload(钱已收、产出未消费)→ 拒绝", async () => {
    // 这一格是四种情形里最不该开收费入口的那一种:结算与 generationIds 同一笔事务,
    // 所以「有 generationIds」⟺「钱已经收了」,而 shot.videoGenerationId 还没写。
    routeChatMessage(paidShot());
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "DONE", generationIds: ["g9"], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });

    expect(res).toEqual({ error: VIDEO_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("视频作业 DONE 且产出已经落在 payload 上 → 放行(这是商家看着成品说「换一个」)", async () => {
    const p = paidShot();
    p.shots[0].videoGenerationId = "g9";
    routeChatMessage(p);
    mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status: "DONE", generationIds: ["g9"], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });

    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].videoPrompt).toBe("NEW");
    expect("videoCardId" in res.payload.shots[0]).toBe(false);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("视频作业 FAILED / CANCELLED(预扣已退、什么都没交付)→ 放行,单镜救援那条路一格没少", async () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      vi.clearAllMocks();
      mockOwner.mockResolvedValue({ ownerId: OWNER });
      mockUpdate.mockResolvedValue({});
      mockExecuteRaw.mockResolvedValue(1);
      routeChatMessage(paidShot());
      mockGenJobFindFirst.mockResolvedValue({ id: "job-1", status, generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

      const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });
      expect("payload" in res).toBe(true);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    }
  });

  it("子卡背后根本没有作业(准备过、从没确认)→ 放行:$0 的东西不是钱", async () => {
    routeChatMessage(paidShot());
    mockGenJobFindFirst.mockResolvedValue(null);

    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });

    expect("payload" in res).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("首帧作业在途 + 改 firstFramePrompt(会删帧两键)→ 拒绝(与视频同一条判定,同一个洞)", async () => {
    routeChatMessage(paidShot());
    // 父卡上 s0 没有 videoCardId 时,唯一会被删的付费指针就是帧两键。
    const p = paidShot();
    delete p.shots[0].videoCardId;
    routeChatMessage(p);
    mockGenJobFindFirst.mockResolvedValue({ id: "job-f", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({ cardId: "card-1", index: 0, firstFramePrompt: "NEW" });

    expect(res).toEqual({ error: FRAME_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("首帧作业在途、但这次只改 videoPrompt(帧两键不会被删)→ 放行,不拿别人的在途挡路", async () => {
    const p = paidShot();
    delete p.shots[0].videoCardId; // 只剩帧指针
    routeChatMessage(p);
    mockGenJobFindFirst.mockResolvedValue({ id: "job-f", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });

    if (!("payload" in res)) throw new Error("expected payload");
    expect(res.payload.shots[0].firstFrameCardId).toBe("fc0"); // 帧两键完好
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen0");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("判定与写在同一笔事务里,而且先取卡锁 —— 不是 check-then-act", async () => {
    routeChatMessage(paidShot());
    mockGenJobFindFirst.mockResolvedValue(null);

    await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });

    // 卡级 advisory lock(与闸① 五个 RMW 同一把):同一张父卡的写者严格串行,
    // prepare / regen / sync 不可能挤在「读作业」与「删指针」之间。
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    // 锁内重读父卡(不吃锁前快照)。
    const storyboardReads = mockFindFirst.mock.calls.filter(
      (c) => (c[0] as { where: Record<string, unknown> }).where.kind === "STORYBOARD_CARD",
    );
    expect(storyboardReads.length).toBe(2); // 锁前一次(存在性)+ 锁内一次(权威)
  });

  it("锁内重读发现卡没了 → 零写入 + Card not found.", async () => {
    let seen = 0;
    mockFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.kind === "STORYBOARD_CARD") { seen += 1; return seen === 1 ? card(paidShot()) : null; }
      return null;
    });

    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });

    expect(res).toEqual({ error: "Card not found." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #782 r17(判官 r16 P1-1)—— 「传了这个字段」不等于「商家改了这句话」
// ---------------------------------------------------------------------------
//
// 真实 UI 的形状(StoryboardCard.saveEdit):startEdit 把**当前**首帧文字装进 draftFf,保存时
// 两句 prompt **无条件同发**。所以商家只改视频文字,服务端收到的 firstFramePrompt 也在 ——
// 而 r15 的闸与陈旧级联都用「字段出现」当「帧文字改了」。后果分两级:
//   • 帧作业在途 → 闸误拦一次与它无关的编辑(烦,但安全);
//   • 帧**已付费已消费** → 级联把 firstFrameCardId / firstFrameGenerationId 删掉,那张付过钱
//     的首帧对这一镜不可达,prepare 随后铸新子卡 = 新的 cowork: 幂等域 = **可以再收一次钱**。
//
// 修法:服务端自己比。客户端爱发什么发什么,「改没改」只以父卡当前值为准。
describe("#782 r17 editShotPrompt —— 帧判定以「真的不同」为准,不以「字段在不在」为准", () => {
  const VIDEO_BUSY = "That video is still being made — wait for it to finish, then edit this shot.";
  const FRAME_BUSY = "That first frame is still being made — wait for it to finish, then edit this shot.";

  /** s0:一张**已付费已消费**的首帧 + 一句视频文字。判官时序的起点。 */
  function paidFrame(): StoryboardCardPayload {
    return {
      storyboardTitle: "Ad",
      shots: [
        {
          shotId: "s0", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0", durationSeconds: 5,
          firstFrameCardId: "fc0", firstFrameGenerationId: "gen0",
        },
        { shotId: "s1", index: 1, firstFramePrompt: "ff1", videoPrompt: "v1" },
      ],
    };
  }

  function routeChatMessage(p: StoryboardCardPayload) {
    mockFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const w = args.where;
      if (w.kind === "STORYBOARD_CARD") return card(p);
      if (w.kind === "GEN_CARD") return { genJobId: null };
      return null;
    });
  }

  /** 按 `cowork:<childCardId>` 分派作业行 —— 帧与视频各自的状态必须能分开摆。 */
  function routeJobs(byChildCardId: Record<string, { status: string; generationIds: string[] } | null>) {
    mockGenJobFindFirst.mockImplementation(async (args: { where: { idempotencyKey?: string } }) => {
      const childId = (args.where.idempotencyKey ?? "").replace(/^cowork:/, "");
      const j = byChildCardId[childId];
      return j ? { id: `job-${childId}`, lastFrameAssetId: null, projectId: "p1", threadId: "t-1", ...j } : null;
    });
  }

  it("真实 UI 形状(两句同发、帧文字原样)→ 已付费已消费的首帧必须留在这一镜上", async () => {
    // 这是**钱**的那一条:帧的钱已经花了、产出已经落在 payload 上。商家只改了视频文字,
    // 却把那张图的两个键一起删掉 = 它对这一镜永久不可达,prepare 会当作「这一镜没有首帧」
    // 重新铸一张可扣费的子卡。
    routeChatMessage(paidFrame());
    mockGenJobFindFirst.mockResolvedValue(null);

    const res = await editShotPrompt({
      cardId: "card-1", index: 0,
      firstFramePrompt: "ff0",      // 原样回发 —— UI 就是这么发的
      videoPrompt: "v0 (new)",      // 真正改的只有这一句
    });

    if (!("payload" in res)) throw new Error(`expected payload, got ${JSON.stringify(res)}`);
    expect(res.payload.shots[0].firstFrameCardId).toBe("fc0");
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen0");
    // 视频那一格照旧作废(视频文字真的变了)。
    expect(res.payload.shots[0].videoPrompt).toBe("v0 (new)");
  });

  it("真实 UI 形状 + 帧作业在途 → 不许误拦(这次编辑根本不碰帧两键)", async () => {
    routeChatMessage(paidFrame());
    mockGenJobFindFirst.mockResolvedValue({ id: "jf", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({
      cardId: "card-1", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0 (new)",
    });

    if (!("payload" in res)) throw new Error(`expected payload, got ${JSON.stringify(res)}`);
    expect(res.payload.shots[0].firstFrameCardId).toBe("fc0");
  });

  it("帧文字**真的**改了 + 帧作业在途 → 照旧拒绝(r15 的闸一格没松)", async () => {
    routeChatMessage(paidFrame());
    mockGenJobFindFirst.mockResolvedValue({ id: "jf", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({
      cardId: "card-1", index: 0, firstFramePrompt: "ff0 (new)", videoPrompt: "v0",
    });

    expect(res).toEqual({ error: FRAME_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("帧文字真的改了 → 帧两键与视频两键照旧一起作废(G 闸② 级联未变)", async () => {
    const p = paidFrame();
    p.shots[0].videoCardId = "vc0";
    p.shots[0].videoGenerationId = "vg0";
    routeChatMessage(p);
    // 两条作业都已交付且产出都已落在 payload 上 → 都不在途,闸放行,只看级联。
    routeJobs({ fc0: { status: "DONE", generationIds: ["gen0"] }, vc0: { status: "DONE", generationIds: ["vg0"] } });

    const res = await editShotPrompt({
      cardId: "card-1", index: 0, firstFramePrompt: "ff0 (new)", videoPrompt: "v0",
    });

    if (!("payload" in res)) throw new Error(`expected payload, got ${JSON.stringify(res)}`);
    expect("firstFrameCardId" in res.payload.shots[0]).toBe(false);
    expect("firstFrameGenerationId" in res.payload.shots[0]).toBe(false);
    expect("videoCardId" in res.payload.shots[0]).toBe(false);
    expect("videoGenerationId" in res.payload.shots[0]).toBe(false);
  });

  it("两句都原样回发(商家开了编辑又原样保存)→ 什么都不作废,什么都不拦", async () => {
    const p = paidFrame();
    p.shots[0].videoCardId = "vc0";
    p.shots[0].videoGenerationId = "vg0";
    routeChatMessage(p);
    // 帧与视频两条作业都在途:真的会删的键一个都没有,所以一格都不该拦。
    mockGenJobFindFirst.mockResolvedValue({ id: "j", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({
      cardId: "card-1", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0",
    });

    if (!("payload" in res)) throw new Error(`expected payload, got ${JSON.stringify(res)}`);
    expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen0");
    expect(res.payload.shots[0].videoCardId).toBe("vc0");
    expect(res.payload.shots[0].videoGenerationId).toBe("vg0");
  });

  it("时长真的改了 → 只作废视频那一格;时长原样回发 → 一格不动", async () => {
    const p = paidFrame();
    p.shots[0].videoCardId = "vc0";
    p.shots[0].videoGenerationId = "vg0";
    routeChatMessage(p);
    mockGenJobFindFirst.mockResolvedValue(null);

    const changed = await editShotPrompt({ cardId: "card-1", index: 0, durationSeconds: 10 });
    if (!("payload" in changed)) throw new Error("expected payload");
    expect("videoCardId" in changed.payload.shots[0]).toBe(false);
    expect(changed.payload.shots[0].firstFrameGenerationId).toBe("gen0");

    routeChatMessage(p);
    const same = await editShotPrompt({ cardId: "card-1", index: 0, durationSeconds: 5 });
    if (!("payload" in same)) throw new Error("expected payload");
    expect(same.payload.shots[0].videoCardId).toBe("vc0");
    expect(same.payload.shots[0].videoGenerationId).toBe("vg0");
  });

  it("视频作业在途 + 视频文字真的改了 → 照旧拒绝(r15 的闸一格没松)", async () => {
    const p = paidFrame();
    p.shots[0].videoCardId = "vc0";
    routeChatMessage(p);
    mockGenJobFindFirst.mockResolvedValue({ id: "jv", status: "GENERATING", generationIds: [], lastFrameAssetId: null, projectId: "p1", threadId: "t-1" });

    const res = await editShotPrompt({
      cardId: "card-1", index: 0, firstFramePrompt: "ff0", videoPrompt: "v0 (new)",
    });

    expect(res).toEqual({ error: VIDEO_BUSY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
