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
vi.mock("../otto-resume.js", () => ({ resumeOttoAfterGen: vi.fn() }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: m.workerDisabledModels }));

import { GEN_RETRY_LIMIT } from "@fikirtive/core";
import { handleGen } from "./gen.js";

const job = {
  id: "g1", ownerId: "o1", projectId: "p1", threadId: "t1", shotId: null,
  status: "QUEUED", kind: "VIDEO", model: "seedance-2-fast", prompt: "make it move",
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
    m.workerDisabledModels.mockResolvedValue(new Set<string>(["seedance-2-fast"]));
    await expect(handleGen({ genJobId: "g1" }, 0)).resolves.toBeUndefined();
    expect(m.generateVideo).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalled();
  });
});
