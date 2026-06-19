-- CreateEnum
CREATE TYPE "CreditTxnKind" AS ENUM ('GRANT', 'RESERVE', 'SETTLE', 'REFUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "CreditTxnSource" AS ENUM ('ADMIN', 'BETA', 'PROMO', 'PURCHASE', 'SYSTEM');

-- CreateTable
CREATE TABLE "CreditAccount" (
    "orgId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "balanceDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL,
    "kind" "CreditTxnKind" NOT NULL,
    "source" "CreditTxnSource" NOT NULL DEFAULT 'SYSTEM',
    "reason" TEXT NOT NULL DEFAULT '',
    "refId" TEXT,
    "stripePaymentIntentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditLedger_orgId_createdAt_idx" ON "CreditLedger"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_orgId_idempotencyKey_key" ON "CreditLedger"("orgId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly-once guard for worker writes (Prisma can't express a partial unique):
-- at most one RESERVE, one SETTLE, one REFUND per job ever → resume/redelivery no-ops.
-- IF NOT EXISTS so a partial-apply / migrate-resolve re-run doesn't abort on this line.
CREATE UNIQUE INDEX IF NOT EXISTS "CreditLedger_ref_kind_once" ON "CreditLedger"("orgId","refId","kind") WHERE "refId" IS NOT NULL;

-- Finalizer mutual-exclusion (Prisma can't express the IN predicate): at most ONE of
-- {SETTLE, REFUND} per job, ever. Makes settle/refund DB-enforced mutually exclusive —
-- a SETTLE racing a REFUND (e.g. a >stale-cutoff job that finally commits while a
-- duplicate delivery refunds) loses on this index with P2002 and no-ops, so reserved is
-- never double-released and balance is never over-credited.
CREATE UNIQUE INDEX IF NOT EXISTS "CreditLedger_finalizer_once" ON "CreditLedger"("orgId","refId") WHERE "refId" IS NOT NULL AND "kind" IN ('SETTLE','REFUND');

-- Seed the founder credit account with a large BETA grant so the fail-closed reserve
-- can never lock the founder out (founder = effectively unlimited during beta).
INSERT INTO "CreditAccount" ("orgId","balance","reserved","updatedAt")
VALUES ('founder', 100000000, 0, CURRENT_TIMESTAMP) ON CONFLICT ("orgId") DO NOTHING;
INSERT INTO "CreditLedger" ("id","orgId","balanceDelta","reservedDelta","kind","source","reason","idempotencyKey","createdAt")
VALUES ('seedfounderbeta00000000001','founder',100000000,0,'GRANT','BETA','founder beta seed','grant:founder-seed',CURRENT_TIMESTAMP)
ON CONFLICT ("orgId","idempotencyKey") DO NOTHING;
