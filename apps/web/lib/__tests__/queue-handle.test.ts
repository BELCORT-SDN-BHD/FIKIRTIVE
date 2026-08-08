/**
 * #700 — the pg-boss producer handle must not cache a failure as a permanent fact.
 *
 * Observed in the walkthrough: web booted before the worker had migrated the pgboss
 * schema, the first `getBoss()` rejected, and the rejected promise stayed in the
 * module cache. After the worker came up — queue fully healthy — every later
 * generation still failed with "queue unavailable" until the process was restarted.
 *
 * "Could not connect this time" is a fact about one attempt, not a verdict about the
 * queue. These tests pin both halves of the contract: the handle keeps retrying until
 * it succeeds, and a genuinely down queue does not turn every request into a fresh
 * connect attempt (bounded backoff).
 *
 * pg-boss is faked — no database is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls = { construct: 0, start: 0, createQueue: 0, stop: 0 };
  const control = {
    failStart: false,
    failCreateQueue: false,
    hangStop: false,
    /** Lets a test make the attempt itself consume time (a real connect timeout does). */
    onStart: null as null | (() => void),
  };
  class FakePgBoss {
    constructor() {
      calls.construct += 1;
    }
    on() {
      return this;
    }
    async start() {
      calls.start += 1;
      control.onStart?.();
      if (control.failStart) throw new Error("pgboss schema does not exist");
    }
    async createQueue() {
      calls.createQueue += 1;
      if (control.failCreateQueue) throw new Error("createQueue failed");
    }
    async stop() {
      calls.stop += 1;
      if (control.hangStop) await new Promise(() => {});
    }
  }
  return { calls, control, FakePgBoss };
});

vi.mock("pg-boss", () => ({ PgBoss: h.FakePgBoss }));

let clock = 0;

async function loadGetBoss() {
  vi.resetModules();
  return (await import("../queue")).getBoss;
}

function tick(ms: number) {
  clock += ms;
  vi.setSystemTime(clock);
}

beforeEach(() => {
  h.calls.construct = 0;
  h.calls.start = 0;
  h.calls.createQueue = 0;
  h.calls.stop = 0;
  h.control.failStart = false;
  h.control.failCreateQueue = false;
  h.control.hangStop = false;
  h.control.onStart = null;
  vi.stubEnv("DATABASE_URL_POOLED", "postgresql://fake/queue_handle_test");
  delete (globalThis as { __fikirtiveBossCell?: unknown }).__fikirtiveBossCell;
  clock = 1_700_000_000_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (globalThis as { __fikirtiveBossCell?: unknown }).__fikirtiveBossCell;
});

describe("getBoss — failure is never cached as a permanent fact (#700)", () => {
  it("retries after a failed build and succeeds once the queue is back", async () => {
    const getBoss = await loadGetBoss();

    h.control.failStart = true;
    await expect(getBoss()).rejects.toThrow("pgboss schema does not exist");

    // The worker comes up and migrates the schema. Nothing in the web process changed.
    h.control.failStart = false;
    tick(2_000);

    await expect(getBoss()).resolves.toBeDefined();
    expect(h.calls.start).toBe(2);
  });

  it("keeps the same handle once a build succeeds (singleton semantics unchanged)", async () => {
    const getBoss = await loadGetBoss();

    const first = await getBoss();
    const second = await getBoss();

    expect(second).toBe(first);
    expect(h.calls.construct).toBe(1);
  });

  it("shares one in-flight build between concurrent callers", async () => {
    const getBoss = await loadGetBoss();

    const [a, b] = await Promise.all([getBoss(), getBoss()]);

    expect(b).toBe(a);
    expect(h.calls.construct).toBe(1);
  });

  it("recovers on the dev (globalThis) branch too", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getBoss = await loadGetBoss();

    h.control.failStart = true;
    await expect(getBoss()).rejects.toThrow("pgboss schema does not exist");

    h.control.failStart = false;
    tick(2_000);

    await expect(getBoss()).resolves.toBeDefined();
    expect(h.calls.start).toBe(2);
  });
});

describe("getBoss — retrying is bounded, not one connect attempt per request", () => {
  it("refuses without dialing the database while the cooldown is open", async () => {
    const getBoss = await loadGetBoss();

    h.control.failStart = true;
    await expect(getBoss()).rejects.toThrow();
    expect(h.calls.start).toBe(1);

    // A burst of clicks during the outage must not each pay a connect attempt.
    tick(100);
    await expect(getBoss()).rejects.toThrow(/cooling down/i);
    await expect(getBoss()).rejects.toThrow(/cooling down/i);
    expect(h.calls.start).toBe(1);
    expect(h.calls.construct).toBe(1);
  });

  it("keeps the original failure as the cause of a cooldown refusal", async () => {
    const getBoss = await loadGetBoss();

    h.control.failStart = true;
    await expect(getBoss()).rejects.toThrow();
    tick(10);

    await expect(getBoss()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "pgboss schema does not exist" }),
    });
  });

  it("widens the cooldown after each consecutive failure", async () => {
    const getBoss = await loadGetBoss();
    h.control.failStart = true;

    // 1st failure → 1s cooldown
    await expect(getBoss()).rejects.toThrow();
    tick(1_001);
    // 2nd failure → 2s cooldown
    await expect(getBoss()).rejects.toThrow();
    expect(h.calls.start).toBe(2);

    // 1.5s in, the second (wider) window is still open — proof it grew.
    tick(1_500);
    await expect(getBoss()).rejects.toThrow(/cooling down/i);
    expect(h.calls.start).toBe(2);

    tick(600);
    await expect(getBoss()).rejects.toThrow();
    expect(h.calls.start).toBe(3);
  });

  it("caps the window at 30s — a long failure streak never widens it further", async () => {
    const getBoss = await loadGetBoss();
    h.control.failStart = true;

    // 13 consecutive failures. Uncapped the window here would be 1000 × 2^12 ≈ 68
    // minutes; each advance below is past any window, capped or not, so the streak
    // itself builds identically either way.
    for (let i = 0; i < 13; i += 1) {
      tick(2 * 60 * 60_000);
      await expect(getBoss()).rejects.toThrow();
    }
    expect(h.calls.start).toBe(13);

    // The load-bearing part: at 30s + ε past each failure there must be a REAL new
    // attempt, round after round. Without the cap the window would still be ~68
    // minutes and every one of these would be a cooldown refusal instead.
    for (let round = 0; round < 5; round += 1) {
      tick(29_000);
      await expect(getBoss()).rejects.toThrow(/cooling down/i);
      const before = h.calls.start;
      tick(1_100);
      await expect(getBoss()).rejects.toThrow("pgboss schema does not exist");
      expect(h.calls.start).toBe(before + 1);
    }
  });

  it("measures the cooldown from when the failed attempt FINISHED, not when it started", async () => {
    const getBoss = await loadGetBoss();

    // A real connect failure is not instant: pg-boss 12.18.2 sits on a 10s
    // connectionTimeoutMillis. This is the other half of the stated recovery
    // bound — worst case is the doomed attempt's own duration plus the 30s cap.
    const ATTEMPT_MS = 10_000;
    h.control.failStart = true;
    h.control.onStart = () => tick(ATTEMPT_MS);

    const startedAt = clock;
    await expect(getBoss()).rejects.toThrow();
    expect(clock).toBe(startedAt + ATTEMPT_MS);
    h.control.onStart = null;

    // 10.9s after the attempt STARTED the first 1s window would already be over.
    // Measured from the finish it is still open, so no new dial-out happens.
    tick(900);
    await expect(getBoss()).rejects.toThrow(/cooling down/i);
    expect(h.calls.start).toBe(1);

    // 1s after it FINISHED, the retry runs.
    tick(200);
    h.control.failStart = false;
    await expect(getBoss()).resolves.toBeDefined();
    expect(h.calls.start).toBe(2);
  });

  it("releases the half-built handle's connection pool when the build fails", async () => {
    const getBoss = await loadGetBoss();

    h.control.failCreateQueue = true;
    await expect(getBoss()).rejects.toThrow("createQueue failed");

    // Without this, every retry would leak another pg pool against the database.
    expect(h.calls.stop).toBe(1);
  });

  it("still fails fast when releasing the pool hangs", async () => {
    const getBoss = await loadGetBoss();

    // pool.end() against an unreachable host can sit on the TCP timeout. Waiting for
    // the cleanup would turn a fast, honest failure into a hang for every caller.
    h.control.failStart = true;
    h.control.hangStop = true;
    await expect(getBoss()).rejects.toThrow("pgboss schema does not exist");
    expect(h.calls.stop).toBe(1);

    // And the hung cleanup must not block the next real retry either.
    h.control.failStart = false;
    h.control.hangStop = false;
    tick(2_000);
    await expect(getBoss()).resolves.toBeDefined();
  });
});
