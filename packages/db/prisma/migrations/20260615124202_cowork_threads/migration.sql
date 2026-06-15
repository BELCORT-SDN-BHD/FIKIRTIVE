-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'AGENT');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('TEXT', 'PLAN', 'GEN_CARD', 'GEN_RESULT', 'DENIAL', 'TURN_ERROR');

-- AlterTable
ALTER TABLE "GenJob" ADD COLUMN     "threadId" TEXT;

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "role" "ChatRole" NOT NULL,
    "kind" "ChatMessageKind" NOT NULL,
    "seq" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "genJobId" TEXT,
    "sourceGenerationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- (ChatThread live-thread index is the PARTIAL index at the bottom of this file; the full
--  (projectId, ownerId, updatedAt) index is intentionally omitted — the partial covers it.)

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_seq_idx" ON "ChatMessage"("threadId", "seq");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- thread list reads only live threads (partial index, matching the repo idiom)
CREATE INDEX IF NOT EXISTS "ChatThread_project_live_idx"
ON "ChatThread"("projectId", "ownerId", "updatedAt") WHERE "deletedAt" IS NULL;
