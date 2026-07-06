-- Codex-style project/thread controls.
-- Nullable timestamps keep existing rows unchanged and let pinned items sort first.
ALTER TABLE "Project" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ChatThread" ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "Project_owner_pinned_idx" ON "Project"("ownerId", "pinnedAt", "createdAt");
CREATE INDEX "ChatThread_owner_pinned_idx" ON "ChatThread"("ownerId", "pinnedAt", "updatedAt");
