-- cowork knowledge base (Phase 0B): per-(family × mode) prompt directive +
-- founder-editable admin panel, plus a revision history for rollback. Standard
-- Prisma table create (no data backfill) — author-and-defer; apply with
-- `prisma migrate dev` (local) / `prisma migrate deploy` (Neon).

-- CreateTable
CREATE TABLE "ModelDirective" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "family" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "directive" TEXT NOT NULL DEFAULT '',
    "rules" JSONB,
    "notes" TEXT NOT NULL DEFAULT '',
    "confidence" TEXT NOT NULL DEFAULT 'untested',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'research',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelDirectiveRevision" (
    "id" TEXT NOT NULL,
    "directiveId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "directive" TEXT NOT NULL,
    "rules" JSONB,
    "confidence" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelDirectiveRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelDirective_ownerId_family_mode_key" ON "ModelDirective"("ownerId", "family", "mode");

-- CreateIndex
CREATE INDEX "ModelDirective_ownerId_family_idx" ON "ModelDirective"("ownerId", "family");

-- CreateIndex
CREATE INDEX "ModelDirectiveRevision_directiveId_createdAt_idx" ON "ModelDirectiveRevision"("directiveId", "createdAt");

-- AddForeignKey
ALTER TABLE "ModelDirectiveRevision" ADD CONSTRAINT "ModelDirectiveRevision_directiveId_fkey" FOREIGN KEY ("directiveId") REFERENCES "ModelDirective"("id") ON DELETE CASCADE ON UPDATE CASCADE;
