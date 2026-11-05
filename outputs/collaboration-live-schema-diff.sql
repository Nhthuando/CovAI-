-- AlterEnum
BEGIN;
CREATE TYPE "JobType_new" AS ENUM ('INGEST', 'INSTALL_DEPS', 'RUN_TESTS', 'PARSE_COVERAGE', 'BUILD_CFG', 'AI_SUGGEST', 'AI_TESTS', 'CODE_HYGIENE', 'PERFORMANCE_ANALYSIS', 'ANALYSIS', 'QUALITY_ANALYSIS', 'SECURITY_ANALYSIS', 'SUPERTEST_COVERAGE', 'PLAYWRIGHT_API_COVERAGE', 'RUN_VITEST_TESTS', 'VITEST_COVERAGE', 'SYSTEM_TEST_ANALYSIS', 'SYSTEM_TEST_ASSESSMENT', 'SYSTEM_TEST_IMPROVEMENT', 'SYSTEM_TEST_MUTATION', 'CYPRESS_SYSTEM_TEST', 'CYPRESS_SYSTEM_COVERAGE', 'PLAYWRIGHT_SYSTEM_TEST', 'PLAYWRIGHT_SYSTEM_COVERAGE');
ALTER TABLE "Job" ALTER COLUMN "type" TYPE "JobType_new" USING ("type"::text::"JobType_new");
ALTER TYPE "JobType" RENAME TO "JobType_old";
ALTER TYPE "JobType_new" RENAME TO "JobType";
DROP TYPE "public"."JobType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "AiEvaluationAttempt" DROP CONSTRAINT "AiEvaluationAttempt_caseResultId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationCaseResult" DROP CONSTRAINT "AiEvaluationCaseResult_runId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationCaseResult" DROP CONSTRAINT "AiEvaluationCaseResult_testCaseId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationConfirmationGrant" DROP CONSTRAINT "AiEvaluationConfirmationGrant_attemptId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationCredential" DROP CONSTRAINT "AiEvaluationCredential_targetId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationCriterionResult" DROP CONSTRAINT "AiEvaluationCriterionResult_caseResultId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationEvidence" DROP CONSTRAINT "AiEvaluationEvidence_runId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationHumanReview" DROP CONSTRAINT "AiEvaluationHumanReview_criterionResultId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationKnowledgeSource" DROP CONSTRAINT "AiEvaluationKnowledgeSource_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationProfile" DROP CONSTRAINT "AiEvaluationProfile_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationProfileVersion" DROP CONSTRAINT "AiEvaluationProfileVersion_profileId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationRun" DROP CONSTRAINT "AiEvaluationRun_profileVersionId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationRun" DROP CONSTRAINT "AiEvaluationRun_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationRun" DROP CONSTRAINT "AiEvaluationRun_targetVersionId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationTarget" DROP CONSTRAINT "AiEvaluationTarget_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationTargetVersion" DROP CONSTRAINT "AiEvaluationTargetVersion_credentialId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationTargetVersion" DROP CONSTRAINT "AiEvaluationTargetVersion_targetId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationTestCase" DROP CONSTRAINT "AiEvaluationTestCase_profileVersionId_fkey";

-- DropForeignKey
ALTER TABLE "AiEvaluationToolCall" DROP CONSTRAINT "AiEvaluationToolCall_attemptId_fkey";

-- DropIndex
DROP INDEX "Job_active_singleton_per_snapshot_key";

-- DropIndex
DROP INDEX "ProjectSnapshot_projectId_contentHash_idx";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "activeSnapshotId";

-- AlterTable
ALTER TABLE "ProjectFileVersion" ADD COLUMN     "attributionStatus" TEXT,
ADD COLUMN     "lineAttributionJson" JSONB;

-- AlterTable
ALTER TABLE "ProjectInvitation" ADD COLUMN     "disciplineRole" TEXT;

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "disciplineRole" TEXT;

-- AlterTable
ALTER TABLE "ProjectSnapshot" DROP COLUMN "contentHash",
DROP COLUMN "label",
DROP COLUMN "versionNumber";

-- DropTable
DROP TABLE "AiEvaluationAttempt";

-- DropTable
DROP TABLE "AiEvaluationCaseResult";

-- DropTable
DROP TABLE "AiEvaluationConfirmationGrant";

-- DropTable
DROP TABLE "AiEvaluationCredential";

-- DropTable
DROP TABLE "AiEvaluationCriterionResult";

-- DropTable
DROP TABLE "AiEvaluationEvidence";

-- DropTable
DROP TABLE "AiEvaluationHumanReview";

-- DropTable
DROP TABLE "AiEvaluationKnowledgeSource";

-- DropTable
DROP TABLE "AiEvaluationProfile";

-- DropTable
DROP TABLE "AiEvaluationProfileVersion";

-- DropTable
DROP TABLE "AiEvaluationRun";

-- DropTable
DROP TABLE "AiEvaluationTarget";

-- DropTable
DROP TABLE "AiEvaluationTargetVersion";

-- DropTable
DROP TABLE "AiEvaluationTestCase";

-- DropTable
DROP TABLE "AiEvaluationToolCall";

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

-- CreateIndex
CREATE UNIQUE INDEX "Job_active_singleton_per_snapshot_key" ON "Job"("projectId", "snapshotId", "type") WHERE ((type IN ('ANALYSIS'::"JobType", 'SUPERTEST_COVERAGE'::"JobType")) AND ("snapshotId" IS NOT NULL) AND (status = ANY (ARRAY['QUEUED'::"JobStatus", 'RUNNING'::"JobStatus"])));

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
