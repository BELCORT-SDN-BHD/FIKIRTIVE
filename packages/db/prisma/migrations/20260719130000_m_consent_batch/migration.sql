-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "entryMode" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "evidenceStatus" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "operationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentStateProjection" (
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "lastReceivedAt" TIMESTAMPTZ(6) NOT NULL,
    "stateActorKind" TEXT NOT NULL,
    "stateSourceKind" TEXT NOT NULL,
    "evidenceStatus" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ContactDndEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "sourceKind" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactDndEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRefusalEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "channel" TEXT,
    "contactIdentityId" TEXT,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "providerCode" TEXT NOT NULL,
    "receiptRef" TEXT NOT NULL,
    "reversesEventId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderRefusalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRefusalState" (
    "ownerId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "lastReceivedAt" TIMESTAMPTZ(6) NOT NULL
);

-- CreateIndex
CREATE INDEX "ConsentEvent_ownerId_contactId_channel_purpose_receivedAt_i_idx" ON "ConsentEvent"("ownerId", "contactId", "channel", "purpose", "receivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentEvent_ownerId_idempotencyKey_key" ON "ConsentEvent"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentStateProjection_ownerId_contactId_channel_purpose_key" ON "ConsentStateProjection"("ownerId", "contactId", "channel", "purpose");

-- CreateIndex
CREATE INDEX "ContactDndEvent_ownerId_contactId_receivedAt_id_idx" ON "ContactDndEvent"("ownerId", "contactId", "receivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactDndEvent_ownerId_idempotencyKey_key" ON "ContactDndEvent"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderRefusalEvent_ownerId_scopeKey_receivedAt_id_idx" ON "ProviderRefusalEvent"("ownerId", "scopeKey", "receivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRefusalEvent_ownerId_idempotencyKey_key" ON "ProviderRefusalEvent"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRefusalState_ownerId_scopeKey_key" ON "ProviderRefusalState"("ownerId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_id_ownerId_key" ON "ChannelConnection"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_ownerId_key" ON "Contact"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactIdentity_id_ownerId_key" ON "ContactIdentity"("id", "ownerId");

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_contactId_ownerId_fkey" FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentStateProjection" ADD CONSTRAINT "ConsentStateProjection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentStateProjection" ADD CONSTRAINT "ConsentStateProjection_contactId_ownerId_fkey" FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactDndEvent" ADD CONSTRAINT "ContactDndEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactDndEvent" ADD CONSTRAINT "ContactDndEvent_contactId_ownerId_fkey" FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRefusalEvent" ADD CONSTRAINT "ProviderRefusalEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRefusalEvent" ADD CONSTRAINT "ProviderRefusalEvent_providerConnectionId_ownerId_fkey" FOREIGN KEY ("providerConnectionId", "ownerId") REFERENCES "ChannelConnection"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRefusalEvent" ADD CONSTRAINT "ProviderRefusalEvent_contactIdentityId_ownerId_fkey" FOREIGN KEY ("contactIdentityId", "ownerId") REFERENCES "ContactIdentity"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRefusalState" ADD CONSTRAINT "ProviderRefusalState_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
