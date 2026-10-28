-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SnapshotSource" AS ENUM ('ZIP', 'GITHUB');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('INGEST', 'INSTALL_DEPS', 'RUN_TESTS', 'PARSE_COVERAGE', 'BUILD_CFG', 'AI_SUGGEST', 'AI_TESTS', 'CODE_HYGIENE', 'PERFORMANCE_ANALYSIS', 'ANALYSIS', 'QUALITY_ANALYSIS', 'SECURITY_ANALYSIS', 'SUPERTEST_COVERAGE', 'RUN_VITEST_TESTS', 'VITEST_COVERAGE', 'SYSTEM_TEST_ANALYSIS', 'SYSTEM_TEST_ASSESSMENT', 'SYSTEM_TEST_IMPROVEMENT', 'SYSTEM_TEST_MUTATION', 'CYPRESS_SYSTEM_TEST', 'CYPRESS_SYSTEM_COVERAGE', 'PLAYWRIGHT_SYSTEM_TEST', 'PLAYWRIGHT_SYSTEM_COVERAGE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('JOB_FINISHED', 'AI_READY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiTestMode" AS ENUM ('SKELETON', 'FULL', 'PLAYWRIGHT_E2E');

-- CreateEnum
CREATE TYPE "AiSuggestionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TestType" AS ENUM ('JEST', 'SUPERTEST', 'PLAYWRIGHT', 'CYPRESS', 'VITEST');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('CONSOLE_LOG', 'DEBUGGER', 'TODO', 'FIXME', 'HACK');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "githubUserId" TEXT,
    "githubAccessTokenEnc" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "passwordResetExpires" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "aiUsageCount" INTEGER NOT NULL DEFAULT 0,
    "aiUsageDate" TEXT,
    "bio" TEXT,
    "jobTitle" TEXT,
    "aiTokenUsage" INTEGER NOT NULL DEFAULT 0,
    "refreshToken" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "repoUrl" TEXT,
    "defaultBranch" TEXT,
    "rootDir" TEXT,
    "jestConfigPath" TEXT,
    "storageBasePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hasJest" BOOLEAN NOT NULL DEFAULT false,
    "jestCommand" TEXT,
    "hasVitest" BOOLEAN NOT NULL DEFAULT false,
    "vitestCommand" TEXT,
    "vitestConfigPath" TEXT,
    "hasPlaywright" BOOLEAN NOT NULL DEFAULT false,
    "playwrightBrowsers" TEXT,
    "playwrightCommand" TEXT,
    "playwrightConfigPath" TEXT,
    "playwrightTestDir" TEXT,
    "hasCypress" BOOLEAN NOT NULL DEFAULT false,
    "cypressCommand" TEXT,
    "cypressConfigPath" TEXT,
    "cypressTestDir" TEXT,
    "cypressVersion" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "SnapshotSource" NOT NULL,
    "checksum" TEXT,
    "commitSha" TEXT,
    "storagePath" TEXT NOT NULL,
    "rootDir" TEXT,
    "jestConfigPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasJest" BOOLEAN NOT NULL DEFAULT false,
    "jestCommand" TEXT,
    "testingFrameworksJson" TEXT,
    "hasVitest" BOOLEAN NOT NULL DEFAULT false,
    "vitestCommand" TEXT,
    "vitestConfigPath" TEXT,
    "hasPlaywright" BOOLEAN NOT NULL DEFAULT false,
    "playwrightBrowsers" TEXT,
    "playwrightCommand" TEXT,
    "playwrightConfigPath" TEXT,
    "playwrightTestDir" TEXT,
    "hasCypress" BOOLEAN NOT NULL DEFAULT false,
    "cypressCommand" TEXT,
    "cypressConfigPath" TEXT,
    "cypressTestDir" TEXT,
    "cypressVersion" TEXT,
    "frameworkRecommendationJson" TEXT,
    "selectedTestingFramework" TEXT,

    CONSTRAINT "ProjectSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStructureAnalysis" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStructureAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityReport" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "performanceScore" DOUBLE PRECISION NOT NULL,
    "securityScore" DOUBLE PRECISION NOT NULL,
    "coverageScore" DOUBLE PRECISION NOT NULL,
    "maintainabilityScore" DOUBLE PRECISION NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "performanceDetails" TEXT NOT NULL,
    "securityDetails" TEXT NOT NULL,
    "debugReport" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "aiAvailable" BOOLEAN NOT NULL DEFAULT true,
    "aiError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "userId" TEXT,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "payloadJson" TEXT,
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computeTimeMs" INTEGER,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOutput" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stdout" TEXT,
    "stderr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageSummary" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "linesPct" DOUBLE PRECISION NOT NULL,
    "branchesPct" DOUBLE PRECISION NOT NULL,
    "funcsPct" DOUBLE PRECISION NOT NULL,
    "stmtsPct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageFile" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "linesPct" DOUBLE PRECISION NOT NULL,
    "branchesPct" DOUBLE PRECISION NOT NULL,
    "funcsPct" DOUBLE PRECISION NOT NULL,
    "stmtsPct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CoverageFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageFunction" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "functionName" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "hit" INTEGER NOT NULL,

    CONSTRAINT "CoverageFunction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cfg" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "functionName" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "graphJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cfg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cyclomatic" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "cfgId" TEXT,
    "filePath" TEXT NOT NULL,
    "functionName" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cyclomatic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiContextCache" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiContextCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "functionName" TEXT NOT NULL,
    "priority" "AiSuggestionPriority" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "mode" "AiTestMode" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VERIFIED',
    "filePath" TEXT,
    "content" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTestResult" (
    "id" TEXT NOT NULL,
    "aiTestId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "type" "TestType" NOT NULL,
    "executionMode" TEXT NOT NULL DEFAULT 'frontend',
    "totalTests" INTEGER NOT NULL,
    "passedTests" INTEGER NOT NULL,
    "failedTests" INTEGER NOT NULL,
    "flakyTests" INTEGER NOT NULL DEFAULT 0,
    "skippedTests" INTEGER NOT NULL,
    "durationMs" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "coverageLinesPct" DOUBLE PRECISION,
    "coverageBranchesPct" DOUBLE PRECISION,
    "coverageStatementsPct" DOUBLE PRECISION,
    "coverageFunctionsPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "systemMeasurement" JSONB,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestScenario" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "suiteName" TEXT,
    "status" TEXT NOT NULL,
    "durationMs" DOUBLE PRECISION,
    "failureMessages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "testFile" TEXT,
    "screenshotPath" TEXT,
    "failureStep" TEXT,
    "failureCodeSnippet" TEXT,
    "failureCategory" TEXT,
    "domSnapshot" TEXT,
    "executionDetails" JSONB,
    "coverageLinesPct" DOUBLE PRECISION,
    "coverageBranchesPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemTestFile" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "suiteCount" INTEGER NOT NULL DEFAULT 0,
    "scenarioCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PASSED',
    "durationMs" DOUBLE PRECISION,
    "coverageLinesPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemTestFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vulnerability" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vulnerability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Chat',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "useMemory" BOOLEAN NOT NULL DEFAULT true,
    "sourceSessionId" TEXT,
    "sourceSnapshotId" TEXT,
    "sourceMessageId" TEXT,
    "snapshotId" TEXT,
    "summary" TEXT,
    "summaryThroughId" TEXT,
    "contextStatus" TEXT NOT NULL DEFAULT 'READY',
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiContextSettings" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "automaticMemory" BOOLEAN NOT NULL DEFAULT false,
    "guidance" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "memoryGeneration" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiContextSettings_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectMemory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sourceMessageId" TEXT,
    "conflictsWithId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMemory_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "SystemScenario" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "scenarioKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filePath" TEXT,
    "title" TEXT NOT NULL,
    "flowJson" JSONB NOT NULL,
    "inputJson" JSONB NOT NULL,
    "expectedJson" JSONB NOT NULL,
    "criterionIds" JSONB NOT NULL,
    "reviewState" TEXT NOT NULL DEFAULT 'DRAFT',
    "requirementRevisionId" TEXT,
    "scenarioHash" TEXT NOT NULL,
    "testHash" TEXT,
    "assertionHashes" JSONB NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemRunEvent" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "runIndex" INTEGER NOT NULL,
    "scenarioKey" TEXT,
    "type" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemRunArtifact" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "scenarioKey" TEXT,
    "kind" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemRunArtifact_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubUserId_key" ON "User"("githubUserId");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_projectId_idx" ON "ProjectSnapshot"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSnapshot_projectId_checksum_key" ON "ProjectSnapshot"("projectId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSnapshot_projectId_commitSha_key" ON "ProjectSnapshot"("projectId", "commitSha");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStructureAnalysis_snapshotId_key" ON "ProjectStructureAnalysis"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityReport_snapshotId_key" ON "QualityReport"("snapshotId");

-- CreateIndex
CREATE INDEX "QualityReport_projectId_idx" ON "QualityReport"("projectId");

-- CreateIndex
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");

-- CreateIndex
CREATE INDEX "Job_snapshotId_idx" ON "Job"("snapshotId");

-- CreateIndex
CREATE INDEX "Job_status_type_idx" ON "Job"("status", "type");

-- CreateIndex
CREATE INDEX "Job_projectId_snapshotId_type_status_idx" ON "Job"("projectId", "snapshotId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Job_active_singleton_per_snapshot_key" ON "Job"("projectId", "snapshotId", "type") WHERE ((type IN ('ANALYSIS'::"JobType", 'SUPERTEST_COVERAGE'::"JobType")) AND ("snapshotId" IS NOT NULL) AND (status = ANY (ARRAY['QUEUED'::"JobStatus", 'RUNNING'::"JobStatus"])));

-- CreateIndex
CREATE INDEX "JobLog_jobId_idx" ON "JobLog"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOutput_jobId_key" ON "JobOutput"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageSummary_snapshotId_key" ON "CoverageSummary"("snapshotId");

-- CreateIndex
CREATE INDEX "CoverageFile_snapshotId_idx" ON "CoverageFile"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageFile_snapshotId_filePath_key" ON "CoverageFile"("snapshotId", "filePath");

-- CreateIndex
CREATE INDEX "CoverageFunction_snapshotId_filePath_idx" ON "CoverageFunction"("snapshotId", "filePath");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageFunction_snapshotId_filePath_functionName_startLine_key" ON "CoverageFunction"("snapshotId", "filePath", "functionName", "startLine");

-- CreateIndex
CREATE INDEX "Cfg_snapshotId_filePath_idx" ON "Cfg"("snapshotId", "filePath");

-- CreateIndex
CREATE UNIQUE INDEX "Cfg_snapshotId_filePath_functionName_startLine_key" ON "Cfg"("snapshotId", "filePath", "functionName", "startLine");

-- CreateIndex
CREATE UNIQUE INDEX "Cyclomatic_cfgId_key" ON "Cyclomatic"("cfgId");

-- CreateIndex
CREATE INDEX "Cyclomatic_snapshotId_filePath_idx" ON "Cyclomatic"("snapshotId", "filePath");

-- CreateIndex
CREATE UNIQUE INDEX "Cyclomatic_snapshotId_filePath_functionName_key" ON "Cyclomatic"("snapshotId", "filePath", "functionName");

-- CreateIndex
CREATE UNIQUE INDEX "AiContextCache_snapshotId_key" ON "AiContextCache"("snapshotId");

-- CreateIndex
CREATE INDEX "AiSuggestion_projectId_snapshotId_idx" ON "AiSuggestion"("projectId", "snapshotId");

-- CreateIndex
CREATE INDEX "AiSuggestion_snapshotId_filePath_idx" ON "AiSuggestion"("snapshotId", "filePath");

-- CreateIndex
CREATE INDEX "AiTest_projectId_snapshotId_idx" ON "AiTest"("projectId", "snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "AiTestResult_aiTestId_key" ON "AiTestResult"("aiTestId");

-- CreateIndex
CREATE INDEX "TestRun_snapshotId_idx" ON "TestRun"("snapshotId");

-- CreateIndex
CREATE INDEX "TestScenario_testRunId_idx" ON "TestScenario"("testRunId");

-- CreateIndex
CREATE INDEX "SystemTestFile_testRunId_idx" ON "SystemTestFile"("testRunId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemTestFile_testRunId_filePath_key" ON "SystemTestFile"("testRunId", "filePath");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Vulnerability_snapshotId_idx" ON "Vulnerability"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceMetric_snapshotId_key" ON "PerformanceMetric"("snapshotId");

-- CreateIndex
CREATE INDEX "ChatSession_projectId_userId_idx" ON "ChatSession"("projectId", "userId");

-- CreateIndex
CREATE INDEX "ChatSession_projectId_updatedAt_idx" ON "ChatSession"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectMemory_projectId_userId_status_idx" ON "ProjectMemory"("projectId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMemory_projectId_userId_fingerprint_key" ON "ProjectMemory"("projectId", "userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "SystemRequirementRevision_snapshotId_revisionNumber_key" ON "SystemRequirementRevision"("snapshotId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SystemAssertionBinding_revisionId_assertionId_testHash_key" ON "SystemAssertionBinding"("revisionId", "assertionId", "testHash");

-- CreateIndex
CREATE UNIQUE INDEX "SystemTestAssessment_jobId_key" ON "SystemTestAssessment"("jobId");

-- CreateIndex
CREATE INDEX "SystemTestAssessment_snapshotId_createdAt_idx" ON "SystemTestAssessment"("snapshotId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemScenario_snapshotId_reviewState_idx" ON "SystemScenario"("snapshotId", "reviewState");

-- CreateIndex
CREATE UNIQUE INDEX "SystemScenario_snapshotId_scenarioKey_key" ON "SystemScenario"("snapshotId", "scenarioKey");

-- CreateIndex
CREATE INDEX "SystemRunEvent_assessmentId_scenarioKey_idx" ON "SystemRunEvent"("assessmentId", "scenarioKey");

-- CreateIndex
CREATE UNIQUE INDEX "SystemRunEvent_assessmentId_sequence_key" ON "SystemRunEvent"("assessmentId", "sequence");

-- CreateIndex
CREATE INDEX "SystemRunArtifact_assessmentId_scenarioKey_idx" ON "SystemRunArtifact"("assessmentId", "scenarioKey");

-- CreateIndex
CREATE UNIQUE INDEX "SystemTestProposal_jobId_key" ON "SystemTestProposal"("jobId");

-- CreateIndex
CREATE INDEX "SystemTestProposal_snapshotId_state_idx" ON "SystemTestProposal"("snapshotId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SystemMutationRun_jobId_key" ON "SystemMutationRun"("jobId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStructureAnalysis" ADD CONSTRAINT "ProjectStructureAnalysis_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityReport" ADD CONSTRAINT "QualityReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityReport" ADD CONSTRAINT "QualityReport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOutput" ADD CONSTRAINT "JobOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageSummary" ADD CONSTRAINT "CoverageSummary_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageFile" ADD CONSTRAINT "CoverageFile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageFunction" ADD CONSTRAINT "CoverageFunction_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cfg" ADD CONSTRAINT "Cfg_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cyclomatic" ADD CONSTRAINT "Cyclomatic_cfgId_fkey" FOREIGN KEY ("cfgId") REFERENCES "Cfg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cyclomatic" ADD CONSTRAINT "Cyclomatic_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiContextCache" ADD CONSTRAINT "AiContextCache_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTest" ADD CONSTRAINT "AiTest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTest" ADD CONSTRAINT "AiTest_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTestResult" ADD CONSTRAINT "AiTestResult_aiTestId_fkey" FOREIGN KEY ("aiTestId") REFERENCES "AiTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestScenario" ADD CONSTRAINT "TestScenario_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestFile" ADD CONSTRAINT "SystemTestFile_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vulnerability" ADD CONSTRAINT "Vulnerability_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceMetric" ADD CONSTRAINT "PerformanceMetric_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiContextSettings" ADD CONSTRAINT "AiContextSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiContextSettings" ADD CONSTRAINT "AiContextSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMemory" ADD CONSTRAINT "ProjectMemory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMemory" ADD CONSTRAINT "ProjectMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMemory" ADD CONSTRAINT "ProjectMemory_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "SystemScenario" ADD CONSTRAINT "SystemScenario_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemRunEvent" ADD CONSTRAINT "SystemRunEvent_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemRunArtifact" ADD CONSTRAINT "SystemRunArtifact_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestProposal" ADD CONSTRAINT "SystemTestProposal_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestProposal" ADD CONSTRAINT "SystemTestProposal_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTestProposal" ADD CONSTRAINT "SystemTestProposal_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemMutationRun" ADD CONSTRAINT "SystemMutationRun_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
