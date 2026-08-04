import "server-only";

import { canvasBoardNeedsSettlement } from "@fikirtive/core";
import { settleCanvasCardsForGenJob } from "@fikirtive/db";

/**
 * Read-time reconciliation — ONE brain, ONE writer.
 *
 * Opening a board used to repair it with its own private idea of what a finished job's cards
 * should be: which output the primary card carries, where a missing sibling goes, what it hangs
 * off. The worker's completion path has since grown its own answer (#601 T2a/T2b) — and two
 * answers is one too many. Taking turns on a lock stops the two writers corrupting each other; it
 * does not make them agree, and a merchant must not get a different board because a tab happened
 * to be open. Reproduced differences: the missing card of a half-deleted pair landed in different
 * places, and a batch made FROM an earlier card got its siblings from one writer and not the other.
 *
 * So the board readers no longer decide anything: they call the SAME settlement the worker calls,
 * which runs the single projection under the same per-job lock, honours the merchant's deletions,
 * and is idempotent. This function is only "which jobs are worth looking at".
 *
 * NOT a spend path: it looks at finished jobs and their cards, and calls a card writer that
 * touches no ledger, no `spent`/`spentUsd`, no reservation and no provider. It creates no GenJob.
 *
 * Reads nothing itself — the caller passes the rows it has already read, so a board that is
 * already right costs exactly zero extra queries. Returns whether anything was written, which is
 * the caller's cue to re-read the board before rendering it.
 *
 * Owner scoping: the settlement is pinned to the AUTHENTICATED ownerId the caller resolved through
 * `requireOwner`, and the caller's `jobs` are its own owner+project-scoped read. This function
 * never derives identity from a card row.
 *
 * A board somebody else is already writing still opens: see SETTLEMENT_TIMEOUT_SQLSTATES below.
 */
export async function reconcileSettledCanvasJobs(args: {
  ownerId: string;
  /** EVERY card row of this board, tombstones included — a deleted card is a durable instruction. */
  cards: readonly { genJobId: string | null; generationId: string | null; status: string }[];
  /** The jobs those cards belong to, as the caller already read them (owner+project scoped). */
  jobs: readonly { id: string; status: string; generationIds: string[] }[];
}): Promise<boolean> {
  const delivered = args.jobs.filter((job) => job.status === "DONE");
  if (!delivered.length) return false;

  const byJob = new Map<string, { generationId: string | null; status: string }[]>();
  for (const card of args.cards) {
    if (!card.genJobId) continue;
    const group = byJob.get(card.genJobId) ?? [];
    group.push({ generationId: card.generationId, status: card.status });
    byJob.set(card.genJobId, group);
  }

  let changed = false;
  for (const job of delivered) {
    if (!canvasBoardNeedsSettlement(job.generationIds, byJob.get(job.id) ?? [])) continue;
    try {
      const outcome = await settleCanvasCardsForGenJob(job.id, args.ownerId);
      if (outcome.created + outcome.updated > 0) changed = true;
    } catch (error) {
      const sqlstate = postgresErrorCode(error);
      if (sqlstate === null || !SETTLEMENT_TIMEOUT_SQLSTATES.has(sqlstate)) throw error;
      // Somebody else is writing this job's cards right now (the worker's completion path, or
      // another tab). The settlement bounds that wait in the DATABASE and gives up; the caller is
      // a merchant opening their board, so giving up must mean "show what is there", not "show
      // nothing". Stop at the first contended job — every further one would cost the same wait
      // again — and let the backfill sweep finish what this read could not.
      console.warn(
        `[canvas] settlement gave way on a contended board (job ${job.id}, SQLSTATE ${sqlstate}); showing it as it stands.`,
      );
      return changed;
    }
  }
  return changed;
}

/**
 * The two ways PostgreSQL says "your bounded wait ran out", and nothing else.
 *
 * 55P03 `lock_not_available` — the job's placement lock was held past `lock_timeout`.
 * 57014 `query_canceled`     — the statement ran past `statement_timeout`.
 *
 * Matched on SQLSTATE, never on wording: the message is PostgreSQL's to reword. Every OTHER
 * database failure stays a hard failure — a board that is wrong for any other reason must not be
 * quietly served as if it were right.
 */
const SETTLEMENT_TIMEOUT_SQLSTATES = new Set(["55P03", "57014"]);

/**
 * The SQLSTATE of a driver failure, wherever this Prisma version parked it: a RAW statement (the
 * advisory lock) surfaces as P2010 carrying the driver error under `meta`, an ORM statement
 * surfaces as the driver error itself. Both spell the code the same way underneath.
 */
function postgresErrorCode(error: unknown): string | null {
  const carriers = [error, (error as { meta?: { driverAdapterError?: unknown } })?.meta?.driverAdapterError];
  for (const carrier of carriers) {
    const code = (carrier as { cause?: { code?: unknown } })?.cause?.code;
    if (typeof code === "string") return code;
  }
  return null;
}
