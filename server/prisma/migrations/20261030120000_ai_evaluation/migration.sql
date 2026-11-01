-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'AI_EVALUATION';
ALTER TYPE "JobType" ADD VALUE 'AI_EVALUATION_PREPARE';

-- CreateTable
CREATE TABLE "AiEvaluationTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationCredential" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AiEvaluationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationTargetVersion" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationTargetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationKnowledgeSource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationKnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationProfile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationProfileVersion" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "definitionHash" TEXT,
    "sourceManifest" JSONB NOT NULL DEFAULT '[]',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationTestCase" (
    "id" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "definitionHash" TEXT NOT NULL,

    CONSTRAINT "AiEvaluationTestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetVersionId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "jobId" TEXT NOT NULL,
    "parentRunId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL DEFAULT 'QUEUED',
    "verdict" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "manifest" JSONB NOT NULL,
    "summary" JSONB,
    "evidenceBytes" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationCaseResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "verdict" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "errorCode" TEXT,

    CONSTRAINT "AiEvaluationCaseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationAttempt" (
    "id" TEXT NOT NULL,
    "caseResultId" TEXT NOT NULL,
    "repetition" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gatewayState" TEXT NOT NULL DEFAULT 'CLOSED',
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "state" JSONB NOT NULL,
    "initialState" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "callbackCount" INTEGER NOT NULL DEFAULT 0,
    "dispatchedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiEvaluationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationToolCall" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "businessKey" TEXT,
    "sequence" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationConfirmationGrant" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "AiEvaluationConfirmationGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationCriterionResult" (
    "id" TEXT NOT NULL,
    "caseResultId" TEXT NOT NULL,
    "criterionKey" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "evaluator" JSONB NOT NULL,

    CONSTRAINT "AiEvaluationCriterionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationEvidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseResultId" TEXT,
    "attemptId" TEXT,
    "kind" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "completeness" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvaluationHumanReview" (
    "id" TEXT NOT NULL,
    "criterionResultId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationHumanReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiEvaluationTarget_projectId_idx" ON "AiEvaluationTarget"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationCredential_targetId_revision_key" ON "AiEvaluationCredential"("targetId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationTargetVersion_targetId_version_key" ON "AiEvaluationTargetVersion"("targetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationKnowledgeSource_projectId_sourceKey_version_key" ON "AiEvaluationKnowledgeSource"("projectId", "sourceKey", "version");

-- CreateIndex
CREATE INDEX "AiEvaluationProfile_projectId_idx" ON "AiEvaluationProfile"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationProfileVersion_profileId_version_key" ON "AiEvaluationProfileVersion"("profileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationTestCase_profileVersionId_caseKey_key" ON "AiEvaluationTestCase"("profileVersionId", "caseKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationRun_jobId_key" ON "AiEvaluationRun"("jobId");

-- CreateIndex
CREATE INDEX "AiEvaluationRun_executionStatus_leaseUntil_idx" ON "AiEvaluationRun"("executionStatus", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationRun_projectId_idempotencyKey_key" ON "AiEvaluationRun"("projectId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationCaseResult_runId_testCaseId_key" ON "AiEvaluationCaseResult"("runId", "testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationAttempt_requestId_key" ON "AiEvaluationAttempt"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationAttempt_tokenHash_key" ON "AiEvaluationAttempt"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationAttempt_caseResultId_repetition_key" ON "AiEvaluationAttempt"("caseResultId", "repetition");

-- CreateIndex
CREATE INDEX "AiEvaluationToolCall_attemptId_businessKey_idx" ON "AiEvaluationToolCall"("attemptId", "businessKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationToolCall_attemptId_callId_key" ON "AiEvaluationToolCall"("attemptId", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationConfirmationGrant_attemptId_requestId_key" ON "AiEvaluationConfirmationGrant"("attemptId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationCriterionResult_caseResultId_criterionKey_key" ON "AiEvaluationCriterionResult"("caseResultId", "criterionKey");

-- CreateIndex
CREATE INDEX "AiEvaluationEvidence_runId_caseResultId_idx" ON "AiEvaluationEvidence"("runId", "caseResultId");

-- CreateIndex
CREATE INDEX "AiEvaluationHumanReview_criterionResultId_createdAt_idx" ON "AiEvaluationHumanReview"("criterionResultId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiEvaluationTarget" ADD CONSTRAINT "AiEvaluationTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationCredential" ADD CONSTRAINT "AiEvaluationCredential_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AiEvaluationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationTargetVersion" ADD CONSTRAINT "AiEvaluationTargetVersion_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AiEvaluationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationTargetVersion" ADD CONSTRAINT "AiEvaluationTargetVersion_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiEvaluationCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationKnowledgeSource" ADD CONSTRAINT "AiEvaluationKnowledgeSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationProfile" ADD CONSTRAINT "AiEvaluationProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationProfileVersion" ADD CONSTRAINT "AiEvaluationProfileVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AiEvaluationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationTestCase" ADD CONSTRAINT "AiEvaluationTestCase_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "AiEvaluationProfileVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationRun" ADD CONSTRAINT "AiEvaluationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationRun" ADD CONSTRAINT "AiEvaluationRun_targetVersionId_fkey" FOREIGN KEY ("targetVersionId") REFERENCES "AiEvaluationTargetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationRun" ADD CONSTRAINT "AiEvaluationRun_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "AiEvaluationProfileVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationCaseResult" ADD CONSTRAINT "AiEvaluationCaseResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiEvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationCaseResult" ADD CONSTRAINT "AiEvaluationCaseResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "AiEvaluationTestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationAttempt" ADD CONSTRAINT "AiEvaluationAttempt_caseResultId_fkey" FOREIGN KEY ("caseResultId") REFERENCES "AiEvaluationCaseResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationToolCall" ADD CONSTRAINT "AiEvaluationToolCall_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AiEvaluationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationConfirmationGrant" ADD CONSTRAINT "AiEvaluationConfirmationGrant_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AiEvaluationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationCriterionResult" ADD CONSTRAINT "AiEvaluationCriterionResult_caseResultId_fkey" FOREIGN KEY ("caseResultId") REFERENCES "AiEvaluationCaseResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationEvidence" ADD CONSTRAINT "AiEvaluationEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiEvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationHumanReview" ADD CONSTRAINT "AiEvaluationHumanReview_criterionResultId_fkey" FOREIGN KEY ("criterionResultId") REFERENCES "AiEvaluationCriterionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
