/**
 * canvas-backfill — the sweep that finishes a delivered job's board when the completion path
 * could not.
 *
 * WHY IT EXISTS (#601 T2b r2, judge P2①): writing the cards is the last step of a delivered job,
 * and it is deliberately best-effort — a board write must never be able to fail a job that the
 * merchant has already been charged for. Best-effort with nothing behind it, though, means a
 * board that stays half-empty forever: the job is DONE, so no redelivery and no stale-job reaper
 * ever looks at it again. This sweep is what "it can be written again later" actually means.
 *
 * WHERE THE WORKLIST LIVES (#601 r7, Founder ruling 2026-08-02). This file used to keep two
 * things in the worker's memory: how far the last tick got through a 24-hour window, and a book
 * of boards serving a backoff. Three review rounds killed that design one symptom at a time — a
 * board slipping out of the window during its wait (r4), being evicted when the book filled (r5),
 * and never being reached at all behind more failing boards than one tick's share (r6) — and they
 * were one root cause with three faces: the to-do list was in this process while the truth was in
 * the database. There is now NOTHING here that outlives a call. Every tick asks the database which
 * boards are due, oldest turn first, and the only durable thing this sweep writes is how a board's
 * repair is going (`noteCanvasRepairFailure`). A restart costs nothing, and nothing can be lost in
 * a process that no longer remembers anything.
 *
 * WHAT IT IS NOT — read this before touching it:
 *   - It NEVER touches money. No ledger, no `spent`/`spentUsd`, no reservation, no refund, no
 *     provider call, and no job-status write. It reads finished jobs, calls ONE idempotent
 *     card-writing shell, and updates only the reserved repair note. A job it cannot repair stays
 *     automatically eligible at a bounded maximum cadence.
 *   - It never decides what a board should contain: `settleCanvasCardsForGenJob` runs the same
 *     single projection the delivery path runs, under the same per-job lock, and honours the
 *     merchant's deletions.
 */
import {
  clearCanvasRepairRecord,
  findCanvasSettlementBacklog,
  noteCanvasRepairFailure,
  settleCanvasCardsForGenJob,
  type CanvasSettlementOutcome,
  type CanvasSettlementBacklogJob,
} from "@fikirtive/db";
import { runAsTenant } from "@fikirtive/db/principal";
import { sanitizeError } from "../redact.js";

/** Leave a just-delivered job alone: its own completion path is probably still writing the cards. */
export const CANVAS_BACKFILL_GRACE_MS = 2 * 60_000;
/** Ceiling per sweep, so one bad day cannot turn a 5-minute tick into an unbounded job. */
export const CANVAS_BACKFILL_LIMIT = 200;
/**
 * Leave the shared reaper tick promptly for credit refunds and other recovery work. Ten seconds is
 * long enough for several ordinary board transactions but short beside the five-minute cadence.
 */
export const CANVAS_BACKFILL_WALL_BUDGET_MS = 10_000;

/**
 * Finish every delivered job whose board is still incomplete. Returns how many boards this sweep
 * actually changed (0 when there was nothing to do — the normal case).
 *
 * Runs inside the worker's reaper tick, which already carries the system principal; each repair
 * re-enters as its own tenant (#463 two-phase: cross-tenant scan, per-owner write).
 */
export async function backfillCanvasBoards(
  now: Date = new Date(),
  options: { monotonicNow?: () => number } = {},
): Promise<number> {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const startedAtMs = monotonicNow();
  // The SCAN is inside the guard, not just the per-job repair. This sweep shares one reaper tick
  // with the refgen, LLM-reservation, research, publish and ingest recoveries, and they run in
  // sequence: a throw from the scan escaped into the tick and skipped every one of them (#601 r2
  // judge P2③) — so a bad canvas query would have stopped credits being given back. Nothing to
  // repair this tick is the worst this may cost.
  let due: CanvasSettlementBacklogJob[] = [];
  try {
    due = await findCanvasSettlementBacklog({
      now,
      graceMs: CANVAS_BACKFILL_GRACE_MS,
      limit: CANVAS_BACKFILL_LIMIT,
    });
  } catch (e) {
    console.error("[canvas-backfill] backlog scan failed (retries next sweep):", sanitizeError(e));
    return 0;
  }

  let repaired = 0;
  for (const job of due) {
    // Check BETWEEN rows: never abandon a transaction half-way through, and never let the Canvas
    // slice consume the later refund/recovery reapers' whole shared tick. Unvisited rows stay due.
    if (monotonicNow() - startedAtMs >= CANVAS_BACKFILL_WALL_BUDGET_MS) break;
    try {
      // The async callback is load-bearing: Prisma promises dispatch lazily, so returning one
      // directly would pop the tenant frame before the query actually runs.
      await runAsTenant(job.ownerId, async () => {
        const recordFailure = async (reason: string) => {
          try {
            await noteCanvasRepairFailure(job, { now, reason });
          } catch (bookkeeping) {
            console.error(
              `[canvas-backfill] ${job.id}: could not record the failed repair:`,
              sanitizeError(bookkeeping),
            );
          }
        };

        let outcome: CanvasSettlementOutcome;
        try {
          outcome = await settleCanvasCardsForGenJob(job.id, job.ownerId);
        } catch (e) {
          const reason = sanitizeError(e, 200);
          console.error(`[canvas-backfill] ${job.id} failed (retries after a wait):`, reason);
          await recordFailure(reason);
          return;
        }

        if (outcome.status === "settled") {
          // Cleanup is not settlement. If this write fails, the stale record makes the idempotent
          // board eligible again next tick; never turn a completed board into a failed repair.
          try {
            await clearCanvasRepairRecord(job);
          } catch (cleanup) {
            console.error(
              `[canvas-backfill] ${job.id}: could not clear the completed repair record:`,
              sanitizeError(cleanup),
            );
          }
          if (outcome.created + outcome.updated > 0) {
            console.log(`[canvas-backfill] ${job.id}: wrote ${outcome.created} card(s), fixed ${outcome.updated}`);
            repaired += 1;
          }
          return;
        }

        // The scan said this board was missing something and the projection disagreed — a card
        // written between the two, or a state the scan reads more loosely than the projection does.
        // "The projection said no once" is not the same as "this board can never need repair".
        await recordFailure(outcome.status);
      });
    } catch (e) {
      // Principal setup itself is the only expected path outside the per-tenant isolation above.
      console.error(`[canvas-backfill] ${job.id}: tenant repair frame failed:`, sanitizeError(e));
    }
  }
  return repaired;
}
