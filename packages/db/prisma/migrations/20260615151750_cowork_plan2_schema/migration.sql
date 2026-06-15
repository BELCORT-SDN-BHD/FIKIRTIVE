-- AlterTable
ALTER TABLE "Generation" ADD COLUMN "threadId" TEXT;

-- one durable result/error message per cowork GenJob (worker is the sole writer; this
-- turns its at-least-once resume attempts into effectively-once — swallow P2002 in the writer)
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessage_genjob_result_uniq"
ON "ChatMessage"("genJobId") WHERE "genJobId" IS NOT NULL AND "kind" IN ('GEN_RESULT', 'TURN_ERROR');
