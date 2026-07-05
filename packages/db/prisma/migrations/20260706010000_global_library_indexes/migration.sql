-- Owner-global Library keyset: supports newest-first generation history across
-- every project/campaign without filtering by projectId.
CREATE INDEX "Generation_owner_library_idx" ON "Generation"("ownerId", "deletedAt", "createdAt", "id");
