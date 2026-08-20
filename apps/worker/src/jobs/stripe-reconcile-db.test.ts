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
 * 假 Stripe client 是注入的 —— 钱路的用例绝不打真 Stripe。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@sentry/node", () => ({ captureException: m.captureException, captureMessage: m.captureMessage }));

import { prisma } from "@fikirtive/db";
import {
  reconcileStripePayments,
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

let orgId: string;
let sessionId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, DB_CASE_TIMEOUT_MS);

beforeEach(async () => {
  vi.clearAllMocks();
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

async function moneyTrail() {
  const ledger = await prisma.creditLedger.findMany({ where: { orgId }, select: { kind: true, idempotencyKey: true } });
  const account = await prisma.creditAccount.findFirstOrThrow({ where: { orgId }, select: { balance: true, reserved: true } });
  return { rows: ledger, balance: account.balance, reserved: account.reserved };
}

describe("钱路 M1-b ①:Stripe 已支付 ↔ 账本入账行,双向对账", () => {
  it("缺行必报:已支付但账本没有 stripe:<session> 那一行 ⇒ 报警 + 审计行", async () => {
    const stripe = fakeStripe([[paidSession()]]);

    // 第一轮:只观察,不惊动 founder(延迟到账的合法付款长得一模一样)。
    const first = await reconcileStripePayments({ client: stripe, now: NOW });
    expect(first).toMatchObject({ scanned: 1, paid: 1, unreconciled: 1, firstSeen: 1, alerted: 0, skipped: null });
    expect(m.captureException).not.toHaveBeenCalled();

    const audit = await prisma.actionEvent.findUnique({ where: { id: `stripe_unreconciled:${sessionId}` } });
    expect(audit?.type).toBe("credits.purchase.unreconciled");
    expect(audit?.ownerId).toBe(orgId);
    // 判官 P3-2:这一格是 session 的创建时间,名字必须说实话;另有首见时刻。
    const payload = audit?.payload as { sessionCreatedAt?: string; firstSeenAt?: string; paidAt?: unknown };
    expect(payload.sessionCreatedAt).toBe(new Date(NOW.getTime() - 60 * 60 * 1000).toISOString());
    expect(payload.firstSeenAt).toBe(NOW.toISOString());
    expect(payload.paidAt, "paidAt 名不副实,应已改名").toBeUndefined();

    // 第二轮:缺口活过了一整轮 ⇒ 升级报警。
    const second = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    expect(second).toMatchObject({ scanned: 1, paid: 1, unreconciled: 1, firstSeen: 0, alerted: 1 });
    expect(m.captureException).toHaveBeenCalledTimes(1);
    const [err, ctx] = m.captureException.mock.calls[0] as [Error, { extra: Record<string, unknown> }];
    expect(err.message).toContain(sessionId);
    // 告警必须把「商家真的被扣了多少钱」说出来 —— 只说「有个 session 对不上」的告警,收到的人
    // 还得自己去 Stripe 翻,而这是一笔正在缺失的付款。
    expect(err.message).toContain("MYR 25.00");
    expect(ctx.extra).toMatchObject({ sessionId, orgId, amountTotal: 2500, idempotencyKey: `stripe:${sessionId}` });

    // 之后每一轮都继续喊(at-least-once,补上之前不许安静)。
    const third = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });
    expect(third.alerted).toBe(1);
    expect(m.captureException).toHaveBeenCalledTimes(2);
  }, DB_CASE_TIMEOUT_MS);

  it("判官 P2-1 延迟到账(FPX/GrabPay):三小时前创建、刚刚才 paid ⇒ 首轮不响,落账后永远不响", async () => {
    // Stripe 的 created 过滤器筛的是**创建**时间,所以这一笔早就滑出了 30 分钟宽限期 ——
    // 而它的 webhook(async_payment_succeeded)可能还在路上。这正是判官钉的那个形状。
    const delayed = paidSession({ created: Math.floor((NOW.getTime() - 3 * 60 * 60 * 1000) / 1000) });

    const first = await reconcileStripePayments({ client: fakeStripe([[delayed]]), now: NOW });
    expect(first, "刚到账的合法付款被第一轮就喊成了缺口").toMatchObject({ unreconciled: 1, firstSeen: 1, alerted: 0 });
    expect(m.captureException).not.toHaveBeenCalled();

    // webhook 在两轮之间落了地 —— 账本有了那一行。
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

    const second = await reconcileStripePayments({ client: fakeStripe([[delayed]]), now: NOW });
    expect(second).toMatchObject({ unreconciled: 0, firstSeen: 0, alerted: 0 });
    expect(m.captureException, "延迟到账的合法付款最终还是把 founder 吵醒了").not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("有行不报:账本已有那一行 ⇒ 一声不吭(否则每一笔正常充值都会报警)", async () => {
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
    const stripe = fakeStripe([[paidSession()]]);

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(result).toMatchObject({ scanned: 1, paid: 1, unreconciled: 0, alerted: 0, skipped: null });
    expect(m.captureException).not.toHaveBeenCalled();
    expect(await prisma.actionEvent.findUnique({ where: { id: `stripe_unreconciled:${sessionId}` } })).toBeNull();
  }, DB_CASE_TIMEOUT_MS);

  it("未支付的 session 不是缺口", async () => {
    const stripe = fakeStripe([[paidSession({ payment_status: "unpaid" })]]);

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(result).toMatchObject({ scanned: 1, paid: 0, unreconciled: 0, alerted: 0 });
    expect(m.captureException).not.toHaveBeenCalled();
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
    const result = await reconcileStripePayments({ client: fakeStripe([[paidSession()]]), now: NOW });

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
    expect(m.captureException).toHaveBeenCalledTimes(1);
    expect((m.captureException.mock.calls[0] as [Error])[0].message).toContain("UNVERIFIED");
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
    const second = await reconcileStripePayments({ client: stripe, now: NOW });
    expect(second).toMatchObject({ scanned: 2, paid: 2, unreconciled: 2, firstSeen: 0, alerted: 2 });
    const params = stripe.calls[1] as { starting_after?: string };
    expect(params.starting_after).toBe(sessionId);
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
    const [err] = m.captureException.mock.calls[0] as [Error];
    expect(err.message).toContain("did NOT see all of them");
  }, DB_CASE_TIMEOUT_MS);
});

describe("钱路 M1-b ①:metadata 缺 orgId 的异常形状", () => {
  it("缺 orgId 但账本有那一行 ⇒ 仍然不报(按键回退查也必须查得到)", async () => {
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
    const stripe = fakeStripe([[paidSession({ metadata: {} })]]);

    const result = await reconcileStripePayments({ client: stripe, now: NOW });

    expect(result).toMatchObject({ paid: 1, unreconciled: 0, alerted: 0 });
    expect(m.captureException).not.toHaveBeenCalled();
  }, DB_CASE_TIMEOUT_MS);

  it("缺 orgId 且账本没有 ⇒ 两轮之后照报,审计行挂在 founder 名下", async () => {
    await prisma.organization.upsert({ where: { id: "founder" }, update: {}, create: { id: "founder" } });

    const first = await reconcileStripePayments({ client: fakeStripe([[paidSession({ metadata: {} })]]), now: NOW });
    expect(first).toMatchObject({ paid: 1, unreconciled: 1, firstSeen: 1, alerted: 0 });
    const audit = await prisma.actionEvent.findUnique({ where: { id: `stripe_unreconciled:${sessionId}` } });
    expect(audit?.ownerId).toBe("founder");

    const second = await reconcileStripePayments({ client: fakeStripe([[paidSession({ metadata: {} })]]), now: NOW });
    expect(second).toMatchObject({ paid: 1, unreconciled: 1, firstSeen: 0, alerted: 1 });
    const [err] = m.captureException.mock.calls[0] as [Error];
    expect(err.message).toContain("org=unknown");
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
    expect(m.captureException).toHaveBeenCalledTimes(1);
  }, DB_CASE_TIMEOUT_MS);
});
