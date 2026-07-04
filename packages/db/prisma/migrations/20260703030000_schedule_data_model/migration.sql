-- Schedule data model (蓝图 P1½「排期 + Routine」, UI-first slice). Additive only: three
-- new tables + their indexes/FKs, and one hand-appended partial-unique index Prisma can't
-- model. No DROP / no ALTER-that-drops / no changes to any existing table. See
-- docs/superpowers/specs/2026-07-03-schedule-uifirst-slice-design.md §三. $0 path — media
-- reuses already-paid Generation rows; no spend-path file is touched.

-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "metaTargetId" TEXT,
    "caption" TEXT NOT NULL,
    "firstComment" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "scheduledTz" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishMode" TEXT NOT NULL DEFAULT 'AUTO',
    "source" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "metaPostId" TEXT,
    "lastError" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledPostMedia" (
    "id" TEXT NOT NULL,
    "scheduledPostId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ScheduledPostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "scheduledPostId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "metaPostId" TEXT,
    "error" TEXT,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: scheduler polling (slice 2) reads due posts by (status, scheduledAt).
CREATE INDEX "ScheduledPost_status_scheduledAt_idx" ON "ScheduledPost"("status", "scheduledAt");

-- CreateIndex: list / calendar queries for one owner, time-ordered.
CREATE INDEX "ScheduledPost_ownerId_scheduledAt_idx" ON "ScheduledPost"("ownerId", "scheduledAt");

-- CreateIndex: carousel order is unique per post (single image = 1 row, carousel = 2..10).
CREATE UNIQUE INDEX "ScheduledPostMedia_scheduledPostId_position_key" ON "ScheduledPostMedia"("scheduledPostId", "position");

-- CreateIndex
CREATE INDEX "PublishAttempt_scheduledPostId_idx" ON "PublishAttempt"("scheduledPostId");

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPostMedia" ADD CONSTRAINT "ScheduledPostMedia_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Anti-double-publish backstop (slice 2's publish worker uses it). At most ONE in-flight
-- attempt per post: before publishing, the worker inserts PublishAttempt(state='APPLYING');
-- this partial UNIQUE index rejects a second racing worker's insert (P2002 → it skips),
-- mirroring the gen worker's fail-closed claim. Partial/conditional — Prisma can't model a
-- WHERE clause, so it's hand-appended (same technique as BrandRecord's live nameKey index,
-- 20260702114921, and refgen's attach index, 20260703000000). 'APPLYING' is a constant, so
-- the predicate is IMMUTABLE and valid in an index. Additive-only: no drops, no type changes.
CREATE UNIQUE INDEX "PublishAttempt_one_applying_per_post"
  ON "PublishAttempt"("scheduledPostId")
  WHERE "state" = 'APPLYING';
