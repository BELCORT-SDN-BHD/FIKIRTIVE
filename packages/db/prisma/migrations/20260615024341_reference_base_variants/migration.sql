-- CreateEnum
CREATE TYPE "RefGenMode" AS ENUM ('REFSHEET', 'BASE', 'VARIANT');

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "baseAssetId" TEXT;

-- AlterTable
ALTER TABLE "GenJob" ADD COLUMN     "variantSel" JSONB;

-- AlterTable
ALTER TABLE "RefGenJob" ADD COLUMN     "mode" "RefGenMode" NOT NULL DEFAULT 'REFSHEET',
ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "ReferenceImage" ADD COLUMN     "variantId" TEXT;

-- CreateTable
CREATE TABLE "EntityVariant" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EntityVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityVariant_ownerId_deletedAt_idx" ON "EntityVariant"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "EntityVariant_entityId_deletedAt_idx" ON "EntityVariant"("entityId", "deletedAt");

-- CreateIndex
CREATE INDEX "ReferenceImage_entityId_variantId_deletedAt_idx" ON "ReferenceImage"("entityId", "variantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "EntityVariant" ADD CONSTRAINT "EntityVariant_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "EntityVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Handle uniqueness only among LIVE variants (frees a handle once soft-deleted).
CREATE UNIQUE INDEX "EntityVariant_entityId_handle_live"
  ON "EntityVariant" ("entityId", "handle") WHERE "deletedAt" IS NULL;

-- Backfill the base for existing entities: lowest-position live base-level ref.
-- Idempotent (only null baseAssetId), leaves ref-less entities null.
UPDATE "Entity" e
SET "baseAssetId" = (
  SELECT r."assetId" FROM "ReferenceImage" r
  WHERE r."entityId" = e."id" AND r."variantId" IS NULL AND r."deletedAt" IS NULL
  ORDER BY r."position" ASC LIMIT 1
)
WHERE e."deletedAt" IS NULL AND e."baseAssetId" IS NULL;
