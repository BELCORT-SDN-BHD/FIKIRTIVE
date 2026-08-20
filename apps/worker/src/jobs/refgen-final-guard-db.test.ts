/**
 * refgen-final-guard-db.test.ts —— 钱路 M1-b ③ 在**真库**上证。
 *
 * 两件事,同一个 catch:
 *
 * ① **#951 漏网** —— `failClosedRefund` 在 #951 里已经改成条件写了,但 catch 里那条终态失败
 *    还是无条件的 `tx.refGenJob.update({ where: { id } })`,而 gen.ts 的同一处(#602 r2,
 *    判官 P1-2)早就是条件写。它只信这条 delivery **内存里那份快照**:「这一单还什么都没交付」。
 *    并发时序:另一条 delivery 已经把产出与 SETTLE 提交、DONE 也写下,而这一条正好在付费调用
 *    之后、提交之前摔了一跤 —— 旧写法会把一单**已经收钱、已经交付**的作业盖成 FAILED。
 *
 * ② **#1001 判官 P3-4** —— `final` 的判据不含 `permanent`。引擎看过商家送来的东西之后拒绝
 *    (适配器打 permanent,例如参考图里有可辨认的真人)时,同一张图每一次都会得到同一个拒绝,
 *    而旧判据要跑满 REFGEN_RETRY_LIMIT 次重投才终结退款:商家白等三轮队列。钱的结果一个字
 *    不变 —— permanent 的失败是证明没花钱的,退款仍走同一条终态分支。
 *
 * 时序注入用的是 refgen-terminal-write-db.test.ts 的手法:手动保存/复原函数引用,不用
 * vi.spyOn(对 Prisma 7 扩展客户端的 model delegate spyOn 之后,同文件后续用例会报
 * "is not a function")。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { prisma, reserveCredits, settleCredits } from "@fikirtive/db";
import { handleRefGen } from "./refgen.js";

// 同其它真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000;
const START = 100_000;

let orgId: string;
let entityId: string;
let jobId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  orgId = `org_${randomUUID()}`;
  entityId = `ent_${randomUUID()}`;
  jobId = `rj_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: START, reserved: 0 } });
  await prisma.entity.create({ data: { id: entityId, ownerId: orgId, type: "PRODUCT", name: "Widget" } });
  m.storagePresignedGet.mockResolvedValue("https://example.test/signed");
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

async function moneyTrail() {
  const ledger = await prisma.creditLedger.findMany({ where: { orgId, refId: jobId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { kinds: ledger.map((r) => r.kind), balance: account.balance, reserved: account.reserved };
}

async function jobRow() {
  return prisma.refGenJob.findFirstOrThrow({
    where: { id: jobId, ownerId: orgId },
    select: { status: true, outputAssetIds: true, error: true, spentUsd: true, attempts: true },
  });
}

async function seedQueuedJob(): Promise<void> {
  await prisma.refGenJob.create({
    data: { id: jobId, ownerId: orgId, entityId, prompt: "p", count: 1, model: "seedream", mode: "BASE", status: "QUEUED" },
  });
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
}

/** 另一条并发 delivery 跑完了:产出 + SETTLE 同一笔提交,随后 DONE 也写下。 */
async function concurrentDeliveryFinishes(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.refGenJob.updateMany({ where: { id: jobId, ownerId: orgId }, data: { outputAssetIds: ["asset_committed"], spentUsd: 0.14 } });
    await settleCredits(tx, { orgId, refId: jobId });
  });
  await prisma.refGenJob.updateMany({ where: { id: jobId, ownerId: orgId }, data: { status: "DONE", finishedAt: new Date() } });
}

describe("#951 漏网(M1-b):catch 里的终态失败写也必须是条件写", () => {
  it("并发双终态:另一条 delivery 已交付并 DONE ⇒ 这条迟到的失败绝不许盖成 FAILED", async () => {
    await seedQueuedJob();
    // 付费调用返回了(spent = true),但**存产出的那一步**摔了一跤 —— 于是 final = true,
    // 走 catch 的终态分支。就在这一刻,另一条 delivery 已经把这一单交付并结算完了。
    m.generateImages.mockResolvedValue([{ bytes: Buffer.from("img"), ext: "png" }]);
    m.storagePut.mockImplementation(async () => {
      await concurrentDeliveryFinishes();
      throw new Error("object storage write failed");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(handleRefGen({ refGenJobId: jobId }, 0)).rejects.toThrow();
    } finally {
      errorSpy.mockRestore();
    }

    const job = await jobRow();
    expect(job.status, "已经交付并结算的作业被这条迟到的失败盖成了 FAILED").toBe("DONE");
    expect(job.outputAssetIds, "交付的痕迹被抹掉了").toEqual(["asset_committed"]);
    const money = await moneyTrail();
    expect(money.kinds, "钱被动了第二次").toEqual(["RESERVE", "SETTLE"]);
    expect(money.balance).toBe(START - HOLD);
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("反向锚:真的没人跟你抢时,终态失败照旧 FAILED + 退款 + 记 spentUsd,一格没松", async () => {
    await seedQueuedJob();
    m.generateImages.mockResolvedValue([{ bytes: Buffer.from("img"), ext: "png" }]);
    m.storagePut.mockRejectedValue(new Error("object storage write failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(handleRefGen({ refGenJobId: jobId }, 0)).rejects.toThrow();
    } finally {
      errorSpy.mockRestore();
    }

    const job = await jobRow();
    expect(job.status).toBe("FAILED");
    expect(job.outputAssetIds).toEqual([]);
    // 付费调用已经返回过 ⇒ 「付了钱没交付」必须留痕
    expect(job.spentUsd).not.toBeNull();
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START);
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);
});

describe("#1001 判官 P3-4(M1-b):引擎的永久性拒绝,第一次就终结退款", () => {
  it("permanent 的失败在 retryCount 0 就 FAILED + 全额退款,不再跑满重试", async () => {
    await seedQueuedJob();
    m.generateImages.mockRejectedValue(
      Object.assign(new Error("That reference image shows a recognisable person."), { permanent: true as const }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(handleRefGen({ refGenJobId: jobId }, 0)).rejects.toThrow();
    } finally {
      errorSpy.mockRestore();
    }

    const job = await jobRow();
    expect(job.status, "永久性拒绝还在等重投 —— 商家白等三轮队列拿同一句拒绝").toBe("FAILED");
    // permanent 是**证明没花钱**的(引擎跑之前的 4xx):不记 spentUsd。
    expect(job.spentUsd).toBeNull();
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.balance, "商家没拿到东西却被扣了钱").toBe(START);
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("对照:普通(可重试)失败在 retryCount 0 仍然 requeue,预扣挂着不动", async () => {
    await seedQueuedJob();
    m.generateImages.mockRejectedValue(new Error("connection reset"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(handleRefGen({ refGenJobId: jobId }, 0)).rejects.toThrow();
    } finally {
      errorSpy.mockRestore();
    }

    const job = await jobRow();
    expect(job.status).toBe("QUEUED");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE"]); // 预扣还挂着,等重投
    expect(money.reserved).toBe(HOLD);
  }, DB_CASE_TIMEOUT_MS);

  it("双租户:一次 permanent 退款只动它自己那个组织的钱", async () => {
    const otherOrgId = `org_${randomUUID()}`;
    await prisma.organization.create({ data: { id: otherOrgId } });
    await prisma.creditAccount.create({ data: { orgId: otherOrgId, balance: START, reserved: 0 } });
    await seedQueuedJob();
    m.generateImages.mockRejectedValue(Object.assign(new Error("rejected"), { permanent: true as const }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(handleRefGen({ refGenJobId: jobId }, 0)).rejects.toThrow();
    } finally {
      errorSpy.mockRestore();
    }

    const other = await prisma.creditAccount.findFirstOrThrow({ where: { orgId: otherOrgId } });
    expect(other.balance).toBe(START);
    expect(other.reserved).toBe(0);
    expect(await prisma.creditLedger.findMany({ where: { orgId: otherOrgId } })).toEqual([]);
  }, DB_CASE_TIMEOUT_MS);
});
