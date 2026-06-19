-- P3: drop the ownerId column DEFAULT 'founder' on every business table so a new row
-- can never silently inherit the founder's org. The resolver (requireOwner) now supplies
-- ownerId on every insert. Irreversible behavior change (part of the multi-tenant flip).
-- Existing rows are untouched (their stored ownerId stays 'founder').
ALTER TABLE "Project"                ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Entity"                 ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "EntityVariant"          ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ReferenceImage"         ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Asset"                  ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Shot"                   ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ShotEntityRef"          ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Generation"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "TemplateBundle"         ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "RenderJob"              ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "GenJob"                 ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "RefGenJob"              ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ActionEvent"            ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "CaptionJob"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "Transcript"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ModelDirective"         ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ModelRegistryOverlay"   ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ModelDirectiveRevision" ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ChatThread"             ALTER COLUMN "ownerId" DROP DEFAULT;
ALTER TABLE "ChatMessage"            ALTER COLUMN "ownerId" DROP DEFAULT;
