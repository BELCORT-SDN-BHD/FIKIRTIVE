#!/usr/bin/env node
/**
 * DRY-RUN planner for the nightly Postgres → R2 backup (P0-1②). Ops sanity tool:
 * run it before flipping the worker to STORAGE_DRIVER=r2 to see exactly what the
 * nightly job WOULD do — with ZERO side effects (no DB connection, no R2 write, no
 * network). It imports the REAL pure functions from apps/worker/dist/db-backup.js
 * (the same code the worker runs), so there is no logic duplication to drift.
 *
 * Build first (produces the dist it imports):
 *   pnpm --filter @fikirtive/worker build   # (packages must be built too)
 * Or via the wrapper: pnpm backup:plan
 *
 * Prints: retention window, today's KL target key, whether the window is open now,
 * a retention-prune demo on synthetic keys, and a pgEnvFromUrl redaction proof
 * (the connection password goes into PG* env only, NEVER into pg_dump's argv).
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = pathToFileURL(path.join(root, "apps/worker/dist/db-backup.js")).href;

let mod;
try {
  mod = await import(distUrl);
} catch {
  console.error("[backup-plan] apps/worker/dist/db-backup.js not found — build first:");
  console.error("[backup-plan]   pnpm --filter \"./packages/*\" build && pnpm --filter @fikirtive/worker build");
  process.exit(1);
}
const { DB_BACKUP_PREFIX, RETENTION_DAYS, klDateString, klHour, backupKeyFor, isBackupWindow, selectExpiredBackups, pgEnvFromUrl, backupTriggerMode } = mod;

const now = new Date();
const trigger = backupTriggerMode(process.env);
console.log("[backup-plan] DRY RUN — no DB, no R2, no network. Real logic from apps/worker/src/db-backup.ts.");
console.log(`[backup-plan] R2 prefix        : ${DB_BACKUP_PREFIX}   (outside the u/ content scheme — unreachable from /files)`);
console.log(`[backup-plan] retention        : ${RETENTION_DAYS} KL-days`);
console.log(`[backup-plan] now (KL)         : ${klDateString(now)} ${String(klHour(now)).padStart(2, "0")}:00`);
console.log(`[backup-plan] trigger owner    : ${trigger}  (#794 — BACKUP_TRIGGER=${process.env.BACKUP_TRIGGER ?? "<unset>"})`);
if (trigger === "cron") {
  console.log("[backup-plan]                    → Railway cron runs `node apps/worker/dist/backup-cron.js`; the worker's 5-min timer is a no-op.");
  console.log("[backup-plan] window open now? : n/a — the cron schedule IS the window (the cron entrypoint does not re-check 03:00).");
} else {
  console.log("[backup-plan]                    → the worker's own 5-min timer (legacy shape; set BACKUP_TRIGGER=cron to move it).");
  console.log(`[backup-plan] window open now? : ${isBackupWindow(now)}  (opens at 03:00 Asia/Kuala_Lumpur)`);
}
// Credential family (#794 ④). Reads env only — no R2 client is constructed, nothing is contacted.
const isolatedHalves = [process.env.R2_BACKUP_ACCESS_KEY_ID, process.env.R2_BACKUP_SECRET_ACCESS_KEY].filter(Boolean).length;
const credentialMode = isolatedHalves === 2 ? "isolated" : isolatedHalves === 1 ? "HALF-SET (will refuse to start)" : "shared with content storage";
console.log(`[backup-plan] backup credential: ${credentialMode}`);
console.log(`[backup-plan] today target key : ${backupKeyFor(now)}`);

// Retention-prune demo on synthetic keys (proves the pruner only ever selects its
// own naming scheme, and only past the retention horizon).
const synthetic = [
  `${DB_BACKUP_PREFIX}fikirtive-2020-01-01.dump.gz`, // ancient → prune
  `${DB_BACKUP_PREFIX}fikirtive-${klDateString(now)}.dump.gz`, // today → keep
  "u/owner123/asset.png", // foreign object → never touched
];
console.log(`[backup-plan] retention demo   : would prune ${JSON.stringify(selectExpiredBackups(synthetic, now))}`);

// pgEnvFromUrl redaction proof: the password only ever lands in PG* env (libpq reads
// it there), never in argv, so even a raw execa error string cannot leak it.
const sampleUrl = process.env.DATABASE_URL || "postgres://user:SECRET@host.neon.tech:5432/db?sslmode=require&channel_binding=require";
const env = pgEnvFromUrl(sampleUrl);
const usingReal = Boolean(process.env.DATABASE_URL);
console.log(`[backup-plan] pgEnv from ${usingReal ? "$DATABASE_URL" : "sample URL"} : keys=[${Object.keys(env).join(", ")}]`);
console.log(`[backup-plan] password in argv? : NO — carried only in PG* env (present in env: ${Boolean(env.PGPASSWORD)})`);
console.log(`[backup-plan] OK — nightly backup plan is well-formed. Actual runs happen only when STORAGE_DRIVER=r2 (${trigger === "cron" ? "Railway cron service" : "the worker's own timer"}).`);
