-- CreateTable
CREATE TABLE "WebPageCache" (
    "id" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebPageCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebPageCache_urlHash_key" ON "WebPageCache"("urlHash");
