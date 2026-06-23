-- Additive: add ottoVerdictAt column to GenJob for at-most-once Otto verdict claim.
-- Nullable — existing rows have none. Worker claims by updateMany(where: ottoVerdictAt IS NULL).
ALTER TABLE "GenJob" ADD COLUMN "ottoVerdictAt" TIMESTAMP(3);
