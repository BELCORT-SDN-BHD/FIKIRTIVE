/**
 * MONEY-A14 —— 人工退款(规格 §7.6,Founder 2026-09-01 改签 v2;判官两轮复审落修)。
 *
 * 钉的是:**单价由那笔付款的事实推导**(不是操作员选的包)、顺序、成对、事实不可改、
 * 只有 succeeded 才落账、收口凭据活过刷新。Stripe 全部走注入的 stub,一分钱不出门。
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
const creditLedgerFindFirst = vi.fn();
const actionEventCreate = vi.fn();
const actionEventFindFirst = vi.fn();
const reserveCredits = vi.fn();
const settleCredits = vi.fn();
const refundReservation = vi.fn();
const assertWithinAdjustWindow = vi.fn();
const creditAccountFindUnique = vi.fn();

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

const { refundCreditsAction, completeManualRefund, abandonManualRefund } = await import("@/lib/refund-actions");

const ORG = "org_merchant_1";
const GATE = { email: "founder@fikirtive.com", roles: ["super-admin"], role: "super-admin" };
const PI = "pi_3QabcDEF";
const SESSION = "cs_test_1";
const TICKET = "refund-ticket-0001";
const REF_ID = `manual-refund:${TICKET}`;
/** Stripe 幂等键**带 org**(复审三 P2):账本唯一键里有 org,Stripe 那边没有。 */
const STRIPE_KEY = `manual-refund:${ORG}:${TICKET}`;
/** 今天的 Pro 包:RM250 → 600 显示 credits(= 6000 internal)。 */
const PAID_MINOR = 25_000;
const CREDITED_INTERNAL = 600 * INTERNAL_PER_DISPLAY;
/** 退 100 显示 credits = 1000 internal ⇒ ⌊1000 × 25000 ÷ 6000⌋ = 4166 仙。 */
const EXPECTED_MINOR = 4166;
/** 首次预扣钉进 RESERVE 行的那份事实(整数单位)。 */
const PIN = `pi:${PI}|req:1000|held:1000|minor:${EXPECTED_MINOR}|cur:myr|partial:0`;

/** Stripe 列表的一页(默认没有下一页)。 */
function page(data: unknown[] = [], has_more = false) {
  return { data, has_more };
}

function payload(over: Record<string, unknown> = {}) {
  return { orgId: ORG, displayedAmount: 100, paymentIntentId: PI, refundId: TICKET, ...over };
}

function noLedgerRows() {
  creditLedgerFindMany.mockResolvedValue([]);
}
/** 账本上「预扣已经在了」(断点续跑 / 并发的输家看到的那一幕)。 */
function openHold(reason = PIN, heldInternal = 1000) {
  creditLedgerFindMany.mockResolvedValue([{ kind: "RESERVE", reason, reservedDelta: heldInternal }]);
}
/** 这笔付款当初入账了多少 credits(账本那一行 GRANT)。 */
function grantedCredits(internal: number | null) {
  creditLedgerFindFirst.mockResolvedValue(internal === null ? null : { balanceDelta: internal });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue(GATE);
  activeMerchantOrg.mockResolvedValue({ id: ORG });
  noLedgerRows();
  grantedCredits(CREDITED_INTERNAL);
  actionEventCreate.mockResolvedValue({});
  actionEventFindFirst.mockResolvedValue(null);
  reserveCredits.mockResolvedValue(undefined);
  settleCredits.mockResolvedValue(undefined);
  refundReservation.mockResolvedValue("refunded");
  assertWithinAdjustWindow.mockResolvedValue(undefined);
  paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "myr", metadata: { orgId: ORG } });
  sessionsList.mockResolvedValue(page([{ id: SESSION, metadata: { orgId: ORG, credits: "600" } }]));
  refundsList.mockResolvedValue(page());
  refundsCreate.mockResolvedValue({ id: "re_1Xyz", status: "succeeded" });
  refundsRetrieve.mockResolvedValue({ id: "re_1Xyz", status: "succeeded", payment_intent: PI, metadata: { manualRefundId: TICKET, orgId: ORG } });
});

describe("MONEY-A14 — 单价由付款事实推导(复审二 P1-1)", () => {
  it("顺序=先查事实、再预扣、后 Stripe、最后落账;SETTLE 行 reason 载 re_…", async () => {
    const order: string[] = [];
    paymentIntentsRetrieve.mockImplementation(async () => { order.push("verify"); return { id: PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "myr", metadata: { orgId: ORG } }; });
    reserveCredits.mockImplementation(async () => { order.push("reserve"); });
    refundsCreate.mockImplementation(async () => { order.push("stripe"); return { id: "re_1Xyz", status: "succeeded" }; });
    settleCredits.mockImplementation(async () => { order.push("settle"); });

    const result = await refundCreditsAction(payload());

    expect(result).toEqual({ ok: true, status: "settled", refundId: "re_1Xyz", displayedAmount: 100, amountMinor: EXPECTED_MINOR });
    expect(order).toEqual(["verify", "reserve", "stripe", "settle"]);
    const settleArgs = settleCredits.mock.calls[0]![1] as { reason: string; refId: string };
    expect(settleArgs.refId).toBe(REF_ID);
    expect(settleArgs.reason).toContain("re_1Xyz");
    expect(settleArgs.reason).toContain(`myr_minor:${EXPECTED_MINOR}`);
    expect(settleArgs.reason).toContain("usd:9.26"); // 41.66 ÷ FX_PIN 4.5
  });

  it("**同额不同包**:RM250 换 500cr 的历史包,单价按账本事实算,不按今天的 Pro 包", async () => {
    // 这正是上一版会算错 20% 的那一档:金额与今天的 Pro 包一模一样,入账 credits 不同。
    grantedCredits(500 * INTERNAL_PER_DISPLAY);
    sessionsList.mockResolvedValue(page([{ id: SESSION, metadata: { orgId: ORG, credits: "500" } }]));

    const result = await refundCreditsAction(payload());

    // ⌊1000 × 25000 ÷ 5000⌋ = 5000 仙(RM50.00),而不是按 600cr 算出来的 4166。
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: PI, amount: 5_000 }),
      { idempotencyKey: STRIPE_KEY },
    );
    expect(result).toMatchObject({ ok: true, amountMinor: 5_000 });
  });

  it("Session 说的 credits 与账本 GRANT 不一致 ⇒ 拒(记账本身有问题,不许在上面叠退款)", async () => {
    sessionsList.mockResolvedValue(page([{ id: SESSION, metadata: { orgId: ORG, credits: "500" } }]));
    grantedCredits(600 * INTERNAL_PER_DISPLAY);
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("Refusing until that is reconciled") });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("账本上根本没有这笔付款的 GRANT ⇒ 拒(它从没入过账)", async () => {
    grantedCredits(null);
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ error: expect.stringContaining("never credited this workspace") });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("查不到 Checkout Session ⇒ 拒(没有反查入账记录的钥匙)", async () => {
    sessionsList.mockResolvedValue(page([]));
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("Could not find the checkout") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("credits 上限:申请数 > 这笔付款还能退的 credits ⇒ 拒", async () => {
    // 已退 RM125 = 一半 ⇒ 还能退 300 显示 credits;申请 400 超了。
    refundsList.mockResolvedValue(page([{ id: "re_old", amount: 12_500, status: "succeeded" }]));
    const result = await refundCreditsAction(payload({ displayedAmount: 400 }));
    expect(result).toMatchObject({ error: expect.stringContaining("credits left to refund") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("PI 属于别的 org ⇒ 拒;session 归属对不上也拒", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "myr", metadata: { orgId: "org_other" } });
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("different workspace") });

    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "myr", metadata: {} });
    sessionsList.mockResolvedValue(page([{ id: SESSION, metadata: { orgId: "org_other" } }]));
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("different workspace") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("PI/Session 都没有 orgId ⇒ 归属由账本那一行 GRANT 证明(它是按 orgId 查出来的)", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "myr", metadata: {} });
    sessionsList.mockResolvedValue(page([{ id: SESSION, metadata: {}, client_reference_id: null }]));
    expect(await refundCreditsAction(payload())).toMatchObject({ ok: true, status: "settled" });
    expect(creditLedgerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG, idempotencyKey: `stripe:${SESSION}`, kind: "GRANT" } }),
    );
  });

  it("币种对不上 ⇒ 拒", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "usd", metadata: { orgId: ORG } });
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("USD") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — Stripe 列表必须翻完每一页(复审二 P2-1)", () => {
  it("has_more 为真就接着翻,已退金额按**全部**页算", async () => {
    refundsList
      .mockResolvedValueOnce(page([{ id: "re_a", amount: 12_000, status: "succeeded" }], true))
      .mockResolvedValueOnce(page([{ id: "re_b", amount: 12_000, status: "succeeded" }], false));
    // 两页合计 RM240 已退 ⇒ 只剩 RM10 = 24 显示 credits,申请 100 必须被拒。
    const result = await refundCreditsAction(payload());
    expect(refundsList).toHaveBeenCalledTimes(2);
    expect(refundsList.mock.calls[1]![0]).toMatchObject({ starting_after: "re_a" });
    expect(result).toMatchObject({ error: expect.stringContaining("left to refund") });
  });
});

// ── 复审三:七条落修 ─────────────────────────────────────────────────────────
describe("MONEY-A14 — 翻页到上限仍有下一页 ⇒ fail closed(复审三 P2)", () => {
  it("不返回部分结果:整个动作拒绝,零账本写入", async () => {
    // 每一页都说「还有下一页」:翻到防呆上限也翻不完。
    refundsList.mockResolvedValue(page([{ id: "re_x", amount: 1, status: "succeeded" }], true));

    const result = await refundCreditsAction(payload());

    expect(result).toMatchObject({ error: expect.stringContaining("Could not read existing refunds") });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("找回那笔退款时同样 fail closed —— Abandon 不许在看不全的清单上放掉 hold", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([{ id: "re_x", amount: 1, status: "succeeded" }], true));

    const result = await abandonManualRefund({ orgId: ORG, refundId: TICKET });

    expect(result).toMatchObject({ error: expect.stringContaining("Could not search") });
    expect(refundReservation).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 实收为 0 的付款不能退(复审三 P2)", () => {
  it("amount 有值但 amount_received=0 ⇒ 拒,账本零写入", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PAID_MINOR, amount_received: 0, currency: "myr", metadata: { orgId: ORG } });

    const result = await refundCreditsAction(payload());

    expect(result).toMatchObject({ error: expect.stringContaining("nothing received") });
    expect(reserveCredits).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 一笔付款命中多个 Checkout Session ⇒ 歧义,拒(复审三 P2)", () => {
  it("不许在几个 session 里随便挑一个去反查入账 credits", async () => {
    sessionsList.mockResolvedValue(page([
      { id: "cs_a", metadata: { orgId: ORG, credits: "600" } },
      { id: "cs_b", metadata: { orgId: ORG, credits: "500" } },
    ]));

    const result = await refundCreditsAction(payload());

    expect(sessionsList).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
    expect(result).toMatchObject({ error: expect.stringContaining("multiple checkout sessions") });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 审计行只是指针,不是证据(复审三 P2)", () => {
  it.each([
    ["付款对不上", { id: "re_other", status: "succeeded", payment_intent: "pi_someone_else", metadata: { manualRefundId: TICKET, orgId: ORG } }],
    ["单号对不上", { id: "re_other", status: "succeeded", payment_intent: PI, metadata: { manualRefundId: "other-ticket", orgId: ORG } }],
    ["租户对不上", { id: "re_other", status: "succeeded", payment_intent: PI, metadata: { manualRefundId: TICKET, orgId: "org_other" } }],
  ])("审计行指向的退款 %s ⇒ 拒,既不落账也不释放", async (_label, refund) => {
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_other" } });
    refundsRetrieve.mockResolvedValue(refund);

    const result = await completeManualRefund({ orgId: ORG, refundId: TICKET });

    expect(result).toMatchObject({ error: expect.stringContaining("does not match this ticket") });
    expect(settleCredits).not.toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — Stripe 幂等键必须带 org(复审三 P2)", () => {
  it("两个 org 用同一个 uuid 各自成功,拿到的是**两把不同的**幂等键", async () => {
    const OTHER = "org_merchant_2";
    const OTHER_PI = "pi_3QotherXYZ";
    await refundCreditsAction(payload());

    // 第二个租户,**同一个 uuid**(操作员复制粘贴、脚本重放,都真的会发生)。
    activeMerchantOrg.mockResolvedValue({ id: OTHER });
    noLedgerRows();
    paymentIntentsRetrieve.mockResolvedValue({ id: OTHER_PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "myr", metadata: { orgId: OTHER } });
    sessionsList.mockResolvedValue(page([{ id: "cs_test_2", metadata: { orgId: OTHER, credits: "600" } }]));
    await refundCreditsAction(payload({ orgId: OTHER, paymentIntentId: OTHER_PI }));

    const keys = refundsCreate.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual([`manual-refund:${ORG}:${TICKET}`, `manual-refund:${OTHER}:${TICKET}`]);
    expect(new Set(keys).size).toBe(2);
    // 账本那一侧的 refId 反过来**不带** org —— 它的唯一键 (orgId, refId) 里已经有了。
    for (const call of reserveCredits.mock.calls) expect(call[1]).toMatchObject({ refId: REF_ID });
    // metadata 里两笔各自认自己的 org。
    expect(refundsCreate.mock.calls.map((call) => (call[0] as { metadata: { orgId: string } }).metadata.orgId)).toEqual([ORG, OTHER]);
  });
});

describe("MONEY-A14 — 事实钉在账本,单位是整数 internal(复审二 P2-2)", () => {
  it("首次预扣把整数事实钉进 RESERVE 行 reason", async () => {
    await refundCreditsAction(payload());
    expect(reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, refId: REF_ID, cost: 1000, reason: PIN }),
    );
  });

  it("allowPartial 扣出非 10 倍数的 internal(40.5 credits)也**往返不丢**", async () => {
    creditAccountFindUnique.mockResolvedValue({ balance: 405 }); // 40.5 显示 credits
    const result = await refundCreditsAction(payload({ allowPartial: true }));
    // ⌊405 × 25000 ÷ 6000⌋ = 1687 仙。钉进去的是整数 internal,不是被 \d+ 截断的 "40"。
    expect(reserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cost: 405, reason: `pi:${PI}|req:1000|held:405|minor:1687|cur:myr|partial:1` }),
    );
    expect(result).toMatchObject({ ok: true, displayedAmount: 40.5, amountMinor: 1687 });

    // 同一张单续跑:读回来的仍然是 40.5 与 1687(旧写法会读成 40)。
    vi.clearAllMocks();
    requireRole.mockResolvedValue(GATE);
    activeMerchantOrg.mockResolvedValue({ id: ORG });
    openHold(`pi:${PI}|req:1000|held:405|minor:1687|cur:myr|partial:1`, 405);
    refundsCreate.mockResolvedValue({ id: "re_1Xyz", status: "succeeded" });
    settleCredits.mockResolvedValue(undefined);
    const resumed = await refundCreditsAction(payload({ allowPartial: true }));
    expect(refundsCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 1687 }), { idempotencyKey: STRIPE_KEY });
    expect(resumed).toMatchObject({ ok: true, displayedAmount: 40.5, amountMinor: 1687 });
  });
});

describe("MONEY-A14 — 续跑先查后建(复审四 P1)", () => {
  it("旧键已在 Stripe 建过单、本地超时:同单号重跑**不再 create**,直接按它的状态落账", async () => {
    // 账本上 hold 还在(第一趟没走完),Stripe 上其实已经有一笔成功的退款。
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([
      { id: "re_from_old_key", amount: EXPECTED_MINOR, status: "succeeded", metadata: { manualRefundId: TICKET, orgId: ORG } },
    ]));

    const result = await refundCreditsAction(payload());

    // 幂等键换过、或者过了 24 小时,create 都会被 Stripe 当成全新一笔 —— 所以这里根本不许 create。
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(settleCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refId: REF_ID, reason: expect.stringContaining("re_from_old_key") }));
    expect(result).toMatchObject({ ok: true, status: "settled", amountMinor: EXPECTED_MINOR });
  });

  it("续跑时 Stripe 上那笔是 failed ⇒ 成对释放,同样不 create", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_dead" } });
    refundsRetrieve.mockResolvedValue({ id: "re_dead", status: "failed", payment_intent: PI, metadata: { manualRefundId: TICKET, orgId: ORG } });

    const result = await refundCreditsAction(payload());

    expect(refundsCreate).not.toHaveBeenCalled();
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF_ID, reason: "manual-refund:stripe-failed" });
    expect(result).toMatchObject({ error: expect.stringContaining("failed") });
  });

  it("超过 24 小时的 hold 重跑、而 Stripe 上确实没有那一笔 ⇒ 才 create,且只 create 一次", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([]));

    const result = await refundCreditsAction(payload());

    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, status: "settled" });
  });

  it("查找看不全(翻页到上限仍有下一页)⇒ 整趟拒绝,绝不在瞎猜的基础上 create", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([{ id: "re_x", amount: 1, status: "succeeded" }], true));

    const result = await refundCreditsAction(payload());

    expect(result).toMatchObject({ error: expect.stringContaining("Could not search") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("首次(账本上还没有 hold)不做这次查找 —— 它自己就是第一笔", async () => {
    noLedgerRows();

    await refundCreditsAction(payload());

    // 只有「还能退多少」那一次列表调用,没有第二次找回调用。
    expect(refundsList).toHaveBeenCalledTimes(1);
    expect(refundsCreate).toHaveBeenCalledTimes(1);
  });
});

describe("MONEY-A14 — 同一单号的参数漂移一律拒绝(复审二 P2-3)", () => {
  it("① 续跑时改了付款 / 改了额度 / 改了 partial ⇒ 三样都拒", async () => {
    openHold();
    expect(await refundCreditsAction(payload({ paymentIntentId: "pi_OTHER" }))).toMatchObject({ error: expect.stringContaining("already opened for") });
    expect(await refundCreditsAction(payload({ displayedAmount: 50 }))).toMatchObject({ error: expect.stringContaining("already opened for") });
    expect(await refundCreditsAction(payload({ allowPartial: true }))).toMatchObject({ error: expect.stringContaining("already opened for") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("② 并发输家(撞唯一键)重读之后也比对事实,漂移照拒", async () => {
    creditLedgerFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ kind: "RESERVE", reason: PIN, reservedDelta: 1000 }]);
    reserveCredits.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const result = await refundCreditsAction(payload({ displayedAmount: 50 }));
    expect(result).toMatchObject({ error: expect.stringContaining("already opened for") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("③ 已落账的单号被拿去退另一笔付款 ⇒ 拒,而不是回一句「已经退过了」", async () => {
    creditLedgerFindMany.mockResolvedValue([
      { kind: "RESERVE", reason: PIN, reservedDelta: 1000 },
      { kind: "SETTLE", reason: `stripe-refund:re_1Xyz myr_minor:${EXPECTED_MINOR} usd:9.26`, reservedDelta: 0 },
    ]);
    expect(await refundCreditsAction(payload({ paymentIntentId: "pi_OTHER" }))).toMatchObject({ error: expect.stringContaining("already opened for") });
    // 参数一致时才回「已经退过了」。
    expect(await refundCreditsAction(payload())).toEqual({
      ok: true, status: "already-settled", refundId: "re_1Xyz", displayedAmount: 100, amountMinor: EXPECTED_MINOR,
    });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("并发输家参数一致 ⇒ 读回既有事实继续,两次点击答案一致", async () => {
    creditLedgerFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ kind: "RESERVE", reason: PIN, reservedDelta: 1000 }]);
    let first = true;
    reserveCredits.mockImplementation(async () => {
      if (first) { first = false; return; }
      throw Object.assign(new Error("dup"), { code: "P2002" });
    });
    const [a, b] = await Promise.all([refundCreditsAction(payload()), refundCreditsAction(payload())]);
    for (const result of [a, b]) expect(result).toMatchObject({ ok: true, status: "settled", amountMinor: EXPECTED_MINOR });
    for (const call of refundsCreate.mock.calls) expect(call[1]).toEqual({ idempotencyKey: STRIPE_KEY });
  });
});

describe("MONEY-A14 — pending 不是成功,收口凭据活过刷新(复审 P1-2 / 复审二 P1-2)", () => {
  it("pending ⇒ 保持 hold、落审计行、报警;Stripe 退款带 metadata.manualRefundId", async () => {
    refundsCreate.mockResolvedValue({ id: "re_pending", status: "pending" });
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ ok: true, status: "pending", refundId: "re_pending", auditRecorded: true });
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { manualRefundId: TICKET, orgId: ORG } }),
      { idempotencyKey: STRIPE_KEY },
    );
    expect(settleCredits).not.toHaveBeenCalled();
    expect(refundReservation).not.toHaveBeenCalled();
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.manual_refund_pending" }));
  });

  it("审计行写失败**不再静默**:结果带 auditRecorded:false", async () => {
    refundsCreate.mockResolvedValue({ id: "re_pending", status: "pending" });
    actionEventCreate.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await refundCreditsAction(payload());
    expect(result).toMatchObject({ status: "pending", auditRecorded: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("complete:没有审计行时,经 Stripe 的 metadata.manualRefundId 找回那笔退款", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([
      { id: "re_someone_else", amount: 100, status: "succeeded", metadata: { manualRefundId: "other-ticket" } },
      { id: "re_ours", amount: EXPECTED_MINOR, status: "succeeded", metadata: { manualRefundId: TICKET, orgId: ORG } },
    ]));

    const result = await completeManualRefund({ orgId: ORG, refundId: TICKET });

    expect(refundsCreate).not.toHaveBeenCalled();
    expect(settleCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refId: REF_ID, reason: expect.stringContaining("re_ours") }));
    expect(result).toMatchObject({ ok: true, status: "settled", amountMinor: EXPECTED_MINOR });
  });

  it("complete:审计行在就直接 retrieve;succeeded 落账 / failed 释放 / pending 原样等", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_pending" } });

    refundsRetrieve.mockResolvedValue({ id: "re_pending", status: "succeeded", payment_intent: PI, metadata: { manualRefundId: TICKET, orgId: ORG } });
    expect(await completeManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ status: "settled" });
    expect(refundsRetrieve).toHaveBeenCalledWith("re_pending");

    vi.clearAllMocks();
    requireRole.mockResolvedValue(GATE);
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_pending" } });
    refundsRetrieve.mockResolvedValue({ id: "re_pending", status: "failed", payment_intent: PI, metadata: { manualRefundId: TICKET, orgId: ORG } });
    refundReservation.mockResolvedValue("refunded");
    expect(await completeManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ error: expect.stringContaining("failed") });
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF_ID, reason: "manual-refund:stripe-failed" });

    vi.clearAllMocks();
    requireRole.mockResolvedValue(GATE);
    openHold();
    actionEventFindFirst.mockResolvedValue({ payload: { stripeRefundId: "re_pending" } });
    refundsRetrieve.mockResolvedValue({ id: "re_pending", status: "pending", payment_intent: PI, metadata: { manualRefundId: TICKET, orgId: ORG } });
    expect(await completeManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ status: "pending" });
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("complete:Stripe 两处都找不到 ⇒ **什么都不动**,指向 Abandon", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([]));
    const result = await completeManualRefund({ orgId: ORG, refundId: TICKET });
    expect(result).toMatchObject({ error: expect.stringContaining("use Abandon") });
    expect(refundReservation).not.toHaveBeenCalled();
    expect(settleCredits).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — Abandon 两态(复审二 P1-2c)", () => {
  it("Stripe 上确实没有这笔退款 ⇒ 释放 hold,账本成对", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([]));

    const result = await abandonManualRefund({ orgId: ORG, refundId: TICKET });

    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF_ID, reason: "manual-refund:abandoned" });
    expect(result).toMatchObject({ ok: true, status: "abandoned", displayedAmount: 100 });
  });

  it("Stripe 上**存在**这笔退款 ⇒ 拒绝放弃(钱可能已经出去了),指向 Complete", async () => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([{ id: "re_live", amount: EXPECTED_MINOR, status: "pending", metadata: { manualRefundId: TICKET, orgId: ORG } }]));

    const result = await abandonManualRefund({ orgId: ORG, refundId: TICKET });

    expect(result).toMatchObject({ error: expect.stringContaining("cannot be abandoned") });
    expect(refundReservation).not.toHaveBeenCalled();
  });

  it.each(["failed", "canceled"])("Stripe 说那笔退款是 %s ⇒ 钱没出去,hold 成对释放(复审三 P2)", async (status) => {
    openHold();
    actionEventFindFirst.mockResolvedValue(null);
    refundsList.mockResolvedValue(page([{ id: "re_dead", amount: EXPECTED_MINOR, status, metadata: { manualRefundId: TICKET, orgId: ORG } }]));

    const result = await abandonManualRefund({ orgId: ORG, refundId: TICKET });

    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF_ID, reason: "manual-refund:stripe-failed" });
    expect(result).toMatchObject({ ok: true, status: "released", refundId: "re_dead", displayedAmount: 100 });
  });

  it("没有开着的 hold / 已终结的单号 ⇒ 明说,不猜", async () => {
    noLedgerRows();
    expect(await abandonManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ error: expect.stringContaining("No open refund") });
    creditLedgerFindMany.mockResolvedValue([
      { kind: "RESERVE", reason: PIN, reservedDelta: 1000 },
      { kind: "REFUND", reason: "manual-refund:abandoned", reservedDelta: -1000 },
    ]);
    expect(await abandonManualRefund({ orgId: ORG, refundId: TICKET })).toMatchObject({ error: expect.stringContaining("already closed") });
  });
});

describe("MONEY-A14 — 失败与成对释放", () => {
  it("Stripe **明确拒绝** ⇒ REFUND 成对释放,永不落账", async () => {
    refundsCreate.mockRejectedValue(Object.assign(new Error("No such payment_intent"), { type: "StripeInvalidRequestError", statusCode: 400 }));
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("released") });
    expect(refundReservation).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, refId: REF_ID, reason: "manual-refund:stripe-failed" });
    expect(settleCredits).not.toHaveBeenCalled();
  });

  it("Stripe **答案不明**(超时 / 5xx / 幂等键撞参数)⇒ 预扣留着 + 报警,绝不释放", async () => {
    for (const thrown of [
      new Error("socket hang up"),
      Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
      Object.assign(new Error("Keys for idempotent requests…"), { type: "StripeIdempotencyError", statusCode: 400 }),
    ]) {
      vi.clearAllMocks();
      requireRole.mockResolvedValue(GATE);
      activeMerchantOrg.mockResolvedValue({ id: ORG });
      noLedgerRows();
      grantedCredits(CREDITED_INTERNAL);
      reserveCredits.mockResolvedValue(undefined);
      assertWithinAdjustWindow.mockResolvedValue(undefined);
      paymentIntentsRetrieve.mockResolvedValue({ id: PI, amount: PAID_MINOR, amount_received: PAID_MINOR, currency: "myr", metadata: { orgId: ORG } });
      sessionsList.mockResolvedValue(page([{ id: SESSION, metadata: { orgId: ORG, credits: "600" } }]));
      refundsList.mockResolvedValue(page());
      refundsCreate.mockRejectedValue(thrown);

      const result = await refundCreditsAction(payload());

      expect(result, thrown.message).toMatchObject({ error: expect.stringContaining("stay held") });
      expect(refundReservation, thrown.message).not.toHaveBeenCalled();
      expect(founderAlert, thrown.message).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.manual_refund_outcome_unknown" }));
    }
  });

  it("落账失败 ⇒ 报警 + 指向未收口列表(Stripe 幂等,不会退两次)", async () => {
    settleCredits.mockRejectedValue(new Error("db down"));
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("open holds list") });
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.manual_refund_settle_failed" }));
  });

  it("余额不足 ⇒ 拒退,Stripe 退款一次都不发", async () => {
    reserveCredits.mockRejectedValue(new MockInsufficientCredits("nope"));
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("Not enough unused credits") });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("撞上 30 天累计闸 ⇒ 拒退并报警", async () => {
    assertWithinAdjustWindow.mockRejectedValue(new MockFinanceAdjustBlocked("over"));
    expect(await refundCreditsAction(payload())).toMatchObject({ error: expect.stringContaining("2,000") });
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({ key: "finance.adjust_window_blocked" }));
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("MONEY-A14 — 门与入参", () => {
  it("没有 tenants.mutate ⇒ 三个动作一步都不走", async () => {
    requireRole.mockResolvedValue({ error: "You don't have access to this." });
    for (const call of [
      refundCreditsAction(payload()),
      completeManualRefund({ orgId: ORG, refundId: TICKET }),
      abandonManualRefund({ orgId: ORG, refundId: TICKET }),
    ]) {
      expect(await call).toEqual({ error: "You don't have access to this." });
    }
    expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("founder org / 未知 org / 负数 / 坏 pi / 坏单号一律当场拒", async () => {
    expect(await refundCreditsAction(payload({ orgId: "founder" }))).toMatchObject({ error: expect.stringContaining("merchant org") });
    activeMerchantOrg.mockResolvedValueOnce(null);
    expect(await refundCreditsAction(payload())).toMatchObject({ error: "Unknown or closed org." });
    expect(await refundCreditsAction(payload({ displayedAmount: -5 }))).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(await refundCreditsAction(payload({ paymentIntentId: "not-a-pi" }))).toMatchObject({ error: expect.stringContaining("pi_") });
    expect(await refundCreditsAction(payload({ refundId: "x" }))).toMatchObject({ error: "Invalid refund id." });
    expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
  });

  it("单笔上限沿用同一个单一源(1000 显示 credits)", async () => {
    expect(await refundCreditsAction(payload({ displayedAmount: 1001 }))).toEqual({
      error: "Credit actions are capped at 1,000 displayed credits each.",
    });
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});
