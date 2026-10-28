/*
  Warnings:

  - A unique constraint covering the columns `[snapshotId,filePath,functionName]` on the table `Cyclomatic` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "AiContextCache" DROP CONSTRAINT "AiContextCache_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "AiSuggestion" DROP CONSTRAINT "AiSuggestion_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiSuggestion" DROP CONSTRAINT "AiSuggestion_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "AiTest" DROP CONSTRAINT "AiTest_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiTest" DROP CONSTRAINT "AiTest_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "Cfg" DROP CONSTRAINT "Cfg_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "CoverageFile" DROP CONSTRAINT "CoverageFile_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "CoverageFunction" DROP CONSTRAINT "CoverageFunction_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "CoverageSummary" DROP CONSTRAINT "CoverageSummary_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "Cyclomatic" DROP CONSTRAINT "Cyclomatic_cfgId_fkey";

-- DropForeignKey
ALTER TABLE "Cyclomatic" DROP CONSTRAINT "Cyclomatic_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "JobLog" DROP CONSTRAINT "JobLog_jobId_fkey";

-- DropForeignKey
ALTER TABLE "JobOutput" DROP CONSTRAINT "JobOutput_jobId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectSnapshot" DROP CONSTRAINT "ProjectSnapshot_projectId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiUsageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiUsageDate" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "jobTitle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Cyclomatic_snapshotId_filePath_functionName_key" ON "Cyclomatic"("snapshotId", "filePath", "functionName");

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
