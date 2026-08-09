/**
 * #678 — the background executor, which is where the auth-email side channels ended up living.
 *
 * Moving the work off the request path answered "how long did the REQUEST take". It did not
 * answer "when did the EMAIL arrive", and the queue turned out to be a second clock in three
 * successive shapes:
 *
 *   1. A SERIAL WORKER. Submit the address you want to probe, then an address you can receive
 *      mail at; yours waits for the probe's job, so its lateness answers a question about
 *      somebody else's address.
 *   2. THE SLOT ITSELF. Concurrency stopped the canary queueing behind the probe, but not the
 *      probe's worker coming back at a different MOMENT: an unknown address frees its slot at
 *      the allowlist check, an allowed one only after minting, re-checking and the provider —
 *      and, in reverse, an allowed address that has spent its hourly budget frees it faster than
 *      an unknown one's database miss. Jitter cannot cover that; it is zero-mean noise and the
 *      branch difference is not.
 *   3. NO CAPACITY. Every valid request hands over a job, so an unbounded queue let one caller
 *      starve every merchant's sign-in link behind their backlog.
 *
 * Closed by: bounded concurrency, a FIXED FLOOR on slot occupancy, jitter before the slot rather
 * than inside it, a per-job deadline with a real abort signal, and a bounded queue with a stated
 * drop policy.
 *
 * METHOD — how the timing claims are asserted without a stopwatch threshold. A wall-clock
 * threshold in CI is a flake generator, so nothing here asserts an absolute duration. The slot
 * cases are DIFFERENTIAL: the identical scenario is run once per branch and only the spread
 * between branches is asserted, against a threshold of one fifth of the floor while the defect
 * produces a spread of more than half of it — a three-times margin, and both sides pay the same
 * machine overhead. Jitter is asserted through an injected sleep function that records what it
 * was asked to wait, so its range is checked exactly rather than sampled.
 *
 * Real Better Auth and the real database throughout — the allowed branch really does mint a
 * token and re-check access. Only the mail transport is a mock, and it models `fetch`: it
 * rejects when its abort signal fires rather than quietly finishing later.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

type Pending = { resolve: () => void; reject: (e: Error) => void; signal?: AbortSignal };

/** Completion order of deliveries, by address. This is the observable the attack reads. */
const delivered: string[] = [];
const openSends = new Map<string, Pending>();
const hold = new Set<string>();

const mockSend = vi.fn(async (message: { to: string; signal?: AbortSignal }) => {
  if (!hold.has(message.to)) {
    delivered.push(message.to);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const pending: Pending = { resolve, reject, signal: message.signal };
    openSends.set(message.to, pending);
    // Model `fetch`: an aborted request REJECTS. A transport that quietly finished later would
    // let a job deliver mail after the executor had already given its slot back.
    message.signal?.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
  });
  delivered.push(message.to);
});

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, emailPort: { send: mockSend } };
});

/** Addresses whose access check is held open until the test resolves it. Everything else goes to
 *  the real allowlist, so the rest of this file still exercises the genuine lookup. */
const heldAccessChecks = new Map<string, Promise<boolean>>();

vi.mock("@/lib/allowlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/allowlist")>();
  return {
    ...actual,
    isAllowedEmail: async (email: string | null | undefined) =>
      (email && heldAccessChecks.get(email)) || actual.isAllowedEmail(email),
  };
});

const TARGET_ALLOWED = `p678-target-allowed-${randomUUID()}@fikirtive.test`;
const TARGET_UNKNOWN = `p678-target-unknown-${randomUUID()}@fikirtive.test`;
const TARGET_SPENT = `p678-target-spent-${randomUUID()}@fikirtive.test`;
const CANARY = `p678-canary-${randomUUID()}@fikirtive.test`;
const SLOW = `p678-slow-${randomUUID()}@fikirtive.test`;
const BEHIND = `p678-behind-${randomUUID()}@fikirtive.test`;
/** On the DATABASE allowlist, not an environment list — so its access check is a real query. */
const DB_ALLOWED = `p678-dballowed-${randomUUID()}@fikirtive.test`;
/** Its access check is held open on purpose, so the deadline provably expires mid-job. */
const LATE = `p678-late-${randomUUID()}@fikirtive.test`;
/** #757 — mints a REAL sign-in token, so the row it leaves behind can be asked how long the
 *  credential this queue carries actually lives. */
const TTL_PROBE = `p757-ttl-${randomUUID()}@fikirtive.test`;

process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.AUTH_ALLOWED_EMAILS = [TARGET_ALLOWED, TARGET_SPENT, CANARY, SLOW, BEHIND, TTL_PROBE].join(",");
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";

const { prisma } = await import("@fikirtive/db");
const {
  authEmailQueueSettled,
  enqueueAuthEmail,
  __resetAuthEmailCapsForTests,
  __configureAuthEmailQueueForTests,
  __authEmailQueueDepthForTests,
  AUTH_EMAIL_JITTER_MAX_MS,
  AUTH_EMAIL_MAX_CONCURRENCY,
  AUTH_EMAIL_JOB_TIMEOUT_MS,
  AUTH_EMAIL_SLOT_FLOOR_MS,
  AUTH_EMAIL_MAX_QUEUED,
  AUTH_EMAIL_WORST_SLOT_MS,
  AUTH_EMAIL_LINK_TTL_MS,
} = await import("@/lib/better-auth/sender");
const { acceptMagicLinkRequest, __resetMagicLinkThrottleForTests } = await import(
  "@/lib/better-auth/magic-link-request"
);

const press = (email: string, ip: string) =>
  acceptMagicLinkRequest({
    email,
    callbackURL: "/",
    requestHeaders: new Headers({ "x-forwarded-for": ip }),
  });

/** Bounded wait. Returns false instead of hanging, so a regression reads as a failed assertion
 *  rather than a suite timeout. */
async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return predicate();
}

function releaseAll(): void {
  for (const [, pending] of openSends) pending.resolve();
  openSends.clear();
  hold.clear();
}

beforeAll(async () => {
  // Warm the database connection and Better Auth's construction OUTSIDE the cases, so the first
  // one is not racing a cold start.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  await prisma.allowedEmail.upsert({
    where: { email: DB_ALLOWED },
    create: { email: DB_ALLOWED, status: "active", invitedBy: "p678-test@fikirtive.test" },
    update: { status: "active" },
  });
  const warmup = `p678-warmup-${randomUUID()}@fikirtive.test`;
  process.env.AUTH_ALLOWED_EMAILS = `${process.env.AUTH_ALLOWED_EMAILS},${warmup}`;
  enqueueAuthEmail({ purpose: "sign-in-link", email: warmup, callbackURL: "/", overBudget: false });
  await authEmailQueueSettled();
  await prisma.betterAuthVerification.deleteMany({ where: { value: { contains: warmup } } });
});

beforeEach(() => {
  delivered.length = 0;
  openSends.clear();
  hold.clear();
  heldAccessChecks.clear();
  mockSend.mockClear();
  __resetAuthEmailCapsForTests();
  __resetMagicLinkThrottleForTests();
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
});

// ── the slot is given back at the same moment on every branch ────────────────────────────────
describe("#678 — the worker slot comes back at the same moment whichever branch ran", () => {
  const FLOOR = 2000;
  const DEADLINE = 1200;

  /**
   * CROSS-BATCH on purpose: one worker, so the canary cannot start until the probe's slot is
   * released. What is measured is how long the canary's mail took to arrive, which is exactly
   * what an attacker can observe from their own inbox.
   */
  async function canaryDelayAfter(target: string, holdTarget: boolean): Promise<number> {
    delivered.length = 0;
    __resetMagicLinkThrottleForTests();
    __configureAuthEmailQueueForTests({
      maxConcurrency: 1,
      jitterMaxMs: 0,
      slotFloorMs: FLOOR,
      jobTimeoutMs: DEADLINE,
    });
    if (holdTarget) hold.add(target);

    const startedAt = Date.now();
    press(target, "203.0.113.50");
    press(CANARY, "203.0.113.50");
    expect(await waitUntil(() => delivered.includes(CANARY))).toBe(true);
    const elapsed = Date.now() - startedAt;

    releaseAll();
    await authEmailQueueSettled();
    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
    return elapsed;
  }

  it("hides an allowlist miss, a spent budget and a full mint-and-send behind one floor", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Branch A — no access at all: the job returns at the allowlist check in a millisecond.
    __resetAuthEmailCapsForTests();
    const unknown = await canaryDelayAfter(TARGET_UNKNOWN, false);

    // Branch B — access, and the provider never answers: the job runs until its deadline.
    __resetAuthEmailCapsForTests();
    const allowed = await canaryDelayAfter(TARGET_ALLOWED, true);

    // Branch C — the REVERSE oracle: on a list, but its hourly send budget is spent, so the job
    // answers out of memory with no database work at all — faster even than branch A.
    __resetAuthEmailCapsForTests();
    for (let i = 0; i < 5; i++) {
      enqueueAuthEmail({ purpose: "sign-in-link", email: TARGET_SPENT, callbackURL: "/", overBudget: false });
      await authEmailQueueSettled();
    }
    const spent = await canaryDelayAfter(TARGET_SPENT, false);

    const spread = Math.max(unknown, allowed, spent) - Math.min(unknown, allowed, spent);
    // RED before the floor: branch A and C returned their slot in single-digit milliseconds while
    // branch B held it to its deadline, so the spread was most of DEADLINE (~1200 ms). The
    // threshold is a fifth of the floor; the defect is more than half of it.
    expect(spread, `unknown=${unknown} allowed=${allowed} spent=${spent}`).toBeLessThan(FLOOR / 5);
    // …and the floor really was in force, so the parity is not "everything was instant".
    for (const elapsed of [unknown, allowed, spent]) expect(elapsed).toBeGreaterThanOrEqual(FLOOR);

    log.mockRestore();
  }, 30_000);

  it("the three branches really are different underneath — the parity above is not vacuous", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    hold.add(TARGET_ALLOWED);
    press(TARGET_ALLOWED, "203.0.113.51");
    expect(await waitUntil(() => openSends.has(TARGET_ALLOWED))).toBe(true);
    expect(
      await prisma.betterAuthVerification.count({ where: { value: { contains: TARGET_ALLOWED } } }),
    ).toBeGreaterThan(0);

    press(TARGET_UNKNOWN, "203.0.113.52");
    await waitUntil(() => false, 200);
    expect(mockSend.mock.calls.some((c) => c[0].to === TARGET_UNKNOWN)).toBe(false);
    expect(
      await prisma.betterAuthVerification.count({ where: { value: { contains: TARGET_UNKNOWN } } }),
    ).toBe(0);

    releaseAll();
    await authEmailQueueSettled();
  });
});

// ── head-of-line blocking and the deadline ───────────────────────────────────────────────────
describe("#678 — one stuck delivery does not become every tenant's stuck delivery", () => {
  it("keeps delivering behind a send that never answers, and never delivers it late", async () => {
    // Concurrency 1 on purpose: this is the claim about the DEADLINE, not about the pool.
    __configureAuthEmailQueueForTests({
      jitterMaxMs: 0,
      slotFloorMs: 0,
      maxConcurrency: 1,
      jobTimeoutMs: 300,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    hold.add(SLOW);
    enqueueAuthEmail({ purpose: "verify-email", email: SLOW, url: "https://x.test/slow" });
    enqueueAuthEmail({ purpose: "verify-email", email: BEHIND, url: "https://x.test/behind" });

    // RED before the deadline: `await` on a promise that never settles — BEHIND is never
    // attempted at all.
    expect(await waitUntil(() => delivered.includes(BEHIND))).toBe(true);

    const lines = log.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email job failed") && l.includes("timeout"))).toBe(true);
    // #757 — AND IT SAYS WHICH KIND OF TIMEOUT. This job had a request on the wire when its
    // deadline fired, and an abort cannot un-accept a request the provider has already taken. So
    // the operator line reports the outcome as UNKNOWN rather than as a failure: "no email was
    // sent" is a claim this system is not in a position to make, and an operator who acts on it
    // by re-sending is minting a second live credential.
    expect(lines.some((l) => l.includes("delivery outcome unknown"))).toBe(true);
    for (const line of [...lines, ...warn.mock.calls.map((c) => c.join(" "))]) {
      expect(line).not.toContain(SLOW);
    }
    // The transport was told to stop, not merely forgotten about…
    expect(openSends.get(SLOW)?.signal?.aborted).toBe(true);

    // …and settling the queue waits for the abandoned work rather than declaring victory over it.
    releaseAll();
    await authEmailQueueSettled();
    // NOT LATE FROM OUR SIDE. This asserts our own contract — a transport that honours the abort
    // never reports a delivery once the slot has gone back — which is exactly as far as a test
    // can reach. Whether the real provider posts a message it already accepted is its decision,
    // and the idempotency key on every send is what keeps that from becoming a second link.
    expect(delivered).not.toContain(SLOW);

    log.mockRestore();
    warn.mockRestore();
  });

  it("refuses to even start a send once the job is past its deadline", async () => {
    // A job whose pre-delivery work outlasts the deadline must not go on to put mail in flight
    // from a slot the executor has already handed back. Held deterministically rather than
    // raced: the access check does not answer until the deadline has demonstrably fired.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    let grantAccess!: (allowed: boolean) => void;
    heldAccessChecks.set(
      LATE,
      new Promise<boolean>((resolve) => {
        grantAccess = resolve;
      }),
    );

    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0, jobTimeoutMs: 50 });
    enqueueAuthEmail({ purpose: "password-reset", email: LATE, url: "https://x.test/late" });

    expect(
      await waitUntil(() => log.mock.calls.some((c) => c.join(" ").includes("timeout"))),
    ).toBe(true);
    grantAccess(true); // the access check answers, but its job's slot is already back

    await authEmailQueueSettled();
    expect(delivered).not.toContain(LATE);
    const lines = warn.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email not started"))).toBe(true);
    // #757 — and this job is the OTHER kind of timeout: it died before anything was dispatched,
    // so there is nothing indeterminate about it. Reporting both kinds the same way would make
    // "delivery outcome unknown" mean nothing on the line where it matters.
    const errorLines = log.mock.calls.map((c) => c.join(" "));
    expect(errorLines.some((l) => l.includes("timeout"))).toBe(true);
    expect(errorLines.some((l) => l.includes("delivery outcome unknown"))).toBe(false);
    for (const line of [...lines, ...errorLines]) {
      expect(line).not.toContain(LATE);
    }
    warn.mockRestore();
    log.mockRestore();
  });

  it("runs up to the concurrency budget at once and no more", async () => {
    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0, jobTimeoutMs: 3000 });
    const addresses = Array.from(
      { length: AUTH_EMAIL_MAX_CONCURRENCY + 2 },
      (_, i) => `p678-pool-${i}-${randomUUID()}@fikirtive.test`,
    );
    for (const email of addresses) {
      hold.add(email);
      enqueueAuthEmail({ purpose: "verify-email", email, url: "https://x.test/pool" });
    }
    expect(await waitUntil(() => openSends.size >= AUTH_EMAIL_MAX_CONCURRENCY)).toBe(true);
    await waitUntil(() => false, 100);
    expect(openSends.size).toBe(AUTH_EMAIL_MAX_CONCURRENCY);

    vi.spyOn(console, "error").mockImplementation(() => {});
    releaseAll();
    await authEmailQueueSettled();
  });
});

// ── the queue has a capacity, and a stated drop policy ───────────────────────────────────────
describe("#678 — the queue is bounded, so no caller can starve every merchant's sign-in link", () => {
  it("stays under its capacity through a flood, with the REAL sender", async () => {
    // Nothing about the sender is mocked here: mocking it is exactly what hid the unbounded
    // queue last round — a mocked `enqueueAuthEmail` proved the throttle's Map was bounded while
    // the real backlog behind it grew without limit.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    __configureAuthEmailQueueForTests({
      jitterMaxMs: 0,
      slotFloorMs: 60_000, // nothing drains during the flood: worst case for the backlog
      maxConcurrency: 1,
      // #757 — the PRODUCTION capacity, not a small stand-in. The bound that has to hold under
      // a flood is the one that ships.
    });

    let peak = 0;
    for (let i = 0; i < 5_000; i++) {
      press(`flood-${i}@shop.test`, "203.0.113.210");
      peak = Math.max(peak, __authEmailQueueDepthForTests());
    }
    // RED before the bound: 5 000 presses, 5 000 outstanding jobs, and every real merchant's
    // sign-in link queued behind them.
    expect(peak).toBeLessThanOrEqual(AUTH_EMAIL_MAX_QUEUED);

    // The drop is an operator signal only — the merchant's answer never changed — and it is
    // aggregated rather than one line per dropped job.
    const lines = warn.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email queue full"))).toBe(true);
    expect(lines.filter((l) => l.includes("auth email queue full")).length).toBeLessThan(10);

    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await authEmailQueueSettled();
    warn.mockRestore();
  }, 30_000);

  it("drops the throttle's refusals before anything that would actually be delivered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    __configureAuthEmailQueueForTests({
      jitterMaxMs: 0,
      slotFloorMs: 60_000,
      maxConcurrency: 1,
      maxQueued: 8,
    });

    // Fill the queue with jobs the throttle already refused…
    for (let i = 0; i < 20; i++) {
      enqueueAuthEmail({
        purpose: "sign-in-link",
        email: `refused-${i}@shop.test`,
        callbackURL: "/",
        overBudget: true,
      });
    }
    const beforeReal = __authEmailQueueDepthForTests();
    // …then hand over one that would be delivered. It is admitted, because a refused job makes
    // way for it rather than the other way round.
    enqueueAuthEmail({ purpose: "verify-email", email: BEHIND, url: "https://x.test/keepme" });
    expect(__authEmailQueueDepthForTests()).toBeLessThanOrEqual(Math.max(beforeReal, 8));

    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await authEmailQueueSettled();
    expect(delivered).toContain(BEHIND);
    warn.mockRestore();
  }, 30_000);

  /**
   * #757 (P3) — the drop log has to account for the WHOLE flood, including its last seconds.
   *
   * Aggregation was a rate limit and nothing else: a line went out only when a NEW drop arrived
   * more than ten seconds after the last line. A flood that stops — which every flood does — left
   * its final tally sitting in a counter that nothing would ever print. The operator saw "dropped
   * 1 job" for an incident that dropped thousands, and the number they were given was the least
   * informative one available.
   */
  it("prints the tail of a flood rather than leaving it in a counter", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    __configureAuthEmailQueueForTests({
      jitterMaxMs: 0,
      slotFloorMs: 60_000,
      maxConcurrency: 1,
      maxQueued: 8,
      dropLogIntervalMs: 30,
    });

    for (let i = 0; i < 40; i++) {
      enqueueAuthEmail({
        purpose: "sign-in-link",
        email: `p757-tail-${i}@shop.test`,
        callbackURL: "/",
        overBudget: true,
      });
    }
    const dropped = 40 - 8; // eight fitted; the rest each displaced one refused job

    const reported = () =>
      warn.mock.calls
        .map((c) => /dropped (\d+) job/.exec(c.join(" "))?.[1])
        .filter((n): n is string => n !== undefined)
        .reduce((sum, n) => sum + Number(n), 0);

    // Mid-flood the operator has one line and most of the count is still outstanding — that part
    // is deliberate, because a line per dropped job is a second denial of service.
    expect(reported()).toBeLessThan(dropped);
    // RED before #757: no further drop ever arrives, so nothing ever flushes the rest and the
    // reported total stays at 1 for a flood of 32.
    expect(await waitUntil(() => reported() === dropped, 2_000)).toBe(true);

    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await authEmailQueueSettled();
    warn.mockRestore();
  }, 30_000);

  /** #757 (P3) — `pending` stopped being an array with `shift()`. Order is the property that
   *  refactor must not lose: a queue that reordered under load would hand the merchant who
   *  pressed first the link that expires first. */
  it("delivers in the order the jobs were handed over", async () => {
    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0, maxConcurrency: 1 });
    const addresses = Array.from(
      { length: 12 },
      (_, i) => `p757-fifo-${i}-${randomUUID()}@fikirtive.test`,
    );
    for (const email of addresses) {
      enqueueAuthEmail({ purpose: "verify-email", email, url: "https://x.test/fifo" });
    }
    await authEmailQueueSettled();
    expect(delivered).toEqual(addresses);
  });
});

// ── jitter ───────────────────────────────────────────────────────────────────────────────────
describe("#678 — every job waits a random moment before it takes a slot", () => {
  it("waits a draw inside the configured range before each job's work starts", async () => {
    // The clock is replaced, not measured: `sleepFn` records what it was asked to wait and
    // returns at once, so the range is checked exactly instead of sampled. One worker, so the
    // recorded waits pair up unambiguously as [jitter, floor] per job.
    const draws = [0, 0.5, 1];
    let next = 0;
    const asked: number[] = [];
    __configureAuthEmailQueueForTests({
      maxConcurrency: 1,
      slotFloorMs: 0,
      random: () => draws[next++ % draws.length],
      sleepFn: async (ms) => {
        asked.push(ms);
      },
    });

    for (let i = 0; i < 3; i++) {
      enqueueAuthEmail({ purpose: "verify-email", email: `p678-jit-${i}@fikirtive.test`, url: "u" });
    }
    await authEmailQueueSettled();

    // Two waits per job: the jitter, then the floor's remainder (zero here).
    expect(asked).toHaveLength(6);
    const jitters = asked.filter((_, i) => i % 2 === 0);
    expect(jitters).toEqual([
      0,
      Math.floor(0.5 * (AUTH_EMAIL_JITTER_MAX_MS + 1)),
      AUTH_EMAIL_JITTER_MAX_MS,
    ]);
    for (const ms of jitters) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(AUTH_EMAIL_JITTER_MAX_MS);
    }
  });

  it("the constants are sized for the job they have to do", () => {
    // The floor has to exceed the work it is hiding — an allowlist query, a token write and one
    // provider round trip — by enough that the work's own duration never shows through.
    expect(AUTH_EMAIL_SLOT_FLOOR_MS).toBeGreaterThanOrEqual(2_000);
    // …and the deadline has to be several times a healthy round trip, so nothing real is cut off.
    expect(AUTH_EMAIL_JOB_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    // …the pool wide enough that a probe and a canary are not forced into a queue…
    expect(AUTH_EMAIL_MAX_CONCURRENCY).toBeGreaterThanOrEqual(2);
    // …and the jitter wide enough to be worth having as a second layer.
    expect(AUTH_EMAIL_JITTER_MAX_MS).toBeGreaterThanOrEqual(1_000);
  });
});

// ── #757 — the capacity bound is load-bearing, with the real numbers ─────────────────────────
/**
 * A bounded queue only helps if a job that reaches the BACK of it still arrives while the
 * credential it carries is alive. Otherwise the bound is decoration: the queue is full of links
 * that will be posted after they expire, which for the merchant is the same as being dropped —
 * except it also burns their hourly budget on the way past.
 *
 * The previous round asserted that inequality with the wrong slot length. It used the FLOOR
 * (3 s) as the time a job occupies a worker, so 500 jobs came out at ten and a half minutes,
 * under the fifteen a link lives. But the floor is a MINIMUM, not a maximum: a job that reaches
 * its deadline holds its slot for the jitter plus the whole 20-second timeout. At that length
 * the same 500 jobs take 45.8 minutes and every link past roughly the 163rd is posted dead.
 *
 * So the depth is no longer a number somebody chose. It is DERIVED from the three quantities it
 * depends on — how long a link lives, how long a slot can be held, how many slots there are —
 * which makes the inequality true by construction rather than by assertion. What is left for a
 * test is to prove the derivation uses the real numbers, and that the link lifetime it derives
 * from is the one Better Auth actually stamps on the token.
 */
describe("#757 — a queued link cannot outlive the link", () => {
  it("measures a slot by the DEADLINE it may run to, not by the floor it must fill", () => {
    // RED before #757: the drain estimate used floor + jitter (5 s) and ignored the deadline,
    // so it under-counted the worst slot by more than four times.
    expect(AUTH_EMAIL_WORST_SLOT_MS).toBe(
      AUTH_EMAIL_JITTER_MAX_MS + Math.max(AUTH_EMAIL_SLOT_FLOOR_MS, AUTH_EMAIL_JOB_TIMEOUT_MS),
    );
    expect(AUTH_EMAIL_WORST_SLOT_MS).toBeGreaterThanOrEqual(AUTH_EMAIL_JOB_TIMEOUT_MS);
  });

  it("holds the drain-before-expiry inequality at the real parameters, and is the largest depth that does", () => {
    const drainMs = (AUTH_EMAIL_MAX_QUEUED * AUTH_EMAIL_WORST_SLOT_MS) / AUTH_EMAIL_MAX_CONCURRENCY;
    // RED before #757: 500 × 22 000 / 4 = 2 750 000 ms (45.8 min) against a 900 000 ms link.
    expect(drainMs).toBeLessThanOrEqual(AUTH_EMAIL_LINK_TTL_MS);
    // …and it is not passing by being trivially small: one more job would break it, so this is
    // the deepest backlog that can still be delivered in time.
    const oneMoreMs =
      ((AUTH_EMAIL_MAX_QUEUED + 1) * AUTH_EMAIL_WORST_SLOT_MS) / AUTH_EMAIL_MAX_CONCURRENCY;
    expect(oneMoreMs).toBeGreaterThan(AUTH_EMAIL_LINK_TTL_MS);
    expect(AUTH_EMAIL_MAX_QUEUED).toBeGreaterThan(0);
  });

  it("derives that depth from the lifetime Better Auth really stamps on the token", async () => {
    // The inequality is only worth anything if `AUTH_EMAIL_LINK_TTL_MS` is the SAME fifteen
    // minutes the magic-link plugin uses. RED before #757: `expiresIn` was its own literal in
    // server.ts, so the queue's arithmetic and the token's real lifetime could drift apart
    // silently — the queue would keep sizing itself against a number nothing enforced.
    const startedAt = Date.now();
    enqueueAuthEmail({ purpose: "sign-in-link", email: TTL_PROBE, callbackURL: "/", overBudget: false });
    await authEmailQueueSettled();

    const row = await prisma.betterAuthVerification.findFirst({
      where: { value: { contains: TTL_PROBE } },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    const lifetimeMs = (row as { expiresAt: Date }).expiresAt.getTime() - startedAt;
    expect(lifetimeMs).toBeGreaterThan(AUTH_EMAIL_LINK_TTL_MS - 5_000);
    expect(lifetimeMs).toBeLessThanOrEqual(AUTH_EMAIL_LINK_TTL_MS + 5_000);
  });
});

afterAll(async () => {
  releaseAll();
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0, slotFloorMs: 0 });
  await authEmailQueueSettled();
  __configureAuthEmailQueueForTests({});
  try {
    await prisma.betterAuthVerification.deleteMany({
      where: {
        OR: [
          { value: { contains: "p678-target-" } },
          { value: { contains: "p678-canary-" } },
          { value: { contains: "p757-ttl-" } },
        ],
      },
    });
    await prisma.allowedEmail.deleteMany({ where: { email: DB_ALLOWED } });
  } catch {
    /* best-effort cleanup */
  }
});
