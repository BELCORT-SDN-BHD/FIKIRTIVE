-- DESTRUCTIVE-OK: Founder-approved dead-schema deletion (issue #952, audit ledger #850): 10 zero-reference tables (L0 six + NextAuth legacy three + TemplateBundle), all verified zero live reads/writes; fresh-db replay clean.
/*
  Warnings:

  - You are about to drop the `Account` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AttributionEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QrAsset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QrPlacement` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SourceTag` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TemplateBundle` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TrackedLink` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VerificationToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VoucherToken` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";

-- DropForeignKey
ALTER TABLE "AttributionEvent" DROP CONSTRAINT "AttributionEvent_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "QrAsset" DROP CONSTRAINT "QrAsset_linkId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "QrAsset" DROP CONSTRAINT "QrAsset_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "QrPlacement" DROP CONSTRAINT "QrPlacement_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "QrPlacement" DROP CONSTRAINT "QrPlacement_qrAssetId_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropForeignKey
ALTER TABLE "SourceTag" DROP CONSTRAINT "SourceTag_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "TemplateBundle" DROP CONSTRAINT "TemplateBundle_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "TrackedLink" DROP CONSTRAINT "TrackedLink_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "VoucherToken" DROP CONSTRAINT "VoucherToken_ownerId_fkey";

-- DropTable
DROP TABLE "Account";

-- DropTable
DROP TABLE "AttributionEvent";

-- DropTable
DROP TABLE "QrAsset";

-- DropTable
DROP TABLE "QrPlacement";

-- DropTable
DROP TABLE "Session";

-- DropTable
DROP TABLE "SourceTag";

-- DropTable
DROP TABLE "TemplateBundle";

-- DropTable
DROP TABLE "TrackedLink";

-- DropTable
DROP TABLE "VerificationToken";

-- DropTable
DROP TABLE "VoucherToken";
