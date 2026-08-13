/**
 * Nightly Postgres backup → R2 (MASTERPLAN P0-1②, verdict 7-1 = ③, founder-approved
 * 2026-07-07). Protects the credit ledger — the money truth — against a bad
 * migration or fat-fingered prod write (push-to-main auto-migrates prod).
 *
 * WHO TRIGGERS IT (#794 ②). Two shapes, one env var, never both at once:
 *   BACKUP_TRIGGER=cron         — Railway cron calls `backup-cron.ts` on a schedule.
 *                                 The worker's 5-min timer path becomes a no-op.
 *   BACKUP_TRIGGER unset/other  — the legacy shape: the worker's own 5-min timer.
 * The move exists because the timer was the most fragile possible trigger: it only
 * fires while the worker process happens to be alive, and a worker that dies at
 * 02:00 takes the night's backup with it silently. Railway cron is a separate
 * scheduler with its own retry and its own visible run history.
 *
 * Trigger rule (deterministic, idempotent):
 *   timer path — every 5-min tick, when Asia/Kuala_Lumpur time >= 03:00;
 *   cron path  — whenever the scheduler fires (the schedule IS the window).
 * Both then check whether today's key `backups/db/fikirtive-<YYYY-MM-DD>.dump.gz`
 * already exists in R2 and skip if it does. The key-exists HEAD check IS the
 * exactly-once guard; a failed night self-heals on the next fire (key still absent).
 *
 * The `backups/` prefix is deliberately OUTSIDE the u/<ownerId>/ content-addressed
 * scheme: it is an ops artifact, never served — the web /files route serves only
 * keys that pass keyOwnerMatches (u/<owner>/…), and parseStorageKey rejects
 * everything else, so a backup object is unreachable from any browser-facing path.
 *
 * #463 / #794: this module now makes exactly ONE kind of Prisma call — appending a
 * `BackupRun` row so `/api/health` and admin can answer "did last night's backup
 * succeed?". Those writes run inside `runAsSystem("db-backup")`. `BackupRun` carries
 * no ownerId (platform-level ops record), so there is no tenant to scope.
 *
 * Failure policy: fail-soft — log (sanitized) + Sentry, never crash the worker,
 * never block the reap loop. The DATABASE_URL must NEVER appear in logs or
 * errors: the connection string is passed to pg_dump ONLY via PG* env vars
 * (never argv, so even a raw execa message can't carry it), and every log /
 * capture path goes through sanitizeError.
 */
import { execa } from "execa";
import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import * as Sentry from "@sentry/node";
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import { createOpsBucket, type R2OpsBucket } from "@fikirtive/storage";
import { sanitizeError } from "./redact.js";

export const DB_BACKUP_PREFIX = "backups/db/";
export const RETENTION_DAYS = 30;

/**
 * The pg_dump argv — the SINGLE source of truth for the dump command (judge r1 P1-4).
 * The recovery-drill self-test (`scripts/db-restore-drill-selftest.sh`) dumps through
 * {@link dumpDatabaseToFile}, which uses exactly this array, so the "zero real backup"
 * self-proof cannot go green against a dump built differently from the one the nightly
 * job produces. Change the dump shape here and both the runtime and the drill move together.
 */
export const PG_DUMP_ARGS = ["--format=custom", "--no-owner", "--no-privileges"] as const;
const BACKUP_WINDOW_START_HOUR = 3; // 03:00 Asia/Kuala_Lumpur
// KL is UTC+8 with no DST (unchanged since 1982) — a fixed offset keeps the
// date/hour math pure and unit-testable without Intl.
const KL_OFFSET_MS = 8 * 60 * 60 * 1000;
// pg_dump bound: hard execa timeout (playbook: every worker subprocess is
// timeout-bounded). Well above what a closed-beta DB needs; revisit with size.
const PG_DUMP_TIMEOUT_MS = 15 * 60 * 1000;

/* ---------------- pure logic (unit-tested) ---------------- */

/** YYYY-MM-DD in Asia/Kuala_Lumpur for the given instant. */
export function klDateString(now: Date): string {
  const kl = new Date(now.getTime() + KL_OFFSET_MS);
  const y = kl.getUTCFullYear();
  const m = String(kl.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kl.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Hour-of-day (0-23) in Asia/Kuala_Lumpur for the given instant. */
export function klHour(now: Date): number {
  return new Date(now.getTime() + KL_OFFSET_MS).getUTCHours();
}

/** Today's target key — one backup per KL calendar day. */
export function backupKeyFor(now: Date): string {
  return `${DB_BACKUP_PREFIX}fikirtive-${klDateString(now)}.dump.gz`;
}

/** True inside the nightly window: KL time >= 03:00. */
export function isBackupWindow(now: Date): boolean {
  return klHour(now) >= BACKUP_WINDOW_START_HOUR;
}

/**
 * #794 ② — who owns the trigger. `BACKUP_TRIGGER=cron` hands it to Railway cron
 * and silences the worker's timer path; anything else (including unset) keeps the
 * legacy timer. Deliberately NOT a boolean and NOT two independent flags: the one
 * outcome worth designing against is "both fire" or "neither fires", and a single
 * value with a default can produce neither.
 */
export type BackupTrigger = "cron" | "worker-timer" | "manual";

export function backupTriggerMode(env: Record<string, string | undefined> = process.env): "cron" | "worker-timer" {
  return env.BACKUP_TRIGGER?.trim().toLowerCase() === "cron" ? "cron" : "worker-timer";
}

const KEY_DATE_RE = /fikirtive-(\d{4}-\d{2}-\d{2})\.dump\.gz$/;

/**
 * Retention: keys whose embedded date is MORE than RETENTION_DAYS KL-days old.
 * Dates come from the key itself (deterministic), not object metadata; keys that
 * don't match the naming scheme are never selected — this function must never
 * pick anything it didn't create.
 */
export function selectExpiredBackups(keys: string[], now: Date): string[] {
  const cutoff = klDateString(new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
  return keys.filter((key) => {
    const m = key.match(KEY_DATE_RE);
    return m ? m[1]! < cutoff : false; // ISO dates compare lexicographically
  });
}

/**
 * Split a postgres:// URL into discrete PG* env vars so the connection string
 * (and its password) never appears in pg_dump's argv — the structural guarantee
 * behind "DATABASE_URL never in logs/errors" (execa errors embed argv).
 */
export function pgEnvFromUrl(raw: string): Record<string, string> {
  const u = new URL(raw);
  const env: Record<string, string> = {
    PGHOST: u.hostname,
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  // pass through the connection params Neon URLs carry; ignore anything else
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const channelBinding = u.searchParams.get("channel_binding");
  if (channelBinding) env.PGCHANNELBINDING = channelBinding;
  const options = u.searchParams.get("options");
  if (options) env.PGOPTIONS = options;
  return env;
}

/**
 * The ONLY non-PG environment variables pg_dump inherits. Everything else is dropped.
 *
 * WHY A WHITELIST (judge r2 P1). `extendEnv: true` handed pg_dump the worker's entire
 * environment, and libpq reads a whole FAMILY of PG* variables — most importantly
 * `PGHOSTADDR` (a numeric address that takes precedence over PGHOST for the actual TCP
 * connection) and `PGSERVICE` (names a stanza in a service file that can supply host,
 * port and dbname). So the connection target was never fully determined by the URL we
 * parsed: a PGHOSTADDR or PGSERVICE in the worker's environment silently re-pointed the
 * dump at another server while every string we inspected still read "the right one".
 *
 * Building the child environment from scratch removes that channel entirely: the child
 * gets PATH (to find the binary), a couple of locale/tmp basics, and exactly the PG*
 * variables we derived from the connection URL — no PGHOSTADDR, no PGSERVICE, no
 * PGSERVICEFILE, no PGPASSFILE, nothing we did not choose.
 */
const SPAWN_ENV_PASSTHROUGH = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"] as const;

/**
 * The COMPLETE environment for a pg_* subprocess: a minimal base plus the PG* vars
 * derived from `databaseUrl`. Never inherits the ambient PG* family (see above).
 */
export function pgSpawnEnv(databaseUrl: string, ambient: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SPAWN_ENV_PASSTHROUGH) {
    const value = ambient[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...pgEnvFromUrl(databaseUrl) };
}

/* ---------------- runtime ---------------- */

/**
 * Dump `databaseUrl` to a gzipped custom-format file at `file`. THE production dump
 * path — the nightly job and the recovery-drill self-test both call this exact
 * function (judge r1 P1-4), so a drift in how we dump can never pass the self-proof.
 *
 * Connection ONLY via env (see pgEnvFromUrl). stderr is discarded on purpose: libpq
 * error text can name host/user — the exit-code summary from sanitizeError is the
 * only diagnostic we persist or log.
 */
export async function dumpDatabaseToFile(databaseUrl: string, file: string): Promise<void> {
  const child = execa("pg_dump", [...PG_DUMP_ARGS], {
    // extendEnv:false + an explicit env is the guard (judge r2 P1): inheriting the
    // ambient environment would let PGHOSTADDR / PGSERVICE re-point this dump at a
    // server the URL never named. pgSpawnEnv passes PATH and our own PG* only.
    env: pgSpawnEnv(databaseUrl),
    extendEnv: false,
    timeout: PG_DUMP_TIMEOUT_MS,
    buffer: false, // stream — never hold the dump in memory
    stdout: "pipe",
    stderr: "ignore",
  });
  const [pipeRes, childRes] = await Promise.allSettled([
    pipeline(child.stdout!, createGzip(), createWriteStream(file)),
    child,
  ]);
  // prefer pg_dump's own failure (exit code / timeout) over the secondary
  // "premature close" the broken pipe produces
  if (childRes.status === "rejected") throw childRes.reason;
  if (pipeRes.status === "rejected") throw pipeRes.reason;
}

/**
 * Dump then ATOMICALLY create the object (put-if-absent). `created:false` means
 * another trigger wrote today's key first (judge r1 P1-3) — the caller must NOT
 * record a success row for it.
 */
async function dumpAndUpload(
  ops: R2OpsBucket,
  key: string,
  databaseUrl: string,
): Promise<{ created: boolean; sizeBytes: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), "db-backup-"));
  const file = path.join(dir, "dump.gz");
  try {
    await dumpDatabaseToFile(databaseUrl, file);
    return await ops.putFileIfAbsent(key, file, "application/gzip");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Prune backups past RETENTION_DAYS.
 *
 * #794 — this NEVER decides the run's outcome. Retention needs DELETE on the
 * bucket, and the isolated backup credential (#794 ④) may deliberately not have
 * it: with R2 object versioning on, "cannot delete" is a feature, and lifecycle
 * rules can do the pruning instead. Before this change a delete failure landed in
 * the same catch as a pg_dump failure, so a perfectly good uploaded dump would
 * have been recorded as a failed backup — the panel would have cried wolf every
 * single night. The tonight's-upload outcome and the housekeeping outcome are two
 * different facts and are now reported as two.
 */
async function applyRetention(ops: R2OpsBucket, now: Date): Promise<void> {
  try {
    const objects = await ops.list(DB_BACKUP_PREFIX);
    const expired = selectExpiredBackups(objects.map((o) => o.key), now);
    for (const key of expired) await ops.deleteObject(key);
    if (expired.length) console.log(`[worker] db-backup: pruned ${expired.length} backup(s) past ${RETENTION_DAYS}d retention`);
  } catch (e) {
    const msg = sanitizeError(e);
    console.error("[worker] db-backup retention failed (the backup itself is fine):", msg);
    if (process.env.SENTRY_DSN) Sentry.captureException(new Error(`db-backup retention failed: ${msg}`));
  }
}

/**
 * #794 ③ — append one row per attempt so "did last night's backup succeed?" has an
 * answer that survives the process. Recording is best-effort BY DESIGN: a DB that
 * refuses this insert must not turn a successful upload into a failed backup. The
 * failure is loud in logs/Sentry, and the panel's own staleness check is what
 * notices a run that never got recorded.
 */
async function recordRun(row: {
  status: "succeeded" | "failed";
  trigger: BackupTrigger;
  credentialMode: "isolated" | "shared";
  startedAt: Date;
  finishedAt: Date;
  key?: string;
  sizeBytes?: number;
  error?: string;
}): Promise<void> {
  try {
    await runAsSystem("db-backup", () =>
      prisma.backupRun.create({
        data: {
          status: row.status,
          trigger: row.trigger,
          credentialMode: row.credentialMode,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          key: row.key ?? null,
          sizeBytes: row.sizeBytes === undefined ? null : BigInt(row.sizeBytes),
          durationMs: row.finishedAt.getTime() - row.startedAt.getTime(),
          error: row.error ?? null,
        },
      }),
    );
  } catch (e) {
    const msg = sanitizeError(e);
    console.error("[worker] db-backup: could not record BackupRun:", msg);
    if (process.env.SENTRY_DSN) Sentry.captureException(new Error(`db-backup record failed: ${msg}`));
  }
}

/**
 * Why nothing was attempted (judge r1 P1-2). The distinction is load-bearing for the
 * cron entrypoint: `no-storage-target` / `no-database-url` are CONFIGURATION FAILURES
 * for a service whose only job is to back up (a green "skipped" there would mean no
 * dump, no failure, and no alarm), whereas `before-window` / `reentrant` are benign.
 */
export type BackupSkipKind = "no-storage-target" | "no-database-url" | "before-window" | "reentrant";

export type BackupOutcome =
  | { outcome: "skipped"; kind: BackupSkipKind; reason: string }
  /** today's key already exists — the exactly-once guard did its job */
  | { outcome: "already-done"; key: string }
  | { outcome: "succeeded"; key: string; sizeBytes: number; durationMs: number }
  | { outcome: "failed"; error: string };

let backingUp = false; // re-entrancy guard — same pattern as the reap() flag

/**
 * Run one backup attempt to completion and report what happened. Shared by BOTH
 * triggers (Railway cron via backup-cron.ts, and the legacy worker timer) so the
 * two paths cannot drift into two different backup behaviours — the only thing
 * that differs is who calls it and whether the KL window is checked.
 *
 * Never throws: the caller decides what a failure means (the cron entrypoint
 * exits non-zero so the scheduler shows a red run; the timer path just logs).
 */
export async function runBackupOnce(opts: { trigger: BackupTrigger; checkWindow: boolean }): Promise<BackupOutcome> {
  if (backingUp) return { outcome: "skipped", kind: "reentrant", reason: "another backup is already running" };
  backingUp = true;
  const startedAt = new Date();
  let credentialMode: "isolated" | "shared" = "shared";
  let key = "";
  try {
    const ops = createOpsBucket(); // null in local/dev (STORAGE_DRIVER !== r2) → no-op
    if (!ops) return { outcome: "skipped", kind: "no-storage-target", reason: "STORAGE_DRIVER is not r2 — no backup target" };
    credentialMode = ops.credentialMode;
    const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
    if (!databaseUrl) return { outcome: "skipped", kind: "no-database-url", reason: "DATABASE_URL is not set" };
    if (opts.checkWindow && !isBackupWindow(startedAt)) {
      return { outcome: "skipped", kind: "before-window", reason: "before the 03:00 Asia/Kuala_Lumpur window" };
    }
    key = backupKeyFor(startedAt);
    // Cheap fast-path so the common (non-racing) case skips the dump entirely. It is NOT
    // the guarantee — the atomic put-if-absent below is (judge r1 P1-3).
    if (await ops.exists(key)) return { outcome: "already-done", key };
    console.log(`[worker] db-backup: starting ${key}`);
    const { created, sizeBytes } = await dumpAndUpload(ops, key, databaseUrl);
    if (!created) {
      // Another trigger (worker timer vs. Railway cron) wrote today's key between our
      // exists() check and our put. The store settled it atomically; we record nothing.
      console.log(`[worker] db-backup: ${key} already written by a concurrent trigger — no duplicate row`);
      return { outcome: "already-done", key };
    }
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    console.log(`[worker] db-backup: uploaded ${key} (${sizeBytes} bytes, ${Math.round(durationMs / 1000)}s, ${credentialMode} credential)`);
    await recordRun({ status: "succeeded", trigger: opts.trigger, credentialMode, startedAt, finishedAt, key, sizeBytes });
    await applyRetention(ops, finishedAt);
    return { outcome: "succeeded", key, sizeBytes, durationMs };
  } catch (e) {
    // fail-soft: a failed night retries on the next fire (key still absent)
    const msg = sanitizeError(e);
    console.error("[worker] db-backup failed:", msg);
    if (process.env.SENTRY_DSN) Sentry.captureException(new Error(`db-backup failed: ${msg}`));
    await recordRun({
      status: "failed",
      trigger: opts.trigger,
      credentialMode,
      startedAt,
      finishedAt: new Date(),
      key: key || undefined,
      error: msg,
    });
    return { outcome: "failed", error: msg };
  } finally {
    backingUp = false;
  }
}

/**
 * Called from the worker's existing 5-minute timer alongside reap(). Fail-soft
 * by contract: any error is sanitized, logged, captured — never thrown.
 *
 * #794 ② — a no-op when BACKUP_TRIGGER=cron. The gate lives HERE rather than at
 * the call site in index.ts on purpose: "who triggers the backup" is one fact, and
 * it belongs in the module that owns the backup, not duplicated into whichever
 * loops happen to call it.
 */
export async function maybeRunNightlyBackup(): Promise<void> {
  if (backupTriggerMode() === "cron") return; // Railway cron owns the trigger
  await runBackupOnce({ trigger: "worker-timer", checkWindow: true });
}
