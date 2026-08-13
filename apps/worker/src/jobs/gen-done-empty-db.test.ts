/**
 * gen-done-empty-db.test.ts —— #782 r13(判官 r12 P1-F1)在**真库**上证。
 *
 * 判词说的是「付费 DONE 但 generationIds 为空」这一行不该存在,而它的两半只有真库能证:
 *
 *   ① **写入点**:一趟没有产出的生成绝不许写成 DONE。这里跑真的 `handleGen`、真的 Postgres、
 *      真的 `reserveCredits/settleCredits/refundReservation`(只 mock 掉付费引擎与对象存储),
 *      断言那一行落在 FAILED 上,而钱**回到了商家账上**——不是 SETTLE。
 *      红的形状是真的:`count: 0` 的作业行(2026-06-13 的提交标记与 2026-07-15 的产出数校验
 *      #325 之间那一个月,引擎什么都没返回时就写出这个形状)在 r12 的实现上会得到
 *      DONE + generationIds=[] + SETTLE。
 *
 *   ② **存量自愈**:巡检把这样一行翻成 FAILED + 退款,而且 **exactly-once** —— 同一行被两个
 *      巡检同时扫到只退一笔;已经结算过的那一行一个字都不动(否则 FAILED 会在每个商家界面上
 *      许下一句「你没有被扣钱」的假话);而一个刚刚被商家取消的形状同样不许被它改写。
 *      这几条只有把 `CreditLedger` 的唯一索引真的压上去才叫证明,mock 出来的
 *      `refundReservation` 证明不了任何 exactly-once。
 *
 * 超时给足 60s:每条用例都要建租户、真预扣、跑完整条 handleGen(含画布结算的顾问锁),
 * 在跑满的机器上会远超 vitest 默认的 5s(同 gen-receipt-db.test.ts 的理由)。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

// 只 mock 两件事:付费引擎(绝不真调用)和对象存储。库、钱、事务全是真的。
const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  generateVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, generateVideo: m.generateVideo } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { prisma, reserveCredits, settleCredits, refundReservation } from "@fikirtive/db";
import { handleGen, reapStaleGenJobs, GEN_DONE_EMPTY_GRACE_MS } from "./gen.js";

// 同其它真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000; // 这一单预扣的内部信用点;金额不重要,**动了几次**才重要
const START = 100_000;

let orgId: string;
let projectId: string;
let jobId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // 先把连接池和 query engine 的冷启动付掉
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));

  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  jobId = `gen_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: START, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Shot continuation" } });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 这一单在钱上留下的全部痕迹 —— 张数与余额,不是文字。 */
async function moneyTrail(refId = jobId) {
  const ledger = await prisma.creditLedger.findMany({ where: { orgId, refId }, select: { kind: true, reason: true }, orderBy: { createdAt: "asc" } });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { kinds: ledger.map((r) => r.kind), reasons: ledger.map((r) => r.reason), balance: account.balance, reserved: account.reserved };
}

async function jobRow(id = jobId) {
  return prisma.genJob.findFirstOrThrow({ where: { id, ownerId: orgId }, select: { status: true, generationIds: true, error: true, spent: true } });
}

// ---------------------------------------------------------------------------
// ① 写入点:零产出永不写 DONE
// ---------------------------------------------------------------------------

describe("#782 r13 写入点不变量 —— DONE ⇒ generationIds 非空", () => {
  it("引擎什么都没返回(count=0 的那一行)→ FAILED + 退款,绝不 DONE", async () => {
    // `count: 0` 是 r12 之前真能落库的形状:产出数校验(#325)问的是「几张 ≠ 几张」,
    // 0 === 0 于是放行 —— 空的 stored、空的 ids、提交标记照写、settle 照结,DONE 落在
    // 一行指不出任何东西的作业上。r13 的零产出闸在存任何东西之前就把它挡下来。
    await prisma.genJob.create({
      data: { id: jobId, ownerId: orgId, projectId, prompt: "a poster", kind: "IMAGE", model: "seedream", count: 0, status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    m.generateImages.mockResolvedValue([]); // 引擎回了,什么都没给

    await expect(handleGen({ genJobId: jobId }, 0)).rejects.toThrow();

    const job = await jobRow();
    expect(job.status, "一趟什么都没交出来的生成被写成了 DONE").toBe("FAILED");
    expect(job.generationIds).toEqual([]);
    const money = await moneyTrail();
    expect(money.kinds, "钱被结算了 —— 商家为空气付了账").toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START); // 一分不少地回来了
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("正常一路照旧:有产出 → DONE + 结算,而且 generationIds 真的指得出东西", async () => {
    // 反向锚:上面那道闸不许顺手拦下任何一趟真的做出了东西的生成。
    await prisma.genJob.create({
      data: { id: jobId, ownerId: orgId, projectId, prompt: "a poster", kind: "IMAGE", model: "seedream", count: 1, status: "QUEUED" },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    m.generateImages.mockResolvedValue([{ bytes: new Uint8Array([1, 2, 3]), ext: "png" }]);

    await handleGen({ genJobId: jobId }, 0);

    const job = await jobRow();
    expect(job.status).toBe("DONE");
    expect(job.generationIds).toHaveLength(1);
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// ② 存量自愈:翻转 + 退款的 exactly-once
// ---------------------------------------------------------------------------

/** 造一行「不该存在」的历史数据:DONE、零产出、宽限期之外。`settled` 决定它的钱走到哪一步。 */
async function seedDoneEmpty(opts: { settled: boolean; refunded?: boolean }) {
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
      status: "DONE", generationIds: [], spent: true, progress: 100,
      startedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
      finishedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
    },
  });
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
  if (opts.settled) await prisma.$transaction((tx) => settleCredits(tx, { orgId, refId: jobId }));
  if (opts.refunded) await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId: jobId }));
}

// 断言一律钉在**这一条**作业行与**这一个**租户的账上,不看 sweep 的返回计数:扫描是跨租户的,
// 而这个库同时住着同一份测试跑出来的别的行,拿一个全局计数当断言就是把用例交给运行次序。
describe("#782 r13 存量自愈 —— 翻转 FAILED + 退款,exactly-once", () => {
  it("预扣还挂着的那一行 → FAILED + 一笔退款,钱回到商家账上", async () => {
    await seedDoneEmpty({ settled: false });

    await reapStaleGenJobs();

    const job = await jobRow();
    expect(job.status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.reasons).toContain("gen:done-without-output"); // 这一笔退款签了自己的名字
    expect(money.balance).toBe(START);
    expect(money.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("两个巡检同时扫到同一行 → 只翻一次、只退一笔(exactly-once 由唯一索引兜底)", async () => {
    await seedDoneEmpty({ settled: false });

    // 真并发:两次 sweep 同时跑,ledger 的 finalizer 唯一索引是唯一的仲裁者。
    await Promise.all([reapStaleGenJobs(), reapStaleGenJobs()]);

    expect((await jobRow()).status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds, "退了两笔 —— 商家凭空多出一份钱").toEqual(["RESERVE", "REFUND"]);
    expect(money.balance).toBe(START);
    // 终态消息同样只许有一条(genJobId 上的单条终态消息唯一索引)。
    const msgs = await prisma.chatMessage.count({ where: { genJobId: jobId, ownerId: orgId } });
    expect(msgs).toBeLessThanOrEqual(1);
  }, DB_CASE_TIMEOUT_MS);

  it("已经结算过的那一行 → 一个字都不动(FAILED 会在每个界面上许下一句关于钱的假话)", async () => {
    await seedDoneEmpty({ settled: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await reapStaleGenJobs();
      const job = await jobRow();
      expect(job.status, "把一行真的收过钱的作业翻成了「你没有被扣钱」").toBe("DONE");
      const money = await moneyTrail();
      expect(money.kinds, "在一笔已结算的预扣上又开了一张退款").toEqual(["RESERVE", "SETTLE"]);
      expect(money.balance).toBe(START - HOLD); // 那笔钱确实还在平台这边
      expect(spy.mock.calls.flat().join(" ")).toContain("paid for nothing"); // 交给人看
    } finally {
      spy.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("别人已经退过的那一行 → 翻成 FAILED,但不吞别家的退款(不多开第二张)", async () => {
    await seedDoneEmpty({ settled: false, refunded: true });

    await reapStaleGenJobs();
    expect((await jobRow()).status).toBe("FAILED");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
    expect(money.reasons, "把别家写的那笔退款算成了自己的").not.toContain("gen:done-without-output");
    expect(money.balance).toBe(START);
  }, DB_CASE_TIMEOUT_MS);

  it("宽限期之内的那一行 → 不碰(巡检不该是第一个注意到一行的人)", async () => {
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
        status: "DONE", generationIds: [], spent: true, progress: 100, startedAt: new Date(), finishedAt: new Date(),
      },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));

    await reapStaleGenJobs();
    expect((await jobRow()).status).toBe("DONE");
    expect((await moneyTrail()).kinds).toEqual(["RESERVE"]);
  }, DB_CASE_TIMEOUT_MS);

  it("商家自己取消掉的那一行 → 巡检认不出它、也改不动它(CANCELLED 不是 DONE)", async () => {
    // 取消与自愈是两条同时在跑的路。取消写 CANCELLED + 退款;巡检的扫描与条件写都只认 DONE,
    // 所以它连这一行都选不到 —— 商家关于自己那次决定的真相不会被改写成别的词。
    await prisma.genJob.create({
      data: {
        id: jobId, ownerId: orgId, projectId, prompt: "a clip", kind: "VIDEO", model: "seedance-2-mini", count: 1,
        status: "CANCELLED", generationIds: [], progress: 0,
        startedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
        finishedAt: new Date(Date.now() - GEN_DONE_EMPTY_GRACE_MS - 60_000),
      },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId: jobId }));

    await reapStaleGenJobs();
    expect((await jobRow()).status).toBe("CANCELLED");
    expect((await moneyTrail()).kinds).toEqual(["RESERVE", "REFUND"]);
  }, DB_CASE_TIMEOUT_MS);
});
