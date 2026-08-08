/**
 * #678 r4 — the background executor, which is where the last two timing oracles lived.
 *
 * Moving the work off the request path answered "how long did the REQUEST take". It did not
 * answer "when did the EMAIL arrive", and a single serial worker made that a second clock:
 *
 *   THE CANARY ATTACK. Submit the address you want to probe, then immediately submit an address
 *   you can receive mail at. Serially, your email waits for the probe's job. If the probe has no
 *   access that job returns at the allowlist check and your mail comes promptly; if it does have
 *   access the job goes on to mint a token, re-check, and wait on the mail provider, and your
 *   mail comes later. The delay on YOUR OWN email answers a question about SOMEBODY ELSE'S.
 *
 *   HEAD-OF-LINE BLOCKING. The same seriality, without an attacker: one provider call that never
 *   answers held every other tenant's sign-in link, password reset and verification email behind
 *   it, for as long as the socket stayed open — the mail adapter had no deadline and no cancel.
 *
 * Both are closed by one change: bounded concurrency + per-job jitter + a per-job deadline with
 * a real abort signal.
 *
 * METHOD — why these assertions and not a stopwatch. A wall-clock threshold in CI is a flake
 * generator, and a statistical timing test needs thousands of samples to say anything honest. So
 * the tests below REPLACE the clock and the dice instead of measuring them, and assert the
 * structure that removes the correlation:
 *
 *   · the canary case is run with the probe's delivery held open FOREVER — the most extreme
 *     version of "the allowed branch is slower" there is. If the canary still completes, and
 *     completes in the same position, no smaller difference can be readable either.
 *   · jitter is asserted through an injected sleep function that records what it was asked to
 *     wait, so its range is checked exactly rather than sampled.
 *
 * Real Better Auth and the real database throughout — the allowed branch really does mint a
 * token and re-check access. Only the mail transport is a mock, and only so a delivery can be
 * held open on demand.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

type Pending = { resolve: () => void; signal?: AbortSignal };

/** Completion order of deliveries, by address. This is the observable the attack reads. */
const delivered: string[] = [];
/** Deliveries that are still open, by address. */
const openSends = new Map<string, Pending>();
/** Addresses whose delivery should hang until released. */
const hold = new Set<string>();

const mockSend = vi.fn(async (message: { to: string; signal?: AbortSignal }) => {
  if (!hold.has(message.to)) {
    delivered.push(message.to);
    return;
  }
  await new Promise<void>((resolve) => {
    openSends.set(message.to, { resolve, signal: message.signal });
  });
  delivered.push(message.to);
});

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, emailPort: { send: mockSend } };
});

const TARGET_ALLOWED = `p678-target-allowed-${randomUUID()}@fikirtive.test`;
const TARGET_UNKNOWN = `p678-target-unknown-${randomUUID()}@fikirtive.test`;
const CANARY = `p678-canary-${randomUUID()}@fikirtive.test`;
const SLOW = `p678-slow-${randomUUID()}@fikirtive.test`;
const BEHIND = `p678-behind-${randomUUID()}@fikirtive.test`;

process.env.BETTER_AUTH_SECRET = "x".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.AUTH_ALLOWED_EMAILS = [TARGET_ALLOWED, CANARY, SLOW, BEHIND].join(",");
process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";

const { prisma } = await import("@fikirtive/db");
const {
  authEmailQueueSettled,
  enqueueAuthEmail,
  __resetAuthEmailCapsForTests,
  __configureAuthEmailQueueForTests,
  AUTH_EMAIL_JITTER_MAX_MS,
  AUTH_EMAIL_MAX_CONCURRENCY,
  AUTH_EMAIL_JOB_TIMEOUT_MS,
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
 *  rather than a suite timeout. Generous on purpose: the case it has to separate is "blocked
 *  until the held delivery is released", i.e. forever, so nothing is gained by being tight. */
async function waitUntil(predicate: () => boolean, timeoutMs = 6000): Promise<boolean> {
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
  // Warm the database connection and Better Auth's construction OUTSIDE the cases. Otherwise
  // the first case pays for both and the ordering assertions end up racing a cold start rather
  // than the executor.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0 });
  await prisma.allowedEmail.count();
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
  mockSend.mockClear();
  __resetAuthEmailCapsForTests();
  __resetMagicLinkThrottleForTests();
  // Jitter off for the ORDERING cases: they are about whether the canary has to wait for the
  // probe at all, and a random delay would only add noise to a claim that is structural. The
  // jitter itself gets its own case below.
  __configureAuthEmailQueueForTests({ jitterMaxMs: 0 });
});

// ── the canary attack ────────────────────────────────────────────────────────────────────────
describe("#678 r4 — a canary's email does not track the probe's allowlist status", () => {
  /** The probe goes first, the attacker's own address second — the attack's exact ordering. */
  async function probeThenCanary(target: string): Promise<string[]> {
    // Identical starting state for both branches — same canary address, same budgets, empty
    // inbox — so the only thing that differs between the two runs is the probe.
    delivered.length = 0;
    __resetAuthEmailCapsForTests();
    __resetMagicLinkThrottleForTests();

    // The allowed probe's delivery is held open forever: the most extreme possible version of
    // "the allowed branch takes longer". The unknown probe never gets that far.
    hold.add(target);
    press(target, "203.0.113.50");
    press(CANARY, "203.0.113.50");

    const canaryLanded = await waitUntil(() => delivered.includes(CANARY));
    expect(canaryLanded).toBe(true);
    const snapshot = [...delivered];

    releaseAll();
    await authEmailQueueSettled();
    return snapshot;
  }

  it("lands the canary in the same position whether the probe has access or not", async () => {
    // RED before r4: one serial worker. With the allowed probe's delivery held open, the canary
    // never even starts, so this snapshot is [] for one branch and [CANARY] for the other —
    // which IS the oracle, read off the attacker's own inbox.
    const againstUnknown = await probeThenCanary(TARGET_UNKNOWN);
    const againstAllowed = await probeThenCanary(TARGET_ALLOWED);

    expect(againstUnknown).toEqual([CANARY]);
    expect(againstAllowed).toEqual(againstUnknown);
  });

  it("the probe with access really did take the long branch — the parity above is not vacuous", async () => {
    hold.add(TARGET_ALLOWED);
    press(TARGET_ALLOWED, "203.0.113.51");
    // It got all the way to the mail provider: a verification token exists and a send is open.
    const opened = await waitUntil(() => openSends.has(TARGET_ALLOWED));
    expect(opened).toBe(true);
    expect(
      await prisma.betterAuthVerification.count({ where: { value: { contains: TARGET_ALLOWED } } }),
    ).toBeGreaterThan(0);

    // …while the unknown probe stopped at the allowlist check: no token, no send.
    press(TARGET_UNKNOWN, "203.0.113.52");
    await waitUntil(() => false, 200); // give it every chance to do something
    expect(mockSend.mock.calls.some((c) => c[0].to === TARGET_UNKNOWN)).toBe(false);
    expect(
      await prisma.betterAuthVerification.count({ where: { value: { contains: TARGET_UNKNOWN } } }),
    ).toBe(0);

    releaseAll();
    await authEmailQueueSettled();
  });
});

// ── head-of-line blocking ────────────────────────────────────────────────────────────────────
describe("#678 r4 — one stuck delivery does not become every tenant's stuck delivery", () => {
  it("keeps delivering behind a send that never answers, even with a single worker", async () => {
    // Concurrency 1 on purpose: this is the claim about the DEADLINE, not about the pool. With
    // one worker and no deadline, the stuck job owns the queue forever.
    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, maxConcurrency: 1, jobTimeoutMs: 300 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    hold.add(SLOW);
    enqueueAuthEmail({ purpose: "verify-email", email: SLOW, url: "https://x.test/slow" });
    enqueueAuthEmail({ purpose: "verify-email", email: BEHIND, url: "https://x.test/behind" });

    // RED before r4: `await` on a promise that never settles — BEHIND is never even attempted.
    expect(await waitUntil(() => delivered.includes(BEHIND))).toBe(true);

    // The stuck job was abandoned on its own deadline, with an operator line and no address…
    const lines = log.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("auth email job failed") && l.includes("timeout"))).toBe(true);
    for (const line of lines) expect(line).not.toContain(SLOW);
    // …and the transport was told to stop, not merely forgotten about.
    expect(openSends.get(SLOW)?.signal?.aborted).toBe(true);

    log.mockRestore();
    releaseAll();
    await authEmailQueueSettled();
  });

  it("runs up to the concurrency budget at once and no more", async () => {
    __configureAuthEmailQueueForTests({ jitterMaxMs: 0, jobTimeoutMs: 2000 });
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

    releaseAll();
    await authEmailQueueSettled();
  });
});

// ── jitter ───────────────────────────────────────────────────────────────────────────────────
describe("#678 r4 — every job waits a random moment before it starts", () => {
  it("asks for a delay inside the configured range, and a different one each time", async () => {
    const asked: number[] = [];
    // The dice, replaced: three known draws instead of a sample of Math.random.
    const draws = [0, 0.5, 1];
    let next = 0;
    __configureAuthEmailQueueForTests({
      random: () => draws[next++ % draws.length],
      sleepFn: async (ms) => {
        asked.push(ms);
      },
    });

    for (let i = 0; i < 3; i++) {
      enqueueAuthEmail({ purpose: "verify-email", email: `p678-jit-${i}@fikirtive.test`, url: "u" });
    }
    await authEmailQueueSettled();

    expect(asked).toHaveLength(3);
    for (const ms of asked) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(AUTH_EMAIL_JITTER_MAX_MS);
    }
    // Not a constant, and it spans the range.
    expect(new Set(asked).size).toBe(3);
    expect(Math.max(...asked)).toBe(AUTH_EMAIL_JITTER_MAX_MS);
  });

  it("is wide enough to swallow the branch it is hiding", () => {
    // What has to disappear is "mint a token + re-check access + one provider round trip",
    // hundreds of milliseconds at the very worst. A uniform draw over this range has a standard
    // deviation of ~577 ms, so a single observation carries no usable signal.
    expect(AUTH_EMAIL_JITTER_MAX_MS).toBeGreaterThanOrEqual(1000);
    // …and the deadline has to be several times a healthy round trip, so nothing real is cut off.
    expect(AUTH_EMAIL_JOB_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    // …and the pool has to be wide enough that a probe and a canary are genuinely independent.
    expect(AUTH_EMAIL_MAX_CONCURRENCY).toBeGreaterThanOrEqual(2);
  });
});

afterAll(async () => {
  releaseAll();
  __configureAuthEmailQueueForTests({});
  await authEmailQueueSettled();
  try {
    await prisma.betterAuthVerification.deleteMany({
      where: { OR: [{ value: { contains: "p678-target-" } }, { value: { contains: "p678-canary-" } }] },
    });
  } catch {
    /* best-effort cleanup */
  }
});
