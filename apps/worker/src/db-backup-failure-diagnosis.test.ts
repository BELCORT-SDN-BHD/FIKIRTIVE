/**
 * #1385 review r1 — the WIRING, not the helpers.
 *
 * The classifier and the allow-list are unit-tested in db-backup.test.ts, but a green
 * classifier proves nothing if `dumpDatabaseToFile` never actually reads stderr, or if the
 * tail is still empty when the child rejects, or if the token is dropped between
 * `attachPgDumpDiagnostic` and the `BackupRun` row. That gap is what let 1360 rows say
 * "exit code 1" and nothing else, so it is the gap worth a real subprocess.
 *
 * execa is NOT mocked here. A `pg_dump` shim earlier on PATH prints the genuine
 * version-mismatch text to stderr and exits 1, so the real spawn, the real pipe, the real
 * 4 KB tail and the real error path all run. Only R2 and Prisma are mocked — this test is
 * about the diagnosis reaching the row, not about storage.
 *
 * The connection URL below carries a host, a user and a password ON PURPOSE: every
 * assertion that they are absent is an assertion the redaction guarantee survived the
 * change that started reading stderr in the first place.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const LEAKY_URL = "postgres://leaky_user:s3cret_pw@db.internal.example:5432/fikirtive_prod";
const SECRETS = ["leaky_user", "s3cret_pw", "db.internal.example", "fikirtive_prod"];

const state = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));

vi.mock("@fikirtive/storage", () => ({
  createOpsBucket: () => ({
    credentialMode: "shared" as const,
    exists: async () => false,
    putFileIfAbsent: async () => ({ created: true, sizeBytes: 1 }),
    list: async () => [],
    deleteObject: async () => {},
  }),
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

const { dumpDatabaseToFile, runBackupOnce } = await import("./db-backup.js");

/** The real text a pg_dump 17 prints against an 18.6 server (reproduced 2026-09-14). */
const MISMATCH_STDERR = [
  "pg_dump: error: aborting because of server version mismatch",
  "pg_dump: detail: server version: 18.6 (Debian 18.6-1.pgdg13+2); pg_dump version: 17.11 (Debian 17.11-1.pgdg13+2)",
];

let shimDir: string;
let realPath: string | undefined;

beforeAll(() => {
  shimDir = mkdtempSync(path.join(tmpdir(), "pgdump-shim-"));
  const shim = path.join(shimDir, "pg_dump");
  writeFileSync(
    shim,
    ["#!/bin/sh", ...MISMATCH_STDERR.map((l) => `echo '${l}' >&2`), "exit 1", ""].join("\n"),
  );
  chmodSync(shim, 0o755);
  realPath = process.env.PATH;
  // pgSpawnEnv hands the child the ambient PATH, so the shim is what `pg_dump` resolves to.
  process.env.PATH = `${shimDir}:${realPath ?? ""}`;
});

afterAll(async () => {
  process.env.PATH = realPath;
  await rm(shimDir, { recursive: true, force: true });
});

beforeEach(() => {
  state.created.length = 0;
  process.env.STORAGE_DRIVER = "r2";
  process.env.DATABASE_URL = LEAKY_URL;
});

describe("pg_dump failure diagnosis, end to end through a real subprocess", () => {
  it("tags the thrown error with the classification read from the child's real stderr", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dump-out-"));
    const err = await dumpDatabaseToFile(LEAKY_URL, path.join(dir, "dump.gz")).then(
      () => new Error("expected the dump to fail"),
      (e: unknown) => e,
    );
    await rm(dir, { recursive: true, force: true });

    // The tail was populated BEFORE the child's rejection was observed — the ordering bug
    // this test exists to catch would leave the token as a bare "unknown".
    expect((err as { pgDumpDiagnostic?: string }).pgDumpDiagnostic).toBe(
      "pg_dump_version_mismatch: server 18.6 / pg_dump 17.11",
    );

    // Nothing about the connection may be reachable from the error object either — the URL
    // never enters argv, so not even execa's own message can carry it.
    const serialized = JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
  });

  it("writes the classification onto the BackupRun row, with no host or user in it", async () => {
    const outcome = await runBackupOnce({ trigger: "cron", checkWindow: false });
    expect(outcome.outcome).toBe("failed");

    const rows = state.created.filter((r) => r.status === "failed");
    expect(rows).toHaveLength(1);
    const error = rows[0]!.error as string;

    // This is the string the admin panel renders — and the one that was useless for 1360 runs.
    expect(error).toBe(
      "media subprocess failed (exit code 1) [pg_dump_version_mismatch: server 18.6 / pg_dump 17.11]",
    );
    for (const secret of SECRETS) expect(error).not.toContain(secret);
  });
});
