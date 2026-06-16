-- AddColumn: soft pointer to a prior message in the same thread.
-- No FK / onDelete cascade — the server fetches the quoted message explicitly
-- and silently ignores invalid/deleted ids. No index (V1 never queries by it).
ALTER TABLE "ChatMessage" ADD COLUMN "replyToMessageId" TEXT;
