/**
 * #794 P1-2 / P1-3 (judge r1) — runBackupOnce, the shared core of both triggers:
 *
 *   - A DOUBLE TRIGGER records ONE backup. Both the worker timer and the Railway cron
 *     service can pass the cheap exists() check in the same window; the atomic put-if-absent
 *     settles it, and the loser (`created:false`) records NOTHING — no second success row.
 *   - The skip REASONS are distinguishable, so the cron entrypoint can treat a missing
 *     backup target / DATABASE_URL as a failure rather than a benign no-op.
 *
 * The store and DB are mocked: this is about runBackupOnce's control flow, not about R2 or
 * Postgres (the atomic contract itself is proven in backup-atomic-write.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

const state = vi.hoisted(() => ({
  existing: new Set<string>(),
  putCalls: 0,
  created: [] as Array<Record<string, unknown>>,
  hasR2: true,
  /** Gate that holds every in-flight put open until both have arrived (real overlap). */
  putGate: null as null | Promise<void>,
  concurrentPeak: 0,
  inFlight: 0,
}));

// pg_dump → an immediately-ending stream so the real gzip+file pipeline resolves without pg.
vi.mock("execa", () => ({
  execa: () => Object.assign(Promise.resolve({}), { stdout: Readable.from([]) }),
}));

vi.mock("@fikirtive/storage", () => ({
  createOpsBucket: () =>
    state.hasR2
      ? {
          credentialMode: "isolated" as const,
          // Always "absent" so BOTH triggers pass the fast-path and reach the atomic put —
          // that is precisely the race this test exists to exercise.
          exists: async () => false,
          putFileIfAbsent: async (key: string) => {
            state.putCalls += 1;
            state.inFlight += 1;
            state.concurrentPeak = Math.max(state.concurrentPeak, state.inFlight);
            // Hold here so both callers are genuinely inside the put at the same time —
            // otherwise the "race" is just two sequential calls and proves nothing.
            if (state.putGate) await state.putGate;
            state.inFlight -= 1;
            // The atomic decision happens AFTER the overlap, exactly as S3 resolves it.
            if (state.existing.has(key)) return { created: false, sizeBytes: 123 };
            state.existing.add(key);
            return { created: true, sizeBytes: 123 };
          },
          list: async () => [],
          deleteObject: async () => {},
        }
      : null,
}));

vi.mock("@fikirtive/db", () => ({
  prisma: {
    backupRun: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.created.push(args.data);
        return args.data;
      }),
    },
  },
}));

vi.mock("@fikirtive/db/principal", () => ({
  runAsSystem: (_reason: string, fn: () => unknown) => fn(),
}));

const { runBackupOnce } = await import("./db-backup.js");

/**
 * A SECOND, independent instance of the module — the same code with its own module-level
 * state. The real double-trigger is two OS processes (the worker and the Railway cron
 * service): they share the object store but not the in-process re-entrancy flag, and it is
 * exactly that flag which would otherwise mask the race in a single-process test.
 */
async function freshModule(): Promise<typeof import("./db-backup.js")> {
  vi.resetModules();
  return import("./db-backup.js");
}

beforeEach(() => {
  state.existing.clear();
  state.putCalls = 0;
  state.created.length = 0;
  state.hasR2 = true;
  state.putGate = null;
  state.concurrentPeak = 0;
  state.inFlight = 0;
  process.env.STORAGE_DRIVER = "r2";
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/y_test";
});

describe("runBackupOnce — a double trigger records exactly one backup", () => {
  it("two OVERLAPPING triggers: both in the put at once, one wins, one records nothing", async () => {
    const cronSide = await freshModule(); // the Railway cron service
    const timerSide = await freshModule(); // the worker's own 5-minute timer

    // Hold both inside putFileIfAbsent until each has entered it, then release together.
    let release!: () => void;
    state.putGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = cronSide.runBackupOnce({ trigger: "cron", checkWindow: false });
    const b = timerSide.runBackupOnce({ trigger: "worker-timer", checkWindow: false });

    // Wait until both are genuinely in flight inside the put before letting either finish.
    await vi.waitFor(() => expect(state.inFlight).toBe(2));
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(state.concurrentPeak).toBe(2); // proof the two really overlapped
    expect(state.putCalls).toBe(2); // both attempted the atomic write

    const outcomes = [ra.outcome, rb.outcome].sort();
    expect(outcomes).toEqual(["already-done", "succeeded"]);

    // ...and only ONE success row exists, from whichever writer the store let through.
    const successRows = state.created.filter((r) => r.status === "succeeded");
    expect(successRows).toHaveLength(1);
    expect(["cron", "worker-timer"]).toContain(successRows[0]!.trigger);
  });

  // NOTE: the mocked exists() always reports "absent", so this re-run reaches the atomic
  // put just like the racing case — which is the stricter path to assert anyway.
  it("a same-day re-run records no second backup", async () => {
    const first = await runBackupOnce({ trigger: "cron", checkWindow: false });
    const second = await runBackupOnce({ trigger: "cron", checkWindow: false });
    expect(first.outcome).toBe("succeeded");
    expect(second.outcome).toBe("already-done");
    expect(state.created.filter((r) => r.status === "succeeded")).toHaveLength(1);
  });
});

describe("runBackupOnce — skip reasons are distinguishable (drives the cron failure policy)", () => {
  it("no R2 target → skipped/no-storage-target (a config error for the cron entry)", async () => {
    state.hasR2 = false;
    const r = await runBackupOnce({ trigger: "cron", checkWindow: false });
    expect(r).toMatchObject({ outcome: "skipped", kind: "no-storage-target" });
  });

  it("no DATABASE_URL → skipped/no-database-url", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_POOLED;
    const r = await runBackupOnce({ trigger: "cron", checkWindow: false });
    expect(r).toMatchObject({ outcome: "skipped", kind: "no-database-url" });
  });

  it("before the window (timer path) → skipped/before-window", async () => {
    // 18:59:59Z = 02:59 KL — before 03:00.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T18:59:59Z"));
    try {
      const r = await runBackupOnce({ trigger: "worker-timer", checkWindow: true });
      expect(r).toMatchObject({ outcome: "skipped", kind: "before-window" });
    } finally {
      vi.useRealTimers();
    }
  });
});
