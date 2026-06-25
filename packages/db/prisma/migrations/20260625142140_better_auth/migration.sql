-- CreateTable
CREATE TABLE "ba_user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ba_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ba_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ba_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ba_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ba_user_email_key" ON "ba_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ba_session_token_key" ON "ba_session"("token");

-- CreateIndex
CREATE INDEX "ba_session_userId_idx" ON "ba_session"("userId");

-- CreateIndex
CREATE INDEX "ba_account_userId_idx" ON "ba_account"("userId");

-- CreateIndex
CREATE INDEX "ba_verification_identifier_idx" ON "ba_verification"("identifier");

-- AddForeignKey
ALTER TABLE "ba_session" ADD CONSTRAINT "ba_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ba_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_account" ADD CONSTRAINT "ba_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ba_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
