-- CreateTable
CREATE TABLE "BrandRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "kind" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BrandRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandRecord_ownerId_brandId_kind_deletedAt_idx" ON "BrandRecord"("ownerId", "brandId", "kind", "deletedAt");

-- AddForeignKey
ALTER TABLE "BrandRecord" ADD CONSTRAINT "BrandRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Upsert-by-name guard: one live record per owner+brand+kind+nameKey (soft-deleted rows don't block re-creation).
-- Partial/functional index — Prisma can't model it, so it's hand-appended (same pattern as BrandKit F5).
CREATE UNIQUE INDEX "BrandRecord_owner_brand_kind_namekey_live"
  ON "BrandRecord" ("ownerId", COALESCE("brandId", ''), "kind", "nameKey")
  WHERE "deletedAt" IS NULL;
