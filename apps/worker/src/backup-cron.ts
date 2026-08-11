/**
 * #794 ② — the nightly DB backup as a ONE-SHOT process, for Railway cron.
 *
 * WHY THIS EXISTS. The backup used to hang off the worker's own 5-minute timer.
 * That made the most important safety net in the system depend on the least
 * reliable thing in it: a long-lived process that also runs generation, publish
 * and render jobs. If that process was crash-looping, restarting, OOM-killed or
 * mid-deploy at 03:00 Asia/Kuala_Lumpur, the night's backup simply did not
 * happen — and nothing anywhere said so. A scheduler with its own run history
 * cannot silently skip a night; the worker's timer could, and only the day you
 * needed the backup would you find out.
 *
 * SHAPE. Railway runs a service on a cron schedule by starting the container and
 * waiting for it to exit; the exit code is the run's verdict. So this entrypoint:
 *   - runs exactly one attempt and exits (no timer, no queue, no server),
 *   - does NOT re-check the 03:00 window — the cron expression IS the schedule,
 *     and a second window check would silently swallow a founder's manual run,
 *   - KEEPS the exactly-once key check, so re-running it on a day that already
 *     has a backup is a cheap no-op instead of a duplicate dump,
 *   - exits 1 only on a real failure, so a red run in Railway means something.
 *
 * Deploy: docs/runbooks/db-backup.md §"Railway cron".
 * Manual: `node apps/worker/dist/backup-cron.js` inside the worker image.
 */
import * as Sentry from "@sentry/node";
import { prisma } from "@fikirtive/db";
import { runBackupOnce, backupTriggerMode } from "./db-backup.js";

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || "production" });
}

async function main(): Promise<number> {
  if (backupTriggerMode() !== "cron") {
    // Loud, not fatal. Running the cron entrypoint while the worker timer still owns
    // the trigger means both could fire; the key check makes that harmless, but the
    // configuration is wrong and should be visible in the run log.
    console.warn(
      "[backup-cron] BACKUP_TRIGGER is not 'cron' — the worker's 5-minute timer still owns the trigger. Set BACKUP_TRIGGER=cron on the worker service.",
    );
  }
  const result = await runBackupOnce({ trigger: "cron", checkWindow: false });
  switch (result.outcome) {
    case "succeeded":
      console.log(`[backup-cron] ok: ${result.key} (${result.sizeBytes} bytes in ${Math.round(result.durationMs / 1000)}s)`);
      return 0;
    case "already-done":
      console.log(`[backup-cron] ok: ${result.key} already exists — nothing to do`);
      return 0;
    case "skipped":
      // Not configured for backups (local/dev, or no DATABASE_URL). Not a failure:
      // a red cron run should mean "the backup broke", never "this isn't prod".
      console.log(`[backup-cron] skipped: ${result.reason}`);
      return 0;
    case "failed":
      console.error(`[backup-cron] FAILED: ${result.error}`);
      return 1;
  }
}

main()
  .then(async (code) => {
    await prisma.$disconnect().catch(() => {});
    if (process.env.SENTRY_DSN) await Sentry.flush(5000).catch(() => {});
    process.exit(code);
  })
  .catch(async (e) => {
    // runBackupOnce never throws; this catches anything above it (e.g. Prisma init).
    console.error("[backup-cron] FAILED before the backup could run:", e instanceof Error ? e.message : String(e));
    if (process.env.SENTRY_DSN) await Sentry.flush(5000).catch(() => {});
    process.exit(1);
  });
