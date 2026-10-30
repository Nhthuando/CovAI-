-- Additive compatibility for develop's Integration Test traceability.
-- Existing installations may already contain these fields; preserve their data.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'PLAYWRIGHT_API_COVERAGE';
ALTER TYPE "TestType" ADD VALUE IF NOT EXISTS 'PLAYWRIGHT_API';
ALTER TABLE "TestScenario"
  ADD COLUMN IF NOT EXISTS "targetEndpoint" TEXT,
  ADD COLUMN IF NOT EXISTS "failureLayer" TEXT,
  ADD COLUMN IF NOT EXISTS "responseStatus" INTEGER,
  ADD COLUMN IF NOT EXISTS "responseData" JSONB,
  ADD COLUMN IF NOT EXISTS "isFaultyExistingTest" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "TestScenario_targetEndpoint_idx" ON "TestScenario"("targetEndpoint");
