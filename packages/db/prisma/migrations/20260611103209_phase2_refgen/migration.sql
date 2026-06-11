-- CreateEnum
CREATE TYPE "GenStatus" AS ENUM ('QUEUED', 'GENERATING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "AssetSource" ADD VALUE 'GENERATED';

-- CreateTable
CREATE TABLE "RefGenJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "entityId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'seedream',
    "count" INTEGER NOT NULL,
    "status" "GenStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT NOT NULL DEFAULT '',
    "queueJobId" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefGenJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefGenJob_entityId_createdAt_idx" ON "RefGenJob"("entityId", "createdAt");

-- CreateIndex
CREATE INDEX "RefGenJob_status_updatedAt_idx" ON "RefGenJob"("status", "updatedAt");
