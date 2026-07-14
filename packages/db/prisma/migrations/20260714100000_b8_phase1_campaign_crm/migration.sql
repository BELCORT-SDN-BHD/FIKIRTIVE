-- B8 一期 Campaign + CRM schema (frozen 2026-07-14).
-- ADDITIVE ONLY: five new owner-scoped tables, two nullable Campaign grouping FKs,
-- and one additive value on each of the existing ChatMessageKind / GenStatus enums.
-- No existing column is dropped, rewritten, or made more restrictive.

-- AddEnumValue
ALTER TYPE "ChatMessageKind" ADD VALUE IF NOT EXISTS 'CAMPAIGN_CARD';

-- W-3 control-plane ruling: cancellation is an honest terminal state, distinct from failure.
ALTER TYPE "GenStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "goal" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "utmBase" TEXT,
    "planJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSnapshot" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lifecycleStage" TEXT NOT NULL DEFAULT 'New',
    "source" TEXT NOT NULL,
    "firstTouchCampaignId" TEXT,
    "firstTouchAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "marketingConsent" TEXT NOT NULL DEFAULT 'unknown',
    "consentSource" TEXT,
    "consentAt" TIMESTAMP(3),
    "doNotDisturb" BOOLEAN NOT NULL DEFAULT false,
    "totalOrdersMyr" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactIdentity" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContactIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "rulesJson" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- AddColumn: nullable Campaign grouping; existing rows remain valid without backfill.
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

-- CreateIndex: every new tenant model has a leading ownerId list index including deletedAt.
CREATE INDEX "Campaign_ownerId_status_deletedAt_idx" ON "Campaign"("ownerId", "status", "deletedAt");
CREATE INDEX "TrendSnapshot_ownerId_capturedAt_deletedAt_idx" ON "TrendSnapshot"("ownerId", "capturedAt", "deletedAt");
CREATE INDEX "Contact_ownerId_lifecycleStage_deletedAt_idx" ON "Contact"("ownerId", "lifecycleStage", "deletedAt");
CREATE INDEX "ContactIdentity_ownerId_contactId_deletedAt_idx" ON "ContactIdentity"("ownerId", "contactId", "deletedAt");
CREATE INDEX "Segment_ownerId_kind_deletedAt_idx" ON "Segment"("ownerId", "kind", "deletedAt");

-- ContactIdentity is the deterministic find-or-create key across channel arrivals.
CREATE UNIQUE INDEX "ContactIdentity_ownerId_channel_externalId_key"
    ON "ContactIdentity"("ownerId", "channel", "externalId");

-- Campaign grouping indexes keep owner-scoped content/post lookups on the tenant seam.
CREATE INDEX "Generation_ownerId_campaignId_deletedAt_idx" ON "Generation"("ownerId", "campaignId", "deletedAt");
CREATE INDEX "ScheduledPost_ownerId_campaignId_deletedAt_idx" ON "ScheduledPost"("ownerId", "campaignId", "deletedAt");

-- AddForeignKey: tenant roots.
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactIdentity" ADD CONSTRAINT "ContactIdentity_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: B8 object links. Campaign removal never cascades into content, posts,
-- trends, or CRM attribution; the normal product operation is Campaign.deletedAt soft-delete.
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_firstTouchCampaignId_fkey"
    FOREIGN KEY ("firstTouchCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactIdentity" ADD CONSTRAINT "ContactIdentity_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
