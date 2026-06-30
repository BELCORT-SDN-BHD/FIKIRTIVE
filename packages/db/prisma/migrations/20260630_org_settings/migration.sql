-- Additive only: owner preferences blob. NULL = defaults.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "settings" JSONB;
