-- Run this file manually OUTSIDE a Prisma migration transaction after the enum
-- and table migrations have been applied. Do not enable ANALYSIS jobs until it
-- completes successfully.

-- Duplicate preflight: this must return zero rows before index creation.
SELECT "projectId", "snapshotId", "type", count(*) AS active_job_count
FROM "Job"
WHERE "type" = 'ANALYSIS'
  AND "snapshotId" IS NOT NULL
  AND "status" IN ('QUEUED', 'RUNNING')
GROUP BY "projectId", "snapshotId", "type"
HAVING count(*) > 1;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Job_active_analysis_per_snapshot_key"
ON "Job" ("projectId", "snapshotId", "type")
WHERE "type" = 'ANALYSIS'
  AND "snapshotId" IS NOT NULL
  AND "status" IN ('QUEUED', 'RUNNING');

-- If concurrent creation fails, inspect pg_index for an invalid index, then:
-- DROP INDEX CONCURRENTLY IF EXISTS "Job_active_analysis_per_snapshot_key";
-- Resolve duplicate active jobs and rerun this operational script. Never remove
-- the ANALYSIS enum value as part of code rollback.
