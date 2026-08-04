DO $$ BEGIN
    CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "performanceScore" DOUBLE PRECISION NOT NULL,
    "highRiskFunctionCount" INTEGER NOT NULL,
    "averageComplexity" DOUBLE PRECISION NOT NULL,
    "coverageScore" DOUBLE PRECISION NOT NULL,
    "executionScore" DOUBLE PRECISION DEFAULT 0,
    "executionTimeMs" INTEGER DEFAULT 0,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PerformanceMetric" ADD COLUMN IF NOT EXISTS "executionScore" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "PerformanceMetric" ADD COLUMN IF NOT EXISTS "executionTimeMs" INTEGER DEFAULT 0;
ALTER TABLE "PerformanceMetric" ADD COLUMN IF NOT EXISTS "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM';

CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceMetric_snapshotId_key" ON "PerformanceMetric"("snapshotId");

DO $$ BEGIN
    ALTER TABLE "PerformanceMetric" ADD CONSTRAINT "PerformanceMetric_snapshotId_fkey"
        FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
