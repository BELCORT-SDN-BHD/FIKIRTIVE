-- G7v2: add BUILD_CARD chat message kind (sibling of ACTION_CARD)
ALTER TYPE "ChatMessageKind" ADD VALUE 'BUILD_CARD';

-- G7v2: add Page-binding columns to MetaConnection
ALTER TABLE "MetaConnection" ADD COLUMN "canManagePages" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MetaConnection" ADD COLUMN "defaultPageId" TEXT;
