import {
  PORTFOLIO_FILTER_SCOPE_LABELS,
  PORTFOLIO_GRADE_THRESHOLDS,
  PORTFOLIO_RISK_QUADRANT_CUTOFFS,
  PORTFOLIO_ROI_BASELINE,
  isKpiIncludedLifecycleStatus,
  isOpenWorkspaceLifecycleStatus,
  computePassRatePct,
  computeNormalizedWeightedAverage,
  classifyRiskQuadrant,
  roundMetric,
} from "../../../../shared/portfolioGovernance.js";
import { PORTFOLIO_CONFIG } from "./portfolioDashboard.config.js";

function isLayerMeasured(layer) {
  if (!layer) return false;
  if (layer.coverageMeasured === true) return true;
  if (layer.coverageMeasured === false) return false;
  if (
    layer.coveragePct === null ||
    layer.coveragePct === undefined ||
    layer.coveragePct === ""
  ) {
    return false;
  }
  const cov = Number(layer.coveragePct);
  if (!Number.isFinite(cov)) return false;
  return (Number(layer.totalTests) || 0) > 0 || cov > 0;
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
    totalManualExecutionDurationFormatted: formatPortfolioHours(
      totalManualDurationMs / 3_600_000,
    ),
    executionHoursSaved,
    aiAuthoringHoursSaved,
    totalQaHoursSaved,
    totalQaHoursSavedStr: formatPortfolioHours(totalQaHoursSaved),
    speedupMultiplier,
    averageSpeedupMultiplier: speedupMultiplier,
    speedupStr: speedupMultiplier > 0 ? `${speedupMultiplier}x Faster` : "—",
    projectsWithExecutions,
    activeProjectsCount: projects.length,
    isHeuristicEstimate: PORTFOLIO_ROI_BASELINE.isHeuristicEstimate,
    baselineLabel: PORTFOLIO_ROI_BASELINE.label,
    methodologyNote: PORTFOLIO_ROI_BASELINE.methodologyNote,
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
    open: DOING + NOT_STARTED,
    active: DOING,
    isolated: PAUSED + COMPLETED + CANCELLED,
    excludedFromKpis: NOT_STARTED + PAUSED + COMPLETED + CANCELLED,
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
 * Compute Portfolio Executive KPI cards (Zone 2) matching BE computeExecutiveKpis SSOT.
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
  let unitCovCount = 0;
  let sumIntCoverage = 0;
  let intCovCount = 0;
  let sumSysCoverage = 0;
  let sysCovCount = 0;

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

    const isTested = gate !== "UNTESTED" && p.healthScore !== null && p.healthScore !== undefined;
    if (isTested) {
      sumHealth += Number(p.healthScore) || 0;
      testedProjectsCount++;
    }

    const unit = p.pillars?.unit || {};
    const int = p.pillars?.integration || {};
    const sys = p.pillars?.system || {};

    if (isLayerMeasured(unit)) {
      sumUnitCoverage += Number(unit.coveragePct);
      unitCovCount++;
    }
    if (isLayerMeasured(int)) {
      sumIntCoverage += Number(int.coveragePct);
      intCovCount++;
    }
    if (isLayerMeasured(sys)) {
      sumSysCoverage += Number(sys.coveragePct);
      sysCovCount++;
    }

    totalUnitTests += Number(unit.totalTests) || 0;
    passedUnitTests += Number(unit.passedTests) || 0;
    totalIntTests += Number(int.totalTests) || 0;
    passedIntTests += Number(int.passedTests) || 0;

    totalApis +=
      Number(int.totalApis) ||
      (Number(int.coveredApis) || 0) + (Number(int.uncoveredApis) || 0);
    coveredApis += Number(int.coveredApis) || 0;

    totalJourneys += Number(sys.totalJourneys) || Number(sys.totalTests) || 0;
    verifiedJourneys += Number(sys.coveredJourneys) || Number(sys.passedTests) || 0;

    const pTotalTests =
      (Number(unit.totalTests) || 0) +
      (Number(int.totalTests) || 0) +
      (Number(sys.totalTests) || 0);
    const pPassedTests =
      (Number(unit.passedTests) || 0) +
      (Number(int.passedTests) || 0) +
      (Number(sys.passedTests) || 0);
    const pFailedTests =
      (Number(unit.failedTests) || 0) +
      (Number(int.failedTests) || 0) +
      (Number(sys.failedTests) || 0);
    const pDuration =
      Number(p.timeRoi?.actualAutoDurationMs) ||
      (Number(unit.durationMs) || 0) +
        (Number(int.durationMs) || 0) +
        (Number(sys.durationMs) || 0);

    totalExecutedTests += pTotalTests;
    totalPassedTests += pPassedTests;
    totalFailedTests += pFailedTests;
    cumulativeDurationMs += pDuration;

    const ai = p.aiMetrics || {};
    totalAiGenerated += Number(ai.aiGeneratedTests) || 0;
    totalAiRepaired += Number(ai.aiRepairedTests) || 0;
    totalUncoveredGaps += Number(ai.uncoveredGaps) || 0;
  }

  const avgHealthScore =
    testedProjectsCount > 0 ? Math.round(sumHealth / testedProjectsCount) : null;

  let portfolioGrade = "—";
  if (avgHealthScore !== null) {
    if (avgHealthScore >= PORTFOLIO_GRADE_THRESHOLDS.A) portfolioGrade = "A";
    else if (avgHealthScore >= PORTFOLIO_GRADE_THRESHOLDS.B) portfolioGrade = "B";
    else if (avgHealthScore >= PORTFOLIO_GRADE_THRESHOLDS.C) portfolioGrade = "C";
    else portfolioGrade = "D";
  }

  const avgUnitCoverage =
    unitCovCount > 0 ? roundMetric(sumUnitCoverage / unitCovCount, 1) : null;
  const avgIntegrationCoverage =
    intCovCount > 0 ? roundMetric(sumIntCoverage / intCovCount, 1) : null;
  const avgSystemCoverage =
    sysCovCount > 0 ? roundMetric(sumSysCoverage / sysCovCount, 1) : null;

  const unifiedAgg = computeNormalizedWeightedAverage({
    unit: avgUnitCoverage,
    integration: avgIntegrationCoverage,
    system: avgSystemCoverage,
  });

  const overallPassRate = computePassRatePct(totalPassedTests, totalFailedTests);
  const timeRoi = aggregatePortfolioTimeAndRoi(projects);

  return {
    totalProjects,
    timeRoi,
    gateBreakdown: {
      passed: passedProjects,
      atRisk: atRiskProjects,
      blocked: blockedProjects,
      untested: untestedProjects,
      passedPct: totalProjects > 0 ? roundMetric((passedProjects / totalProjects) * 100, 1) : 0,
    },
    card1Health: {
      avgHealthScore,
      grade: portfolioGrade,
      totalProjects,
      testedProjects: testedProjectsCount,
      passedProjects,
      atRiskProjects,
      blockedProjects,
      untestedProjects,
    },
    card2Coverage: {
      unifiedCoveragePct: unifiedAgg.value,
      avgUnitCoveragePct: avgUnitCoverage,
      avgIntegrationCoveragePct: avgIntegrationCoverage,
      avgSystemCoveragePct: avgSystemCoverage,
      layerCoverageMeta: {
        unit: {
          avgPct: avgUnitCoverage,
          measuredCount: unitCovCount,
          totalKpiProjects: totalProjects,
        },
        integration: {
          avgPct: avgIntegrationCoverage,
          measuredCount: intCovCount,
          totalKpiProjects: totalProjects,
        },
        system: {
          avgPct: avgSystemCoverage,
          measuredCount: sysCovCount,
          totalKpiProjects: totalProjects,
        },
      },
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
 * Compute benchmark bars & scatter plot quadrant matrix (Zone 3) using shared classification
 */
export function computeBenchmarkAndQuadrantData(projects = []) {
  const { coverageCutoff, passRateCutoff } = PORTFOLIO_RISK_QUADRANT_CUTOFFS;
  const definitions = PORTFOLIO_CONFIG.riskQuadrants.definitions;

  const benchmarkItems = projects.map((p) => {
    const unitPct = isLayerMeasured(p.pillars?.unit)
      ? Number(p.pillars.unit.coveragePct)
      : null;
    const intPct = isLayerMeasured(p.pillars?.integration)
      ? Number(p.pillars.integration.coveragePct)
      : null;
    const sysPct = isLayerMeasured(p.pillars?.system)
      ? Number(p.pillars.system.coveragePct)
      : null;

    const unitNum = unitPct ?? 0;
    const intNum = intPct ?? 0;
    const sysNum = sysPct ?? 0;
    const allValues = [unitNum, intNum, sysNum];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const hasImbalance =
      (maxVal - minVal >= 40 && minVal === 0) || (unitNum > 0 && intNum === 0);

    return {
      projectId: p.id,
      name: p.name,
      gateStatus: p.gateStatus,
      healthScore: p.healthScore ?? null,
      unitPct,
      intPct,
      sysPct,
      hasImbalance,
      imbalanceReason: hasImbalance
        ? `Layer deficit: ${unitPct ?? "N/A"}% Unit vs ${intPct ?? "N/A"}% API`
        : null,
    };
  });

  const quadrantColorById = {
    "healthy-stars": "var(--ud-pass)",
    "false-security": "var(--ud-warn)",
    "active-regressions": "#fb8500",
    "critical-risk": "var(--ud-fail)",
    untested: "var(--ps-neutral)",
  };

  const quadrantNodes = projects.map((p) => {
    const classification = classifyRiskQuadrant({
      unifiedCoveragePct: p.unifiedCoveragePct,
      passRatePct: p.passRatePct,
      gateStatus: p.gateStatus,
    });

    return {
      projectId: p.id,
      name: p.name,
      x: classification.isUntested ? null : (p.unifiedCoveragePct ?? null),
      y: classification.isUntested ? null : (p.passRatePct ?? null),
      gateStatus: p.gateStatus,
      gateLabel: p.gateLabel || p.gateStatus,
      healthScore: p.healthScore ?? null,
      grade: p.grade || "—",
      quadrantId: classification.quadrantId,
      quadrantLabel: classification.quadrantLabel,
      color: quadrantColorById[classification.quadrantId] || "var(--ps-neutral)",
      isUntested: classification.isUntested,
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
  } = {},
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
      (p) => (p.gateStatus || "").toUpperCase() === statusFilter.toUpperCase(),
    );
  }

  // 3. Layer Deficit Filter (null/unmeasured coverage counts as < 20)
  if (layerDeficit === "deficit-unit") {
    list = list.filter((p) => (p.pillars?.unit?.coveragePct ?? 0) < 20);
  } else if (layerDeficit === "deficit-integration") {
    list = list.filter((p) => (p.pillars?.integration?.coveragePct ?? 0) < 20);
  } else if (layerDeficit === "deficit-system") {
    list = list.filter((p) => (p.pillars?.system?.coveragePct ?? 0) < 20);
  }

  // 4. Sort Selector
  list.sort((a, b) => {
    const aFav = favorites.includes(a.id) || a.isPinned ? 1 : 0;
    const bFav = favorites.includes(b.id) || b.isPinned ? 1 : 0;

    if (sortBy === "health-desc") {
      if (bFav !== aFav) return bFav - aFav;
      return (b.healthScore ?? -1) - (a.healthScore ?? -1);
    }
    if (sortBy === "health-asc") {
      return (a.healthScore ?? 0) - (b.healthScore ?? 0);
    }
    if (sortBy === "coverage-desc") {
      return (b.unifiedCoveragePct ?? -1) - (a.unifiedCoveragePct ?? -1);
    }
    if (sortBy === "gaps-desc") {
      const aGaps = a.aiMetrics?.uncoveredGaps ?? 0;
      const bGaps = b.aiMetrics?.uncoveredGaps ?? 0;
      return bGaps - aGaps;
    }
    if (sortBy === "name-asc") {
      return (a.name || "").localeCompare(b.name || "");
    }
    if (bFav !== aFav) return bFav - aFav;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });

  return list;
}

/**
 * Filter projects by portfolio lifecycle scope ("open" / "active" = DOING + NOT_STARTED, "all", or specific state)
 */
export function filterProjectsByLifecycle(projects = [], lifecycleTab = "open") {
  if (lifecycleTab === "open" || lifecycleTab === "active") {
    return projects.filter((p) => isOpenWorkspaceLifecycleStatus(p.lifecycleStatus));
  }
  if (lifecycleTab === "all") return projects;
  return projects.filter((p) => (p.lifecycleStatus || "NOT_STARTED") === lifecycleTab);
}

/**
 * Reuse server attention queue items for matching KPI-scope projects and synthesize fallback items
 */
export function synthesizePortfolioAttentionQueue(
  projects = [],
  serverAttentionQueue = [],
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
        description: `${int.coveredApis || 0}/${int.totalApis || 0} APIs covered (${int.coveragePct ?? 0}%). Synthesize integration tests to close gaps.`,
        ctaLabel: "Synthesize API Tests ↗",
        targetPillar: "integration",
        targetFocus: {},
      });
    }
  }

  return queue;
}

/**
 * Derive PortfolioVM:
 * - Directory project list respects UI filters (searchQuery, lifecycleTab, statusFilter, layerDeficit, sortBy)
 * - Executive KPIs & Portfolio Analytics stay strictly locked to Active KPI Scope (DOING only) per D2
 */
export function deriveFilteredPortfolioVm(
  vm,
  {
    searchQuery = "",
    lifecycleTab = "open",
    statusFilter = "all",
    layerDeficit = "all",
    sortBy = "health-desc",
    favorites = [],
  } = {},
) {
  const allProjects = vm?.projects || [];
  const allLifecycleCounts = computePortfolioLifecycleCounts(allProjects);

  // Strict D2 KPI Scope: ONLY DOING projects feed Executive KPIs & Portfolio Analytics
  const kpiScopeProjects = allProjects.filter((p) =>
    isKpiIncludedLifecycleStatus(p.lifecycleStatus),
  );

  // Directory list filtering (never leaks isolated/filtered states into Executive KPIs)
  const lifecycleFilteredProjects = filterProjectsByLifecycle(
    allProjects,
    lifecycleTab,
  );
  const filteredProjects = filterAndSortPortfolioProjects(
    lifecycleFilteredProjects,
    {
      searchQuery,
      statusFilter,
      layerDeficit,
      sortBy,
      favorites,
    },
  );

  const filteredIdSet = new Set(filteredProjects.map((p) => p.id));

  const kpis = computePortfolioExecutiveKpis(kpiScopeProjects);
  const timeRoiAnalytics = kpis.timeRoi;
  const benchmarkAndQuadrant = computeBenchmarkAndQuadrantData(kpiScopeProjects);
  const directoryLifecycleCounts = computePortfolioLifecycleCounts(filteredProjects);
  const attentionQueue = synthesizePortfolioAttentionQueue(
    kpiScopeProjects,
    vm?.attentionQueue || [],
  );

  const activeFilterTags = [];
  if (lifecycleTab && lifecycleTab !== "open" && lifecycleTab !== "active") {
    const scopeLabel =
      PORTFOLIO_FILTER_SCOPE_LABELS[lifecycleTab] || lifecycleTab;
    activeFilterTags.push({
      key: "lifecycle",
      label: `State: ${scopeLabel}`,
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
      (o) => o.value === layerDeficit,
    );
    activeFilterTags.push({
      key: "layerDeficit",
      label: opt?.label || layerDeficit,
    });
  }

  const isFiltered = activeFilterTags.length > 0;
  const activityFeed = isFiltered
    ? (vm?.activityFeed || []).filter((evt) => filteredIdSet.has(evt.projectId))
    : vm?.activityFeed || [];

  const filteredVm = {
    ...(vm || {}),
    projects: filteredProjects,
    kpiProjects: kpiScopeProjects,
    kpis,
    timeRoiAnalytics,
    lifecycleCounts: allLifecycleCounts,
    directoryLifecycleCounts,
    analytics: {
      ...(vm?.analytics || {}),
      ...benchmarkAndQuadrant,
      timeRoiAnalytics,
    },
    attentionQueue,
    activityFeed,
    metadata: {
      ...(vm?.metadata || {}),
      activeProjectsCount: kpiScopeProjects.length,
      doingProjectsCount: allLifecycleCounts.DOING,
      openProjectsCount: allLifecycleCounts.open,
      isolatedProjectsCount: allLifecycleCounts.isolated,
      matchingProjectsCount: filteredProjects.length,
      totalProjectsCount: allProjects.length,
      totalSnapshotsCount: allProjects.filter((p) => p.snapshotId).length,
      isFiltered,
      kpiScopeLabel: "Active KPI Scope (Doing only)",
    },
  };

  return {
    filteredVm,
    filteredProjects,
    kpiScopeProjects,
    lifecycleFilteredProjects,
    allLifecycleCounts,
    isFiltered,
    activeFilterTags,
  };
}
