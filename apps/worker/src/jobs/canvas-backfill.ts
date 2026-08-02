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
 *     provider call, no GenJob write of any kind. It reads finished jobs and calls ONE idempotent
 *     card-writing shell. A job it cannot repair is left for a later sweep, and after roughly three
 *     days of failures it is written off — which means its record stays on file, not that it is
 *     forgotten (see `CANVAS_REPAIR_MAX_ATTEMPTS`).
 *   - It never decides what a board should contain: `settleCanvasCardsForGenJob` runs the same
 *     single projection the delivery path runs, under the same per-job lock, and honours the
 *     merchant's deletions.
 */
import {
  clearCanvasRepairRecord,
  findCanvasSettlementBacklog,
  noteCanvasRepairFailure,
  settleCanvasCardsForGenJob,
  type CanvasSettlementBacklogJob,
} from "@fikirtive/db";
import { runAsTenant } from "@fikirtive/db/principal";

/** Leave a just-delivered job alone: its own completion path is probably still writing the cards. */
export const CANVAS_BACKFILL_GRACE_MS = 2 * 60_000;
/** Ceiling per sweep, so one bad day cannot turn a 5-minute tick into an unbounded job. */
export const CANVAS_BACKFILL_LIMIT = 200;

/**
 * Finish every delivered job whose board is still incomplete. Returns how many boards this sweep
 * actually changed (0 when there was nothing to do — the normal case).
 *
 * Runs inside the worker's reaper tick, which already carries the system principal; each repair
 * re-enters as its own tenant (#463 two-phase: cross-tenant scan, per-owner write).
 */
export async function backfillCanvasBoards(now: Date = new Date()): Promise<number> {
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
    console.error("[canvas-backfill] backlog scan failed (retries next sweep):", e instanceof Error ? e.message : e);
    return 0;
  }

  let repaired = 0;
  for (const job of due) {
    // Per-job try/catch: one unrepairable board must not stop the sweep — it waits, then retries.
    try {
      const outcome = await runAsTenant(job.ownerId, () => settleCanvasCardsForGenJob(job.id, job.ownerId));
      if (outcome.status === "settled") {
        await clearCanvasRepairRecord(job);
        if (outcome.created + outcome.updated > 0) {
          console.log(`[canvas-backfill] ${job.id}: wrote ${outcome.created} card(s), fixed ${outcome.updated}`);
          repaired += 1;
        }
        continue;
      }
      // The scan said this board was missing something and the projection disagreed — a card
      // written between the two, or a state the scan reads more loosely than the projection does.
      // Treated exactly like a failure: wait, then look again. Never dropped on the spot, because
      // "the projection said no once" is not the same as "this board can never need repair".
      await noteCanvasRepairFailure(job, { now, reason: outcome.status });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[canvas-backfill] ${job.id} failed (retries after a wait):`, reason);
      // The record is the whole reason this board keeps its turn in the queue, so a failure to
      // write it must not take the sweep down with it — the board simply stays due.
      try {
        await noteCanvasRepairFailure(job, { now, reason });
      } catch (bookkeeping) {
        console.error(
          `[canvas-backfill] ${job.id}: could not record the failed repair:`,
          bookkeeping instanceof Error ? bookkeeping.message : bookkeeping,
        );
      }
    }
  }
  return repaired;
}
