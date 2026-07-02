-- Additive: whole-clip reference video source for a video GenJob. Nullable, no backfill.
ALTER TABLE "GenJob" ADD COLUMN IF NOT EXISTS "referenceVideoGenerationId" TEXT;
