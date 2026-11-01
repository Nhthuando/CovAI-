import { PORTFOLIO_CONFIG } from "./portfolioDashboard.config.js";

function toFixedPct(val, fallback = 0) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Number(num.toFixed(1));
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

    const isTested = gate !== "UNTESTED" && (p.healthScore || 0) > 0;
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

    totalApis += Number(int.totalApis) || (Number(int.coveredApis) || 0) + (Number(int.uncoveredApis) || 0);
    coveredApis += Number(int.coveredApis) || 0;

    totalJourneys += Number(sys.totalJourneys) || Number(sys.totalTests) || 0;
    verifiedJourneys += Number(sys.coveredJourneys) || Number(sys.passedTests) || 0;

    const pTotalTests = (Number(unit.totalTests) || 0) + (Number(int.totalTests) || 0) + (Number(sys.totalTests) || 0);
    const pPassedTests = (Number(unit.passedTests) || 0) + (Number(int.passedTests) || 0) + (Number(sys.passedTests) || 0);
    const pFailedTests = (Number(unit.failedTests) || 0) + (Number(int.failedTests) || 0) + (Number(sys.failedTests) || 0);
    const pDuration = (Number(unit.durationMs) || 0) + (Number(int.durationMs) || 0) + (Number(sys.durationMs) || 0);

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

  return {
    totalProjects,
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
      apiCoveredStr: `${coveredApis}/${totalApis}`,
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

    let quadrantId = "critical-risk";
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
