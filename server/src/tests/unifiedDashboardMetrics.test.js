import { jest } from "@jest/globals";

const mockProjectSnapshotFindUnique = jest.fn();
const mockProjectSnapshotFindMany = jest.fn();
const mockCoverageFileFindMany = jest.fn();
const mockJobFindMany = jest.fn();
const mockJobFindFirst = jest.fn().mockResolvedValue(null);
const mockJobFindUnique = jest.fn();
const mockJobUpdate = jest.fn();
const mockJobUpdateMany = jest.fn();
const mockJobLogCreate = jest.fn();
const mockAiTestFindMany = jest.fn();
const mockAiTestFindFirst = jest.fn().mockResolvedValue(null);
const mockTestRunFindMany = jest.fn();
const mockTestRunFindFirst = jest.fn().mockResolvedValue(null);
const mockCoverageSummaryFindUnique = jest.fn().mockResolvedValue(null);
const mockAiEvaluationRunFindMany = jest.fn();
const mockAiEvaluationRunFindFirst = jest.fn().mockResolvedValue(null);
const mockAiEvaluationDesignAuditFindFirst = jest.fn().mockResolvedValue(null);
const mockBuildIntegrationWorkspace = jest.fn();

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: {
    projectSnapshot: {
      findUnique: mockProjectSnapshotFindUnique,
      findMany: mockProjectSnapshotFindMany,
    },
    coverageSummary: { findUnique: mockCoverageSummaryFindUnique },
    coverageFile: { findMany: mockCoverageFileFindMany },
    job: {
      findMany: mockJobFindMany,
      findFirst: mockJobFindFirst,
      findUnique: mockJobFindUnique,
      update: mockJobUpdate,
      updateMany: mockJobUpdateMany,
    },
    jobLog: { create: mockJobLogCreate },
    aiTest: { findMany: mockAiTestFindMany, findFirst: mockAiTestFindFirst },
    testRun: { findMany: mockTestRunFindMany, findFirst: mockTestRunFindFirst },
    aiEvaluationRun: { findMany: mockAiEvaluationRunFindMany, findFirst: mockAiEvaluationRunFindFirst },
    aiEvaluationDesignAudit: { findFirst: mockAiEvaluationDesignAuditFindFirst },
  },
}));

jest.unstable_mockModule("../services/integrationWorkspace.service.js", () => ({
  buildIntegrationWorkspace: mockBuildIntegrationWorkspace,
  isMatch: jest.fn(() => false),
  isMatchSuite: jest.fn(() => false),
  discoverProjectIntegrationTests: jest.fn(async () => []),
  invalidateEndpointCache: jest.fn(),
  getIntegrationWorkspaceFingerprint: jest.fn(async () => null),
  computeIntegrationFingerprintFromData: jest.fn(() => null),
  getCachedIntegrationSummary: jest.fn(() => null),
  getIntegrationHistoryService: jest.fn(async () => []),
  extractValidatedTestRequests: jest.fn(() => []),
  parseFailureMessages: jest.fn(() => []),
  summarizeFailureMessage: jest.fn(() => ""),
  evaluateEndpointMetrics: jest.fn(() => ({})),
  classifyScenarioFailure: jest.fn(() => ({})),
  determineScenarioType: jest.fn(() => "HAPPY_PATH"),
  getClassificationReason: jest.fn(() => ""),
  isScenarioContractVerified: jest.fn(() => false),
  diagnoseApiFailureLayer: jest.fn(() => "none"),
  traceApiEndpointCoverage: jest.fn(() => ({})),
  buildApiCoverageReport: jest.fn(() => ({})),
}));

jest.unstable_mockModule("../services/projectAccess.service.js", () => ({
  resolveProjectAccess: jest.fn().mockResolvedValue({ role: "OWNER" }),
  resolveSnapshotAccess: jest.fn().mockResolvedValue({ role: "OWNER" }),
  resolveJobAccess: jest.fn().mockResolvedValue({ role: "OWNER" }),
  withProjectGuard: jest.fn(async (_opts, run) => run({})),
  getProjectInvalidationVersion: jest.fn(() => 0),
  invalidateProjectAccessCache: jest.fn(),
  membershipWhere: jest.fn(() => ({})),
  isRetryableTransactionError: jest.fn(() => false),
}));

const {
  aggregateFeatureExecutionDurations,
  buildAiEvaluationSummary,
  resolveJobDurationMs,
  classifyJobFeatureKey,
} = await import("../services/unifiedDashboardMetrics.service.js");
const {
  buildUnifiedQualityDashboard,
  computeDashboardFingerprintFromData,
  getDashboardFingerprint,
  clearUnifiedDashboardCache,
} = await import("../services/unifiedQualityDashboard.service.js");
const { updateJobStatus } = await import("../services/jobUpdate.service.js");
const { finalizeRun, processEvaluationPrepare } = await import(
  "../services/aiEvaluation/runner.service.js"
);
const { processRegrade } = await import("../services/aiEvaluation/regrade.service.js");

describe("Unified Dashboard R1/R2/R3 Metrics, Persistence & Service Contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearUnifiedDashboardCache();
  });

  describe("R2: Pure Per-Feature Duration Aggregation", () => {
    test("aggregates latest, cumulative total, and average across multiple runs and features, including AI_EVALUATION (snapshotId: null) and startedAt/finishedAt fallback", () => {
      const jobs = [
        // Unit Test Coverage: 3 runs (latest is newest finishedAt = 2400ms, total = 6000ms, avg = 2000ms)
        {
          id: "j-unit-1",
          type: "RUN_TESTS",
          status: "SUCCESS",
          snapshotId: "snap-1",
          computeTimeMs: 1200,
          startedAt: "2026-11-27T10:00:00.000Z",
          finishedAt: "2026-11-27T10:00:01.200Z",
          createdAt: "2026-11-27T10:00:00.000Z",
        },
        {
          id: "j-unit-2",
          type: "RUN_VITEST_TESTS",
          status: "FAILED",
          snapshotId: "snap-1",
          computeTimeMs: null, // fallback to finishedAt - startedAt = 2400ms
          startedAt: "2026-11-27T10:05:00.000Z",
          finishedAt: "2026-11-27T10:05:02.400Z",
          createdAt: "2026-11-27T10:05:00.000Z",
        },
        {
          id: "j-unit-3",
          type: "VITEST_COVERAGE",
          status: "SUCCESS",
          snapshotId: "snap-2",
          computeTimeMs: 2400,
          startedAt: "2026-11-27T10:10:00.000Z",
          finishedAt: "2026-11-27T10:10:02.400Z",
          createdAt: "2026-11-27T10:10:00.000Z",
        },
        // Integration AI Tests: only integration modes count; Unit FULL and System PLAYWRIGHT_E2E and malformed JSON are excluded
        {
          id: "j-ai-int-1",
          type: "AI_TESTS",
          status: "SUCCESS",
          snapshotId: "snap-1",
          payloadJson: JSON.stringify({ mode: "INTEGRATION_GENERATION" }),
          computeTimeMs: null,
          startedAt: "2026-11-27T10:12:00.000Z",
          finishedAt: "2026-11-27T10:12:05.000Z",
          createdAt: "2026-11-27T10:12:00.000Z",
        },
        {
          id: "j-ai-int-2",
          type: "AI_TESTS",
          status: "SUCCESS",
          snapshotId: "snap-1",
          payloadJson: JSON.stringify({ mode: "SUPERTEST" }),
          computeTimeMs: 3000,
          startedAt: "2026-11-27T10:13:00.000Z",
          finishedAt: "2026-11-27T10:13:03.000Z",
          createdAt: "2026-11-27T10:13:00.000Z",
        },
        {
          id: "j-ai-unit-skip",
          type: "AI_TESTS",
          status: "SUCCESS",
          snapshotId: "snap-1",
          payloadJson: JSON.stringify({ mode: "FULL" }),
          computeTimeMs: 9999,
          startedAt: "2026-11-27T10:14:00.000Z",
          finishedAt: "2026-11-27T10:14:09.999Z",
          createdAt: "2026-11-27T10:14:00.000Z",
        },
        {
          id: "j-ai-bad-json",
          type: "AI_TESTS",
          status: "SUCCESS",
          snapshotId: "snap-1",
          payloadJson: "{malformed",
          computeTimeMs: 8888,
          createdAt: "2026-11-27T10:14:30.000Z",
        },
        // AI Evaluation with snapshotId: null
        {
          id: "j-eval-1",
          type: "AI_EVALUATION",
          status: "SUCCESS",
          snapshotId: null,
          computeTimeMs: null,
          startedAt: "2026-11-27T10:20:00.000Z",
          finishedAt: "2026-11-27T10:21:00.000Z",
          createdAt: "2026-11-27T10:20:00.000Z",
        },
        // Non-terminal jobs must be ignored
        {
          id: "j-canceled",
          type: "ANALYSIS",
          status: "CANCELED",
          computeTimeMs: 500,
          createdAt: "2026-11-27T10:25:00.000Z",
        },
      ];

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const result = aggregateFeatureExecutionDurations(jobs);
      warnSpy.mockRestore();

      expect(result).toHaveLength(7);
      expect(result.map((r) => r.key)).toEqual([
        "project_analysis",
        "unit_test_coverage",
        "integration_ai_tests",
        "integration_coverage",
        "system_tests",
        "install_deps",
        "ai_evaluation",
      ]);

      const unitFeature = result.find((r) => r.key === "unit_test_coverage");
      expect(unitFeature).toMatchObject({
        label: "Unit Test Coverage",
        runCount: 3,
        latestDurationMs: 2400,
        totalDurationMs: 6000,
        avgDurationMs: 2000,
        lastStatus: "SUCCESS",
      });

      const intAiFeature = result.find((r) => r.key === "integration_ai_tests");
      expect(intAiFeature).toMatchObject({
        label: "Integration AI Tests",
        runCount: 2,
        latestDurationMs: 3000,
        totalDurationMs: 8000,
        avgDurationMs: 4000,
        lastStatus: "SUCCESS",
      });

      const aiEvalFeature = result.find((r) => r.key === "ai_evaluation");
      expect(aiEvalFeature).toMatchObject({
        label: "AI Evaluation",
        runCount: 1,
        latestDurationMs: 60000,
        totalDurationMs: 60000,
        avgDurationMs: 60000,
        lastStatus: "SUCCESS",
      });

      // Unexecuted features must explicitly report NOT_RUN and null durations
      const analysisFeature = result.find((r) => r.key === "project_analysis");
      expect(analysisFeature).toEqual({
        key: "project_analysis",
        label: "Project Analysis",
        jobTypes: ["ANALYSIS"],
        runCount: 0,
        latestDurationMs: null,
        totalDurationMs: null,
        avgDurationMs: null,
        lastRunAt: null,
        lastStatus: "NOT_RUN",
      });
    });

    test("handles 0 jobs cleanly and safely ignores unmeasurable duration rows", () => {
      const empty = aggregateFeatureExecutionDurations([]);
      expect(empty).toHaveLength(7);
      expect(empty.every((f) => f.runCount === 0 && f.lastStatus === "NOT_RUN")).toBe(true);

      expect(resolveJobDurationMs({ computeTimeMs: null, startedAt: null, finishedAt: null })).toBeNull();
      expect(classifyJobFeatureKey({ type: "AI_TESTS", payloadJson: '{"mode":"PLAYWRIGHT_E2E"}' })).toBeNull();
      expect(classifyJobFeatureKey({ type: "AI_TESTS", payloadJson: '{"mode":"SUPERTEST_REGENERATE"}' })).toBe(
        "integration_ai_tests",
      );
    });
  });

  describe("R2: Job.computeTimeMs Persistence", () => {
    test("jobUpdate.service.js computes and persists computeTimeMs on SUCCESS and FAILED transitions", async () => {
      const start = new Date("2026-11-27T11:00:00.000Z");
      const finish = new Date("2026-11-27T11:00:04.250Z");

      mockJobFindUnique.mockResolvedValueOnce({
        id: "job-up-1",
        status: "RUNNING",
        startedAt: start,
        finishedAt: null,
      });
      mockJobUpdate.mockResolvedValueOnce({
        id: "job-up-1",
        status: "SUCCESS",
        computeTimeMs: 4250,
      });

      await updateJobStatus({ jobId: "job-up-1", status: "SUCCESS", finishedAt: finish });
      expect(mockJobUpdate).toHaveBeenCalledWith({
        where: { id: "job-up-1" },
        data: expect.objectContaining({
          status: "SUCCESS",
          progress: 100,
          finishedAt: finish,
          computeTimeMs: 4250,
        }),
      });

      mockJobFindUnique.mockResolvedValueOnce({
        id: "job-up-2",
        status: "RUNNING",
        startedAt: start,
        finishedAt: null,
      });
      mockJobUpdate.mockResolvedValueOnce({
        id: "job-up-2",
        status: "FAILED",
        computeTimeMs: 4250,
      });

      await updateJobStatus({
        jobId: "job-up-2",
        status: "FAILED",
        finishedAt: finish,
        errorMessage: "boom",
      });
      expect(mockJobUpdate).toHaveBeenLastCalledWith({
        where: { id: "job-up-2" },
        data: expect.objectContaining({
          status: "FAILED",
          finishedAt: finish,
          computeTimeMs: 4250,
          errorMessage: "boom",
        }),
      });
    });

    test("aiEvaluation runner.service.js finalizeRun & processEvaluationPrepare persist Job.computeTimeMs", async () => {
      const startedAt = new Date(Date.now() - 2500);
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const fakeRun = {
        id: "run-1",
        projectId: "proj-1",
        jobId: "job-eval-1",
        executionStatus: "RUNNING",
        leaseToken: "lease-1",
        startedAt,
        manifest: { scoring: { confirmed: true, threshold: 70, taskWeights: { HAPPY_PATH: 1 } } },
        cases: [],
        evidence: [],
      };
      const fakeTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        aiEvaluationRun: {
          findUnique: jest.fn().mockResolvedValue(fakeRun),
          update: jest.fn().mockResolvedValue({ ...fakeRun, executionStatus: "COMPLETED" }),
        },
        job: {
          findUnique: jest.fn().mockResolvedValue({ payloadJson: "{}", startedAt }),
          updateMany: txUpdateMany,
        },
        aiEvaluationAttempt: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        aiEvaluationCaseResult: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      const fakeDb = {
        $transaction: jest.fn(async (fn) => fn(fakeTx)),
      };

      await finalizeRun(fakeDb, "run-1", "COMPLETED", null, "lease-1");
      expect(txUpdateMany).toHaveBeenCalledWith({
        where: { id: "job-eval-1" },
        data: expect.objectContaining({
          status: "SUCCESS",
          progress: 100,
          computeTimeMs: expect.any(Number),
        }),
      });
      const persistedComputeMs = txUpdateMany.mock.calls[0][0].data.computeTimeMs;
      expect(persistedComputeMs).toBeGreaterThanOrEqual(2000);

      // processEvaluationPrepare persists computeTimeMs on SUCCESS
      const prevEnabled = process.env.AI_EVALUATION_ENABLED;
      process.env.AI_EVALUATION_ENABLED = "true";
      try {
        const prepUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
        const prepDb = {
          job: {
            updateMany: prepUpdateMany,
            findUnique: jest.fn().mockResolvedValue({
              id: "job-prep-1",
              projectId: "proj-1",
              userId: null,
              payloadJson: JSON.stringify({ sourceId: "src-1" }),
            }),
          },
          aiEvaluationKnowledgeSource: {
            findFirst: jest.fn().mockResolvedValue({
              id: "src-1",
              name: "faq.txt",
              content: Buffer.from("Refund within 7 days", "utf8").toString("base64"),
            }),
            update: jest.fn().mockResolvedValue({ id: "src-1", status: "READY" }),
          },
        };
        await processEvaluationPrepare("job-prep-1", { db: prepDb });
        expect(prepUpdateMany).toHaveBeenLastCalledWith({
          where: { id: "job-prep-1", status: "RUNNING" },
          data: expect.objectContaining({
            status: "SUCCESS",
            progress: 100,
            computeTimeMs: expect.any(Number),
          }),
        });
      } finally {
        process.env.AI_EVALUATION_ENABLED = prevEnabled;
      }
    });

    test("aiEvaluation regrade.service.js processRegrade persists Job.computeTimeMs", async () => {
      const regradeUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const regradeRun = {
        id: "run-reg-1",
        projectId: "proj-1",
        executionStatus: "COMPLETED",
        manifest: {
          scoring: { confirmed: true, threshold: 70, taskWeights: { HAPPY_PATH: 1 } },
          additionalCriteria: [],
        },
        profileVersion: { definition: { scoring: { confirmed: true, threshold: 70, taskWeights: { HAPPY_PATH: 1 } } }, sourceManifest: [] },
        cases: [],
        evidence: [],
      };
      const fakeDb = {
        $transaction: jest.fn(async (fn) =>
          fn({
            $queryRaw: jest.fn().mockResolvedValue([]),
            aiEvaluationRun: {
              findUnique: jest.fn().mockResolvedValue(regradeRun),
              update: jest.fn().mockResolvedValue(regradeRun),
            },
          }),
        ),
        job: {
          findUnique: jest.fn().mockResolvedValue({
            id: "job-regrade-1",
            userId: null,
            status: "QUEUED",
            payloadJson: JSON.stringify({ mode: "REGRADE", regradeRunId: "run-reg-1" }),
          }),
          updateMany: regradeUpdateMany,
        },
        aiEvaluationRun: {
          findUnique: jest.fn().mockResolvedValue(regradeRun),
        },
      };

      await processRegrade("job-regrade-1", { db: fakeDb });
      expect(regradeUpdateMany).toHaveBeenLastCalledWith({
        where: { id: "job-regrade-1" },
        data: expect.objectContaining({
          status: "SUCCESS",
          progress: 100,
          computeTimeMs: expect.any(Number),
        }),
      });
    });
  });

  describe("R3: AI Trustworthiness Summary & Unified Dashboard Integration", () => {
    test("buildAiEvaluationSummary returns explicit NOT_RUN state when 0 evaluation runs exist", () => {
      const unrun = buildAiEvaluationSummary({
        runs: [],
        designAudit: {
          id: "aud-1",
          detected: true,
          designScore: 88,
          findingsJson: [{ id: "f1" }, { id: "f2" }],
        },
      });

      expect(unrun).toEqual({
        hasRun: false,
        status: "NOT_RUN",
        verdict: "NOT_RUN",
        score: null,
        rawScore: null,
        scoreHidden: false,
        passMark: null,
        criticalSafetyFailure: false,
        partial: false,
        completeness: null,
        scenarioPassRate: null,
        stability: null,
        latency: null,
        criteriaSummary: [],
        tasks: [],
        totalRuns: 0,
        latestRunId: null,
        lastRunAt: null,
        targetName: null,
        profileName: null,
        designAudit: {
          status: "READY",
          detected: true,
          designScore: 88,
          findingsCount: 2,
        },
      });
    });

    test("buildAiEvaluationSummary maps populated run metrics, representativeScore, and 5 canonical criteria", () => {
      const populated = buildAiEvaluationSummary({
        runs: [
          {
            id: "eval-run-2",
            executionStatus: "COMPLETED",
            verdict: "PASSED",
            createdAt: "2026-11-27T12:00:00.000Z",
            finishedAt: "2026-11-27T12:01:00.000Z",
            targetVersion: { version: 1, target: { name: "Support Bot" } },
            profileVersion: {
              version: 2,
              definition: { scoring: { threshold: 75 } },
              profile: { name: "Trust Profile" },
            },
            summary: {
              score: 86.4,
              verdict: "PASSED",
              criticalSafetyFailure: false,
              partial: false,
              completeness: { scored: 10, applicable: 10 },
              scenarioPassRate: {
                passed: 9,
                evaluated: 10,
                total: 10,
                wilson95: { rate: 0.9, lower: 0.596, upper: 0.982 },
              },
              stability: {
                eligibleCases: 5,
                stableCases: 4,
                unstableCases: 1,
                stabilityRate: 0.8,
              },
              latency: {
                avgMs: 920,
                p95Ms: 1450,
                slaMs: 5000,
                withinSlaRate: 1,
                status: "WITHIN_SLA",
              },
              criteriaBreakdown: [
                { criterionKey: "faithfulness", score: 92, scored: 10, applicable: 10 },
                { criterionKey: "completeness", score: 84, scored: 10, applicable: 10 },
                { criterionKey: "contextRetention", score: 88, scored: 4, applicable: 4 },
                { criterionKey: "appropriateRefusal", score: 100, scored: 3, applicable: 3 },
                { criterionKey: "keyFacts", score: 78, scored: 6, applicable: 6 },
              ],
              tasks: [{ taskType: "HAPPY_PATH", score: 90, scored: 5, applicable: 5, partial: false }],
            },
          },
        ],
      });

      expect(populated.hasRun).toBe(true);
      expect(populated.status).toBe("COMPLETED");
      expect(populated.verdict).toBe("PASSED");
      expect(populated.score).toBe(86.4);
      expect(populated.passMark).toBe(75);
      expect(populated.scenarioPassRate).toMatchObject({ passed: 9, evaluated: 10, rate: 90 });
      expect(populated.stability).toMatchObject({ eligibleCases: 5, stableCases: 4, stabilityRate: 80 });
      expect(populated.latency).toMatchObject({ avgMs: 920, p95Ms: 1450, slaMs: 5000, withinSlaRate: 100 });
      expect(populated.criteriaSummary.map((c) => c.criterionKey)).toEqual([
        "faithfulness",
        "completeness",
        "contextRetention",
        "appropriateRefusal",
        "keyFacts",
      ]);
      expect(populated.targetName).toBe("Support Bot");
      expect(populated.profileName).toBe("Trust Profile");
    });

    test("buildUnifiedQualityDashboard returns Unit-only 50/100 Grade C, featureDurations, and aiEvaluation even when AI_EVALUATION_ENABLED is false", async () => {
      const prevFlag = process.env.AI_EVALUATION_ENABLED;
      process.env.AI_EVALUATION_ENABLED = "false";

      try {
        const snapCreated = new Date("2026-11-27T09:00:00.000Z");
        mockProjectSnapshotFindUnique.mockResolvedValue({
          id: "snap-u1",
          projectId: "proj-u1",
          storagePath: "",
          rootDir: "",
          source: "ZIP",
          commitSha: "abc1234",
          createdAt: snapCreated,
          coverageSummaries: { linesPct: 100, branchesPct: 100, funcsPct: 100, stmtsPct: 100 },
          _count: { systemScenarios: 0, systemProposals: 0 },
          project: {
            id: "proj-u1",
            ownerId: "user-1",
            name: "UnitOnly App",
            defaultBranch: "main",
            lifecycleStatus: "DOING",
            lifecycleUpdatedAt: snapCreated,
            updatedAt: snapCreated,
            activeSnapshotId: "snap-u1",
            _count: { aiSuggestions: 0 },
          },
        });
        mockCoverageFileFindMany.mockResolvedValue([]);
        mockJobFindMany
          .mockResolvedValueOnce([]) // snapshotJobs
          .mockResolvedValueOnce([
            // projectTerminalJobs
            {
              id: "job-u-1",
              type: "RUN_TESTS",
              status: "SUCCESS",
              payloadJson: "{}",
              computeTimeMs: 1500,
              startedAt: "2026-11-27T09:01:00.000Z",
              finishedAt: "2026-11-27T09:01:01.500Z",
              createdAt: "2026-11-27T09:01:00.000Z",
            },
            {
              id: "job-eval-null-snap",
              type: "AI_EVALUATION",
              status: "SUCCESS",
              payloadJson: "{}",
              computeTimeMs: 4200,
              startedAt: "2026-11-27T09:05:00.000Z",
              finishedAt: "2026-11-27T09:05:04.200Z",
              createdAt: "2026-11-27T09:05:00.000Z",
            },
          ]);
        mockProjectSnapshotFindMany.mockResolvedValue([
          { id: "snap-u1", versionNumber: 1, label: null, contentHash: "1234567", commitSha: "abc1234", source: "ZIP", createdAt: snapCreated },
        ]);
        mockAiTestFindMany.mockResolvedValue([]);
        const unitRun = {
          id: "tr-u1",
          snapshotId: "snap-u1",
          type: "JEST",
          status: "PASSED",
          passedTests: 25,
          failedTests: 0,
          skippedTests: 0,
          totalTests: 25,
          durationMs: 1500,
          coverageLinesPct: 100,
          coverageBranchesPct: 100,
          coverageFuncsPct: 100,
          coverageStmtsPct: 100,
          createdAt: new Date("2026-11-27T09:01:01.500Z"),
          snapshot: { id: "snap-u1", commitSha: "abc1234", createdAt: snapCreated },
          scenarios: [],
        };
        mockTestRunFindMany
          .mockResolvedValueOnce([unitRun]) // historicalTestRuns
          .mockResolvedValueOnce([unitRun]); // snapshotSpecificRuns
        mockBuildIntegrationWorkspace.mockResolvedValue({
          endpoints: [],
          summary: { totalApis: 0, coveredApis: 0, uncoveredApis: 0, executedApis: 0, passedTests: 0, failedTests: 0 },
        });
        mockAiEvaluationRunFindMany.mockResolvedValue([
          {
            id: "eval-1",
            projectId: "proj-u1",
            snapshotId: "snap-u1",
            jobId: "job-eval-null-snap",
            executionStatus: "COMPLETED",
            verdict: "PASSED",
            createdAt: "2026-11-27T09:05:00.000Z",
            finishedAt: "2026-11-27T09:05:04.200Z",
            summary: {
              score: 91,
              verdict: "PASSED",
              completeness: { scored: 4, applicable: 4 },
              criteriaBreakdown: [{ criterionKey: "faithfulness", score: 91, scored: 4, applicable: 4 }],
              tasks: [{ taskType: "HAPPY_PATH", score: 91, scored: 4, applicable: 4, partial: false }],
            },
            targetVersion: { version: 1, target: { name: "Bot" } },
            profileVersion: { version: 1, definition: { scoring: { threshold: 80 } }, profile: { name: "Core" } },
          },
        ]);
        mockAiEvaluationDesignAuditFindFirst.mockResolvedValue(null);

        const payload = await buildUnifiedQualityDashboard({
          snapshotId: "snap-u1",
          userId: "user-1",
          forceRefresh: true,
        });

        expect(payload.health.score).toBe(50);
        expect(payload.health.grade).toBe("C");
        expect(payload.featureDurations.find((f) => f.key === "unit_test_coverage").latestDurationMs).toBe(1500);
        expect(payload.featureDurations.find((f) => f.key === "ai_evaluation").latestDurationMs).toBe(4200);
        expect(payload.aiEvaluation.hasRun).toBe(true);
        expect(payload.aiEvaluation.score).toBe(91);
        expect(payload.aiEvaluation.verdict).toBe("PASSED");
      } finally {
        process.env.AI_EVALUATION_ENABLED = prevFlag;
      }
    });

    test("computeDashboardFingerprintFromData invalidates when latestProjectJob, latestAiEvalRun, or latestDesignAudit changes", () => {
      const baseMeta = {
        id: "snap-1",
        createdAt: new Date("2026-11-27T00:00:00Z"),
        rootDir: "",
        project: { id: "proj-1", updatedAt: new Date("2026-11-27T00:00:00Z"), lifecycleStatus: "DOING" },
      };

      const fp1 = computeDashboardFingerprintFromData({ snapshotMeta: baseMeta });
      const fp2 = computeDashboardFingerprintFromData({
        snapshotMeta: baseMeta,
        latestProjectJob: { id: "j1", status: "SUCCESS", finishedAt: new Date("2026-11-27T01:00:00Z"), computeTimeMs: 120 },
      });
      const fp3 = computeDashboardFingerprintFromData({
        snapshotMeta: baseMeta,
        latestProjectJob: { id: "j1", status: "SUCCESS", finishedAt: new Date("2026-11-27T01:00:00Z"), computeTimeMs: 120 },
        latestAiEvalRun: { id: "e1", executionStatus: "COMPLETED", verdict: "PASSED", finishedAt: new Date("2026-11-27T02:00:00Z") },
      });
      const fp4 = computeDashboardFingerprintFromData({
        snapshotMeta: baseMeta,
        latestProjectJob: { id: "j1", status: "SUCCESS", finishedAt: new Date("2026-11-27T01:00:00Z"), computeTimeMs: 120 },
        latestAiEvalRun: { id: "e1", executionStatus: "COMPLETED", verdict: "PASSED", finishedAt: new Date("2026-11-27T02:00:00Z") },
        latestDesignAudit: { id: "a1", detected: true, designScore: 80, updatedAt: new Date("2026-11-27T03:00:00Z") },
      });

      expect(new Set([fp1, fp2, fp3, fp4]).size).toBe(4);
    });

    test("buildUnifiedQualityDashboard treats unmeasured Unit coverage (coverageSource='none') as null so 100% pass scores 50/100 Grade C", async () => {
      const snapCreated = new Date("2026-11-27T09:00:00.000Z");
      mockProjectSnapshotFindUnique.mockResolvedValue({
        id: "snap-u-nocov",
        projectId: "proj-u-nocov",
        storagePath: "",
        rootDir: "",
        source: "ZIP",
        commitSha: "abc1234",
        createdAt: snapCreated,
        coverageSummaries: null,
        _count: { systemScenarios: 0, systemProposals: 0 },
        project: {
          id: "proj-u-nocov",
          ownerId: "user-1",
          name: "UnitNoCov App",
          defaultBranch: "main",
          lifecycleStatus: "DOING",
          lifecycleUpdatedAt: snapCreated,
          updatedAt: snapCreated,
          activeSnapshotId: "snap-u-nocov",
          _count: { aiSuggestions: 0 },
        },
      });
      mockCoverageFileFindMany.mockResolvedValue([]);
      mockJobFindMany.mockResolvedValue([]);
      mockProjectSnapshotFindMany.mockResolvedValue([
        { id: "snap-u-nocov", versionNumber: 1, label: null, contentHash: "1234567", commitSha: "abc1234", source: "ZIP", createdAt: snapCreated },
      ]);
      mockAiTestFindMany.mockResolvedValue([]);
      const unitRunNoCov = {
        id: "tr-u-nocov",
        snapshotId: "snap-u-nocov",
        type: "JEST",
        status: "PASSED",
        passedTests: 20,
        failedTests: 0,
        skippedTests: 0,
        totalTests: 20,
        durationMs: 600,
        coverageLinesPct: null,
        coverageBranchesPct: null,
        coverageFuncsPct: null,
        coverageStmtsPct: null,
        createdAt: new Date("2026-11-27T09:01:00.000Z"),
        snapshot: { id: "snap-u-nocov", commitSha: "abc1234", createdAt: snapCreated },
        scenarios: [],
      };
      mockTestRunFindMany
        .mockResolvedValueOnce([unitRunNoCov])
        .mockResolvedValueOnce([unitRunNoCov]);
      mockBuildIntegrationWorkspace.mockResolvedValue({
        endpoints: [],
        summary: { totalApis: 0, coveredApis: 0, uncoveredApis: 0, executedApis: 0, passedTests: 0, failedTests: 0 },
      });
      mockAiEvaluationRunFindMany.mockResolvedValue([]);
      mockAiEvaluationDesignAuditFindFirst.mockResolvedValue(null);

      const payload = await buildUnifiedQualityDashboard({
        snapshotId: "snap-u-nocov",
        userId: "user-1",
        bypassCache: true,
      });

      expect(payload.pillars.unit.coverageSource).toBe("none");
      expect(payload.pillars.unit.coverageMeasured).toBe(false);
      expect(payload.health.score).toBe(50);
      expect(payload.health.grade).toBe("C");
    });

    test("getDashboardFingerprint orders terminal jobs with finishedAt NULLS LAST to prevent legacy rows shadowing newer runs", async () => {
      const snapCreated = new Date("2026-11-27T09:00:00.000Z");
      mockTestRunFindFirst.mockResolvedValue(null);
      mockProjectSnapshotFindUnique.mockResolvedValue({
        id: "snap-fp-1",
        createdAt: snapCreated,
        rootDir: "",
        project: {
          id: "proj-fp-1",
          ownerId: "user-1",
          updatedAt: snapCreated,
          lifecycleStatus: "DOING",
          lifecycleUpdatedAt: snapCreated,
          activeSnapshotId: "snap-fp-1",
        },
      });
      mockAiTestFindFirst.mockResolvedValue(null);
      mockCoverageSummaryFindUnique.mockResolvedValue(null);
      mockJobFindFirst.mockResolvedValue({
        id: "job-finished-1",
        status: "SUCCESS",
        finishedAt: new Date("2026-11-27T10:00:00.000Z"),
        computeTimeMs: 500,
        createdAt: snapCreated,
      });
      mockAiEvaluationRunFindFirst.mockResolvedValue(null);
      mockAiEvaluationDesignAuditFindFirst.mockResolvedValue(null);

      const fp = await getDashboardFingerprint("snap-fp-1");
      expect(typeof fp).toBe("string");
      expect(mockJobFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        }),
      );
    });
  });
});
