-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'SYSTEM_TEST_ASSESSMENT';
ALTER TYPE "JobType" ADD VALUE 'SYSTEM_TEST_IMPROVEMENT';
ALTER TYPE "JobType" ADD VALUE 'SYSTEM_TEST_MUTATION';

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "systemMeasurement" JSONB;

-- CreateTable
CREATE TABLE "SystemRequirementRevision" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contentHash" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemRequirementRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemAssertionBinding" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "testFile" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "assertionId" TEXT NOT NULL,
    "testHash" TEXT NOT NULL,
    "bindingJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "SystemAssertionBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemTestAssessment" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "testRunId" TEXT,
    "requirementRevisionId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "testHash" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "runner" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "reportJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemTestAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemTestProposal" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "baseTestHash" TEXT NOT NULL,
    "candidateTestHash" TEXT,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "proposedContent" TEXT NOT NULL,
    "verificationJson" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedByUserId" TEXT,

    CONSTRAINT "SystemTestProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMutationRun" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "manifestJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemMutationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemRequirementRevision_snapshotId_revisionNumber_key" ON "SystemRequirementRevision"("snapshotId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SystemAssertionBinding_revisionId_assertionId_testHash_key" ON "SystemAssertionBinding"("revisionId", "assertionId", "testHash");

-- CreateIndex
CREATE UNIQUE INDEX "SystemTestAssessment_jobId_key" ON "SystemTestAssessment"("jobId");

-- CreateIndex
CREATE INDEX "SystemTestAssessment_snapshotId_createdAt_idx" ON "SystemTestAssessment"("snapshotId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemTestProposal_jobId_key" ON "SystemTestProposal"("jobId");

-- CreateIndex
CREATE INDEX "SystemTestProposal_snapshotId_state_idx" ON "SystemTestProposal"("snapshotId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SystemMutationRun_jobId_key" ON "SystemMutationRun"("jobId");

-- AddForeignKey
ALTER TABLE "SystemRequirementRevision" ADD CONSTRAINT "SystemRequirementRevision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemRequirementRevision" ADD CONSTRAINT "SystemRequirementRevision_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemAssertionBinding" ADD CONSTRAINT "SystemAssertionBinding_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SystemRequirementRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemAssertionBinding" ADD CONSTRAINT "SystemAssertionBinding_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestAssessment" ADD CONSTRAINT "SystemTestAssessment_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestAssessment" ADD CONSTRAINT "SystemTestAssessment_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestAssessment" ADD CONSTRAINT "SystemTestAssessment_requirementRevisionId_fkey" FOREIGN KEY ("requirementRevisionId") REFERENCES "SystemRequirementRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestProposal" ADD CONSTRAINT "SystemTestProposal_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestProposal" ADD CONSTRAINT "SystemTestProposal_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestProposal" ADD CONSTRAINT "SystemTestProposal_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemMutationRun" ADD CONSTRAINT "SystemMutationRun_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
