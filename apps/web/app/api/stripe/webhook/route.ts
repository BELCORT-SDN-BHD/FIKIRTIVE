import { stripe } from "@/lib/stripe";
import { grantCredits, prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import { newId, INTERNAL_PER_DISPLAY } from "@fikirtive/core";
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
          return new Response("ignored: missing metadata", { status: 200 }); // 200 → no retry storm
        }
        // Dedup on the Checkout SESSION id, not the event id: one session = one payment = one
        // grant. session.id stays exactly-once even if Stripe delivers multiple distinct events
        // for the same completed session, whereas event.id only dedups redeliveries of one event.
        const res = await grantCredits({
          orgId, amount: credits * INTERNAL_PER_DISPLAY, source: "PURCHASE",
          reason: "stripe top-up", createdBy: "stripe", idempotencyKey: `stripe:${session.id}`,
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
    // (credits 已发、钱没了、没人知道)。这里是 ALERT-ONLY:记审计 + 叫人,绝不
    // 自动 clawback —— 扣回用户额度是 founder 的钱决定(设计上 deferred 到 Phase 3b),
    // 且账本的负 ADJUST 需要人工核对 balance。Sentry 未配 DSN 时 captureMessage 安全 no-op。
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed" || event.type === "charge.refunded") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = event.data.object as any;
      const kind = event.type === "charge.refunded" ? "credits.refund" : "credits.dispute";
      Sentry.captureMessage(`[stripe] ${event.type} — money pulled back; check the Stripe dashboard and the credits ledger`, "warning");
      await prisma.actionEvent
        .create({
          data: {
            id: newId(),
            ownerId: "founder",
            type: kind,
            payload: {
              eventType: event.type,
              eventId: event.id,
              disputeOrChargeId: obj.id ?? null,
              chargeId: obj.charge ?? null,
              paymentIntentId: obj.payment_intent ?? null,
              amount: obj.amount ?? null,
              amountRefunded: obj.amount_refunded ?? null,
              reason: obj.reason ?? null,
              status: obj.status ?? null,
            },
          },
        })
        .catch(() => {}); // best-effort audit — the 200 (stop Stripe retries) must not depend on it
    }
    return new Response("ok", { status: 200 });
  });
}
