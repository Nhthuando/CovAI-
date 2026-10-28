-- Apply only after 20260804120000_add_analysis_job_type.
CREATE TABLE "ProjectStructureAnalysis" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStructureAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectStructureAnalysis_snapshotId_key" ON "ProjectStructureAnalysis"("snapshotId");
CREATE INDEX "Job_projectId_snapshotId_type_status_idx" ON "Job"("projectId", "snapshotId", "type", "status");

ALTER TABLE "ProjectStructureAnalysis"
  ADD CONSTRAINT "ProjectStructureAnalysis_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
