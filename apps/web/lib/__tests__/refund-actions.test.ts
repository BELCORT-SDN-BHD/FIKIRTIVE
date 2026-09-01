/**
 * MONEY-A14 —— 人工退款三段协议(规格 §7.6,Founder 2026-09-01 改签 v2)。
 *
 * 钉的是**顺序**与**成对**:credits 先被锁死,才允许动马币;Stripe 不成,预扣必须成对释放,
 * 商家余额净变 0。Stripe 用注入的 stub,一分钱不出门。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

const requireRole = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireRole }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const activeMerchantOrg = vi.fn();
vi.mock("@/lib/tenant-admin", () => ({ activeMerchantOrg }));

const founderAlert = vi.fn();
vi.mock("@/lib/founder-alert", () => ({ founderAlert }));

const refundsCreate = vi.fn();
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { create: refundsCreate } } }));

class MockInsufficientCredits extends Error {}
class MockSpendCapBlocked extends Error {}
class MockOrgSuspended extends Error {}
class MockFinanceAdjustBlocked extends Error {
  reason = "rolling-window" as const;
  orgId = "org_1";
  usedInternal = 26_000;
  limitInternal = 20_000;
}

const creditLedgerFindMany = vi.fn();
const actionEventCreate = vi.fn();
const reserveCredits = vi.fn();
const settleCredits = vi.fn();
const refundReservation = vi.fn();
const assertWithinAdjustWindow = vi.fn();
const creditAccountFindUnique = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    creditLedger: { findMany: creditLedgerFindMany },
    creditAccount: { findUnique: creditAccountFindUnique },
    actionEvent: { create: actionEventCreate },
    // tx 里唯一被直接用到的读:allowPartial 那一支的余额。其余全部走被 mock 的钱服务函数。
    $transaction: (fn: (tx: unknown) => unknown) => fn({ creditAccount: { findUnique: creditAccountFindUnique } }),
  },
  reserveCredits,
  settleCredits,
  refundReservation,
  assertWithinAdjustWindow,
  InsufficientCredits: MockInsufficientCredits,
  SpendCapBlocked: MockSpendCapBlocked,
  OrgSuspended: MockOrgSuspended,
  FinanceAdjustBlocked: MockFinanceAdjustBlocked,
}));

const { refundCreditsAction } = await import("@/lib/refund-actions");

const ORG = "org_merchant_1";
const GATE = { email: "founder@fikirtive.com", roles: ["super-admin"], role: "super-admin" };
/** Pro 包:RM250 → 600cr,所以每 credit 实付 RM0.41666…;退 100cr = RM41.666… → 向下取整 4166 仙。 */
const PRO_PACK_CREDITS = 600;

function payload(over: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    displayedAmount: 100,
    paymentIntentId: "pi_3QabcDEF",
    packCredits: PRO_PACK_CREDITS,
    refundId: "refund-ticket-0001",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue(GATE);
  activeMerchantOrg.mockResolvedValue({ id: ORG });
  creditLedgerFindMany.mockResolvedValue([]);
  actionEventCreate.mockResolvedValue({});
  reserveCredits.mockResolvedValue(undefined);
  settleCredits.mockResolvedValue(undefined);
  refundReservation.mockResolvedValue("refunded");
  assertWithinAdjustWindow.mockResolvedValue(undefined);
  refundsCreate.mockResolvedValue({ id: "re_1Xyz", status: "succeeded" });
});

describe("MONEY-A14 — 成功路径", () => {
  it("顺序=先预扣、后 Stripe、再落账;SETTLE 行 reason 载 re_…", async () => {
    const order: string[] = [];
    reserveCredits.mockImplementation(async () => { order.push("reserve"); });
    refundsCreate.mockImplementation(async () => { order.push("stripe"); return { id: "re_1Xyz", status: "succeeded" }; });
    settleCredits.mockImplementation(async () => { order.push("settle"); });

    const result = await refundCreditsAction(payload());

    expect(result).toEqual({ ok: true, refundId: "re_1Xyz", displayedAmount: 100, amountMinor: 4166 });
    expect(order).toEqual(["reserve", "stripe", "settle"]);
    expect(reserveCredits).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: "manual-refund:refund-ticket-0001", cost: 100 * INTERNAL_PER_DISPLAY });
    const settleArgs = settleCredits.mock.calls[0]![1] as { reason: string; refId: string };
    expect(settleArgs.refId).toBe("manual-refund:refund-ticket-0001");
    expect(settleArgs.reason).toContain("re_1Xyz");
    expect(settleArgs.reason).toContain("myr_minor:4166");
    // 台账另一口径:按 FX_PIN(4.5)折 USD = 41.66 / 4.5 ≈ 9.26。
    expect(settleArgs.reason).toContain("usd:9.26");
    expect(refundReservation).not.toHaveBeenCalled();
  });

  it("马币按**该包实付单价**换算,不是面值(Pro 包退 100cr = RM41.66,不是 RM45)", async () => {
    await refundCreditsAction(payload());
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_3QabcDEF", amount: 4166 },
      { idempotencyKey: "manual-refund:refund-ticket-0001" },
    );
  });

  it("Stripe 返回 pending 视为已受理(单号已存在),照常落账", async () => {
    refundsCreate.mockResolvedValue({ id: "re_pending", status: "pending" });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ ok: true, refundId: "re_pending" });
    expect(settleCredits).toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 失败与成对释放", () => {
  it("Stripe **明确拒绝**(业务级错误)⇒ REFUND 成对释放,余额净变 0,永不落账", async () => {
    refundsCreate.mockRejectedValue(Object.assign(new Error("No such payment_intent"), { type: "StripeInvalidRequestError", statusCode: 400 }));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("released") });
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: "manual-refund:refund-ticket-0001", reason: "manual-refund:stripe-failed" });
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("Stripe **答案不明**(超时 / 5xx / 幂等键撞参数)⇒ 预扣**留着** + 报警,绝不释放", async () => {
    // 释放的前提是「那笔退款确定没建出来」。超时可能发生在钱已经退出去之后 —— 这时候把 credits
    // 还回去,就是「钱退了、credits 也留着」,平台吃两遍。方向刻意不对称。
    for (const thrown of [
      new Error("socket hang up"),
      Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
      Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError", statusCode: 400 }),
    ]) {
      vi.clearAllMocks();
      requireRole.mockResolvedValue(GATE);
      activeMerchantOrg.mockResolvedValue({ id: ORG });
      creditLedgerFindMany.mockResolvedValue([]);
      reserveCredits.mockResolvedValue(undefined);
      assertWithinAdjustWindow.mockResolvedValue(undefined);
      refundsCreate.mockRejectedValue(thrown);

      const result = await refundCreditsAction(payload());

      expect(result, thrown.message).toMatchObject({ error: expect.stringContaining("stay held") });
      expect(refundReservation, thrown.message).not.toHaveBeenCalled();
      expect(settleCredits, thrown.message).not.toHaveBeenCalled();
      expect(founderAlert, thrown.message).toHaveBeenCalledWith(
        expect.objectContaining({ key: "finance.manual_refund_outcome_unknown" }),
      );
    }
  });

  it("Stripe 报 failed 状态 ⇒ 同样成对释放", async () => {
    refundsCreate.mockResolvedValue({ id: "re_bad", status: "failed" });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("failed") });
    expect(refundReservation).toHaveBeenCalled();
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("落账失败 ⇒ 报警 + 让操作员用**同一个**退款单号重跑(Stripe 幂等,不会退两次)", async () => {
    settleCredits.mockRejectedValue(new Error("db down"));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("SAME refund id") });
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.manual_refund_settle_failed" }));
  });

  it("余额不足 ⇒ 拒退,Stripe 一次都不碰", async () => {
    reserveCredits.mockRejectedValue(new MockInsufficientCredits("nope"));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("Not enough unused credits") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("allowPartial ⇒ 按余额能覆盖的部分退(退 100 只剩 40 ⇒ 退 40cr = RM16.66)", async () => {
    creditAccountFindUnique.mockResolvedValue({ balance: 40 * INTERNAL_PER_DISPLAY });
    const result = await refundCreditsAction(payload({ allowPartial: true }));
    expect(reserveCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cost: 40 * INTERNAL_PER_DISPLAY }));
    expect(result).toMatchObject({ ok: true, displayedAmount: 40, amountMinor: 1666 });
  });

  it("allowPartial 但余额为 0 ⇒ 拒退(0 credits 的退款是不存在的东西)", async () => {
    creditAccountFindUnique.mockResolvedValue({ balance: 0 });
    const result = await refundCreditsAction(payload({ allowPartial: true }));
    expect(result).toMatchObject({ error: expect.stringContaining("no credits left") });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("撞上 30 天累计闸 ⇒ 拒退并报警(退款与调账共用同一个额度)", async () => {
    assertWithinAdjustWindow.mockRejectedValue(new MockFinanceAdjustBlocked("over"));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("2,000") });
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.adjust_window_blocked" }));
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("被暂停的 workspace ⇒ 拒退,并说清楚下一步", async () => {
    reserveCredits.mockRejectedValue(new MockOrgSuspended("paused"));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("suspended") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 幂等", () => {
  it("同一个退款单号已落账 ⇒ 如实回答「已经退过」,Stripe 一次都不碰", async () => {
    creditLedgerFindMany.mockResolvedValue([
      { kind: "RESERVE", reason: "", reservedDelta: 100 * INTERNAL_PER_DISPLAY },
      { kind: "SETTLE", reason: "stripe-refund:re_1Xyz myr_minor:4166 usd:9.26", reservedDelta: 0 },
    ]);
    // 报的是**当时真的退了多少**(从 SETTLE 行的 reason 读回来),不是拿这次表单参数再算一遍。
    const result = await refundCreditsAction(payload({ packCredits: 50 }));
    expect(result).toEqual({ ok: true, duplicate: true, refundId: "re_1Xyz", displayedAmount: 100, amountMinor: 4166 });
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("上次在 Stripe 之后断了(只有预扣)⇒ 接着跑,不再预扣第二次", async () => {
    creditLedgerFindMany.mockResolvedValue([{ kind: "RESERVE", reason: "", reservedDelta: 100 * INTERNAL_PER_DISPLAY }]);
    const result = await refundCreditsAction(payload());
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: "manual-refund:refund-ticket-0001" });
    expect(result).toMatchObject({ ok: true, refundId: "re_1Xyz" });
  });

  it("这个单号已经成对释放过 ⇒ 不许在它上面接着退", async () => {
    creditLedgerFindMany.mockResolvedValue([
      { kind: "RESERVE", reason: "", reservedDelta: 1000 },
      { kind: "REFUND", reason: "manual-refund:stripe-failed", reservedDelta: -1000 },
    ]);
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("already released") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 门与入参", () => {
  it("没有 tenants.mutate ⇒ 一步都不走", async () => {
    requireRole.mockResolvedValue({ error: "You don't have access to this." });
    expect(await refundCreditsAction(payload())).toEqual({ error: "You don't have access to this." });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("founder org / 未知 org / 负数 / 非在售包 / 坏单号一律当场拒", async () => {
    expect(await refundCreditsAction(payload({ orgId: "founder" }))).toMatchObject({ error: expect.stringContaining("merchant org") });
    activeMerchantOrg.mockResolvedValueOnce(null);
    expect(await refundCreditsAction(payload())).toMatchObject({ error: "Unknown or closed org." });
    expect(await refundCreditsAction(payload({ displayedAmount: -5 }))).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(await refundCreditsAction(payload({ packCredits: 777 }))).toMatchObject({ error: expect.stringContaining("credit pack") });
    expect(await refundCreditsAction(payload({ paymentIntentId: "not-a-pi" }))).toMatchObject({ error: expect.stringContaining("pi_") });
    expect(await refundCreditsAction(payload({ refundId: "x" }))).toMatchObject({ error: "Invalid refund id." });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("单笔上限沿用同一个单一源(1000 显示 credits)", async () => {
    expect(await refundCreditsAction(payload({ displayedAmount: 1001 }))).toEqual({
      error: "Credit actions are capped at 1,000 displayed credits each.",
    });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});
