/**
 * #795 — THE rate limiter. One fixed-window counter, in Postgres, shared by every instance.
 *
 * WHAT WAS WRONG. Every gate in this product counted in PROCESS MEMORY. Two consequences, both
 * silent:
 *   ① a second web instance means a second set of counters, so every limit's real budget doubles
 *      the moment we scale out — nothing errors, nothing logs, the gate simply stops being the
 *      number it says it is;
 *   ② a deploy restarts the process, so every window resets to zero on our schedule rather than
 *      the attacker's.
 * Beta is OPEN REGISTRATION (Founder, 2026-08-11): anyone can create an account, so the public
 * doors are the ones that carry the load, and "the gate is a number nobody can trust" is not a
 * scaling nicety — it is the abuse story.
 *
 * ── THE THREE PROPERTIES THIS HAS TO HOLD AT ONCE ──────────────────────────────────────────
 *
 * ① A REFUSED REQUEST CHARGES NOTHING. #757 already bought this lesson once, in the in-memory
 *    magic-link throttle: if a refusal also advances the counter, the window never ends while
 *    anybody keeps pressing. Read as an abuse cap that sounds strict; read as availability it is
 *    a lockout with no end — and because the loose bucket is keyed on a SHARED egress address, it
 *    is usually somebody ELSE's lockout (one person's retry loop on a cafe's wifi holds the whole
 *    floor's budget open). The sustained rate is identical either way, so charging refusals buys
 *    nothing but starving the impatient user's neighbours.
 *
 * ② A REQUEST IS CHARGED TO EVERY BUCKET OR TO NONE. A call may name several buckets at once (a
 *    tight per-address one and a loose per-caller one). If each bucket decided for itself, a
 *    bucket that still had room would bank a press the OTHER bucket refused — the same defect,
 *    one bucket over. So: read them all, decide once, then write them all.
 *
 * ③ THE WORK IS THE SAME ON BOTH VERDICTS. Exactly one statement runs, and it both reads and
 *    writes on either verdict — a refusal writes `+ 0` rather than skipping the write. A caller
 *    cannot time the difference between "refused" and "granted", which matters because on the
 *    sign-in doors the answer itself is deliberately identical (see magic-link-request.ts).
 *
 * ── HOW ONE STATEMENT DOES ALL THREE ───────────────────────────────────────────────────────
 *
 * A single SQL statement with three CTEs over one snapshot: `probe` reads every named key,
 * `decision` computes ONE verdict from all of them, and the upsert adds `1` when granted and `0`
 * when not — so a refusal touches the row (property ③) without moving the counter or the window
 * (property ①), and every bucket sees the same verdict (property ②).
 *
 * WHAT IT DOES NOT PROMISE: strict serialization. Two calls that overlap inside the same
 * statement can both read "room left" and both be granted, so a limit of N can be overshot by
 * roughly the number of genuinely simultaneous callers. That is the standard trade for a
 * lock-free limiter, and it is bounded and tiny next to what it replaces (a per-instance counter
 * that was off by a factor of the instance count, permanently).
 */
import { Prisma } from "../generated/prisma/client.js";
// NOT "./index.js". See the header of ./client.ts: this module has to reach the database even in
// the many test files that replace the `@fikirtive/db` barrel wholesale, because a gate whose
// counter is unreachable fails CLOSED — a stubbed barrel would turn those files into a cascade of
// refusals that say nothing about what they are testing. Same client, same pool, different path.
import { prisma } from "./client.js";

/** One counter. `key` names the door AND who is being counted; callers own its namespacing. */
export type RateLimitBucket = {
  key: string;
  /** Granted requests allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitVerdict = {
  granted: boolean;
  /** Milliseconds until the blocking bucket's window ends. 0 when granted. */
  retryAfterMs: number;
  /** True when the counter could not be reached and the fallback below decided instead. */
  degraded: boolean;
};

/**
 * What to do when Postgres cannot be reached.
 *
 * `deny` is the default and the right answer almost everywhere: these gates sit in front of doors
 * whose work needs the database anyway, so "the database is down" already means the request
 * cannot succeed — refusing at the gate changes nothing except that it refuses cheaply.
 *
 * `allow` exists for the one shape where that reasoning inverts: a path that does NOT otherwise
 * touch the database, serving a request whose authorization was already proven by other means
 * (the signed media proxy). There, a database blip would newly break something that used to work,
 * and the limiter would be the only reason. Every use is named at its call site with why.
 */
export type RateLimitStorageFailure = "deny" | "allow";

export type ConsumeRateLimitOptions = {
  /** Injected clock. Tests use it; production never passes it. */
  now?: number;
  onStorageFailure?: RateLimitStorageFailure;
};

type DecisionRow = { granted: boolean; retry_at: bigint | number | null };

/**
 * Consult (and, when granted, charge) every named bucket. Returns ONE verdict for the request.
 *
 * Throws only for a caller mistake (no buckets, a duplicate key, a nonsensical limit) — never for
 * a storage fault, which is what `onStorageFailure` is for.
 */
export async function consumeRateLimit(
  buckets: RateLimitBucket[],
  options: ConsumeRateLimitOptions = {},
): Promise<RateLimitVerdict> {
  if (buckets.length === 0) throw new Error("consumeRateLimit needs at least one bucket");
  const keys = new Set(buckets.map((b) => b.key));
  // A duplicate key would make the upsert try to touch the same row twice in one statement,
  // which Postgres refuses outright ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time"). Catching it here names the actual mistake instead of surfacing that sentence.
  if (keys.size !== buckets.length) throw new Error("consumeRateLimit was given duplicate bucket keys");
  for (const b of buckets) {
    if (!Number.isInteger(b.max) || b.max < 1) throw new Error(`rate limit max must be a positive integer (${b.key})`);
    if (!Number.isFinite(b.windowMs) || b.windowMs < 1) throw new Error(`rate limit window must be positive (${b.key})`);
  }

  const now = options.now ?? Date.now();
  const onStorageFailure = options.onStorageFailure ?? "deny";

  const values = Prisma.join(
    buckets.map(
      (b) => Prisma.sql`(${b.key}::text, ${b.max}::int, ${BigInt(Math.round(now + b.windowMs))}::bigint)`,
    ),
    ", ",
  );
  const nowMs = BigInt(Math.round(now));

  try {
    const rows = await prisma.$queryRaw<DecisionRow[]>(Prisma.sql`
      WITH input("key", max_count, expires_at) AS (VALUES ${values}),
      probe AS (
        SELECT i."key", i.max_count, i.expires_at,
               c."count"     AS cur_count,
               c."expiresAt" AS cur_expires
          FROM input i
          LEFT JOIN "rate_limit_counter" c ON c."key" = i."key"
      ),
      decision AS (
        SELECT
          -- Granted only when EVERY bucket has room: a fresh key, an ended window, or a live
          -- window still under its own max.
          bool_and(cur_count IS NULL OR cur_expires <= ${nowMs}::bigint OR cur_count < max_count) AS granted,
          -- When refused, the caller is told when the LAST of the blocking windows ends.
          max(CASE WHEN cur_count IS NOT NULL AND cur_expires > ${nowMs}::bigint AND cur_count >= max_count
                   THEN cur_expires END) AS retry_at
          FROM probe
      ),
      charged AS (
        INSERT INTO "rate_limit_counter" ("key", "count", "expiresAt")
        SELECT p."key",
               -- 1 on a grant, 0 on a refusal. The row is written either way (property ③);
               -- only the counter and the window move, and only on a grant (property ①).
               CASE WHEN d.granted THEN 1 ELSE 0 END,
               p.expires_at
          FROM probe p CROSS JOIN decision d
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "rate_limit_counter"."expiresAt" <= ${nowMs}::bigint
                         THEN EXCLUDED."count"
                         ELSE "rate_limit_counter"."count" + EXCLUDED."count" END,
          "expiresAt" = CASE WHEN "rate_limit_counter"."expiresAt" <= ${nowMs}::bigint
                             THEN EXCLUDED."expiresAt"
                             ELSE "rate_limit_counter"."expiresAt" END
        RETURNING 1 AS written
      )
      SELECT d.granted, d.retry_at, (SELECT count(*) FROM charged) AS written
        FROM decision d
    `);

    const row = rows[0];
    // A decision CTE over a non-empty VALUES list always produces exactly one row; an empty
    // result would mean the statement did not run the way this code believes it does.
    if (!row) return { granted: onStorageFailure === "allow", retryAfterMs: 0, degraded: true };
    const retryAt = row.retry_at === null || row.retry_at === undefined ? null : Number(row.retry_at);
    return {
      granted: row.granted,
      retryAfterMs: row.granted || retryAt === null ? 0 : Math.max(0, retryAt - now),
      degraded: false,
    };
  } catch (error) {
    // Never let a storage fault read as a granted request by accident — the fallback is a
    // decision the CALLER made, and it is recorded so it cannot be mistaken for a real verdict.
    console.error("[rate-limit] counter unreachable", {
      keys: buckets.map((b) => b.key),
      onStorageFailure,
      error: error instanceof Error ? error.message : String(error),
    });
    return { granted: onStorageFailure === "allow", retryAfterMs: 0, degraded: true };
  }
}

/**
 * Drop rows whose window ended more than `graceMs` ago.
 *
 * The table holds one row per (door × counted party × live window), so without this it grows one
 * row per address anyone has ever probed and never gives one back — which on an open-registration
 * public door is a slow-motion disk leak an attacker chooses the size of.
 *
 * The grace period is deliberate: a row whose window just ended is about to be reused by the next
 * request from the same caller, and deleting it costs an extra INSERT for nothing.
 */
export async function pruneRateLimitCounters(options: { now?: number; graceMs?: number } = {}): Promise<number> {
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? 60 * 60 * 1000;
  const cutoff = BigInt(Math.round(now - graceMs));
  const result = await prisma.rateLimitCounter.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return result.count;
}

/**
 * Give back every counter under one door's key prefix — the "let them back in now" lever.
 *
 * Two callers, one shape. An OPERATOR needs it when a cap turns out to be wrong for a real
 * merchant and waiting out the window is not an answer. A TEST needs it because the windows are
 * an hour long and no test can wait one out. Keeping it here rather than in each door's module is
 * what lets every door reach its counters through this one import, so a caller never has to hold
 * a database client of its own just to reset a budget.
 *
 * Prefix, not key: a door owns a namespace (`magic:`, `pw:`, `gen:`…), and resetting "the door"
 * has to include the per-address buckets underneath it.
 */
export async function clearRateLimitCounters(keyPrefix: string): Promise<number> {
  if (!keyPrefix) throw new Error("clearRateLimitCounters needs a key prefix");
  const result = await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: keyPrefix } } });
  return result.count;
}
