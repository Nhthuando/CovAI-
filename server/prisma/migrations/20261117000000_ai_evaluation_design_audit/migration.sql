-- CreateTable
CREATE TABLE "AiEvaluationDesignAudit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "detected" BOOLEAN NOT NULL DEFAULT false,
    "designScore" DOUBLE PRECISION,
    "summaryJson" JSONB NOT NULL,
    "findingsJson" JSONB NOT NULL,
    "autoFillConfigJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvaluationDesignAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiEvaluationDesignAudit_projectId_snapshotId_key" ON "AiEvaluationDesignAudit"("projectId", "snapshotId");

-- CreateIndex
CREATE INDEX "AiEvaluationDesignAudit_projectId_createdAt_idx" ON "AiEvaluationDesignAudit"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiEvaluationDesignAudit" ADD CONSTRAINT "AiEvaluationDesignAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEvaluationDesignAudit" ADD CONSTRAINT "AiEvaluationDesignAudit_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
