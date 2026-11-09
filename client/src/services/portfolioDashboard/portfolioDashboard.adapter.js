import {
  computePortfolioExecutiveKpis,
  computeBenchmarkAndQuadrantData,
} from "./portfolioDashboard.selectors.js";
import { PORTFOLIO_CONFIG } from "./portfolioDashboard.config.js";

/**
 * Normalizes real backend API projects into PortfolioVM
 */
export function adaptPortfolioDashboard({
  rawProjects = [],
  perProjectSummaries = {},
  liveOverviewData = null,
  favorites = [],
} = {}) {
  const payload = liveOverviewData?.data || liveOverviewData;

  // ── 1. Full-Stack Live Overview API ─────────────────────────────────────
  if (payload && Array.isArray(payload.projects)) {
    const projects = payload.projects.map((p) => {
      const lifecycleStatus = p.lifecycleStatus || "NOT_STARTED";
      return {
        ...p,
        lifecycleStatus,
        isExcludedFromActiveKpis:
          p.isExcludedFromActiveKpis !== undefined
            ? Boolean(p.isExcludedFromActiveKpis)
            : lifecycleStatus !== "DOING",
        isPinned: favorites.includes(p.id) || Boolean(p.isPinned),
      };
    });

    const doingProjects = projects.filter((p) => p.lifecycleStatus === "DOING");
    const kpis = payload.activeKpis || computePortfolioExecutiveKpis(doingProjects);
    const analytics = payload.analytics || computeBenchmarkAndQuadrantData(doingProjects);
    const attentionQueue = payload.attentionQueue || [];
    const activityFeed = payload.activityFeed || [];
    const runnerInfrastructure = payload.runnerInfrastructure || {
      activeWorkers: 0,
      runningJobsCount: 0,
      queuedJobsCount: 0,
      isRedisConnected: false,
    };
    const timeRoiAnalytics = payload.timeRoiAnalytics || kpis?.timeRoi || null;
    const lifecycleCounts = payload.lifecycleCounts || {
      DOING: 0,
      NOT_STARTED: 0,
      PAUSED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    const provenance = payload.provenance || {
      dataSource: "POSTGRESQL_LIVE",
      aggregatedAt: new Date().toISOString(),
    };

    const activeProjectsCount =
      payload.activeProjectsCount ??
      projects.filter((p) => p.lifecycleStatus === "DOING").length;

    return {
      projects,
      kpis,
      analytics,
      timeRoiAnalytics,
      attentionQueue,
      activityFeed,
      runnerInfrastructure,
      lifecycleCounts,
      provenance,
      metadata: {
        activeProjectsCount,
        totalSnapshotsCount: projects.filter((p) => p.snapshotId).length,
        lastSyncedAt: provenance.aggregatedAt || payload.aggregatedAt || new Date().toISOString(),
      },
    };
  }

  // ── 2. Fallback Live State (Empty or rawProjects) ────────────────────────
  const projects = (rawProjects || []).map((rp) => {
    const summary = perProjectSummaries[rp.id] || {};
    const unitSummary = summary.unit || {};
    const intSummary = summary.integration || {};
    const sysSummary = summary.system || {};

    const unitTotal = Number(unitSummary.totalTests || 0);
    const unitPassed = Number(unitSummary.passedTests || 0);
    const unitFailed = Number(unitSummary.failedTests || 0);
    const unitCov = unitTotal > 0 ? Number(unitSummary.coverageMetrics?.lines ?? 0) : 0;

    const intTotal = Number(intSummary.totalTests || 0);
    const intPassed = Number(intSummary.passedTests || 0);
    const intFailed = Number(intSummary.failedTests || 0);
    const intTotalApis = Number(intSummary.coverageMetrics?.totalApis || intSummary.totalApis || 0);
    const intCov =
      intTotal > 0 && intTotalApis > 0
        ? Number(intSummary.coverageMetrics?.apiEndpoint ?? 0)
        : 0;
    const intCoveredApis =
      intTotal > 0 && intTotalApis > 0
        ? Number(intSummary.coverageMetrics?.coveredApis || intPassed || 0)
        : 0;
    const intUncoveredApis = Number(
      intSummary.coverageMetrics?.uncoveredApis || Math.max(0, intTotalApis - intCoveredApis)
    );

    const sysTotal = Number(sysSummary.totalTests || 0);
    const sysPassed = Number(sysSummary.passedTests || 0);
    const sysFailed = Number(sysSummary.failedTests || 0);
    const sysCov = sysTotal > 0 ? Number(sysSummary.coverageMetrics?.flow ?? 0) : 0;

    const totalExecuted = unitTotal + intTotal + sysTotal;
    const totalPassed = unitPassed + intPassed + sysPassed;
    const totalFailed = unitFailed + intFailed + sysFailed;

    const passRate =
      totalExecuted > 0
        ? Number(((totalPassed / totalExecuted) * 100).toFixed(1))
        : null;

    const detectedFrameworks = [];
    if (rp.repoUrl) detectedFrameworks.push("GitHub");
    if (unitTotal > 0 || unitSummary.framework) {
      detectedFrameworks.push(unitSummary.framework || "Jest");
    }
    if (intTotal > 0 || intTotalApis > 0) {
      detectedFrameworks.push("Supertest");
    }
    if (sysTotal > 0) {
      detectedFrameworks.push("Playwright");
    }
    if (detectedFrameworks.length === 0) {
      detectedFrameworks.push("Node.js");
    }

    let healthScore = 0;
    let gateStatus = "UNTESTED";
    let gateLabel = "UNTESTED";
    let grade = "—";

    if (totalExecuted > 0) {
      const w = PORTFOLIO_CONFIG.weights;
      const weightedCov = unitCov * w.unit + intCov * w.integration + sysCov * w.system;
      const rawScore = 0.5 * (passRate ?? 0) + 0.5 * weightedCov;
      healthScore = Math.min(100, Math.max(0, Math.round(rawScore)));

      if (healthScore >= PORTFOLIO_CONFIG.grades.A) grade = "A";
      else if (healthScore >= PORTFOLIO_CONFIG.grades.B) grade = "B";
      else if (healthScore >= PORTFOLIO_CONFIG.grades.C) grade = "C";
      else grade = "D";

      if (totalFailed === 0 && passRate >= 95 && healthScore >= 80) {
        gateStatus = "PASSED";
        gateLabel = "READY TO RELEASE";
      } else if (totalFailed > 0 || passRate < 80) {
        gateStatus = "BLOCKED";
        gateLabel = "BLOCKED";
      } else {
        gateStatus = "AT_RISK";
        gateLabel = "AT RISK";
      }
    }

    const unifiedCov =
      totalExecuted > 0
        ? Number(
            (
              unitCov * PORTFOLIO_CONFIG.weights.unit +
              intCov * PORTFOLIO_CONFIG.weights.integration +
              sysCov * PORTFOLIO_CONFIG.weights.system
            ).toFixed(1)
          )
        : 0;

    const isPinned = favorites.includes(rp.id);
    const sparkline = healthScore > 0 ? [healthScore, healthScore, healthScore, healthScore, healthScore] : [0, 0, 0, 0, 0];

    return {
      id: rp.id,
      name: rp.name,
      description: rp.description || "Project Workspace",
      repoUrl: rp.repoUrl || null,
      branch: rp.branch || "main",
      snapshotId: rp.snapshotId || rp.activeSnapshotId || rp.latestSnapshotId || rp.snapshots?.[0]?.id || null,
      snapshotLabel: rp.snapshotLabel || null,
      lifecycleStatus: rp.lifecycleStatus || "NOT_STARTED",
      updatedAt: rp.updatedAt || rp.createdAt || new Date().toISOString(),
      createdAt: rp.createdAt || new Date().toISOString(),
      frameworks: detectedFrameworks,
      healthScore,
      grade,
      delta: 0,
      gateStatus,
      gateLabel,
      isPinned,
      unifiedCoveragePct: unifiedCov,
      passRatePct: passRate,
      sparkline,
      pillars: {
        unit: {
          framework: unitSummary.framework || "Jest",
          coveragePct: unitCov,
          branchCoveragePct: Number(unitSummary.coverageMetrics?.branches ?? 0),
          totalTests: unitTotal,
          passedTests: unitPassed,
          failedTests: unitFailed,
          durationMs: Number(unitSummary.durationMs ?? 0),
        },
        integration: {
          framework: "Supertest",
          coveragePct: intCov,
          totalApis: intTotalApis,
          coveredApis: intCoveredApis,
          uncoveredApis: intUncoveredApis,
          totalTests: intTotal,
          passedTests: intPassed,
          failedTests: intFailed,
          durationMs: Number(intSummary.durationMs ?? 0),
          failureLayers: intSummary.failureDistribution || { route: 0, middleware: 0, controller: 0, database: 0 },
        },
        system: {
          framework: "Playwright",
          coveragePct: sysCov,
          totalJourneys: sysTotal,
          coveredJourneys: sysPassed,
          totalTests: sysTotal,
          passedTests: sysPassed,
          failedTests: sysFailed,
          durationMs: Number(sysSummary.durationMs ?? 0),
          failureTypes: { selector: 0, timeout: 0, assertion: sysFailed },
        },
      },
      aiMetrics: {
        aiGeneratedTests: Number(rp.aiGeneratedCount ?? 0),
        aiRepairedTests: Number(rp.aiRepairedCount ?? 0),
        uncoveredGaps: intUncoveredApis,
      },
    };
  });

  const doingProjects = projects.filter((p) => p.lifecycleStatus === "DOING");
  const kpis = computePortfolioExecutiveKpis(doingProjects);
  const analytics = computeBenchmarkAndQuadrantData(doingProjects);

  const totalSnapshotsCount = projects.reduce(
    (acc, p) => acc + (p.snapshotId ? 1 : 0),
    0
  );

  return {
    projects,
    kpis,
    analytics,
    attentionQueue: [],
    activityFeed: [],
    metadata: {
      activeProjectsCount: doingProjects.length,
      totalSnapshotsCount,
      lastSyncedAt: new Date().toISOString(),
    },
  };
}
