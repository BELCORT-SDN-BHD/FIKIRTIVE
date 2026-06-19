-- Manual rollback for 20260619120000_org_tenant (NOT run by Prisma — apply by hand if needed).
-- Data-preserving: ownerId stays a plain String on every business table; Organization/Membership
-- are dormant (nothing reads them until P3), so dropping them loses no business data.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f rollback.sql

-- 1. Drop the 20 business-table FKs (RESTRICT — no cascade) + the 2 Membership FKs.
ALTER TABLE "Project"                 DROP CONSTRAINT IF EXISTS "Project_ownerId_fkey";
ALTER TABLE "Entity"                 DROP CONSTRAINT IF EXISTS "Entity_ownerId_fkey";
ALTER TABLE "EntityVariant"          DROP CONSTRAINT IF EXISTS "EntityVariant_ownerId_fkey";
ALTER TABLE "ReferenceImage"         DROP CONSTRAINT IF EXISTS "ReferenceImage_ownerId_fkey";
ALTER TABLE "Asset"                  DROP CONSTRAINT IF EXISTS "Asset_ownerId_fkey";
ALTER TABLE "Shot"                   DROP CONSTRAINT IF EXISTS "Shot_ownerId_fkey";
ALTER TABLE "ShotEntityRef"          DROP CONSTRAINT IF EXISTS "ShotEntityRef_ownerId_fkey";
ALTER TABLE "Generation"             DROP CONSTRAINT IF EXISTS "Generation_ownerId_fkey";
ALTER TABLE "TemplateBundle"         DROP CONSTRAINT IF EXISTS "TemplateBundle_ownerId_fkey";
ALTER TABLE "RenderJob"              DROP CONSTRAINT IF EXISTS "RenderJob_ownerId_fkey";
ALTER TABLE "CaptionJob"             DROP CONSTRAINT IF EXISTS "CaptionJob_ownerId_fkey";
ALTER TABLE "Transcript"             DROP CONSTRAINT IF EXISTS "Transcript_ownerId_fkey";
ALTER TABLE "RefGenJob"              DROP CONSTRAINT IF EXISTS "RefGenJob_ownerId_fkey";
ALTER TABLE "GenJob"                 DROP CONSTRAINT IF EXISTS "GenJob_ownerId_fkey";
ALTER TABLE "ActionEvent"            DROP CONSTRAINT IF EXISTS "ActionEvent_ownerId_fkey";
ALTER TABLE "ModelDirective"         DROP CONSTRAINT IF EXISTS "ModelDirective_ownerId_fkey";
ALTER TABLE "ModelRegistryOverlay"   DROP CONSTRAINT IF EXISTS "ModelRegistryOverlay_ownerId_fkey";
ALTER TABLE "ModelDirectiveRevision" DROP CONSTRAINT IF EXISTS "ModelDirectiveRevision_ownerId_fkey";
ALTER TABLE "ChatThread"             DROP CONSTRAINT IF EXISTS "ChatThread_ownerId_fkey";
ALTER TABLE "ChatMessage"            DROP CONSTRAINT IF EXISTS "ChatMessage_ownerId_fkey";

-- 2. Drop the new tables (Membership FKs go with them).
DROP TABLE IF EXISTS "Membership";
DROP TABLE IF EXISTS "Organization";

-- 3. Drop the reserved User column.
ALTER TABLE "User" DROP COLUMN IF EXISTS "activeOrgId";

-- 4. (Then remove the migration row so the file can be re-applied cleanly.)
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20260619120000_org_tenant';
