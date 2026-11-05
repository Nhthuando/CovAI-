-- Additive System Test history. Existing reports/proposals remain readable.
ALTER TABLE "SystemTestAssessment" ADD COLUMN "suiteVersionId" TEXT;
ALTER TABLE "SystemRunArtifact" ADD COLUMN "runIndex" INTEGER,
 ADD COLUMN "attemptIndex" INTEGER, ADD COLUMN "stepKey" TEXT,
 ADD COLUMN "purpose" TEXT, ADD COLUMN "expiredAt" TIMESTAMP(3);
CREATE TABLE "SystemTestBlob" (
 "sha256" TEXT PRIMARY KEY, "content" TEXT NOT NULL, "byteSize" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "SystemSuiteVersion" (
 "id" TEXT PRIMARY KEY, "snapshotId" TEXT NOT NULL, "parentVersionId" TEXT,
 "restoredFromVersionId" TEXT, "sequence" INTEGER NOT NULL, "action" TEXT NOT NULL,
 "suiteHash" TEXT NOT NULL, "sourceHash" TEXT NOT NULL, "configHash" TEXT NOT NULL,
 "requirementRevisionId" TEXT, "manifestJson" JSONB NOT NULL,
 "scenarioSnapshotJson" JSONB NOT NULL, "provenanceJson" JSONB NOT NULL,
 "actorId" TEXT, "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SystemSuiteVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SystemSuiteVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "SystemSuiteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "SystemSuiteVersion_restoredFromVersionId_fkey" FOREIGN KEY ("restoredFromVersionId") REFERENCES "SystemSuiteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SystemSuiteVersion_snapshotId_sequence_key" ON "SystemSuiteVersion"("snapshotId","sequence");
CREATE UNIQUE INDEX "SystemSuiteVersion_snapshotId_requestId_key" ON "SystemSuiteVersion"("snapshotId","requestId");
CREATE TABLE "SystemSuiteState" (
 "snapshotId" TEXT PRIMARY KEY, "headVersionId" TEXT, "revision" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "SystemSuiteState_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SystemSuiteState_headVersionId_fkey" FOREIGN KEY ("headVersionId") REFERENCES "SystemSuiteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SystemSuiteState_headVersionId_key" ON "SystemSuiteState"("headVersionId");
