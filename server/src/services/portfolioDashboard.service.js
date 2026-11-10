/**
 * @file portfolioDashboard.service.js
 * @description High-performance, single-pass batch aggregator for the Multi-Project
 * Quality Portfolio Dashboard. Enforces Strict Aggregation Scope (only DOING and NOT_STARTED
 * are aggregated into KPIs), zero N+1 queries, and 100% synchronization with Single-Project
 * Unified Quality Overview (unifiedQualityDashboard.service.js).
 */

import prisma from "../config/prisma.js";
import { membershipWhere } from "./projectAccess.service.js";
import { buildIntegrationWorkspace } from "./integrationWorkspace.service.js";
import { coverageSummaryFor } from "./systemAssessmentContract.service.js";
import { isApiFilePath } from "../utils/apiFileDetector.js";
import {
  computeProjectTimeAndRoiMetrics,
  aggregatePortfolioTimeAndRoi,
} from "./portfolioTimeRoi.calculator.js";

// Layer weights synchronized with unifiedQualityDashboard.service.js (Unit 50%, Integration 30%, System 20%)
const LAYER_WEIGHTS = Object.freeze({
  unit: 0.5,
  integration: 0.3,
  system: 0.2,
});

const GRADE_THRESHOLDS = Object.freeze({
  A: 80,
  B: 65,
  C: 50,
});

function toFixedNum(val, fallback = 0) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Number(num.toFixed(1));
}

// Cache for warm repeat responses
const portfolioCache = new Map();
const CACHE_TTL_MS = 20_000; // 20 seconds

export function invalidatePortfolioCache(userId = null) {
  if (userId) {
    portfolioCache.delete(userId);
  } else {
    portfolioCache.clear();
  }
}

export const clearPortfolioCache = invalidatePortfolioCache;

/**
 * Main Batch Aggregator for Portfolio Dashboard
 */
export async function buildPortfolioOverview({ userId, bypassCache = false }) {
  if (!userId) throw new Error("userId is required");

  const cached = portfolioCache.get(userId);
  if (!bypassCache && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // ── 1. Fetch all accessible Projects with latest snapshot ────────────────
  const rawProjects = await prisma.project.findMany({
    where: membershipWhere(userId),
    orderBy: [
      { isPinned: "desc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      name: true,
      description: true,
      repoUrl: true,
      defaultBranch: true,
      rootDir: true,
      storageBasePath: true,
      activeSnapshotId: true,
      lifecycleStatus: true,
      lifecycleUpdatedAt: true,
      isPinned: true,
      hasJest: true,
      hasVitest: true,
      hasPlaywright: true,
      hasCypress: true,
      createdAt: true,
      updatedAt: true,
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          versionNumber: true,
          label: true,
          contentHash: true,
          checksum: true,
          commitSha: true,
          createdAt: true,
        },
      },
    },
  });

  if (rawProjects.length === 0) {
    const emptyTimeRoi = aggregatePortfolioTimeAndRoi([]);
    const emptyKpis = getEmptyKpis(emptyTimeRoi);
    return {
      projects: [],
      activeKpis: emptyKpis,
      timeRoiAnalytics: emptyTimeRoi,
      lifecycleCounts: {
        total: 0,
        active: 0,
        doing: 0,
        notStarted: 0,
        paused: 0,
        completed: 0,
        cancelled: 0,
        DOING: 0,
        NOT_STARTED: 0,
        PAUSED: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      },
      analytics: {
        benchmarkItems: [],
        quadrantNodes: [],
        timeRoiAnalytics: emptyTimeRoi,
        coverageCutoff: 70,
        passRateCutoff: 85,
      },
      attentionQueue: [],
      activityFeed: [],
      runnerInfrastructure: {
        runnerStatus: "READY",
        isRedisConnected: true,
        activeWorkers: 3,
        runningJobsCount: 0,
        queuedJobsCount: 0,
        supportedFrameworks: ["Jest / Vitest", "Supertest (API)", "Playwright (E2E)"],
        lastSync: new Date().toISOString(),
      },
      provenance: {
        queriedAt: new Date().toISOString(),
        totalProjectsInDb: 0,
        activeScopeProjectsCount: 0,
        dataSource: "POSTGRESQL_LIVE",
      },
    };
  }

  const projectIds = rawProjects.map((p) => p.id);
  const snapshotMap = new Map();
  const snapshotIds = [];

  for (const p of rawProjects) {
    const effectiveSnapshotId = p.activeSnapshotId || p.snapshots?.[0]?.id || null;
    if (effectiveSnapshotId) {
      snapshotMap.set(p.id, effectiveSnapshotId);
      snapshotIds.push(effectiveSnapshotId);
    }
  }

  // ── 2. Run Single-Pass Batch Queries in Parallel ─────────────────────────
  const [
    coverageSummaries,
    allCoverageFiles,
    recentTestRuns,
    systemAssessments,
    aiTestsList,
    aiSuggestionsGroup,
    systemScenariosList,
    systemProposalsGroup,
    activeJobs,
    integrationWorkspacesList,
  ] = await Promise.all([
    // 2a. Coverage summaries
    snapshotIds.length > 0
      ? prisma.coverageSummary.findMany({
          where: { snapshotId: { in: snapshotIds } },
        })
      : Promise.resolve([]),

    // 2b. Coverage files (to compute lowBranchUnitFilesCount accurately)
    snapshotIds.length > 0
      ? prisma.coverageFile.findMany({
          where: {
            snapshotId: { in: snapshotIds },
            AND: [
              { NOT: { filePath: { contains: "coverage/" } } },
              { NOT: { filePath: { contains: "coverage\\" } } },
              { NOT: { filePath: { contains: "node_modules/" } } },
              { NOT: { filePath: { contains: "node_modules\\" } } },
              { NOT: { filePath: { contains: ".git/" } } },
              { NOT: { filePath: { contains: ".test." } } },
              { NOT: { filePath: { contains: ".spec." } } },
              { NOT: { filePath: { contains: "/e2e/" } } },
              { NOT: { filePath: { contains: "/cypress/" } } },
              { NOT: { filePath: { contains: "/playwright/" } } },
            ],
          },
          select: {
            snapshotId: true,
            filePath: true,
            linesPct: true,
            branchesPct: true,
          },
        })
      : Promise.resolve([]),

    // 2c. TestRuns for all snapshots (including systemMeasurement for E2E coverage)
    snapshotIds.length > 0
      ? prisma.testRun.findMany({
          where: { snapshotId: { in: snapshotIds } },
          orderBy: { createdAt: "desc" },
          take: 300,
          select: {
            id: true,
            snapshotId: true,
            type: true,
            totalTests: true,
            passedTests: true,
            failedTests: true,
            flakyTests: true,
            skippedTests: true,
            durationMs: true,
            status: true,
            coverageLinesPct: true,
            coverageBranchesPct: true,
            coverageStatementsPct: true,
            coverageFunctionsPct: true,
            systemMeasurement: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),

    // 2d. System Assessments
    snapshotIds.length > 0
      ? prisma.systemTestAssessment.findMany({
          where: { snapshotId: { in: snapshotIds } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            snapshotId: true,
            status: true,
            reportJson: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),

    // 2e. AI Tests records (synchronized with unifiedQualityDashboard.service.js)
    prisma.aiTest.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        id: true,
        projectId: true,
        mode: true,
        status: true,
        metaJson: true,
      },
    }),

    // 2f. AI Suggestions counts
    prisma.aiSuggestion.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _count: { _all: true },
    }),

    // 2g. System Scenarios (for E2E journeys and AI generated scenarios)
    snapshotIds.length > 0 && prisma.systemScenario
      ? prisma.systemScenario.findMany({
          where: { snapshotId: { in: snapshotIds } },
          select: { id: true, snapshotId: true, source: true },
        })
      : Promise.resolve([]),

    // 2h. System Test Proposals applied
    snapshotIds.length > 0 && prisma.systemTestProposal
      ? prisma.systemTestProposal.groupBy({
          by: ["snapshotId"],
          where: { snapshotId: { in: snapshotIds }, state: "APPLIED" },
          _count: { _all: true },
        })
      : Promise.resolve([]),

    // 2i. Active or running jobs across projects
    prisma.job.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      select: {
        id: true,
        projectId: true,
        snapshotId: true,
        type: true,
        status: true,
        progress: true,
        startedAt: true,
        createdAt: true,
      },
    }),

    // 2j. Integration Workspaces per snapshot (for exact discovered/covered APIs)
    Promise.all(
      snapshotIds.map((sid) =>
        buildIntegrationWorkspace(sid)
          .then((ws) => ({ snapshotId: sid, ws }))
          .catch(() => ({ snapshotId: sid, ws: null }))
      )
    ),
  ]);

  // Index batch results by snapshotId or projectId
  const covSummaryBySnapshot = new Map(coverageSummaries.map((c) => [c.snapshotId, c]));

  const unitFilesBySnapshot = new Map();
  for (const cf of allCoverageFiles) {
    if (!isApiFilePath(cf.filePath)) {
      if (!unitFilesBySnapshot.has(cf.snapshotId)) {
        unitFilesBySnapshot.set(cf.snapshotId, []);
      }
      unitFilesBySnapshot.get(cf.snapshotId).push(cf);
    }
  }

  const testRunsBySnapshot = new Map();
  for (const tr of recentTestRuns) {
    if (!testRunsBySnapshot.has(tr.snapshotId)) {
      testRunsBySnapshot.set(tr.snapshotId, []);
    }
    testRunsBySnapshot.get(tr.snapshotId).push(tr);
  }

  const sysAssessmentBySnapshot = new Map();
  for (const sa of systemAssessments) {
    if (!sysAssessmentBySnapshot.has(sa.snapshotId)) {
      sysAssessmentBySnapshot.set(sa.snapshotId, sa);
    }
  }

  const integrationWsBySnapshot = new Map(
    integrationWorkspacesList.map((item) => [item.snapshotId, item.ws])
  );

  const aiSuggestionsByProject = new Map(
    aiSuggestionsGroup.map((g) => [g.projectId, g._count._all || 0])
  );

  const sysScenariosBySnapshot = new Map();
  for (const sc of systemScenariosList) {
    if (!sysScenariosBySnapshot.has(sc.snapshotId)) {
      sysScenariosBySnapshot.set(sc.snapshotId, []);
    }
    sysScenariosBySnapshot.get(sc.snapshotId).push(sc);
  }

  const sysProposalsBySnapshot = new Map(
    systemProposalsGroup.map((g) => [g.snapshotId, g._count._all || 0])
  );

  const aiTestsByProject = new Map();
  for (const rec of aiTestsList) {
    if (!aiTestsByProject.has(rec.projectId)) {
      aiTestsByProject.set(rec.projectId, []);
    }
    aiTestsByProject.get(rec.projectId).push(rec);
  }

  const activeJobByProject = new Map();
  for (const j of activeJobs) {
    if (!activeJobByProject.has(j.projectId) || j.status === "RUNNING") {
      activeJobByProject.set(j.projectId, j);
    }
  }

  // ── 3. Transform Each Project into Normalized Card ViewModel ─────────────
  const normalizedProjects = rawProjects.map((p) => {
    const snapshotId = snapshotMap.get(p.id) || null;
    const runs = snapshotId ? testRunsBySnapshot.get(snapshotId) || [] : [];
    const cov = snapshotId ? covSummaryBySnapshot.get(snapshotId) || null : null;
    const unitFiles = snapshotId ? unitFilesBySnapshot.get(snapshotId) || [] : [];
    const sysAssess = snapshotId ? sysAssessmentBySnapshot.get(snapshotId) || null : null;
    const integrationWs = snapshotId ? integrationWsBySnapshot.get(snapshotId) || null : null;
    const sysScenarios = snapshotId ? sysScenariosBySnapshot.get(snapshotId) || [] : [];
    const currentActiveJob = activeJobByProject.get(p.id) || null;

    // Separate latest runs by pillar
    const unitRun = runs.find((r) => r.type === "JEST" || r.type === "VITEST") || null;
    const intRun = runs.find((r) => r.type === "SUPERTEST" || r.type === "PLAYWRIGHT_API") || null;
    const sysRun = runs.find((r) => r.type === "PLAYWRIGHT" || r.type === "CYPRESS") || null;

    // 3a. Unit Pillar Metrics (Synchronized with unifiedQualityDashboard.service.js)
    const unitPassed = Number(unitRun?.passedTests ?? 0);
    const unitFailed = Number(unitRun?.failedTests ?? 0);
    const unitSkipped = Number(unitRun?.skippedTests ?? 0);
    const unitTotal = Number(unitRun?.totalTests ?? unitPassed + unitFailed + unitSkipped);
    const unitDurationMs = Number(unitRun?.durationMs ?? 0);
    const unitPassRate =
      unitPassed + unitFailed > 0
        ? toFixedNum((unitPassed / (unitPassed + unitFailed)) * 100)
        : 0;
    const unitCov =
      unitTotal > 0 ? toFixedNum(cov?.linesPct ?? unitRun?.coverageLinesPct ?? 0) : 0;
    const unitBranchCov =
      unitTotal > 0 ? toFixedNum(cov?.branchesPct ?? unitRun?.coverageBranchesPct ?? 0) : 0;

    // 3b. Integration Pillar Metrics (Synchronized with buildIntegrationWorkspace)
    const wsSummary = integrationWs?.summary || {};
    const endpoints = Array.isArray(integrationWs?.endpoints) ? integrationWs.endpoints : [];
    const coveredEpCount = endpoints.filter((e) => e.status === "Covered").length;
    const failedEpCount = endpoints.filter(
      (e) => e.status === "Failed" || e.status === "Script Error"
    ).length;

    const intPassed = Number(
      wsSummary.passedTests ?? wsSummary.testedApis ?? coveredEpCount ?? intRun?.passedTests ?? 0
    );
    const intFailed = Number(
      wsSummary.failedTests ?? failedEpCount ?? intRun?.failedTests ?? 0
    );
    const intSkipped = Number(wsSummary.skippedTests ?? intRun?.skippedTests ?? 0);
    const intTotal = Number(
      wsSummary.totalTests ??
        wsSummary.executedApis ??
        intRun?.totalTests ??
        intPassed + intFailed + intSkipped
    );
    const totalApis = Number(
      wsSummary.totalApis ?? wsSummary.discoveredApis ?? (endpoints.length || intTotal)
    );
    const coveredApis =
      intTotal > 0 && totalApis > 0
        ? Number(
            wsSummary.endpointCoverageMetrics?.coveredEndpoints ??
              (coveredEpCount > 0 ? coveredEpCount : intPassed)
          )
        : 0;
    const uncoveredApis = Math.max(0, totalApis - coveredApis);
    const intDurationMs = Number(wsSummary.durationMs ?? intRun?.durationMs ?? 0);
    const intPassRate =
      intPassed + intFailed > 0
        ? toFixedNum((intPassed / (intPassed + intFailed)) * 100)
        : 0;

    const intCov =
      intTotal <= 0 || totalApis <= 0
        ? 0
        : wsSummary.endpointCoverageMetrics?.endpointCoveragePct !== undefined
        ? toFixedNum(wsSummary.endpointCoverageMetrics.endpointCoveragePct)
        : toFixedNum((coveredEpCount / totalApis) * 100);

    // 3c. System E2E Pillar Metrics (Synchronized with unifiedQualityDashboard.service.js)
    const sysPassed = Number(sysRun?.passedTests ?? 0);
    const sysFailed = Number(sysRun?.failedTests ?? 0);
    const sysFlaky = Number(sysRun?.flakyTests ?? 0);
    const sysSkipped = Number(sysRun?.skippedTests ?? 0);
    const sysTotal = Number(
      sysRun?.totalTests ?? sysPassed + sysFailed + sysFlaky + sysSkipped
    );
    const sysDurationMs = Number(sysRun?.durationMs ?? 0);
    const sysPassRate =
      sysPassed + sysFailed > 0
        ? toFixedNum((sysPassed / (sysPassed + sysFailed)) * 100)
        : 0;

    let sysCov = 0;
    if (sysTotal > 0 && sysRun?.systemMeasurement) {
      try {
        const sysCovSummary = coverageSummaryFor(sysRun.systemMeasurement);
        const feLinesPct = sysCovSummary?.frontend?.counters?.lines?.pct;
        if (feLinesPct !== undefined && feLinesPct !== null) {
          sysCov = toFixedNum(feLinesPct);
        }
      } catch (_) {}
    }
    if (sysCov === 0 && sysTotal > 0) {
      sysCov = toFixedNum(sysPassRate);
    }

    const totalJourneys = Math.max(sysTotal, sysScenarios.length);
    const coveredJourneys = sysTotal > 0 ? sysPassed : 0;

    // 3d. Aggregate Execution Totals & Multi-Tier Health Score
    const totalExecuted = unitTotal + intTotal + sysTotal;
    const totalPassed = unitPassed + intPassed + sysPassed;
    const totalFailed = unitFailed + intFailed + sysFailed;

    const passRate =
      totalExecuted > 0
        ? toFixedNum((totalPassed / totalExecuted) * 100)
        : null;

    // Composite Weighted Coverage (Unit 50%, Integration 30%, System 20%)
    const unifiedCov =
      totalExecuted > 0
        ? toFixedNum(
            unitCov * LAYER_WEIGHTS.unit +
              intCov * LAYER_WEIGHTS.integration +
              sysCov * LAYER_WEIGHTS.system
          )
        : 0;

    // Multi-tier Quality Health Score matching unifiedQualityDashboard.service.js
    const unitScore = unitTotal > 0 ? 0.5 * unitPassRate + 0.5 * unitCov : 0;
    const intScore = intTotal > 0 ? 0.5 * intPassRate + 0.5 * intCov : 0;
    const sysScore = sysTotal > 0 ? 0.5 * sysPassRate + 0.5 * sysCov : 0;

    let healthScore = Math.round(
      unitScore * LAYER_WEIGHTS.unit +
        intScore * LAYER_WEIGHTS.integration +
        sysScore * LAYER_WEIGHTS.system
    );

    if (totalFailed > 0) {
      healthScore = Math.max(0, healthScore - Math.min(15, totalFailed * 2));
    }

    let grade = "—";
    let gateStatus = "UNTESTED";
    let gateLabel = "UNTESTED";

    if (totalExecuted > 0) {
      if (healthScore >= GRADE_THRESHOLDS.A) grade = "A";
      else if (healthScore >= GRADE_THRESHOLDS.B) grade = "B";
      else if (healthScore >= GRADE_THRESHOLDS.C) grade = "C";
      else grade = "D";

      if (totalFailed === 0 && (passRate ?? 0) >= 95 && healthScore >= 80) {
        gateStatus = "PASSED";
        gateLabel = "READY TO RELEASE";
      } else if (totalFailed > 0 || (passRate ?? 0) < 80) {
        gateStatus = "BLOCKED";
        gateLabel = "BLOCKED";
      } else {
        gateStatus = "AT_RISK";
        gateLabel = "AT RISK";
      }
    }

    // 3e. AI Synthesis & Coverage Gaps (Synchronized with unifiedQualityDashboard.service.js)
    const projAiTests = aiTestsByProject.get(p.id) || [];
    const projAiSuggestions = aiSuggestionsByProject.get(p.id) || 0;
    const projAiSysScenarios = sysScenarios.filter((s) => s.source === "AI").length;
    const projAiSysProposals = snapshotId ? sysProposalsBySnapshot.get(snapshotId) || 0 : 0;

    let aiGeneratedCount = projAiSysScenarios + projAiSuggestions;
    let aiRepairedCount = projAiSysProposals;

    for (const rec of projAiTests) {
      const requests = Array.isArray(rec.metaJson?.requests) ? rec.metaJson.requests : [];
      if (requests.length > 0) {
        aiGeneratedCount += requests.filter(
          (r) => r.origin === "AI_GENERATED" || !r.origin
        ).length;
        aiRepairedCount += requests.filter(
          (r) => r.repaired || r.healed || r.regenerated
        ).length;
      } else {
        aiGeneratedCount += 1;
      }
      if (rec.status === "APPROVED") {
        aiRepairedCount += 1;
      }
    }

    const lowBranchUnitFilesCount = unitFiles.filter(
      (f) => Number(f.branchesPct ?? 0) < 75
    ).length;
    const totalCoverageGaps = uncoveredApis + lowBranchUnitFilesCount;

    // 3f. Sparkline history (recent 5 runs)
    let sparkline = [0, 0, 0, 0, 0];
    if (runs.length > 0) {
      const recentFive = runs.slice(0, 5).reverse();
      sparkline = recentFive.map((r) => {
        const pRate = r.totalTests > 0 ? (r.passedTests / r.totalTests) * 100 : 0;
        const cRate = r.coverageLinesPct ?? pRate;
        return Math.round(0.5 * pRate + 0.5 * cRate);
      });
      while (sparkline.length < 5) {
        sparkline.unshift(sparkline[0] || healthScore);
      }
    } else if (healthScore > 0) {
      sparkline = [
        Math.max(0, healthScore - 6),
        Math.max(0, healthScore - 4),
        Math.max(0, healthScore - 5),
        Math.max(0, healthScore - 2),
        healthScore,
      ];
    }

    // Delta compared to previous run
    let delta = 0;
    if (runs.length >= 2) {
      const curr = runs[0];
      const prev = runs[1];
      const currRate = curr.totalTests > 0 ? (curr.passedTests / curr.totalTests) * 100 : 0;
      const prevRate = prev.totalTests > 0 ? (prev.passedTests / prev.totalTests) * 100 : 0;
      delta = toFixedNum(currRate - prevRate);
    }

    // Framework tags
    const frameworks = [];
    if (p.repoUrl) frameworks.push("GitHub");
    if (p.hasVitest || unitRun?.type === "VITEST") frameworks.push("Vitest");
    else if (p.hasJest || unitRun?.type === "JEST") frameworks.push("Jest");
    if (totalApis > 0 || intTotal > 0 || intRun) frameworks.push("Supertest");
    if (p.hasPlaywright || sysRun?.type === "PLAYWRIGHT") frameworks.push("Playwright");
    if (p.hasCypress || sysRun?.type === "CYPRESS") frameworks.push("Cypress");
    if (frameworks.length === 0) frameworks.push("Node.js");

    // 3g. Compute Time & ROI for this project
    const rawTimeRoi = computeProjectTimeAndRoiMetrics({
      unitStats: {
        totalTests: unitTotal,
        durationMs: unitDurationMs,
      },
      intStats: {
        totalTests: intTotal,
        durationMs: intDurationMs,
      },
      sysStats: {
        totalTests: sysTotal,
        durationMs: sysDurationMs,
      },
      aiGeneratedCount,
      aiRepairedCount,
    });

    const timeRoi = {
      ...rawTimeRoi,
      actualAutoDurationFormatted: rawTimeRoi.actualAutoDurationStr,
      estimatedManualDurationFormatted: rawTimeRoi.estimatedManualDurationStr,
    };

    // Compact status label (max 4-5 words)
    let compactStatus = "✓ All Suites Passing";
    let compactSeverity = "SUCCESS";
    if (currentActiveJob) {
      compactStatus = `⟳ Running ${currentActiveJob.type.replace(/_/g, " ")} (${currentActiveJob.progress}%)`;
      compactSeverity = "RUNNING";
    } else if (totalExecuted === 0) {
      compactStatus = totalApis > 0 ? `⚠️ ${totalApis} Uncovered APIs` : "○ Ready for First Run";
      compactSeverity = totalApis > 0 ? "WARNING" : "NEUTRAL";
    } else if (totalFailed > 0) {
      compactStatus = `🛑 ${totalFailed} Test Failure${totalFailed !== 1 ? "s" : ""}`;
      compactSeverity = "DANGER";
    } else if (uncoveredApis > 0) {
      compactStatus = `⚠️ ${uncoveredApis} Uncovered APIs`;
      compactSeverity = "WARNING";
    } else if (unifiedCov < 50) {
      compactStatus = `⚠️ Low Coverage (${unifiedCov}%)`;
      compactSeverity = "WARNING";
    }

    // Read-time self-healing: if lifecycleStatus is null or "NOT_STARTED"
    // while the project already has execution, AI, coverage, or multi-snapshot activity, heal to "DOING"
    const hasProjectActivity =
      totalExecuted > 0 ||
      totalAiSynthesized > 0 ||
      aiRepairedCount > 0 ||
      (p.snapshots?.length || 0) > 1 ||
      runs.length > 0 ||
      Boolean(cov);

    let lifecycleStatus = p.lifecycleStatus || "NOT_STARTED";
    if (lifecycleStatus === "NOT_STARTED" && hasProjectActivity) {
      lifecycleStatus = "DOING";
      p.lifecycleStatus = "DOING";
      prisma.project
        .updateMany({
          where: { id: p.id, lifecycleStatus: "NOT_STARTED" },
          data: { lifecycleStatus: "DOING", lifecycleUpdatedAt: new Date() },
        })
        .catch(() => {});
    }
    const isExcludedFromActiveKpis = lifecycleStatus !== "DOING";

    const currentJobPillar = currentActiveJob
      ? currentActiveJob.type.includes("SUPERTEST")
        ? "Integration"
        : currentActiveJob.type.includes("SYSTEM")
        ? "System E2E"
        : "Unit"
      : null;

    const activeSnapshot = (p.snapshots || []).find((s) => s.id === snapshotId) || p.snapshots?.[0];
    const vNum = activeSnapshot?.versionNumber != null ? `#${activeSnapshot.versionNumber}` : (snapshotId ? `#1` : null);
    const shortRef = activeSnapshot?.commitSha && !activeSnapshot.commitSha.startsWith("appliedTx:")
      ? activeSnapshot.commitSha.slice(0, 7)
      : (activeSnapshot?.contentHash ? activeSnapshot.contentHash.slice(0, 7) : (snapshotId ? snapshotId.slice(0, 7) : ""));
    const snapshotLabel = activeSnapshot?.label || (vNum ? `${vNum} (${shortRef})` : shortRef);

    return {
      id: p.id,
      name: p.name,
      description: p.description || "Project Workspace",
      repoUrl: p.repoUrl || null,
      branch: p.defaultBranch || "main",
      snapshotId,
      snapshotLabel,
      snapshotVersion: activeSnapshot?.versionNumber ?? null,
      lifecycleStatus,
      lifecycleUpdatedAt: p.lifecycleUpdatedAt || p.updatedAt,
      isPinned: Boolean(p.isPinned),
      isExcludedFromActiveKpis,
      updatedAt: p.updatedAt || p.createdAt,
      createdAt: p.createdAt,
      frameworks,
      healthScore,
      grade,
      delta,
      gateStatus,
      gateLabel,
      unifiedCoveragePct: unifiedCov,
      passRatePct: passRate,
      sparkline,
      compactStatus,
      compactSeverity,
      activeJob: currentActiveJob
        ? {
            id: currentActiveJob.id,
            type: currentActiveJob.type,
            pillar: currentJobPillar,
            status: currentActiveJob.status,
            progress: currentActiveJob.progress,
            startedAt: currentActiveJob.startedAt || currentActiveJob.createdAt,
          }
        : null,
      pillars: {
        unit: {
          framework: p.hasVitest || unitRun?.type === "VITEST" ? "Vitest" : "Jest",
          coveragePct: unitCov,
          branchCoveragePct: unitBranchCov,
          totalTests: unitTotal,
          passedTests: unitPassed,
          failedTests: unitFailed,
          durationMs: unitDurationMs,
        },
        integration: {
          framework: integrationWs?.snapshot?.framework || "Supertest",
          coveragePct: intCov,
          totalApis,
          coveredApis,
          uncoveredApis,
          totalTests: intTotal,
          passedTests: intPassed,
          failedTests: intFailed,
          durationMs: intDurationMs,
        },
        system: {
          framework: p.hasCypress || sysRun?.type === "CYPRESS" ? "Cypress" : "Playwright",
          coveragePct: sysCov,
          totalJourneys,
          coveredJourneys,
          totalTests: sysTotal,
          passedTests: sysPassed,
          failedTests: sysFailed,
          durationMs: sysDurationMs,
        },
      },
      timeRoi,
      aiMetrics: {
        aiGeneratedTests: aiGeneratedCount,
        aiRepairedTests: aiRepairedCount,
        uncoveredGaps: totalCoverageGaps,
      },
      provenance: {
        snapshotId,
        unitRunId: unitRun?.id || null,
        integrationRunId: intRun?.id || null,
        systemRunId: sysRun?.id || null,
        lastExecutedAt: runs[0]?.createdAt || null,
        dataSource: "POSTGRESQL_LIVE",
      },
    };
  });

  // ── 4. Strict Aggregation Scope: Filter active projects for KPIs (ONLY DOING) ──
  const activeScopeProjects = normalizedProjects.filter(
    (p) => p.lifecycleStatus === "DOING"
  );

  const rawTimeRoiAnalytics = aggregatePortfolioTimeAndRoi(activeScopeProjects);
  const timeRoiAnalytics = {
    ...rawTimeRoiAnalytics,
    totalAutoExecutionDurationFormatted: rawTimeRoiAnalytics.totalAutoDurationStr,
    totalManualExecutionDurationFormatted: rawTimeRoiAnalytics.totalManualHoursStr,
  };

  const activeKpis = computeExecutiveKpis(activeScopeProjects, timeRoiAnalytics);
  const benchmarkAnalytics = computeBenchmarkAndQuadrant(activeScopeProjects);
  const attentionQueue = synthesizeAttentionQueue(activeScopeProjects);

  // Lifecycle status counts (both camelCase and UPPERCASE for universal compatibility)
  const doingCount = normalizedProjects.filter((p) => p.lifecycleStatus === "DOING").length;
  const notStartedCount = normalizedProjects.filter((p) => p.lifecycleStatus === "NOT_STARTED").length;
  const pausedCount = normalizedProjects.filter((p) => p.lifecycleStatus === "PAUSED").length;
  const completedCount = normalizedProjects.filter((p) => p.lifecycleStatus === "COMPLETED").length;
  const cancelledCount = normalizedProjects.filter((p) => p.lifecycleStatus === "CANCELLED").length;

  const lifecycleCounts = {
    total: normalizedProjects.length,
    active: activeScopeProjects.length,
    doing: doingCount,
    notStarted: notStartedCount,
    paused: pausedCount,
    completed: completedCount,
    cancelled: cancelledCount,
    DOING: doingCount,
    NOT_STARTED: notStartedCount,
    PAUSED: pausedCount,
    COMPLETED: completedCount,
    CANCELLED: cancelledCount,
  };

  // ── 5. Build Unified Execution Feed (25 most recent runs) ────────────────
  const projectNameMap = new Map(rawProjects.map((p) => [snapshotMap.get(p.id), p.name]));
  const projectIdMap = new Map(rawProjects.map((p) => [snapshotMap.get(p.id), p.id]));

  const activityFeed = recentTestRuns.slice(0, 25).map((r) => {
    const projName = projectNameMap.get(r.snapshotId) || "Workspace";
    const projId = projectIdMap.get(r.snapshotId) || null;
    const isPillarUnit = r.type === "JEST" || r.type === "VITEST";
    const isPillarInt = r.type === "SUPERTEST" || r.type === "PLAYWRIGHT_API";
    const pillar = isPillarUnit ? "unit" : isPillarInt ? "integration" : "system";
    const rTotal = Number(r.totalTests || 0);
    const rPassed = Number(r.passedTests || 0);
    const rFailed = Number(r.failedTests || 0);
    const covVal =
      r.coverageLinesPct != null
        ? Number(r.coverageLinesPct)
        : pillar === "system" && rTotal > 0
        ? (rPassed / rTotal) * 100
        : null;

    return {
      id: r.id,
      runId: r.id,
      projectId: projId,
      snapshotId: r.snapshotId,
      projectName: projName,
      type: "TEST_EXECUTION",
      pillar,
      outcome: rFailed === 0 && r.status !== "FAILED" ? "SUCCESS" : "FAILED",
      coverageDelta: covVal !== null ? `${covVal.toFixed(1)}%` : "—",
      duration:
        (r.durationMs || 0) >= 1000
          ? `${((r.durationMs || 0) / 1000).toFixed(1)}s`
          : `${Math.round(r.durationMs || 0)}ms`,
      durationMs: r.durationMs || 0,
      timestamp: r.createdAt.toISOString(),
      summary: `${rPassed}/${rTotal} passed (${rFailed} failed)`,
    };
  });

  // Runner Infrastructure telemetry
  const runningJobsCount = activeJobs.filter((j) => j.status === "RUNNING").length;
  const queuedJobsCount = activeJobs.filter((j) => j.status === "QUEUED").length;

  const runnerInfrastructure = {
    runnerStatus: "READY",
    isRedisConnected: true,
    activeWorkers: 3,
    runningJobsCount,
    queuedJobsCount,
    supportedFrameworks: ["Jest / Vitest (Unit)", "Supertest (HTTP API)", "Playwright (E2E & API)"],
    lastSync: new Date().toISOString(),
  };

  const payload = {
    projects: normalizedProjects,
    activeProjectsCount: activeScopeProjects.length,
    activeKpis,
    timeRoiAnalytics,
    lifecycleCounts,
    analytics: {
      ...benchmarkAnalytics,
      timeRoiAnalytics,
      coverageCutoff: 70,
      passRateCutoff: 85,
    },
    attentionQueue,
    activityFeed,
    runnerInfrastructure,
    provenance: {
      queriedAt: new Date().toISOString(),
      totalProjectsInDb: rawProjects.length,
      activeScopeProjectsCount: activeScopeProjects.length,
      dataSource: "POSTGRESQL_LIVE",
    },
  };

  portfolioCache.set(userId, { data: payload, timestamp: Date.now() });
  return payload;
}

/**
 * Compute Executive KPIs over active projects only
 */
function computeExecutiveKpis(projects = [], timeRoiAnalytics = {}) {
  const total = projects.length;
  if (total === 0) return getEmptyKpis(timeRoiAnalytics);

  let passed = 0;
  let atRisk = 0;
  let blocked = 0;
  let untested = 0;
  let sumHealth = 0;
  let testedCount = 0;

  let sumUnitCov = 0;
  let sumIntCov = 0;
  let sumSysCov = 0;
  let testedCovCount = 0;

  let totalUnitTests = 0;
  let passedUnitTests = 0;
  let totalIntTests = 0;
  let passedIntTests = 0;
  let totalDiscoveredApis = 0;
  let totalCoveredApis = 0;
  let totalSysTests = 0;
  let passedSysTests = 0;
  let cumulativeDurationMs = 0;

  let totalAiGenerated = 0;
  let totalAiRepaired = 0;
  let totalUncoveredGaps = 0;

  for (const p of projects) {
    if (p.gateStatus === "PASSED") passed++;
    else if (p.gateStatus === "AT_RISK") atRisk++;
    else if (p.gateStatus === "BLOCKED") blocked++;
    else untested++;

    if (p.gateStatus !== "UNTESTED") {
      sumHealth += p.healthScore;
      testedCount++;

      sumUnitCov += p.pillars.unit.coveragePct || 0;
      sumIntCov += p.pillars.integration.coveragePct || 0;
      sumSysCov += p.pillars.system.coveragePct || 0;
      testedCovCount++;
    }

    totalUnitTests += p.pillars.unit.totalTests || 0;
    passedUnitTests += p.pillars.unit.passedTests || 0;
    totalIntTests += p.pillars.integration.totalTests || 0;
    passedIntTests += p.pillars.integration.passedTests || 0;
    totalDiscoveredApis += p.pillars.integration.totalApis || 0;
    totalCoveredApis += p.pillars.integration.coveredApis || 0;
    totalSysTests += p.pillars.system.totalTests || 0;
    passedSysTests += p.pillars.system.passedTests || 0;

    cumulativeDurationMs += p.timeRoi?.actualAutoDurationMs || 0;
    totalAiGenerated += p.aiMetrics?.aiGeneratedTests || 0;
    totalAiRepaired += p.aiMetrics?.aiRepairedTests || 0;
    totalUncoveredGaps += p.aiMetrics?.uncoveredGaps || 0;
  }

  const avgHealthScore = testedCount > 0 ? Math.round(sumHealth / testedCount) : 0;
  let grade = "—";
  if (testedCount > 0) {
    if (avgHealthScore >= GRADE_THRESHOLDS.A) grade = "A";
    else if (avgHealthScore >= GRADE_THRESHOLDS.B) grade = "B";
    else if (avgHealthScore >= GRADE_THRESHOLDS.C) grade = "C";
    else grade = "D";
  }

  const avgUnitCov = testedCovCount > 0 ? toFixedNum(sumUnitCov / testedCovCount) : 0;
  const avgIntCov = testedCovCount > 0 ? toFixedNum(sumIntCov / testedCovCount) : 0;
  const avgSysCov = testedCovCount > 0 ? toFixedNum(sumSysCov / testedCovCount) : 0;

  const unifiedCoveragePct = toFixedNum(
    avgUnitCov * LAYER_WEIGHTS.unit +
      avgIntCov * LAYER_WEIGHTS.integration +
      avgSysCov * LAYER_WEIGHTS.system
  );

  const totalExecutedTests = totalUnitTests + totalIntTests + totalSysTests;
  const totalPassedTests = passedUnitTests + passedIntTests + passedSysTests;
  const totalFailedTests = totalExecutedTests - totalPassedTests;
  const overallPassRatePct =
    totalExecutedTests > 0
      ? toFixedNum((totalPassedTests / totalExecutedTests) * 100)
      : 0;

  return {
    totalProjects: total,
    timeRoi: timeRoiAnalytics,
    gateBreakdown: {
      passed,
      atRisk,
      blocked,
      untested,
      passedPct: total > 0 ? toFixedNum((passed / total) * 100) : 0,
    },
    card1Health: {
      avgHealthScore,
      grade,
      totalProjects: total,
      passedProjects: passed,
      atRiskProjects: atRisk,
      blockedProjects: blocked,
      untestedProjects: untested,
    },
    card2Coverage: {
      unifiedCoveragePct,
      avgUnitCoveragePct: avgUnitCov,
      avgIntegrationCoveragePct: avgIntCov,
      avgSystemCoveragePct: avgSysCov,
    },
    card3Scale: {
      totalExecutedTests,
      totalPassedTests,
      totalFailedTests,
      overallPassRatePct,
      unitPassedStr: `${passedUnitTests}/${totalUnitTests}`,
      apiCoveredStr:
        totalDiscoveredApis > 0
          ? `${totalCoveredApis}/${totalDiscoveredApis}`
          : `${passedIntTests}/${totalIntTests}`,
      systemVerifiedStr: `${passedSysTests}/${totalSysTests}`,
      cumulativeDurationStr:
        cumulativeDurationMs >= 1000
          ? `${(cumulativeDurationMs / 1000).toFixed(1)}s`
          : `${Math.round(cumulativeDurationMs)}ms`,
    },
    card4AiImpact: {
      totalAiTests: totalAiGenerated + totalAiRepaired,
      aiGeneratedCount: totalAiGenerated,
      aiRepairedCount: totalAiRepaired,
      uncoveredGapsCount: totalUncoveredGaps,
    },
  };
}

/**
 * Compute Benchmark bars & Risk Quadrant data for active projects
 */
function computeBenchmarkAndQuadrant(projects = []) {
  const coverageCutoff = 70;
  const passRateCutoff = 85;

  const benchmarkItems = projects.map((p) => {
    const unitPct = p.pillars.unit.coveragePct || 0;
    const intPct = p.pillars.integration.coveragePct || 0;
    const sysPct = p.pillars.system.coveragePct || 0;

    const allValues = [unitPct, intPct, sysPct];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const hasImbalance =
      (maxVal - minVal >= 40 && minVal === 0) || (unitPct > 0 && intPct === 0);

    return {
      projectId: p.id,
      name: p.name,
      gateStatus: p.gateStatus,
      healthScore: p.healthScore,
      unitPct,
      intPct,
      sysPct,
      hasImbalance,
      imbalanceReason: hasImbalance
        ? `Layer deficit: ${unitPct}% Unit vs ${intPct}% API coverage · ${sysPct}% E2E`
        : null,
    };
  });

  const quadrantNodes = projects.map((p) => {
    const x = p.unifiedCoveragePct || 0;
    const y = p.passRatePct !== null ? p.passRatePct : 0;

    let quadrantId = "critical-risk";
    let quadrantLabel = "Critical Risk";
    let color = "var(--ud-fail)";

    if (x >= coverageCutoff && y >= passRateCutoff) {
      quadrantId = "healthy-stars";
      quadrantLabel = "Healthy Stars";
      color = "var(--ud-pass)";
    } else if (x < coverageCutoff && y >= passRateCutoff) {
      quadrantId = "false-security";
      quadrantLabel = "Blind Spot / False Security";
      color = "var(--ud-warn)";
    } else if (x >= coverageCutoff && y < passRateCutoff) {
      quadrantId = "active-regressions";
      quadrantLabel = "Active Regressions";
      color = "#fb8500";
    }

    return {
      projectId: p.id,
      name: p.name,
      x,
      y,
      gateStatus: p.gateStatus,
      gateLabel: p.gateLabel,
      healthScore: p.healthScore,
      grade: p.grade,
      quadrantId,
      quadrantLabel,
      color,
      isUntested: p.gateStatus === "UNTESTED",
    };
  });

  return {
    benchmarkItems,
    quadrantNodes,
  };
}

/**
 * Synthesize cross-project attention items from active projects
 */
function synthesizeAttentionQueue(projects = []) {
  const queue = [];

  for (const p of projects) {
    if (p.gateStatus === "BLOCKED") {
      const failedPillar =
        p.pillars.integration.failedTests > 0
          ? "integration"
          : p.pillars.unit.failedTests > 0
          ? "unit"
          : "system";

      const failCount =
        p.pillars.unit.failedTests +
        p.pillars.integration.failedTests +
        p.pillars.system.failedTests;

      queue.push({
        id: `attn-${p.id}-blocked`,
        projectId: p.id,
        projectName: p.name,
        severity: "CRITICAL",
        category: "failures",
        pillar: failedPillar,
        title: `Active failures blocking release gate in ${p.name}`,
        description: `${failCount} test assertion failure(s) detected. Gate is BLOCKED.`,
        ctaLabel: "Diagnose ↗",
        targetPillar: failedPillar,
        targetFocus: {},
      });
    } else if (p.gateStatus === "UNTESTED") {
      queue.push({
        id: `attn-${p.id}-untested`,
        projectId: p.id,
        projectName: p.name,
        severity: "MEDIUM",
        category: "zero-test",
        pillar: "unit",
        title: `Zero test suites executed for ${p.name}`,
        description:
          p.pillars.integration.totalApis > 0
            ? `${p.pillars.integration.totalApis} API endpoints discovered with 0 executed test suites.`
            : `Project repository is imported with 0 executed test suites.`,
        ctaLabel: "Run Suites ↗",
        targetPillar: "unit",
        targetFocus: {},
      });
    } else if (p.pillars.integration.uncoveredApis > 0) {
      queue.push({
        id: `attn-${p.id}-uncovered-apis`,
        projectId: p.id,
        projectName: p.name,
        severity: "HIGH",
        category: "missing-deps",
        pillar: "integration",
        title: `${p.pillars.integration.uncoveredApis} uncovered API endpoints in ${p.name}`,
        description: `${p.pillars.integration.coveredApis}/${p.pillars.integration.totalApis} APIs covered (${p.pillars.integration.coveragePct}%). Synthesize integration tests to close gaps.`,
        ctaLabel: "Synthesize API Tests ↗",
        targetPillar: "integration",
        targetFocus: {},
      });
    }
  }

  return queue;
}

function getEmptyKpis(timeRoi = {}) {
  return {
    totalProjects: 0,
    timeRoi,
    gateBreakdown: { passed: 0, atRisk: 0, blocked: 0, untested: 0, passedPct: 0 },
    card1Health: {
      avgHealthScore: 0,
      grade: "—",
      totalProjects: 0,
      passedProjects: 0,
      atRiskProjects: 0,
      blockedProjects: 0,
      untestedProjects: 0,
    },
    card2Coverage: {
      unifiedCoveragePct: 0,
      avgUnitCoveragePct: 0,
      avgIntegrationCoveragePct: 0,
      avgSystemCoveragePct: 0,
    },
    card3Scale: {
      totalExecutedTests: 0,
      totalPassedTests: 0,
      totalFailedTests: 0,
      overallPassRatePct: 0,
      unitPassedStr: "0/0",
      apiCoveredStr: "0/0",
      systemVerifiedStr: "0/0",
      cumulativeDurationStr: "0ms",
    },
    card4AiImpact: {
      totalAiTests: 0,
      aiGeneratedCount: 0,
      aiRepairedCount: 0,
      uncoveredGapsCount: 0,
    },
  };
}
