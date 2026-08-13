-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "outletId" TEXT,
ADD COLUMN     "subjectRef" TEXT,
ADD COLUMN     "surface" TEXT,
ADD COLUMN     "visibility" TEXT;

-- AlterTable
ALTER TABLE "ChatThread" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "outletId" TEXT,
ADD COLUMN     "subjectRef" TEXT,
ADD COLUMN     "surface" TEXT,
ADD COLUMN     "visibility" TEXT;
