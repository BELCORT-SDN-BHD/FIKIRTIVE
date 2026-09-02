import { describe, it, expect, vi, beforeEach } from "vitest";

const constructEvent = vi.fn();
// MONEY-A13:拒付/退款事件要反查商家 org —— 两条只读的 Stripe 面,一个真实外呼都不发。
const paymentIntentsRetrieve = vi.fn();
const checkoutSessionsList = vi.fn();
vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent },
    paymentIntents: { retrieve: paymentIntentsRetrieve },
    checkout: { sessions: { list: checkoutSessionsList } },
  },
}));
const grantCredits = vi.fn();
const actionEventCreate = vi.fn();
// MONEY-A13 P1-1:送达回执 —— 重投时读那一行,送出去过才安静。
const actionEventFindUnique = vi.fn();
const actionEventUpdate = vi.fn();
const creditLedgerFindUnique = vi.fn();
// MONEY-A13 P2-1:归因最后一步 —— 按幂等键反查账本。
const creditLedgerFindFirst = vi.fn();
// MONEY-A9:充值成功要顺手把这个租户「等余额」的素材理解行拨回队列(规格 §7.3 四则④)。
const assetUnderstandingUpdateMany = vi.fn();
vi.mock("@fikirtive/db", () => ({ grantCredits, prisma: { actionEvent: { create: actionEventCreate, findUnique: actionEventFindUnique, update: actionEventUpdate }, creditLedger: { findUnique: creditLedgerFindUnique, findFirst: creditLedgerFindFirst }, assetUnderstanding: { updateMany: assetUnderstandingUpdateMany } } }));
// 钱路 M1-c:包核对用**真的**核对函数与**真的**包表 —— 假一个进来,这组用例就只是在测
// 自己写的夹具,而这次要防的病恰恰是「代码里的包表与真实在售的包不是一回事」。
vi.mock("@fikirtive/core", async () => {
  const actual = await vi.importActual<typeof import("@fikirtive/core")>("@fikirtive/core");
  return {
    newId: () => "evt_id",
    INTERNAL_PER_DISPLAY: 10,
    verifyCreditPackPurchase: actual.verifyCreditPackPurchase,
  };
});
const captureMessage = vi.fn();
vi.mock("@sentry/node", () => ({ captureMessage }));
// 整顿 C1a:报警管道注入成假 transport。断言的是「这类事件必然产生一次带上下文的上报」,
// 不是 Sentry/Resend/Telegram 本身 —— 一个真实外呼都不发。
const founderAlert = vi.fn();
vi.mock("@/lib/founder-alert", () => ({ founderAlert }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  actionEventCreate.mockResolvedValue({});
  actionEventFindUnique.mockResolvedValue(null);
  actionEventUpdate.mockResolvedValue({});
  creditLedgerFindFirst.mockResolvedValue(null);
  // 默认:报警真的送出去了(至少一条通道 sent)—— 没送到是另一组用例的事。
  founderAlert.mockResolvedValue([{ channel: "sentry", status: "sent" }]);
  creditLedgerFindUnique.mockResolvedValue(null); // default: this session was never granted
  assetUnderstandingUpdateMany.mockResolvedValue({ count: 0 });
  paymentIntentsRetrieve.mockResolvedValue({ metadata: {} }); // default: 老付款,PI 上没有 orgId
  checkoutSessionsList.mockResolvedValue({ data: [] });
});

const { POST } = await import("@/app/api/stripe/webhook/route");
function req(body = "{}") { return { text: async () => body, headers: { get: () => "sig_x" } } as never; }

describe("stripe webhook", () => {
  it("400 on invalid signature; no grant", async () => {
    constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("grants on checkout.session.completed (paid) with the right args", async () => {
    // 夹具是**真的在售包**(Starter:RM25 = 2500 sen → 50 credits)。改成一个不存在的包,
    // 这条用例现在会红 —— 这正是钱路 M1-c 加的那道核对。
    constructEvent.mockReturnValue({
      id: "evt_1", type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid", metadata: { orgId: "org_1", credits: "50" }, payment_intent: "pi_1", amount_total: 2500, currency: "myr" } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1", amount: 50 * 10, source: "PURCHASE", idempotencyKey: "stripe:cs_1",
    }));
    expect(actionEventCreate).toHaveBeenCalled();
    // 对得上就一声不响 —— 核对不许把每一笔正常充值都变成一条告警。
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("grants on checkout.session.async_payment_succeeded (paid) with the same dedup key (F01)", async () => {
    // Delayed-notification methods (e.g. FPX/GrabPay) can complete 'unpaid' and pay later via
    // this event — it must grant too, or a paying customer gets no credits. Same stripe:<session>
    // key makes it exactly-once even if completed + async_payment_succeeded both fire.
    constructEvent.mockReturnValue({
      id: "evt_async", type: "checkout.session.async_payment_succeeded",
      data: { object: { id: "cs_async", payment_status: "paid", metadata: { orgId: "org_9", credits: "220" }, payment_intent: "pi_9", amount_total: 10000, currency: "myr" } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_9", amount: 220 * 10, source: "PURCHASE", idempotencyKey: "stripe:cs_async",
    }));
  });

  // ── MONEY-A9 计费四则④:充值**唤醒**因余额不足停下来的素材理解 ────────────────────
  //
  // 没有这一句,商家充完值要等最多一分钟的扫描轮询才看得到 Otto 继续认识他的店 ——
  // 而他刚刚付过钱,那一分钟是他盯着屏幕的一分钟。
  it("MONEY-A9: a top-up wakes this org's PAUSED_BALANCE understanding rows", async () => {
    constructEvent.mockReturnValue({
      id: "evt_wake", type: "checkout.session.completed",
      data: { object: { id: "cs_wake", payment_status: "paid", metadata: { orgId: "org_w", credits: "50" }, payment_intent: "pi_w", amount_total: 2500, currency: "myr" } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    assetUnderstandingUpdateMany.mockResolvedValue({ count: 3 });

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(assetUnderstandingUpdateMany).toHaveBeenCalledWith({
      // 只唤醒**这个商家**的行,而且只唤醒等余额的那些(等人修配置的 PAUSED 不是这一类)
      where: { ownerId: "org_w", status: "PAUSED_BALANCE" },
      // error 一起清掉:那句「等 credits」已经不再是真的,而商家读得到它
      data: { status: "QUEUED", error: null },
    });
    // 余额够不够**不在这里判**:唯一有权决定的是 reserve 本身(原子条件扣减)。
    // 在这里抄第二份余额判据,两份迟早会不一样。
    expect(assetUnderstandingUpdateMany.mock.calls[0]![0].where).not.toHaveProperty("priceInternalSnapshot");
  });

  it("MONEY-A9: a wake-up that throws never changes the 200 (Stripe must not be pushed into retries)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_wake2", type: "checkout.session.completed",
      data: { object: { id: "cs_wake2", payment_status: "paid", metadata: { orgId: "org_w2", credits: "50" }, payment_intent: "pi_w2", amount_total: 2500, currency: "myr" } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    assetUnderstandingUpdateMany.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await POST(req());
    expect(res.status).toBe(200);
    // 钱照样入账,审计照样写 —— 唤醒失败只是慢一分钟(扫描器第 ④ 段是同一件事的兜底)
    expect(grantCredits).toHaveBeenCalledTimes(1);
    expect(actionEventCreate).toHaveBeenCalled();
  });

  // ── #552:延迟到账失败(FPX/GrabPay)不再被裸 200 吞掉 ─────────────────────────
  it("checkout.session.async_payment_failed → audit row + Sentry alert, ZERO grant, 200", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f1", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f1", payment_status: "unpaid", metadata: { orgId: "org_7", credits: "220" }, payment_intent: "pi_f1", amount_total: 10000 } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled(); // no money arrived → nothing may be issued
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("checkout.session.async_payment_failed"), "warning");
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("received NO credits"), "warning");
    // The grant side is consulted READ-ONLY, tenant-scoped on the compound unique key.
    expect(creditLedgerFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_idempotencyKey: { orgId: "org_7", idempotencyKey: "stripe:cs_f1" } } }),
    );
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "stripe_failed:cs_f1", ownerId: "org_7", type: "credits.purchase.failed",
          payload: expect.objectContaining({ alreadyGranted: false }),
        }),
      }),
    );
  });

  // P1(复审第一轮):告警调用同步抛错不得穿透成非 2xx —— 那会让 Stripe 无限重投一个钱事件。
  it("async_payment_failed still 200s + still audits when the ALERT throws", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f5", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f5", payment_status: "unpaid", metadata: { orgId: "org_7", credits: "220" } } },
    });
    captureMessage.mockImplementationOnce(() => { throw new Error("sentry transport exploded"); });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(req());
      expect(res.status).toBe(200); // the 2xx contract survives a broken alerting backend
      expect(consoleError).toHaveBeenCalled(); // degraded to a structured log, not swallowed
      expect(actionEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ id: "stripe_failed:cs_f5" }) }),
      );
      expect(grantCredits).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  // P2(复审第一轮):completed(paid) 先到、failed 后到时,不得对运营说「没发过积分」。
  it("async_payment_failed on an ALREADY-GRANTED session tells the truth (no clawback, no re-grant)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f6", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f6", payment_status: "unpaid", metadata: { orgId: "org_7", credits: "220" } } },
    });
    creditLedgerFindUnique.mockResolvedValue({ id: "led_1" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("ALREADY granted"), "warning");
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: expect.objectContaining({ alreadyGranted: true }) }),
      }),
    );
    expect(grantCredits).not.toHaveBeenCalled(); // never re-grant …
  });

  it("async_payment_failed reports UNKNOWN (not 'no credits') when the ledger lookup itself fails", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f7", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f7", payment_status: "unpaid", metadata: { orgId: "org_7", credits: "220" } } },
    });
    creditLedgerFindUnique.mockRejectedValue(new Error("db down"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("UNKNOWN"), "warning");
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: expect.objectContaining({ alreadyGranted: null }) }),
      }),
    );
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("async_payment_failed keys the audit row on the SESSION, so a redelivery hits the same PK", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f2", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f2", payment_status: "unpaid", metadata: { orgId: "org_7", credits: "220" } } },
    });
    expect((await POST(req())).status).toBe(200);
    // Stripe redelivers the SAME event, or a second failure event for the same session.
    expect((await POST(req())).status).toBe(200);
    const ids = actionEventCreate.mock.calls.map((c) => c[0].data.id);
    expect(ids).toEqual(["stripe_failed:cs_f2", "stripe_failed:cs_f2"]);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("async_payment_failed with no orgId metadata still audits (owner falls back to founder), 200, no grant", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f3", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f3", payment_status: "unpaid", metadata: {} } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
    // No orgId → the grant branch above can never have run for this session, so "not granted"
    // is provable without a lookup; spending a query on it would be theatre.
    expect(creditLedgerFindUnique).not.toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "stripe_failed:cs_f3", ownerId: "founder", type: "credits.purchase.failed",
          payload: expect.objectContaining({ alreadyGranted: false }),
        }),
      }),
    );
  });

  it("async_payment_failed still 200s when the audit write throws (Stripe must not retry-storm)", async () => {
    constructEvent.mockReturnValue({
      id: "evt_f4", type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_f4", payment_status: "unpaid", metadata: { orgId: "org_7" } } },
    });
    actionEventCreate.mockRejectedValueOnce(new Error("unique constraint"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(captureMessage).toHaveBeenCalled(); // alert is at-least-once: a DB fault can't silence it
    // …and the audit write was genuinely attempted — otherwise this test would pass on an
    // implementation that never writes at all.
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "stripe_failed:cs_f4", type: "credits.purchase.failed" }),
      }),
    );
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("200 + no grant when metadata is missing/invalid (no retry storm)", async () => {
    constructEvent.mockReturnValue({ id: "evt_2", type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: {} } } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  /**
   * 整顿 C1a —— 这条分支是这个文件里唯一一条「真钱进账、我们不知道该给谁」却只写审计不叫人
   * 的路。旁边的 async_payment_failed / dispute·refund 从第一天起就报警,而这一条更硬:那两条
   * 是钱没来或钱被拉回,这一条是**商家已经付过款**,只是 metadata 坏掉让我们发不出 credits。
   * 没有人工补发,那笔钱就是白收的。
   */
  it("PAID session with unusable metadata now ALERTS (money in, nobody to credit) — audit row alone was not enough", async () => {
    constructEvent.mockReturnValue({
      id: "evt_bad", type: "checkout.session.completed",
      data: { object: { id: "cs_bad", payment_status: "paid", metadata: {}, payment_intent: "pi_bad", amount_total: 4900, currency: "myr" } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200); // 200 契约不变:报警绝不决定响应码
    expect(grantCredits).not.toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalled(); // 审计照旧
    expect(founderAlert, "钱进来了,没人知道该给谁,而没有任何人被通知").toHaveBeenCalledTimes(1);
    expect(founderAlert).toHaveBeenCalledWith(expect.objectContaining({
      key: "stripe.paid_session_unusable_metadata",
      // 上下文要够人直接去 Stripe 后台找到这一笔,而不是先回来读代码。
      context: expect.objectContaining({ stripeEventId: "evt_bad", stripeSessionId: "cs_bad", paymentIntentId: "pi_bad", amountTotal: 4900, currency: "myr" }),
    }));
  });

  it("still 200s + still audits when the ALERT itself throws — a money event must never enter a Stripe retry storm", async () => {
    constructEvent.mockReturnValue({
      id: "evt_bad2", type: "checkout.session.completed",
      data: { object: { id: "cs_bad2", payment_status: "paid", metadata: { orgId: "org_1" } } },
    });
    founderAlert.mockRejectedValue(new Error("every channel down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(actionEventCreate).toHaveBeenCalled();
      expect(grantCredits).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("a GOOD purchase does not alert — an alarm that fires on every sale is an alarm nobody reads", async () => {
    // 钱路 M1-c:夹具改成**真的在售包**(Starter RM25 = 2500 sen → 50 credits)并带上币种。
    // 原来的 100 credits / 无金额在包表落地后已经不是「一笔好购买」了——它对不上任何在售包,
    // 正是这条新核对要拦的形状。要断言「好购买不报警」,夹具本身就得是一笔真能发生的购买。
    constructEvent.mockReturnValue({
      id: "evt_ok", type: "checkout.session.completed",
      data: { object: { id: "cs_ok", payment_status: "paid", metadata: { orgId: "org_1", credits: "50" }, amount_total: 2500, currency: "myr" } },
    });
    grantCredits.mockResolvedValue({ ok: true });
    expect((await POST(req())).status).toBe(200);
    expect(founderAlert).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("200 on a duplicate event (grantCredits reports duplicate)", async () => {
    constructEvent.mockReturnValue({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_dup", payment_status: "paid", metadata: { orgId: "org_1", credits: "50" }, amount_total: 2500, currency: "myr" } } });
    grantCredits.mockResolvedValue({ duplicate: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
  });

  it("200 + no grant for an unhandled event type", async () => {
    constructEvent.mockReturnValue({ id: "evt_3", type: "payment_intent.created", data: { object: {} } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  // ── 2026-07-04 盲区修复 + MONEY-A13:争议/退款 = 钱被拉回,必须有人被叫到 ──────────
  it("MONEY-A13:charge.dispute.created ⇒ 三通道报警带商家 org 与金额,零钱变动,200", async () => {
    // 新付款走这条:结账时 payment_intent_data 把 orgId 写在了 PaymentIntent 上。
    paymentIntentsRetrieve.mockResolvedValue({ metadata: { orgId: "org_7" } });
    constructEvent.mockReturnValue({
      id: "evt_d1", type: "charge.dispute.created",
      data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 5000, currency: "myr", reason: "fraudulent", status: "needs_response" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled(); // alert-only:拒付不倒扣,账本不建负数
    // 裸 Sentry 已经退场 —— 拒付是当天要动手的事,只进 Sentry 等于说给没有人听。
    expect(captureMessage).not.toHaveBeenCalled();
    expect(founderAlert).toHaveBeenCalledTimes(1);
    const alert = founderAlert.mock.calls[0]![0];
    expect(alert.key).toBe("stripe.dispute_opened");
    expect(alert.title).toContain("MYR 50.00"); // 金额
    expect(alert.context).toMatchObject({ orgId: "org_7", orgAttribution: "payment-intent", amountMinor: 5000, currency: "MYR" });
    expect(alert.action).toContain("docs/runbooks/chargeback.md"); // 收到报警的人不必去读代码
    // 审计行:kind 分开、ownerId 是**真的商家**(不再硬编码 founder)、主键由 event.id 派生。
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: "stripe_pullback:evt_d1", ownerId: "org_7", type: "credits.dispute.created" }) }),
    );
  });

  it("MONEY-A13:dispute.closed 与 dispute.created 是两件事,kind 与报警键都分开", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ metadata: { orgId: "org_7" } });
    constructEvent.mockReturnValue({
      id: "evt_d2", type: "charge.dispute.closed",
      data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 5000, currency: "myr", status: "lost" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(founderAlert.mock.calls[0]![0].key).toBe("stripe.dispute_closed");
    expect(founderAlert.mock.calls[0]![0].context).toMatchObject({ disputeStatus: "lost", orgId: "org_7" });
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "credits.dispute.closed" }) }),
    );
  });

  it("MONEY-A13:老付款靠 payment_intent 反查 Checkout Session 认人(PI 上没有 metadata)", async () => {
    // payment_intent_data 是这次施工才加的;在那之前的付款,orgId 只在 Checkout Session 上。
    checkoutSessionsList.mockResolvedValue({ data: [{ id: "cs_old", metadata: { orgId: "org_legacy" } }] });
    constructEvent.mockReturnValue({
      id: "evt_d3", type: "charge.dispute.created",
      data: { object: { id: "dp_2", charge: "ch_3", payment_intent: "pi_3", amount: 2500, currency: "myr", status: "needs_response" } },
    });

    await POST(req());

    expect(checkoutSessionsList).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_3" }));
    expect(founderAlert.mock.calls[0]![0].context).toMatchObject({ orgId: "org_legacy", orgAttribution: "checkout-session", checkoutSessionId: "cs_old" });
  });

  it("MONEY-A13:认不出商家就如实标 unresolved —— 报警照发,绝不猜一个 org", async () => {
    paymentIntentsRetrieve.mockRejectedValue(new Error("no such payment_intent"));
    checkoutSessionsList.mockRejectedValue(new Error("stripe down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    constructEvent.mockReturnValue({
      id: "evt_d4", type: "charge.dispute.created",
      data: { object: { id: "dp_3", charge: "ch_4", payment_intent: "pi_4", amount: 10000, currency: "myr", status: "needs_response" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200); // 认不出人绝不影响 200 契约
    expect(founderAlert).toHaveBeenCalledTimes(1);
    expect(founderAlert.mock.calls[0]![0].context).toMatchObject({ orgId: "unresolved", orgAttribution: "unresolved" });
    expect(founderAlert.mock.calls[0]![0].action).toContain("metadata.orgId"); // 告诉人去哪里翻
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: "founder" }) }),
    );
    err.mockRestore();
  });

  it("MONEY-A13:重投一个**已经送达**的事件 ⇒ 不写第二条审计行、不发第二次报警", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ metadata: { orgId: "org_7" } });
    // 审计行主键由 event.id 派生 —— 重投撞主键。撞主键只说明「见过」,还要看那一行的送达回执。
    actionEventCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    actionEventFindUnique.mockResolvedValue({ payload: { alertDelivered: true } });
    constructEvent.mockReturnValue({
      id: "evt_d1", type: "charge.dispute.created",
      data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 5000, currency: "myr", status: "needs_response" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(founderAlert).not.toHaveBeenCalled();
  });

  it("MONEY-A13 P1-1:三条通道全挂 ⇒ 审计行留着但回执是 false,重投**会再喊一次**", async () => {
    // 这是这条钱路最坏的形状:钱被拉回、审计行写下了、报警一个人都没收到,而重投撞主键被
    // 静默 —— 没有任何人知道。`founderAlert` 是不抛的,所以「写过行」绝不能当成「有人收到」。
    paymentIntentsRetrieve.mockResolvedValue({ metadata: { orgId: "org_7" } });
    founderAlert.mockResolvedValue([
      { channel: "sentry", status: "failed", reason: "no dsn" },
      { channel: "email", status: "failed", reason: "resend 500" },
      { channel: "telegram", status: "skipped" },
    ]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = {
      id: "evt_d7", type: "charge.dispute.created",
      data: { object: { id: "dp_7", charge: "ch_7", payment_intent: "pi_7", amount: 5000, currency: "myr", status: "needs_response" } },
    };
    constructEvent.mockReturnValue(event);

    const first = await POST(req());

    expect(first.status).toBe(200);
    expect(founderAlert).toHaveBeenCalledTimes(1);
    // 一条都没送出去 ⇒ 绝不盖回执(盖了就等于告诉重投「不用再喊了」)。
    expect(actionEventUpdate).not.toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ alertDelivered: false }) }) }),
    );

    // Stripe 重投同一个事件:撞主键,但那一行写着「没送到」⇒ 再喊一次。
    actionEventCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    actionEventFindUnique.mockResolvedValue({ payload: { alertDelivered: false } });
    founderAlert.mockResolvedValue([{ channel: "email", status: "sent" }]);

    const second = await POST(req());

    expect(second.status).toBe(200);
    expect(founderAlert).toHaveBeenCalledTimes(2);
    // 这一次送到了 ⇒ 盖回执,再重投就该安静了。
    expect(actionEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stripe_pullback:evt_d7" },
        data: { payload: expect.objectContaining({ alertDelivered: true }) },
      }),
    );
    err.mockRestore();
  });

  it("MONEY-A13 P1-1:回执读不出来(库抖了)⇒ 宁可再喊一次,也不让重投被静默", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ metadata: { orgId: "org_7" } });
    actionEventCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    actionEventFindUnique.mockRejectedValue(new Error("connection reset"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    constructEvent.mockReturnValue({
      id: "evt_d8", type: "charge.dispute.created",
      data: { object: { id: "dp_8", charge: "ch_8", payment_intent: "pi_8", amount: 5000, currency: "myr", status: "needs_response" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(founderAlert).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("MONEY-A13 P2-1:session 的 metadata 也没了 ⇒ 按幂等键反查**账本**认人", async () => {
    // 归因链的最后一步(规格 §7.5 的「或 ledger 反查」):账本行是这笔钱最终的落点,
    // 它的存在本身就证明这笔钱进过谁的账。
    checkoutSessionsList.mockResolvedValue({ data: [{ id: "cs_nometa", metadata: {} }] });
    creditLedgerFindFirst.mockResolvedValue({ orgId: "org_from_ledger" });
    constructEvent.mockReturnValue({
      id: "evt_d10", type: "charge.dispute.created",
      data: { object: { id: "dp_10", charge: "ch_10", payment_intent: "pi_10", amount: 2500, currency: "myr", status: "needs_response" } },
    });

    await POST(req());

    expect(creditLedgerFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: "stripe:cs_nometa" } }));
    expect(founderAlert.mock.calls[0]![0].context).toMatchObject({ orgId: "org_from_ledger", orgAttribution: "ledger", checkoutSessionId: "cs_nometa" });
  });

  it("MONEY-A13 P2-4:dispute.closed 也能认不出人 —— 如实 unresolved,报警照发", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ metadata: {} });
    checkoutSessionsList.mockResolvedValue({ data: [] });
    constructEvent.mockReturnValue({
      id: "evt_d11", type: "charge.dispute.closed",
      data: { object: { id: "dp_11", charge: "ch_11", payment_intent: "pi_11", amount: 5000, currency: "myr", status: "won" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(founderAlert.mock.calls[0]![0].key).toBe("stripe.dispute_closed");
    expect(founderAlert.mock.calls[0]![0].context).toMatchObject({ orgId: "unresolved", orgAttribution: "unresolved", disputeStatus: "won" });
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: "founder", type: "credits.dispute.closed" }) }),
    );
  });

  it("MONEY-A13 P2-4:charge.refunded 也能认不出人 —— 如实 unresolved,报警照发", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ metadata: {} });
    checkoutSessionsList.mockResolvedValue({ data: [] });
    constructEvent.mockReturnValue({
      id: "evt_r9", type: "charge.refunded",
      data: { object: { id: "ch_9", payment_intent: "pi_r9", amount: 3000, amount_refunded: 3000, currency: "myr" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(founderAlert.mock.calls[0]![0].key).toBe("stripe.charge_refunded");
    expect(founderAlert.mock.calls[0]![0].title).toContain("MYR 30.00");
    expect(founderAlert.mock.calls[0]![0].context).toMatchObject({ orgId: "unresolved", orgAttribution: "unresolved" });
  });

  it("MONEY-A13:charge.refunded ⇒ 报警 + 审计行,零钱变动,200", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ metadata: { orgId: "org_8" } });
    constructEvent.mockReturnValue({
      id: "evt_r1", type: "charge.refunded",
      data: { object: { id: "ch_2", payment_intent: "pi_2", amount: 3000, amount_refunded: 3000, currency: "myr" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(founderAlert.mock.calls[0]![0].key).toBe("stripe.charge_refunded");
    expect(founderAlert.mock.calls[0]![0].title).toContain("MYR 30.00");
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: "org_8", type: "credits.refund" }) }),
    );
  });

  it("MONEY-A13:报警通道抛错也绝不动响应码(非 2xx 会把 Stripe 推进无限重投)", async () => {
    paymentIntentsRetrieve.mockResolvedValue({ metadata: { orgId: "org_7" } });
    founderAlert.mockRejectedValue(new Error("resend down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    constructEvent.mockReturnValue({
      id: "evt_d9", type: "charge.dispute.created",
      data: { object: { id: "dp_9", charge: "ch_9", payment_intent: "pi_9", amount: 5000, currency: "myr", status: "needs_response" } },
    });

    const res = await POST(req());

    expect(res.status).toBe(200);
    err.mockRestore();
  });

  it("200 + no grant when credits is fractional (metadata.credits = '1.5')", async () => {
    constructEvent.mockReturnValue({
      id: "evt_5", type: "checkout.session.completed",
      data: { object: { payment_status: "paid", metadata: { orgId: "org_1", credits: "1.5" } } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("200 + no grant for checkout.session.completed with payment_status !== 'paid'", async () => {
    constructEvent.mockReturnValue({
      id: "evt_4", type: "checkout.session.completed",
      data: { object: { payment_status: "no_payment_required", metadata: { orgId: "org_1", credits: "100" } } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });
});

// ── 钱路 M1-c:付的钱与给的 credits 是不是一对? ──────────────────────────────
// 在此之前没有任何东西问过这个问题:充值包只活在 Stripe 后台,webhook 拿 metadata 里的
// credits 直接入账,金额一眼都没看。后台把 RM25 的包错配成 600 credits,系统会照发。
describe("stripe webhook — 充值包核对(Founder 2026-08-18:不匹配不静默入账)", () => {
  /** 一笔付款成功的 Checkout,金额/币种/credits 可逐项注入。 */
  const paidSession = (over: Record<string, unknown>) => ({
    id: "evt_pack", type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_pack", payment_status: "paid", payment_intent: "pi_pack",
        metadata: { orgId: "org_pack", credits: "220" },
        amount_total: 10000, currency: "myr",
        ...over,
      },
    },
  });

  it("匹配 → 照常入账,不报警(三个在售包逐个跑一遍)", async () => {
    for (const [credits, amount] of [["50", 2500], ["220", 10000], ["600", 25000]] as const) {
      vi.clearAllMocks();
      actionEventCreate.mockResolvedValue({});
      grantCredits.mockResolvedValue({ ok: true });
      constructEvent.mockReturnValue(paidSession({ metadata: { orgId: "org_pack", credits }, amount_total: amount }));
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(grantCredits, `${credits}cr @ ${amount}`).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "org_pack", amount: Number(credits) * 10, idempotencyKey: "stripe:cs_pack" }),
      );
      expect(captureMessage).not.toHaveBeenCalled();
      expect(founderAlert).not.toHaveBeenCalled();
    }
  });

  it("金额对不上(付 RM25 却发 220 credits)→ **不入账** + founderAlert + 审计行", async () => {
    grantCredits.mockResolvedValue({ ok: true });
    constructEvent.mockReturnValue(paidSession({ amount_total: 2500 })); // 220cr 的包应是 10000
    const res = await POST(req());
    expect(res.status).toBe(200); // 200 = 不让 Stripe 无限重投;钱的问题交给人
    expect(grantCredits).not.toHaveBeenCalled();
    // 整顿 C1a 的口径:商家已付款而我们没发 credits = 需要人工补救 ⇒ 走全渠道
    // (Sentry + 邮件 + Telegram),不是只进 Sentry(「只进 Sentry 等于没人会去做」)。
    expect(founderAlert, "商家付了钱没拿到 credits,却没有任何人被通知").toHaveBeenCalledTimes(1);
    expect(founderAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "stripe.paid_session_pack_mismatch",
        context: expect.objectContaining({ orgId: "org_pack", amountTotal: 2500, creditsInMetadata: 220 }),
      }),
    );
    // 告诉人怎么修:补 CREDIT_PACKS 再部署,或退款。
    expect(founderAlert.mock.calls[0]![0].action).toMatch(/CREDIT_PACKS/);
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "stripe_packcheck:cs_pack",
          ownerId: "org_pack",
          type: "credits.purchase.packMismatch",
          payload: expect.objectContaining({ verdict: "mismatch", granted: false, amountTotal: 2500, credits: 220 }),
        }),
      }),
    );
  });

  it("credits 数不在包表里(后台加了包、代码没更新)→ 不入账 + 报警点名怎么修", async () => {
    grantCredits.mockResolvedValue({ ok: true });
    constructEvent.mockReturnValue(paidSession({ metadata: { orgId: "org_pack", credits: "999" }, amount_total: 45000 }));
    expect((await POST(req())).status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(founderAlert).toHaveBeenCalledTimes(1);
    // 报警要点名这一笔为什么被拦(reason 进 context),否则收到页的人无从下手。
    expect(founderAlert.mock.calls[0]![0].context.reason).toMatch(/CREDIT_PACKS/);
  });

  it("币种不是 MYR → 不入账", async () => {
    grantCredits.mockResolvedValue({ ok: true });
    constructEvent.mockReturnValue(paidSession({ currency: "usd" }));
    expect((await POST(req())).status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("没法核(Stripe 没报金额)→ **照常入账** + warning —— 「没法核」不等于「对不上」", async () => {
    grantCredits.mockResolvedValue({ ok: true });
    constructEvent.mockReturnValue(paidSession({ amount_total: null }));
    expect((await POST(req())).status).toBe(200);
    // 真付了钱的商家不能因为我们自己读不到一个字段而拿不到 credits(仓库既有口径 #786)。
    expect(grantCredits).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_pack", amount: 2200 }));
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("unverifiable"), "warning");
    // 但**不**惊动 founder:credits 已经发了,没有任何东西坏掉,也没有任何人需要动手。
    // 把不用行动的事升成 founder 页面,只会训练出「报警可以不看」。
    expect(founderAlert, "没坏的事不许惊动 founder").not.toHaveBeenCalled();
    expect(actionEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: expect.objectContaining({ verdict: "unverifiable", granted: true }) }),
      }),
    );
  });

  it("核对**不碰幂等语义**:入账仍然用 stripe:<session.id>,一个字没动", async () => {
    grantCredits.mockResolvedValue({ ok: true });
    constructEvent.mockReturnValue(paidSession({ id: "cs_idem", amount_total: 10000 }));
    await POST(req());
    expect(grantCredits).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "stripe:cs_idem" }));
  });

  it("告警通道抛错也不许把响应码带成非 2xx(否则 Stripe 对一个钱事件无限重投)", async () => {
    // founderAlert 契约上「永不抛」,但 200 契约不许依赖别的模块守不守自己的承诺
    // (与上面 async_payment_failed 那条一模一样的理由)。
    founderAlert.mockRejectedValue(new Error("every channel down"));
    grantCredits.mockResolvedValue({ ok: true });
    constructEvent.mockReturnValue(paidSession({ amount_total: 2500 }));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled(); // 告警挂了也照样拦住入账
    founderAlert.mockResolvedValue([]);
  });

  it("审计行写失败也不许把响应码带成非 2xx", async () => {
    actionEventCreate.mockRejectedValue(new Error("db down"));
    grantCredits.mockResolvedValue({ ok: true });
    constructEvent.mockReturnValue(paidSession({ amount_total: 2500 }));
    expect((await POST(req())).status).toBe(200);
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
