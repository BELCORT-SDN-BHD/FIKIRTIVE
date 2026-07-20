BEGIN;

-- Fail closed before any DDL: the existing bare ContactIdentity.contact FK can contain a
-- cross-owner edge. The composite FK must not be installed over unreviewed historical data.
DO $c4b_m1_preflight$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "ContactIdentity" AS identity
        INNER JOIN "Contact" AS contact ON contact."id" = identity."contactId"
        WHERE identity."ownerId" <> contact."ownerId"
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'C4b-M1 blocked: cross-owner ContactIdentity -> Contact anomaly exists';
    END IF;
END
$c4b_m1_preflight$;

-- CreateTable
CREATE TABLE "CustomerConversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactIdentityId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assigneeMembershipId" TEXT,
    "automationState" TEXT NOT NULL DEFAULT 'disabled',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMessage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorMembershipId" TEXT,
    "kind" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceEventKey" TEXT,
    "sourcePayloadHash" TEXT,
    "canonicalizationVersion" TEXT NOT NULL,
    "externalMessageRef" TEXT,
    "occurredAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerConversationEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorMembershipId" TEXT,
    "fromAssigneeMembershipId" TEXT,
    "toAssigneeMembershipId" TEXT,
    "fromAutomationState" TEXT,
    "toAutomationState" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerConversationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerConversationDraft" (
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "conversationRevision" INTEGER NOT NULL,
    "authorKind" TEXT NOT NULL,
    "authorMembershipId" TEXT,
    "contentJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerConversationDraft_pkey" PRIMARY KEY ("ownerId", "conversationId")
);

-- CreateTable
CREATE TABLE "CustomerMessageTemplate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelScopeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMessageTemplateVersion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "purposeClass" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "submissionState" TEXT NOT NULL DEFAULT 'draft',
    "reviewState" TEXT NOT NULL DEFAULT 'not_submitted',
    "availabilityState" TEXT NOT NULL DEFAULT 'unavailable',
    "reviewRevision" INTEGER NOT NULL DEFAULT 0,
    "externalTemplateRef" TEXT,
    "frozenAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMessageTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_orgId_key" ON "Membership"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerConversation_id_ownerId_key" ON "CustomerConversation"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerConversation_ownerId_contactIdentityId_key" ON "CustomerConversation"("ownerId", "contactIdentityId");

-- CreateIndex
CREATE INDEX "CustomerConversation_owner_status_activity_idx" ON "CustomerConversation"("ownerId", "status", "lastActivityAt", "id");

-- CreateIndex
CREATE INDEX "CustomerConversation_owner_assignee_status_activity_idx" ON "CustomerConversation"("ownerId", "assigneeMembershipId", "status", "lastActivityAt", "id");

-- CreateIndex
CREATE INDEX "CustomerMessage_owner_conversation_received_idx" ON "CustomerMessage"("ownerId", "conversationId", "receivedAt", "id");

-- Prisma cannot express this inbound-only uniqueness contract.
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerMessage_owner_source_event_live"
    ON "CustomerMessage"("ownerId", "sourceEventKey")
    WHERE "sourceEventKey" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerConversationEvent_ownerId_idempotencyKey_key" ON "CustomerConversationEvent"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerConversationEvent_owner_conversation_revision_key" ON "CustomerConversationEvent"("ownerId", "conversationId", "revision");

-- CreateIndex
CREATE INDEX "CustomerConversationEvent_owner_conversation_created_idx" ON "CustomerConversationEvent"("ownerId", "conversationId", "createdAt", "id");

-- CreateIndex: required by Prisma's singular CustomerConversation.draft relation.
CREATE UNIQUE INDEX "CustomerConversationDraft_conversationId_ownerId_key" ON "CustomerConversationDraft"("conversationId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMessageTemplate_id_ownerId_key" ON "CustomerMessageTemplate"("id", "ownerId");

-- CreateIndex
CREATE INDEX "CustomerMessageTemplate_owner_scope_archived_name_idx" ON "CustomerMessageTemplate"("ownerId", "channelScopeId", "archivedAt", "name");

-- Prisma cannot express this live-template uniqueness contract.
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerMessageTemplate_owner_scope_name_locale_live"
    ON "CustomerMessageTemplate"("ownerId", "channelScopeId", "name", "locale")
    WHERE "archivedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMessageTemplateVersion_id_ownerId_key" ON "CustomerMessageTemplateVersion"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMessageTemplateVersion_owner_template_revision_key" ON "CustomerMessageTemplateVersion"("ownerId", "templateId", "revision");

-- CreateIndex
CREATE INDEX "CustomerMessageTemplateVersion_owner_template_revision_idx" ON "CustomerMessageTemplateVersion"("ownerId", "templateId", "revision");

-- Replace the legacy bare reference atomically inside this transaction.
ALTER TABLE "ContactIdentity" DROP CONSTRAINT "ContactIdentity_contactId_fkey";
ALTER TABLE "ContactIdentity" ADD CONSTRAINT "ContactIdentity_contactId_ownerId_fkey"
    FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerConversation" ADD CONSTRAINT "CustomerConversation_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversation" ADD CONSTRAINT "CustomerConversation_contactIdentityId_ownerId_fkey"
    FOREIGN KEY ("contactIdentityId", "ownerId") REFERENCES "ContactIdentity"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversation" ADD CONSTRAINT "CustomerConversation_assigneeMembershipId_ownerId_fkey"
    FOREIGN KEY ("assigneeMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMessage" ADD CONSTRAINT "CustomerMessage_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMessage" ADD CONSTRAINT "CustomerMessage_conversationId_ownerId_fkey"
    FOREIGN KEY ("conversationId", "ownerId") REFERENCES "CustomerConversation"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMessage" ADD CONSTRAINT "CustomerMessage_actorMembershipId_ownerId_fkey"
    FOREIGN KEY ("actorMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerConversationEvent" ADD CONSTRAINT "CustomerConversationEvent_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversationEvent" ADD CONSTRAINT "CustomerConversationEvent_conversationId_ownerId_fkey"
    FOREIGN KEY ("conversationId", "ownerId") REFERENCES "CustomerConversation"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversationEvent" ADD CONSTRAINT "CustomerConversationEvent_actorMembershipId_ownerId_fkey"
    FOREIGN KEY ("actorMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversationEvent" ADD CONSTRAINT "CustomerConversationEvent_fromAssignee_ownerId_fkey"
    FOREIGN KEY ("fromAssigneeMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversationEvent" ADD CONSTRAINT "CustomerConversationEvent_toAssignee_ownerId_fkey"
    FOREIGN KEY ("toAssigneeMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerConversationDraft" ADD CONSTRAINT "CustomerConversationDraft_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversationDraft" ADD CONSTRAINT "CustomerConversationDraft_conversationId_ownerId_fkey"
    FOREIGN KEY ("conversationId", "ownerId") REFERENCES "CustomerConversation"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerConversationDraft" ADD CONSTRAINT "CustomerConversationDraft_authorMembershipId_ownerId_fkey"
    FOREIGN KEY ("authorMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMessageTemplate" ADD CONSTRAINT "CustomerMessageTemplate_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMessageTemplate" ADD CONSTRAINT "CustomerMessageTemplate_channelScopeId_ownerId_channel_fkey"
    FOREIGN KEY ("channelScopeId", "ownerId", "channel") REFERENCES "ChannelScope"("id", "ownerId", "channel") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMessageTemplateVersion" ADD CONSTRAINT "CustomerMessageTemplateVersion_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMessageTemplateVersion" ADD CONSTRAINT "CustomerMessageTemplateVersion_templateId_ownerId_fkey"
    FOREIGN KEY ("templateId", "ownerId") REFERENCES "CustomerMessageTemplate"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerMessageTemplateVersion" ADD CONSTRAINT "CustomerMessageTemplateVersion_createdByMember_ownerId_fkey"
    FOREIGN KEY ("createdByMembershipId", "ownerId") REFERENCES "Membership"("id", "orgId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
