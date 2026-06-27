-- AlterTable
ALTER TABLE "CanvasNode" ADD COLUMN "threadId" TEXT;

-- CreateIndex
CREATE INDEX "CanvasNode_ownerId_projectId_threadId_idx" ON "CanvasNode"("ownerId", "projectId", "threadId");
