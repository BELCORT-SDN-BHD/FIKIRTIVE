/**
 * Integration tests for the @fikirtive/db credit service.
 * Runs against a real Postgres DB (must be a *_test database — enforced by setup.ts).
 *
 * TDD cases from otto-task-1.3-brief.md.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  prisma,
  reserveCredits,
  reserveCreditsUpTo,
  settleCredits,
  refundReservation,
  InsufficientCredits,
  HOLD_SHORTFALL_REASON_PREFIX,
} from "./index.js";
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
    // #898: the clamp is no longer silent — the 4000 the platform absorbed is on the row.
    expect(settleRow!.reason).toBe(`${HOLD_SHORTFALL_REASON_PREFIX}4000`);
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

  // r1 判官 P1-1:这是 r1 真正漏掉的形状 —— 字符串走 mergeSettings 会被丢弃回退默认 0,
  // 于是「上限 5」被读成「无上限」,任意金额放行。它和小数/负数是同一族威胁,必须同样拒绝。
  it("a stored STRING cap is unreadable → refuse (the fail-OPEN shape r1 shipped)", async () => {
    await setCap(ORG, "5");
    const error = await prisma
      .$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpendCapBlocked);
    expect((error as SpendCapBlocked).capInternal).toBeNull();
    expect((await account(ORG)).balance).toBe(1000);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("other corrupted shapes refuse too — one threat family, one answer", async () => {
    for (const bad of [true, { amount: 5 }, [5], "lots", ""] as const) {
      await setCap(ORG, bad);
      await expect(
        prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: `bad-${String(bad)}`, cost: 10 })),
        JSON.stringify(bad),
      ).rejects.toThrow(SpendCapBlocked);
    }
    expect((await account(ORG)).balance).toBe(1000);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("a workspace that never set the key is NOT corrupted — it simply has no ceiling", async () => {
    // Fail-closed must never stop a merchant who set nothing. A blob without the key reads as none.
    await prisma.organization.update({
      where: { id: ORG },
      data: { settings: { autoPublish: true } as never },
    });
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 1000 }));
    expect((await account(ORG)).reserved).toBe(1000);
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

// ── Case 19: 判 cap 与扣款是**一个无窗原子点**(#524 r6,判官 r5 P1-A②) ────────────
//
// r5 把「整动作总额」的判定放进 reserve 的同一笔事务,判官指出那还不够:PostgreSQL 默认
// READ COMMITTED 下,同一笔事务里的两条 SELECT 各拿各的快照 —— 总额判 100、单腿判 70,
// 一次动作用了两个天花板,而钱在第二个上面动。r6 把这行读改成 `FOR UPDATE`:第一次读就
// 锁住 Organization 行,商家在中间提交的新上限只能等我们提交或回滚之后才落地。
//
// 这一组跑在**真库**上,因为要证的正是隔离级别与行锁的真实行为 —— mock 的事务句柄证不了。
import { assertWithinSpendCap, finalizedReservations, otherHoldsSince } from "./index.js";

describe("case 19 — the cap cannot move under a transaction that is judging it (#524 r6)", () => {
  /** Is some OTHER backend right now waiting on a lock to write this org's row?
   *  Read from a different connection than the transaction under test, so it never lies. */
  async function someoneIsBlockedOnTheOrgRow(): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%"Organization"%'`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  it("a cap lowered mid-transaction does NOT change the verdict that transaction already made", async () => {
    await setCap(ORG, 10); // 100 internal — covers the whole action below

    // 这一格必须**确定性**地红/绿,不能靠 sleep 赌时序:去掉 FOR UPDATE 之后,下面的
    // `expect(lowered).toBe(false)` 会立刻失败(实测:降档在毫秒级提交,第二次读到 7)。
    let lowered = false;
    let lowering: Promise<void> | null = null;
    await prisma.$transaction(async (tx) => {
      // Verdict #1 — the WHOLE approved action (what withLlmBudget asserts).
      await assertWithinSpendCap(tx, ORG, 100);
      // The merchant lowers their cap RIGHT NOW, on another connection. Without the row lock
      // this commits immediately and the next read in THIS transaction sees 70.
      lowering = setCap(ORG, 7).then(() => { lowered = true; }); // 70 internal
      // Wait until that write has either committed or is provably parked on our lock.
      const deadline = Date.now() + 5000;
      while (!lowered && !(await someoneIsBlockedOnTheOrgRow()) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // THE PROOF: it could not commit. The row is ours until this transaction ends.
      expect(lowered).toBe(false);
      // Verdict #2 — the individual charge, inside reserveCredits. Judged against the SAME
      // ceiling verdict #1 was, because no other value could land in between.
      await assertWithinSpendCap(tx, ORG, 100);
      await reserveCredits(tx, { orgId: ORG, refId: "cap-lock-1", cost: 40 });
    }, { timeout: 20000 });

    // The lowering was queued behind us and lands only now.
    await lowering!;
    expect(lowered).toBe(true);
    const acc = await account(ORG);
    expect(acc.reserved).toBe(40);
    expect((await ledger(ORG)).filter((r) => r.kind === "RESERVE")).toHaveLength(1);
    // And the new ceiling is in force for everything AFTER: the next action is judged at 70.
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "cap-lock-2", cost: 100 })),
    ).rejects.toThrow(SpendCapBlocked);
    // Explicit timeout: this case DELIBERATELY parks a writer on a lock, so it must not inherit
    // the 5s default that every other case in this file is sized for.
  }, 30_000);

  it("a cap lowered BEFORE the transaction is the one that decides — the lock never freezes an old answer", async () => {
    await setCap(ORG, 10);
    await setCap(ORG, 3); // 30 internal
    await expect(
      prisma.$transaction(async (tx) => {
        await assertWithinSpendCap(tx, ORG, 100);
        await reserveCredits(tx, { orgId: ORG, refId: "cap-lock-3", cost: 40 });
      }),
    ).rejects.toThrow(SpendCapBlocked);
    expect((await account(ORG)).balance).toBe(1000);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("two concurrent actions each judge the cap once, and neither sees the other's half-written state", async () => {
    // The lock serializes them; the ceiling is 70 and each action asks for 100.
    await setCap(ORG, 7);
    const results = await Promise.allSettled([
      prisma.$transaction(async (tx) => {
        await assertWithinSpendCap(tx, ORG, 100);
        await reserveCredits(tx, { orgId: ORG, refId: "cap-lock-race-a", cost: 40 });
      }),
      prisma.$transaction(async (tx) => {
        await assertWithinSpendCap(tx, ORG, 100);
        await reserveCredits(tx, { orgId: ORG, refId: "cap-lock-race-b", cost: 40 });
      }),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    for (const r of results) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(SpendCapBlocked);
    expect(await ledger(ORG)).toHaveLength(0);
  });
});

// ── Case 20: 重试用哪个 refId、以及「什么都没扣」凭什么敢说 ────────────────────────
describe("case 20 — the ledger answers what a retry may reuse, and what it may claim (#524 r6)", () => {
  const A1 = "otto-approve:thread-1:card-1:a1";
  const A2 = "otto-approve:thread-1:card-1:a2";
  const A3 = "otto-approve:thread-1:card-1:a3";

  it("finalizedReservations names exactly the attempts the ledger will refuse again", async () => {
    // a1: held then refunded — the RESERVE row survives the refund, so this refId is spent forever.
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: A1, cost: 10 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: A1 }));
    // a2: held and still open — a click in flight. Reusing it is how a duplicate is refused.
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: A2, cost: 10 }));
    // a3: never touched.

    expect(await finalizedReservations(ORG, [A1, A2, A3])).toEqual(new Set([A1]));

    // WHY it must be skipped: the ledger really does refuse it, forever.
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: A1, cost: 10 })),
    ).rejects.toMatchObject({ code: "P2002" });
    // …and the attempt it points at instead reserves for real.
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: A3, cost: 10 }));
    expect((await ledger(ORG)).filter((r) => r.kind === "RESERVE" && r.refId === A3)).toHaveLength(1);
  });

  it("a SETTLED attempt is finished too — both finalizers close a refId", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: A1, cost: 10 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: A1, actualInternal: 4 }));
    expect(await finalizedReservations(ORG, [A1, A2])).toEqual(new Set([A1]));
  });

  it("one merchant's attempts never answer for another's", async () => {
    const ORG_B = "test-org-9";
    await seedOrg(ORG_B, 1000);
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG_B, refId: A1, cost: 10 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG_B, refId: A1 }));
    expect(await finalizedReservations(ORG, [A1])).toEqual(new Set());
    expect(await finalizedReservations(ORG_B, [A1])).toEqual(new Set([A1]));
  });

  it("otherHoldsSince: 'nothing was charged' is only sayable when nothing else was held", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: A1, cost: 10 }));
    // Only this turn's own hold exists — the whole action really was free.
    expect(await otherHoldsSince(ORG, A1)).toBe("none");
    // Its own refund does not count as somebody else's charge.
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: A1 }));
    expect(await otherHoldsSince(ORG, A1)).toBe("none");
    // The approved tool then held credits of its own: nothing may claim a zero any more.
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "refgen-job-1", cost: 60 }));
    expect(await otherHoldsSince(ORG, A1)).toBe("some");
  });

  it("otherHoldsSince fails closed when the reservation cannot be read at all", async () => {
    expect(await otherHoldsSince(ORG, "otto-approve:never:reserved:a1")).toBe("unknown");
  });

  it("otherHoldsSince never counts a NEIGHBOUR tenant's spend against this merchant", async () => {
    const ORG_B = "test-org-10";
    await seedOrg(ORG_B, 1000);
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: A1, cost: 10 }));
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG_B, refId: "other-tenant-job", cost: 60 }));
    expect(await otherHoldsSince(ORG, A1)).toBe("none");
  });
});

// ── Case 21: 退款必须给出**可判定的终态**,不能只返回 void(#524 r8,判官 r7 P1) ──────
// `count === 0` 同时代表「已退款」和「并发 SETTLE 赢了」——一个是失败,一个是成功且已收费。
// r7 把两者一起丢成 void,清道夫因此在退款变成 no-op 之后照样把成功那张卡 CAS 成 failed。
// 钱路一行没动:同样的读、同样的条件插入、同样的账户更新、同样的顺序;只多了 no-op 那条
// 分支上的一次只读查询,用来说出到底是谁赢了。
describe("case 21 — refundReservation names which finalizer won (#524 r8)", () => {
  it("says `refunded` only when this call is the one that moved the money", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 400 }));
    const first = await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));
    expect(first).toBe("refunded");
    expect(await account(ORG)).toMatchObject({ balance: 1000, reserved: 0 });
  });

  it("says `already-refunded` on a replay — a second caller must not act as if it refunded", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 400 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));
    const second = await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));
    expect(second).toBe("already-refunded");
    expect(await account(ORG)).toMatchObject({ balance: 1000, reserved: 0 }); // restored once
  });

  it("says `already-settled` when a settle won the race — the action SUCCEEDED and was charged", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 400 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF }));
    const late = await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));
    expect(late).toBe("already-settled");
    expect(await account(ORG)).toMatchObject({ balance: 600, reserved: 0 }); // the charge stays
  });

  it("says `no-reservation` when there is nothing to answer for — proves neither finalizer", async () => {
    const answer = await prisma.$transaction((tx) =>
      refundReservation(tx, { orgId: ORG, refId: "never-reserved" }),
    );
    expect(answer).toBe("no-reservation");
  });

  it("the answer agrees with the ledger row that actually won a concurrent race", async () => {
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 400 }));
    const [, refund] = await Promise.all([
      prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF })),
      prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF })),
    ]);
    const rows = await ledger(ORG);
    const winner = rows.find((r) => r.kind === "SETTLE" || r.kind === "REFUND");
    expect(rows.filter((r) => r.kind === "SETTLE" || r.kind === "REFUND")).toHaveLength(1);
    expect(refund).toBe(winner?.kind === "SETTLE" ? "already-settled" : "refunded");
  });

  it("labels the REFUND row on request, and writes today's blank row when not asked", async () => {
    // The label is how a background sweep recognises its OWN refunds later; every existing
    // caller keeps writing exactly the row it writes today.
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: REF, cost: 400 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF, reason: "a-sweep" }));
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "ref-bbb", cost: 400 }));
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: "ref-bbb" }));

    const rows = await ledger(ORG);
    expect(rows.find((r) => r.kind === "REFUND" && r.refId === REF)?.reason).toBe("a-sweep");
    expect(rows.find((r) => r.kind === "REFUND" && r.refId === "ref-bbb")?.reason).toBe("");
  });
});

// ── #898: hold = min(cap, balance) — the chat-hold interim semantics ────────
//
// Founder 2026-08-13, formal correction to #543. Before this, the hold WAS the door: a fixed
// 4-credit hold meant a merchant sitting on 3.9 credits could not send a message at all — they
// could not even ask what their remaining credits were still good for — while the measured cost
// of one message is 0.4–3.3 credits (#536). The hold now shrinks to fit the balance, and the
// door drops to a 1-credit minimum.
//
// Everything below is asserted against real Postgres, because the claims are money claims:
// balance never negative, never charged more than held, exactly-once unchanged.
describe("#898 — reserveCreditsUpTo: the hold fits the balance", () => {
  const CAP = 40;  // OTTO_CONVERSATION_TURN_RESERVE_INTERNAL — 4 displayed credits
  const MIN = 10;  // OTTO_CHAT_MIN_START_INTERNAL — 1 displayed credit

  it("① 3.9 credits sends a message: holds all 39, charges the real cost, returns the rest", async () => {
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 39 } });

    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CAP, minimumInternal: MIN }),
    );
    expect(held).toBe(39); // the whole balance, not the 40 cap — and NOT a refusal

    const afterReserve = await account(ORG);
    expect(afterReserve.balance).toBe(0);
    expect(afterReserve.reserved).toBe(39);

    // A typical message: 7 internal (0.7 displayed) — inside the measured 0.4–3.3 band.
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 7 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(32); // 39 held - 7 charged = 32 returned
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE")!;
    expect(settleRow.balanceDelta).toBe(32);
    expect(settleRow.reason).toBe(""); // nothing was clamped — nothing to record
    // Σ balanceDelta == the net change from the balance this test started at (the seed writes
    // the account directly, so it is not itself a ledger row — same convention as case 3).
    expect(sumBalance(rows)).toBe(acc.balance - 39);
    expect(sumReserved(rows)).toBe(acc.reserved);
  });

  it("② 1.2 credits sends a message that costs 3.3: charged 1.2, the platform absorbs 2.1, balance lands on 0 — never below", async () => {
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 12 } });

    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CAP, minimumInternal: MIN }),
    );
    expect(held).toBe(12);

    // 33 internal = 3.3 displayed = the measured production peak (#536), which is what a cold
    // cache on an opening message costs. It exceeds the hold, so the hold is the ceiling.
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 33 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(0);            // charged exactly what was held
    expect(acc.balance).toBeGreaterThanOrEqual(0); // and the balance is never negative
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    const settleRow = rows.find((r) => r.kind === "SETTLE")!;
    expect(settleRow.balanceDelta).toBe(0);
    // The absorbed difference is written down, not silent: 33 - 12 = 21 internal (2.1 displayed).
    expect(settleRow.reason).toBe(`${HOLD_SHORTFALL_REASON_PREFIX}21`);
    expect(sumBalance(rows)).toBe(acc.balance - 12);
    expect(sumReserved(rows)).toBe(acc.reserved);
  });

  it("③ 0.8 credits is refused, and the refusal names the 1-credit minimum, not the 4-credit hold", async () => {
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 8 } });

    await expect(
      prisma.$transaction((tx) =>
        reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CAP, minimumInternal: MIN }),
      ),
    ).rejects.toBeInstanceOf(InsufficientCredits);

    // Nothing moved, and no ledger row was written — the refusal rolled the transaction back.
    const acc = await account(ORG);
    expect(acc.balance).toBe(8);
    expect(acc.reserved).toBe(0);
    expect(await ledger(ORG)).toHaveLength(0);

    const err = await prisma
      .$transaction((tx) => reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CAP, minimumInternal: MIN }))
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientCredits);
    expect((err as InsufficientCredits).requiredInternal).toBe(MIN); // the door, not the hold
    expect((err as InsufficientCredits).balanceInternal).toBe(8);
  });

  it("④ a replayed settle never double-charges a balance-fitted hold", async () => {
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 12 } });
    await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CAP, minimumInternal: MIN }),
    );

    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 33 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 33 }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(0);
    expect(acc.reserved).toBe(0);

    const rows = await ledger(ORG);
    expect(rows.filter((r) => r.kind === "SETTLE")).toHaveLength(1); // exactly-once, unchanged
    expect(rows.filter((r) => r.reason.startsWith(HOLD_SHORTFALL_REASON_PREFIX))).toHaveLength(1);
    expect(sumBalance(rows)).toBe(acc.balance - 12);
    expect(sumReserved(rows)).toBe(acc.reserved);
  });

  it("⑤ a balance at or above the cap is held exactly as before — 4 credits, not the whole balance", async () => {
    // The unchanged path: #898 only moves what happens BELOW the cap.
    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CAP, minimumInternal: MIN }),
    );
    expect(held).toBe(CAP);

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000 - CAP);
    expect(acc.reserved).toBe(CAP);
  });

  it("⑥ a failed message refunds the fitted hold in full — the merchant is left exactly where they started", async () => {
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 12 } });
    await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CAP, minimumInternal: MIN }),
    );

    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ORG, refId: REF }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(12);
    expect(acc.reserved).toBe(0);
  });

  it("⑦ a missing account is refused, not treated as an infinite balance", async () => {
    await expect(
      prisma.$transaction((tx) =>
        reserveCreditsUpTo(tx, { orgId: "org-with-no-account", refId: REF, capInternal: CAP, minimumInternal: MIN }),
      ),
    ).rejects.toBeInstanceOf(InsufficientCredits);
  });
});

// ── #524 × #898:上限只管新的花钱动作,不管进行中的对话 ────────────────────────────
//
// 两票单独看都对,合到一起会互相打脸:#898 让聊天冻结 hold = min(4 credits, 余额),而这笔
// hold 若走 #524 装了闸的 reserveCredits,商家把上限设成 2 credits 就等于把自己踢出对话 ——
// 而一句话实测只花 0.4–3.3 credits(#536),本来就在上限以内。
//
// Founder 裁决(2026-08-13,市调报告存档 issue #909):**上限只管新的花钱动作**(生成图、
// 生成视频这类商家主动要的产出),**进行中的对话完全豁免**。于是 reserveCreditsUpTo 根本
// 不读上限;对话的敞口由余额本身兜底,那是余额闸,不是 cap 闸。
//
// 豁免是结构性的,不是一个开关:reserveCreditsUpTo 走 reserveAgainstBalance,代码里没有
// 通往上限判定的路。下面这一组两头都钉:聊天不受上限影响 **且** 生成照旧被上限拦。
//
//(撞顶之后对话入口该怎么办 —— 新对话的门、Otto 只说不做 —— 是另一张票,本 PR 不做。)
describe("#524 × #898 — the spend cap governs new paid actions, never the conversation", () => {
  const CHAT_CAP = 40; // OTTO_CONVERSATION_TURN_RESERVE_INTERNAL — 4 displayed credits
  const CHAT_MIN = 10; // OTTO_CHAT_MIN_START_INTERNAL — 1 displayed credit

  it("① cap 1 credit, balance 10 credits → the chat hold is the full 4 credits, untouched by the cap", async () => {
    await setCap(ORG, 1);                                                    // 10 internal
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 100 } });

    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    expect(held).toBe(40);                                                   // min(40, 100) — no cap term
    expect(held).toBeGreaterThan(10);                                        // …and it is OVER the cap

    const afterReserve = await account(ORG);
    expect(afterReserve.balance).toBe(60);
    expect(afterReserve.reserved).toBe(40);

    // Settle behaves exactly as it always has: charge the real cost, return the rest.
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: REF, actualInternal: 13 }));
    const acc = await account(ORG);
    expect(acc.balance).toBe(87);
    expect(acc.reserved).toBe(0);
  });

  it("① 同一个商家、同一个上限,**生成**动作照旧被拦 —— 所以上一条不是「闸坏了」", async () => {
    // The counter-proof the exemption needs: the cap is still live on this org, on the same
    // transaction shape, for the kind of action it is meant to govern.
    await setCap(ORG, 1); // 10 internal
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "ref-a-video", cost: 60 })),
    ).rejects.toBeInstanceOf(SpendCapBlocked);
    const acc = await account(ORG);
    expect(acc.balance).toBe(1000);
    expect(acc.reserved).toBe(0);
  });

  it("② a cap far below the entry minimum still lets the conversation run", async () => {
    await setCap(ORG, 1); // 10 internal == the minimum; the hold it would have blocked is 40
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 25 } });

    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    expect(held).toBe(25); // min(40, 25) — the BALANCE binds, which is the only ceiling here
    const acc = await account(ORG);
    expect(acc.balance).toBe(0);
    expect(acc.reserved).toBe(25);
  });

  it("② an UNREADABLE cap does not fail the conversation closed — there is no cap read to fail", async () => {
    // A corrupted setting refuses a generation (fail closed on the guardrail). A conversation has
    // no guardrail to fail: it never opens the setting, so a broken value cannot silence Otto.
    await setCap(ORG, "not-a-number");
    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    expect(held).toBe(40);
    // …and the same corrupted value still refuses a generation.
    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "ref-a-video", cost: 60 })),
    ).rejects.toBeInstanceOf(SpendCapBlocked);
  });

  it("③ a merchant with NO cap is byte-for-byte unchanged — hold is still min(4 credits, balance)", async () => {
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 39 } });
    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    expect(held).toBe(39);
    const acc = await account(ORG);
    expect(acc.balance).toBe(0);
    expect(acc.reserved).toBe(39);
  });

  it("④ balance well above the hold, cap set or not, holds exactly 4 credits either way", async () => {
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 500 } });
    const withoutCap = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: "ref-nocap", capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    await setCap(ORG, 2); // 20 internal — half the hold
    const withCap = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: "ref-withcap", capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    expect(withoutCap).toBe(40);
    expect(withCap).toBe(40); // the cap changed nothing at all
  });

  it("⑤ exactly-once survives the exemption — a duplicate hold hits the unique key, not a second reserve", async () => {
    await setCap(ORG, 2);
    // Balance deliberately left well above the hold, so the SECOND attempt gets past the entry
    // minimum and reaches the ledger — otherwise it would be refused for lack of credits and this
    // would prove nothing about the unique key.
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 100 } });

    const first = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    expect(first).toBe(40);
    await expect(
      prisma.$transaction((tx) =>
        reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
      ),
    ).rejects.toMatchObject({ code: "P2002" });

    const acc = await account(ORG);
    expect(acc.balance).toBe(60);
    expect(acc.reserved).toBe(40);
    const rows = await ledger(ORG);
    expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(1);
    expect(sumBalance(rows)).toBe(-40);
    expect(sumReserved(rows)).toBe(40);
  });

  it("⑤ the balance can never go negative, cap set or not", async () => {
    await setCap(ORG, 2);
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 30 } });
    const held = await prisma.$transaction((tx) =>
      reserveCreditsUpTo(tx, { orgId: ORG, refId: REF, capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
    );
    expect(held).toBe(30); // the whole balance, and not one credit more
    const acc = await account(ORG);
    expect(acc.balance).toBe(0);
    expect(acc.reserved).toBe(30);
  });

  it("⑤ concurrent turns under a cap: the account still never goes negative", async () => {
    await setCap(ORG, 2);
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 30 } });

    await Promise.allSettled([
      prisma.$transaction((tx) =>
        reserveCreditsUpTo(tx, { orgId: ORG, refId: "ref-c1", capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
      ),
      prisma.$transaction((tx) =>
        reserveCreditsUpTo(tx, { orgId: ORG, refId: "ref-c2", capInternal: CHAT_CAP, minimumInternal: CHAT_MIN }),
      ),
    ]);
    const acc = await account(ORG);
    expect(acc.balance).toBeGreaterThanOrEqual(0);
    expect(acc.balance + acc.reserved).toBe(30);
  });
});

// ── Founder 2026-08-18:对话不再花钱 —— 一整轮聊天在台账上必须是**零** ──────────────
//
// 裁决只改一个数(@fikirtive/core 的 OTTO_CONVERSATION_TURN_MARGIN → 0),钱路一行没动。
// 这里钉的是那个 0 落到台账上的样子:金额是 0 的时候,现有的零值处理自己就把整轮做成
// 「不动钱、不落行」—— reserve 在 cost <= 0 直接返回(不写 RESERVE 行),settle 与 refund
// 找不到 RESERVE 就各自 no-op。所以不是「记一笔 0」,而是**一笔都不记**:
// 花费历史不会被零值行刷屏,日后的成本报表也不会把一堆 0 误读成扣费。
describe("a free conversation turn moves no credits and writes no ledger row", () => {
  const CHAT_REF = "otto-stream:free-turn-1";

  it("成功一轮:reserve(0) → settle(0) 之后,余额分文未动,台账一行没有", async () => {
    const before = await account(ORG);

    // 这就是 withLlmBudget 在 margin=0 下的完整调用序列:hold=0,实际花费=0。
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: CHAT_REF, cost: 0 }));
    await prisma.$transaction((tx) =>
      settleCredits(tx, { orgId: ORG, refId: CHAT_REF, actualInternal: 0 }),
    );

    const after = await account(ORG);
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(0);
    expect(await ledger(ORG)).toHaveLength(0); // 零值行也没有
  });

  it("失败一轮(模型报错走退款):同样分文未动、一行未写", async () => {
    const before = await account(ORG);

    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: CHAT_REF, cost: 0 }));
    const outcome = await prisma.$transaction((tx) =>
      refundReservation(tx, { orgId: ORG, refId: CHAT_REF }),
    );

    // 没有 RESERVE 行可退 —— 退款函数如实说「没有预留」,而不是假装退了一笔。
    expect(outcome).toBe("no-reservation");
    const after = await account(ORG);
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(0);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("余额为 0 的商家照样能聊 —— 免费的动作没有门槛", async () => {
    // 这正是裁决要解掉的死局:钱在聊天里花光,然后连「我该怎么办」都问不了。
    await prisma.creditAccount.update({ where: { orgId: ORG }, data: { balance: 0 } });

    await expect(
      prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: CHAT_REF, cost: 0 })),
    ).resolves.toBeUndefined();

    const acc = await account(ORG);
    expect(acc.balance).toBe(0);
    expect(acc.reserved).toBe(0);
    expect(await ledger(ORG)).toHaveLength(0);
  });

  it("生成那一路一个字没改 —— 同一场景下的真扣费照旧落行", async () => {
    // 对照组:免费的是对话,不是生成。裁决没有动生成的价钱。
    await prisma.$transaction((tx) => reserveCredits(tx, { orgId: ORG, refId: "job-1", cost: 110 }));
    await prisma.$transaction((tx) => settleCredits(tx, { orgId: ORG, refId: "job-1" }));

    const acc = await account(ORG);
    expect(acc.balance).toBe(1000 - 110);
    expect(acc.reserved).toBe(0);
    const rows = await ledger(ORG);
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "SETTLE"]);
    expect(sumBalance(rows)).toBe(-110);
    expect(sumReserved(rows)).toBe(0);
  });
});
