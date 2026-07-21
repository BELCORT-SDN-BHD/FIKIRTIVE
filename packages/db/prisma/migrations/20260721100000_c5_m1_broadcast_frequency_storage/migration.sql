-- C5-M1 (2026-07-21): additive-only broadcast/frequency storage.
-- docs/superpowers/specs/2026-07-21-c5-broadcast-eligibility-physical-contract.md §5.
-- Adds three new owner-scoped carriers only — BroadcastRun, BroadcastAudienceMember,
-- ContactSendFrequencyEvent — plus two additive unique constraints on existing tables so those
-- carriers can carry composite tenant-qualified FKs: Campaign_id_ownerId_key (same pattern as
-- PR #375's Membership_id_orgId_key) for BroadcastRun.campaignId, and
-- ContactIdentity_id_contactId_ownerId_key (review-driven P2-1 hardening beyond spec §5.3's
-- shape) so BroadcastAudienceMember's contactIdentityId FK is bound to its own contactId, not
-- just ownerId — Postgres now rejects a member row pairing one contact with a different
-- contact's identity. No existing table's columns, rows, or behavior change otherwise. No
-- merged suppression/blocklist table. Every statement below is additive-only (new tables / new
-- indexes / new foreign keys); nothing here removes a table, a column, or any data.

BEGIN;

-- CreateTable
CREATE TABLE "BroadcastRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelScopeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "campaignId" TEXT,
    "templateVersionId" TEXT,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audienceRevision" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "creationIdempotencyKey" TEXT NOT NULL,
    "frozenAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastAudienceMember" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "broadcastRunId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactIdentityId" TEXT NOT NULL,
    "audienceRevision" INTEGER NOT NULL,
    "eligibilityVerdictJson" JSONB NOT NULL,
    "verdictHash" TEXT NOT NULL,
    "includedByMerchant" BOOLEAN NOT NULL,
    "sendState" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastAudienceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSendFrequencyEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purposeClass" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sendRef" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6),
    "countedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactSendFrequencyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BroadcastRun_owner_status_created_idx" ON "BroadcastRun"("ownerId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "BroadcastRun_owner_campaign_created_idx" ON "BroadcastRun"("ownerId", "campaignId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRun_id_ownerId_key" ON "BroadcastRun"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRun_ownerId_creationIdempotencyKey_key" ON "BroadcastRun"("ownerId", "creationIdempotencyKey");

-- CreateIndex
CREATE INDEX "BroadcastAudienceMember_owner_run_state_idx" ON "BroadcastAudienceMember"("ownerId", "broadcastRunId", "sendState", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastAudienceMember_id_ownerId_key" ON "BroadcastAudienceMember"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastAudienceMember_owner_run_identity_key" ON "BroadcastAudienceMember"("ownerId", "broadcastRunId", "contactIdentityId");

-- CreateIndex
CREATE INDEX "ContactSendFrequencyEvent_window_idx" ON "ContactSendFrequencyEvent"("ownerId", "contactId", "channel", "purposeClass", "countedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactSendFrequencyEvent_ownerId_idempotencyKey_key" ON "ContactSendFrequencyEvent"("ownerId", "idempotencyKey");

-- CreateIndex: additive-only, required by BroadcastRun's composite tenant FK to Campaign
-- (same pattern as PR #375's Membership_id_orgId_key). id is already Campaign's primary key,
-- so (id, ownerId) is unique by construction — this cannot fail against existing rows.
CREATE UNIQUE INDEX "Campaign_id_ownerId_key" ON "Campaign"("id", "ownerId");

-- CreateIndex: review-driven (P2-1), additive-only. Binds an identity to its owning contact so
-- BroadcastAudienceMember's contactIdentity FK below can be widened to a triple key and reject
-- any (contactId, contactIdentityId) mismatch at the DB layer. id is already ContactIdentity's
-- primary key, so (id, contactId, ownerId) is unique by construction — cannot fail against
-- existing rows.
CREATE UNIQUE INDEX "ContactIdentity_id_contactId_ownerId_key" ON "ContactIdentity"("id", "contactId", "ownerId");

-- AddForeignKey
ALTER TABLE "BroadcastRun" ADD CONSTRAINT "BroadcastRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRun" ADD CONSTRAINT "BroadcastRun_channelScopeId_ownerId_channel_fkey" FOREIGN KEY ("channelScopeId", "ownerId", "channel") REFERENCES "ChannelScope"("id", "ownerId", "channel") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRun" ADD CONSTRAINT "BroadcastRun_campaignId_ownerId_fkey" FOREIGN KEY ("campaignId", "ownerId") REFERENCES "Campaign"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRun" ADD CONSTRAINT "BroadcastRun_templateVersionId_ownerId_fkey" FOREIGN KEY ("templateVersionId", "ownerId") REFERENCES "CustomerMessageTemplateVersion"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRun" ADD CONSTRAINT "BroadcastRun_createdByMembershipId_ownerId_fkey" FOREIGN KEY ("createdByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastAudienceMember" ADD CONSTRAINT "BroadcastAudienceMember_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastAudienceMember" ADD CONSTRAINT "BroadcastAudienceMember_broadcastRunId_ownerId_fkey" FOREIGN KEY ("broadcastRunId", "ownerId") REFERENCES "BroadcastRun"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastAudienceMember" ADD CONSTRAINT "BroadcastAudienceMember_contactId_ownerId_fkey" FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: review-driven (P2-1), triple-column FK (not just contactIdentityId+ownerId) so
-- a member row's contactIdentityId must belong to THIS row's own contactId — Postgres rejects a
-- mis-pairing (e.g. contact A with contact B's identity) instead of silently accepting it.
ALTER TABLE "BroadcastAudienceMember" ADD CONSTRAINT "BroadcastAudienceMember_identity_contact_owner_fkey" FOREIGN KEY ("contactIdentityId", "contactId", "ownerId") REFERENCES "ContactIdentity"("id", "contactId", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactSendFrequencyEvent" ADD CONSTRAINT "ContactSendFrequencyEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactSendFrequencyEvent" ADD CONSTRAINT "ContactSendFrequencyEvent_contactId_ownerId_fkey" FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
