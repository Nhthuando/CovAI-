-- CreateEnum
CREATE TYPE "SnapshotSource" AS ENUM ('ZIP', 'GITHUB');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('INGEST', 'INSTALL_DEPS', 'RUN_TESTS', 'PARSE_COVERAGE', 'BUILD_CFG', 'AI_SUGGEST', 'AI_TESTS');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('JOB_FINISHED', 'AI_READY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiTestMode" AS ENUM ('SKELETON', 'FULL');

-- CreateEnum
CREATE TYPE "AiSuggestionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "githubUserId" TEXT,
    "githubAccessTokenEnc" TEXT,
    "githubTokenExpiresAt" TIMESTAMP(3),
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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

    CONSTRAINT "ProjectSnapshot_pkey" PRIMARY KEY ("id")
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
    "filePath" TEXT,
    "content" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTest_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");

-- CreateIndex
CREATE INDEX "Job_snapshotId_idx" ON "Job"("snapshotId");

-- CreateIndex
CREATE INDEX "Job_status_type_idx" ON "Job"("status", "type");

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
CREATE UNIQUE INDEX "AiContextCache_snapshotId_key" ON "AiContextCache"("snapshotId");

-- CreateIndex
CREATE INDEX "AiSuggestion_projectId_snapshotId_idx" ON "AiSuggestion"("projectId", "snapshotId");

-- CreateIndex
CREATE INDEX "AiSuggestion_snapshotId_filePath_idx" ON "AiSuggestion"("snapshotId", "filePath");

-- CreateIndex
CREATE INDEX "AiTest_projectId_snapshotId_idx" ON "AiTest"("projectId", "snapshotId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOutput" ADD CONSTRAINT "JobOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageSummary" ADD CONSTRAINT "CoverageSummary_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageFile" ADD CONSTRAINT "CoverageFile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageFunction" ADD CONSTRAINT "CoverageFunction_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cfg" ADD CONSTRAINT "Cfg_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cyclomatic" ADD CONSTRAINT "Cyclomatic_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cyclomatic" ADD CONSTRAINT "Cyclomatic_cfgId_fkey" FOREIGN KEY ("cfgId") REFERENCES "Cfg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiContextCache" ADD CONSTRAINT "AiContextCache_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTest" ADD CONSTRAINT "AiTest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTest" ADD CONSTRAINT "AiTest_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
