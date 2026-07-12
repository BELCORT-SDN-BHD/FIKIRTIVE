-- B0-28 (NODE-275 收口2): share-preview token record — the spec-frozen "内部写一行 token 记录"
-- (B4 block spec §2.2). The ROW is the authority layer (one row per mint; revocable via revokedAt;
-- verify = HMAC valid AND row live); the HMAC token stays the transport layer. tokenDigest holds
-- SHA-256(token), never the token itself.
-- ADDITIVE ONLY — one new table + indexes + FKs; no data-loss DDL (destructive gate green).
-- Rollback: drop the "SharePreviewToken" table (nothing references it).

-- CreateTable
CREATE TABLE "SharePreviewToken" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scheduledPostId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharePreviewToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharePreviewToken_tokenDigest_key" ON "SharePreviewToken"("tokenDigest");

-- CreateIndex
CREATE INDEX "SharePreviewToken_ownerId_scheduledPostId_idx" ON "SharePreviewToken"("ownerId", "scheduledPostId");

-- AddForeignKey
ALTER TABLE "SharePreviewToken" ADD CONSTRAINT "SharePreviewToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePreviewToken" ADD CONSTRAINT "SharePreviewToken_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
