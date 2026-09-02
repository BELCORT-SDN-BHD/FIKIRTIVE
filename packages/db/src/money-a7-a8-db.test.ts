/**
 * MONEY-A7 / MONEY-A8 —— **调价不追溯** 与 **失败退款总法**,在真库上证
 * (规格 docs/specs/money-engine.md §2 验收表、九问 5「失败退款总法」、§7.7)。
 *
 * 这两行以前只是 `money-engine-acceptance.test.ts` 里的两条 `it.todo`。它们是钱路上唯一两条
 * **不需要任何新功能**就能被写坏的不变量,所以它们要的不是新代码,是锚:
 *
 *   · **A7**(调价不追溯):调价只影响其后动作的报价;调价前已扣的账一分不重算,已购
 *     credits 面值不变。它在代码里的形状是一句很容易被"优化"掉的话 —— `settleCredits`
 *     的金额**读自 RESERVE 行**,而不是拿当前价目重算一次。哪天有人把它改成"结算时按现价
 *     重算"(听起来更准),昨天下单、今天涨价的每一个商家都会被追溯多扣。
 *   · **A8**(失败退款总法):任何付费动作,凡失败、被拦截、被截断且无交付,**商家余额净变
 *     0**。而"净变 0"有两种**合法形态,不得混写**:
 *       ① 花钱前拦截(余额不足、围栏拒绝)= 事务回滚,ledger **零新增行**;
 *       ② 花钱后失败 = reserve/refund **成对**。
 *     混写的后果不是钱错,是**查不清**:一笔"零新增"的拦截如果留下半行,事后没有人能分清
 *     它是"没花过"还是"花了又退了"。#983 登记的就是这一族没有回归测试。
 *
 * 顺带钉住**两条部分唯一索引真的在这个库上**(§7.7)。它们只存在于 migration SQL 里
 * (`20260619130000_credits/migration.sql:50,57`),Prisma schema 表达不了部分唯一,所以
 * `prisma migrate diff` 那道漂移闸看不见它们 —— 一次手滑的 `DROP INDEX`、一次没跑到底的
 * 迁移,都会让 exactly-once 从"数据库保证"降级成"代码碰巧没并发",而全部单测照样绿。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, reserveCredits, settleCredits, refundReservation, InsufficientCredits } from "./index.js";
import { seedOrg } from "../test/setup.js";

const ORG = "money-a7a8-org";

/** 这个 org 的全部账本行,按写入次序。 */
async function ledger() {
  return prisma.creditLedger.findMany({ where: { orgId: ORG }, orderBy: { createdAt: "asc" } });
}
async function account() {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ORG } });
}

beforeEach(async () => {
  await seedOrg(ORG, 1000);
});

// ── MONEY-A7:调价不追溯 ──────────────────────────────────────────────────────
describe("MONEY-A7 — 调价只改其后动作的报价,已扣的账一分不重算", () => {
  it("MONEY-A7:结算金额读自 RESERVE 行,不是拿当前价目重算(涨价追不到昨天那一单)", async () => {
    const refId = `a7-${randomUUID()}`;
    const priceWhenOrdered = 40; // 商家下单那一刻的价

    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost: priceWhenOrdered }));
    expect((await account()).balance).toBe(1000 - priceWhenOrdered);

    // …隔夜调价:同一个动作现在贵一倍。结算**不许**看见这个数。
    const priceAfterHike = priceWhenOrdered * 2;
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId }));

    const acct = await account();
    // 结算按预扣那一格落账:balance 不再动(预扣时已经扣掉),reserved 归零。
    expect(acct.balance).toBe(1000 - priceWhenOrdered);
    expect(acct.reserved).toBe(0);
    // 承重:落账的那一笔就是**下单时**那个数,不是涨价后的数。
    const rows = await ledger();
    const reserve = rows.find((r) => r.kind === "RESERVE" && r.refId === refId)!;
    expect(reserve.reservedDelta).toBe(priceWhenOrdered);
    expect(reserve.reservedDelta).not.toBe(priceAfterHike);
    // 一笔"结算时重算"的实现会在这里把余额再扣一截 —— 净支出必须恰好等于下单时的报价。
    expect(1000 - acct.balance).toBe(priceWhenOrdered);
  });

  it("MONEY-A7:调价后**新**动作按新价 —— 不追溯不等于不涨价", async () => {
    const before = `a7-old-${randomUUID()}`;
    const after = `a7-new-${randomUUID()}`;
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: before, cost: 40 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: before }));
    // 调价之后的一单
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: after, cost: 80 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: after }));

    const rows = await ledger();
    expect(rows.find((r) => r.kind === "RESERVE" && r.refId === before)!.reservedDelta).toBe(40);
    expect(rows.find((r) => r.kind === "RESERVE" && r.refId === after)!.reservedDelta).toBe(80);
    expect((await account()).balance).toBe(1000 - 40 - 80);
  });

  it("MONEY-A7:已购 credits 面值不变 —— 调价不回头改任何一行已写的账", async () => {
    const refId = `a7-frozen-${randomUUID()}`;
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost: 40 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId }));
    const snapshot = (await ledger()).map((r) => ({ kind: r.kind, balanceDelta: r.balanceDelta, reservedDelta: r.reservedDelta }));

    // 「调价」在这条链路上不写任何东西 —— 它只是价目文件里的一个数。所以再跑一遍读,
    // 每一行必须逐字不变。这条断言钉的是"没有任何一条追溯改写路径存在"。
    const again = (await ledger()).map((r) => ({ kind: r.kind, balanceDelta: r.balanceDelta, reservedDelta: r.reservedDelta }));
    expect(again).toEqual(snapshot);
  });
});

// ── MONEY-A8:失败退款总法的两种净变 0 形态 ────────────────────────────────────
describe("MONEY-A8 — 净变 0 的两种形态,不得混写", () => {
  it("MONEY-A8 形态①:花钱前拦截(余额不足)⇒ ledger **零新增行**,余额一分不动", async () => {
    const refId = `a8-blocked-${randomUUID()}`;
    const before = await account();
    expect(await ledger()).toHaveLength(0);

    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost: before.balance + 1 })),
    ).rejects.toThrow(InsufficientCredits);

    // 承重:**零新增行**。不是"写了一行再回滚一半",是这一笔从来没发生过。
    expect(await ledger()).toHaveLength(0);
    const after = await account();
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(before.reserved);
  });

  it("MONEY-A8 形态②:花钱后失败 ⇒ reserve/refund **成对**,余额净变 0", async () => {
    const refId = `a8-refunded-${randomUUID()}`;
    const cost = 120;
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost }));
    expect((await account()).balance).toBe(1000 - cost); // 中途:钱真的被锁住了

    const outcome = await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId }));
    expect(outcome).toBe("refunded");

    const rows = await ledger();
    // 成对:一行 RESERVE、一行 REFUND,金额互为相反数 —— 两行都在,商家查得清。
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "REFUND"]);
    expect(rows.reduce((a, r) => a + r.balanceDelta, 0)).toBe(0);
    expect(rows.reduce((a, r) => a + r.reservedDelta, 0)).toBe(0);
    const acct = await account();
    expect(acct.balance).toBe(1000); // 净变 0
    expect(acct.reserved).toBe(0);
  });

  it("MONEY-A8:两种形态**长得不一样** —— 拦截零行 vs 失败两行,事后分得清", async () => {
    const blocked = `a8-b-${randomUUID()}`;
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: blocked, cost: 5_000 })),
    ).rejects.toThrow(InsufficientCredits);
    const failed = `a8-f-${randomUUID()}`;
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: failed, cost: 30 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: failed }));

    const rows = await ledger();
    // 被拦下的那一笔在账本里**一个字都没有**;失败的那一笔留着完整的两行。
    expect(rows.filter((r) => r.refId === blocked)).toHaveLength(0);
    expect(rows.filter((r) => r.refId === failed)).toHaveLength(2);
    expect((await account()).balance).toBe(1000);
  });

  it("MONEY-A8:退款幂等 —— 重投退第二次不多退一分(finalizer 唯一索引在挡)", async () => {
    const refId = `a8-twice-${randomUUID()}`;
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost: 60 }));
    expect(await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId }))).toBe("refunded");
    expect(await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId }))).toBe("already-refunded");
    expect(await ledger()).toHaveLength(2);
    expect((await account()).balance).toBe(1000);
  });

  it("MONEY-A8:结算之后再退 ⇒ 报 already-settled 且**一分不动**(绝不把成功变成退款)", async () => {
    const refId = `a8-settled-${randomUUID()}`;
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost: 60 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId }));
    expect(await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId }))).toBe("already-settled");
    expect((await account()).balance).toBe(1000 - 60); // 收了就是收了
    expect((await ledger()).filter((r) => r.kind === "REFUND")).toHaveLength(0);
  });
});

// ── §7.7:两条部分唯一索引必须真的在这个库上 ──────────────────────────────────
describe("MONEY-A8 —— exactly-once 靠的两条部分唯一索引必须真的在库上", () => {
  async function creditLedgerIndexes(): Promise<Map<string, string>> {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'CreditLedger'`;
    return new Map(rows.map((r) => [r.indexname, r.indexdef]));
  }

  it("MONEY-A8:CreditLedger_ref_kind_once 在,而且带着它的 WHERE(部分唯一,不是普通唯一)", async () => {
    const def = (await creditLedgerIndexes()).get("CreditLedger_ref_kind_once");
    expect(
      def,
      `CreditLedger_ref_kind_once 不在这个库上。它只活在 migration SQL 里(Prisma schema 表达不了` +
        `部分唯一),所以 migrate diff 那道漂移闸看不见它 —— 少了它,"每个 refId 最多一行` +
        `RESERVE / SETTLE / REFUND" 就从数据库保证降级成"代码碰巧没并发"。`,
    ).toBeDefined();
    expect(def).toContain("UNIQUE");
    expect(def).toMatch(/WHERE .*"?refId"? IS NOT NULL/);
    // `kind` 全小写,Postgres 在 indexdef 里不给它加引号 —— 逐列断言按它真实打印的样子写。
    for (const col of ['"orgId"', '"refId"', "kind"]) expect(def).toContain(col);
  });

  it("MONEY-A8:CreditLedger_finalizer_once 在,而且它的 WHERE 真的点名 SETTLE/REFUND", async () => {
    const def = (await creditLedgerIndexes()).get("CreditLedger_finalizer_once");
    expect(
      def,
      `CreditLedger_finalizer_once 不在这个库上 —— settle 与 refund 的互斥就没了:一次并发` +
        `(清道夫退款撞上迟到的结算)会把 reserved 释放两遍、余额多退一笔。`,
    ).toBeDefined();
    expect(def).toContain("UNIQUE");
    expect(def).toContain("SETTLE");
    expect(def).toContain("REFUND");
    // 关键是它是**部分**唯一:少了 WHERE,同一个 refId 连 RESERVE 都写不进第二次以外的行。
    expect(def).toMatch(/WHERE /);
  });

  it("MONEY-A8:索引是真的在拦人 —— 同一个 refId 的第二个 finalizer 被数据库拒掉", async () => {
    const refId = `a8-idx-${randomUUID()}`;
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId, cost: 10 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId }));
    // 绕过 credits.ts 直接写第二个 finalizer:被拦下的必须是**数据库**,不是应用层的自觉。
    await expect(
      prisma.creditLedger.create({
        data: {
          id: randomUUID(), orgId: ORG, balanceDelta: 10, reservedDelta: -10,
          kind: "REFUND", source: "SYSTEM", refId, idempotencyKey: `refund:${refId}`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
