/**
 * Nightly Postgres backup → R2 (MASTERPLAN P0-1②, verdict 7-1 = ③, founder-approved
 * 2026-07-07). Protects the credit ledger — the money truth — against a bad
 * migration or fat-fingered prod write (push-to-main auto-migrates prod).
 *
 * Trigger rule (deterministic, idempotent — NO new DB state):
 *   every 5-min tick, when current Asia/Kuala_Lumpur time >= 03:00 AND today's
 *   key `backups/db/fikirtive-<YYYY-MM-DD>.dump.gz` does NOT exist in R2, dump +
 *   upload. The key-exists HEAD check IS the exactly-once guard; a failed night
 *   self-heals on the next tick (key still absent → retry).
 *
 * The `backups/` prefix is deliberately OUTSIDE the u/<ownerId>/ content-addressed
 * scheme: it is an ops artifact, never served — the web /files route serves only
 * keys that pass keyOwnerMatches (u/<owner>/…), and parseStorageKey rejects
 * everything else, so a backup object is unreachable from any browser-facing path.
 *
 * #463: intentionally NO principal frame — this module makes zero Prisma calls (pg_dump to a
 * subprocess, bytes to R2), so there is nothing for an identity to scope. Do not flag it as a
 * missing system context.
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
import { createOpsBucket, type R2OpsBucket } from "@fikirtive/storage";
import { sanitizeError } from "./redact.js";

export const DB_BACKUP_PREFIX = "backups/db/";
export const RETENTION_DAYS = 30;
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

/* ---------------- runtime ---------------- */

async function dumpAndUpload(ops: R2OpsBucket, key: string, databaseUrl: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "db-backup-"));
  const file = path.join(dir, "dump.gz");
  try {
    // Connection ONLY via env (see pgEnvFromUrl). stderr is discarded on
    // purpose: libpq error text can name host/user — the exit-code summary
    // from sanitizeError is the only diagnostic we persist or log.
    const child = execa("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], {
      env: pgEnvFromUrl(databaseUrl),
      extendEnv: true, // keep PATH etc.
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
    await ops.putFile(key, file, "application/gzip");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function applyRetention(ops: R2OpsBucket, now: Date): Promise<void> {
  const objects = await ops.list(DB_BACKUP_PREFIX);
  const expired = selectExpiredBackups(objects.map((o) => o.key), now);
  for (const key of expired) await ops.deleteObject(key);
  if (expired.length) console.log(`[worker] db-backup: pruned ${expired.length} backup(s) past ${RETENTION_DAYS}d retention`);
}

let backingUp = false; // re-entrancy guard — same pattern as the reap() flag

/**
 * Called from the worker's existing 5-minute timer alongside reap(). Fail-soft
 * by contract: any error is sanitized, logged, captured — never thrown.
 */
export async function maybeRunNightlyBackup(): Promise<void> {
  if (backingUp) return;
  backingUp = true;
  try {
    const ops = createOpsBucket(); // null in local/dev (STORAGE_DRIVER !== r2) → no-op
    if (!ops) return;
    const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
    if (!databaseUrl) return; // index.ts already exits without it; belt-and-braces
    const now = new Date();
    if (!isBackupWindow(now)) return;
    const key = backupKeyFor(now);
    if (await ops.exists(key)) return; // exactly-once guard: today already backed up
    console.log(`[worker] db-backup: starting ${key}`);
    await dumpAndUpload(ops, key, databaseUrl);
    console.log(`[worker] db-backup: uploaded ${key}`);
    await applyRetention(ops, now);
  } catch (e) {
    // fail-soft: a failed night retries on the next >=03:00 tick (key still absent)
    const msg = sanitizeError(e);
    console.error("[worker] db-backup failed:", msg);
    if (process.env.SENTRY_DSN) Sentry.captureException(new Error(`db-backup failed: ${msg}`));
  } finally {
    backingUp = false;
  }
}
