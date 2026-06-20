-- Tenant admin (P1): DB-backed invite allowlist + Organization list index. Additive only.

-- CreateTable
CREATE TABLE "AllowedEmail" (
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AllowedEmail_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "Organization_list_idx" ON "Organization"("deletedAt", "createdAt");
