ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CODE_HYGIENE';

CREATE TYPE "IssueType" AS ENUM ('CONSOLE_LOG', 'DEBUGGER', 'TODO', 'FIXME', 'HACK');
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

CREATE TABLE "CodeHygieneIssue" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "column" INTEGER NOT NULL,
    "type" "IssueType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "message" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeHygieneIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodeHygieneSummary" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "totalIssues" INTEGER NOT NULL,
    "infoCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "highCount" INTEGER NOT NULL,
    "criticalCount" INTEGER NOT NULL,
    "hygieneScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeHygieneSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodeHygieneSummary_snapshotId_key" ON "CodeHygieneSummary"("snapshotId");
CREATE INDEX "CodeHygieneIssue_snapshotId_idx" ON "CodeHygieneIssue"("snapshotId");

ALTER TABLE "CodeHygieneIssue" ADD CONSTRAINT "CodeHygieneIssue_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodeHygieneSummary" ADD CONSTRAINT "CodeHygieneSummary_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
