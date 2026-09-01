/**
 * MONEY-A14 —— 人工退款三段协议(规格 §7.6,Founder 2026-09-01 改签 v2;判官 2026-09-02 复审落修)。
 *
 * 钉的是**顺序**、**成对**、**事实不可改**、**只有 succeeded 才落账**。Stripe 全部走注入的 stub,
 * 一分钱不出门。
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
const refundsList = vi.fn();
const refundsRetrieve = vi.fn();
const paymentIntentsRetrieve = vi.fn();
const sessionsList = vi.fn();
vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: { create: refundsCreate, list: refundsList, retrieve: refundsRetrieve },
    paymentIntents: { retrieve: paymentIntentsRetrieve },
    checkout: { sessions: { list: sessionsList } },
  },
}));

class MockInsufficientCredits extends Error {}
class MockOrgSuspended extends Error {}
class MockFinanceAdjustBlocked extends Error {
  reason = "rolling-window" as const;
  orgId = "org_merchant_1";
  usedInternal = 26_000;
  limitInternal = 20_000;
}

const creditLedgerFindMany = vi.fn();
const actionEventCreate = vi.fn();
const actionEventFindFirst = vi.fn();
const reserveCredits = vi.fn();
const settleCredits = vi.fn();
const refundReservation = vi.fn();
const assertWithinAdjustWindow = vi.fn();
const creditAccountFindUnique = vi.fn();
const creditLedgerFindFirst = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    creditLedger: { findMany: creditLedgerFindMany, findFirst: creditLedgerFindFirst },
    creditAccount: { findUnique: creditAccountFindUnique },
    actionEvent: { create: actionEventCreate, findFirst: actionEventFindFirst },
    $transaction: (fn: (tx: unknown) => unknown) => fn({ creditAccount: { findUnique: creditAccountFindUnique } }),
  },
  reserveCredits,
  settleCredits,
  refundReservation,
  assertWithinAdjustWindow,
  InsufficientCredits: MockInsufficientCredits,
  OrgSuspended: MockOrgSuspended,
  FinanceAdjustBlocked: MockFinanceAdjustBlocked,
}));

const { refundCreditsAction, completeManualRefund } = await import("@/lib/refund-actions");

const ORG = "org_merchant_1";
const GATE = { email: "founder@fikirtive.com", roles: ["super-admin"], role: "super-admin" };
/** Pro 包:RM250 → 600cr,所以每 credit 实付 RM0.41666…;退 100cr = RM41.666… → 向下取整 4166 仙。 */
const PRO_PACK_CREDITS = 600;
const PRO_PACK_MINOR = 25_000;
const PI = "pi_3QabcDEF";
const TICKET = "refund-ticket-0001";
const REF_ID = `manual-refund:${TICKET}`;
/** 首次预扣钉进 RESERVE 行的那份事实。 */
const FACTS = `pi:${PI}|pack:600|credits:100|myr_minor:4166`;

function payload(over: Record<string, unknown> = {}) {
  return { orgId: ORG, displayedAmount: 100, paymentIntentId: PI, packCredits: PRO_PACK_CREDITS, refundId: TICKET, ...over };
}

/** 账本上「这张单还没开始」。 */
function noLedgerRows() {
  creditLedgerFindMany.mockResolvedValue([]);
}
/** 账本上「预扣已经在了」(断点续跑 / 并发的输家看到的那一幕)。 */
function openHold(reason = FACTS, heldDisplay = 100) {
  creditLedgerFindMany.mockResolvedValue([{ kind: "RESERVE", reason, reservedDelta: heldDisplay * INTERNAL_PER_DISPLAY }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue(GATE);
  activeMerchantOrg.mockResolvedValue({ id: ORG });
  noLedgerRows();
  actionEventCreate.mockResolvedValue({});
  actionEventFindFirst.mockResolvedValue(null);
  creditLedgerFindFirst.mockResolvedValue(null);
  reserveCredits.mockResolvedValue(undefined);
  settleCredits.mockResolvedValue(undefined);
  refundReservation.mockResolvedValue("refunded");
  assertWithinAdjustWindow.mockResolvedValue(undefined);
  // 默认:这笔 PI 属于这个 org、金额正好是 Pro 包、一分钱都还没退过。
  paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "myr", metadata: { orgId: ORG } });
  refundsList.mockResolvedValue({ data: [] });
  refundsCreate.mockResolvedValue({ id: "re_1Xyz", status: "succeeded" });
  refundsRetrieve.mockResolvedValue({ id: "re_1Xyz", status: "succeeded" });
});

describe("MONEY-A14 — 成功路径", () => {
  it("顺序=先核对、再预扣、后 Stripe、最后落账;SETTLE 行 reason 载 re_…", async () => {
    const order: string[] = [];
    paymentIntentsRetrieve.mockImplementation(async () => { order.push("verify"); return { id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "myr", metadata: { orgId: ORG } }; });
    reserveCredits.mockImplementation(async () => { order.push("reserve"); });
    refundsCreate.mockImplementation(async () => { order.push("stripe"); return { id: "re_1Xyz", status: "succeeded" }; });
    settleCredits.mockImplementation(async () => { order.push("settle"); });

    const result = await refundCreditsAction(payload());

    expect(result).toEqual({ ok: true, status: "settled", refundId: "re_1Xyz", displayedAmount: 100, amountMinor: 4166 });
    expect(order).toEqual(["verify", "reserve", "stripe", "settle"]);
    const settleArgs = settleCredits.mock.calls[0]![1] as { reason: string; refId: string };
    expect(settleArgs.refId).toBe(REF_ID);
    expect(settleArgs.reason).toContain("re_1Xyz");
    expect(settleArgs.reason).toContain("myr_minor:4166");
    // 台账另一口径:按 FX_PIN(4.5)折 USD = 41.66 / 4.5 ≈ 9.26。
    expect(settleArgs.reason).toContain("usd:9.26");
    expect(refundReservation).not.toHaveBeenCalled();
  });

  it("首次预扣把这张单的事实钉进 RESERVE 行的 reason(账本只追加 ⇒ 此后不可改)", async () => {
    await refundCreditsAction(payload());
    expect(reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, refId: REF_ID, cost: 100 * INTERNAL_PER_DISPLAY, reason: FACTS }),
    );
  });

  it("马币按**该包实付单价**换算,不是面值(Pro 包退 100cr = RM41.66,不是 RM45)", async () => {
    await refundCreditsAction(payload());
    expect(refundsCreate).toHaveBeenCalledWith({ payment_intent: PI, amount: 4166 }, { idempotencyKey: REF_ID });
  });
});

// ── 判官 P1-1:动 Stripe 之前先证明 org / 付款 / 包 是一伙的 ────────────────────────
describe("MONEY-A14 — 付款归属与金额核对(P1-1)", () => {
  it("PI 属于别的 org ⇒ 拒退,零账本写入,Stripe 一次都不碰", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "myr", metadata: { orgId: "org_someone_else" } });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("different workspace") });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("PI 没有 metadata ⇒ 回落 Checkout Session 的 metadata.orgId(老付款走这条)", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "myr", metadata: {} });
    sessionsList.mockResolvedValue({ data: [{ id: "cs_1", metadata: { orgId: ORG } }] });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ ok: true, status: "settled" });
    expect(sessionsList).toHaveBeenCalledWith({ payment_intent: PI, limit: 1 });
  });

  it("session 也没有 orgId ⇒ 用账本的 stripe:<sessionId> 幂等键反查", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "myr", metadata: {} });
    sessionsList.mockResolvedValue({ data: [{ id: "cs_1", metadata: {}, client_reference_id: null }] });
    creditLedgerFindFirst.mockResolvedValue({ id: "led_1" });
    const result = await refundCreditsAction(payload());
    expect(creditLedgerFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: ORG, idempotencyKey: "stripe:cs_1" } }));
    expect(result).toMatchObject({ ok: true, status: "settled" });
  });

  it("三条路都问不出归属 ⇒ 拒退(不许猜一个就退钱)", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "myr", metadata: {} });
    sessionsList.mockResolvedValue({ data: [] });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("Could not prove") });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("选错包(PI 实收与包价对不上)⇒ 拒退", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: 2_500, amount_received: 2_500, currency: "myr", metadata: { orgId: ORG } });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("not the Pro") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("币种对不上 ⇒ 拒退", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "usd", metadata: { orgId: ORG } });
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("USD") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("这笔付款已经退掉大半 ⇒ 超出剩余额度的退款被拒(同一笔不许退两次)", async () => {
    refundsList.mockResolvedValue({ data: [{ amount: 24_000, status: "succeeded" }] });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("left to refund") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("失败/取消的历史退款不占额度(钱没出去)", async () => {
    refundsList.mockResolvedValue({ data: [{ amount: 24_000, status: "failed" }, { amount: 24_000, status: "canceled" }] });
    expect(await refundCreditsAction(payload())).toMatchObject({ ok: true, status: "settled" });
  });

  it("读不到已退金额 ⇒ fail closed(宁可让人去 Dashboard 看)", async () => {
    refundsList.mockRejectedValue(new Error("stripe down"));
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("existing refunds") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});

// ── 判官 P1-2:只有 succeeded 才落账 ──────────────────────────────────────────────
describe("MONEY-A14 — pending 不是成功(P1-2)", () => {
  it("pending ⇒ **保持 hold**、落审计行、三通道报警,绝不落账", async () => {
    refundsCreate.mockResolvedValue({ id: "re_pending", status: "pending" });
    const result = await refundCreditsAction(payload());
    expect(result).toEqual({ ok: true, status: "pending", refundId: "re_pending", displayedAmount: 100, amountMinor: 4166 });
    expect(settleCredits).not.toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: ORG, type: `manual-refund-pending:${TICKET}` }) }),
    );
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.manual_refund_pending" }));
  });

  it("requires_action 同样只算受理中", async () => {
    refundsCreate.mockResolvedValue({ id: "re_ra", status: "requires_action" });
    expect(await refundCreditsAction(payload())).toMatchObject({ status: "pending" });
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("completeManualRefund:重读 Stripe = succeeded ⇒ 落账,不发第二笔退款", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_pending" } });
    refundsRetrieve.mockResolvedValue({ id: "re_pending", status: "succeeded" });

    const result = await completeManualRefund({ orgId: ORG, refundId: TICKET });

    expect(refundsRetrieve).toHaveBeenCalledWith("re_pending");
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(settleCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refId: REF_ID, reason: expect.stringContaining("re_pending") }));
    expect(result).toMatchObject({ ok: true, status: "settled", amountMinor: 4166 });
  });

  it("completeManualRefund:Stripe 说 failed ⇒ 成对释放,余额净变 0", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_pending" } });
    refundsRetrieve.mockResolvedValue({ id: "re_pending", status: "failed" });

    const result = await completeManualRefund({ orgId: ORG, refundId: TICKET });

    expect(result).toMatchObject({ error: expect.stringContaining("failed") });
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF_ID, reason: "manual-refund:stripe-failed" });
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("completeManualRefund:还在 pending ⇒ 如实说还在等,什么都不动", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_pending" } });
    refundsRetrieve.mockResolvedValue({ id: "re_pending", status: "pending" });

    expect(await completeManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ status: "pending" });
    expect(settleCredits).not.toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
  });

  it("completeManualRefund:没有记下 Stripe 单号 ⇒ 拒绝(再发一次会退第二笔)", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    expect(await completeManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ error: expect.stringContaining("No Stripe refund id") });
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("completeManualRefund:没有开着的 hold ⇒ 明说,不猜", async () => {
    noLedgerRows();
    expect(await completeManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ error: expect.stringContaining("No open refund") });
  });
});

describe("MONEY-A14 — 失败与成对释放", () => {
  it("Stripe **明确拒绝**(业务级错误)⇒ REFUND 成对释放,余额净变 0,永不落账", async () => {
    refundsCreate.mockRejectedValue(Object.assign(new Error("No such payment_intent"), { type: "StripeInvalidRequestError", statusCode: 400 }));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("released") });
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF_ID, reason: "manual-refund:stripe-failed" });
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("Stripe **答案不明**(超时 / 5xx / 幂等键撞参数)⇒ 预扣**留着** + 报警,绝不释放", async () => {
    for (const thrown of [
      new Error("socket hang up"),
      Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
      Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError", statusCode: 400 }),
    ]) {
      vi.clearAllMocks();
      requireRole.mockResolvedValue(GATE);
      activeMerchantOrg.mockResolvedValue({ id: ORG });
      noLedgerRows();
      reserveCredits.mockResolvedValue(undefined);
      assertWithinAdjustWindow.mockResolvedValue(undefined);
      paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PRO_PACK_MINOR, amount_received: PRO_PACK_MINOR, currency: "myr", metadata: { orgId: ORG } });
      refundsList.mockResolvedValue({ data: [] });
      refundsCreate.mockRejectedValue(thrown);

      const result = await refundCreditsAction(payload());

      expect(result, thrown.message).toMatchObject({ error: expect.stringContaining("stay held") });
      expect(refundReservation, thrown.message).not.toHaveBeenCalled();
      expect(settleCredits, thrown.message).not.toHaveBeenCalled();
      expect(founderAlert, thrown.message).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.manual_refund_outcome_unknown" }));
    }
  });

  it("落账失败 ⇒ 报警 + 让操作员用**同一个**退款单号重跑(Stripe 幂等,不会退两次)", async () => {
    settleCredits.mockRejectedValue(new Error("db down"));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("SAME refund id") });
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.manual_refund_settle_failed" }));
  });

  it("余额不足 ⇒ 拒退,Stripe 退款一次都不发", async () => {
    reserveCredits.mockRejectedValue(new MockInsufficientCredits("nope"));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("Not enough unused credits") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("allowPartial ⇒ 按余额能覆盖的部分退,事实按**实际扣的数**钉(退 40cr = RM16.66)", async () => {
    creditAccountFindUnique.mockResolvedValue({ balance: 40 * INTERNAL_PER_DISPLAY });
    const result = await refundCreditsAction(payload({ allowPartial: true }));
    expect(reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cost: 40 * INTERNAL_PER_DISPLAY, reason: `pi:${PI}|pack:600|credits:40|myr_minor:1666` }),
    );
    expect(result).toMatchObject({ ok: true, status: "settled", displayedAmount: 40, amountMinor: 1666 });
  });

  it("allowPartial 但余额为 0 ⇒ 拒退(0 credits 的退款是不存在的东西)", async () => {
    creditAccountFindUnique.mockResolvedValue({ balance: 0 });
    const result = await refundCreditsAction(payload({ allowPartial: true }));
    expect(result).toMatchObject({ error: expect.stringContaining("no credits left") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("撞上 30 天累计闸 ⇒ 拒退并报警(退款与调账共用同一个额度)", async () => {
    assertWithinAdjustWindow.mockRejectedValue(new MockFinanceAdjustBlocked("over"));
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("2,000") });
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.adjust_window_blocked" }));
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 幂等与事实固化", () => {
  it("同一个退款单号已落账 ⇒ 如实回答「已经退过」,Stripe 一次都不碰", async () => {
    creditLedgerFindMany.mockResolvedValue([
      { kind: "RESERVE", reason: FACTS, reservedDelta: 100 * INTERNAL_PER_DISPLAY },
      { kind: "SETTLE", reason: "stripe-refund:re_1Xyz myr_minor:4166 usd:9.26", reservedDelta: 0 },
    ]);
    // 换个包重放:报的仍然是**当时**退的那一笔,不是拿新参数重算。
    const result = await refundCreditsAction(payload({ packCredits: 50 }));
    expect(result).toEqual({ ok: true, status: "already-settled", refundId: "re_1Xyz", displayedAmount: 100, amountMinor: 4166 });
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
  });

  it("上次在 Stripe 之后断了(只有预扣)⇒ 接着跑,不再预扣第二次,也不再核一次 PI", async () => {
    openHold();
    const result = await refundCreditsAction(payload());
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).toHaveBeenCalledWith({ payment_intent: PI, amount: 4166 }, { idempotencyKey: REF_ID });
    expect(result).toMatchObject({ ok: true, status: "settled", refundId: "re_1Xyz" });
  });

  it("续跑时换了包或换了付款 ⇒ 拒绝(不许拿新参数去续跑一个旧 hold)", async () => {
    openHold();
    expect(await refundCreditsAction(payload({ packCredits: 50 }))).toMatchObject({ error: expect.stringContaining("already bound to") });
    expect(await refundCreditsAction(payload({ paymentIntentId: "pi_OTHER" }))).toMatchObject({ error: expect.stringContaining("already bound to") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("hold 上的事实读不出来 ⇒ 停手让人去看账本,不猜一个金额", async () => {
    openHold("something-unparseable");
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("could not be read") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("并发双击(P2-1):输的那一笔撞唯一键 ⇒ 读回既有事实继续,两次都得到一致答案", async () => {
    // 第一次读账本:两边都看到「什么都还没有」;预扣时其中一次撞 P2002,随后重读拿到 hold。
    creditLedgerFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ kind: "RESERVE", reason: FACTS, reservedDelta: 100 * INTERNAL_PER_DISPLAY }]);
    let first = true;
    reserveCredits.mockImplementation(async () => {
      if (first) { first = false; return; }
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });

    const [a, b] = await Promise.all([refundCreditsAction(payload()), refundCreditsAction(payload())]);

    for (const result of [a, b]) {
      expect(result).toMatchObject({ ok: true, status: "settled", refundId: "re_1Xyz", amountMinor: 4166 });
    }
    // 只有一条预扣真的写进去了(另一条撞键回滚),而两次调用都没有第二笔退款。
    expect(refundsCreate).toHaveBeenCalledTimes(2);
    for (const call of refundsCreate.mock.calls) expect(call[1]).toEqual({ idempotencyKey: REF_ID });
  });

  it("这个单号已经成对释放过 ⇒ 不许在它上面接着退", async () => {
    creditLedgerFindMany.mockResolvedValue([
      { kind: "RESERVE", reason: FACTS, reservedDelta: 1000 },
      { kind: "REFUND", reason: "manual-refund:stripe-failed", reservedDelta: -1000 },
    ]);
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("already released") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 门与入参", () => {
  it("没有 tenants.mutate ⇒ 一步都不走(两个动作都是)", async () => {
    requireRole.mockResolvedValue({ error: "You don't have access to this." });
    expect(await refundCreditsAction(payload())).toEqual({ error: "You don't have access to this." });
    expect(await completeManualRefund({ orgId: ORG, refundId: TICKET })).toEqual({ error: "You don't have access to this." });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
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
    expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
  });

  it("单笔上限沿用同一个单一源(1000 显示 credits)", async () => {
    expect(await refundCreditsAction(payload({ displayedAmount: 1001 }))).toEqual({
      error: "Credit actions are capped at 1,000 displayed credits each.",
    });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});
