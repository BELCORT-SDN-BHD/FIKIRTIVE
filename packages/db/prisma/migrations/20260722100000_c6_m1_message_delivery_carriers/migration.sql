-- C6-M1 (2026-07-22): additive-only messaging receipt storage.
-- docs/superpowers/specs/2026-07-22-c6-receipts-reports-physical-contract.md §7.
-- Adds two owner-scoped carriers only: append-only MessageDeliveryEvent facts and the rebuildable
-- per-logical-send MessageDeliveryState projection. No existing table or column is changed. No
-- sender, outbox, retry path, ledger, data migration, retention/TTL mechanism, ad-hoc field crypto,
-- or simulated receipt storage is introduced. Every statement below is additive-only.

BEGIN;

-- CreateTable
CREATE TABLE "MessageDeliveryEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "logicalSendRef" TEXT NOT NULL,
    "channelScopeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "factKind" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "externalMessageRef" TEXT,
    "receiptRef" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "sourceEventKey" TEXT NOT NULL,
    "sourcePayloadHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDeliveryState" (
    "ownerId" TEXT NOT NULL,
    "logicalSendRef" TEXT NOT NULL,
    "lifecycle" TEXT NOT NULL,
    "reconciliation" TEXT NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "lastProviderEventAt" TIMESTAMPTZ(6),
    "lastReconciledAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageDeliveryEvent_ownerId_sourceEventKey_key"
    ON "MessageDeliveryEvent"("ownerId", "sourceEventKey");

-- CreateIndex
CREATE INDEX "MessageDeliveryEvent_owner_send_received_idx"
    ON "MessageDeliveryEvent"("ownerId", "logicalSendRef", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "MessageDeliveryEvent_owner_connection_received_idx"
    ON "MessageDeliveryEvent"("ownerId", "providerConnectionId", "receivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDeliveryState_ownerId_logicalSendRef_key"
    ON "MessageDeliveryState"("ownerId", "logicalSendRef");

-- AddForeignKey
ALTER TABLE "MessageDeliveryEvent" ADD CONSTRAINT "MessageDeliveryEvent_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDeliveryEvent" ADD CONSTRAINT "MessageDeliveryEvent_channelScopeId_ownerId_channel_fkey"
    FOREIGN KEY ("channelScopeId", "ownerId", "channel") REFERENCES "ChannelScope"("id", "ownerId", "channel") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDeliveryEvent" ADD CONSTRAINT "MessageDeliveryEvent_providerConnectionId_ownerId_fkey"
    FOREIGN KEY ("providerConnectionId", "ownerId") REFERENCES "ChannelConnection"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDeliveryState" ADD CONSTRAINT "MessageDeliveryState_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
