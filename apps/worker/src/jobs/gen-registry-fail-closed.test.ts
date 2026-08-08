/**
 * #647 T6 修复轮 P1-3 —— **开关读不到 ≠ 什么都没关**(worker 侧)。
 *
 * 判官 r1 现场:`workerDisabledModels`(apps/worker/src/model-registry.ts)把一切 DB 错误
 * 吞掉回空集合,`handleGen` 的注释还明说「a config-read hiccup must never fail a legitimate
 * already-queued job」—— 于是「库里全禁用 + 配置查询瞬时失败」这一刻,worker 会径直走过
 * 那道闸,claim、调 provider、**真的把钱花出去**。网页侧铸不出卡最多是白高兴一场;这一侧
 * 花掉的是钱。
 *
 * 正确的失败语义在这个仓库已经有名字了(#664 判过):
 *   - **PLAIN**(不带 charged 标记)= 花钱之前的故障 ⇒ 重投重试,预扣继续挂着,零花费;
 *   - **charged** = 已经计费 ⇒ 终态,绝不重试。
 * 配置查询抖一下正是典型的**瞬时**故障,所以它必须抛 PLAIN:重试是合理的,静默继续花钱不是。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const genJobFindUnique = vi.fn();
  const genJobUpdate = vi.fn();
  const genJobUpdateMany = vi.fn();
  const projectFindFirst = vi.fn();
  const chatMessageFindFirst = vi.fn();
  const chatMessageCreate = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateVideo = vi.fn();
  const generateImages = vi.fn();
  const workerDisabledModels = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    genJob: { findUnique: genJobFindUnique, update: genJobUpdate, updateMany: genJobUpdateMany },
    project: { findFirst: projectFindFirst },
    generation: { findFirst: vi.fn(), create: vi.fn() },
    asset: { upsert: vi.fn() },
    entity: { findMany: vi.fn().mockResolvedValue([]) },
    chatMessage: { findFirst: chatMessageFindFirst, create: chatMessageCreate },
    creditLedger: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, genJobFindUnique, genJobUpdate, genJobUpdateMany, projectFindFirst,
    chatMessageFindFirst, chatMessageCreate, refundReservation, settleCredits,
    generateVideo, generateImages, workerDisabledModels,
  };
});

vi.mock("@fikirtive/db", () => ({
  prisma: m.prisma,
  refundReservation: m.refundReservation,
  settleCredits: m.settleCredits,
  settleCanvasCardsForGenJob: vi.fn(async () => ({ status: "settled", nodeIds: [], created: 0, updated: 0 })),
}));
vi.mock("../storage.js", () => ({ storage: { presignedGet: vi.fn(), put: vi.fn() } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generateVideo: m.generateVideo, generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: m.workerDisabledModels }));

import { GEN_RETRY_LIMIT } from "@fikirtive/core";
import { handleGen } from "./gen.js";

const job = {
  id: "g1", ownerId: "o1", projectId: "p1", threadId: "t1", shotId: null,
  status: "QUEUED", kind: "VIDEO", model: "seedance-2-mini", prompt: "make it move",
  entityIds: [], variantSel: null, count: 1, videoOptions: null, generationIds: [],
  spentUsd: null, sourceGenerationId: null, tailGenerationId: null, referenceVideoGenerationId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.genJobFindUnique.mockResolvedValue(job);
  m.projectFindFirst.mockResolvedValue({ id: "p1" });
  m.genJobUpdateMany.mockResolvedValue({ count: 1 });
  m.chatMessageFindFirst.mockResolvedValue({ seq: 1 });
  m.chatMessageCreate.mockResolvedValue({ id: "msg1" });
});

describe("#647 T6 修复轮 P1-3:开关查询失败 ⇒ 不许继续花钱(worker 侧)", () => {
  beforeEach(() => {
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
  });

  it("provider 一次都没被调用 —— 这一趟没有花出去一分钱", async () => {
    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.generateImages).not.toHaveBeenCalled();
  });

  it("抛出的是 PLAIN(不带 charged 标记)—— 瞬时故障该重投,不该被当成已计费的终态", async () => {
    const err = await handleGen({ genJobId: "g1" }, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { charged?: unknown }).charged).toBeUndefined();
  });

  it("重试窗口内不终态、不退款:预扣继续挂着,等下一次重投", async () => {
    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();
    const terminal = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(terminal).toBeUndefined();
    expect(m.refundReservation).not.toHaveBeenCalled();
    // 走的是 requeue 那条路(status 重置回 QUEUED)
    const requeued = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "QUEUED");
    expect(requeued).toBeTruthy();
  });

  it("重试用尽之后才终态 + 退款(不会永远转圈,而且全程零花费)", async () => {
    await expect(handleGen({ genJobId: "g1" }, GEN_RETRY_LIMIT)).rejects.toThrow();
    const terminal = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(terminal).toBeTruthy();
    expect(terminal?.[0]?.data?.spent).toBe(false); // 从没花过
    expect(m.refundReservation).toHaveBeenCalled();
    expect(m.generateVideo).not.toHaveBeenCalled();
  });
});

describe("#647 T6 修复轮 P1-3:读得到时行为逐字不变", () => {
  it("查询正常且什么都没关 ⇒ 照常走到 provider", async () => {
    m.workerDisabledModels.mockResolvedValue(new Set<string>());
    m.generateVideo.mockRejectedValue(new Error("stop here — 这条只关心闸有没有放行"));
    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();
    expect(m.generateVideo).toHaveBeenCalledTimes(1);
  });

  it("查询正常且这个模型被关 ⇒ 照旧 fail-closed + 退款,不抛(既有行为)", async () => {
    m.workerDisabledModels.mockResolvedValue(new Set<string>(["seedance-2-mini"]));
    await expect(handleGen({ genJobId: "g1" }, 0)).resolves.toBeUndefined();
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalled();
  });

  it("图片作业走的是同一道闸,同一条语义(kind 不改变结论)", async () => {
    m.genJobFindUnique.mockResolvedValue({ ...job, kind: "IMAGE", model: "seedream", count: 1 });
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();
    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #647 T6 修复轮 r2 P1-R2-1 —— 上一轮的修法自己踩了 exactly-once
// ---------------------------------------------------------------------------
//
// 判官 r2 给出的可达序列(我 r1 的改动亲手打开的):
//
//   delivery A 赢下 claim,正在调 provider(行里是 GENERATING + 新鲜心跳);
//   重复 delivery B 落到同一个 job 上 —— 它在**抢 claim 之前**就去读 registry;
//   B 的 registry 查询失败 ⇒ 抛 ⇒ 落进通用 catch ⇒ requeue 那一支把状态写回 QUEUED;
//   而那一行是 **A 的**。于是 A 还在花钱,行却回到 QUEUED,下一次重投再 claim、再调
//   provider —— **同一单付两次**。重试用尽时更糟:活跃作业被终态化 + 退款。
//
// 根子在**顺序**:registry 读取站在原子 claim 前面,于是「读失败」这条路能碰到一行不属于
// 自己的作业。既有那条「近期活跃 winner 不许被碰」的防线(claim 失败分支只对 STALE 下手)
// 被整个绕了过去 —— 因为 B 根本没走到 claim 就抛了。
//
// 修法(判官给定的最小修向):registry 读取挪到**成功 claim 之后、任何 provider 调用之前**。
// 抛的还是 PLAIN,但此时这一行已经是本 delivery 抢到的,requeue 自己的行天经地义。
describe("#647 T6 r2 P1-R2-1:重复 delivery 的 registry 故障不许碰别人的活跃 winner", () => {
  /** A 已经赢下 claim:行是 GENERATING,心跳新鲜(远没到 stale 窗口)。 */
  const activeWinner = { ...job, status: "GENERATING", startedAt: new Date() };

  beforeEach(() => {
    m.genJobFindUnique.mockResolvedValue(activeWinner);
    // B 抢不到 claim(where status:"QUEUED" 匹配不到);而 staled 那一支
    // (where status:"GENERATING" + startedAt < 阈值)也匹配不到 —— 这行是新鲜的。
    // 任何**别的** updateMany 都会被下面的断言抓住。
    m.genJobUpdateMany.mockImplementation(async (args: { where?: { status?: unknown } }) => {
      const status = args?.where?.status;
      if (status === "QUEUED") return { count: 0 };       // B 输掉 claim
      if (status === "GENERATING") return { count: 0 };   // 不是 stale,不许 fail-close
      return { count: 0 };
    });
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
  });

  it("绝不把活跃 winner 的状态写回 QUEUED(写回去 = 下一次重投再花一次钱)", async () => {
    await handleGen({ genJobId: "g1" }, 0).catch(() => undefined);
    const requeued = m.genJobUpdateMany.mock.calls.filter((c) => c[0]?.data?.status === "QUEUED");
    expect(requeued, "把别人的活跃作业打回了 QUEUED —— 这就是双花那条路").toEqual([]);
  });

  it("绝不把活跃 winner 终态化,也绝不退它的款", async () => {
    await handleGen({ genJobId: "g1" }, GEN_RETRY_LIMIT).catch(() => undefined);
    // 这里**允许**出现一次 FAILED 写 —— 那是既有的「输掉 claim」分支里那条 stale-only 的
    // 条件写,它的 WHERE 带着 `startedAt < 阈值`,对一个心跳新鲜的 winner 匹配 0 行。
    // 要钉死的不是「有没有发起这条写」,而是**绝不允许一条没有 stale 守卫的终态写**
    // —— 那种写才会真的把别人的活跃作业打死。
    const failed = m.genJobUpdateMany.mock.calls.filter((c) => c[0]?.data?.status === "FAILED");
    for (const call of failed) {
      expect(call[0]?.where?.startedAt?.lt, "终态写必须带 stale 守卫").toBeInstanceOf(Date);
      expect(call[0]?.where?.status).toBe("GENERATING");
    }
    // 匹配 0 行 ⇒ 没退款。退款发生了,就说明我们真把别人的 winner 打死了。
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("零 provider 调用(B 这一趟本来就不该花钱)", async () => {
    await handleGen({ genJobId: "g1" }, 0).catch(() => undefined);
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.generateImages).not.toHaveBeenCalled();
  });

  it("输掉 claim 的 delivery 根本不去读 registry —— 顺序对了,这条自然成立", async () => {
    await handleGen({ genJobId: "g1" }, 0).catch(() => undefined);
    expect(m.workerDisabledModels).not.toHaveBeenCalled();
  });
});

// 顺序改了之后,「赢下 claim 的那个 delivery 读失败」这条路必须原样保留 r1 的语义:
// 它动的是**自己**抢到的行,requeue 天经地义。
describe("#647 T6 r2:赢下 claim 之后读失败 —— 仍然是自己的行,仍然 requeue", () => {
  beforeEach(() => {
    m.genJobFindUnique.mockResolvedValue(job); // QUEUED
    m.genJobUpdateMany.mockResolvedValue({ count: 1 }); // 赢下 claim
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
  });

  it("requeue 自己的行、零 provider 调用、不退款", async () => {
    await expect(handleGen({ genJobId: "g1" }, 0)).rejects.toThrow();
    const requeued = m.genJobUpdateMany.mock.calls.find((c) => c[0]?.data?.status === "QUEUED");
    expect(requeued).toBeTruthy();
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("registry 是在 claim **之后**才被读的(顺序本身就是那条防线)", async () => {
    await handleGen({ genJobId: "g1" }, 0).catch(() => undefined);
    expect(m.workerDisabledModels).toHaveBeenCalled();
    const claimCall = m.genJobUpdateMany.mock.invocationCallOrder[0];
    const registryCall = m.workerDisabledModels.mock.invocationCallOrder[0];
    expect(claimCall, "claim 必须先发生").toBeLessThan(registryCall!);
  });
});
