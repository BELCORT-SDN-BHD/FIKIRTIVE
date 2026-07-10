/**
 * PUBLISH queue contract (L1 spec §四A — Seam 6). The scheduler enqueues one job per due,
 * approved ScheduledPost; the worker's publish handler drives channel adapter `publish()`.
 *
 * Seam 6 铁律: this policy object is the SINGLE source of truth — web (apps/web/lib/queue.ts
 * getBoss, the producer) and the worker (apps/worker/src/index.ts, the consumer) BOTH create
 * PUBLISH_QUEUE with THIS exact object, so boot order can never leave them split.
 */
import { z } from "zod";

export const PUBLISH_QUEUE = "publish";
export const PUBLISH_DLQ = `${PUBLISH_QUEUE}.dlq`;

/** Payload = just the ScheduledPost id; the worker owner-scopes everything off it (never trusts a
 *  client-supplied owner). Bounded like every other queue payload so a malformed id can't reach
 *  the worker. */
export const publishJobData = z.object({ scheduledPostId: z.string().min(1).max(64) }).strict();
export type PublishJobData = z.infer<typeof publishJobData>;

/** Transient/timeout retries (six-state ④). Above the retry budget the worker stops in
 *  NEEDS_ATTENTION (fail-closed, never a silent FAILED) — this is the pg-boss ceiling. */
export const PUBLISH_RETRY_LIMIT = 4;

export const PUBLISH_QUEUE_POLICY = {
  retryLimit: PUBLISH_RETRY_LIMIT,
  retryBackoff: true,
  // Explicit base delay. WITHOUT it pg-boss defaults retry_delay=0, which makes retryBackoff a
  // silent no-op (start_after = now()) → a transient Meta 5xx / 429 would retry INSTANTLY in a
  // storm. Publishing is a low-frequency action, so a generous base is free insurance (§四A铁律).
  retryDelay: 60,
  // MUST be longer than the slowest LEGAL auto-publish so a still-running publish is never expired
  // + redelivered (a duplicate delivery would wrongly try to re-claim). L1 auto-publishes only fast
  // paths (IG feed-image / carousel, FB feed); reels/stories are "reminder" (not auto-published).
  // Carousel builds N sub-containers + a parent, so give generous margin. The reaper's stale cutoff
  // sits ABOVE this (apps/worker) so reaper and queue agree on "the worker crashed".
  expireInSeconds: 60 * 5,
  deadLetter: PUBLISH_DLQ,
} as const;
