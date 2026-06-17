-- AlterTable (additive: NOT NULL with a default backfills existing rows safely)
ALTER TABLE "User" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'viewer';

-- Founder seed PART (a): one-time backfill so the EXISTING founder row + any live
-- session is super-admin immediately (else the founder is stuck at default 'viewer'
-- until re-sign-in). Reads the SAME dedicated env as the signIn-event upsert (PART b,
-- Task 4). FOUNDER_ADMIN_EMAILS is comma-separated; psql can't read process env, so
-- this migration backfills the KNOWN founder email literal. Edit the IN-list to your
-- FOUNDER_ADMIN_EMAILS value before applying. Lowercased compare mirrors allowed().
UPDATE "User" SET "role" = 'super-admin'
  WHERE lower("email") IN ('tools@belcort.com');
