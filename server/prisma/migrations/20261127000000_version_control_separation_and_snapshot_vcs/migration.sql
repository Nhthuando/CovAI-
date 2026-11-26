-- Additive & Idempotent Migration: Version Control Separation & Mini-GitHub Snapshot VCS
-- Safe to execute multiple times on live PostgreSQL databases without data loss.

-- Extend JobType enum safely
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'GIT_PUSH';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'GIT_PULL';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'GIT_FETCH';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'GIT_PUBLISH_REPO';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SNAPSHOT_CAS_GC';

-- Extend User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "githubLogin" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "githubOAuthScopes" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastAuthProvider" TEXT;

-- Extend Project
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "activeVcsBranchId" TEXT;

-- Extend ProjectSnapshot
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "commitMessage" TEXT;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "parentSnapshotId" TEXT;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "restoredFromSnapshotId" TEXT;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "authorId" TEXT;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "vcsBranchId" TEXT;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "statsJson" JSONB;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "isAutoBackup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectSnapshot" ADD COLUMN IF NOT EXISTS "casMaterialized" BOOLEAN NOT NULL DEFAULT false;

-- Replace unique (projectId, commitSha) constraint/index with non-unique index so Git branch checkout/reset never fails with P2002
ALTER TABLE "ProjectSnapshot" DROP CONSTRAINT IF EXISTS "ProjectSnapshot_projectId_commitSha_key";
DROP INDEX IF EXISTS "ProjectSnapshot_projectId_commitSha_key";
CREATE INDEX IF NOT EXISTS "ProjectSnapshot_projectId_commitSha_idx" ON "ProjectSnapshot"("projectId", "commitSha");
CREATE INDEX IF NOT EXISTS "ProjectSnapshot_projectId_vcsBranchId_createdAt_idx" ON "ProjectSnapshot"("projectId", "vcsBranchId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectSnapshot_projectId_versionNumber_idx" ON "ProjectSnapshot"("projectId", "versionNumber");

-- CreateTable: SnapshotVcsBranch
CREATE TABLE IF NOT EXISTS "SnapshotVcsBranch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "headSnapshotId" TEXT,
    "baseSnapshotId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotVcsBranch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotVcsBranch_projectId_name_key" ON "SnapshotVcsBranch"("projectId", "name");
CREATE INDEX IF NOT EXISTS "SnapshotVcsBranch_projectId_idx" ON "SnapshotVcsBranch"("projectId");

-- CreateTable: SnapshotVcsTag
CREATE TABLE IF NOT EXISTS "SnapshotVcsTag" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT DEFAULT 'indigo',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotVcsTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotVcsTag_projectId_name_key" ON "SnapshotVcsTag"("projectId", "name");
CREATE INDEX IF NOT EXISTS "SnapshotVcsTag_snapshotId_idx" ON "SnapshotVcsTag"("snapshotId");

-- CreateTable: SnapshotVcsEntry
CREATE TABLE IF NOT EXISTS "SnapshotVcsEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "blobSha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "isBinary" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT '100644',

    CONSTRAINT "SnapshotVcsEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotVcsEntry_snapshotId_relativePath_key" ON "SnapshotVcsEntry"("snapshotId", "relativePath");
CREATE INDEX IF NOT EXISTS "SnapshotVcsEntry_snapshotId_idx" ON "SnapshotVcsEntry"("snapshotId");
CREATE INDEX IF NOT EXISTS "SnapshotVcsEntry_blobSha256_idx" ON "SnapshotVcsEntry"("blobSha256");

-- CreateTable: SnapshotVcsStaging
CREATE TABLE IF NOT EXISTS "SnapshotVcsStaging" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "stagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotVcsStaging_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotVcsStaging_projectId_userId_relativePath_key" ON "SnapshotVcsStaging"("projectId", "userId", "relativePath");
CREATE INDEX IF NOT EXISTS "SnapshotVcsStaging_projectId_userId_idx" ON "SnapshotVcsStaging"("projectId", "userId");

-- CreateTable: SnapshotVcsBlobRef
CREATE TABLE IF NOT EXISTS "SnapshotVcsBlobRef" (
    "projectId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "isBinary" BOOLEAN NOT NULL DEFAULT false,
    "compressed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotVcsBlobRef_pkey" PRIMARY KEY ("projectId", "sha256")
);

CREATE INDEX IF NOT EXISTS "SnapshotVcsBlobRef_projectId_idx" ON "SnapshotVcsBlobRef"("projectId");

-- Guarded Foreign Keys for ProjectSnapshot
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectSnapshot_authorId_fkey') THEN
    ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectSnapshot_parentSnapshotId_fkey') THEN
    ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_parentSnapshotId_fkey" FOREIGN KEY ("parentSnapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectSnapshot_restoredFromSnapshotId_fkey') THEN
    ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_restoredFromSnapshotId_fkey" FOREIGN KEY ("restoredFromSnapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectSnapshot_vcsBranchId_fkey') THEN
    ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_vcsBranchId_fkey" FOREIGN KEY ("vcsBranchId") REFERENCES "SnapshotVcsBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Guarded Foreign Keys for SnapshotVcsBranch
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsBranch_projectId_fkey') THEN
    ALTER TABLE "SnapshotVcsBranch" ADD CONSTRAINT "SnapshotVcsBranch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsBranch_headSnapshotId_fkey') THEN
    ALTER TABLE "SnapshotVcsBranch" ADD CONSTRAINT "SnapshotVcsBranch_headSnapshotId_fkey" FOREIGN KEY ("headSnapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsBranch_baseSnapshotId_fkey') THEN
    ALTER TABLE "SnapshotVcsBranch" ADD CONSTRAINT "SnapshotVcsBranch_baseSnapshotId_fkey" FOREIGN KEY ("baseSnapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsBranch_createdById_fkey') THEN
    ALTER TABLE "SnapshotVcsBranch" ADD CONSTRAINT "SnapshotVcsBranch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Guarded Foreign Keys for SnapshotVcsTag
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsTag_projectId_fkey') THEN
    ALTER TABLE "SnapshotVcsTag" ADD CONSTRAINT "SnapshotVcsTag_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsTag_snapshotId_fkey') THEN
    ALTER TABLE "SnapshotVcsTag" ADD CONSTRAINT "SnapshotVcsTag_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsTag_createdById_fkey') THEN
    ALTER TABLE "SnapshotVcsTag" ADD CONSTRAINT "SnapshotVcsTag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Guarded Foreign Keys for SnapshotVcsEntry, SnapshotVcsStaging, SnapshotVcsBlobRef
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsEntry_snapshotId_fkey') THEN
    ALTER TABLE "SnapshotVcsEntry" ADD CONSTRAINT "SnapshotVcsEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsStaging_projectId_fkey') THEN
    ALTER TABLE "SnapshotVcsStaging" ADD CONSTRAINT "SnapshotVcsStaging_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsStaging_userId_fkey') THEN
    ALTER TABLE "SnapshotVcsStaging" ADD CONSTRAINT "SnapshotVcsStaging_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SnapshotVcsBlobRef_projectId_fkey') THEN
    ALTER TABLE "SnapshotVcsBlobRef" ADD CONSTRAINT "SnapshotVcsBlobRef_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
