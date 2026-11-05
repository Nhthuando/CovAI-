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

-- CreateIndex
CREATE UNIQUE INDEX "Job_active_singleton_per_snapshot_key" ON "Job"("projectId", "snapshotId", "type") WHERE ((type IN ('ANALYSIS'::"JobType", 'SUPERTEST_COVERAGE'::"JobType")) AND ("snapshotId" IS NOT NULL) AND (status = ANY (ARRAY['QUEUED'::"JobStatus", 'RUNNING'::"JobStatus"])));
