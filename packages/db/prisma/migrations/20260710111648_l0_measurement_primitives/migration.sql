-- L0 量测原语 —— 第 0 大陆「所有环共用的水表」(PR-L0a:六模型 + 迁移)。
-- docs/superpowers/specs/2026-07-10-l0-measurement-primitives.md §二 / §PR 切片。
-- Additive only:六张新表 + 其索引/FK,末尾两条 Prisma 表达不了的 partial-unique 索引
-- (hand-appended)。无 DROP / 无 ALTER-that-drops / 不动任何既有表。全 $0(不走记账缝)。

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "campaignId" TEXT,
    "domain" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "utmJson" JSONB,
    "purpose" TEXT NOT NULL DEFAULT 'generic',
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "campaignId" TEXT,
    "linkId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "imageAssetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QrAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrPlacement" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "qrAssetId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "printStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "quantity" INTEGER,
    "deployedAt" TIMESTAMP(3),
    "recalledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherToken" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "campaignId" TEXT,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'no_discount',
    "discountJson" JSONB,
    "linkId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "clawedBackAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "externalOrderId" TEXT,
    "redemptionEvidence" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VoucherToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceTag" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "campaignId" TEXT,
    "subjectKind" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "linkId" TEXT,
    "qrAssetId" TEXT,
    "voucherId" TEXT,
    "utmSnapshot" JSONB,
    "evidence" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SourceTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "brandId" TEXT,
    "campaignId" TEXT,
    "kind" TEXT NOT NULL,
    "linkId" TEXT,
    "qrAssetId" TEXT,
    "voucherId" TEXT,
    "sourceTagId" TEXT,
    "evidence" TEXT NOT NULL,
    "evidenceRung" TEXT,
    "outcomeDelta" INTEGER NOT NULL DEFAULT 0,
    "valueMinor" INTEGER,
    "valueCurrency" TEXT,
    "utmSnapshot" JSONB,
    "geoBucket" TEXT,
    "deviceBucket" TEXT,
    "ipHashPrefix" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedLink_ownerId_createdAt_idx" ON "TrackedLink"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedLink_ownerId_purpose_createdAt_idx" ON "TrackedLink"("ownerId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "QrAsset_ownerId_linkId_idx" ON "QrAsset"("ownerId", "linkId");

-- CreateIndex
CREATE INDEX "QrPlacement_ownerId_qrAssetId_printStatus_idx" ON "QrPlacement"("ownerId", "qrAssetId", "printStatus");

-- CreateIndex
CREATE INDEX "VoucherToken_ownerId_status_endsAt_idx" ON "VoucherToken"("ownerId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "SourceTag_ownerId_subjectKind_subjectRef_idx" ON "SourceTag"("ownerId", "subjectKind", "subjectRef");

-- CreateIndex
CREATE INDEX "SourceTag_ownerId_linkId_idx" ON "SourceTag"("ownerId", "linkId");

-- CreateIndex
CREATE INDEX "AttributionEvent_ownerId_kind_occurredAt_idx" ON "AttributionEvent"("ownerId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_ownerId_campaignId_occurredAt_idx" ON "AttributionEvent"("ownerId", "campaignId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionEvent_ownerId_idempotencyKey_key" ON "AttributionEvent"("ownerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAsset" ADD CONSTRAINT "QrAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAsset" ADD CONSTRAINT "QrAsset_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrPlacement" ADD CONSTRAINT "QrPlacement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrPlacement" ADD CONSTRAINT "QrPlacement_qrAssetId_fkey" FOREIGN KEY ("qrAssetId") REFERENCES "QrAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherToken" ADD CONSTRAINT "VoucherToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceTag" ADD CONSTRAINT "SourceTag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 短链解析唯一性:重定向按 (domain, slug) 解析,与 owner 无关(点击者匿名),故唯一约束
-- 在 (domain, slug)。软删除的旧行(deletedAt IS NOT NULL)不占用 slug,可被重铸。Partial/
-- conditional —— Prisma 表达不了 WHERE 谓词,故 hand-appended(同 BrandRecord 活 nameKey 索引
-- 20260702114921 与 PublishAttempt one-applying 索引 20260703030000 手法)。索引对 datamodel
-- 漂移门不可见,归 domain/slug 唯一性测试所有。Additive-only:无删除、无类型改动。
CREATE UNIQUE INDEX "TrackedLink_domain_slug_live"
  ON "TrackedLink"("domain", "slug")
  WHERE "deletedAt" IS NULL;

-- 优惠码唯一性:每 owner 一个活码(soft-deleted 旧码不阻塞重铸)。同上,partial —— hand-appended。
CREATE UNIQUE INDEX "VoucherToken_owner_code_live"
  ON "VoucherToken"("ownerId", "code")
  WHERE "deletedAt" IS NULL;
