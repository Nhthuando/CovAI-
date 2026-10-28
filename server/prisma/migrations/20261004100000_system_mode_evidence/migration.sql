ALTER TABLE "TestRun" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'frontend';
ALTER TABLE "TestScenario" ADD COLUMN "screenshotPath" TEXT;
