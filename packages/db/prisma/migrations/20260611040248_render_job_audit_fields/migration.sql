-- DropIndex
DROP INDEX "RenderJob_status_idx";

-- AlterTable
ALTER TABLE "RenderJob" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "queueJobId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RenderJob_status_updatedAt_idx" ON "RenderJob"("status", "updatedAt");
