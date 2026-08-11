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
 * ④ AND THE VERDICT IS ATOMIC. A limit of `max` has to admit `max`, not `max` plus however many
 *    callers happened to arrive at the same moment. An earlier round read every bucket in one
 *    snapshot and wrote in the same statement, so N simultaneous requests could each read
 *    "max - 1 used, room for one more" and each be granted. The published number was, once again,
 *    not the number being enforced — the same defect the whole ticket is about, one layer down.
 *
 * ── HOW IT HOLDS ALL FOUR: LOCK, DECIDE, WRITE ─────────────────────────────────────────────
 *
 * One transaction, three steps, spelled out at each step below:
 *
 *   1. LOCK every named bucket and read what is under the lock. `INSERT … ON CONFLICT DO UPDATE
 *      SET key = key` creates a missing bucket (already-expired and empty, so a refusal cannot
 *      start a window) and row-locks an existing one, returning the state under that lock. A
 *      concurrent caller blocks here and, when it resumes, sees the committed result — which is
 *      what makes property ④ true rather than likely.
 *   2. DECIDE once, from all of them (property ②).
 *   3. WRITE every bucket, on both verdicts — a refusal writes its rows back unchanged, which is
 *      what makes properties ① and ③ true at the same time.
 *
 * The buckets are sorted by key before any of this, and that is the whole deadlock story: two
 * requests naming the same pair in opposite orders would take the two locks in opposite orders.
 * Sorting removes the possibility instead of relying on Postgres to detect it afterwards.
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

type LockedBucketRow = { key: string; count: number; expiresAt: bigint | number };

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
  // A duplicate key would make one statement try to touch the same row twice, which Postgres
  // refuses outright. Catching it here names the actual mistake instead of surfacing that.
  if (keys.size !== buckets.length) throw new Error("consumeRateLimit was given duplicate bucket keys");
  for (const b of buckets) {
    if (!Number.isInteger(b.max) || b.max < 1) throw new Error(`rate limit max must be a positive integer (${b.key})`);
    if (!Number.isFinite(b.windowMs) || b.windowMs < 1) throw new Error(`rate limit window must be positive (${b.key})`);
  }

  const now = options.now ?? Date.now();
  const nowMs = BigInt(Math.round(now));
  const onStorageFailure = options.onStorageFailure ?? "deny";

  // SORTED, and that is load-bearing: it is the only thing that makes the lock order the same for
  // every caller. Two requests that name the same pair of buckets in opposite orders would take
  // the two row locks in opposite orders and deadlock; sorting removes the possibility rather than
  // relying on Postgres to detect it.
  const sorted = [...buckets].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  try {
    return await prisma.$transaction(async (tx) => {
      // ── STEP 1: LOCK, and read what is under the lock ───────────────────────────────────────
      //
      // `INSERT … ON CONFLICT DO UPDATE SET key = key` is the locking-upsert idiom, and it is
      // doing three jobs at once:
      //   · a bucket that does not exist yet is created — as an ALREADY-EXPIRED, EMPTY row
      //     (count 0, expiresAt = now). Creating it is what makes it lockable, and creating it
      //     expired is what keeps a REFUSED request from starting a window it was never granted;
      //   · a bucket that does exist is row-locked by the no-op update;
      //   · RETURNING hands back the state UNDER THAT LOCK.
      //
      // The lock is the whole point. A concurrent transaction that reaches the same row blocks
      // here, and when it resumes Postgres re-evaluates the row against the newly committed
      // version — so the state this transaction decides on cannot be stale by the time it writes.
      // The previous shape read every bucket in one snapshot and wrote in the same statement,
      // which meant N simultaneous requests could all read "N-1 used, room for one more" and all
      // be granted. That is a limit of `max` that admits `max + concurrency` under load, i.e. the
      // number on the door was again not the number being enforced.
      const locked = await tx.$queryRaw<LockedBucketRow[]>(Prisma.sql`
        INSERT INTO "rate_limit_counter" ("key", "count", "expiresAt")
        VALUES ${Prisma.join(
          sorted.map((b) => Prisma.sql`(${b.key}::text, 0::int, ${nowMs}::bigint)`),
          ", ",
        )}
        ON CONFLICT ("key") DO UPDATE SET "key" = "rate_limit_counter"."key"
        RETURNING "key", "count", "expiresAt"
      `);

      // ── STEP 2: ONE verdict, from all of them ───────────────────────────────────────────────
      //
      // Granted only when EVERY bucket has room. A bucket that still had room must not bank a
      // press the other bucket refused (#757 r2): one address's retry loop would otherwise spend
      // the shared per-egress budget that every other merchant behind it is sharing.
      const state = new Map(locked.map((r) => [r.key, r]));
      let granted = true;
      let retryAt: number | null = null;
      for (const bucket of sorted) {
        const row = state.get(bucket.key);
        // Step 1 either inserted or locked a row for every key, so a missing one means the
        // statement did not do what this code believes. Fail closed rather than guess.
        if (!row) return { granted: onStorageFailure === "allow", retryAfterMs: 0, degraded: true };
        const expiresAt = Number(row.expiresAt);
        const live = expiresAt > now;
        if (live && row.count >= bucket.max) {
          granted = false;
          retryAt = retryAt === null ? expiresAt : Math.max(retryAt, expiresAt);
        }
      }

      // ── STEP 3: WRITE every bucket, on both verdicts ────────────────────────────────────────
      //
      // A refusal writes its rows back unchanged. That is not a wasted statement: it is what
      // makes the two verdicts cost the same, which matters because the doors in front of this
      // deliberately give the same ANSWER either way (see magic-link-request.ts) — an answer that
      // reads alike but costs differently is still an oracle.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "rate_limit_counter" AS c
           SET "count" = CASE
                 WHEN NOT ${granted} THEN c."count"
                 WHEN c."expiresAt" <= ${nowMs}::bigint THEN 1
                 ELSE c."count" + 1 END,
               "expiresAt" = CASE
                 WHEN NOT ${granted} THEN c."expiresAt"
                 WHEN c."expiresAt" <= ${nowMs}::bigint THEN v.expires_at
                 ELSE c."expiresAt" END
          FROM (VALUES ${Prisma.join(
            sorted.map((b) => Prisma.sql`(${b.key}::text, ${BigInt(Math.round(now + b.windowMs))}::bigint)`),
            ", ",
          )}) AS v("key", expires_at)
         WHERE c."key" = v."key"
      `);

      return {
        granted,
        retryAfterMs: granted || retryAt === null ? 0 : Math.max(0, retryAt - now),
        degraded: false,
      };
    });
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
