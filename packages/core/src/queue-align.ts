/**
 * queue-align.ts — the fix for judge P1-2 on PR #1410 (pre-merge review of #1386's 20m→40m
 * expireInSeconds widening for GEN_QUEUE_POLICY / REFGEN_QUEUE_POLICY, gen.ts / refgen.ts).
 *
 * WHY THIS EXISTS: pg-boss 12.18.2's `create_queue` SQL function ends `ON CONFLICT DO NOTHING`
 * (node_modules/.pnpm/pg-boss@12.18.2/node_modules/pg-boss/dist/plans.js:381 — the INSERT INTO
 * `<schema>.queue`). An EXISTING queue row is therefore untouched by `boss.createQueue()`:
 * widening a *_QUEUE_POLICY constant is a silent no-op against any database where a worker
 * already created that queue under the OLD constant — the row keeps the old `expire_seconds`,
 * every job's actual expiry is still snapshotted from that row, and the safety margin the
 * #1386 derivation depends on (this package's gen.ts/refgen.ts comments,
 * apps/worker/src/jobs/clock-invariants.test.ts) is silently false in production even though
 * the constant and the tests both say 40m. Both `apps/worker/src/index.ts` (consumer boot) and
 * `apps/web/lib/queue.ts` (producer boot) only ever called `createQueue` — neither wrote the
 * new value to an already-existing row.
 *
 * THE FIX: call `boss.updateQueue(name, policy)` right after `createQueue`, every boot. Its SQL
 * (same file, `updateQueue()`, ~line 522) COALESCEs every field against the row's CURRENT
 * value — e.g. `expire_seconds = COALESCE((o.data->>'expireInSeconds')::int, expire_seconds)`
 * — so passing the SAME policy object used for `createQueue` is safe: a true no-op once the row
 * already matches, and exactly what makes an already-diverged row converge back to the current
 * constant on the next boot. `updateQueue` also THROWS if `policy` or `partition` are present
 * in `options` ("queue policy cannot be changed after creation", manager.js `updateQueue`) —
 * every `*_QUEUE_POLICY` object exported by this package only ever carries
 * retryLimit/retryDelay/retryBackoff/expireInSeconds/deadLetter, never those two keys, so they
 * are safe to pass to both calls unmodified (verified by queue-align.test.ts against a real
 * Postgres `pgboss.queue` row, not by re-asserting the pg-boss source).
 */

/**
 * Minimal structural shape of the two pg-boss calls this needs. Kept structural (not
 * `import type { PgBoss } from "pg-boss"`) so this package — which has no runtime dependency on
 * pg-boss — stays that way; the real `PgBoss` instances apps/worker and apps/web construct
 * already satisfy this shape and are passed in as-is.
 */
export interface QueueAligningBoss {
  createQueue(name: string, options?: Record<string, unknown>): Promise<void>;
  updateQueue(name: string, options?: Record<string, unknown>): Promise<void>;
}

/**
 * Create a pg-boss queue idempotently, then explicitly ALIGN an existing row to `policy` — see
 * the file header for why `createQueue` alone cannot do this. Safe to call on every boot for
 * every named queue this codebase owns; not needed for a dead-letter queue created with no
 * options (nothing on the row could drift).
 */
export async function createAndAlignQueue(
  boss: QueueAligningBoss,
  name: string,
  policy: Record<string, unknown>,
): Promise<void> {
  await boss.createQueue(name, policy);
  await boss.updateQueue(name, policy);
}
