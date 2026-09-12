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

import { editShotPrompt, addShot, deleteShot, reorderShots } from "../storyboard-actions";

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
  // PR #1417 判官 P2-1 —— `editInput` 的 `firstFramePrompt` 字段随活写路径整段报废删除
  // (见 storyboard-actions.ts 该处报废注释),这三条原本借它触发编辑的测试改用 `videoPrompt`
  // 触发同一条编辑路径 —— 断言的是 owner-scoped 载入 / 鉴权早退 / 卡不存在三件事,与「改的是
  // 哪一格文字」无关,换成仍然合法的字段后照旧成立;改之前这三条其实已经悄悄测不到自己
  // 声称的场景了(见下面两条的说明)。
  it("owner-scoped 载入 + 回写只改 payload(改视频文字,帧引用原样保留)", async () => {
    mockFindFirst.mockResolvedValue(card(payload3()));
    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });
    // 载入必须按 id + ownerId + kind owner-scoped
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "card-1", ownerId: OWNER, kind: "STORYBOARD_CARD", deletedAt: null }) }),
    );
    expect("payload" in res).toBe(true);
    if ("payload" in res) {
      expect(res.payload.shots[0].videoPrompt).toBe("NEW");
      expect(res.payload.shots[0].firstFrameGenerationId).toBe("gen0"); // 没碰 firstFramePrompt,帧引用不该被清
    }
    // 回写到同一 cardId,且不碰 genJob
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "card-1" } }));
    const data = mockUpdate.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(["payload"]); // 只改 payload,绝不动 genJobId
  });

  it("requireOwner 失败 → 直接返回 error,不碰 DB", async () => {
    mockOwner.mockResolvedValue({ error: "unauthorized" });
    // 改前这句用 firstFramePrompt 触发:该字段已被 editInput 静默剥离(zod 未知键),
    // parsed.data 里两个可改字段都是 undefined,函数在走到 requireOwner 之前就已经因
    // 「入参不合法」提前退出 —— 断言恰好也是 error,曾经悄悄测不出鉴权早退这件事本身。
    // 换 videoPrompt 让它真正跑到 requireOwner 那一步再被拦下。
    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });
    expect(res).toEqual({ error: "unauthorized" });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("卡片不存在(或非本人)→ error,不回写", async () => {
    mockFindFirst.mockResolvedValue(null);
    // 同上:换 videoPrompt 让它真正跑到 loadCard 返回「Card not found.」,而不是在
    // 校验那一步就先因为「两个可改字段都没传」被拒。
    const res = await editShotPrompt({ cardId: "card-1", index: 0, videoPrompt: "NEW" });
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
    // PR #1417 判官 P2-1 —— addInput 的 firstFramePrompt 已随活写路径整段报废删除,
    // 这里不再往入参里塞它(塞了也只会被 zod 静默剥离,白塞)。
    const res = await addShot({ cardId: "card-1", videoPrompt: "vN" });
    expect("payload" in res && res.payload.shots).toHaveLength(4);
    if ("payload" in res) expect(res.payload.shots[3].shotId).toBe("new-shot-id");
  });
  it("到上限(8)拒绝", async () => {
    const full = payload3();
    full.shots = Array.from({ length: 8 }, (_, i) => ({ shotId: `s${i}`, index: i, firstFramePrompt: `ff${i}`, videoPrompt: `v${i}` }));
    mockFindFirst.mockResolvedValue(card(full));
    const res = await addShot({ cardId: "card-1", videoPrompt: "y" });
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

// PR #1417 判官 P1-C —— "#782 setStoryboardContinuity" 整个 describe(4 test)随
// `setStoryboardContinuity` 本体一起报废删除:接续/continuity 免费传帧的唯一消费方(闸③)
// 已经是数学上不可达代码,随之整段删除(见 `storyboard-gate1-actions.ts` 该处报废注释),
// 这个人工面 $0 server action 与它在 UI("Shots continue from each other" 开关)、Otto skill
// 两侧的调用方一并退场,没有替代覆盖(报废,不是迁移)。

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

  // PR #1417 判官 P2-1 —— 原「首帧作业在途 + 改 firstFramePrompt → 拒绝」测试删除:
  // editInput 已经不接受 firstFramePrompt(见上方 editShotPrompt describe 的报废说明),
  // 这个场景(经 editShotPrompt 改 firstFramePrompt 触发帧忙闸)结构上不再可达 —— 没有一条
  // 入参能让 firstFramePrompt 真的送到 inFlightPointerBlock / applyEditShotPrompt 面前。
  // 帧忙闸本身没有被拆:下面「首帧作业在途、但这次只改 videoPrompt → 放行」那条还在,
  // 证明视频编辑不会被无关的帧在途误拦。

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

// PR #1417 判官 P2-1 —— "#782 r17 editShotPrompt" 整个 describe(7 test)连同它的头部
// 说明一起报废删除:它的前提是「真实 UI 无条件同发 firstFramePrompt + videoPrompt,服务端
// 必须自己比对『真的改了没』」——这个前提已经不成立。editInput 已经不接受 firstFramePrompt
// 这一格(见上方 editShotPrompt describe 的报废说明),StoryboardCard.tsx 的 saveEdit 也已经
// 不再发它(见该文件同处注释),所以「字段在不在」与「真的不同」这两档在 editShotPrompt 这
// 条路上已经没有分歧可言 —— 第一档物理上不可能出现。块内真正还有价值的两条覆盖已经确认
// 在别处仍然成立,不是净损失:
//   • 时长「改了 vs 原样回发」的级联判定 —— 在 `applyEditShotPrompt`/`editStaleness` 纯函数
//     层面被 `storyboard-edit.test.ts` 的 editStaleness 用例直接钉住(含 durationSeconds
//     原样回发 → { frame:false, video:false } 那一档),不必在 server action 这一层重复。
//   • 视频作业在途 + 视频文字真的改了 → 拒绝 —— 与上面 r15 describe 的
//     「视频作业 GENERATING + 改 videoPrompt → 拒绝」同一个场景,r15 那条还在。
