-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "AiContextSettings" DROP CONSTRAINT "AiContextSettings_userId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectMemory" DROP CONSTRAINT "ProjectMemory_userId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectMemory" DROP CONSTRAINT "ProjectMemory_sourceMessageId_fkey";

-- DropIndex
DROP INDEX "ProjectMemory_projectId_userId_fingerprint_key";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "accessRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eventSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workspaceRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ChatSession" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "replyToMessageId" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "senderUserId" TEXT;

-- AlterTable
ALTER TABLE "AiContextSettings" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProjectMemory" ADD COLUMN     "updatedByUserId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "addedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "canonicalEmail" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT,
    "acceptedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "requestId" TEXT,

    CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationDelivery" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "invitationRevision" INTEGER NOT NULL,
    "encryptedPayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "resourceId" TEXT,
    "revision" INTEGER,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFileVersion" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMutation" (
    "id" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "expectedWorkspaceRevision" INTEGER NOT NULL,
    "nextWorkspaceRevision" INTEGER NOT NULL,
    "journalPath" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOperation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "actorId" TEXT,
    "capability" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "capturedWorkspaceRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ADMITTED',
    "primaryJobId" TEXT,
    "inputJson" JSONB,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRequest" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "actorId" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "processingToken" TEXT,
    "userMessageId" TEXT,
    "assistantMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQuotaReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "usageDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiQuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_tokenHash_key" ON "ProjectInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectInvitation_projectId_status_idx" ON "ProjectInvitation"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_projectId_invitedByUserId_requestId_key" ON "ProjectInvitation"("projectId", "invitedByUserId", "requestId");

-- CreateIndex
CREATE INDEX "InvitationDelivery_status_nextAttemptAt_idx" ON "InvitationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationDelivery_invitationId_invitationRevision_key" ON "InvitationDelivery"("invitationId", "invitationRevision");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvent_projectId_sequence_key" ON "ProjectEvent"("projectId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFileVersion_snapshotId_relativePath_key" ON "ProjectFileVersion"("snapshotId", "relativePath");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMutation_projectId_requestId_key" ON "ProjectMutation"("projectId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOperation_primaryJobId_key" ON "ProjectOperation"("primaryJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOperation_projectId_actorId_requestId_key" ON "ProjectOperation"("projectId", "actorId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRequest_sessionId_actorId_clientRequestId_key" ON "ChatRequest"("sessionId", "actorId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AiQuotaReservation_userId_requestKey_key" ON "AiQuotaReservation"("userId", "requestKey");

-- CreateIndex
-- Shared memory deduplication: forgotten content wins so migration never
-- resurrects a note a user explicitly removed. Remap conflict references first.
CREATE TEMP TABLE "_collaboration_memory_ids" AS
SELECT "id", first_value("id") OVER (
  PARTITION BY "projectId", "fingerprint"
  ORDER BY CASE WHEN "status" = 'FORGOTTEN' THEN 0 ELSE 1 END,
           "revision" DESC, "updatedAt" DESC, "id" ASC
) AS "keepId" FROM "ProjectMemory";
UPDATE "ProjectMemory" m SET "conflictsWithId" = ids."keepId"
FROM "_collaboration_memory_ids" ids WHERE m."conflictsWithId" = ids."id";
DELETE FROM "ProjectMemory" m USING "_collaboration_memory_ids" ids
WHERE m."id" = ids."id" AND ids."id" <> ids."keepId";
DROP TABLE "_collaboration_memory_ids";
CREATE UNIQUE INDEX "ProjectMemory_projectId_fingerprint_key" ON "ProjectMemory"("projectId", "fingerprint");

UPDATE "ChatMessage" m SET "senderUserId" = s."userId"
FROM "ChatSession" s WHERE m."sessionId" = s."id" AND m."role" = 'user';

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_role_check" CHECK ("role" IN ('EDITOR', 'VIEWER'));
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_role_check" CHECK ("role" IN ('EDITOR', 'VIEWER'));
CREATE UNIQUE INDEX "ProjectInvitation_pending_email_key" ON "ProjectInvitation" ("projectId", "canonicalEmail") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "ProjectOperation_active_semantic_key" ON "ProjectOperation" ("projectId", "semanticKey") WHERE "status" IN ('ADMITTED', 'QUEUED', 'RUNNING', 'PUBLISHING');

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiContextSettings" ADD CONSTRAINT "AiContextSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMemory" ADD CONSTRAINT "ProjectMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMemory" ADD CONSTRAINT "ProjectMemory_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationDelivery" ADD CONSTRAINT "InvitationDelivery_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "ProjectInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFileVersion" ADD CONSTRAINT "ProjectFileVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFileVersion" ADD CONSTRAINT "ProjectFileVersion_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMutation" ADD CONSTRAINT "ProjectMutation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMutation" ADD CONSTRAINT "ProjectMutation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMutation" ADD CONSTRAINT "ProjectMutation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperation" ADD CONSTRAINT "ProjectOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperation" ADD CONSTRAINT "ProjectOperation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperation" ADD CONSTRAINT "ProjectOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperation" ADD CONSTRAINT "ProjectOperation_primaryJobId_fkey" FOREIGN KEY ("primaryJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRequest" ADD CONSTRAINT "ChatRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRequest" ADD CONSTRAINT "ChatRequest_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiQuotaReservation" ADD CONSTRAINT "AiQuotaReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
