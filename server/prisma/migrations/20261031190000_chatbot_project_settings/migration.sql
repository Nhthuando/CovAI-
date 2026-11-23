CREATE TABLE "AiEvaluationProjectSettings" (
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "settings" JSONB NOT NULL,
    "encryptedEnvironment" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiEvaluationProjectSettings_pkey" PRIMARY KEY ("projectId"),
    CONSTRAINT "AiEvaluationProjectSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Preserve the latest submitted configuration; ciphertext stays encrypted.
INSERT INTO "AiEvaluationProjectSettings" ("projectId", "revision", "settings", "encryptedEnvironment", "updatedAt")
SELECT DISTINCT ON ("projectId") "projectId", 1,
  jsonb_build_object('snapshotId', "snapshotId", 'candidateId', "configuration"->'candidateId', 'judgeConsent', COALESCE("configuration"->'judgeConsent', 'false'::jsonb), 'environmentNames', COALESCE("configuration"->'environmentNames', '[]'::jsonb)),
  "encryptedEnvironment", CURRENT_TIMESTAMP
FROM "AiEvaluationProjectRun"
ORDER BY "projectId", "createdAt" DESC;
