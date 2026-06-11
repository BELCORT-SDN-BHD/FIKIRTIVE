-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RENDERING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "projectId" TEXT NOT NULL,
    "editJson" JSONB NOT NULL,
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputAssetId" TEXT,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenderJob_projectId_createdAt_idx" ON "RenderJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RenderJob_status_idx" ON "RenderJob"("status");
