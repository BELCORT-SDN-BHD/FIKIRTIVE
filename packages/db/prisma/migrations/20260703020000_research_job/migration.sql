-- CreateTable: ResearchJob — Otto deep-research job (research S3). The approve action
-- creates one row + enqueues it; the worker (Task 2) runs the metered loop. Additive only.
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "reservedCredits" INTEGER,
    "actualCredits" INTEGER,
    "error" TEXT,
    "queueJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: cardId lookup (double-approve P2002 recovery reads the existing job by key,
-- but the worker + reconcile paths scope by cardId).
CREATE INDEX "ResearchJob_cardId_idx" ON "ResearchJob"("cardId");

-- CreateIndex: a research job must be approved EXACTLY ONCE EVER for a given card — not
-- just once while active. Mirrors GenJob's cowork once-EVER index (20260617000000): the
-- app guards the "research:<cardId>" key (approve's card-status check + existing-job read),
-- but that read is not atomic with the insert, so a TOCTOU race (double-click / replay)
-- could create — and later spend on — a second job. This all-status partial-unique index
-- closes that window for research keys ONLY (LIKE 'research:%'), so a second insert is
-- rejected at the DB regardless of the first job's status; approve catches P2002 and
-- returns the existing job id (idempotent). LIKE against a constant pattern is IMMUTABLE,
-- so it is valid in an index predicate.
CREATE UNIQUE INDEX "ResearchJob_research_idempotency_once" ON "ResearchJob"("ownerId", "idempotencyKey")
WHERE "idempotencyKey" LIKE 'research:%';

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
