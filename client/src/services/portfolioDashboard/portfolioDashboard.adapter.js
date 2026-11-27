import {
  isKpiIncludedLifecycleStatus,
  canManageProjectLifecycle,
  computeProjectHealthAndCoverage,
} from "../../../../shared/portfolioGovernance.js";
import {
  computePortfolioExecutiveKpis,
  computeBenchmarkAndQuadrantData,
  computePortfolioLifecycleCounts,
} from "./portfolioDashboard.selectors.js";

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
      const canManageLifecycle =
        p.canManageLifecycle !== undefined
          ? Boolean(p.canManageLifecycle)
          : canManageProjectLifecycle(p.currentUserRole);

      return {
        ...p,
        branch: p.branch ?? null,
        branchSource: p.branchSource ?? null,
        lifecycleStatus,
        currentUserRole: p.currentUserRole ?? null,
        canManageLifecycle,
        hasLifecycleActivity: Boolean(p.hasLifecycleActivity),
        isExcludedFromActiveKpis: !isKpiIncludedLifecycleStatus(lifecycleStatus),
        // For owners, DB truth wins; non-owners fall back to local favorites + DB pin
        isPinned: canManageLifecycle
          ? Boolean(p.isPinned)
          : favorites.includes(p.id) || Boolean(p.isPinned),
      };
    });

    const doingProjects = projects.filter((p) =>
      isKpiIncludedLifecycleStatus(p.lifecycleStatus),
    );
    const kpis = payload.activeKpis || computePortfolioExecutiveKpis(doingProjects);
    const analytics =
      payload.analytics || computeBenchmarkAndQuadrantData(doingProjects);
    const attentionQueue = payload.attentionQueue || [];
    const activityFeed = payload.activityFeed || [];
    const runnerInfrastructure = payload.runnerInfrastructure || {
      activeWorkers: 0,
      runningJobsCount: 0,
      queuedJobsCount: 0,
      isRedisConnected: false,
      mode: "local",
    };
    const timeRoiAnalytics = payload.timeRoiAnalytics || kpis?.timeRoi || null;
    const lifecycleCounts =
      payload.lifecycleCounts || computePortfolioLifecycleCounts(projects);
    const provenance = payload.provenance || {
      dataSource: "POSTGRESQL_LIVE",
      aggregatedAt: new Date().toISOString(),
    };

    const activeProjectsCount =
      payload.activeProjectsCount !== undefined
        ? payload.activeProjectsCount
        : doingProjects.length;

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
        doingProjectsCount: doingProjects.length,
        totalSnapshotsCount: projects.filter((p) => p.snapshotId).length,
        lastSyncedAt:
          provenance.queriedAt ||
          provenance.aggregatedAt ||
          payload.aggregatedAt ||
          new Date().toISOString(),
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
    const unitMeasured =
      unitTotal > 0 &&
      unitSummary.coverageMetrics?.lines !== null &&
      unitSummary.coverageMetrics?.lines !== undefined;
    const unitCov = unitMeasured ? Number(unitSummary.coverageMetrics.lines) : null;

    const intTotal = Number(intSummary.totalTests || 0);
    const intPassed = Number(intSummary.passedTests || 0);
    const intFailed = Number(intSummary.failedTests || 0);
    const intTotalApis = Number(
      intSummary.coverageMetrics?.totalApis || intSummary.totalApis || 0,
    );
    const intMeasured =
      intTotal > 0 &&
      intTotalApis > 0 &&
      intSummary.coverageMetrics?.apiEndpoint !== null &&
      intSummary.coverageMetrics?.apiEndpoint !== undefined;
    const intCov = intMeasured ? Number(intSummary.coverageMetrics.apiEndpoint) : null;
    const intCoveredApis =
      intTotal > 0 && intTotalApis > 0
        ? Number(intSummary.coverageMetrics?.coveredApis || intPassed || 0)
        : 0;
    const intUncoveredApis = Number(
      intSummary.coverageMetrics?.uncoveredApis ||
        Math.max(0, intTotalApis - intCoveredApis),
    );

    const sysTotal = Number(sysSummary.totalTests || 0);
    const sysPassed = Number(sysSummary.passedTests || 0);
    const sysFailed = Number(sysSummary.failedTests || 0);
    const sysMeasured =
      sysTotal > 0 &&
      sysSummary.coverageMetrics?.flow !== null &&
      sysSummary.coverageMetrics?.flow !== undefined;
    const sysCov = sysMeasured ? Number(sysSummary.coverageMetrics.flow) : null;

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

    const scoring = computeProjectHealthAndCoverage({
      unit: {
        totalTests: unitTotal,
        passedTests: unitPassed,
        failedTests: unitFailed,
        coveragePct: unitCov,
      },
      integration: {
        totalTests: intTotal,
        passedTests: intPassed,
        failedTests: intFailed,
        coveragePct: intCov,
      },
      system: {
        totalTests: sysTotal,
        passedTests: sysPassed,
        failedTests: sysFailed,
        coveragePct: sysCov,
      },
    });

    const lifecycleStatus = rp.lifecycleStatus || "NOT_STARTED";
    const isPinned = favorites.includes(rp.id) || Boolean(rp.isPinned);

    return {
      id: rp.id,
      name: rp.name,
      description: rp.description || "Project Workspace",
      repoUrl: rp.repoUrl || null,
      branch: rp.branch || rp.defaultBranch || null,
      snapshotId:
        rp.snapshotId ||
        rp.activeSnapshotId ||
        rp.latestSnapshotId ||
        rp.snapshots?.[0]?.id ||
        null,
      snapshotLabel: rp.snapshotLabel || null,
      lifecycleStatus,
      isExcludedFromActiveKpis: !isKpiIncludedLifecycleStatus(lifecycleStatus),
      currentUserRole: rp.currentUserRole ?? null,
      canManageLifecycle:
        rp.canManageLifecycle !== undefined
          ? Boolean(rp.canManageLifecycle)
          : canManageProjectLifecycle(rp.currentUserRole),
      hasLifecycleActivity:
        Boolean(rp.hasLifecycleActivity) || unitTotal + intTotal + sysTotal > 0,
      updatedAt: rp.updatedAt || rp.createdAt || new Date().toISOString(),
      createdAt: rp.createdAt || new Date().toISOString(),
      frameworks: detectedFrameworks,
      healthScore: scoring.healthScore,
      grade: scoring.grade,
      delta: 0,
      hasDelta: false,
      gateStatus: scoring.gateStatus,
      gateLabel: scoring.gateLabel,
      isPinned,
      unifiedCoveragePct: scoring.unifiedCoveragePct,
      passRatePct: scoring.passRatePct,
      sparkline: [],
      pillars: {
        unit: {
          framework: unitSummary.framework || "Jest",
          coveragePct: unitCov,
          coverageMeasured: unitCov !== null,
          branchCoveragePct:
            unitSummary.coverageMetrics?.branches ?? null,
          totalTests: unitTotal,
          passedTests: unitPassed,
          failedTests: unitFailed,
          durationMs: Number(unitSummary.durationMs ?? 0),
        },
        integration: {
          framework: "Supertest",
          coveragePct: intCov,
          coverageMeasured: intCov !== null,
          totalApis: intTotalApis,
          coveredApis: intCoveredApis,
          uncoveredApis: intUncoveredApis,
          totalTests: intTotal,
          passedTests: intPassed,
          failedTests: intFailed,
          durationMs: Number(intSummary.durationMs ?? 0),
          failureLayers: intSummary.failureDistribution || {
            route: 0,
            middleware: 0,
            controller: 0,
            database: 0,
          },
        },
        system: {
          framework: "Playwright",
          coveragePct: sysCov,
          coverageMeasured: sysCov !== null,
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

  const doingProjects = projects.filter((p) =>
    isKpiIncludedLifecycleStatus(p.lifecycleStatus),
  );
  const kpis = computePortfolioExecutiveKpis(doingProjects);
  const analytics = computeBenchmarkAndQuadrantData(doingProjects);
  const lifecycleCounts = computePortfolioLifecycleCounts(projects);

  const totalSnapshotsCount = projects.reduce(
    (acc, p) => acc + (p.snapshotId ? 1 : 0),
    0,
  );

  return {
    projects,
    kpis,
    analytics,
    timeRoiAnalytics: kpis.timeRoi,
    lifecycleCounts,
    attentionQueue: [],
    activityFeed: [],
    runnerInfrastructure: {
      activeWorkers: 0,
      runningJobsCount: 0,
      queuedJobsCount: 0,
      isRedisConnected: false,
      mode: "local",
    },
    metadata: {
      activeProjectsCount: doingProjects.length,
      doingProjectsCount: doingProjects.length,
      totalSnapshotsCount,
      lastSyncedAt: new Date().toISOString(),
    },
  };
}
