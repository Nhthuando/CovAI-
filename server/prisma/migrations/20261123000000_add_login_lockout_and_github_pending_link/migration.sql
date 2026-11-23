-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GithubPendingLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "githubLogin" TEXT,
    "githubName" TEXT,
    "githubAvatarUrl" TEXT,
    "githubAccessTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubPendingLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GithubPendingLink_tokenHash_key" ON "GithubPendingLink"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GithubPendingLink_userId_expiresAt_idx" ON "GithubPendingLink"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GithubPendingLink_expiresAt_idx" ON "GithubPendingLink"("expiresAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GithubPendingLink_userId_fkey'
  ) THEN
    ALTER TABLE "GithubPendingLink" ADD CONSTRAINT "GithubPendingLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
