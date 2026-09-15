/**
 * Pure-logic tests for the nightly DB backup (P0-1②): key naming, KL-date
 * computation, the trigger-rule decision table, retention cutoff selection,
 * and the PG* env split that keeps DATABASE_URL out of pg_dump argv.
 * No network, no subprocess — runtime paths are covered by the local smoke.
 */
import { describe, expect, it } from "vitest";
import {
  backupKeyFor,
  backupTriggerMode,
  classifyPgDumpStderr,
  formatPgDumpDiagnostic,
  isBackupWindow,
  klDateString,
  klHour,
  PG_DUMP_FAILURE_TOKENS,
  pgEnvFromUrl,
  pgSpawnEnv,
  selectExpiredBackups,
  withPgDumpDiagnostic,
} from "./db-backup.js";

describe("klDateString / klHour (Asia/Kuala_Lumpur = UTC+8, no DST)", () => {
  it("converts a UTC instant to the KL calendar date", () => {
    expect(klDateString(new Date("2026-07-07T12:00:00Z"))).toBe("2026-07-07"); // 20:00 KL
    expect(klHour(new Date("2026-07-07T12:00:00Z"))).toBe(20);
  });

  it("rolls to the next KL day at 16:00 UTC", () => {
    expect(klDateString(new Date("2026-07-07T15:59:59Z"))).toBe("2026-07-07"); // 23:59 KL
    expect(klDateString(new Date("2026-07-07T16:00:00Z"))).toBe("2026-07-08"); // 00:00 KL
  });

  it("rolls month and year boundaries", () => {
    expect(klDateString(new Date("2026-01-31T17:00:00Z"))).toBe("2026-02-01");
    expect(klDateString(new Date("2026-12-31T16:30:00Z"))).toBe("2027-01-01");
  });
});

describe("backupKeyFor", () => {
  it("builds the dated key under backups/db/", () => {
    expect(backupKeyFor(new Date("2026-07-07T12:00:00Z"))).toBe(
      "backups/db/fikirtive-2026-07-07.dump.gz",
    );
  });

  it("uses the KL date, not the UTC date", () => {
    expect(backupKeyFor(new Date("2026-07-07T19:30:00Z"))).toBe(
      "backups/db/fikirtive-2026-07-08.dump.gz", // 03:30 KL next day
    );
  });
});

describe("isBackupWindow (trigger decision table: KL time >= 03:00)", () => {
  const cases: Array<[string, boolean, string]> = [
    ["2026-07-07T18:59:59Z", false, "02:59 KL — before the window"],
    ["2026-07-07T19:00:00Z", true, "03:00 KL — window opens"],
    ["2026-07-07T23:00:00Z", true, "07:00 KL — inside the window"],
    ["2026-07-07T12:00:00Z", true, "20:00 KL — window stays open until midnight"],
    ["2026-07-07T16:00:00Z", false, "00:00 KL — new day, window closed again"],
    ["2026-07-07T17:30:00Z", false, "01:30 KL — still closed"],
  ];
  for (const [utc, expected, label] of cases) {
    it(`${label} (${utc})`, () => {
      expect(isBackupWindow(new Date(utc))).toBe(expected);
    });
  }
});

describe("backupTriggerMode (#794② — exactly one trigger owns the backup)", () => {
  it("defaults to the worker timer when BACKUP_TRIGGER is unset", () => {
    expect(backupTriggerMode({})).toBe("worker-timer");
  });

  it("hands the trigger to cron on BACKUP_TRIGGER=cron", () => {
    expect(backupTriggerMode({ BACKUP_TRIGGER: "cron" })).toBe("cron");
  });

  it("tolerates the shapes a Railway variable actually arrives in", () => {
    expect(backupTriggerMode({ BACKUP_TRIGGER: " CRON " })).toBe("cron");
    expect(backupTriggerMode({ BACKUP_TRIGGER: "Cron" })).toBe("cron");
  });

  it("falls back to the timer for any other value — the backup never has ZERO triggers", () => {
    // The failure worth designing against is "nobody runs it". A typo'd value must land
    // on the shape that still fires, not on silence.
    expect(backupTriggerMode({ BACKUP_TRIGGER: "" })).toBe("worker-timer");
    expect(backupTriggerMode({ BACKUP_TRIGGER: "railway" })).toBe("worker-timer");
    expect(backupTriggerMode({ BACKUP_TRIGGER: "true" })).toBe("worker-timer");
  });
});

describe("selectExpiredBackups (30-day retention, dates parsed from keys)", () => {
  const now = new Date("2026-07-07T20:00:00Z"); // 2026-07-08 04:00 KL → cutoff 2026-06-08

  it("selects only keys strictly older than the cutoff", () => {
    const keys = [
      "backups/db/fikirtive-2026-06-07.dump.gz", // 31 KL-days old → expired
      "backups/db/fikirtive-2026-06-08.dump.gz", // exactly at cutoff → kept
      "backups/db/fikirtive-2026-07-01.dump.gz", // recent → kept
      "backups/db/fikirtive-2026-07-08.dump.gz", // today → kept
    ];
    expect(selectExpiredBackups(keys, now)).toEqual(["backups/db/fikirtive-2026-06-07.dump.gz"]);
  });

  it("never selects keys outside the naming scheme, however old they look", () => {
    const keys = [
      "backups/db/manual-2020-01-01.dump.gz",
      "backups/db/fikirtive-2020-01-01.dump.gz.bak",
      "backups/db/fikirtive-not-a-date.dump.gz",
      "u/founder/aaaa.mp4",
    ];
    expect(selectExpiredBackups(keys, now)).toEqual([]);
  });

  it("returns empty for no keys", () => {
    expect(selectExpiredBackups([], now)).toEqual([]);
  });
});

describe("pgEnvFromUrl (connection via env, NEVER argv)", () => {
  it("splits a plain local URL", () => {
    expect(pgEnvFromUrl("postgres://fikirtive:fikirtive@localhost:5432/fikirtive_test")).toEqual({
      PGHOST: "localhost",
      PGPORT: "5432",
      PGUSER: "fikirtive",
      PGPASSWORD: "fikirtive",
      PGDATABASE: "fikirtive_test",
    });
  });

  it("splits a Neon-style URL with sslmode and channel_binding", () => {
    const env = pgEnvFromUrl(
      "postgresql://user:s3cret@ep-plain-king-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    );
    expect(env).toEqual({
      PGHOST: "ep-plain-king-123.ap-southeast-1.aws.neon.tech",
      PGUSER: "user",
      PGPASSWORD: "s3cret",
      PGDATABASE: "neondb",
      PGSSLMODE: "require",
      PGCHANNELBINDING: "require",
    });
  });

  it("percent-decodes credentials and database names", () => {
    const env = pgEnvFromUrl("postgres://us%40er:p%40ss%2Fword@db.example.com:6543/my%20db");
    expect(env.PGUSER).toBe("us@er");
    expect(env.PGPASSWORD).toBe("p@ss/word");
    expect(env.PGDATABASE).toBe("my db");
  });

  it("omits absent parts instead of emitting empty strings", () => {
    const env = pgEnvFromUrl("postgres://localhost/db");
    expect(env).toEqual({ PGHOST: "localhost", PGDATABASE: "db" });
  });
});

/**
 * #794 judge r2 P1 — the dump subprocess must not inherit the ambient PG* family.
 * libpq reads PGHOSTADDR (which OUTRANKS PGHOST for the real TCP connection) and
 * PGSERVICE (a service-file stanza supplying host/port/dbname), so an inherited
 * environment could send pg_dump to a server the connection URL never named while every
 * string we inspected still read correctly.
 */
describe("pgSpawnEnv (the COMPLETE child environment — no inherited PG*)", () => {
  const URL_ = "postgres://user:pw@localhost:5432/fikirtive_test";

  it("drops every ambient PG* that could move the connection", () => {
    const env = pgSpawnEnv(URL_, {
      PATH: "/usr/bin",
      PGHOSTADDR: "10.0.0.1",
      PGSERVICE: "prod",
      PGSERVICEFILE: "/tmp/evil.conf",
      PGPASSFILE: "/tmp/evil.pass",
      PGHOST: "prod.example",
      PGDATABASE: "production",
      PGPORT: "6543",
      PGSSLMODE: "prefer",
    });
    // nothing from the ambient PG* family survives...
    expect(env.PGHOSTADDR).toBeUndefined();
    expect(env.PGSERVICE).toBeUndefined();
    expect(env.PGSERVICEFILE).toBeUndefined();
    expect(env.PGPASSFILE).toBeUndefined();
    expect(env.PGSSLMODE).toBeUndefined(); // not in the URL, so not in the child
    // ...and the ones we DO set come from the URL, not the environment
    expect(env.PGHOST).toBe("localhost");
    expect(env.PGDATABASE).toBe("fikirtive_test");
    expect(env.PGPORT).toBe("5432");
  });

  it("keeps only the minimal non-PG passthrough the binary needs", () => {
    const env = pgSpawnEnv(URL_, {
      PATH: "/usr/bin",
      HOME: "/root",
      LANG: "en_US.UTF-8",
      TMPDIR: "/tmp",
      AWS_SECRET_ACCESS_KEY: "should-not-leak",
      DATABASE_URL: "should-not-leak",
      SENTRY_DSN: "should-not-leak",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/root");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.TMPDIR).toBe("/tmp");
    // the child is built from scratch, so unrelated secrets never reach pg_dump either
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("carries the password via PG* env (never argv) — the pre-existing guarantee holds", () => {
    const env = pgSpawnEnv(URL_, { PATH: "/usr/bin" });
    expect(env.PGPASSWORD).toBe("pw");
    expect(env.PGUSER).toBe("user");
  });

  it("passes through the URL's own sslmode/channel_binding (Neon), not the ambient one", () => {
    const env = pgSpawnEnv("postgres://u:p@h.neon.tech/db?sslmode=require&channel_binding=require", {
      PATH: "/usr/bin",
      PGSSLMODE: "disable",
    });
    expect(env.PGSSLMODE).toBe("require");
    expect(env.PGCHANNELBINDING).toBe("require");
  });

  /**
   * #1385 review r1 — the classifier's signatures are English, so the message locale is
   * part of the contract, not an incidental detail. pg_dump on Debian is an NLS build:
   * under a German locale the mismatch line reads "Abbruch wegen unpassender
   * Serverversion" and every pattern misses. The pin below is the only thing standing
   * between an inherited LC_ALL and a misfiled diagnosis.
   */
  it("pins the message locale to C so pg_dump cannot answer in another language", () => {
    const env = pgSpawnEnv(URL_, {
      PATH: "/usr/bin",
      LANG: "de_DE.UTF-8",
      LC_ALL: "de_DE.UTF-8",
      LC_MESSAGES: "de_DE.UTF-8",
    });
    // LC_ALL is the one that must win — POSIX lets it override LC_MESSAGES, so pinning
    // only the weaker variable would lose to exactly the environment we are defending against.
    expect(env.LC_ALL).toBe("C");
    expect(env.LC_MESSAGES).toBe("C");
  });
});

/**
 * #1385 — why a failed backup must say WHICH failure it was.
 *
 * 1360 BackupRun rows on staging all read `media subprocess failed (exit code 1)`:
 * pg_dump 17 could not dump a server that had moved to 18, and the message was
 * indistinguishable from a wrong password or an unreachable host. These tests pin the
 * two halves of the fix: the classification is right, and NOTHING from the stderr —
 * host, user, IP, password — can ride out with it. Every sample below is real pg_dump /
 * libpq wording; the first is the exact text reproduced against staging on 2026-09-14.
 */
describe("classifyPgDumpStderr (closed set of tokens, zero connection detail)", () => {
  const VERSION_MISMATCH_16_VS_18 = [
    "pg_dump: error: aborting because of server version mismatch",
    "pg_dump: detail: server version: 18.6 (Debian 18.6-1.pgdg13+2); pg_dump version: 16.14 (Homebrew)",
  ].join("\n");

  const VERSION_MISMATCH_17_VS_18 = [
    "pg_dump: error: aborting because of server version mismatch",
    "pg_dump: detail: server version: 18.6 (Debian 18.6-1.pgdg13+2); pg_dump version: 17.11 (Debian 17.11-1.pgdg13+2)",
  ].join("\n");

  const AUTH_FAILED =
    'pg_dump: error: connection to server at "ep-secret-king-123.ap-southeast-1.aws.neon.tech" (10.1.2.3), ' +
    'port 5432 failed: FATAL:  password authentication failed for user "fikirtive_prod"';

  const CONNECTION_REFUSED = [
    'pg_dump: error: connection to server at "shinkansen.proxy.rlwy.net" (203.0.113.9), port 41234 failed: Connection refused',
    "\tIs the server running on that host and accepting TCP/IP connections?",
  ].join("\n");

  it("names the failure that actually broke staging (16 client vs 18 server, exit 1)", () => {
    const d = classifyPgDumpStderr(VERSION_MISMATCH_16_VS_18);
    expect(d).toEqual({ token: "pg_dump_version_mismatch", server: "18.6", client: "16.14" });
    expect(formatPgDumpDiagnostic(d)).toBe("pg_dump_version_mismatch: server 18.6 / pg_dump 16.14");
  });

  it("classifies 17-vs-18 the same way — the pin in the Dockerfile is what moves", () => {
    expect(formatPgDumpDiagnostic(classifyPgDumpStderr(VERSION_MISMATCH_17_VS_18))).toBe(
      "pg_dump_version_mismatch: server 18.6 / pg_dump 17.11",
    );
  });

  it("separates a wrong password from a version mismatch (both were 'exit code 1' before)", () => {
    expect(classifyPgDumpStderr(AUTH_FAILED).token).toBe("auth_failed");
  });

  it("separates an unreachable server — libpq wraps auth in 'connection … failed', so order matters", () => {
    expect(classifyPgDumpStderr(CONNECTION_REFUSED).token).toBe("connection_failed");
  });

  it("falls back to 'unknown' rather than guessing, and carries no text with it", () => {
    const d = classifyPgDumpStderr(
      "pg_dump: error: could not write to output file: No space left on device",
    );
    expect(d).toEqual({ token: "unknown" });
    expect(formatPgDumpDiagnostic(d)).toBe("unknown");
  });

  it("classifies an empty tail (stderr said nothing) as unknown", () => {
    expect(classifyPgDumpStderr("")).toEqual({ token: "unknown" });
  });

  /**
   * #1385 review r1 — why `pgSpawnEnv` pins LC_ALL=C, stated as a test rather than a comment.
   * These patterns are English and there is no stable translated form worth matching, so a
   * German pg_dump defeats ALL of them: the exact same failure would file as `unknown`.
   * The two assertions below are a pair on purpose — the first shows the classifier really
   * is locale-dependent, the second shows the environment pin is what removes the exposure.
   * Delete the pin and this test says so.
   */
  it("would miss a translated pg_dump — which is exactly what the pinned C locale prevents", () => {
    const german = [
      "pg_dump: Fehler: Abbruch wegen unpassender Serverversion",
      "pg_dump: Detail: Serverversion: 18.6 (Debian 18.6-1.pgdg13+2); pg_dump-Version: 17.11",
    ].join("\n");
    expect(classifyPgDumpStderr(german).token).toBe("unknown");
    // ...and this is why the child can never be handed a German locale in the first place.
    const env = pgSpawnEnv("postgres://u:p@localhost:5432/db", { LC_ALL: "de_DE.UTF-8" });
    expect(env.LC_ALL).toBe("C");
  });

  /**
   * The load-bearing assertion. `dumpDatabaseToFile` reads stderr for the FIRST time in
   * this module's life; if any of it could reach `formatPgDumpDiagnostic`'s output it
   * would land in the BackupRun.error column and render verbatim in /admin/system.
   */
  it("never lets a host, user, IP, port or password out of the stderr it read", () => {
    const samples = [
      VERSION_MISMATCH_16_VS_18,
      VERSION_MISMATCH_17_VS_18,
      AUTH_FAILED,
      CONNECTION_REFUSED,
      // stderr crafted to smuggle connection detail through the version line itself
      "pg_dump: detail: server version: 18.6 host=evil.example.com user=root password=hunter2; pg_dump version: 17.11",
      'pg_dump: error: connection to server at "db.internal" failed: FATAL: password authentication failed for user "root" (password=hunter2)',
    ];
    const forbidden = [
      "neon.tech",
      "rlwy.net",
      "evil.example.com",
      "db.internal",
      "fikirtive_prod",
      "root",
      "hunter2",
      "10.1.2.3",
      "203.0.113.9",
      "41234",
      "5432",
    ];
    for (const sample of samples) {
      const out = formatPgDumpDiagnostic(classifyPgDumpStderr(sample));
      for (const secret of forbidden) expect(out).not.toContain(secret);
      // and whatever came out is one of the four tokens, optionally with two numbers
      expect(out).toMatch(
        /^(?:pg_dump_version_mismatch|connection_failed|auth_failed|unknown)(?:: server [\d.]+ \/ pg_dump [\d.]+)?$/,
      );
    }
  });
});

describe("withPgDumpDiagnostic (the only thing allowed into the error column)", () => {
  const SUMMARY = "media subprocess failed (exit code 1)";

  it("appends the classification so the panel says which failure it was", () => {
    const err = Object.assign(new Error("pg_dump failed"), {
      exitCode: 1,
      pgDumpDiagnostic: "pg_dump_version_mismatch: server 18.6 / pg_dump 17.11",
    });
    expect(withPgDumpDiagnostic(SUMMARY, err)).toBe(
      "media subprocess failed (exit code 1) [pg_dump_version_mismatch: server 18.6 / pg_dump 17.11]",
    );
  });

  it("accepts every token in the closed set", () => {
    for (const token of PG_DUMP_FAILURE_TOKENS) {
      expect(withPgDumpDiagnostic(SUMMARY, { pgDumpDiagnostic: token })).toBe(
        `${SUMMARY} [${token}]`,
      );
    }
  });

  it("leaves the summary alone when the error carries no diagnostic", () => {
    expect(withPgDumpDiagnostic(SUMMARY, new Error("boom"))).toBe(SUMMARY);
    expect(withPgDumpDiagnostic(SUMMARY, undefined)).toBe(SUMMARY);
    expect(withPgDumpDiagnostic(SUMMARY, "a string error")).toBe(SUMMARY);
  });

  /**
   * Re-validated on READ, not just on write: the allow-list is the guarantee, so a value
   * that did not come from formatPgDumpDiagnostic is dropped rather than persisted.
   */
  it("drops anything outside the allow-listed shape instead of persisting it", () => {
    const hostile: unknown[] = [
      'connection to server at "db.internal" failed',
      "pg_dump_version_mismatch: server 18.6 / pg_dump 17.11 host=evil.example.com",
      "unknown; DATABASE_URL=postgres://u:p@h/db",
      "auth_failed for user fikirtive_prod",
      "",
      42,
      { token: "unknown" },
    ];
    for (const value of hostile) {
      expect(withPgDumpDiagnostic(SUMMARY, { pgDumpDiagnostic: value })).toBe(SUMMARY);
    }
  });
});
