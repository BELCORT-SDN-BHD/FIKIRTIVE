/**
 * gen-receipt-db.test.ts —— #776 回执落库 vs 钱路,在**真库**上、用**真失败**证。
 *
 * 为什么必须有这个文件(r1 判词 P2-3 的原话是「假绿」,而它说得对):`gen-receipt.test.ts` 把
 * Prisma 和 `$transaction` 全 mock 了,于是所谓「回执不影响结算」只是比较了两个**成功**场景
 * 的调用次数 —— 一次都没让回执真的写失败过。一个永远不会失败的 mock 证明不了失败时会怎样。
 *
 * 这里跑真的 `handleGen`、真的 Postgres、真的 `reserveCredits/settleCredits`(只 mock 掉付费
 * 引擎和对象存储),然后**注入真实的写失败**,断言商家和毛利同时被保住:
 *
 *   ① 回执列写失败 ⇒ 生成照常交付(DONE + 产出行在库里)、钱照常且**只**结算一次、
 *      两列留 null = 未知。回执是记账,它没有否决交付与扣费的权力;
 *   ② 引擎报回一个**存不下**的数(`billedUnits` 是 PostgreSQL `INTEGER`)同样如此 ——
 *      这不是假想:这两个值来自引擎的响应,是我们不控制的输入;
 *   ③ 正常那一路,两列**确实**落库(否则「不影响钱路」可以靠什么都不写来通过)。
 *
 * 失败怎么注入:临时给 `GenJob."billedUnits"` / `Generation."finalPromptText"` 加一条
 * `CHECK (… IS NULL)` 约束,于是任何回执写入都会被数据库真实拒绝。用完在 finally 里删掉;
 * 加之前也先 DROP IF EXISTS —— 上一轮如果被超时打断,残留的约束不该让下一轮报一个与被测
 * 行为无关的错。它只作用于本用例、本测试库,不碰迁移、不碰生产 schema。
 *
 * 超时给足 60s:这里每条用例都要建租户、真预扣、跑完整条 handleGen(含画布结算的顾问锁),
 * 在跑满的机器上会远超 vitest 默认的 5s。默认值是给纯函数用例定的,不是给这一类用的。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

// 只 mock 两件事:付费引擎(绝不真调用)和对象存储(不需要真 R2)。库、钱、事务全是真的。
const m = vi.hoisted(() => ({
  generateImages: vi.fn(),
  generateVideo: vi.fn(),
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../generation.js", () => ({ provider: { name: "byteplus", generate: m.generateImages, generateVideo: m.generateVideo } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));

import { prisma, reserveCredits } from "@fikirtive/db";
import { handleGen } from "./gen.js";

// 同 apps/web 与其它 worker 真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const HOLD = 1_000; // 这一单预扣的内部信用点,金额本身不重要,**扣了几次**才重要

let orgId: string;
let projectId: string;
let jobId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // 先把连接池和 query engine 的冷启动付掉
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  // 内容寻址:每次 put 给一个不同的哈希,多产出才会真写出多行
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));

  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  jobId = `gen_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: 100_000, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Receipt reconciliation" } });
  await prisma.genJob.create({
    data: { id: jobId, ownerId: orgId, projectId, prompt: "a poster for the weekend sale", kind: "IMAGE", model: "seedream", count: 1, status: "QUEUED" },
  });
  // 真的预扣 —— 没有 RESERVE 行,settleCredits 会直接返回,那样「只结算一次」就成了空话。
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 这一单在钱上留下的全部痕迹 —— 张数,不是文字。 */
async function moneyTrail() {
  const ledger = await prisma.creditLedger.findMany({ where: { orgId, refId: jobId }, select: { kind: true }, orderBy: { createdAt: "asc" } });
  const account = await prisma.creditAccount.findFirst({ where: { orgId }, select: { balance: true, reserved: true } });
  return { kinds: ledger.map((r) => r.kind), balance: account!.balance, reserved: account!.reserved };
}

async function jobRow() {
  return prisma.genJob.findFirstOrThrow({ where: { id: jobId, ownerId: orgId }, select: { status: true, spent: true, spentUsd: true, billedUnits: true, generationIds: true } });
}

/** 临时把回执列变成「只能写 null」,于是任何回执写入都被数据库真实拒绝。
 *  `NOT VALID` = 不回头检查既有行(别的用例留下的回执行不该让这一条挂掉),但**新写入照查**
 *  —— 我们要注入的正是新写入的失败。 */
async function withReceiptWritesFailing(fn: () => Promise<void>) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "GenJob" DROP CONSTRAINT IF EXISTS p776_billed_units_fault`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Generation" DROP CONSTRAINT IF EXISTS p776_final_prompt_fault`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GenJob" ADD CONSTRAINT p776_billed_units_fault CHECK ("billedUnits" IS NULL) NOT VALID`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Generation" ADD CONSTRAINT p776_final_prompt_fault CHECK ("finalPromptText" IS NULL) NOT VALID`);
  try {
    await fn();
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "GenJob" DROP CONSTRAINT IF EXISTS p776_billed_units_fault`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Generation" DROP CONSTRAINT IF EXISTS p776_final_prompt_fault`);
  }
}

describe("#776 回执写失败,钱路与交付不受影响(真库,真失败)", () => {
  it("正常一路:两列确实落库,钱只结算一次", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1, 2, 3]), ext: "png", receipt: { billedUnits: 1, finalPrompt: "a bright poster, weekend sale, bold type" } },
    ]);

    await handleGen({ genJobId: jobId }, 0);

    const job = await jobRow();
    expect(job.status).toBe("DONE");
    expect(job.billedUnits).toBe(1); // 图片按**张**:一张 = 1(不是 16,384 个像素 token)
    const gens = await prisma.generation.findMany({ where: { id: { in: job.generationIds }, ownerId: orgId }, select: { promptText: true, finalPromptText: true, sentPromptText: true } });
    expect(gens).toHaveLength(1);
    expect(gens[0]!.finalPromptText).toBe("a bright poster, weekend sale, bold type");
    expect(gens[0]!.promptText).toBe("a poster for the weekend sale"); // 商家自己那句原封不动
    // #914 r4:我们实际交给引擎的那一句,在**真库**上确实落进了同一行 —— 断言的是
    // 「引擎真正收到的那个字符串」,不是测试自己重算的期望值。
    expect(gens[0]!.sentPromptText).toBe((m.generateImages.mock.calls[0]![0] as { prompt: string }).prompt);
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]); // 一预扣一结算,没有第三笔
    expect(money.reserved).toBe(0);
    expect(money.balance).toBe(100_000 - HOLD);
  }, DB_CASE_TIMEOUT_MS);

  it("回执列写入被数据库拒绝 ⇒ 生成照常交付、只结算一次、两列如实留 null", async () => {
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1, 2, 3]), ext: "png", receipt: { billedUnits: 1, finalPrompt: "a bright poster, weekend sale, bold type" } },
    ]);

    await withReceiptWritesFailing(async () => {
      await handleGen({ genJobId: jobId }, 0);
    });

    const job = await jobRow();
    // ① 交付没被拖倒 —— 这正是 r1 的病灶:回执在事务里,写不进去就回滚掉一单已经付过钱的生成
    expect(job.status).toBe("DONE");
    expect(job.generationIds).toHaveLength(1);
    const gens = await prisma.generation.findMany({ where: { id: { in: job.generationIds }, ownerId: orgId }, select: { finalPromptText: true } });
    expect(gens).toHaveLength(1);
    // ② 记账列如实留空 = 未知。不知道就是不知道,不编,也不拿商家那句话冒充
    expect(job.billedUnits).toBeNull();
    expect(gens[0]!.finalPromptText).toBeNull();
    // ③ 钱一分不多不少,且只动过一次
    expect(job.spent).toBe(true);
    expect(typeof job.spentUsd).toBe("number");
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]); // 没有第二次 SETTLE,也没有 REFUND
    expect(money.reserved).toBe(0);
    expect(money.balance).toBe(100_000 - HOLD);
  }, DB_CASE_TIMEOUT_MS);

  it("引擎报回一个 INTEGER 存不下的计费量 ⇒ 同样只是未知,不是一单丢掉的生成", async () => {
    // 2^31 —— 比 PostgreSQL INTEGER 的上限大 1。这两个值来自引擎的响应,是我们不控制的输入;
    // 下面那条 raw 写入就是**证据**:这一列真的存不下它,失败是真的,不是假想出来的。
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "GenJob" SET "billedUnits" = 2147483648 WHERE id = $1`, jobId),
    ).rejects.toThrow();

    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1, 2, 3]), ext: "png", receipt: { billedUnits: 2_147_483_648 } },
    ]);

    await handleGen({ genJobId: jobId }, 0);

    const job = await jobRow();
    expect(job.status).toBe("DONE");
    expect(job.generationIds).toHaveLength(1);
    expect(job.billedUnits).toBeNull();
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]);
    expect(money.balance).toBe(100_000 - HOLD);
  }, DB_CASE_TIMEOUT_MS);

  it("多张图里只有一张报了量 ⇒ 整单未知,而每张自己那句提示词各归各行", async () => {
    await prisma.genJob.updateMany({ where: { id: jobId, ownerId: orgId }, data: { count: 2 } });
    m.generateImages.mockResolvedValue([
      { bytes: new Uint8Array([1]), ext: "png", receipt: { billedUnits: 1, finalPrompt: "first rewrite" } },
      { bytes: new Uint8Array([2]), ext: "png", receipt: { finalPrompt: "second rewrite" } },
    ]);

    await handleGen({ genJobId: jobId }, 0);

    const job = await jobRow();
    expect(job.status).toBe("DONE");
    // 半份求和是一个**偏低**的成本,挨着 spentUsd 躺着会被当成可对账的数 —— 宁可空着
    expect(job.billedUnits).toBeNull();
    const gens = await prisma.generation.findMany({ where: { id: { in: job.generationIds }, ownerId: orgId }, select: { id: true, finalPromptText: true } });
    const byId = new Map(gens.map((g) => [g.id, g.finalPromptText]));
    expect(job.generationIds.map((id) => byId.get(id))).toEqual(["first rewrite", "second rewrite"]);
    const money = await moneyTrail();
    expect(money.kinds).toEqual(["RESERVE", "SETTLE"]);
  }, DB_CASE_TIMEOUT_MS);
});
