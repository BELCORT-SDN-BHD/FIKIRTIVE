/**
 * gen-unconfigured-provider-db.test.ts — C1b ①:**生产部署没接引擎时,商家一分钱都不该留在坑里**。
 * 真库、真 `reserveCredits`、真 `refundReservation`、真 `handleGen`,以及**真的工厂**。
 *
 * 病灶(改动前):`GENERATION_PROVIDER` 缺失时 `createGenerationProvider()` 回的是离线 mock。
 * 生产上这意味着 worker 把一张 8×8 纯色 PNG 当作商家的成片存下来、交付、并且**结算**那笔预扣。
 * 商家付全价买到一块色卡,系统里没有任何一处说过这件事。旧注释说这是「安全默认,配错的生产不会
 * 偷偷烧钱」——它保住的是我们的钱,花掉的是商家的钱。
 *
 * 为什么这条必须跑真库(而不是像 `gen-reference-person.test.ts` 那样 mock 掉 Prisma):
 * 本票的主张是**钱的净额**,不是「某个函数被调用过」。`refundReservation` 被调用一次,和账户
 * 余额真的回到原位、台账上 RESERVE 后面真的跟着一笔 REFUND,是两个不同强度的主张;mock 只能
 * 证前者。这里断言的是后者——余额、reserved、以及台账那几行的**种类与条数**。
 *
 * 也不 mock 工厂本身:`provider` 由**真的** `createGenerationProvider({ NODE_ENV: "production" })`
 * 产出。这样这一条同时钉住两件事——工厂在生产缺配置时确实交出拒绝端口,以及那个拒绝端口抛出的
 * 错误确实走通了 worker 既有的终结退款那一路。任一边改坏,这里就红。
 *
 * 只 mock 两件与本主张无关的外设:对象存储(不需要真 R2)与模型注册表。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { GENERATION_ENGINE_UNAVAILABLE, merchantGenFailureReason } from "@fikirtive/core";

const m = vi.hoisted(() => ({
  storagePut: vi.fn(),
  storagePresignedGet: vi.fn(),
}));
vi.mock("../storage.js", () => ({ storage: { put: m.storagePut, presignedGet: m.storagePresignedGet } }));
vi.mock("../model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set<string>()) }));
// 真工厂,生产环境,变量缺失 —— 与一个丢了 GENERATION_PROVIDER 的 Railway 部署同一形状。
// `apps/worker/src/generation.ts` 在 import 期读 `process.env`,所以这里只能整模块替换;
// 替换进去的仍然是**真实现**的产物,不是一个手写的假端口。
vi.mock("../generation.js", async () => {
  const { createGenerationProvider } = await import("@fikirtive/generation");
  return { provider: createGenerationProvider({ NODE_ENV: "production" } as NodeJS.ProcessEnv) };
});

import { prisma, reserveCredits } from "@fikirtive/db";
import { handleGen } from "./gen.js";

const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
/** 这一单预扣多少并不重要;**结束时净额是不是 0** 才是本文件的全部。 */
const HOLD = 1_000;
const START_BALANCE = 100_000;

let orgId: string;
let projectId: string;
let jobId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  m.storagePresignedGet.mockImplementation(async (key: string) => `url:${key}`);
  m.storagePut.mockImplementation(async () => ({ contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) }));

  orgId = `org_${randomUUID()}`;
  projectId = `prj_${randomUUID()}`;
  jobId = `gen_${randomUUID()}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: START_BALANCE, reserved: 0 } });
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Engine-less deploy" } });
  await prisma.genJob.create({
    data: { id: jobId, ownerId: orgId, projectId, prompt: "a poster for the weekend sale", kind: "IMAGE", model: "seedream", count: 1, status: "QUEUED" },
  });
  // 真预扣。没有这一行,「全额退回」就退了个空气,断言也就什么都没证。
  await prisma.$transaction((tx) => reserveCredits(tx, { orgId, refId: jobId, cost: HOLD }));
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 这一单在钱上留下的全部痕迹。种类与条数,不是文字。 */
async function moneyTrail() {
  const ledger = await prisma.creditLedger.findMany({
    where: { orgId, refId: jobId },
    select: { kind: true, balanceDelta: true, reservedDelta: true },
    orderBy: { createdAt: "asc" },
  });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return {
    kinds: ledger.map((r) => r.kind),
    // 台账自己的净额,与账户余额分开算:两边都必须是 0,否则就是账户对了而台账在骗人(或反过来)。
    netBalanceDelta: ledger.reduce((sum, r) => sum + r.balanceDelta, 0),
    netReservedDelta: ledger.reduce((sum, r) => sum + r.reservedDelta, 0),
    balance: account.balance,
    reserved: account.reserved,
  };
}

async function jobRow() {
  return prisma.genJob.findFirstOrThrow({
    where: { id: jobId, ownerId: orgId },
    select: { status: true, error: true, spent: true, spentUsd: true, generationIds: true },
  });
}

describe("C1b ① 生产缺配置:生成被拒,预留全退,台账无净扣", () => {
  it("预留全额退回 —— 余额回到原位,reserved 归零,台账只有 RESERVE + REFUND", async () => {
    await expect(handleGen({ genJobId: jobId }, 0)).rejects.toThrow();

    const money = await moneyTrail();
    // 净额为 0:这就是「商家没为一块色卡付钱」的全部含义。
    expect(money.balance).toBe(START_BALANCE);
    expect(money.reserved).toBe(0);
    // 台账自己也必须净额为 0 —— 账户余额对得上、台账却少一笔,是另一种骗人。
    expect(money.netBalanceDelta).toBe(0);
    expect(money.netReservedDelta).toBe(0);
    // 一预扣一退回,没有第三笔,尤其**没有 SETTLE** —— 旧行为正是在这里悄悄结算掉的。
    expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
  }, DB_CASE_TIMEOUT_MS);

  it("绝不交付假产物 —— 一个 Generation 行都不该存在", async () => {
    await expect(handleGen({ genJobId: jobId }, 0)).rejects.toThrow();

    const job = await jobRow();
    expect(job.status).toBe("FAILED");
    expect(job.generationIds).toEqual([]);
    expect(await prisma.generation.count({ where: { ownerId: orgId } })).toBe(0);
    // 一次都没往存储里写:没有引擎就没有字节,连色卡都不该被存下来。
    expect(m.storagePut).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("没花过钱就不记成花过 —— spent 假、spentUsd 空", async () => {
    await expect(handleGen({ genJobId: jobId }, 0)).rejects.toThrow();

    const job = await jobRow();
    // 请求从未离开过我们的机房,所以它可证明地免费。记成 spent 会在毛利账上凭空造出一笔 COGS,
    // 并且在同一口气里把「You weren't charged」变成假话。
    expect(job.spent).toBe(false);
    expect(job.spentUsd).toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("第一次就终结 —— 不让商家把重试预算耗完再听同一句话", async () => {
    // retryCount 0。旧的匿名错误会走可重试分支,商家要等完整个重试预算才拿到答案,
    // 而这个答案在部署被人修好之前每一次都一样。
    await expect(handleGen({ genJobId: jobId }, 0)).rejects.toThrow();
    expect((await jobRow()).status).toBe("FAILED");
  }, DB_CASE_TIMEOUT_MS);

  it("落库的那句话逐字命中白名单 —— 卡面读回来就是商家该读的那一句", async () => {
    await expect(handleGen({ genJobId: jobId }, 0)).rejects.toThrow();

    const job = await jobRow();
    // 逐字。`merchantGenFailureMessage` 是按字节比对的白名单:差一个字符,卡面就退回
    // 「你可以再试一次」——而那正是这次改动要消灭的那句错误建议。
    expect(job.error).toBe(GENERATION_ENGINE_UNAVAILABLE);
    expect(merchantGenFailureReason(job.error)).toBe("engineUnavailable");
    // 白牌:商家读到的那一句里没有任何运维诊断。
    for (const leak of ["GENERATION_PROVIDER", "unset", "unconfigured", "mock", "env"]) {
      expect(job.error.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  }, DB_CASE_TIMEOUT_MS);
});
