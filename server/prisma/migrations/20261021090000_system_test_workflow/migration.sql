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

CREATE UNIQUE INDEX "SystemScenario_snapshotId_scenarioKey_key" ON "SystemScenario"("snapshotId", "scenarioKey");
CREATE INDEX "SystemScenario_snapshotId_reviewState_idx" ON "SystemScenario"("snapshotId", "reviewState");
CREATE UNIQUE INDEX "SystemRunEvent_assessmentId_sequence_key" ON "SystemRunEvent"("assessmentId", "sequence");
CREATE INDEX "SystemRunEvent_assessmentId_scenarioKey_idx" ON "SystemRunEvent"("assessmentId", "scenarioKey");
CREATE INDEX "SystemRunArtifact_assessmentId_scenarioKey_idx" ON "SystemRunArtifact"("assessmentId", "scenarioKey");

ALTER TABLE "SystemScenario" ADD CONSTRAINT "SystemScenario_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SystemRunEvent" ADD CONSTRAINT "SystemRunEvent_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SystemRunArtifact" ADD CONSTRAINT "SystemRunArtifact_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SystemTestAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
