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

beforeEach(() => {
  vi.clearAllMocks();
  m.refGenJobFindUnique.mockResolvedValue(job);
  m.entityFindFirst.mockResolvedValue({ id: "e1", ownerId: "o1" });
  m.refGenJobUpdateMany.mockResolvedValue({ count: 1 });
  m.refGenJobUpdate.mockResolvedValue({});
});

describe("#647 T6 修复轮 P1-3:参考图侧同样不许在开关状态不明时花钱", () => {
  it("开关读不到 ⇒ 零 provider 调用、不终态、不退款(预扣挂着等重投)", async () => {
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await expect(handleRefGen({ jobId: "r1" } as never, 0)).rejects.toThrow();
    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).not.toHaveBeenCalled();
  });

  it("抛的是 PLAIN(不带 charged)—— 花钱之前的故障,重投是对的", async () => {
    m.workerDisabledModels.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const err = await handleRefGen({ jobId: "r1" } as never, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { charged?: unknown }).charged).toBeUndefined();
  });

  it("读得到且这个模型被关 ⇒ 照旧 fail-closed + 退款,不抛(既有行为一字不动)", async () => {
    m.workerDisabledModels.mockResolvedValue(new Set<string>(["seedream"]));
    await expect(handleRefGen({ jobId: "r1" } as never, 0)).resolves.toBeUndefined();
    expect(m.generateImages).not.toHaveBeenCalled();
    expect(m.refundReservation).toHaveBeenCalled();
  });
});
