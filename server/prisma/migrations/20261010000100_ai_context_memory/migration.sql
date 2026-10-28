-- Additive: existing transcripts are preserved; automatic memory starts disabled.
ALTER TABLE "ChatSession"
  ADD COLUMN "useMemory" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sourceSessionId" TEXT,
  ADD COLUMN "sourceMessageId" TEXT,
  ADD COLUMN "snapshotId" TEXT,
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "summaryThroughId" TEXT,
  ADD COLUMN "contextStatus" TEXT NOT NULL DEFAULT 'READY',
  ADD COLUMN "processingToken" TEXT,
  ADD COLUMN "processingUntil" TIMESTAMP(3);

CREATE TABLE "AiContextSettings" (
  "projectId" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "automaticMemory" BOOLEAN NOT NULL DEFAULT false,
  "guidance" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "memoryGeneration" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AiContextSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiContextSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ProjectMemory" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "sourceMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMemory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectMemory_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectMemory_projectId_userId_fingerprint_key" ON "ProjectMemory"("projectId", "userId", "fingerprint");
CREATE INDEX "ProjectMemory_projectId_userId_status_idx" ON "ProjectMemory"("projectId", "userId", "status");
