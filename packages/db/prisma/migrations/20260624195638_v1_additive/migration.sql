-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "CreditLedger" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "GenJob" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "ReferenceImage" ADD COLUMN     "brandId" TEXT;

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationBatch" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Memory_ownerId_brandId_deletedAt_idx" ON "Memory"("ownerId", "brandId", "deletedAt");

-- CreateIndex
CREATE INDEX "GenerationBatch_ownerId_projectId_deletedAt_idx" ON "GenerationBatch"("ownerId", "projectId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationBatch" ADD CONSTRAINT "GenerationBatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
