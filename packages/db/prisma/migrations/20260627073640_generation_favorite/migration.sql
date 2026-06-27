-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "favorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Generation_ownerId_favorite_deletedAt_idx" ON "Generation"("ownerId", "favorite", "deletedAt");
