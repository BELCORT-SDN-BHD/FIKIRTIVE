/**
 * Credit service (closed-beta P2) — the ONLY writer of CreditAccount/CreditLedger.
 * The per-org credits ledger IS the spend cap (M1). Charges are deterministic
 * (pricedGenCredits/pricedRefgenCredits in @fikirtive/core), so RESERVE == SETTLE: there
 * is no variable actual-cost reconciliation. Every worker write is exactly-once via the
 * partial-unique (orgId, refId, kind) index — a resume/redelivery no-ops.
 *
 * Invariants: balance == Σ balanceDelta, reserved == Σ reservedDelta (per org). Never
 * mutate the account without writing a matching ledger row IN THE SAME transaction.
 * Costs are INTERNAL credits (1 = $0.01).
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./index.js";

/** Thrown by reserveCredits when the balance can't cover the cost. Rolls back the
 *  enclosing transaction (so the job is never created), and the action surfaces a
 *  friendly "out of credits" message. */
export class InsufficientCredits extends Error {
  /** INTERNAL credits the reserve asked for, when this came from reserveCredits. */
  readonly requiredInternal: number | null;
  /** INTERNAL credits the account actually held at refusal time; null when the account row
   *  is missing or could not be read. #791-7: the merchant-facing sentence needs the REAL
   *  balance ("you have 3.9") — reading it here, inside the failing transaction, is the only
   *  place it is known to be the number the refusal was judged against. */
  readonly balanceInternal: number | null;

  constructor(
    message = "Not enough credits.",
    detail?: { requiredInternal?: number | null; balanceInternal?: number | null },
  ) {
    super(message);
    this.name = "InsufficientCredits";
    this.requiredInternal = detail?.requiredInternal ?? null;
    this.balanceInternal = detail?.balanceInternal ?? null;
  }
}

type Tx = Prisma.TransactionClient;
const isP2002 = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** Marks a SETTLE row whose charge was cut down by the hold ceiling (#898). The suffix is the
 *  INTERNAL credits the platform absorbed on that settle: `hold-shortfall:21` = 2.1 displayed
 *  credits not charged. One prefix, so the admin ledger and any later cost report agree on how
 *  to find them: `WHERE kind = 'SETTLE' AND reason LIKE 'hold-shortfall:%'`. */
export const HOLD_SHORTFALL_REASON_PREFIX = "hold-shortfall:";

/** RESERVE `cost` internal credits for `refId`. MUST run inside the same $transaction as
 *  the GenJob/RefGenJob insert. Atomic conditional decrement: two concurrent submits
 *  serialize on the CreditAccount row and the loser affects 0 rows → InsufficientCredits
 *  (rolls back the whole tx → no job). balance can never go negative. */
export async function reserveCredits(tx: Tx, args: { orgId: string; refId: string; cost: number }): Promise<void> {
  const { orgId, refId, cost } = args;
  if (cost <= 0) return;
  const { count } = await tx.creditAccount.updateMany({
    where: { orgId, balance: { gte: cost } },
    data: { balance: { decrement: cost }, reserved: { increment: cost } },
  });
  if (count === 0) {
    // #791-7: carry the two numbers the merchant needs to hear. Read-only, and only on the
    // refusal path — the enclosing transaction is about to roll back either way, so this
    // adds no write and cannot change the money outcome.
    const account = await tx.creditAccount.findUnique({ where: { orgId }, select: { balance: true } });
    throw new InsufficientCredits(undefined, {
      requiredInternal: cost,
      balanceInternal: account?.balance ?? null,
    });
  }
  await tx.creditLedger.create({
    data: { id: randomUUID(), orgId, balanceDelta: -cost, reservedDelta: cost, kind: "RESERVE", source: "SYSTEM", refId, idempotencyKey: `reserve:${refId}` },
  });
}

/** RESERVE up to `capInternal`, but never more than the balance actually holds — the #898
 *  chat-hold semantics (Founder 2026-08-13, interim correction to #543).
 *
 *  hold = min(capInternal, balance), refused outright only when balance < minimumInternal.
 *  Before #898 the hold WAS the door: a fixed 4-credit hold meant a merchant sitting on 3.9
 *  credits could not send a message at all, while the measured cost of a message is 0.4–3.3
 *  (#536). Now the door is `minimumInternal` (1 credit) and the hold shrinks to fit.
 *
 *  Money safety is unchanged, and deliberately so:
 *   - The write is still reserveCredits' atomic conditional decrement, so balance can never
 *     go negative. The balance READ here only chooses how much to ask for; it is not what
 *     protects the account. A concurrent spend between the read and the decrement makes the
 *     decrement affect 0 rows → InsufficientCredits → the caller's transaction rolls back.
 *     Fail-closed: the race can only refuse a turn, never over-hold or under-protect.
 *   - The RESERVE ledger row still carries the exact held amount, so settle/refund keep
 *     reading the truth from the row and stay exactly-once via the same unique indexes.
 *   - `minimumInternal` is what stops a 0.0x balance from becoming free chat: reserveCredits
 *     no-ops on cost <= 0, so a hold that rounded to nothing would meter nothing.
 *
 *  Returns the amount actually held, so the caller can settle against the real hold rather
 *  than the amount it hoped for. */
export async function reserveCreditsUpTo(
  tx: Tx,
  args: { orgId: string; refId: string; capInternal: number; minimumInternal: number },
): Promise<number> {
  const { orgId, refId, capInternal, minimumInternal } = args;
  const account = await tx.creditAccount.findUnique({ where: { orgId }, select: { balance: true } });
  const balance = account?.balance ?? 0;
  if (balance < minimumInternal) {
    // The door, not the hold: name the minimum to start, and the real balance it was judged
    // against (#791-7 carries both into the merchant-facing sentence).
    throw new InsufficientCredits(undefined, {
      requiredInternal: minimumInternal,
      balanceInternal: account?.balance ?? null,
    });
  }
  const hold = Math.min(capInternal, balance);
  await reserveCredits(tx, { orgId, refId, cost: hold });
  return hold;
}

/** SETTLE the held charge for a successfully-committed job. MUST run in the worker's commit
 *  $transaction. The held amount B is read FROM THE RESERVE ROW (reservedDelta), never
 *  recomputed — immune to pricing-code drift while a job is in flight.
 *
 *  When `actualInternal` is omitted (GEN path): A = B, so `balanceDelta = 0` and
 *  `balance increment = 0` — byte-identical net effect to the original settleCredits.
 *  When `actualInternal` is supplied (Otto-LLM settle): A = clamp(trunc(actualInternal), 0, B),
 *  `balanceDelta = B - A` (the unspent portion is refunded back to balance),
 *  `reservedDelta = -B` (the whole hold is cleared). This lets the post-call token cost be
 *  less than the reserved turn budget while keeping every ledger invariant intact.
 *
 *  Safe no-op if no RESERVE exists (pre-credits job). Mutual exclusion with REFUND +
 *  double-settle idempotency are BOTH enforced by DB unique indexes
 *  (CreditLedger_finalizer_once on (orgId,refId) WHERE kind IN (SETTLE,REFUND), and the
 *  (orgId,idempotencyKey) unique): the losing/duplicate finalizer's insert hits P2002 and
 *  no-ops BEFORE any account mutation.
 *
 *  Invariants preserved: balance == Σ balanceDelta, reserved == Σ reservedDelta (per org).
 *  Never charges more than reserved; never drives balance or reserved negative. */
export async function settleCredits(tx: Tx, args: { orgId: string; refId: string; actualInternal?: number }): Promise<void> {
  const { orgId, refId, actualInternal } = args;
  const reserve = await tx.creditLedger.findFirst({ where: { orgId, refId, kind: "RESERVE" }, select: { reservedDelta: true } });
  if (!reserve) return; // no reservation (historical/pre-credits job) → nothing to settle
  const B = reserve.reservedDelta; // the exact held amount (+cost)
  // A = actual charge; clamp to [0, B] so we never charge more than reserved and never go negative.
  const requested = actualInternal === undefined ? B : Math.max(0, Math.trunc(actualInternal));
  const A = Math.min(requested, B);
  // #898: when the clamp actually bites, the difference is money the platform absorbed. It used
  // to be invisible — the hold was always above the measured peak, so the ceiling was never
  // reached, and once #898 lets the hold shrink to a small balance it can be. Recording it on
  // the SETTLE row itself (existing `reason` column, no schema change) makes it exactly-once for
  // free: the row is already the idempotency guard, so a resume or a duplicate finalizer cannot
  // double-count the absorption. Merchant-facing surfaces don't read `reason`; the founder admin
  // ledger does.
  const shortfall = requested - A;
  const reason = shortfall > 0 ? `${HOLD_SHORTFALL_REASON_PREFIX}${shortfall}` : "";
  // createMany(skipDuplicates) = INSERT … ON CONFLICT DO NOTHING — NOT try/catch: a caught
  // unique-violation would still leave the WHOLE Postgres transaction aborted, silently rolling
  // back the caller's job-status write (e.g. the resume DONE update). count===0 ⇒ already settled
  // (resume) OR a REFUND won the finalizer race ⇒ no-op, no account change.
  const { count } = await tx.creditLedger.createMany({
    data: [{ id: randomUUID(), orgId, balanceDelta: B - A, reservedDelta: -B, kind: "SETTLE", source: "SYSTEM", refId, reason, idempotencyKey: `settle:${refId}` }],
    skipDuplicates: true,
  });
  if (count === 0) return;
  // balance += (B - A): the unspent portion is refunded; reserved -= B: the full hold is cleared.
  await tx.creditAccount.update({ where: { orgId }, data: { balance: { increment: B - A }, reserved: { decrement: B } } });
}

/** REFUND a reservation on terminal failure: full release (balance restored, hold cleared)
 *  so a merchant is never charged for a generation they didn't receive (founder absorbs any
 *  real fal cost on paid-but-undelivered). MUST run in the same tx as the FAILED status
 *  write. The amount is read FROM THE RESERVE ROW (never recomputed). Mutual exclusion with
 *  SETTLE + double-refund idempotency are DB-enforced (see settleCredits): a settled job's
 *  refund insert hits the finalizer unique index → P2002 → no-op before any account change. */
export async function refundReservation(tx: Tx, args: { orgId: string; refId: string }): Promise<void> {
  const { orgId, refId } = args;
  const reserve = await tx.creditLedger.findFirst({ where: { orgId, refId, kind: "RESERVE" }, select: { reservedDelta: true } });
  if (!reserve) return; // no reservation → nothing to refund
  const amount = reserve.reservedDelta;
  // createMany(skipDuplicates) = ON CONFLICT DO NOTHING — see settleCredits: a caught P2002
  // would abort the caller's whole tx (the FAILED status write would roll back, then the worker
  // could retry and re-spend). count===0 ⇒ already refunded OR a SETTLE won the finalizer race.
  const { count } = await tx.creditLedger.createMany({
    data: [{ id: randomUUID(), orgId, balanceDelta: amount, reservedDelta: -amount, kind: "REFUND", source: "SYSTEM", refId, idempotencyKey: `refund:${refId}` }],
    skipDuplicates: true,
  });
  if (count === 0) return;
  await tx.creditAccount.update({ where: { orgId }, data: { balance: { increment: amount }, reserved: { decrement: amount } } });
}

export type CreditGrantSource = "ADMIN" | "BETA" | "PROMO" | "PURCHASE" | "SYSTEM";

/** Positive GRANT applied INSIDE the caller's transaction — so the grant is ATOMIC with
 *  whatever else the caller writes (e.g. the org-bootstrap org+membership). This closes the
 *  "org committed but grant failed → user stuck at 0 credits" gap that a separate grantCredits()
 *  call after the org tx would leave. Tx-safe + idempotent: createMany(skipDuplicates) =
 *  INSERT … ON CONFLICT DO NOTHING on the (orgId, idempotencyKey) unique, so a replay /
 *  concurrent winner yields count===0 and NO account change — and it never THROWS inside the
 *  PG tx (a caught P2002 would leave the whole transaction aborted, silently rolling back the
 *  caller's org/membership writes). Positive amounts only. */
export async function grantCreditsTx(
  tx: Tx,
  args: { orgId: string; amount: number; reason?: string; source?: CreditGrantSource; createdBy?: string; idempotencyKey: string },
): Promise<void> {
  const { orgId, amount, reason = "", source = "SYSTEM", createdBy = "", idempotencyKey } = args;
  if (amount <= 0) return;
  const { count } = await tx.creditLedger.createMany({
    data: [{ id: randomUUID(), orgId, balanceDelta: amount, reservedDelta: 0, kind: "GRANT", source, reason, createdBy, idempotencyKey }],
    skipDuplicates: true,
  });
  if (count === 0) return; // already granted (idempotent replay or concurrent winner) → no double-apply
  await tx.creditAccount.upsert({
    where: { orgId },
    create: { orgId, balance: amount, reserved: 0 },
    update: { balance: { increment: amount } },
  });
}

/** Admin/system GRANT (positive) or ADJUST (signed). Opens its own transaction. Idempotent
 *  via (orgId, idempotencyKey) — a replay returns { duplicate: true } without double-granting.
 *  A future Stripe purchase reuses this verbatim with source="PURCHASE". */
export async function grantCredits(args: {
  orgId: string;
  amount: number;
  reason?: string;
  source?: CreditGrantSource;
  createdBy?: string;
  idempotencyKey: string;
}): Promise<{ ok: true } | { duplicate: true }> {
  const { orgId, amount, reason = "", source = "ADMIN", createdBy = "", idempotencyKey } = args;
  if (amount === 0) return { ok: true };
  try {
    await prisma.$transaction(async (tx) => {
      // Ledger FIRST: a replay of the same idempotencyKey hits the (orgId,idempotencyKey)
      // unique and rolls the tx back BEFORE any account mutation (no double-apply).
      await tx.creditLedger.create({
        data: { id: randomUUID(), orgId, balanceDelta: amount, reservedDelta: 0, kind: amount > 0 ? "GRANT" : "ADJUST", source, reason, createdBy, idempotencyKey },
      });
      if (amount > 0) {
        await tx.creditAccount.upsert({
          where: { orgId },
          create: { orgId, balance: amount, reserved: 0 },
          update: { balance: { increment: amount } },
        });
      } else {
        // Negative ADJUST: atomic conditional decrement. NEVER create an account for a
        // deduction (that would record balance 0 against a negative ledger delta and break
        // balance == Σ balanceDelta), and NEVER drive balance < 0 (the conditional reserve
        // relies on a non-negative balance). count===0 → missing/underfunded account →
        // throw, rolling back the ledger row too. This is the single authoritative guard
        // (the admin action no longer needs a separate, non-atomic pre-check).
        const dec = -amount;
        const { count } = await tx.creditAccount.updateMany({
          where: { orgId, balance: { gte: dec } },
          data: { balance: { decrement: dec } },
        });
        if (count === 0) throw new InsufficientCredits("Adjustment would drive the balance negative, or the account doesn't exist.");
      }
    });
    return { ok: true };
  } catch (e) {
    if (isP2002(e)) return { duplicate: true }; // replay of the same idempotencyKey → no double-grant
    throw e; // InsufficientCredits (bad negative ADJUST) propagates to the caller
  }
}
