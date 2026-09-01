/**
 * stripe-reconcile-db.test.ts —— 钱路 M1-b ① 在**真库**上证。
 *
 * 被证的事实(审计 P1):商家的钱进了 Stripe、我们库里一行痕迹都没有时,此前没有任何东西在
 * 看 —— 2026-08-17 charles 那笔 RM25 是靠人肉发现的。
 *
 * 双向都钉,少一边这道闸就没有意义:
 *   ① **缺行必报** —— 已支付、账本没有 `stripe:<session.id>` 那一行 ⇒ 报警 + 留审计行。
 *   ② **有行不报** —— 已支付、账本有那一行 ⇒ 一声不吭(否则每一笔正常充值都会报警,告警
 *      在第一天就会被无视,那和没有告警是同一个结果)。
 *
 * 另外三条边界一起钉:未支付不算缺口、宽限期(刚成交的付款不冤枉)、**只报不补账**
 * (扫描前后余额与账本逐行不变)。
 *
 * MONEY-A12(规格 §7.5)加钉四件:报警走 founderAlert 三通道、同一缺口一天只吵一次人、
 * 缺口不随 48 小时扫描窗静默消失(持续追踪至了结)、首见判据读 firstSeenAt(#1046-P2)。
 *
 * 假 Stripe client 是注入的 —— 钱路的用例绝不打真 Stripe;报警管道同样是假的,一封信都不发。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({ founderAlert: vi.fn(), captureMoneyPathError: vi.fn() }));
vi.mock("../alerting.js", () => ({ founderAlert: m.founderAlert, captureMoneyPathError: m.captureMoneyPathError }));

import { prisma } from "@fikirtive/db";
import { RECONCILE_CLOSED_TYPE, RECONCILE_OBSERVED_TYPE, reconcileClosureId, reconcileObservationId } from "@fikirtive/core";
import {
  reconcileStripePayments,
  STRIPE_RECONCILE_CONFIRM_MS,
  STRIPE_RECONCILE_GRACE_MS,
  STRIPE_RECONCILE_MAX_PAGES,
  STRIPE_RECONCILE_WINDOW_MS,
  type StripeCheckoutSessionLike,
  type StripeSessionsPort,
} from "./stripe-reconcile.js";

// 同其它真库用例的守卫:绝不对着一个不是 *_test 的库跑。
const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

const DB_CASE_TIMEOUT_MS = 60_000;
const START = 100_000;
const NOW = new Date("2026-08-18T12:00:00.000Z");
/** 首见之后又过了一整个扫描窗 —— 这一刻起缺口才算「活过一轮」(#1046-P2)。 */
const LATER = new Date(NOW.getTime() + STRIPE_RECONCILE_CONFIRM_MS + 60_000);
/** 第二天(节流是按 UTC 日算的)。 */
const TOMORROW = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 60_000);

let orgId: string;
let sessionId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
  // 哨兵现在会把**全库**还没了结的观察行都捞出来继续追踪(MONEY-A12)—— 那正是它要做的事,
  // 但也意味着上一个用例留下的行会跟进下一个用例。逐个用例清掉这三种行,隔离才成立。
  await prisma.actionEvent.deleteMany({ where: { type: { in: [RECONCILE_OBSERVED_TYPE, RECONCILE_CLOSED_TYPE, "credits.reconcile.alerted"] } } });
  orgId = `org_${randomUUID()}`;
  sessionId = `cs_test_${randomUUID().replace(/-/g, "")}`;
  await prisma.organization.create({ data: { id: orgId } });
  await prisma.creditAccount.create({ data: { orgId, balance: START, reserved: 0 } });
}, DB_CASE_TIMEOUT_MS);

afterAll(async () => {
  await prisma.$disconnect();
});

/** 一笔已支付的 checkout session,元数据形状与 createTopupCheckout 写进去的逐字相同。 */
function paidSession(over: Partial<StripeCheckoutSessionLike> = {}): StripeCheckoutSessionLike {
  return {
    id: sessionId,
    payment_status: "paid",
    amount_total: 2500,
    currency: "myr",
    payment_intent: "pi_test_1",
    created: Math.floor((NOW.getTime() - 60 * 60 * 1000) / 1000),
    metadata: { orgId, credits: "25" },
    ...over,
  };
}

/** 注入的假 Stripe：记录被调用的参数(宽限期就是靠它证的),按脚本吐页。 */
function fakeStripe(pages: StripeCheckoutSessionLike[][]): StripeSessionsPort & { calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    list: async (params) => {
      calls.push(params);
      const data = pages[i] ?? [];
      i++;
      return { data, has_more: i < pages.length };
    },
  };
}

/** 第 n 次报警的 (alert, options)。 */
function alertCall(n = 0) {
  const call = m.founderAlert.mock.calls[n] as [{ key: string; title: string; action: string; context: Record<string, unknown> }, { repeat?: boolean } | undefined];
  return { alert: call[0], opts: call[1] ?? {} };
}

async function grantRow() {
  await prisma.creditLedger.create({
    data: {
      id: `cl_${randomUUID()}`,
      orgId,
      balanceDelta: 2500,
      reservedDelta: 0,
      kind: "GRANT",
      source: "PURCHASE",
      reason: "stripe top-up",
      idempotencyKey: `stripe:${sessionId}`,
      createdBy: "stripe",
    },
  });
}

async function moneyTrail() {
  const ledger = await prisma.creditLedger.findMany({ where: { orgId }, select: { kind: true, idempotencyKey: true } });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { rows: ledger, balance: account.balance, reserved: account.reserved };
}

describe("钱路 M1-b ①:Stripe 已支付 ↔ 账本入账行,双向对账", () => {
  it("MONEY-A12 缺行必报:已支付但账本没有 stripe:<session> 那一行 ⇒ 三通道报警 + 审计行", async () => {
    const stripe = fakeStripe([[paidSession()]]);

    // 第一轮:只观察,不惊动 founder(延迟到账的合法付款长得一模一样)。
    const first = await reconcileStripePayments({ client: stripe, now: NOW });
    expect(first).toMatchObject({ scanned: 1, paid: 1, unreconciled: 1, firstSeen: 1, alerted: 0, tracked: 0, closed: 0, skipped: null });
    expect(m.founderAlert).not.toHaveBeenCalled();

    const audit = await prisma.actionEvent.findUnique({ where: { id: reconcileObservationId(sessionId) } });
    expect(audit?.type).toBe(RECONCILE_OBSERVED_TYPE);
    expect(audit?.ownerId).toBe(orgId);
    // 判官 P3-2:这一格是 session 的**创建**时间,名字必须说实话;另有首见时刻。
    const payload = audit?.payload as { sessionCreatedAt?: string; firstSeenAt?: string; paidAt?: unknown };
    expect(payload.sessionCreatedAt).toBe(new Date(NOW.getTime() - 60 * 60 * 1000).toISOString());
    expect(payload.firstSeenAt).toBe(NOW.toISOString());
    expect(payload.paidAt, "paidAt 名不副实,应已改名").toBeUndefined();

    // 第二轮(一个扫描窗之后):缺口活过了一整轮 ⇒ 升级报警,三条通道都走。
    const second = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: LATER });
    expect(second).toMatchObject({ scanned: 1, paid: 1, unreconciled: 1, firstSeen: 0, alerted: 1 });
    expect(m.founderAlert).toHaveBeenCalledTimes(1);
    const { alert, opts } = alertCall();
    expect(alert.key).toBe("stripe.paid_but_no_ledger_entry");
    // 告警必须把「商家真的被扣了多少钱」说出来 —— 只说「有个 session 对不上」的告警,收到的人
    // 还得自己去 Stripe 翻,而这是一笔正在缺失的付款。
    expect(alert.title).toContain("MYR 25.00");
    expect(alert.context).toMatchObject({ sessionId, orgId, amountTotal: 2500, idempotencyKey: `stripe:${sessionId}`, stillInStripeScanWindow: true });
    expect(opts.repeat, "当天第一次必须是完整三通道").toBe(false);
  }, DB_CASE_TIMEOUT_MS);

  it("#1046-P2:首见之后紧接着再扫一轮(worker 重启就是这个形状)⇒ 还不报", async () => {
    // 开机也跑一轮,所以「观察行已存在」根本不等于「过了一整轮」。判据必须读 firstSeenAt。
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    const restartSweep = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: new Date(NOW.getTime() + 5_000) });

    expect(restartSweep).toMatchObject({ unreconciled: 1, firstSeen: 0, alerted: 0 });
    expect(m.founderAlert, "首见之后 5 秒的重启扫描把首见喊成了紧急告警").not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("MONEY-A12 节流:同一笔缺口一天只吵一次人,之后的轮次只进 Sentry(repeat)", async () => {
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: LATER });
    expect(alertCall(0).opts.repeat).toBe(false);

    // 节流行必须挂在**这笔缺口的商家**名下:ActionEvent.ownerId 有外键,而 `founder` 那一行
    // 不是每台库都有(全新库就没有)。挂错组织 = 外键报错 = 节流永远写不进去 = 每 30 分钟
    // 一封邮件,正好是节流要防的那件事。
    const throttleRow = await prisma.actionEvent.findFirst({ where: { type: "credits.reconcile.alerted" }, select: { ownerId: true, id: true } });
    expect(throttleRow?.ownerId).toBe(orgId);
    expect(throttleRow?.id).toBe(`stripe_unreconciled_alert:${sessionId}:2026-08-18`);

    // 半小时后又一轮 —— 缺口还在,但今天已经吵过了:压掉邮件与 Telegram,Sentry 照收。
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: new Date(LATER.getTime() + STRIPE_RECONCILE_GRACE_MS) });
    expect(m.founderAlert).toHaveBeenCalledTimes(2);
    expect(alertCall(1).opts.repeat).toBe(true);

    // 第二天照样完整喊一次 —— 节流是「一天一次」,不是「喊过就算了」。
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: TOMORROW });
    expect(m.founderAlert).toHaveBeenCalledTimes(3);
    expect(alertCall(2).opts.repeat).toBe(false);
  }, DB_CASE_TIMEOUT_MS);

  it("复审三 P2-1:窗口外那一段也要过确认窗 —— 刚滑窗 + 重启,5 秒后不许升级", async () => {
    // 绕过去的那条路:一笔快到 48 小时边界的缺口首见,worker 一重启就再扫一轮,而这一轮它
    // 已经滑出 Stripe 窗口 —— 于是它落进「窗口外」那一段。那一段以前不读 firstSeenAt,
    // 首见之后 5 秒就被当成陈年缺口喊成紧急告警。两条升级路必须共用同一道确认窗。
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    expect(m.founderAlert).not.toHaveBeenCalled();

    // 重启后的那一轮:Stripe 返回空(已滑窗),只剩观察行名单看得见它。
    const justAfterRestart = await reconcileStripePayments({ client: fakeStripe([[]]), now: new Date(NOW.getTime() + 5_000) });
    expect(justAfterRestart, "首见 5 秒后就被窗口外那一段喊成了紧急告警").toMatchObject({ tracked: 1, alerted: 0 });
    expect(m.founderAlert).not.toHaveBeenCalled();

    // 一个扫描窗之后:这才是确认过的缺口,照喊。
    const later = await reconcileStripePayments({ client: fakeStripe([[]]), now: LATER });
    expect(later).toMatchObject({ tracked: 1, alerted: 1 });
    expect(alertCall().alert.key).toBe("stripe.paid_but_no_ledger_entry");
    expect(alertCall().alert.context.stillInStripeScanWindow).toBe(false);
  }, DB_CASE_TIMEOUT_MS);

  it("MONEY-A12:缺口滑出 48 小时扫描窗也不许静默消失 —— 靠观察行名单继续追踪", async () => {
    // 首见时它还在窗口里。
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });

    // 三天后:Stripe 的 created 过滤器再也捞不到这个 session(返回空)。缺口一个字都没解决,
    // 而在这次施工之前,它就在这一刻从视野里消失了 —— 永远。
    const threeDaysLater = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sweep = await reconcileStripePayments({ client: fakeStripe([[]]), now: threeDaysLater });

    expect(sweep).toMatchObject({ scanned: 0, paid: 0, unreconciled: 0, tracked: 1, alerted: 1 });
    const { alert } = alertCall();
    expect(alert.context).toMatchObject({ sessionId, orgId, stillInStripeScanWindow: false });
    expect(alert.context.firstSeenAt).toBe(NOW.toISOString()); // 「很久了」必须看得出来
  }, DB_CASE_TIMEOUT_MS);

  it("MONEY-A12:账本行补上了(Stripe 后台重投)⇒ 自动写关闭行,从此不再吵", async () => {
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    await grantRow(); // webhook 被重投,同一把幂等键把账补上了

    const threeDaysLater = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sweep = await reconcileStripePayments({ client: fakeStripe([[]]), now: threeDaysLater });

    expect(sweep).toMatchObject({ tracked: 0, closed: 1, alerted: 0 });
    const closure = await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionId) } });
    expect(closure?.type).toBe(RECONCILE_CLOSED_TYPE);
    expect((closure?.payload as { closedBy?: string }).closedBy).toBe("stripe-reconciler");

    // 再扫一轮:名单里已经没有它了,一声不吭,也不会重复写关闭行。
    const after = await reconcileStripePayments({ client: fakeStripe([[]]), now: new Date(threeDaysLater.getTime() + 60_000) });
    expect(after).toMatchObject({ tracked: 0, closed: 0, alerted: 0 });
    expect(m.founderAlert).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("MONEY-A12:人工关闭之后就不再报警(窗口内窗口外都算)", async () => {
    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    // admin 动作写下的那一行(apps/web/lib/reconcile-actions.ts 写的是同一个主键、同一个 type)。
    await prisma.actionEvent.create({
      data: {
        id: reconcileClosureId(sessionId),
        ownerId: orgId,
        type: RECONCILE_CLOSED_TYPE,
        payload: { sessionId, closedBy: "finance@fikirtive.test", note: "refunded in Stripe, buyer agreed" },
      },
    });

    const inWindow = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: LATER });
    expect(inWindow).toMatchObject({ unreconciled: 1, alerted: 0 }); // 仍然是缺口,只是不再吵人
    const outOfWindow = await reconcileStripePayments({ client: fakeStripe([[]]), now: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000) });
    expect(outOfWindow).toMatchObject({ tracked: 0, alerted: 0 });
    expect(m.founderAlert).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("判官 P2-1 延迟到账(FPX/GrabPay):三小时前创建、刚刚才 paid ⇒ 首轮不响,落账后永远不响", async () => {
    // Stripe 的 created 过滤器筛的是**创建**时间,所以这一笔早就滑出了 30 分钟宽限期 ——
    // 而它的 webhook(async_payment_succeeded)可能还在路上。这正是判官钉的那个形状。
    const delayed = paidSession({ created: Math.floor((NOW.getTime() - 3 * 60 * 60 * 1000) / 1000) });

    const first = await reconcileStripePayments({ client: fakeStripe([[delayed]]), now: NOW });
    expect(first, "刚到账的合法付款被第一轮就喊成了缺口").toMatchObject({ unreconciled: 1, firstSeen: 1, alerted: 0 });
    expect(m.founderAlert).not.toHaveBeenCalled();

    // webhook 在两轮之间落了地 —— 账本有了那一行。
    await grantRow();

    const second = await reconcileStripePayments({ client: fakeStripe([[delayed]]), now: LATER });
    expect(second).toMatchObject({ unreconciled: 0, firstSeen: 0, alerted: 0, closed: 1 });
    expect(m.founderAlert, "延迟到账的合法付款最终还是把 founder 吵醒了").not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("有行不报:账本已有那一行 ⇒ 一声不吭(否则每一笔正常充值都会报警)", async () => {
    await grantRow();
    const stripe = fakeStripe([[paidSession()]]);

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(result).toMatchObject({ scanned: 1, paid: 1, unreconciled: 0, alerted: 0, closed: 0, skipped: null });
    expect(m.founderAlert).not.toHaveBeenCalled();
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileObservationId(sessionId) } })).toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("未支付的 session 不是缺口", async () => {
    const stripe = fakeStripe([[paidSession({ payment_status: "unpaid" })]]);

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(result).toMatchObject({ scanned: 1, paid: 0, unreconciled: 0, alerted: 0 });
    expect(m.founderAlert).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("宽限期:窗口是 [now-48h, now-30min] —— 刚成交、webhook 还在路上的不冤枉", async () => {
    const stripe = fakeStripe([[]]);

    await reconcileStripePayments({ client: stripe, now: NOW });

    const params = stripe.calls[0] as { created: { gte: number; lte: number }; limit: number };
    expect(params.created.lte).toBe(Math.floor((NOW.getTime() - STRIPE_RECONCILE_GRACE_MS) / 1000));
    expect(params.created.gte).toBe(Math.floor((NOW.getTime() - STRIPE_RECONCILE_WINDOW_MS) / 1000));
    expect(params.limit).toBe(100);
  }, DB_CASE_TIMEOUT_MS);

  it("只报不补账:扫到缺口之后(两轮都跑完),余额与账本逐行不变(补账走 Stripe 重投,不走这里)", async () => {
    const before = await moneyTrail();

    await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    const result = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: LATER });

    expect(result.unreconciled).toBe(1);
    expect(result.alerted).toBe(1); // 确认过、喊过了 —— 但一个字都没往账本里写
    const after = await moneyTrail();
    expect(after.rows, "对账扫描往账本里写了行 —— 它绝不许自己补账").toEqual(before.rows);
    expect(after.balance).toBe(START);
    expect(after.reserved).toBe(0);
  }, DB_CASE_TIMEOUT_MS);

  it("读不到 Stripe ≠ 一切正常:拉取失败也报警,并如实说这一轮没验过", async () => {
    const stripe: StripeSessionsPort = {
      list: async () => {
        throw new Error("connect ETIMEDOUT api.stripe.com");
      },
    };

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(result.skipped).toContain("stripe list failed");
    expect(result.alerted).toBe(1);
    expect(m.founderAlert).toHaveBeenCalledTimes(1);
    expect(alertCall().alert.key).toBe("stripe.reconcile_could_not_read_stripe");
    expect(alertCall().alert.title).toContain("UNVERIFIED");
  }, DB_CASE_TIMEOUT_MS);

  it("没配 STRIPE_SECRET_KEY 时如实跳过,而不是假装扫过了", async () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const result = await reconcileStripePayments({ now: NOW });
      expect(result.skipped).toContain("STRIPE_SECRET_KEY");
      expect(result.alerted).toBe(0);
    } finally {
      if (previous !== undefined) process.env.STRIPE_SECRET_KEY = previous;
    }
  }, DB_CASE_TIMEOUT_MS);

  it("双租户:一个组织的缺口不会读到、更不会动另一个组织的账本", async () => {
    const otherOrgId = `org_${randomUUID()}`;
    await prisma.organization.create({ data: { id: otherOrgId } });
    await prisma.creditAccount.create({ data: { orgId: otherOrgId, balance: START, reserved: 0 } });
    const stripe = fakeStripe([[paidSession()]]);

    await reconcileStripePayments({ client: stripe, now: NOW });

    const other = await prisma.creditAccount.findFirstOrThrow({ where: { orgId: otherOrgId } });
    expect(other.balance).toBe(START);
    expect(await prisma.creditLedger.findMany({ where: { orgId: otherOrgId } })).toEqual([]);
    expect(await prisma.actionEvent.findMany({ where: { ownerId: otherOrgId } })).toEqual([]);
  }, DB_CASE_TIMEOUT_MS);

  it("多页:has_more 时接着翻,后面几页的缺口一样进两轮确认", async () => {
    const other = `cs_test_${randomUUID().replace(/-/g, "")}`;
    const pages = () => [[paidSession()], [paidSession({ id: other })]];

    const first = await reconcileStripePayments({ client: fakeStripe(pages()), now: NOW });
    expect(first).toMatchObject({ scanned: 2, paid: 2, unreconciled: 2, firstSeen: 2, alerted: 0 });

    const stripe = fakeStripe(pages());
    const second = await reconcileStripePayments({ client: stripe, now: LATER });
    expect(second).toMatchObject({ scanned: 2, paid: 2, unreconciled: 2, firstSeen: 0, alerted: 2 });
    const params = stripe.calls[1] as { starting_after?: string };
    expect(params.starting_after).toBe(sessionId);
  }, DB_CASE_TIMEOUT_MS);
});

describe("MONEY-A12 P2-3:一次数据库错误不许把整轮扫描带下去", () => {
  it("读不到未了结名单 ⇒ 报警 + 如实标 trailUnreadable,Stripe 那一侧照常扫完", async () => {
    // 名单读不出来时,窗口外的老缺口这一轮没人看 —— 但 Stripe 那一侧仍然是缺口的第一道眼睛,
    // 它不该因为审计表抖了一下就整轮停摆(这个函数对调用方的承诺是「永不抛」)。
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // ⚠️ 不用 vi.spyOn:Prisma 的方法不是自有属性,`mockRestore()` 会把它**删掉**,后面每个
    // 用例都会撞上「findMany is not a function」。存一份再放回去,是这里唯一安全的替换法。
    const original = prisma.actionEvent.findMany;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.actionEvent as any).findMany = vi.fn().mockRejectedValue(new Error("connection reset"));
    try {
      const result = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
      expect(result.trailUnreadable).toBe(true);
      expect(result.skipped, "名单读不到 ≠ 这一轮没跑成,不许串味").toBeNull();
      expect(result).toMatchObject({ scanned: 1, paid: 1, unreconciled: 1, firstSeen: 1 });
      expect(alertCall().alert.key).toBe("stripe.reconcile_trail_unreadable");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.actionEvent as any).findMany = original;
      err.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("终审 P1:首见时账本查不动 ⇒ **观察行照写**(标 unverified),缺口不会滑出窗口后失踪", async () => {
    // 这条路原来是「报警 + continue,不写行」。30 分钟后这笔 session 滑出 48 小时 Stripe 窗口,
    // 而它从来没有进过追踪名单 —— 一笔真实缺口就此永久失踪,且没有任何东西会再提起它。
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = prisma.creditLedger.findUnique;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.creditLedger as any).findUnique = vi.fn().mockRejectedValue(new Error("connection reset"));
    try {
      const first = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
      // 没判成缺口(unreconciled 不动、不升级),但**记下来了**。
      expect(first).toMatchObject({ paid: 1, unreconciled: 0, firstSeen: 0, unverified: 1, alerted: 1 });
      expect(alertCall().alert.key).toBe("stripe.reconcile_ledger_unreadable");
      const row = await prisma.actionEvent.findUnique({ where: { id: reconcileObservationId(sessionId) } });
      expect(row, "首见那一轮账本查不动就不留行 = 这笔缺口会永久失踪").not.toBeNull();
      expect((row?.payload as { ledgerVerified?: boolean; firstSeenAt?: string }).ledgerVerified).toBe(false);
      expect((row?.payload as { firstSeenAt?: string }).firstSeenAt).toBe(NOW.toISOString());
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.creditLedger as any).findUnique = original;
      err.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);

  it("终审 P1:那一行下一轮照常判定 —— 已入账 ⇒ 自动关闭", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = prisma.creditLedger.findUnique;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.creditLedger as any).findUnique = vi.fn().mockRejectedValue(new Error("connection reset"));
    try {
      await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.creditLedger as any).findUnique = original;
      err.mockRestore();
    }
    await grantRow(); // 账本其实早就有那一行,只是上一轮没问到

    // 它已经滑出 48 小时窗口(Stripe 返回空)—— 全靠观察行名单才追得到。
    const later = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sweep = await reconcileStripePayments({ client: fakeStripe([[]]), now: later });

    expect(sweep).toMatchObject({ tracked: 0, closed: 1, alerted: 0 });
    expect(await prisma.actionEvent.findUnique({ where: { id: reconcileClosureId(sessionId) } })).not.toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("终审 P1:那一行下一轮照常判定 —— 仍然缺 ⇒ 按 firstSeenAt 升级", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = prisma.creditLedger.findUnique;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.creditLedger as any).findUnique = vi.fn().mockRejectedValue(new Error("connection reset"));
    try {
      await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.creditLedger as any).findUnique = original;
      err.mockRestore();
    }
    m.founderAlert.mockClear();

    // 一个扫描窗之后:账本读得动了,那一行仍然不在 ⇒ 这才是确认过的缺口,升级。
    const second = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: LATER });

    expect(second).toMatchObject({ unreconciled: 1, firstSeen: 0, unverified: 0, alerted: 1 });
    expect(alertCall().alert.key).toBe("stripe.paid_but_no_ledger_entry");
    expect(alertCall().alert.context.firstSeenAt).toBe(NOW.toISOString()); // 时钟从首见那一刻起算
  }, DB_CASE_TIMEOUT_MS);

  it("查不动账本 ⇒ 不判这一笔并报警,其余各行照常处理(不冤枉、不静默)", async () => {
    const other = `cs_test_${randomUUID().replace(/-/g, "")}`;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const original = prisma.creditLedger.findUnique;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.creditLedger as any).findUnique = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error("connection reset");
      return null;
    });
    try {
      const result = await reconcileStripePayments({ client: fakeStripe([[paidSession(), paidSession({ id: other })]]), now: NOW });
      // 第一笔查不动 ⇒ 报警一条、不判它是不是缺口(但行照写);第二笔照常走两轮确认(首见,不喊)。
      expect(result).toMatchObject({ paid: 2, unreconciled: 1, firstSeen: 1, unverified: 1, alerted: 1 });
      expect(alertCall().alert.key).toBe("stripe.reconcile_ledger_unreadable");
      expect(alertCall().alert.context.sessionId).toBe(sessionId);
      // 查不动的那一笔写成**未验证**的观察行:不当缺口,但绝不许它从追踪名单里消失(终审 P1)。
      const unjudged = await prisma.actionEvent.findUnique({ where: { id: reconcileObservationId(sessionId) } });
      expect((unjudged?.payload as { ledgerVerified?: boolean }).ledgerVerified).toBe(false);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.creditLedger as any).findUnique = original;
      err.mockRestore();
    }
  }, DB_CASE_TIMEOUT_MS);
});

describe("钱路 M1-b ①:这一轮没看全 ≠ 这一轮没发现问题", () => {
  it("翻页撞上上限时另报一次警,并如实说没看完", async () => {
    // 每页都说 has_more，逼到上限。
    const pages: StripeCheckoutSessionLike[][] = Array.from({ length: STRIPE_RECONCILE_MAX_PAGES + 2 }, (_, i) => [
      { id: `cs_page_${i}`, payment_status: "unpaid", created: 0, metadata: {} },
    ]);
    const stripe = fakeStripe(pages);

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(stripe.calls).toHaveLength(STRIPE_RECONCILE_MAX_PAGES);
    expect(result.alerted).toBe(1);
    expect(alertCall().alert.key).toBe("stripe.reconcile_window_truncated");
    expect(alertCall().alert.title).toContain("did NOT see all of them");
  }, DB_CASE_TIMEOUT_MS);
});

describe("钱路 M1-b ①:metadata 缺 orgId 的异常形状", () => {
  it("缺 orgId 但账本有那一行 ⇒ 仍然不报(按键回退查也必须查得到)", async () => {
    await grantRow();
    const stripe = fakeStripe([[paidSession({ metadata: {} })]]);

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(result).toMatchObject({ paid: 1, unreconciled: 0, alerted: 0 });
    expect(m.founderAlert).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("缺 orgId 且账本没有 ⇒ 一个扫描窗之后照报,审计行挂在 founder 名下", async () => {
    await prisma.organization.upsert({ where: { id: "founder" }, update: {}, create: { id: "founder" } });

    const first = await reconcileStripePayments({ client: fakeStripe([[paidSession({ metadata: {} })]]), now: NOW });
    expect(first).toMatchObject({ paid: 1, unreconciled: 1, firstSeen: 1, alerted: 0 });
    const audit = await prisma.actionEvent.findUnique({ where: { id: reconcileObservationId(sessionId) } });
    expect(audit?.ownerId).toBe("founder");

    const second = await reconcileStripePayments({ client: fakeStripe([[paidSession({ metadata: {} })]]), now: LATER });
    expect(second).toMatchObject({ paid: 1, unreconciled: 1, firstSeen: 0, alerted: 1 });
    expect(alertCall().alert.context.orgId).toBe("unresolved");
  }, DB_CASE_TIMEOUT_MS);

  it("审计写不下去时(组织行不在)⇒ 首轮就报,绝不让一次数据库故障把缺口变哑", async () => {
    // orgId 指向一个不存在的组织 ⇒ ActionEvent 的外键写失败 ⇒ 分不清首见还是再见。
    // 约定的方向是 fail loud:按再见处理,立刻报警。
    const ghost = `org_${randomUUID()}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await reconcileStripePayments({
        client: fakeStripe([[paidSession({ metadata: { orgId: ghost, credits: "25" } })]]),
        now: NOW,
      });
      expect(result).toMatchObject({ paid: 1, unreconciled: 1, firstSeen: 0, alerted: 1 });
    } finally {
      errorSpy.mockRestore();
    }
    expect(m.founderAlert).toHaveBeenCalledTimes(1);
  }, DB_CASE_TIMEOUT_MS);
});
