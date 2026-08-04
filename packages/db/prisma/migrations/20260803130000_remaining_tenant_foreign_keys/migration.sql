-- Finish the tenant boundary for owner-scoped relations outside the creative core.
-- Every preflight runs before DDL, and the whole migration is atomic.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ModelDirectiveRevision" child
    LEFT JOIN "ModelDirective" parent
      ON parent."id" = child."directiveId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ModelDirectiveRevision contains a cross-owner directive relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ChatMessage" child
    LEFT JOIN "ChatThread" parent
      ON parent."id" = child."threadId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ChatMessage contains a cross-owner thread relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "SharePreviewToken" child
    LEFT JOIN "ScheduledPost" parent
      ON parent."id" = child."scheduledPostId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'SharePreviewToken contains a cross-owner post relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "TrendSnapshot" child
    LEFT JOIN "Campaign" parent
      ON parent."id" = child."campaignId" AND parent."ownerId" = child."ownerId"
    WHERE child."campaignId" IS NOT NULL AND parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'TrendSnapshot contains a cross-owner campaign relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Contact" child
    LEFT JOIN "Campaign" parent
      ON parent."id" = child."firstTouchCampaignId" AND parent."ownerId" = child."ownerId"
    WHERE child."firstTouchCampaignId" IS NOT NULL AND parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'Contact contains a cross-owner first-touch campaign relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ScheduledPost" child
    LEFT JOIN "Campaign" parent
      ON parent."id" = child."campaignId" AND parent."ownerId" = child."ownerId"
    WHERE child."campaignId" IS NOT NULL AND parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ScheduledPost contains a cross-owner campaign relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "QrAsset" child
    LEFT JOIN "TrackedLink" parent
      ON parent."id" = child."linkId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'QrAsset contains a cross-owner tracked-link relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "QrPlacement" child
    LEFT JOIN "QrAsset" parent
      ON parent."id" = child."qrAssetId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'QrPlacement contains a cross-owner QR relation'; END IF;
END $$;

CREATE UNIQUE INDEX "ModelDirective_id_ownerId_key" ON "ModelDirective"("id", "ownerId");
CREATE UNIQUE INDEX "ChatThread_id_ownerId_key" ON "ChatThread"("id", "ownerId");
CREATE UNIQUE INDEX "ScheduledPost_id_ownerId_key" ON "ScheduledPost"("id", "ownerId");
CREATE UNIQUE INDEX "TrackedLink_id_ownerId_key" ON "TrackedLink"("id", "ownerId");
CREATE UNIQUE INDEX "QrAsset_id_ownerId_key" ON "QrAsset"("id", "ownerId");

ALTER TABLE "ModelDirectiveRevision" DROP CONSTRAINT "ModelDirectiveRevision_directiveId_fkey";
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_threadId_fkey";
ALTER TABLE "SharePreviewToken" DROP CONSTRAINT "SharePreviewToken_scheduledPostId_fkey";
ALTER TABLE "TrendSnapshot" DROP CONSTRAINT "TrendSnapshot_campaignId_fkey";
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_firstTouchCampaignId_fkey";
ALTER TABLE "ScheduledPost" DROP CONSTRAINT "ScheduledPost_campaignId_fkey";
ALTER TABLE "QrAsset" DROP CONSTRAINT "QrAsset_linkId_fkey";
ALTER TABLE "QrPlacement" DROP CONSTRAINT "QrPlacement_qrAssetId_fkey";

ALTER TABLE "ModelDirectiveRevision" ADD CONSTRAINT "ModelDirectiveRevision_directiveId_ownerId_fkey"
  FOREIGN KEY ("directiveId", "ownerId") REFERENCES "ModelDirective"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_ownerId_fkey"
  FOREIGN KEY ("threadId", "ownerId") REFERENCES "ChatThread"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SharePreviewToken" ADD CONSTRAINT "SharePreviewToken_scheduledPostId_ownerId_fkey"
  FOREIGN KEY ("scheduledPostId", "ownerId") REFERENCES "ScheduledPost"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_campaignId_ownerId_fkey"
  FOREIGN KEY ("campaignId", "ownerId") REFERENCES "Campaign"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_firstTouchCampaignId_ownerId_fkey"
  FOREIGN KEY ("firstTouchCampaignId", "ownerId") REFERENCES "Campaign"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_campaignId_ownerId_fkey"
  FOREIGN KEY ("campaignId", "ownerId") REFERENCES "Campaign"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QrAsset" ADD CONSTRAINT "QrAsset_linkId_ownerId_fkey"
  FOREIGN KEY ("linkId", "ownerId") REFERENCES "TrackedLink"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QrPlacement" ADD CONSTRAINT "QrPlacement_qrAssetId_ownerId_fkey"
  FOREIGN KEY ("qrAssetId", "ownerId") REFERENCES "QrAsset"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
