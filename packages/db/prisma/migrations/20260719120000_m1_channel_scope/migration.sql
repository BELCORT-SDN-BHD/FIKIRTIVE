-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN     "channelScopeId" TEXT;

-- AlterTable
ALTER TABLE "ContactIdentity" ADD COLUMN     "channelScopeId" TEXT;

-- CreateTable
CREATE TABLE "ChannelScope" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelScope_ownerId_channel_scopeKey_key" ON "ChannelScope"("ownerId", "channel", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelScope_id_ownerId_channel_key" ON "ChannelScope"("id", "ownerId", "channel");

-- AddForeignKey
ALTER TABLE "ChannelScope" ADD CONSTRAINT "ChannelScope_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_channelScopeId_ownerId_kind_fkey" FOREIGN KEY ("channelScopeId", "ownerId", "kind") REFERENCES "ChannelScope"("id", "ownerId", "channel") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIdentity" ADD CONSTRAINT "ContactIdentity_channelScopeId_ownerId_channel_fkey" FOREIGN KEY ("channelScopeId", "ownerId", "channel") REFERENCES "ChannelScope"("id", "ownerId", "channel") ON DELETE RESTRICT ON UPDATE CASCADE;
