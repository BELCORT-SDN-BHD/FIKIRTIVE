-- CreateTable
CREATE TABLE "CanvasNode" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "text" TEXT,
    "prompt" TEXT,
    "generationId" TEXT,
    "genJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'done',
    "sourceNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanvasNode_ownerId_projectId_idx" ON "CanvasNode"("ownerId", "projectId");
