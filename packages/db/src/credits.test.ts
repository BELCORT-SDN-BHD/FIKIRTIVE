/**
 * Integration tests for the @fikirtive/db credit service.
 * Runs against a real Postgres DB (must be a *_test database — enforced by setup.ts).
 *
 * TDD cases from otto-task-1.3-brief.md.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma, reserveCredits, settleCredits, refundReservation, InsufficientCredits } from "./index.js";
import { seedOrg } from "../test/setup.js";

const ORG = "test-org-1";
const REF = "ref-aaa-001";

// Helper: read the current account state.
async function account(orgId: string) {
  return prisma.creditAccount.findUniqueOrThrow({ where: { orgId } });
}

// Helper: read all ledger rows for an org, ordered by creation.
async function ledger(orgId: string) {
  return prisma.creditLedger.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
}

// Helper: sum balanceDelta or reservedDelta across all ledger rows.
function sumBalance(rows: { balanceDelta: number }[]): number {
  return rows.reduce((acc, r) => acc + r.balanceDelta, 0);
}
function sumReserved(rows: { reservedDelta: number }[]): number {
  return rows.reduce((acc, r) => acc + r.reservedDelta, 0);
}

beforeEach(async () => {
  await seedOrg(ORG, 1000);
});

// ── Case 1: harness smoke ───────────────────────────────────────────────────
describe("case 1 — harness smoke", () => {
  it("seeds an org and reads back the balance", async () => {
    const acc = await account(ORG);
    expect(acc.balance).toBe(1000);
    expect(acc.reserved).toBe(0);
  });
});

// ── Case 2: reserve then settle full (no actualInternal) ───────────────────
describe("case 2 — settle full (GEN path, no actualInternal)", () => {
  it("balance=0 reserved=0 after settle; SETTLE row balanceDelta=0 reservedDelta=-1000", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));

    const afterReserve = await account(ORG);
    expect(afterReserve.balance).toBe(0);
    expect(afterReserve.reserved).toBe(1000);

    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF }));

    const afterSettle = await account(ORG);
    expect(afterSettle.balance).toBe(0);
    expect(afterSettle.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow).toBeDefined();
    expect(settleRow!.balanceDelta).toBe(0);
    expect(settleRow!.reservedDelta).toBe(-1000);
  });
});

// ── Case 3: variable settle actual < reserved ──────────────────────────────
describe("case 3 — variable settle actual < reserved", () => {
  it("charges 300, refunds 700; invariants balance==Σ balanceDelta, reserved==Σ reservedDelta", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(700); // 1000 - 1000 (reserve) + 700 (refund via settle) = 700
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow).toBeDefined();
    expect(settleRow!.balanceDelta).toBe(700);   // B - A = 1000 - 300
    expect(settleRow!.reservedDelta).toBe(-1000); // -B

    // Invariants: balance == Σ balanceDelta, reserved == Σ reservedDelta
    // Starting balance (from seedOrg) is not a ledger row — the seed inserts directly.
    // The invariant here is: net ledger deltas = net change to account from initial seeded values.
    // Initial: balance=1000, reserved=0. Current: balance=700, reserved=0.
    // Net change: balance=-300, reserved=0.
    // Σ balanceDelta = -1000 (RESERVE) + 700 (SETTLE) = -300 ✓
    // Σ reservedDelta = +1000 (RESERVE) - 1000 (SETTLE) = 0 ✓
    expect(sumBalance(rows)).toBe(acc.balance - 1000); // -300
    expect(sumReserved(rows)).toBe(acc.reserved);       // 0
  });
});

// ── Case 4: idempotent double settle ──────────────────────────────────────
describe("case 4 — idempotent double settle", () => {
  it("second settle is a no-op; exactly one SETTLE row; balance unchanged", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(700);
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRows = rows.filter((r) => r.kind === "SETTLE");
    expect(settleRows).toHaveLength(1);
  });
});

// ── Case 5: clamp actual > reserved ───────────────────────────────────────
describe("case 5 — clamp actual > reserved", () => {
  it("actualInternal=5000 with reserve=1000 charges exactly 1000, never more", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 5000 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(0);   // charged exactly 1000 (the full reserve, clamped from 5000)
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow!.balanceDelta).toBe(0);    // B - A = 1000 - 1000 = 0
    expect(settleRow!.reservedDelta).toBe(-1000);
  });
});

// ── Case 6: clamp negative actual ─────────────────────────────────────────
describe("case 6 — clamp negative actual", () => {
  it("actualInternal=-50 charges 0; full balance restored", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: -50 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000); // A=0, B-A=1000 refunded, net balance back to start
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE");
    expect(settleRow!.balanceDelta).toBe(1000);   // B - A = 1000 - 0
    expect(settleRow!.reservedDelta).toBe(-1000);
  });
});

// ── Case 7: finalizer mutual-exclusion (refund wins over settle) ───────────
describe("case 7 — finalizer mutual-exclusion: refund wins", () => {
  it("settle after refund is a no-op; balance fully restored; exactly one finalizer row (REFUND)", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));
    // Settle AFTER refund — should no-op (refund already holds the finalizer slot)
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 300 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000); // fully restored by refund
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const finalizerRows = rows.filter((r) => r.kind === "SETTLE" || r.kind === "REFUND");
    expect(finalizerRows).toHaveLength(1);
    expect(finalizerRows.at(0)?.kind).toBe("REFUND");
  });
});

// ── Case 8: reserve guard — never-negative ────────────────────────────────
describe("case 8 — reserve guard: InsufficientCredits on underfunded reserve", () => {
  it("seed balance=100, reserve 500 → InsufficientCredits; balance unchanged", async () => {
    // Override with a lower balance (beforeEach already seeded 1000; truncate+reseed)
    await prisma.$executeRawUnsafe(`TRUNCATE "CreditLedger", "CreditAccount", "Organization" RESTART IDENTITY CASCADE`);
    await seedOrg(ORG, 100);

    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 500 })),
    ).rejects.toThrow(InsufficientCredits);

    const acc = await account(ORG);
    expect(acc.balance).toBe(100);
    expect(acc.reserved).toBe(0);
  });
});

// ── Case 9: 并发双 reserve —— 防重复扣款的核心防线(审计 2026-07-04 补) ────────
// reserveCredits 的原子条件扣减(WHERE balance >= cost)是"永不双扣/永不负余额"的
// 唯一守卫。这个测试在真库上并发打它:谁要是把它改成"先读后写"或删掉 gte 条件,
// 这里立刻红。
import { grantCredits } from "./index.js";

describe("case 9 — concurrent reserves: only one wins, balance never negative", () => {
  it("two concurrent 700-reserves on a 1000 balance → exactly one succeeds", async () => {
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "race-a", cost: 700 })),
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "race-b", cost: 700 })),
    ]);

    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCredits);

    const acc = await account(ORG);
    expect(acc.balance).toBe(300);   // 1000 - 700, exactly once
    expect(acc.reserved).toBe(700);
    expect(acc.balance).toBeGreaterThanOrEqual(0); // the invariant the WHERE guard exists for

    // 恰一条 RESERVE 账行(输家整个事务回滚,不留痕)
    const rows = await ledger(ORG);
    expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(1);
  });
});

// ── Case 11: 幂等双 refund —— 失败退款只退一次(W-B3-E-P 查漏 2026-07-14 补) ────
// worker 的每条 fail-closed 路(provider 拒/超时/崩溃/取消/reaper)都调 refundReservation;
// 同一 job 可能被多条路先后碰到(取消 + reaper、redelivery + stale 收割)。第二次 refund
// 必须是无账面效果的 no-op —— 谁要是删了 finalizer 唯一索引或 skipDuplicates,这里立刻红。
describe("case 11 — idempotent double refund: a second refund never double-credits", () => {
  it("second refund is a no-op; exactly one REFUND row; balance restored exactly once", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000); // restored once, never twice
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    expect(rows.filter((r) => r.kind === "REFUND")).toHaveLength(1);
    // invariants still hold: net ledger deltas == net account change from the seed
    expect(sumBalance(rows)).toBe(acc.balance - 1000); // 0
    expect(sumReserved(rows)).toBe(acc.reserved); // 0
  });
});

// ── Case 12: finalizer 互斥 —— settle 赢时 refund 必须让路(W-B3-E-P 查漏) ─────
// case 7 证了 refund 赢 → settle 让路;这里证反向:已结算(用户拿到成片、charge 已成永久)
// 的 job,一条迟到的 fail-closed 路再来 refund 必须 no-op —— 否则用户白拿成片还退款。
describe("case 12 — finalizer mutual-exclusion: settle wins, late refund no-ops", () => {
  it("refund after settle is a no-op; the charge is retained; exactly one finalizer row (SETTLE)", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(0); // the settled charge stays charged
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const finalizerRows = rows.filter((r) => r.kind === "SETTLE" || r.kind === "REFUND");
    expect(finalizerRows).toHaveLength(1);
    expect(finalizerRows.at(0)?.kind).toBe("SETTLE");
  });
});

// ── Case 13: 并发 settle ∥ refund —— finalizer 恰一个赢(W-B3-E-P 查漏) ────────
// worker 结算与 reaper/取消退款可以真并发。CreditLedger_finalizer_once 部分唯一索引 +
// createMany(skipDuplicates) 必须保证恰一个 finalizer 落账、另一方零账面效果且不抛错
// (抛错会把调用方整个事务打回滚 —— settleCredits 头注写明的禁忌)。
describe("case 13 — concurrent settle vs refund: exactly one finalizer wins", () => {
  it("both calls complete; exactly one finalizer row; the account matches the winner", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF })),
      prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF })),
    ]);
    // neither path may throw — a thrown P2002 would abort the caller's whole tx
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const rows = await ledger(ORG);
    const finalizerRows = rows.filter((r) => r.kind === "SETTLE" || r.kind === "REFUND");
    expect(finalizerRows).toHaveLength(1); // exactly one winner, never both

    const acc = await account(ORG);
    expect(acc.reserved).toBe(0); // the hold is cleared exactly once either way
    // the account agrees with WHICH finalizer won: SETTLE keeps the charge, REFUND restores it
    expect(acc.balance).toBe(finalizerRows.at(0)?.kind === "SETTLE" ? 0 : 1000);
    // invariants: net ledger deltas == net account change from the 1000 seed
    expect(sumBalance(rows)).toBe(acc.balance - 1000);
    expect(sumReserved(rows)).toBe(acc.reserved);
  });
});

// ── Case 10: grantCredits 幂等 —— 发钱路径的白送钱防线(审计 2026-07-04 补) ────
// Stripe 对超时/非 2xx 一定会重发 webhook。同一 idempotencyKey 重放/并发,只许
// 加一次钱。谁要是删了 (orgId, idempotencyKey) 唯一索引或改了"先写账行"的顺序,
// 这里立刻红。
describe("case 10 — grantCredits idempotency: a webhook replay never double-grants", () => {
  it("sequential replay of the same idempotencyKey → {duplicate}, balance +once", async () => {
    const key = "purchase:evt_stripe_123";
    const first = await grantCredits({ orgId: ORG, amount: 500, source: "PURCHASE", idempotencyKey: key });
    const second = await grantCredits({ orgId: ORG, amount: 500, source: "PURCHASE", idempotencyKey: key });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ duplicate: true });

    const acc = await account(ORG);
    expect(acc.balance).toBe(1500); // 1000 seed + 500, exactly once

    const rows = await ledger(ORG);
    expect(rows.filter((r) => r.kind === "GRANT" && r.idempotencyKey === key)).toHaveLength(1);
  });

  it("two CONCURRENT grants with the same idempotencyKey → exactly one applies", async () => {
    const key = "purchase:evt_stripe_race";
    const results = await Promise.allSettled([
      grantCredits({ orgId: ORG, amount: 500, source: "PURCHASE", idempotencyKey: key }),
      grantCredits({ orgId: ORG, amount: 500, source: "PURCHASE", idempotencyKey: key }),
    ]);

    // 两个调用都不许抛(P2002 被吞成 {duplicate}),且恰一个 {ok}、恰一个 {duplicate}
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const values = results.map((r) => (r as PromiseFulfilledResult<{ ok?: boolean; duplicate?: boolean }>).value);
    expect(values.filter((v) => v.ok === true)).toHaveLength(1);
    expect(values.filter((v) => v.duplicate === true)).toHaveLength(1);

    const acc = await account(ORG);
    expect(acc.balance).toBe(1500); // +500 exactly once

    const rows = await ledger(ORG);
    expect(rows.filter((r) => r.kind === "GRANT" && r.idempotencyKey === key)).toHaveLength(1);
  });
});

// ── Case 16: spend cap —— 商家自己设的上限,真的在扣费路径上执行(#524) ──────────
// 在 #524 之前,`Organization.settings.spendCapCredits` 是一句自言自语:设置页承诺
// 「超过这个数 Otto 会暂停任务」,而 reserve/settle 从不打开它。这一组测试证明的是
// **说的 = 做的**:上限在 reserveCredits 里判,判不过就整笔回滚,零建任务零预扣。
//
// 口径(与设置页那句话逐字对齐):上限是**单次动作**的天花板,不是月度预算。
// 5 显示 credits = 50 内部 credits(INTERNAL_PER_DISPLAY),所以下面的数都是内部值。
import { SpendCapBlocked } from "./index.js";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

/** 把商家在设置页存下的上限写进这个 org(显示 credits,和商家输入的那个数一样)。 */
async function setCap(orgId: string, spendCapCredits: unknown): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { settings: { spendCapCredits } as never },
  });
}

describe("case 16 — spend cap is enforced by the charging path (#524)", () => {
  it("no cap set (the default) → an expensive action still runs, exactly as before", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    const acc = await account(ORG);
    expect(acc.balance).toBe(0);
    expect(acc.reserved).toBe(1000);
  });

  it("a stored cap of 0 means NO cap — the merchant's own words on the Settings screen", async () => {
    await setCap(ORG, 0);
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    expect((await account(ORG)).reserved).toBe(1000);
  });

  it("under the cap → runs and charges normally", async () => {
    await setCap(ORG, 5); // 50 internal
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 40 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(960);
    expect(acc.reserved).toBe(40);
    expect((await ledger(ORG)).filter((r) => r.kind === "RESERVE")).toHaveLength(1);
  });

  it("EXACTLY at the cap → runs (a ceiling you may spend up to, not one you must stay under)", async () => {
    await setCap(ORG, 5);
    await prisma.$transaction((tx) =>
      reserveCredits(tx, { orgId: ORG, refId: REF, cost: 5 * INTERNAL_PER_DISPLAY }),
    );
    expect((await account(ORG)).reserved).toBe(50);
  });

  it("one credit over the cap → refused, and NOTHING moved: no ledger row, no hold, no debit", async () => {
    await setCap(ORG, 5);

    await expect(
      prisma.$transaction((tx) =>
        reserveCredits(tx, { orgId: ORG, refId: REF, cost: 5 * INTERNAL_PER_DISPLAY + 1 }),
      ),
    ).rejects.toThrow(SpendCapBlocked);

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000); // untouched — the merchant has the credits, their cap said no
    expect(acc.reserved).toBe(0);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("carries the two numbers the refusal was judged against (required + cap, internal)", async () => {
    await setCap(ORG, 5);
    const error = await prisma
      .$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 110 }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpendCapBlocked);
    expect((error as SpendCapBlocked).requiredInternal).toBe(110);
    expect((error as SpendCapBlocked).capInternal).toBe(50);
  });

  it("its raw message is merchant-safe: no internal-credit numbers leak to a surface that shows it", async () => {
    // The research worker persists a sanitized `e.message` straight onto the card the merchant
    // reads. Internal credits (1 = $0.01) are a unit this product never shows anyone, so the
    // default sentence carries none — the numbered version is built where credits are formatted.
    await setCap(ORG, 5);
    const error = await prisma
      .$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 110 }))
      .catch((e: unknown) => e);

    expect((error as Error).message).toBe("Paused by your spend cap — raise it in Settings to run this.");
    expect((error as Error).message).not.toMatch(/\d/);
  });

  it("is a refusal, not a shortfall — it is NOT an InsufficientCredits", async () => {
    await setCap(ORG, 5);
    const error = await prisma
      .$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 110 }))
      .catch((e: unknown) => e);
    // 分型是钱路对外说话的依据:混成一类,商家就会被送去 Billing 充值,
    // 而挡住他的其实是自己在 Settings 里设的那个数。
    expect(error).not.toBeInstanceOf(InsufficientCredits);
  });

  it("raising the cap unblocks the SAME action — the merchant's exit actually works", async () => {
    await setCap(ORG, 5);
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 110 })),
    ).rejects.toThrow(SpendCapBlocked);

    await setCap(ORG, 20);
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 110 }));
    expect((await account(ORG)).reserved).toBe(110);
  });

  it("lowering the cap does NOT claw back an in-flight hold — settle still completes", async () => {
    await setCap(ORG, 20);
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 110 }));

    await setCap(ORG, 1); // the cap gates NEW spend; it is not a retroactive verdict
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(890);
    expect(acc.reserved).toBe(0);
    const rows = await ledger(ORG);
    expect(rows.filter((r) => r.kind === "SETTLE")).toHaveLength(1);
    // The ledger invariants survive a cap change mid-flight (the seed is not a ledger row,
    // so the deltas net to exactly the one charge).
    expect(sumBalance(rows)).toBe(-110);
    expect(sumReserved(rows)).toBe(0);
  });
});

// ── Case 17: fail closed —— 读不到上限就拒绝,绝不当成「无上限」 ─────────────────
describe("case 17 — an unreadable spend cap refuses (fail closed, #524)", () => {
  it("a fractional stored cap is unreadable → refuse, nothing charged", async () => {
    await setCap(ORG, 12.5); // the write path rejects this; only a foreign writer produces it
    const error = await prisma
      .$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 10 }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpendCapBlocked);
    expect((error as SpendCapBlocked).capInternal).toBeNull();
    expect((await account(ORG)).balance).toBe(1000);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("a negative stored cap is unreadable → refuse (never read as unlimited)", async () => {
    await setCap(ORG, -5);
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 10 })),
    ).rejects.toThrow(SpendCapBlocked);
    expect((await account(ORG)).balance).toBe(1000);
  });

  it("no organization row at all → refuse, and never charge against a ceiling we cannot see", async () => {
    const error = await prisma
      .$transaction((tx) => reserveCredits(tx, { orgId: "org-that-does-not-exist", refId: REF, cost: 10 }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpendCapBlocked);
    expect((error as SpendCapBlocked).capInternal).toBeNull();
    expect(await ledger("org-that-does-not-exist")).toHaveLength(0);
  });
});

// ── Case 18: 并发 + 双租户 —— 上限不会被并发穿透,也不会串台 ──────────────────
describe("case 18 — spend cap under concurrency and across tenants (#524)", () => {
  it("two concurrent over-cap actions are BOTH refused — no one slips through", async () => {
    await setCap(ORG, 5);

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "cap-race-a", cost: 110 })),
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "cap-race-b", cost: 110 })),
    ]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(SpendCapBlocked);
    }
    const acc = await account(ORG);
    expect(acc.balance).toBe(1000);
    expect(acc.reserved).toBe(0);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("with a cap in force, the never-double-spend guard still holds: 1 of 2 concurrent wins", async () => {
    // 上限放行(70 ≤ 100),余额只够一笔(100)—— 加了上限之后,原本那道「永不双扣」的
    // 原子条件扣减必须一格不动。
    await prisma.$executeRawUnsafe(`TRUNCATE "CreditLedger", "CreditAccount", "Organization" RESTART IDENTITY CASCADE`);
    await seedOrg(ORG, 100);
    await setCap(ORG, 10); // 100 internal
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "cap-mix-a", cost: 70 })),
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "cap-mix-b", cost: 70 })),
    ]);
    // 只有余额那道闸能挡住第二笔(两笔都在上限内)
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(InsufficientCredits);

    const acc = await account(ORG);
    expect(acc.balance).toBe(30);
    expect(acc.reserved).toBe(70);
    expect((await ledger(ORG)).filter((r) => r.kind === "RESERVE")).toHaveLength(1);
  });

  it("merchant A's cap never touches merchant B — two tenants, two ceilings", async () => {
    const ORG_B = "test-org-2";
    await seedOrg(ORG_B, 1000);
    await setCap(ORG, 5);    // A capped at 5 credits per action
    await setCap(ORG_B, 50); // B capped at 50

    // The SAME action: refused for A, allowed for B.
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "tenant-a", cost: 110 })),
    ).rejects.toThrow(SpendCapBlocked);
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG_B, refId: "tenant-b", cost: 110 }));

    expect(await account(ORG)).toMatchObject({ balance: 1000, reserved: 0 });
    expect(await account(ORG_B)).toMatchObject({ balance: 890, reserved: 110 });
    expect(await ledger(ORG)).toHaveLength(0);
    expect((await ledger(ORG_B)).filter((r) => r.kind === "RESERVE")).toHaveLength(1);
  });

  it("an uncapped tenant is unaffected by a capped neighbour", async () => {
    const ORG_B = "test-org-3";
    await seedOrg(ORG_B, 1000);
    await setCap(ORG, 1); // A allows 10 internal at most
    // B never opened Settings: settings stays null → no cap → the expensive action runs.
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG_B, refId: "free-b", cost: 900 }));
    expect((await account(ORG_B)).reserved).toBe(900);
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "capped-a", cost: 900 })),
    ).rejects.toThrow(SpendCapBlocked);
  });
});
