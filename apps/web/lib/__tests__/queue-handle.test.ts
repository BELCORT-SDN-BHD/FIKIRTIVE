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
  const control = { failStart: false, failCreateQueue: false };
  class FakePgBoss {
    constructor() {
      calls.construct += 1;
    }
    on() {
      return this;
    }
    async start() {
      calls.start += 1;
      if (control.failStart) throw new Error("pgboss schema does not exist");
    }
    async createQueue() {
      calls.createQueue += 1;
      if (control.failCreateQueue) throw new Error("createQueue failed");
    }
    async stop() {
      calls.stop += 1;
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
  vi.stubEnv("DATABASE_URL_POOLED", "postgresql://fake/queue_handle_test");
  delete (globalThis as { __fikirtiveBoss?: unknown }).__fikirtiveBoss;
  clock = 1_700_000_000_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (globalThis as { __fikirtiveBoss?: unknown }).__fikirtiveBoss;
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

  it("widens the cooldown after each consecutive failure and caps it", async () => {
    const getBoss = await loadGetBoss();
    h.control.failStart = true;

    // 1st failure → 1s cooldown
    await expect(getBoss()).rejects.toThrow();
    tick(1_001);
    // 2nd failure → 2s cooldown
    await expect(getBoss()).rejects.toThrow();
    expect(h.calls.start).toBe(2);

    tick(1_500);
    await expect(getBoss()).rejects.toThrow(/cooling down/i);
    expect(h.calls.start).toBe(2);

    tick(600);
    await expect(getBoss()).rejects.toThrow();
    expect(h.calls.start).toBe(3);

    // Drive the streak past the cap: the window must stop growing at 30s.
    for (let i = 0; i < 12; i += 1) {
      tick(30_001);
      await expect(getBoss()).rejects.toThrow();
    }
    const startsBefore = h.calls.start;
    tick(30_001);
    await expect(getBoss()).rejects.toThrow();
    expect(h.calls.start).toBe(startsBefore + 1);
  });

  it("releases the half-built handle's connection pool when the build fails", async () => {
    const getBoss = await loadGetBoss();

    h.control.failCreateQueue = true;
    await expect(getBoss()).rejects.toThrow("createQueue failed");

    // Without this, every retry would leak another pg pool against the database.
    expect(h.calls.stop).toBe(1);
  });
});
