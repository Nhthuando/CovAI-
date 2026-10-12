-- Additive: existing scenarios retain NULL and remain readable.
ALTER TABLE "TestScenario" ADD COLUMN "executionDetails" JSONB;
