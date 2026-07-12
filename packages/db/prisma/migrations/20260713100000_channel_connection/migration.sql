-- B0-30: generic channel-connection schema (harmony-01 §三 #5; MASTERPLAN P1½-2).
-- ADDITIVE ONLY — one new table + its indexes + FK; no data-loss DDL (destructive gate green).
-- Rollback: drop the "ChannelConnection" table (no other object references it — Meta stays on
-- MetaConnection until a later, separate migration chooses to move in).
-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_ownerId_idx" ON "ChannelConnection"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_ownerId_kind_externalId_key" ON "ChannelConnection"("ownerId", "kind", "externalId");

-- One DEFAULT connection per (owner, kind) — NODE-275 P1 fix. PostgreSQL UNIQUE treats NULLs as
-- distinct, so the three-column unique above CANNOT enforce the "a NULL externalId = the single
-- default connection" semantic the model promises: two (owner, kind, NULL) rows would both insert.
-- Partial UNIQUE closes it (repo idiom: PublishAttempt_one_applying_per_post,
-- GenJob_cowork_idempotency_once — raw SQL only; Prisma cannot model partial indexes, so this
-- index is documented in the schema.prisma model comment, not declared there).
CREATE UNIQUE INDEX "ChannelConnection_one_default_per_owner_kind"
  ON "ChannelConnection"("ownerId", "kind") WHERE "externalId" IS NULL;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
