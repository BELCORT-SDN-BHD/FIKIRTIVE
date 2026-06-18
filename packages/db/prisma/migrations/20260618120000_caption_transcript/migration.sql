-- CreateTable
CREATE TABLE "CaptionJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "queueJobId" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "contentHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cuesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptionJob_projectId_createdAt_idx" ON "CaptionJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CaptionJob_status_updatedAt_idx" ON "CaptionJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_contentHash_model_key" ON "Transcript"("contentHash", "model");

