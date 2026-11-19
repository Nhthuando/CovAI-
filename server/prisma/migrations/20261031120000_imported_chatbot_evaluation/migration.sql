-- CreateTable
CREATE TABLE "AiEvaluationProjectRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "evaluationRunId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT NOT NULL DEFAULT 'CHECKING',
    "configuration" JSONB NOT NULL,
    "encryptedEnvironment" TEXT,
    "discovery" JSONB,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiEvaluationProjectRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationProjectRun_jobId_key" ON "AiEvaluationProjectRun"("jobId");

-- CreateIndex
CREATE INDEX "AiEvaluationProjectRun_status_leaseUntil_idx" ON "AiEvaluationProjectRun"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "AiEvaluationProjectRun_projectId_createdAt_idx" ON "AiEvaluationProjectRun"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationProjectRun_projectId_idempotencyKey_key" ON "AiEvaluationProjectRun"("projectId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AiEvaluationProjectRun" ADD CONSTRAINT "AiEvaluationProjectRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
