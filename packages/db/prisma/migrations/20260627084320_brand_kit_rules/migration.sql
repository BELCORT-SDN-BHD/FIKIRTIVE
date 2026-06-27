-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT,
    "colorsJson" JSONB,
    "fonts" TEXT[],
    "tone" TEXT,
    "styleGuide" TEXT,
    "logoAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandRule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandKit_ownerId_brandId_idx" ON "BrandKit"("ownerId", "brandId");

-- CreateIndex
CREATE INDEX "BrandRule_ownerId_brandId_active_idx" ON "BrandRule"("ownerId", "brandId", "active");

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandRule" ADD CONSTRAINT "BrandRule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
