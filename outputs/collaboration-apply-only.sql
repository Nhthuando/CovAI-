BEGIN;
-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "disciplineRole" TEXT;

-- AlterTable
ALTER TABLE "ProjectInvitation" ADD COLUMN     "disciplineRole" TEXT;

-- AlterTable
ALTER TABLE "ProjectFileVersion" ADD COLUMN     "attributionStatus" TEXT,
ADD COLUMN     "lineAttributionJson" JSONB;

-- CreateTable
CREATE TABLE "ProjectEditorDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "stateBytes" BYTEA NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "baseFileRevision" INTEGER NOT NULL,
    "baseFileHash" TEXT NOT NULL,
    "checkpointRevision" INTEGER NOT NULL DEFAULT 0,
    "lineAttributionJson" JSONB NOT NULL,
    "attributionStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEditorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEditorUpdate" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "actorId" TEXT,
    "requestId" TEXT NOT NULL,
    "updateHash" TEXT NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "resultContentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEditorUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCodeChange" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "actorId" TEXT,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCodeChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectEditorDocument_projectId_active_idx" ON "ProjectEditorDocument"("projectId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEditorDocument_snapshotId_relativePath_key" ON "ProjectEditorDocument"("snapshotId", "relativePath");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEditorUpdate_documentId_generation_actorId_requestId_key" ON "ProjectEditorUpdate"("documentId", "generation", "actorId", "requestId");

-- CreateIndex
CREATE INDEX "ProjectCodeChange_projectId_snapshotId_idx" ON "ProjectCodeChange"("projectId", "snapshotId");

-- AddForeignKey
ALTER TABLE "ProjectEditorDocument" ADD CONSTRAINT "ProjectEditorDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEditorDocument" ADD CONSTRAINT "ProjectEditorDocument_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEditorUpdate" ADD CONSTRAINT "ProjectEditorUpdate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectEditorDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEditorUpdate" ADD CONSTRAINT "ProjectEditorUpdate_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCodeChange" ADD CONSTRAINT "ProjectCodeChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCodeChange" ADD CONSTRAINT "ProjectCodeChange_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCodeChange" ADD CONSTRAINT "ProjectCodeChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Responsibilities never grant access; existing access CHECK constraints are retained.
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_discipline_check" CHECK ("disciplineRole" IS NULL OR "disciplineRole" IN ('PM','DEVELOPER','TECH_LEAD','TESTER','AI_ENGINEER','QA_ENGINEER'));
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_discipline_check" CHECK ("disciplineRole" IS NULL OR "disciplineRole" IN ('PM','DEVELOPER','TECH_LEAD','TESTER','AI_ENGINEER','QA_ENGINEER'));
ALTER TABLE "ProjectEditorDocument" ADD CONSTRAINT "ProjectEditorDocument_revision_check" CHECK ("revision" >= "checkpointRevision" AND "generation" > 0);

COMMIT;
