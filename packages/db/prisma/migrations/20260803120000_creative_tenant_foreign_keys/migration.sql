-- Bind every hard relation in the creative core to the same owner. The preflight makes
-- existing cross-owner links fail closed instead of silently preserving unsafe rows.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "EntityVariant" child
    LEFT JOIN "Entity" parent ON parent."id" = child."entityId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'EntityVariant contains a cross-owner entity relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ReferenceImage" child
    LEFT JOIN "Entity" parent ON parent."id" = child."entityId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ReferenceImage contains a cross-owner entity relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ReferenceImage" child
    LEFT JOIN "Asset" parent ON parent."id" = child."assetId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ReferenceImage contains a cross-owner asset relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ReferenceImage" child
    LEFT JOIN "EntityVariant" parent ON parent."id" = child."variantId" AND parent."ownerId" = child."ownerId"
    WHERE child."variantId" IS NOT NULL AND parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ReferenceImage contains a cross-owner variant relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Shot" child
    LEFT JOIN "Project" parent ON parent."id" = child."projectId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'Shot contains a cross-owner project relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ShotEntityRef" child
    LEFT JOIN "Shot" parent ON parent."id" = child."shotId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ShotEntityRef contains a cross-owner shot relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ShotEntityRef" child
    LEFT JOIN "Entity" parent ON parent."id" = child."entityId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'ShotEntityRef contains a cross-owner entity relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Generation" child
    LEFT JOIN "Project" parent ON parent."id" = child."projectId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'Generation contains a cross-owner project relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Generation" child
    LEFT JOIN "Shot" parent ON parent."id" = child."shotId" AND parent."ownerId" = child."ownerId"
    WHERE child."shotId" IS NOT NULL AND parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'Generation contains a cross-owner shot relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Generation" child
    LEFT JOIN "Asset" parent ON parent."id" = child."assetId" AND parent."ownerId" = child."ownerId"
    WHERE parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'Generation contains a cross-owner asset relation'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Generation" child
    LEFT JOIN "Campaign" parent ON parent."id" = child."campaignId" AND parent."ownerId" = child."ownerId"
    WHERE child."campaignId" IS NOT NULL AND parent."id" IS NULL
  ) THEN RAISE EXCEPTION 'Generation contains a cross-owner campaign relation'; END IF;
END $$;

CREATE UNIQUE INDEX "Project_id_ownerId_key" ON "Project"("id", "ownerId");
CREATE UNIQUE INDEX "Entity_id_ownerId_key" ON "Entity"("id", "ownerId");
CREATE UNIQUE INDEX "EntityVariant_id_ownerId_key" ON "EntityVariant"("id", "ownerId");
CREATE UNIQUE INDEX "Asset_id_ownerId_key" ON "Asset"("id", "ownerId");
CREATE UNIQUE INDEX "Shot_id_ownerId_key" ON "Shot"("id", "ownerId");

ALTER TABLE "EntityVariant" DROP CONSTRAINT "EntityVariant_entityId_fkey";
ALTER TABLE "ReferenceImage" DROP CONSTRAINT "ReferenceImage_entityId_fkey";
ALTER TABLE "ReferenceImage" DROP CONSTRAINT "ReferenceImage_assetId_fkey";
ALTER TABLE "ReferenceImage" DROP CONSTRAINT "ReferenceImage_variantId_fkey";
ALTER TABLE "Shot" DROP CONSTRAINT "Shot_projectId_fkey";
ALTER TABLE "ShotEntityRef" DROP CONSTRAINT "ShotEntityRef_shotId_fkey";
ALTER TABLE "ShotEntityRef" DROP CONSTRAINT "ShotEntityRef_entityId_fkey";
ALTER TABLE "Generation" DROP CONSTRAINT "Generation_projectId_fkey";
ALTER TABLE "Generation" DROP CONSTRAINT "Generation_shotId_fkey";
ALTER TABLE "Generation" DROP CONSTRAINT "Generation_assetId_fkey";
ALTER TABLE "Generation" DROP CONSTRAINT "Generation_campaignId_fkey";

ALTER TABLE "EntityVariant" ADD CONSTRAINT "EntityVariant_entityId_ownerId_fkey"
  FOREIGN KEY ("entityId", "ownerId") REFERENCES "Entity"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_entityId_ownerId_fkey"
  FOREIGN KEY ("entityId", "ownerId") REFERENCES "Entity"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_assetId_ownerId_fkey"
  FOREIGN KEY ("assetId", "ownerId") REFERENCES "Asset"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_variantId_ownerId_fkey"
  FOREIGN KEY ("variantId", "ownerId") REFERENCES "EntityVariant"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_projectId_ownerId_fkey"
  FOREIGN KEY ("projectId", "ownerId") REFERENCES "Project"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShotEntityRef" ADD CONSTRAINT "ShotEntityRef_shotId_ownerId_fkey"
  FOREIGN KEY ("shotId", "ownerId") REFERENCES "Shot"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShotEntityRef" ADD CONSTRAINT "ShotEntityRef_entityId_ownerId_fkey"
  FOREIGN KEY ("entityId", "ownerId") REFERENCES "Entity"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_projectId_ownerId_fkey"
  FOREIGN KEY ("projectId", "ownerId") REFERENCES "Project"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_shotId_ownerId_fkey"
  FOREIGN KEY ("shotId", "ownerId") REFERENCES "Shot"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_assetId_ownerId_fkey"
  FOREIGN KEY ("assetId", "ownerId") REFERENCES "Asset"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_campaignId_ownerId_fkey"
  FOREIGN KEY ("campaignId", "ownerId") REFERENCES "Campaign"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
