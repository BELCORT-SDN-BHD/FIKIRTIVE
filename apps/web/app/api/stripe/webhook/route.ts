import { stripe } from "@/lib/stripe";
import { founderAlert } from "@/lib/founder-alert";
import { grantCredits, prisma } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import { newId, INTERNAL_PER_DISPLAY, verifyCreditPackPurchase } from "@fikirtive/core";
import * as Sentry from "@sentry/node";
import type { NextRequest } from "next/server";

// Unauthenticated by design — Stripe calls this; the SIGNATURE is the auth. proxy.ts excludes
// api/stripe from the wall. Always 200 for handled/ignored events so Stripe stops retrying;
// only a bad signature is 4xx.
//
// #463: the whole handler runs under the named system identity "stripe-webhook" — there is no
// session here by construction. The orgId is NOT client input: it is server-minted under a real
// principal at lib/billing-actions.ts and round-trips through Stripe metadata, so it stays the
// tenant key exactly as before. Nothing about the signature check, the dedup key, the grant, or
// any status code changes; #463 only names the writer.
export async function POST(req: NextRequest): Promise<Response> {
  return runAsSystem("stripe-webhook", async () => {
    const body = await req.text(); // RAW body required for signature verification
    const sig = req.headers.get("stripe-signature") ?? "";
    let event: ReturnType<typeof stripe.webhooks.constructEvent>;
    try {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET ?? "");
    } catch (e) {
      return new Response(`Webhook signature verification failed: ${e instanceof Error ? e.message : "error"}`, { status: 400 });
    }

    // F01: async_payment_succeeded fires when a delayed-notification method (e.g. FPX/GrabPay)
    // settles AFTER the session completed 'unpaid' — grant on it too, or that customer pays and
    // never receives credits. The stripe:<session.id> idempotencyKey keeps it exactly-once even
    // if both completed(paid) and async_payment_succeeded arrive for the same session.
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = event.data.object as any;
      if (session.payment_status === "paid") {
        const orgId = typeof session.metadata?.orgId === "string" ? session.metadata.orgId : "";
        const credits = Number(session.metadata?.credits);
        if (!orgId || !credits || credits <= 0 || !Number.isInteger(credits)) {
          await prisma.actionEvent.create({ data: { id: newId(), ownerId: "founder", type: "credits.purchase.bad", payload: { eventId: event.id, metadata: session.metadata ?? null } } }).catch(() => {});
          // 整顿 C1a:这条分支是这个文件里**唯一**一条「真钱进账、我们不知道该给谁」却
          // 只写审计不叫人的路。它下面那两条(async_payment_failed / dispute·refund)从第一天
          // 起就报警,而这一条更硬 —— 那两条是钱没来或钱被拉回,这一条是**商家已经付了款**,
          // 而 metadata 坏掉让我们发不出 credits。对齐它们,并且升到 founderAlert(需要人工
          // 补发,只进 Sentry 等于没人会去做)。
          //
          // 报警绝不决定响应码:一个会抛的报警通道会让这个 handler 返回非 2xx,把 Stripe 推进
          // 一场发生在钱事件上的无限重试。派发本身已经承诺永不抛(dispatchFounderAlert 的契约),
          // 这里再包一层 try —— 与下面 async_payment_failed 那条一模一样的理由:200 契约不许
          // 依赖别的模块守不守自己的承诺。
          try {
            await founderAlert({
              key: "stripe.paid_session_unusable_metadata",
              title: "A Stripe payment succeeded but we cannot tell which merchant it belongs to",
              action:
                "Grant the credits by hand: open the session in the Stripe dashboard, find the buyer, then add the credits to their org. Nothing automatic will retry this — Stripe was answered 200 on purpose so it stops redelivering.",
              context: {
                stripeEventId: event.id,
                stripeSessionId: typeof session.id === "string" ? session.id : null,
                paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
                amountTotal: typeof session.amount_total === "number" ? session.amount_total : null,
                currency: typeof session.currency === "string" ? session.currency : null,
                orgIdInMetadata: orgId || null,
                creditsInMetadata: Number.isFinite(credits) ? credits : null,
              },
            });
          } catch (e) {
            console.error(`[stripe] ${event.type} paid-session alert failed; session=${typeof session.id === "string" ? session.id : "unknown"}:`, e);
          }
          return new Response("ignored: missing metadata", { status: 200 }); // 200 → no retry storm
        }
        // 钱路 M1-c(2026-08-18):**付的钱与给的 credits 是不是一对?**
        //
        // 在此之前没有任何东西问过这个问题。充值包只活在 Stripe 后台,webhook 拿 metadata 里的
        // credits 直接入账,金额一眼都没看 —— 后台把 RM25 的包错配成 600 credits,系统会照发,
        // 一声不响。现在包表在代码里(@fikirtive/core CREDIT_PACKS),这里逐笔核对。
        //
        // 三态,不是两态(仓库既有口径 #786:「对不上」≠「没法核」):
        //   match        → 照常入账。
        //   mismatch     → **不入账**,报警(Founder 裁决:金额或 credits 不匹配 → 不静默入账)。
        //   unverifiable → Stripe 这次没报金额/币种。报警,但照常入账 —— 拿一个我们自己读不到
        //                  的字段去坑掉一个真付了钱的商家,是在用错误的方向 fail closed。
        //
        // 这道核对**不碰幂等语义**:它只在 grantCredits 之前决定「要不要走这一步」,
        // 键仍是 stripe:<session.id>,重投照旧命中同一条账,exactly-once 一个字没动。
        const packCheck = verifyCreditPackPurchase({
          credits,
          amountTotal: session.amount_total,
          currency: session.currency,
        });
        if (packCheck.verdict !== "match") {
          const detail =
            `[stripe] credits.purchase pack check ${packCheck.verdict} — ${packCheck.reason}; ` +
            `session=${session.id ?? "unknown"} org=${orgId} credits=${credits} ` +
            `amount_total=${String(session.amount_total)} currency=${String(session.currency)}`;
          // 报警不许决定响应码:一个抛错的告警通道会让这里返回非 2xx,把 Stripe 推进无限重投。
          //
          // 两种结论,两种报警强度 —— 这个区分是刻意的:
          //   mismatch     商家**已经付了款**而我们没发 credits,必须有人动手(补发,或者
          //                Stripe 后台加了包却没更新 CREDIT_PACKS 就去补表+部署)。这与上面
          //                「metadata 坏掉发不出 credits」是同一族事故,所以走同一条
          //                founderAlert(Sentry + 邮件 + Telegram)——整顿 C1a 的原话:
          //                「只进 Sentry 等于没人会去做」。
          //   unverifiable credits **已经照常发了**,没有任何东西坏掉,只是这一笔我们没能核。
          //                它不需要任何人动手,所以停在 Sentry warning:把不用行动的事升成
          //                founder 页面,只会训练出「报警可以不看」。
          if (packCheck.verdict === "mismatch") {
            try {
              await founderAlert({
                key: "stripe.paid_session_pack_mismatch",
                title: "A Stripe payment succeeded but the amount and the credits do not match any pack we sell",
                action:
                  "Nothing automatic will retry this — Stripe was answered 200 on purpose. Check the session in the Stripe dashboard: if it is a real pack we forgot to add to CREDIT_PACKS (packages/core/src/pricing-config.ts), add it and deploy, then grant this buyer's credits by hand. If the amount is genuinely wrong, refund it.",
                context: {
                  reason: packCheck.reason,
                  stripeEventId: event.id,
                  stripeSessionId: typeof session.id === "string" ? session.id : null,
                  paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
                  amountTotal: typeof session.amount_total === "number" ? session.amount_total : null,
                  currency: typeof session.currency === "string" ? session.currency : null,
                  orgId,
                  creditsInMetadata: credits,
                },
              });
            } catch (e) {
              console.error(`${detail} — founder alert failed:`, e);
            }
          } else {
            try {
              Sentry.captureMessage(detail, "warning");
            } catch (e) {
              console.error(`${detail} — alert transport failed:`, e);
            }
          }
          await prisma.actionEvent
            .create({
              data: {
                // session id 派生 → Stripe 重投撞主键,审计行 exactly-once 靠 DB 约束而不是查后写。
                id: session.id ? `stripe_packcheck:${session.id}` : newId(),
                ownerId: orgId,
                type: "credits.purchase.packMismatch",
                payload: {
                  verdict: packCheck.verdict,
                  reason: packCheck.reason,
                  eventId: event.id,
                  sessionId: session.id ?? null,
                  credits,
                  amountTotal: session.amount_total ?? null,
                  currency: session.currency ?? null,
                  granted: packCheck.verdict === "unverifiable",
                },
              },
            })
            .catch(() => {});
          if (packCheck.verdict === "mismatch") {
            // 200 → Stripe 不重投。钱已经收了,credits 没发,报警已响,人来处理。
            return new Response("ignored: pack mismatch", { status: 200 });
          }
        }
        // Dedup on the Checkout SESSION id, not the event id: one session = one payment = one
        // grant. session.id stays exactly-once even if Stripe delivers multiple distinct events
        // for the same completed session, whereas event.id only dedups redeliveries of one event.
        const res = await grantCredits({
          orgId, amount: credits * INTERNAL_PER_DISPLAY, source: "PURCHASE",
          reason: "stripe top-up", createdBy: "stripe", idempotencyKey: `stripe:${session.id}`,
        });
        // MONEY-A9 计费四则④:充值**唤醒**因余额不足停下来的素材理解(规格 §7.3
        // 「恢复=充值事件唤醒+扫描器兜底轮询」)。没有这一句,商家充完值还要等最多一分钟的
        // 扫描轮询才看得到 Otto 继续认识他的店 —— 而他刚刚付过钱,那一分钟是他在盯着看的。
        //
        // 这里**不判余额够不够**:唯一有权决定钱够不够的是 reserve 本身(它是原子条件扣减)。
        // 这一句只负责把行放回队列,不够就再暂停一次 —— 而那是有界的,因为下一次充值才会再
        // 唤醒。反过来在这里判,就等于把余额判据抄了第二份,两份迟早不一样。
        // 幂等:重投同一个 session 只是又跑一次 updateMany,没有匹配的行就 0 行,无害。
        // #463 两段式:webhook 整体跑在系统身份下,这一笔写入回到它自己的租户。
        await runAsTenant(orgId, async () =>
          prisma.assetUnderstanding.updateMany({
            where: { ownerId: orgId, status: "PAUSED_BALANCE" },
            data: { status: "QUEUED", error: null },
          }),
        ).catch((e) => {
          // 唤醒失败绝不许改这条 webhook 的响应码(200 契约 —— 非 2xx 会把 Stripe 推进重投),
          // 也绝不许挡住下面那行审计。扫描器第 ④ 段是同一件事的兜底,下一轮照样把行捞回来。
          console.error(`[stripe] understanding wake-up failed for org=${orgId}:`, e);
        });
        await prisma.actionEvent.create({ data: { id: newId(), ownerId: orgId, type: "credits.purchase", payload: { credits, amountTotal: session.amount_total ?? null, paymentIntentId: session.payment_intent ?? null, sessionId: session.id ?? null, eventId: event.id, duplicate: "duplicate" in res } } }).catch(() => {});
      }
    }
    // #552: async_payment_failed is the other half of F01 — the delayed-notification payment
    // (FPX/GrabPay) never settled after the session completed 'unpaid'. It used to fall through
    // to a bare 200: no audit, no alert, and a merchant left waiting for credits that will never
    // arrive. This branch NEVER grants and never WRITES the ledger — no money came in, so there
    // is nothing to issue and nothing to claw back (it only READS the ledger, to keep the audit
    // honest when a paid 'completed' arrived first). The ActionEvent id is derived from the
    // Checkout SESSION id — same family as the stripe:<session.id> ledger key on the grant side —
    // so a Stripe redelivery collides on the primary key and the audit row stays exactly-once
    // through a DB constraint, not a race-prone check-then-act. The alert stays at-least-once on
    // purpose: a DB fault must not be able to silence it.
    if (event.type === "checkout.session.async_payment_failed") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = event.data.object as any;
      const sessionId = typeof session.id === "string" && session.id ? session.id : "";
      const orgId = typeof session.metadata?.orgId === "string" ? session.metadata.orgId : "";
      // A paid 'completed' can land before a late failure event for the same session. Telling
      // operations "the buyer received NO credits" there would send them hunting for a payment
      // that was in fact already honoured — so ask the grant side, READ ONLY, tenant-scoped on
      // the (orgId, idempotencyKey) unique key. Nothing here writes or reverses a ledger row:
      // clawback stays a founder decision, exactly as in the dispute branch below. Without an
      // orgId the grant branch above can never have run, so "not granted" is provable and the
      // query would be theatre; a lookup that itself fails is reported as unknown, not guessed.
      let alreadyGranted: boolean | null = false;
      if (orgId && sessionId) {
        try {
          alreadyGranted = !!(await prisma.creditLedger.findUnique({
            where: { orgId_idempotencyKey: { orgId, idempotencyKey: `stripe:${sessionId}` } },
            select: { id: true },
          }));
        } catch {
          alreadyGranted = null;
        }
      }
      const outcome = alreadyGranted === null
        ? "grant status UNKNOWN (ledger lookup failed) — check the credits ledger before replying to the buyer"
        : alreadyGranted
          ? "credits for this session were ALREADY granted — a late failure contradicts the ledger; reconcile in Stripe (no automatic clawback)"
          : "the buyer received NO credits";
      // Alerting must never decide the response code. A throwing alert transport would reject
      // this handler, return non-2xx, and put Stripe into an unbounded retry storm on a money
      // event — so the alert degrades to a log and the 2xx contract holds either way.
      try {
        Sentry.captureMessage(`[stripe] ${event.type} — a delayed payment never settled; ${outcome}`, "warning");
      } catch (e) {
        console.error(`[stripe] ${event.type} alert failed (${outcome}); session=${sessionId || "unknown"}:`, e);
      }
      await prisma.actionEvent
        .create({
          data: {
            // No sessionId (shouldn't happen) → a fresh ULID, so an unkeyable failure is still
            // recorded rather than colliding with every other unkeyable one.
            id: sessionId ? `stripe_failed:${sessionId}` : newId(),
            ownerId: orgId || "founder",
            type: "credits.purchase.failed",
            payload: {
              eventId: event.id,
              sessionId: sessionId || null,
              paymentIntentId: session.payment_intent ?? null,
              paymentStatus: session.payment_status ?? null,
              credits: session.metadata?.credits ?? null,
              amountTotal: session.amount_total ?? null,
              orgId: orgId || null,
              alreadyGranted, // true | false | null(=lookup failed, status unknown)
            },
          },
        })
        .catch(() => {}); // best-effort audit; a redelivery hits the PK and is correctly dropped
    }
    // 2026-07-04 盲区修复:争议/退款 = 真钱被拉回,而系统此前对这些事件完全静默
    // (credits 已发、钱没了、没人知道)。这里仍然是 ALERT-ONLY:记审计 + 叫人,绝不
    // 自动 clawback —— 拒付总法(规格九问 5)明写不建负余额、不倒扣,处置一律人工逐案。
    // 旧注释里「deferred 到 Phase 3b」的说法已废止:归宿就是那条拒付总法。
    //
    // MONEY-A13(规格 §7.5)在这里改了三件事:
    //   ① 裸 Sentry → founderAlert 三通道。拒付是要人当天动手的事(暂停账号、应诉或接受、
    //      登记平台损失),只进 Sentry 等于说给没有人听。
    //   ② dispute.created / dispute.closed **分开 kind**:一个是「开始了」,一个是「结案了」,
    //      处置动作完全不同(前者要暂停+应诉,后者要按输赢在台账追加结案行)。
    //   ③ 报警**带商家 org 与金额**。以前审计行的 ownerId 硬编码 "founder",认人全靠人工翻
    //      Stripe 后台 —— 而这三个事件的对象(Dispute / Charge)身上根本没有 Checkout Session
    //      的 metadata,所以要靠 `attributeStripeOrg` 一路反查;查不到就如实标 unresolved,
    //      绝不猜。
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed" || event.type === "charge.refunded") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = event.data.object as any;
      const kind =
        event.type === "charge.refunded"
          ? "credits.refund"
          : event.type === "charge.dispute.created"
            ? "credits.dispute.created"
            : "credits.dispute.closed";
      const paymentIntentId = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
      const found = await attributeStripeOrg(obj, paymentIntentId);
      const amount = typeof obj.amount === "number" ? obj.amount : null;
      const amountRefunded = typeof obj.amount_refunded === "number" ? obj.amount_refunded : null;
      const currency = typeof obj.currency === "string" ? obj.currency.toUpperCase() : null;
      const minor = amountRefunded ?? amount;
      const money = minor === null ? "an unknown amount" : `${currency ?? "?"} ${(minor / 100).toFixed(2)}`;

      // 审计行的主键由 **Stripe event.id** 派生(以前是 newId(),于是一次重投就多一条审计行、
      // 多一封邮件)。但「写过审计行」不等于「有人收到了」——`founderAlert` 是**不抛**的:三条
      // 通道全挂它照样返回,只是每一条都写着 failed。所以光靠主键去重,会出现这种最坏形状:
      // 首投写下了行、报警一条都没送出去、Stripe 重投撞主键被静默 —— 钱被拉回,而没有一个人
      // 知道。判据因此不是「见过这个事件没有」,而是「**这个事件的报警送到人手里了没有**」。
      //
      //   写得下去           ⇒ 首投,报警;送出去了就把行标成 alertDelivered=true。
      //   撞主键 P2002       ⇒ 重投,读那一行:上一次没送到就**再喊一次**,送到了才安静。
      //   其它写失败         ⇒ 说不准 ⇒ 照常报警(fail loud:钱被拉回,宁可多喊一次)。
      const auditId = `stripe_pullback:${event.id}`;
      let mustAlert = true;
      try {
        await prisma.actionEvent.create({
          data: {
            id: auditId,
            ownerId: found.orgId ?? "founder",
            type: kind,
            payload: {
              eventType: event.type,
              eventId: event.id,
              disputeOrChargeId: obj.id ?? null,
              chargeId: obj.charge ?? null,
              paymentIntentId,
              amount,
              amountRefunded,
              currency,
              reason: obj.reason ?? null,
              status: obj.status ?? null,
              // 认人的结果与**怎么认出来的**一起留档:半年后翻账的人要能判断这个 org 可不可信。
              orgId: found.orgId,
              orgAttribution: found.source,
              checkoutSessionId: found.sessionId,
              // 送达回执。写行的这一刻还没喊过,所以只能是 false;送出去之后才翻成 true。
              alertDelivered: false,
            },
          },
        });
      } catch (e) {
        const duplicate = typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
        if (duplicate) mustAlert = await pullbackAlertUndelivered(auditId);
        else console.error(`[stripe] ${event.type} audit write failed (event=${event.id}); alerting anyway:`, e);
      }

      if (mustAlert) {
        // 报警绝不决定响应码(与本文件其它分支同一条规矩):一个会抛的报警通道会让 handler
        // 返回非 2xx,把 Stripe 推进一场发生在钱事件上的无限重投。
        let delivered = false;
        try {
          const outcomes = await founderAlert({
            key:
              event.type === "charge.refunded"
                ? "stripe.charge_refunded"
                : event.type === "charge.dispute.created"
                  ? "stripe.dispute_opened"
                  : "stripe.dispute_closed",
            title:
              event.type === "charge.dispute.created"
                ? `A cardholder disputed a Stripe payment (chargeback) — ${money}`
                : event.type === "charge.dispute.closed"
                  ? `A Stripe payment dispute closed (${typeof obj.status === "string" ? obj.status : "outcome unknown"}) — ${money}`
                  : `A Stripe charge was refunded — ${money}`,
            action:
              found.orgId === null
                ? "We could NOT tell which merchant this belongs to. Find them in the Stripe dashboard (Payments → this charge → its Checkout Session → metadata.orgId), then follow docs/runbooks/chargeback.md."
                : "Follow docs/runbooks/chargeback.md: suspend the org from the admin Tenants panel, decide in Stripe whether to contest or accept, and log the platform loss in docs/ops/manual-money-ledger.md. Nothing is clawed back automatically — the ledger never goes negative.",
            context: {
              orgId: found.orgId ?? "unresolved",
              orgAttribution: found.source,
              amountMinor: minor,
              currency,
              eventType: event.type,
              stripeEventId: event.id,
              disputeOrChargeId: typeof obj.id === "string" ? obj.id : null,
              paymentIntentId,
              checkoutSessionId: found.sessionId,
              disputeStatus: typeof obj.status === "string" ? obj.status : null,
              disputeReason: typeof obj.reason === "string" ? obj.reason : null,
            },
          });
          // 「送到了」= 至少一条通道真的把它交出去了。`skipped`(这台部署没配这条通道)与
          // `failed` 都不算:两者的共同点是**没有人收到**,而回执要记的就是这件事。
          delivered = outcomes.some((o) => o.status === "sent");
        } catch (e) {
          console.error(`[stripe] ${event.type} founder alert failed (event=${event.id}):`, e);
        }
        if (delivered) await markPullbackAlertDelivered(auditId);
        else {
          console.error(
            `[stripe] ${event.type} alert reached NOBODY (event=${event.id}) — the audit row stays alertDelivered=false, ` +
              `so a Stripe redelivery of this event will try again.`,
          );
        }
      }
    }
    return new Response("ok", { status: 200 });
  });
}

/** 这个事件的报警上次**没送到**吗?读不到那一行(或它读不出回执)就当没送到 —— 钱被拉回,
 *  宁可多喊一次,也不许因为一次读失败让重投被静默。**永不抛**。 */
async function pullbackAlertUndelivered(auditId: string): Promise<boolean> {
  try {
    const row = await prisma.actionEvent.findUnique({ where: { id: auditId }, select: { payload: true } });
    if (!row) return true;
    return (row.payload as { alertDelivered?: unknown } | null)?.alertDelivered !== true;
  } catch (e) {
    console.error(`[stripe] could not read the pullback audit row ${auditId}; alerting again to be safe:`, e);
    return true;
  }
}

/** 盖上送达回执。**只翻这一格**:事件本身的事实(金额、org、归因来源)一个字都不重写 ——
 *  ActionEvent 仍然是只追加的审计日志,这里改的是「这条报警送到了没有」的收条。**永不抛**。 */
async function markPullbackAlertDelivered(auditId: string): Promise<void> {
  try {
    const row = await prisma.actionEvent.findUnique({ where: { id: auditId }, select: { payload: true } });
    const payload = (row?.payload ?? {}) as Record<string, unknown>;
    await prisma.actionEvent.update({
      where: { id: auditId },
      data: { payload: { ...payload, alertDelivered: true, alertDeliveredAt: new Date().toISOString() } },
    });
  } catch (e) {
    // 回执写不上去只有一个后果:这个事件万一被重投,人会多收到一次报警。可以接受。
    console.error(`[stripe] could not stamp the delivery receipt on ${auditId}:`, e);
  }
}

/**
 * 「这笔被拉回的钱是谁的?」—— 拒付/退款事件的商家归因(MONEY-A13,规格 §7.5)。
 *
 * 为什么需要一条链:Dispute 与 Charge 身上**没有** Checkout Session 的 metadata,而账本行的
 * 反查键是 `(orgId, idempotencyKey)` —— 要 orgId 才查得动,链是断的。三步,从便宜到贵:
 *   ① 事件对象自己的 metadata —— 零外呼。
 *   ② PaymentIntent 的 metadata —— `createTopupCheckout` 的 `payment_intent_data` 写的就是它
 *      (本次施工新增),新付款走这条。
 *   ③ 按 payment_intent 反查 Checkout Session —— 老付款(PaymentIntent 上没写过 metadata 的
 *      那些)只能靠它,是**历史兼容**的那一步。
 *   ④ 拿到了 session id 却连它的 metadata 都没有(被清过、或那笔根本不是我们开的结账),就用
 *      入账那把幂等键 `stripe:<sessionId>` **反查账本**(规格 §7.5 明写的「或 ledger 反查」)。
 *      账本行是这笔钱最后的落点:它记着 orgId,而且它的存在本身就证明这笔钱进过谁的账。
 * 每一步都吞掉自己的异常:认不出人不是不报警的理由,报警照发、如实标 unresolved。
 */
async function attributeStripeOrg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: any,
  paymentIntentId: string | null,
): Promise<{ orgId: string | null; sessionId: string | null; source: "event-metadata" | "payment-intent" | "checkout-session" | "ledger" | "unresolved" }> {
  const direct = typeof obj?.metadata?.orgId === "string" ? obj.metadata.orgId : "";
  if (direct) return { orgId: direct, sessionId: null, source: "event-metadata" };
  if (!paymentIntentId) return { orgId: null, sessionId: null, source: "unresolved" };
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const fromIntent = typeof intent?.metadata?.orgId === "string" ? intent.metadata.orgId : "";
    if (fromIntent) return { orgId: fromIntent, sessionId: null, source: "payment-intent" };
  } catch (e) {
    console.error(`[stripe] could not read PaymentIntent ${paymentIntentId} for org attribution:`, e);
  }
  let sessionId: string | null = null;
  try {
    const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
    const session = sessions?.data?.[0];
    sessionId = typeof session?.id === "string" ? session.id : null;
    const fromSession = typeof session?.metadata?.orgId === "string" ? session.metadata.orgId : "";
    if (fromSession) return { orgId: fromSession, sessionId, source: "checkout-session" };
  } catch (e) {
    console.error(`[stripe] could not list Checkout Sessions for ${paymentIntentId} during org attribution:`, e);
  }
  if (sessionId) {
    try {
      // 入账那一行的身份就是这把幂等键 —— 与 grantCredits 写下的逐字同一把。
      const entry = await prisma.creditLedger.findFirst({ where: { idempotencyKey: `stripe:${sessionId}` }, select: { orgId: true } });
      if (entry?.orgId) return { orgId: entry.orgId, sessionId, source: "ledger" };
    } catch (e) {
      console.error(`[stripe] could not read the credits ledger for session ${sessionId} during org attribution:`, e);
    }
  }
  return { orgId: null, sessionId, source: "unresolved" };
}
