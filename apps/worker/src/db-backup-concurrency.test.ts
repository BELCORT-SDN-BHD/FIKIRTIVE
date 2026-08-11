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

beforeEach(() => {
  state.existing.clear();
  state.putCalls = 0;
  state.created.length = 0;
  state.hasR2 = true;
  process.env.STORAGE_DRIVER = "r2";
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/y_test";
});

describe("runBackupOnce — a double trigger records exactly one backup", () => {
  it("first trigger succeeds and records; second loses the atomic put and records nothing", async () => {
    const a = await runBackupOnce({ trigger: "cron", checkWindow: false });
    const b = await runBackupOnce({ trigger: "worker-timer", checkWindow: false });

    expect(a.outcome).toBe("succeeded");
    expect(b.outcome).toBe("already-done");
    expect(state.putCalls).toBe(2); // both attempted the atomic write
    const successRows = state.created.filter((r) => r.status === "succeeded");
    expect(successRows).toHaveLength(1); // ...but only one row exists
    expect(successRows[0]!.trigger).toBe("cron");
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
