import { PORTFOLIO_CONFIG } from "./portfolioDashboard.config.js";

function toFixedPct(val, fallback = 0) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Number(num.toFixed(1));
}

function formatAutoDurationCompact(ms = 0) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return `${Math.round(n)}ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  if (mins < 60) return `${mins}m ${remSec}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function formatPortfolioHours(hours = 0) {
  const h = Number(hours) || 0;
  if (h < 1) {
    const mins = Math.round(h * 60);
    return `${mins} mins`;
  }
  return `${h.toFixed(1)} hrs`;
}

/**
 * Format milliseconds into human-readable duration string (e.g., "3m 42s" or "480ms")
 */
export function formatPortfolioDuration(durationMs = 0) {
  const ms = Number(durationMs) || 0;
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Aggregate Time & QA ROI metrics across an arbitrary subset of projects
 */
export function aggregatePortfolioTimeAndRoi(projects = []) {
  let totalAutoDurationMs = 0;
  let totalManualDurationMs = 0;
  let totalExecutionTimeSavedMs = 0;
  let totalAiAuthoringSavedMinutes = 0;
  let projectsWithExecutions = 0;

  for (const p of projects) {
    const timeRoi = p.timeRoi || {};
    const autoMs =
      Number(timeRoi.actualAutoDurationMs) ||
      (Number(p.pillars?.unit?.durationMs) || 0) +
        (Number(p.pillars?.integration?.durationMs) || 0) +
        (Number(p.pillars?.system?.durationMs) || 0);
    totalAutoDurationMs += autoMs;
    totalManualDurationMs += Number(timeRoi.estimatedManualDurationMs) || 0;
    totalExecutionTimeSavedMs += Number(timeRoi.executionTimeSavedMs) || 0;
    totalAiAuthoringSavedMinutes += Number(timeRoi.aiAuthoringSavedMinutes) || 0;
    if (autoMs > 0) {
      projectsWithExecutions++;
    }
  }

  const executionHoursSaved = Number((totalExecutionTimeSavedMs / 3_600_000).toFixed(2));
  const aiAuthoringHoursSaved = Number((totalAiAuthoringSavedMinutes / 60).toFixed(2));
  const totalQaHoursSaved = Number((executionHoursSaved + aiAuthoringHoursSaved).toFixed(2));

  const speedupMultiplier =
    totalAutoDurationMs > 0 && totalManualDurationMs > 0
      ? Number((totalManualDurationMs / totalAutoDurationMs).toFixed(1))
      : 0;

  return {
    totalAutoDurationMs,
    totalAutoDurationStr: formatAutoDurationCompact(totalAutoDurationMs),
    totalAutoExecutionDurationFormatted: formatAutoDurationCompact(totalAutoDurationMs),
    totalAutoExecutionSeconds: Number((totalAutoDurationMs / 1000).toFixed(1)),
    totalManualDurationMs,
    totalManualDurationStr: formatAutoDurationCompact(totalManualDurationMs),
    totalManualHours: Number((totalManualDurationMs / 3_600_000).toFixed(1)),
    totalManualExecutionHours: Number((totalManualDurationMs / 3_600_000).toFixed(1)),
    totalManualHoursStr: formatPortfolioHours(totalManualDurationMs / 3_600_000),
    totalManualExecutionDurationFormatted: formatPortfolioHours(totalManualDurationMs / 3_600_000),
    executionHoursSaved,
    aiAuthoringHoursSaved,
    totalQaHoursSaved,
    totalQaHoursSavedStr: formatPortfolioHours(totalQaHoursSaved),
    speedupMultiplier,
    averageSpeedupMultiplier: speedupMultiplier,
    speedupStr: speedupMultiplier > 0 ? `${speedupMultiplier}x Faster` : "—",
    projectsWithExecutions,
    activeProjectsCount: projects.length,
  };
}

/**
 * Compute lifecycle status breakdown counts across a set of projects
 */
export function computePortfolioLifecycleCounts(projects = []) {
  let DOING = 0;
  let NOT_STARTED = 0;
  let PAUSED = 0;
  let COMPLETED = 0;
  let CANCELLED = 0;

  for (const p of projects) {
    const status = p?.lifecycleStatus || "NOT_STARTED";
    if (status === "DOING") DOING++;
    else if (status === "COMPLETED") COMPLETED++;
    else if (status === "PAUSED") PAUSED++;
    else if (status === "CANCELLED") CANCELLED++;
    else NOT_STARTED++;
  }

  return {
    total: projects.length,
    all: projects.length,
    active: DOING + NOT_STARTED,
    doing: DOING,
    notStarted: NOT_STARTED,
    paused: PAUSED,
    completed: COMPLETED,
    cancelled: CANCELLED,
    DOING,
    NOT_STARTED,
    PAUSED,
    COMPLETED,
    CANCELLED,
  };
}

/**
 * Compute Portfolio Executive KPI cards (Zone 2)
 */
export function computePortfolioExecutiveKpis(projects = []) {
  const totalProjects = projects.length;

  let passedProjects = 0;
  let atRiskProjects = 0;
  let blockedProjects = 0;
  let untestedProjects = 0;

  let sumHealth = 0;
  let testedProjectsCount = 0;

  let sumUnitCoverage = 0;
  let sumIntCoverage = 0;
  let sumSysCoverage = 0;
  let activeCoverageProjectsCount = 0;

  let totalUnitTests = 0;
  let passedUnitTests = 0;
  let totalIntTests = 0;
  let passedIntTests = 0;

  let totalApis = 0;
  let coveredApis = 0;

  let totalJourneys = 0;
  let verifiedJourneys = 0;

  let totalExecutedTests = 0;
  let totalPassedTests = 0;
  let totalFailedTests = 0;
  let cumulativeDurationMs = 0;

  let totalAiGenerated = 0;
  let totalAiRepaired = 0;
  let totalUncoveredGaps = 0;

  for (const p of projects) {
    const gate = (p.gateStatus || "").toUpperCase();
    if (gate === "PASSED") passedProjects++;
    else if (gate === "AT_RISK") atRiskProjects++;
    else if (gate === "BLOCKED") blockedProjects++;
    else untestedProjects++;

    const isTested = gate !== "UNTESTED";
    if (isTested) {
      sumHealth += Number(p.healthScore) || 0;
      testedProjectsCount++;
    }

    const unit = p.pillars?.unit || {};
    const int = p.pillars?.integration || {};
    const sys = p.pillars?.system || {};

    const pUnitCov = Number(unit.coveragePct ?? 0);
    const pIntCov = Number(int.coveragePct ?? 0);
    const pSysCov = Number(sys.coveragePct ?? 0);

    if (isTested) {
      sumUnitCoverage += pUnitCov;
      sumIntCoverage += pIntCov;
      sumSysCoverage += pSysCov;
      activeCoverageProjectsCount++;
    }

    // Scale metrics
    totalUnitTests += Number(unit.totalTests) || 0;
    passedUnitTests += Number(unit.passedTests) || 0;
    totalIntTests += Number(int.totalTests) || 0;
    passedIntTests += Number(int.passedTests) || 0;

    totalApis += Number(int.totalApis) || (Number(int.coveredApis) || 0) + (Number(int.uncoveredApis) || 0);
    coveredApis += Number(int.coveredApis) || 0;

    totalJourneys += Number(sys.totalJourneys) || Number(sys.totalTests) || 0;
    verifiedJourneys += Number(sys.coveredJourneys) || Number(sys.passedTests) || 0;

    const pTotalTests = (Number(unit.totalTests) || 0) + (Number(int.totalTests) || 0) + (Number(sys.totalTests) || 0);
    const pPassedTests = (Number(unit.passedTests) || 0) + (Number(int.passedTests) || 0) + (Number(sys.passedTests) || 0);
    const pFailedTests = (Number(unit.failedTests) || 0) + (Number(int.failedTests) || 0) + (Number(sys.failedTests) || 0);
    const pDuration =
      Number(p.timeRoi?.actualAutoDurationMs) ||
      (Number(unit.durationMs) || 0) + (Number(int.durationMs) || 0) + (Number(sys.durationMs) || 0);

    totalExecutedTests += pTotalTests;
    totalPassedTests += pPassedTests;
    totalFailedTests += pFailedTests;
    cumulativeDurationMs += pDuration;

    // AI & Gaps
    const ai = p.aiMetrics || {};
    totalAiGenerated += Number(ai.aiGeneratedTests) || 0;
    totalAiRepaired += Number(ai.aiRepairedTests) || 0;
    totalUncoveredGaps += Number(ai.uncoveredGaps) || 0;
  }

  const avgHealthScore =
    testedProjectsCount > 0 ? Math.round(sumHealth / testedProjectsCount) : 0;

  let portfolioGrade = "—";
  if (testedProjectsCount > 0) {
    if (avgHealthScore >= PORTFOLIO_CONFIG.grades.A) portfolioGrade = "A";
    else if (avgHealthScore >= PORTFOLIO_CONFIG.grades.B) portfolioGrade = "B";
    else if (avgHealthScore >= PORTFOLIO_CONFIG.grades.C) portfolioGrade = "C";
    else portfolioGrade = "D";
  }

  const avgUnitCoverage =
    activeCoverageProjectsCount > 0
      ? toFixedPct(sumUnitCoverage / activeCoverageProjectsCount)
      : 0;
  const avgIntegrationCoverage =
    activeCoverageProjectsCount > 0
      ? toFixedPct(sumIntCoverage / activeCoverageProjectsCount)
      : 0;
  const avgSystemCoverage =
    activeCoverageProjectsCount > 0
      ? toFixedPct(sumSysCoverage / activeCoverageProjectsCount)
      : 0;

  const weights = PORTFOLIO_CONFIG.weights;
  const weightedUnifiedCoverage = toFixedPct(
    avgUnitCoverage * weights.unit +
      avgIntegrationCoverage * weights.integration +
      avgSystemCoverage * weights.system
  );

  const overallPassRate =
    totalExecutedTests > 0
      ? toFixedPct((totalPassedTests / totalExecutedTests) * 100)
      : 0;

  const timeRoi = aggregatePortfolioTimeAndRoi(projects);

  return {
    totalProjects,
    timeRoi,
    gateBreakdown: {
      passed: passedProjects,
      atRisk: atRiskProjects,
      blocked: blockedProjects,
      untested: untestedProjects,
      passedPct: totalProjects > 0 ? toFixedPct((passedProjects / totalProjects) * 100) : 0,
    },
    card1Health: {
      avgHealthScore,
      grade: portfolioGrade,
      totalProjects,
      passedProjects,
      atRiskProjects,
      blockedProjects,
      untestedProjects,
    },
    card2Coverage: {
      unifiedCoveragePct: weightedUnifiedCoverage,
      avgUnitCoveragePct: avgUnitCoverage,
      avgIntegrationCoveragePct: avgIntegrationCoverage,
      avgSystemCoveragePct: avgSystemCoverage,
    },
    card3Scale: {
      totalExecutedTests,
      totalPassedTests,
      totalFailedTests,
      overallPassRatePct: overallPassRate,
      unitPassedStr: `${passedUnitTests}/${totalUnitTests}`,
      apiCoveredStr:
        totalApis > 0
          ? `${coveredApis}/${totalApis}`
          : `${passedIntTests}/${totalIntTests}`,
      systemVerifiedStr: `${verifiedJourneys}/${totalJourneys}`,
      cumulativeDurationStr: formatPortfolioDuration(cumulativeDurationMs),
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
 * Compute benchmark bars & scatter plot quadrant matrix (Zone 3)
 */
export function computeBenchmarkAndQuadrantData(projects = []) {
  const { coverageCutoff, passRateCutoff, definitions } = PORTFOLIO_CONFIG.riskQuadrants;

  const benchmarkItems = projects.map((p) => {
    const unitPct = Number(p.pillars?.unit?.coveragePct ?? 0);
    const intPct = Number(p.pillars?.integration?.coveragePct ?? 0);
    const sysPct = Number(p.pillars?.system?.coveragePct ?? 0);

    const allValues = [unitPct, intPct, sysPct];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const hasImbalance = (maxVal - minVal >= 40 && (unitPct === 0 || intPct === 0 || sysPct === 0)) || (unitPct > 0 && intPct === 0);

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
        ? `Layer deficit: ${unitPct}% Unit vs ${intPct}% API coverage`
        : null,
    };
  });

  const quadrantNodes = projects.map((p) => {
    const x = Number(p.unifiedCoveragePct ?? 0);
    const y = p.passRatePct !== null && p.passRatePct !== undefined ? Number(p.passRatePct) : 0;

    let quadrantId;
    if (x >= coverageCutoff && y >= passRateCutoff) {
      quadrantId = "healthy-stars";
    } else if (x < coverageCutoff && y >= passRateCutoff) {
      quadrantId = "false-security";
    } else if (x >= coverageCutoff && y < passRateCutoff) {
      quadrantId = "active-regressions";
    } else {
      quadrantId = "critical-risk";
    }

    const def =
      definitions[
        quadrantId === "healthy-stars"
          ? "healthyStars"
          : quadrantId === "false-security"
          ? "falseSecurity"
          : quadrantId === "active-regressions"
          ? "activeRegressions"
          : "criticalRisk"
      ];

    return {
      projectId: p.id,
      name: p.name,
      x,
      y,
      gateStatus: p.gateStatus,
      gateLabel: p.gateLabel || p.gateStatus,
      healthScore: p.healthScore,
      grade: p.grade || "—",
      quadrantId,
      quadrantLabel: def.label,
      color: def.color,
      isUntested: (p.gateStatus || "").toUpperCase() === "UNTESTED",
    };
  });

  return {
    benchmarkItems,
    quadrantNodes,
    coverageCutoff,
    passRateCutoff,
    definitions,
  };
}

/**
 * Filter & Sort Projects for Directory Workspace (Zone 4)
 */
export function filterAndSortPortfolioProjects(
  projects = [],
  {
    searchQuery = "",
    statusFilter = "all",
    layerDeficit = "all",
    sortBy = "health-desc",
    favorites = [],
  } = {}
) {
  let list = [...projects];

  // 1. Search Query Filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    list = list.filter((p) => {
      const nameMatch = p.name?.toLowerCase().includes(q);
      const branchMatch = p.branch?.toLowerCase().includes(q);
      const snapshotMatch = p.snapshotId?.toLowerCase().includes(q);
      const fwMatch = Array.isArray(p.frameworks)
        ? p.frameworks.some((f) => f.toLowerCase().includes(q))
        : false;
      return nameMatch || branchMatch || snapshotMatch || fwMatch;
    });
  }

  // 2. Status Filter
  if (statusFilter === "pinned") {
    list = list.filter((p) => favorites.includes(p.id) || p.isPinned);
  } else if (statusFilter && statusFilter !== "all") {
    list = list.filter(
      (p) => (p.gateStatus || "").toUpperCase() === statusFilter.toUpperCase()
    );
  }

  // 3. Layer Deficit Filter
  if (layerDeficit === "deficit-unit") {
    list = list.filter((p) => Number(p.pillars?.unit?.coveragePct ?? 0) < 20);
  } else if (layerDeficit === "deficit-integration") {
    list = list.filter(
      (p) => Number(p.pillars?.integration?.coveragePct ?? 0) < 20
    );
  } else if (layerDeficit === "deficit-system") {
    list = list.filter((p) => Number(p.pillars?.system?.coveragePct ?? 0) < 20);
  }

  // 4. Sort Selector
  list.sort((a, b) => {
    // Pinned always bubble up if sorting by health or recent
    const aFav = favorites.includes(a.id) || a.isPinned ? 1 : 0;
    const bFav = favorites.includes(b.id) || b.isPinned ? 1 : 0;

    if (sortBy === "health-desc") {
      if (bFav !== aFav) return bFav - aFav;
      return (b.healthScore ?? 0) - (a.healthScore ?? 0);
    }
    if (sortBy === "health-asc") {
      return (a.healthScore ?? 0) - (b.healthScore ?? 0);
    }
    if (sortBy === "coverage-desc") {
      return (b.unifiedCoveragePct ?? 0) - (a.unifiedCoveragePct ?? 0);
    }
    if (sortBy === "gaps-desc") {
      const aGaps = a.aiMetrics?.uncoveredGaps ?? 0;
      const bGaps = b.aiMetrics?.uncoveredGaps ?? 0;
      return bGaps - aGaps;
    }
    if (sortBy === "name-asc") {
      return (a.name || "").localeCompare(b.name || "");
    }
    // "recent" default
    if (bFav !== aFav) return bFav - aFav;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });

  return list;
}

const LIFECYCLE_FILTER_TAG_LABELS = {
  all: "State: All",
  DOING: "State: Doing",
  NOT_STARTED: "State: Not Started",
  COMPLETED: "State: Completed",
  PAUSED: "State: Paused",
  CANCELLED: "State: Cancelled",
};

/**
 * Filter projects by portfolio lifecycle scope ("active" = DOING + NOT_STARTED, "all", or specific state)
 */
export function filterProjectsByLifecycle(projects = [], lifecycleTab = "active") {
  if (lifecycleTab === "active") {
    return projects.filter(
      (p) =>
        p.lifecycleStatus === "DOING" ||
        p.lifecycleStatus === "NOT_STARTED" ||
        !p.lifecycleStatus
    );
  }
  if (lifecycleTab === "all") return projects;
  return projects.filter(
    (p) => (p.lifecycleStatus || "NOT_STARTED") === lifecycleTab
  );
}

/**
 * Reuse server attention queue items for matching projects and synthesize items for non-DOING subsets
 */
export function synthesizePortfolioAttentionQueue(
  projects = [],
  serverAttentionQueue = []
) {
  const byProject = new Map();
  for (const item of serverAttentionQueue || []) {
    if (!item?.projectId) continue;
    const existing = byProject.get(item.projectId);
    if (existing) existing.push(item);
    else byProject.set(item.projectId, [item]);
  }

  const queue = [];
  for (const p of projects) {
    const serverItems = byProject.get(p.id);
    if (serverItems && serverItems.length > 0) {
      queue.push(...serverItems);
      continue;
    }

    const unit = p.pillars?.unit || {};
    const int = p.pillars?.integration || {};
    const sys = p.pillars?.system || {};

    if (p.gateStatus === "BLOCKED") {
      const failedPillar =
        (int.failedTests || 0) > 0
          ? "integration"
          : (unit.failedTests || 0) > 0
            ? "unit"
            : "system";

      const failCount =
        (unit.failedTests || 0) +
        (int.failedTests || 0) +
        (sys.failedTests || 0);

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
          (int.totalApis || 0) > 0
            ? `${int.totalApis} API endpoints discovered with 0 executed test suites.`
            : `Project repository is imported with 0 executed test suites.`,
        ctaLabel: "Run Suites ↗",
        targetPillar: "unit",
        targetFocus: {},
      });
    } else if ((int.uncoveredApis || 0) > 0) {
      queue.push({
        id: `attn-${p.id}-uncovered-apis`,
        projectId: p.id,
        projectName: p.name,
        severity: "HIGH",
        category: "missing-deps",
        pillar: "integration",
        title: `${int.uncoveredApis} uncovered API endpoints in ${p.name}`,
        description: `${int.coveredApis || 0}/${int.totalApis || 0} APIs covered (${int.coveragePct || 0}%). Synthesize integration tests to close gaps.`,
        ctaLabel: "Synthesize API Tests ↗",
        targetPillar: "integration",
        targetFocus: {},
      });
    }
  }

  return queue;
}

/**
 * Derive a complete PortfolioVM scoped to current UI filter criteria in realtime
 */
export function deriveFilteredPortfolioVm(
  vm,
  {
    searchQuery = "",
    lifecycleTab = "active",
    statusFilter = "all",
    layerDeficit = "all",
    sortBy = "health-desc",
    favorites = [],
  } = {}
) {
  const allProjects = vm?.projects || [];
  const allLifecycleCounts = computePortfolioLifecycleCounts(allProjects);
  const lifecycleFilteredProjects = filterProjectsByLifecycle(
    allProjects,
    lifecycleTab
  );
  const filteredProjects = filterAndSortPortfolioProjects(
    lifecycleFilteredProjects,
    {
      searchQuery,
      statusFilter,
      layerDeficit,
      sortBy,
      favorites,
    }
  );

  const filteredIdSet = new Set(filteredProjects.map((p) => p.id));
  const kpis = computePortfolioExecutiveKpis(filteredProjects);
  const timeRoiAnalytics = kpis.timeRoi;
  const benchmarkAndQuadrant =
    computeBenchmarkAndQuadrantData(filteredProjects);
  const lifecycleCounts = computePortfolioLifecycleCounts(filteredProjects);
  const attentionQueue = synthesizePortfolioAttentionQueue(
    filteredProjects,
    vm?.attentionQueue || []
  );
  const activityFeed = (vm?.activityFeed || []).filter((evt) =>
    filteredIdSet.has(evt.projectId)
  );

  const activeFilterTags = [];
  if (lifecycleTab && lifecycleTab !== "active") {
    activeFilterTags.push({
      key: "lifecycle",
      label: LIFECYCLE_FILTER_TAG_LABELS[lifecycleTab] || `State: ${lifecycleTab}`,
    });
  }
  const trimmedSearch = searchQuery.trim();
  if (trimmedSearch) {
    activeFilterTags.push({
      key: "search",
      label: `Search: "${trimmedSearch}"`,
    });
  }
  if (statusFilter === "pinned") {
    activeFilterTags.push({
      key: "status",
      label: "Pinned only",
    });
  } else if (statusFilter && statusFilter !== "all") {
    activeFilterTags.push({
      key: "status",
      label: `Gate: ${statusFilter}`,
    });
  }
  if (layerDeficit && layerDeficit !== "all") {
    const opt = PORTFOLIO_CONFIG.layerDeficitOptions.find(
      (o) => o.value === layerDeficit
    );
    activeFilterTags.push({
      key: "layerDeficit",
      label: opt?.label || layerDeficit,
    });
  }

  const isFiltered = activeFilterTags.length > 0;

  const filteredVm = {
    ...(vm || {}),
    projects: filteredProjects,
    kpis,
    timeRoiAnalytics,
    lifecycleCounts,
    analytics: {
      ...(vm?.analytics || {}),
      ...benchmarkAndQuadrant,
      timeRoiAnalytics,
    },
    attentionQueue,
    activityFeed,
    metadata: {
      ...(vm?.metadata || {}),
      activeProjectsCount: filteredProjects.filter(
        (p) => p.lifecycleStatus === "DOING"
      ).length,
      matchingProjectsCount: filteredProjects.length,
      totalProjectsCount: allProjects.length,
      totalSnapshotsCount: filteredProjects.filter((p) => p.snapshotId).length,
    },
  };

  return {
    filteredVm,
    filteredProjects,
    lifecycleFilteredProjects,
    allLifecycleCounts,
    isFiltered,
    activeFilterTags,
  };
}
