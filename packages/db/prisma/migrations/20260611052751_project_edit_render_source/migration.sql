-- AlterEnum
ALTER TYPE "AssetSource" ADD VALUE 'RENDER';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "editJson" JSONB;
