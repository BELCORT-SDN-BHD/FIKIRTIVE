-- G7: autonomy mode enum
CREATE TYPE "AdsAutonomy" AS ENUM ('ASK', 'AUTO');

-- G7: add autonomy/kill-switch/canWrite columns to MetaConnection
ALTER TABLE "MetaConnection" ADD COLUMN "adsAutonomy" "AdsAutonomy" NOT NULL DEFAULT 'ASK';
ALTER TABLE "MetaConnection" ADD COLUMN "adsWritesPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MetaConnection" ADD COLUMN "canWrite" BOOLEAN NOT NULL DEFAULT false;

-- G7: add ACTION_CARD to ChatMessageKind
ALTER TYPE "ChatMessageKind" ADD VALUE 'ACTION_CARD';

-- G7: execution-idempotency table for Otto ad-write steps
CREATE TABLE "MetaActionExecution" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "appliedValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaActionExecution_pkey" PRIMARY KEY ("id")
);

-- G7: all-status partial-unique index (Prisma can't express this; hand-written)
CREATE UNIQUE INDEX "MetaActionExecution_step_once"
  ON "MetaActionExecution" ("ownerId", "cardId", "stepIndex");
