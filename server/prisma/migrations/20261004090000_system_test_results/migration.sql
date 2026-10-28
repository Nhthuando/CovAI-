ALTER TABLE "TestRun" ADD COLUMN IF NOT EXISTS "flakyTests" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "TestScenario" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "suiteName" TEXT,
    "status" TEXT NOT NULL,
    "durationMs" DOUBLE PRECISION,
    "failureMessages" TEXT[] NOT NULL,
    "testFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestScenario_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TestScenario_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TestScenario_testRunId_idx" ON "TestScenario"("testRunId");
