import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockTelemetry = {
  isRedisConnected: false,
  workerEnabled: true,
  activeWorkers: 1,
  runnerStatus: "DEGRADED",
};

const mockWarmIntegrationCache = new Map();
const mockPrisma = {
  project: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
    findUnique: jest.fn(async () => null),
    update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    updateMany: jest.fn(async () => ({ count: 0 })),
  },
  projectSnapshot: {
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
    count: jest.fn(async () => 1),
  },
  snapshotVcsBranch: {
    findMany: jest.fn(async () => []),
  },
  coverageSummary: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
  },
  coverageFile: {
    findMany: jest.fn(async () => []),
  },
  testRun: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
  },
  testScenario: {
    findMany: jest.fn(async () => []),
  },
  aiTest: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
    count: jest.fn(async () => 0),
  },
  systemScenario: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
  },
  systemTestProposal: {
    groupBy: jest.fn(async () => []),
  },
  aiEvaluationRun: {
    findFirst: jest.fn(async () => null),
  },
  aiEvaluationProjectRun: {
    findFirst: jest.fn(async () => null),
  },
  projectStructureAnalysis: {
    findMany: jest.fn(async () => []),
  },
  projectMember: {
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
  },
  job: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }) => ({ id: "job_1", ...data })),
  },
  jobLog: {
    create: jest.fn(async () => ({ id: "log_1" })),
  },
};

const mockCreateRunTestsJob = jest.fn(async ({ projectId, snapshotId }) => ({
  id: `job_${projectId}_${snapshotId}`,
  projectId,
  snapshotId,
}));
const mockAddJobToQueue = jest.fn(async () => {});
const mockEmitPortfolioRunStarted = jest.fn();
const mockEmitPortfolioProjectUpdated = jest.fn();

await jest.unstable_mockModule("../config/prisma.js", () => ({
  default: mockPrisma,
}));

await jest.unstable_mockModule("../services/queue.service.js", () => ({
  getQueueRuntimeTelemetry: () => ({ ...mockTelemetry }),
  addJobToQueue: mockAddJobToQueue,
}));

await jest.unstable_mockModule("../services/integrationWorkspace.service.js", () => ({
  getCachedIntegrationSummary: (snapshotId) => mockWarmIntegrationCache.get(snapshotId) || null,
  invalidateEndpointCache: jest.fn(),
}));

await jest.unstable_mockModule("../realtime/portfolioSocket.emitter.js", () => ({
  emitPortfolioRunStarted: mockEmitPortfolioRunStarted,
  emitPortfolioRunProgress: jest.fn(),
  emitPortfolioRunCompleted: jest.fn(),
  emitPortfolioProjectUpdated: mockEmitPortfolioProjectUpdated,
}));

const {
  buildPortfolioOverview,
  clearPortfolioCache,
} = await import("../services/portfolioDashboard.service.js");
const {
  updateProjectLifecycleStatus,
  invalidateProjectTreeMetaCache,
} = await import("../services/project.service.js");
const {
  autoTransitionProjectToDoingIfNeeded,
} = await import("../services/job.service.js");
const {
  batchRunSuitesController,
} = await import("../controllers/portfolio.controller.js");
const { PORTFOLIO_ROI_BASELINE } = await import("../../../shared/portfolioGovernance.js");

function createCountingMockDb(fixtureFactory) {
  const counts = {
    totalQueries: 0,
    byModel: {},
  };
  const calls = [];

  const wrapModel = (modelName, impls) => {
    const wrapped = {};
    for (const [op, fn] of Object.entries(impls)) {
      wrapped[op] = jest.fn(async (...args) => {
        counts.totalQueries += 1;
        counts.byModel[`${modelName}.${op}`] =
          (counts.byModel[`${modelName}.${op}`] || 0) + 1;
        calls.push({ model: modelName, op, args });
        return fn(...args);
      });
    }
    return wrapped;
  };

  const data = fixtureFactory();
  const db = {
    project: wrapModel("project", {
      findMany: async () => data.projects,
      findFirst: async () => data.projects[0] || null,
      updateMany: async () => ({ count: 1 }),
    }),
    projectSnapshot: wrapModel("projectSnapshot", {
      findMany: async ({ where }) =>
        data.snapshots.filter((s) => where.id.in.includes(s.id)),
    }),
    snapshotVcsBranch: wrapModel("snapshotVcsBranch", {
      findMany: async () => data.vcsBranches || [],
    }),
    coverageSummary: wrapModel("coverageSummary", {
      findMany: async () => data.coverageSummaries || [],
    }),
    coverageFile: wrapModel("coverageFile", {
      findMany: async () => data.coverageFiles || [],
    }),
    testRun: wrapModel("testRun", {
      findMany: async (args) => {
        if (args.distinct) return data.distinctRuns || [];
        if (args.select?.systemMeasurement) return data.systemMeasurements || [];
        return data.recentRuns || [];
      },
    }),
    testScenario: wrapModel("testScenario", {
      findMany: async () => data.testScenarios || [],
    }),
    aiTest: wrapModel("aiTest", {
      findMany: async () => data.aiTests || [],
    }),
    systemScenario: wrapModel("systemScenario", {
      findMany: async () => data.systemScenarios || [],
    }),
    systemTestProposal: wrapModel("systemTestProposal", {
      groupBy: async () => data.systemProposals || [],
    }),
    job: wrapModel("job", {
      findMany: async () => data.activeJobs || [],
    }),
    projectStructureAnalysis: wrapModel("projectStructureAnalysis", {
      findMany: async () => data.structureAnalyses || [],
    }),
  };

  return { db, counts, calls };
}

describe("Phase 1: Backend Portfolio Engine, Zero N+1, Accuracy & RBAC", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPortfolioCache();
    mockWarmIntegrationCache.clear();
    Object.assign(mockTelemetry, {
      isRedisConnected: false,
      workerEnabled: true,
      activeWorkers: 1,
      runnerStatus: "DEGRADED",
    });
  });

  it("maintains O(1) Prisma query count regardless of N (2 vs 10 projects) and uses lean selects", async () => {
    const buildProjectsFixture = (n) => () => {
      const projects = [];
      const snapshots = [];
      const distinctRuns = [];
      const coverageSummaries = [];
      const structureAnalyses = [];
      const systemMeasurements = [];
      const testScenarios = [];

      for (let i = 1; i <= n; i++) {
        const pid = `proj_${i}`;
        const sid = `snap_${i}_active`;
        projects.push({
          id: pid,
          ownerId: "user_1",
          name: `Service ${i}`,
          description: null,
          repoUrl: null,
          defaultBranch: null,
          activeSnapshotId: sid,
          activeVcsBranchId: `branch_${i}`,
          lifecycleStatus: "DOING",
          lifecycleUpdatedAt: new Date("2026-11-27T10:00:00Z"),
          isPinned: false,
          hasJest: true,
          hasVitest: false,
          hasPlaywright: true,
          hasCypress: false,
          createdAt: new Date("2026-11-20T10:00:00Z"),
          updatedAt: new Date("2026-11-27T10:00:00Z"),
          members: [],
          snapshots: [{ id: `snap_${i}_latest` }],
          _count: { snapshots: 8 },
        });
        snapshots.push({
          id: sid,
          projectId: pid,
          versionNumber: 2,
          label: null,
          contentHash: "abc123456789",
          commitSha: null,
          vcsBranchId: `branch_${i}`,
          createdAt: new Date("2026-11-25T10:00:00Z"),
          vcsBranch: { id: `branch_${i}`, name: `feat/p-${i}` },
        });
        coverageSummaries.push({
          snapshotId: sid,
          linesPct: 80,
          branchesPct: 78,
          funcsPct: 82,
          stmtsPct: 80,
        });
        distinctRuns.push(
          {
            id: `run_u_${i}`,
            snapshotId: sid,
            type: "JEST",
            totalTests: 10,
            passedTests: 10,
            failedTests: 0,
            flakyTests: 0,
            skippedTests: 0,
            durationMs: 400,
            status: "PASSED",
            coverageLinesPct: 80,
            coverageBranchesPct: 78,
            createdAt: new Date("2026-11-27T09:00:00Z"),
          },
          {
            id: `run_i_${i}`,
            snapshotId: sid,
            type: "SUPERTEST",
            totalTests: 4,
            passedTests: 4,
            failedTests: 0,
            flakyTests: 0,
            skippedTests: 0,
            durationMs: 500,
            status: "PASSED",
            coverageLinesPct: null,
            coverageBranchesPct: null,
            createdAt: new Date("2026-11-27T09:05:00Z"),
          },
          {
            id: `run_s_${i}`,
            snapshotId: sid,
            type: "PLAYWRIGHT",
            totalTests: 2,
            passedTests: 2,
            failedTests: 0,
            flakyTests: 0,
            skippedTests: 0,
            durationMs: 1200,
            status: "PASSED",
            coverageLinesPct: null,
            coverageBranchesPct: null,
            createdAt: new Date("2026-11-27T09:10:00Z"),
          },
        );
        testScenarios.push({
          testRunId: `run_i_${i}`,
          status: "passed",
          targetEndpoint: "GET /api/health",
        });
        structureAnalyses.push({
          snapshotId: sid,
          resultJson: JSON.stringify({
            integrationScan: { discoveredEndpoints: [{ method: "GET", path: "/api/health" }] },
          }),
        });
        systemMeasurements.push({
          id: `run_s_${i}`,
          snapshotId: sid,
          systemMeasurement: null,
        });
      }

      return {
        projects,
        snapshots,
        vcsBranches: projects.map((p, idx) => ({
          id: `branch_${idx + 1}`,
          projectId: p.id,
          name: `feat/p-${idx + 1}`,
          isDefault: false,
        })),
        coverageSummaries,
        distinctRuns,
        recentRuns: distinctRuns,
        testScenarios,
        structureAnalyses,
        systemMeasurements,
      };
    };

    const two = createCountingMockDb(buildProjectsFixture(2));
    const ten = createCountingMockDb(buildProjectsFixture(10));

    const res2 = await buildPortfolioOverview({ userId: "user_1", bypassCache: true, db: two.db });
    const res10 = await buildPortfolioOverview({ userId: "user_1", bypassCache: true, db: ten.db });

    expect(res2.projects).toHaveLength(2);
    expect(res10.projects).toHaveLength(10);
    expect(two.counts.totalQueries).toBeLessThanOrEqual(14);
    expect(ten.counts.totalQueries).toBe(two.counts.totalQueries);

    // Verify lean selects & zero read-time self-healing mutation
    expect(ten.db.project.updateMany).not.toHaveBeenCalled();

    const aiTestCall = ten.calls.find((c) => c.model === "aiTest" && c.op === "findMany");
    expect(aiTestCall.args[0].where).toHaveProperty("snapshotId");
    expect(aiTestCall.args[0].select.content).toBeUndefined();

    const jobCall = ten.calls.find((c) => c.model === "job" && c.op === "findMany");
    expect(jobCall.args[0].select.resultJson).toBeUndefined();
    expect(jobCall.args[0].select.payloadJson).toBeUndefined();

    const distinctRunCall = ten.calls.find(
      (c) => c.model === "testRun" && c.op === "findMany" && c.args[0].distinct,
    );
    expect(distinctRunCall.args[0].distinct).toEqual(["snapshotId", "type"]);
    expect(distinctRunCall.args[0].take).toBeUndefined();
  });

  it("resolves activeSnapshotId (>5 snapshots), real VCS/Git branches, and accurate D4/D5 formulas", async () => {
    const { db } = createCountingMockDb(() => ({
      projects: [
        // 1. Rolled-back Snapshot VCS project (Unit-only, 100% pass, 80% cov) -> activeSnapshotId is #1 of 8
        {
          id: "p_vcs",
          ownerId: "user_1",
          name: "VCS Rolled Back",
          repoUrl: null,
          defaultBranch: null,
          activeSnapshotId: "snap_v1",
          activeVcsBranchId: "br_checkout",
          lifecycleStatus: "DOING",
          lifecycleUpdatedAt: new Date("2026-11-27T10:00:00Z"),
          isPinned: false,
          hasJest: true,
          hasVitest: false,
          hasPlaywright: false,
          hasCypress: false,
          createdAt: new Date("2026-11-01T00:00:00Z"),
          updatedAt: new Date("2026-11-27T10:00:00Z"),
          members: [],
          snapshots: [{ id: "snap_v8" }],
          _count: { snapshots: 8 },
        },
        // 2. Local ZIP project with E2E without measurement (must NOT fake sysCov=sysPassRate) + skipped tests
        {
          id: "p_local",
          ownerId: "owner_other",
          name: "Local E2E No Cov",
          repoUrl: null,
          defaultBranch: null,
          activeSnapshotId: "snap_local",
          activeVcsBranchId: null,
          lifecycleStatus: "DOING",
          lifecycleUpdatedAt: new Date("2026-11-27T10:00:00Z"),
          isPinned: false,
          hasJest: false,
          hasVitest: true,
          hasPlaywright: true,
          hasCypress: false,
          createdAt: new Date("2026-11-01T00:00:00Z"),
          updatedAt: new Date("2026-11-27T10:00:00Z"),
          members: [{ role: "EDITOR" }],
          snapshots: [{ id: "snap_local" }],
          _count: { snapshots: 1 },
        },
        // 3. GitHub project UNTESTED & NOT_STARTED (excluded from DOING KPIs, branch from defaultBranch)
        {
          id: "p_git",
          ownerId: "owner_other",
          name: "Git Untested",
          repoUrl: "https://github.com/org/repo",
          defaultBranch: "develop",
          activeSnapshotId: "snap_git",
          activeVcsBranchId: null,
          lifecycleStatus: "NOT_STARTED",
          lifecycleUpdatedAt: new Date("2026-11-27T10:00:00Z"),
          isPinned: false,
          hasJest: false,
          hasVitest: false,
          hasPlaywright: false,
          hasCypress: false,
          createdAt: new Date("2026-11-01T00:00:00Z"),
          updatedAt: new Date("2026-11-27T10:00:00Z"),
          members: [{ role: "VIEWER" }],
          snapshots: [{ id: "snap_git" }],
          _count: { snapshots: 1 },
        },
      ],
      snapshots: [
        {
          id: "snap_v1",
          projectId: "p_vcs",
          versionNumber: 1,
          label: null,
          contentHash: "1111aaaa2222",
          commitSha: "appliedTx:9999999",
          vcsBranchId: "br_checkout",
          createdAt: new Date("2026-11-01T00:00:00Z"),
          vcsBranch: { id: "br_checkout", name: "feature/checkout" },
        },
        {
          id: "snap_local",
          projectId: "p_local",
          versionNumber: 1,
          label: "Initial",
          contentHash: "3333bbbb4444",
          commitSha: null,
          vcsBranchId: null,
          createdAt: new Date("2026-11-02T00:00:00Z"),
          vcsBranch: null,
        },
        {
          id: "snap_git",
          projectId: "p_git",
          versionNumber: 1,
          label: null,
          contentHash: "5555cccc6666",
          commitSha: "abcdef123456",
          vcsBranchId: null,
          createdAt: new Date("2026-11-03T00:00:00Z"),
          vcsBranch: null,
        },
      ],
      vcsBranches: [
        { id: "br_checkout", projectId: "p_vcs", name: "feature/checkout", isDefault: false },
      ],
      coverageSummaries: [
        { snapshotId: "snap_v1", linesPct: 80, branchesPct: 76, funcsPct: 85, stmtsPct: 80 },
      ],
      distinctRuns: [
        {
          id: "r_vcs_u",
          snapshotId: "snap_v1",
          type: "JEST",
          totalTests: 10,
          passedTests: 10,
          failedTests: 0,
          flakyTests: 0,
          skippedTests: 0,
          durationMs: 500,
          status: "PASSED",
          coverageLinesPct: 80,
          coverageBranchesPct: 76,
          createdAt: new Date("2026-11-27T08:00:00Z"),
        },
        {
          id: "r_loc_s",
          snapshotId: "snap_local",
          type: "PLAYWRIGHT",
          totalTests: 10,
          passedTests: 4,
          failedTests: 1,
          flakyTests: 2,
          skippedTests: 3,
          durationMs: 2500,
          status: "FAILED",
          coverageLinesPct: null,
          coverageBranchesPct: null,
          createdAt: new Date("2026-11-27T09:00:00Z"),
        },
      ],
      recentRuns: [
        {
          id: "r_vcs_u",
          snapshotId: "snap_v1",
          type: "JEST",
          totalTests: 10,
          passedTests: 10,
          failedTests: 0,
          durationMs: 500,
          status: "PASSED",
          coverageLinesPct: 80,
          createdAt: new Date("2026-11-27T08:00:00Z"),
        },
        {
          id: "r_loc_s",
          snapshotId: "snap_local",
          type: "PLAYWRIGHT",
          totalTests: 10,
          passedTests: 4,
          failedTests: 1,
          durationMs: 2500,
          status: "FAILED",
          coverageLinesPct: null,
          createdAt: new Date("2026-11-27T09:00:00Z"),
        },
      ],
      aiTests: [
        {
          id: "ai_1",
          projectId: "p_vcs",
          snapshotId: "snap_v1",
          mode: "FULL",
          status: "APPROVED",
          metaJson: JSON.stringify({
            requests: [
              { origin: "AI_GENERATED" },
              { origin: "AI_GENERATED" },
              { origin: "AI_GENERATED", repaired: true },
            ],
          }),
        },
      ],
      systemScenarios: [],
      systemProposals: [],
      activeJobs: [],
      structureAnalyses: [],
      systemMeasurements: [],
    }));

    const overview = await buildPortfolioOverview({ userId: "user_1", bypassCache: true, db });

    const vcs = overview.projects.find((p) => p.id === "p_vcs");
    const local = overview.projects.find((p) => p.id === "p_local");
    const git = overview.projects.find((p) => p.id === "p_git");

    // Snapshot & branch resolution
    expect(vcs.snapshotId).toBe("snap_v1");
    expect(vcs.snapshotVersion).toBe(1);
    expect(vcs.snapshotLabel).toBe("#1 (1111aaa)");
    expect(vcs.branch).toBe("feature/checkout");
    expect(vcs.branchSource).toBe("snapshot_vcs");
    expect(vcs.currentUserRole).toBe("OWNER");
    expect(vcs.canManageLifecycle).toBe(true);

    expect(local.branch).toBeNull();
    expect(local.branchSource).toBe("local");
    expect(local.currentUserRole).toBe("EDITOR");
    expect(local.canManageLifecycle).toBe(false);

    expect(git.branch).toBe("develop");
    expect(git.branchSource).toBe("git");
    expect(git.currentUserRole).toBe("VIEWER");
    expect(git.canManageLifecycle).toBe(false);
    expect(git.sparkline).toEqual([]); // No fabricated sparkline!

    // Unit-only re-normalized coverage & health
    expect(vcs.unifiedCoveragePct).toBe(80);
    expect(vcs.healthScore).toBe(90);
    expect(vcs.grade).toBe("A");
    expect(vcs.gateStatus).toBe("PASSED");

    // E2E without measurement does NOT fabricate sysCov = sysPassRate
    expect(local.pillars.system.coveragePct).toBeNull();
    expect(local.pillars.system.coverageMeasured).toBe(false);
    expect(local.unifiedCoveragePct).toBeNull();
    // Pass rate ignores skipped/flaky: 4 / (4 + 1) = 80.0%
    expect(local.passRatePct).toBe(80);

    // AI metaJson string parsed without APPROVED double-count
    expect(vcs.aiMetrics.aiGeneratedTests).toBe(2);
    expect(vcs.aiMetrics.aiRepairedTests).toBe(1);
    expect(vcs.timeRoi.isHeuristicEstimate).toBe(true);
    expect(vcs.timeRoi.baselineLabel).toBe(PORTFOLIO_ROI_BASELINE.label);
    expect(vcs.timeRoi.methodologyNote).not.toMatch(/IEEE\s*829/i);

    // Portfolio KPI scope: strictly DOING (2 projects), UNTESTED isolated from Critical Risk
    expect(overview.activeKpis.totalProjects).toBe(2);
    expect(overview.activeKpis.card3Scale.totalFailedTests).toBe(1); // NOT 20-14=6!
    expect(overview.activeKpis.card2Coverage.layerCoverageMeta.unit).toEqual({
      avgPct: 80,
      measuredCount: 1,
      totalKpiProjects: 2,
    });
    expect(overview.activeKpis.card2Coverage.layerCoverageMeta.system).toEqual({
      avgPct: null,
      measuredCount: 0,
      totalKpiProjects: 2,
    });
    expect(overview.lifecycleCounts.open).toBe(3);
    expect(overview.lifecycleCounts.active).toBe(2);

    // Real runnerInfrastructure telemetry (not hardcoded true / 3)
    expect(overview.runnerInfrastructure.isRedisConnected).toBe(false);
    expect(overview.runnerInfrastructure.activeWorkers).toBe(1);
    expect(overview.runnerInfrastructure.runnerStatus).toBe("DEGRADED");
  });

  it("enforces OWNER-only RBAC and blocks reverting to NOT_STARTED when project has activity", async () => {
    const buildStatusDb = ({ role = "OWNER", hasRun = false }) => ({
      project: {
        findFirst: jest.fn(async () => ({
          id: "p1",
          ownerId: role === "OWNER" ? "actor_1" : "real_owner",
          name: "Demo",
          lifecycleStatus: "DOING",
          members: role === "OWNER" ? [] : [{ role, disciplineRole: null }],
        })),
        update: jest.fn(async ({ data }) => ({
          id: "p1",
          name: "Demo",
          lifecycleStatus: data.lifecycleStatus || "DOING",
          lifecycleUpdatedAt: new Date(),
          isPinned: false,
          updatedAt: new Date(),
        })),
      },
      projectMember: {
        findUnique: jest.fn(async () =>
          role === "OWNER" ? null : { role, disciplineRole: null },
        ),
        findMany: jest.fn(async () => [{ userId: "member_2" }]),
      },
      testRun: {
        findFirst: jest.fn(async () => (hasRun ? { id: "run_1" } : null)),
      },
      coverageSummary: { findFirst: jest.fn(async () => null) },
      aiTest: { findFirst: jest.fn(async () => null) },
      systemScenario: { findFirst: jest.fn(async () => null) },
      aiEvaluationRun: { findFirst: jest.fn(async () => null) },
      aiEvaluationProjectRun: { findFirst: jest.fn(async () => null) },
      projectSnapshot: { count: jest.fn(async () => 1) },
    });

    invalidateProjectTreeMetaCache();

    // EDITOR and VIEWER cannot change lifecycle status
    for (const deniedRole of ["EDITOR", "VIEWER"]) {
      const db = buildStatusDb({ role: deniedRole });
      await expect(
        updateProjectLifecycleStatus({
          projectId: "p1",
          userId: "actor_1",
          lifecycleStatus: "PAUSED",
          db,
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: "CAPABILITY_DENIED" });
    }

    // OWNER cannot revert to NOT_STARTED when project has test/coverage/eval activity
    const activeOwnerDb = buildStatusDb({ role: "OWNER", hasRun: true });
    await expect(
      updateProjectLifecycleStatus({
        projectId: "p1",
        userId: "actor_1",
        lifecycleStatus: "NOT_STARTED",
        db: activeOwnerDb,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "CANNOT_REVERT_TO_NOT_STARTED" });

    // OWNER can transition to PAUSED and fans out socket updates to owner + members
    const okRes = await updateProjectLifecycleStatus({
      projectId: "p1",
      userId: "actor_1",
      lifecycleStatus: "PAUSED",
      db: activeOwnerDb,
    });
    expect(okRes.lifecycleStatus).toBe("PAUSED");
    expect(mockEmitPortfolioProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        lifecycleStatus: "PAUSED",
        userIds: expect.arrayContaining(["actor_1", "member_2"]),
      }),
    );
  });

  it("auto-transitions NOT_STARTED -> DOING on PLAYWRIGHT_API_COVERAGE & AI_EVALUATION and never overwrites PAUSED/COMPLETED", async () => {
    const mockDb = {
      project: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: "p1", lifecycleStatus: "NOT_STARTED", ownerId: "u1" })
          .mockResolvedValueOnce({ id: "p2", lifecycleStatus: "COMPLETED", ownerId: "u1" })
          .mockResolvedValueOnce({ id: "p3", lifecycleStatus: "PAUSED", ownerId: "u1" }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      projectMember: {
        findMany: jest.fn(async () => [{ userId: "u2" }]),
      },
    };

    await autoTransitionProjectToDoingIfNeeded("p1", mockDb);
    expect(mockDb.project.updateMany).toHaveBeenCalledTimes(1);
    expect(mockEmitPortfolioProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        lifecycleStatus: "DOING",
        userIds: ["u1", "u2"],
      }),
    );

    await autoTransitionProjectToDoingIfNeeded("p2", mockDb);
    await autoTransitionProjectToDoingIfNeeded("p3", mockDb);
    // COMPLETED & PAUSED never trigger updateMany
    expect(mockDb.project.updateMany).toHaveBeenCalledTimes(1);
  });

  it("batchRunSuitesController resolves activeSnapshotId and skips VIEWER projects", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      {
        id: "p_owner",
        name: "OwnerProj",
        ownerId: "u1",
        activeSnapshotId: "snap_active_1",
        members: [],
        snapshots: [{ id: "snap_newer_9" }],
      },
      {
        id: "p_viewer",
        name: "ViewerProj",
        ownerId: "u2",
        activeSnapshotId: "snap_v",
        members: [{ role: "VIEWER" }],
        snapshots: [{ id: "snap_v" }],
      },
    ]);
    mockPrisma.projectSnapshot.findFirst = jest.fn(async () => ({
      id: "snap_active_1",
      projectId: "p_owner",
      rootDir: "/tmp/app",
      checksum: "chk_1",
    }));
    mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
      id: "snap_active_1",
      projectId: "p_owner",
      rootDir: "/tmp/app",
    });
    mockPrisma.user = { findUnique: jest.fn(async () => ({ id: "u1" })) };
    mockPrisma.project.findFirst.mockResolvedValue({
      id: "p_owner",
      ownerId: "u1",
      name: "OwnerProj",
      workspaceRevision: 1,
      members: [],
    });
    mockPrisma.projectOperation = {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ id: "op_1", ...data })),
      update: jest.fn(async ({ data }) => ({ id: "op_1", ...data })),
    };
    mockPrisma.projectOperationRequest = {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: "opr_1" })),
    };
    mockPrisma.projectEvent = {
      create: jest.fn(async () => ({ id: "ev_1" })),
    };

    const req = { user: { id: "u1" }, body: { projectIds: ["p_owner", "p_viewer"] } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    // Use pre-check via controller directly
    await batchRunSuitesController(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.jobs).toHaveLength(1);
    expect(payload.data.jobs[0].projectId).toBe("p_owner");
    expect(mockEmitPortfolioRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p_owner",
        snapshotId: "snap_active_1",
      }),
    );
  });
});
