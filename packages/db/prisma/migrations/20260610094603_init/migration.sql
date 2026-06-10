-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('CHARACTER', 'LOCATION', 'PRODUCT', 'BRAND');

-- CreateEnum
CREATE TYPE "ShotStatus" AS ENUM ('DRAFT', 'EXPORTED', 'ATTACHED', 'FINAL');

-- CreateEnum
CREATE TYPE "AssetSource" AS ENUM ('UPLOAD', 'MODAL', 'IMPORT');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "type" "EntityType" NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "negativeConstraints" TEXT NOT NULL DEFAULT '',
    "promptTokens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceImage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "entityId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "viewTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReferenceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "contentHash" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "originalFilename" TEXT NOT NULL DEFAULT '',
    "source" "AssetSource" NOT NULL DEFAULT 'UPLOAD',
    "width" INTEGER,
    "height" INTEGER,
    "durationS" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ShotStatus" NOT NULL DEFAULT 'DRAFT',
    "promptDoc" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotEntityRef" (
    "shotId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',

    CONSTRAINT "ShotEntityRef_pkey" PRIMARY KEY ("shotId","entityId")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "projectId" TEXT NOT NULL,
    "shotId" TEXT,
    "assetId" TEXT NOT NULL,
    "source" "AssetSource" NOT NULL,
    "promptText" TEXT NOT NULL DEFAULT '',
    "modelRef" TEXT NOT NULL DEFAULT '',
    "params" JSONB,
    "entitySnapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "attachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateBundle" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "versionHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "zipHash" TEXT NOT NULL,
    "modalEndpoint" TEXT,
    "gpu" TEXT,
    "costUsdPerRun" DOUBLE PRECISION,
    "deprecatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'founder',
    "projectId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_ownerId_deletedAt_idx" ON "Project"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Entity_ownerId_type_deletedAt_idx" ON "Entity"("ownerId", "type", "deletedAt");

-- CreateIndex
CREATE INDEX "ReferenceImage_entityId_deletedAt_idx" ON "ReferenceImage"("entityId", "deletedAt");

-- CreateIndex
CREATE INDEX "ReferenceImage_assetId_idx" ON "ReferenceImage"("assetId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_deletedAt_idx" ON "Asset"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Asset_deletedAt_idx" ON "Asset"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_ownerId_contentHash_key" ON "Asset"("ownerId", "contentHash");

-- CreateIndex
CREATE INDEX "Shot_projectId_status_deletedAt_idx" ON "Shot"("projectId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_projectId_number_key" ON "Shot"("projectId", "number");

-- CreateIndex
CREATE INDEX "ShotEntityRef_entityId_idx" ON "ShotEntityRef"("entityId");

-- CreateIndex
CREATE INDEX "Generation_projectId_shotId_deletedAt_idx" ON "Generation"("projectId", "shotId", "deletedAt");

-- CreateIndex
CREATE INDEX "Generation_ownerId_shotId_deletedAt_createdAt_idx" ON "Generation"("ownerId", "shotId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_assetId_idx" ON "Generation"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_shotId_version_key" ON "Generation"("shotId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateBundle_versionHash_key" ON "TemplateBundle"("versionHash");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateBundle_zipHash_key" ON "TemplateBundle"("zipHash");

-- CreateIndex
CREATE INDEX "TemplateBundle_ownerId_slug_idx" ON "TemplateBundle"("ownerId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateBundle_slug_version_key" ON "TemplateBundle"("slug", "version");

-- CreateIndex
CREATE INDEX "ActionEvent_ownerId_createdAt_idx" ON "ActionEvent"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionEvent_projectId_type_idx" ON "ActionEvent"("projectId", "type");

-- AddForeignKey
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotEntityRef" ADD CONSTRAINT "ShotEntityRef_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotEntityRef" ADD CONSTRAINT "ShotEntityRef_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
