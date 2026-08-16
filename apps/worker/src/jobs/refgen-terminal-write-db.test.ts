/**
 * refgen-terminal-write-db.test.ts —— #951 在**真库**上证。
 *
 * 票 #951 的问题:refgen.ts 是 gen.ts 同一套钱路编排的手工镜像,但此后两轮钱路硬化
 * (#602 条件终态写、#858 四态退款)只进了 gen 一侧。refgen.ts:63-68 的 failClosedRefund
 * 在修复前是**无条件**的 `tx.refGenJob.update({ where: { id: jobId }, ... })`——不看这一刻
 * 库里的真相,只信调用方内存里那份可能已经过期的快照。
 *
 * 判官 r17(gen.ts 同款判词)钉出的时序,搬到 refgen 上:
 *   1. 某条**并发的 delivery**(迟到重投)赢下 QUEUED→GENERATING 的 claim,行是 GENERATING;
 *   2. 它跑完付费 provider 调用,提交事务落库——outputAssetIds + settle 同一笔;
 *   3. 但另一条**这一刻正在走 entity-gone 前置闸**的 delivery,手上的快照是「outputAssetIds
 *      还是空的」(它比第 1 步的提交更早读到这一行);它现在查到 entity 已经不在了
 *      (可能是商家在这个窗口内删的,也可能是任何原因),准备 fail-closed;
 *   4. 修复前的 failClosedRefund 只看「entity 不在了」这一个事实,不看这一单是否已经交付:
 *      它无条件把行写成 FAILED——而此时这一单**已经收钱、已经交付**,outputAssetIds/spentUsd
 *      仍留着交付的痕迹,行变得自相矛盾。
 *
 * `refundReservation` 自己的 finalizer-once 唯一索引(SETTLE/REFUND 二选一)挡住了**真的**
 * 二次退款——钱本身不会被多退。但状态写没有同等的守卫:一单已经交付的作业,记录被覆盖成了
 * FAILED,而这正是票里问的「②终态被迟到结果覆盖」。
 *
 * 覆盖两条闸(entity-gone、variant-gone)——两处都在 claim 之前,都用同一个 failClosedRefund。
 * model-disabled 闸站在 claim 之后(这一条 delivery 已经独占这一行),不在这条时序覆盖范围内,
 * 但闭合改动本身对它同样生效(闸的实现是共用的,由 refgen-registry-fail-closed.test.ts 的既有
 * mock 用例覆盖)。
 *
 * 时序模拟用例(文件最后一段)不用 vi.spyOn 拦截 prisma.entity/entityVariant.findFirst——
 * 经验证,对 Prisma 7 扩展客户端(`$extends`)的 model delegate spyOn 之后 mockRestore(),
 * 在同一文件内**后续测试**里再次调用同一 findFirst 会报「is not a function」(是这套
 * spy/extends 组合本身的既有局限,不是这张票要修的钱路问题;gen-done-empty-db.test.ts 的
 * stubProjectGoneOnce 从未在 spy 之后又跑用到同一方法的测试,所以从未暴露)。改用手动保存
 * /复原函数引用(不经过 vi.spyOn 的描述符机制),同样能在真实 handleRefGen 执行的**那一刻**
 * 插入并发提交,而不留下这个坑。
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
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

async function moneyTrail(refId = jobId) {
  const ledger = await prisma.creditLedger.findMany({ where: { orgId, refId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { kinds: ledger.map((r) => r.kind), balance: account.balance, reserved: account.reserved };
}

async function jobRow(id = jobId) {
  return prisma.refGenJob.findFirstOrThrow({ where: { id, ownerId: orgId }, select: { status: true, outputAssetIds: true, error: true, spentUsd: true } });
}

/** 模拟「另一条并发 delivery」已经跑完付费调用并提交(outputAssetIds + settle 同一笔),
 *  但还没来得及 attach/finalizeDone——镜像 gen-done-empty-db.test.ts 的
 *  seedLateRedeliveryOntoCommit,只是这里的提交点是 refgen 自己的字段形状。 */
async function commitOutputsAndSettle() {
  await prisma.$transaction(async (tx) => {
    await tx.refGenJob.updateMany({ where: { id: jobId, ownerId: orgId }, data: { outputAssetIds: ["asset_committed"], spentUsd: 0.14 } });
    await settleCredits(tx, { orgId, refId: jobId });
  });
}

// ---------------------------------------------------------------------------
// 反向锚 —— entity/variant 真的没了、钱真的没收:前置闸的既有行为不许被这张票的改动松动。
// ---------------------------------------------------------------------------

describe("#951 反向锚:真的 gone 时,前置闸照旧 FAILED + 退款,一格没松", () => {
  it("entity 真的没了", async () => {
    await prisma.refGenJob.create({
      data: { id: jobId, ownerId: orgId, entityId, prompt: "p", count: 1, model: "seedream", mode: "BASE", status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    await prisma.entity.updateMany({ where: { id: entityId, ownerId: orgId }, data: { deletedAt: new Date() } });

    await handleRefGen({ refGenJobId: jobId }, 0);

    const job = await jobRow();
    expect(job.status).toBe("FAILED");
    expect(job.outputAssetIds).toEqual([]);
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START);
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("variant 真的没了", async () => {
    const variantId = `var_${randomUUID()}`;
    await prisma.entityVariant.create({ data: { id: variantId, ownerId: orgId, entityId, name: "Red", handle: "red" } });
    await prisma.refGenJob.create({
      data: { id: jobId, ownerId: orgId, entityId, variantId, prompt: "p", count: 1, model: "seedream", mode: "VARIANT", status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    await prisma.entityVariant.updateMany({ where: { id: variantId, ownerId: orgId }, data: { deletedAt: new Date() } });

    await handleRefGen({ refGenJobId: jobId }, 0);

    const job = await jobRow();
    expect(job.status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START);
  }, DB_CASE_TIMEOUT_MS);
});

describe("#951 双租户:一个组织的前置闸绝不结算/退款另一个组织的钱", () => {
  it("entity-gone 闸只动同一个 ownerId 的预扣", async () => {
    const otherOrgId = `org_${randomUUID()}`;
    await prisma.organization.create({ data: { id: otherOrgId } });
    await prisma.creditAccount.create({ data: { orgId: otherOrgId, balance: START, reserved: 0 } });

    await prisma.refGenJob.create({
      data: { id: jobId, ownerId: orgId, entityId, prompt: "p", count: 1, model: "seedream", mode: "BASE", status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    await prisma.entity.updateMany({ where: { id: entityId, ownerId: orgId }, data: { deletedAt: new Date() } });

    await handleRefGen({ refGenJobId: jobId }, 0);

    const otherAccount = await prisma.creditAccount.findFirstOrThrow({ where: { orgId: otherOrgId } });
    expect(otherAccount.balance).toBe(START);
    expect(otherAccount.reserved).toBe(0);
    const otherLedger = await prisma.creditLedger.findMany({ where: { orgId: otherOrgId } });
    expect(otherLedger).toEqual([]);
  }, DB_CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 时序核验 —— 这张票的红测试本体。见文件头注释:不用 vi.spyOn,手动保存/复原函数引用。
// ---------------------------------------------------------------------------

describe("#951 已经交付的作业不许被迟到的 entity-gone / variant-gone 闸暂写成 FAILED", () => {
  it("entity-gone:提交事务已落 + 结算已收 → 迟到的前置闸绝不许写 FAILED", async () => {
    // 第 1-2 步的起点:行是 GENERATING(另一条 delivery 已经赢下 claim),outputAssetIds 空
    // ——这就是「这一条」delivery 手上的快照。
    await prisma.refGenJob.create({
      data: { id: jobId, ownerId: orgId, entityId, prompt: "p", count: 1, model: "seedream", mode: "BASE", status: "GENERATING", startedAt: new Date() },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));

    // 第 3 步:entity-gone 前置闸查询的**那一刻**插入第 1-2 步(提交事务落库),然后再让
    // entity 查询返回 null(entity 真的不在了——原因不重要,重要的是「已经交付」这一事实先到)。
    const originalFindFirst = prisma.entity.findFirst;
    prisma.entity.findFirst = (async () => {
      await commitOutputsAndSettle();
      return null;
    }) as typeof prisma.entity.findFirst;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleRefGen({ refGenJobId: jobId }, 0);
    } finally {
      prisma.entity.findFirst = originalFindFirst;
      consoleSpy.mockRestore();
    }

    const job = await jobRow();
    expect(job.status, "已经交付并结算的作业被 entity-gone 闸暂写成了 FAILED").not.toBe("FAILED");
    expect(job.outputAssetIds).toEqual(["asset_committed"]); // 交付的痕迹没被抹掉
    const money = await moneyTrail();
    expect(money.kinds, "钱被动了第二次(多退)").toEqual(["RESERVE", "SETTLE"]);
    expect(money.balance).toBe(START - HOLD);
    // 写入点闸(outputAssetIds isEmpty)先一步把这一行判定为「不可终态化」——updateMany 匹配
    // 0 行,连 refundReservation 都不会被调用,自然也没有「already SETTLED」这句大声报错
    // (那句话是给 updateMany **匹配上了**但 refundReservation 才发现已结算的更窄时序备用的,
    // 见 refgen.ts failClosedRefund 的注释)。这里断言的是:没有任何字段被动过、没有噪音日志。
    expect(consoleSpy).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("variant-gone:提交事务已落 + 结算已收 → 迟到的前置闸绝不许写 FAILED", async () => {
    const variantId = `var_${randomUUID()}`;
    await prisma.entityVariant.create({ data: { id: variantId, ownerId: orgId, entityId, name: "Red", handle: "red" } });
    await prisma.refGenJob.create({
      data: { id: jobId, ownerId: orgId, entityId, variantId, prompt: "p", count: 1, model: "seedream", mode: "VARIANT", status: "GENERATING", startedAt: new Date() },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));

    const originalFindFirst = prisma.entityVariant.findFirst;
    prisma.entityVariant.findFirst = (async () => {
      await commitOutputsAndSettle();
      return null;
    }) as typeof prisma.entityVariant.findFirst;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleRefGen({ refGenJobId: jobId }, 0);
    } finally {
      prisma.entityVariant.findFirst = originalFindFirst;
      consoleSpy.mockRestore();
    }

    const job = await jobRow();
    expect(job.status, "已经交付并结算的作业被 variant-gone 闸暂写成了 FAILED").not.toBe("FAILED");
    expect(job.outputAssetIds).toEqual(["asset_committed"]);
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]);
    expect(money.balance).toBe(START - HOLD);
    expect(consoleSpy).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);
});
