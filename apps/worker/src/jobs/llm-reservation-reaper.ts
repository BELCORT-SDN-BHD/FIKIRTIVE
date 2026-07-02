import { prisma, refundReservation } from "@fikirtive/db";

// An Otto LLM credit reservation (withLlmBudget) is held for at most one turn. 60 min is
// comfortably longer than any real turn (incl. the worker verdict turn, which runs after a
// gen the gen-reaper already bounds at 25 min), so a RESERVE older than this with no
// finalizer can only be a leak from a process death between reserve and settle.
const LLM_RESERVATION_STALE_MS = 1000 * 60 * 60;

/** Reaper for leaked Otto/LLM credit reservations (F03). withLlmBudget reserves credits in
 *  its own committed transaction BEFORE the LLM call, then settles or refunds after. A crash
 *  (deploy SIGKILL, OOM) in between leaves a bare RESERVE with no finalizer and no job row for
 *  the gen/refgen reapers to key on — the hold leaks permanently.
 *
 *  This sweeps RESERVE rows whose refId carries a known LLM prefix (GenJob/RefGenJob use bare
 *  ULID refIds, so the prefix filter keeps this reaper off the generation spend path), older
 *  than the stale window, with NO SETTLE/REFUND finalizer, and refunds them. refundReservation
 *  is idempotent and mutually exclusive with SETTLE via the CreditLedger_finalizer_once unique
 *  index, so a settle/refund that lands between the query and the refund makes this a safe
 *  no-op. Returns how many leaked reservations it swept. */
export async function reapStaleLlmReservations(): Promise<number> {
  const cutoff = new Date(Date.now() - LLM_RESERVATION_STALE_MS);
  const leaked = await prisma.$queryRaw<{ orgId: string; refId: string }[]>`
    SELECT r."orgId", r."refId"
    FROM "CreditLedger" r
    WHERE r."kind" = 'RESERVE'
      AND r."createdAt" < ${cutoff}
      AND (
        r."refId" LIKE 'otto-turn:%' OR r."refId" LIKE 'otto-stream:%' OR
        r."refId" LIKE 'otto-approve:%' OR r."refId" LIKE 'otto-verdict:%' OR
        r."refId" LIKE 'brand-research:%' OR r."refId" LIKE 'draft:%' OR
        r."refId" LIKE 'enhance:%' OR r."refId" LIKE 'research:%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "CreditLedger" f
        WHERE f."orgId" = r."orgId" AND f."refId" = r."refId"
          AND f."kind" IN ('SETTLE', 'REFUND')
      )`;
  let reaped = 0;
  for (const { orgId, refId } of leaked) {
    await prisma.$transaction(async (tx) => { await refundReservation(tx, { orgId, refId }); });
    reaped++;
  }
  return reaped;
}
