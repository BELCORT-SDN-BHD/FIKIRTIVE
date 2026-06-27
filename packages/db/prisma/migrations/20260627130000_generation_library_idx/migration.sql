-- CreateIndex
CREATE INDEX "Generation_library_idx" ON "Generation"("ownerId", "projectId", "deletedAt", "createdAt", "id");
