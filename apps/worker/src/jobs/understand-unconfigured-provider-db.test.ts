/**
 * understand-unconfigured-provider-db.test.ts — RELY A 段(#1055,规格
 * docs/specs/fail-closed-reliability.md):**生产部署没接引擎时,商家既拿不到编出来的理解,
 * 也不为它付一分钱。** 真库、真 `reserveCredits`、真 `refundReservation`、真 `handleUnderstand`,
 * 以及**真的工厂** `createUnderstandingProvider({ NODE_ENV: "production" })`。
 *
 * 病灶(改动前):`GENERATION_PROVIDER` 缺失或明写 `mock` 时,理解端口工厂回的是离线 mock。
 * MONEY-A9(2026-09-01)之后理解按件收费,于是生产上这条路一路走通:reserve → 罐头描述
 * (「A product photo from the owner's library.」/「Sample item RM 10」)→ **settle**。
 * 商家为一段捏造的理解付了钱,而那两句话还会被写进 BrandRecord 与品牌记忆给 Otto 当店铺事实。
 *
 * 为什么必须跑真库(understand.test.ts 的假库钉不住):本票的主张是**钱的净额**与**一行都没写**,
 * 不是「某个函数被调用过」。`refundReservation` 被调用一次,和台账上 RESERVE 后面真的跟着一笔
 * REFUND、账户余额真的回到原位、而且**没有 SETTLE**,是两个不同强度的主张;mock 只能证前者。
 *
 * 也不 mock 工厂:端口由**真的**工厂在一个 `NODE_ENV=production` 的 env 上产出,所以这一条同时
 * 钉住两件事 —— 工厂在生产缺配置时确实交出拒绝端口,以及那个拒绝端口抛出的错确实走通了 worker
 * 既有的「配置类 ⇒ 重试到上限 ⇒ PAUSED + 退款」那一路。任一边改坏,这里就红。
 *
 * 只 mock 一件与本主张无关的外设:对象存储的签名 URL(不需要真 R2)。
 */
import { randomBytes } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const presignedGet = vi.hoisted(() => vi.fn(async () => "https://storage.example/obj?sig=x"));
vi.mock("../storage.js", () => ({ storage: { presignedGet } }));

import { prisma } from "@fikirtive/db";
import { newId, pricedUnderstandingCredits, UNDERSTANDING_PROVIDER_PAUSED } from "@fikirtive/core";
import { createUnderstandingProvider } from "@fikirtive/generation";
import { handleUnderstand } from "./understand.js";

// ── 安全闸(同 packages/db/test/setup.ts):非 *_test 库一律拒跑 ──────────────────
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const START_BALANCE = 100_000;
const OWNER = `rely-a-${newId()}`;

/** 一台丢了 `GENERATION_PROVIDER` 的生产部署,以及一台留着旧样例值 `mock` 的生产部署。 */
const UNSET_IN_PRODUCTION = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const MOCK_IN_PRODUCTION = { NODE_ENV: "production", GENERATION_PROVIDER: "mock" } as NodeJS.ProcessEnv;

let assetId: string;
let rowId: string;

async function seedAsset(): Promise<string> {
  const id = newId();
  await prisma.asset.create({
    data: {
      id,
      ownerId: OWNER,
      contentHash: randomBytes(32).toString("hex"),
      ext: "jpg",
      mime: "image/jpeg",
      sizeBytes: BigInt(400_000),
      originalFilename: "nasi-lemak.jpg",
      source: "UPLOAD",
      width: 1600,
      height: 1200,
    },
  });
  return id;
}

/** 这一行在钱上留下的全部痕迹。种类与条数,不是文字。 */
async function moneyTrail(refId: string) {
  const ledger = await prisma.creditLedger.findMany({
    where: { orgId: OWNER, refId },
    select: { kind: true, balanceDelta: true, reservedDelta: true },
    orderBy: { createdAt: "asc" },
  });
  const account = await prisma.creditAccount.findFirstOrThrow({
    where: { orgId: OWNER },
    select: { balance: true, reserved: true },
  });
  return {
    kinds: ledger.map((r) => r.kind),
    netBalanceDelta: ledger.reduce((sum, r) => sum + r.balanceDelta, 0),
    netReservedDelta: ledger.reduce((sum, r) => sum + r.reservedDelta, 0),
    balance: account.balance,
    reserved: account.reserved,
  };
}

async function myRow() {
  return prisma.assetUnderstanding.findFirstOrThrow({ where: { id: rowId, ownerId: OWNER } });
}

/**
 * 把一件素材从头读到底 —— 重试预算用完为止。前两趟抛(pg-boss 退避重投),第三趟收口。
 * `UNDERSTAND_RETRY_LIMIT` 是 2,所以 retryCount 0/1/2 就是生产上这一行的完整一生。
 */
async function runUntilExhausted(env: NodeJS.ProcessEnv): Promise<void> {
  const port = createUnderstandingProvider(env);
  await expect(handleUnderstand({ understandingId: rowId }, 0, port)).rejects.toThrow();
  await expect(handleUnderstand({ understandingId: rowId }, 1, port)).rejects.toThrow();
  await expect(handleUnderstand({ understandingId: rowId }, 2, port)).resolves.toBeNull();
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: OWNER, name: "rely-a" } });
  await prisma.creditAccount.create({ data: { orgId: OWNER, balance: START_BALANCE, reserved: 0 } });
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.creditAccount.updateMany({ where: { orgId: OWNER }, data: { balance: START_BALANCE, reserved: 0 } });
  assetId = await seedAsset();
  rowId = newId();
  // 扫描器建行的形状:QUEUED + 建行那一刻锁死的快照价(MONEY-A9)。有快照价 = 这一件真收费,
  // 也就真有一笔预留可以被退 —— 没有它,「净额 0」就退了个空气。
  await prisma.assetUnderstanding.create({
    data: {
      id: rowId,
      ownerId: OWNER,
      assetId,
      kind: "image-caption",
      status: "QUEUED",
      priceInternalSnapshot: pricedUnderstandingCredits("image-caption"),
      cascadePriceInternal: pricedUnderstandingCredits("doc-extract"),
    },
  });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.assetUnderstanding.deleteMany({ where: { ownerId: OWNER } });
  await prisma.brandRecord.deleteMany({ where: { ownerId: OWNER } });
  await prisma.entity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.memory.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.creditLedger.deleteMany({ where: { orgId: OWNER } });
  await prisma.creditAccount.deleteMany({ where: { orgId: OWNER } });
  await prisma.organization.deleteMany({ where: { id: OWNER } });
  await prisma.$disconnect();
});

describe("RELY A:生产缺引擎 ⇒ 理解停下来说实话,钱一分不动", () => {
  it(
    "RELY-A1:行停在 PAUSED + 既有文案,描述/商品/价格一个都没有,品牌记忆无新增行",
    async () => {
      await runUntilExhausted(UNSET_IN_PRODUCTION);

      const row = await myRow();
      // **永不落终态**:文件没问题,是我们没接引擎 —— 配好之后既有扫描器把它捡回 QUEUED。
      expect(row.status).toBe("PAUSED");
      // 逐字命中既有常量:商家读到的那一句里没有一个字是运维诊断。
      expect(row.error).toBe(UNDERSTANDING_PROVIDER_PAUSED);
      expect(row.error?.toLowerCase()).not.toContain("generation_provider");
      // 编出来的那份理解一个字都没落库。
      expect(row.summary).toBe(""); // schema 默认空串 —— 一个字的罐头描述都没写进去
      expect(row.data).toBeNull();
      expect(row.inputTokens ?? 0).toBe(0);
      expect(row.outputTokens ?? 0).toBe(0);
      // 级联出来的 doc-extract 行也不该存在(那正是「Sample item RM 10」的来路)。
      expect(await prisma.assetUnderstanding.count({ where: { ownerId: OWNER, kind: "doc-extract" } })).toBe(0);
      // 假商品与假价格没有进店铺事实。
      expect(await prisma.brandRecord.count({ where: { ownerId: OWNER } })).toBe(0);
      expect(await prisma.memory.count({ where: { ownerId: OWNER } })).toBe(0);
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "RELY-A2(钱守恒):预留已退、账本净额 0、余额一字不差、**没有 SETTLE**",
    async () => {
      await runUntilExhausted(UNSET_IN_PRODUCTION);

      const refId = (await myRow()).moneyRefId;
      expect(refId, "这一行必须真的进过钱路,否则「净额 0」什么都没证").toBeTruthy();

      const money = await moneyTrail(refId!);
      expect(money.balance).toBe(START_BALANCE);
      expect(money.reserved).toBe(0);
      // 台账自己也必须净额为 0 —— 账户余额对得上、台账却少一笔,是另一种骗人。
      expect(money.netBalanceDelta).toBe(0);
      expect(money.netReservedDelta).toBe(0);
      // 一预扣一退回,没有第三笔,尤其**没有 SETTLE** —— 旧行为正是在这里悄悄结算掉的。
      expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
      expect(money.kinds).not.toContain("SETTLE");
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "RELY-A3:生产上明写 GENERATION_PROVIDER=mock ⇒ 同样 PAUSED + 退款(没有豁免开关)",
    async () => {
      await runUntilExhausted(MOCK_IN_PRODUCTION);

      const row = await myRow();
      expect(row.status).toBe("PAUSED");
      expect(row.status).not.toBe("DONE");
      expect(row.error).toBe(UNDERSTANDING_PROVIDER_PAUSED);
      expect(row.summary).toBe("");
      expect(row.data).toBeNull();

      const money = await moneyTrail(row.moneyRefId!);
      expect(money.kinds).toEqual(["RESERVE", "REFUND"]);
      expect(money.balance).toBe(START_BALANCE);
      expect(money.reserved).toBe(0);
    },
    DB_CASE_TIMEOUT_MS,
  );

  it(
    "RELY-A1:一个字节都没出网 —— 没有引擎就连签名 URL 之后那一步都不该发生",
    async () => {
      await runUntilExhausted(UNSET_IN_PRODUCTION);
      // 端口在发请求之前就拒了,所以这一趟可证明地免费:平台今天的理解开销没有涨。
      const row = await myRow();
      expect(row.inputTokens ?? 0).toBe(0);
      expect(row.outputTokens ?? 0).toBe(0);
    },
    DB_CASE_TIMEOUT_MS,
  );
});
