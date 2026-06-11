-- CreateEnum
CREATE TYPE "GenKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "GenJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "projectId" TEXT NOT NULL,
    "shotId" TEXT,
    "prompt" TEXT NOT NULL,
    "entityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" "GenKind" NOT NULL DEFAULT 'IMAGE',
    "model" TEXT NOT NULL DEFAULT 'seedream',
    "count" INTEGER NOT NULL DEFAULT 1,
    "status" "GenStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "generationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT NOT NULL DEFAULT '',
    "queueJobId" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenJob_projectId_createdAt_idx" ON "GenJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "GenJob_status_updatedAt_idx" ON "GenJob"("status", "updatedAt");
