/**
 * #647 T6 修复轮 P1-3 —— **另一个** workerDisabledModels 消费者:参考图任务。
 *
 * `workerDisabledModels` 全仓只有两个调用点:`handleGen` 与 `handleRefGen`。改的是它们共用
 * 的那一行,所以两侧都得钉 —— 只钉一侧,另一侧就是「读过代码觉得对」,不是证据。
 *
 * refgen 的 catch 与 gen 是同一套结构
 * (`final = !committed && (spent || charged || retryCount >= REFGEN_RETRY_LIMIT)`),
 * 所以 PLAIN 抛在花钱之前 ⇒ requeue、预扣挂着、零 provider 调用。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const refGenJobFindUnique = vi.fn();
  const refGenJobUpdate = vi.fn();
  const refGenJobUpdateMany = vi.fn();
  const entityFindFirst = vi.fn();
  const refundReservation = vi.fn();
  const settleCredits = vi.fn();
  const generateImages = vi.fn();
  const workerDisabledModels = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refGenJob: { findUnique: refGenJobFindUnique, update: refGenJobUpdate, updateMany: refGenJobUpdateMany },
    entity: { findFirst: entityFindFirst },
    referenceImage: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    asset: { upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    prisma, refGenJobFindUnique, refGenJobUpdate, refGenJobUpdateMany, entityFindFirst,
    refundReservation, settleCredits, generateImages, workerDisabledModels,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma, refundReservation: m.refundReservation, settleCredits: m.settleCredits, Prisma: {} }));
vi.mock("../storage.js", () => ({ storage: { put: vi.fn(), presignedGet: vi.fn() } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: m.workerDisabledModels }));

import { handleRefGen } from "./refgen.js";

const job = {
  id: "r1", ownerId: "o1", entityId: "e1", status: "QUEUED", mode: "BASE",
  model: "seedream", prompt: "p", count: 1, variantId: null, outputAssetIds: [], spentUsd: null,
};

/** 生产读的队列字段(refgen.ts:220 `data.refGenJobId`)。
 *  #647 T6 r2 P2-R2-1:上一版这里传的是 `{ jobId }` —— 一个生产代码根本不看的字段。
 *  夹具当时忽略参数,所以怎么写都绿:那是一道**假闸**,它证明不了任何事。 */
const DELIVERY = { refGenJobId: "r1" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  // 对字段敏感:只有按真实字段查过来才找得到这一行。传错字段 ⇒ null ⇒ handler 直接丢弃,
  // 下面每一条断言都会红。这就是「假闸转真闸」的机器证明。
  m.refGenJobFindUnique.mockImplementation(async (args: { where?: { id?: unknown } }) =>
    args?.where?.id === "r1" ? job : null,
  );
  m.entityFindFirst.mockResolvedValue({ id: "e1", ownerId: "o1" });
  m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
  m.refGenJobUpdate.mockResolvedValue({});
});

describe("#647 T6 修复轮 P1-3:参考图侧同样不许在开关状态不明时花钱", () => {
  it("夹具本身是真闸:按生产的队列字段才查得到这一行(传错字段就查不到)", async () => {
    // 正字段:查得到 ⇒ 走到 registry(它抛,所以整趟抛)。
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await expect(handleRefGen(DELIVERY, 0)).rejects.toThrow();
    expect(m.refGenJobFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1" } }));

    // 错字段(上一版传的那个):查不到 ⇒ handler 丢弃 ⇒ 不抛、也不碰 registry。
    vi.clearAllMocks();
    m.refGenJobFindUnique.mockImplementation(async (args: { where?: { id?: unknown } }) =>
      args?.where?.id === "r1" ? job : null,
    );
    await expect(handleRefGen({ jobId: "r1" } as never, 0)).resolves.toBeUndefined();
    expect(m.workerDisabledModels).not.toHaveBeenCalled();
  });

  it("开关读不到 ⇒ 零 provider 调用、不终态、不退款(预扣挂着等重投)", async () => {
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await expect(handleRefGen(DELIVERY, 0)).rejects.toThrow();
    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("抛的是 PLAIN(不带 charged)—— 花钱之前的故障,重投是对的", async () => {
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const err = await handleRefGen(DELIVERY, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { charged?: unknown }).charged).toBeUndefined();
  });

  it("读得到且这个模型被关 ⇒ 照旧 fail-closed + 退款,不抛(既有行为一字不动)", async () => {
    m.workerDisabledModels.mockResolvedValue(new Set<string>(["seedream"]));
    await expect(handleRefGen(DELIVERY, 0)).resolves.toBeUndefined();
    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalled();
  });

  it("registry 是在 claim **之后**才被读的(r2 P1-R2-1 的顺序防线,参考图侧同款)", async () => {
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await handleRefGen(DELIVERY, 0).catch(() => undefined);
    const claimCall = m.refGenJobUpdateMany.mock.invocationCallOrder[0];
    const registryCall = m.workerDisabledModels.mock.invocationCallOrder[0];
    expect(claimCall, "claim 必须先发生").toBeLessThan(registryCall!);
  });
});

describe("#647 T6 r2 P1-R2-1:参考图侧,重复 delivery 的 registry 故障也不许碰活跃 winner", () => {
  beforeEach(() => {
    // A 已赢下 claim:行是 GENERATING、心跳新鲜。
    m.refGenJobFindUnique.mockImplementation(async (args: { where?: { id?: unknown } }) =>
      args?.where?.id === "r1" ? { ...job, status: "GENERATING", startedAt: new Date() } : null,
    );
    m.refGenJobUpdateMany.mockImplementation(async (args: { where?: { status?: unknown } }) => {
      if (args?.where?.status === "QUEUED") return { count: 0 };     // B 输掉 claim
      if (args?.where?.status === "GENERATING") return { count: 0 }; // 不是 stale,不许 fail-close
      return { count: 0 };
    });
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
  });

  it("不把活跃 winner 打回 QUEUED、不终态化、不退款、零 provider 调用", async () => {
    await handleRefGen(DELIVERY, 0).catch(() => undefined);
    const requeued = m.refGenJobUpdateMany.mock.calls.filter((c) => c[0]?.data?.status === "QUEUED");
    expect(requeued, "把别人的活跃作业打回了 QUEUED —— 双花那条路").toEqual([]);
    const failed = m.refGenJobUpdateMany.mock.calls.filter((c) => c[0]?.data?.status === "FAILED");
    expect(failed).toEqual([]);
    expect(m.refundReservation).not.toHaveBeenCalled();
    expect(m.generateImages).not.toHaveBeenCalled();
  });

  it("输掉 claim 的 delivery 根本不去读 registry", async () => {
    await handleRefGen(DELIVERY, 0).catch(() => undefined);
    expect(m.workerDisabledModels).not.toHaveBeenCalled();
  });
});
