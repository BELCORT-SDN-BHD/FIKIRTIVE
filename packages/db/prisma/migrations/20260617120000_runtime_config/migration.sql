-- CreateTable
CREATE TABLE "RuntimeConfig" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RuntimeConfig_pkey" PRIMARY KEY ("key")
);
