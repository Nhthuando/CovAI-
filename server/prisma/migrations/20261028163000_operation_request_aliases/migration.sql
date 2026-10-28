BEGIN;
CREATE TABLE "ProjectOperationRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectOperationRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectOperationRequest_projectId_actorId_requestId_key"
    ON "ProjectOperationRequest" ("projectId", "actorId", "requestId");
CREATE INDEX "ProjectOperationRequest_operationId_idx" ON "ProjectOperationRequest" ("operationId");
ALTER TABLE "ProjectOperationRequest" ADD CONSTRAINT "ProjectOperationRequest_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectOperationRequest" ADD CONSTRAINT "ProjectOperationRequest_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectOperationRequest" ADD CONSTRAINT "ProjectOperationRequest_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "ProjectOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Preserve pre-alias idempotency keys without changing operations or jobs.
-- Deleted actors have no authenticated identity to retry, so omit those rows.
INSERT INTO "ProjectOperationRequest" ("id", "projectId", "actorId", "requestId", "operationId", "createdAt")
SELECT 'request_' || "id", "projectId", "actorId", "requestId", "id", "createdAt"
FROM "ProjectOperation" WHERE "actorId" IS NOT NULL;
COMMIT;
