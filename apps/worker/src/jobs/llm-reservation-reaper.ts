import { prisma, refundReservation } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";

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
 *  no-op. Returns how many leaked reservations it swept.
 *
 *  #463 two-phase identity: the scan is cross-tenant by construction (there is no job row and
 *  no request to attach an owner to), so it runs under "llm-reservation-reaper"; each refund is
 *  re-scoped to the org the leaked RESERVE belongs to. Note the scan is raw SQL and therefore
 *  invisible to any Prisma extension — #464's comparison has to key on the refund, not the read. */
export async function reapStaleLlmReservations(): Promise<number> {
  return runAsSystem("llm-reservation-reaper", async () => {
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
      // per-row phase: the refund belongs to this org, not to the platform
      await runAsTenant(orgId, () => prisma.$transaction(async (tx) => { await refundReservation(tx, { orgId, refId }); }));
      reaped++;
    }
    return reaped;
  });
}
