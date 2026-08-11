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
  isBackupWindow,
  klDateString,
  klHour,
  pgEnvFromUrl,
  selectExpiredBackups,
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
