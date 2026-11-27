import test from "node:test";
import assert from "node:assert/strict";
import {
  computePortfolioExecutiveKpis,
  computeBenchmarkAndQuadrantData,
  filterAndSortPortfolioProjects,
  formatPortfolioDuration,
  aggregatePortfolioTimeAndRoi,
  computePortfolioLifecycleCounts,
  deriveFilteredPortfolioVm,
} from "./portfolioDashboard.selectors.js";
import {
  DEMO_PORTFOLIO_PROJECTS,
  DEMO_CROSS_PROJECT_ATTENTION_QUEUE,
  DEMO_PORTFOLIO_ACTIVITY_FEED,
} from "./portfolioDashboard.mock.js";

test("computePortfolioExecutiveKpis calculates accurate portfolio totals & measured layer metadata", () => {
  const kpis = computePortfolioExecutiveKpis(DEMO_PORTFOLIO_PROJECTS);

  assert.equal(kpis.totalProjects, 6);
  assert.equal(kpis.gateBreakdown.passed, 2);
  assert.equal(kpis.gateBreakdown.atRisk, 2);
  assert.equal(kpis.gateBreakdown.blocked, 1);
  assert.equal(kpis.gateBreakdown.untested, 1);

  assert.ok(kpis.card1Health.avgHealthScore >= 70 && kpis.card1Health.avgHealthScore <= 85);
  assert.ok(["A", "B", "C"].includes(kpis.card1Health.grade));

  // Measured layer counts exclude unmeasured 0-test layers (merchant-admin-portal has 0 integration tests)
  assert.equal(kpis.card2Coverage.layerCoverageMeta.unit.measuredCount, 5);
  assert.equal(kpis.card2Coverage.layerCoverageMeta.integration.measuredCount, 4);
  assert.equal(kpis.card2Coverage.layerCoverageMeta.system.measuredCount, 5);
  assert.equal(kpis.card2Coverage.layerCoverageMeta.unit.totalKpiProjects, 6);

  // Card 3 Scale totals
  assert.equal(kpis.card3Scale.totalExecutedTests, 849);
  assert.equal(kpis.card3Scale.totalPassedTests, 821);
  assert.equal(kpis.card3Scale.totalFailedTests, 28);
  assert.equal(kpis.card3Scale.overallPassRatePct, 96.7);

  // Card 4 AI Impact totals
  assert.ok(kpis.card4AiImpact.aiGeneratedCount > 0);
  assert.ok(kpis.card4AiImpact.aiRepairedCount > 0);
  assert.equal(
    kpis.card4AiImpact.totalAiTests,
    kpis.card4AiImpact.aiGeneratedCount + kpis.card4AiImpact.aiRepairedCount,
  );
  assert.ok(kpis.card4AiImpact.uncoveredGapsCount > 0);
});

test("computeBenchmarkAndQuadrantData classifies active nodes & isolates UNTESTED from Critical Risk", () => {
  const { quadrantNodes, benchmarkItems } = computeBenchmarkAndQuadrantData(DEMO_PORTFOLIO_PROJECTS);

  assert.equal(quadrantNodes.length, 6);
  assert.equal(benchmarkItems.length, 6);

  const paymentNode = quadrantNodes.find((n) => n.projectId === "proj-payment-gw");
  assert.equal(paymentNode.quadrantId, "healthy-stars");
  assert.equal(paymentNode.isUntested, false);

  const merchantNode = quadrantNodes.find((n) => n.projectId === "proj-merchant-portal");
  assert.equal(merchantNode.quadrantId, "false-security");
  assert.equal(merchantNode.isUntested, false);

  const untestedNode = quadrantNodes.find((n) => n.projectId === "proj-inventory-sync");
  assert.equal(untestedNode.quadrantId, "untested");
  assert.equal(untestedNode.isUntested, true);
  assert.equal(untestedNode.x, null);
  assert.equal(untestedNode.y, null);

  const merchantBench = benchmarkItems.find((b) => b.projectId === "proj-merchant-portal");
  assert.equal(merchantBench.intPct, null);
  assert.equal(merchantBench.hasImbalance, true);
});

test("filterAndSortPortfolioProjects handles search, status, layer deficit, and sorting", () => {
  const searchResults = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    searchQuery: "payment",
  });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].name, "payment-gateway-service");

  const passedProjects = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    statusFilter: "PASSED",
  });
  assert.equal(passedProjects.length, 2);

  const blockedProjects = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    statusFilter: "BLOCKED",
  });
  assert.equal(blockedProjects.length, 1);
  assert.equal(blockedProjects[0].name, "order-fulfillment-api");

  const missingInt = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    layerDeficit: "deficit-integration",
  });
  assert.equal(missingInt.length, 2);

  const sortedAsc = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    sortBy: "health-asc",
  });
  assert.equal(sortedAsc[0].healthScore, 0);
  assert.equal(sortedAsc[sortedAsc.length - 1].healthScore, 94);
});

test("formatPortfolioDuration handles milliseconds and minutes accurately", () => {
  assert.equal(formatPortfolioDuration(500), "500ms");
  assert.equal(formatPortfolioDuration(45000), "45s");
  assert.equal(formatPortfolioDuration(135000), "2m 15s");
});

function buildLivePortfolioFixture() {
  const projects = DEMO_PORTFOLIO_PROJECTS.map((p, idx) => {
    const lifecycleById = {
      "proj-payment-gw": "DOING",
      "proj-auth-sso": "COMPLETED",
      "proj-covai-core": "DOING",
      "proj-merchant-portal": "PAUSED",
      "proj-order-api": "DOING",
      "proj-inventory-sync": "NOT_STARTED",
    };
    const autoMs =
      (p.pillars.unit.durationMs || 0) +
      (p.pillars.integration.durationMs || 0) +
      (p.pillars.system.durationMs || 0);
    const manualMs = (idx + 1) * 600_000;
    const savedHours = Number(((idx + 1) * 1.5).toFixed(2));
    return {
      ...p,
      lifecycleStatus: lifecycleById[p.id] || "DOING",
      timeRoi: {
        actualAutoDurationMs: autoMs,
        estimatedManualDurationMs: manualMs,
        executionTimeSavedMs: Math.max(0, manualMs - autoMs),
        aiAuthoringSavedMinutes:
          (p.aiMetrics.aiGeneratedTests + p.aiMetrics.aiRepairedTests) * 15,
        totalHoursSaved: savedHours,
      },
    };
  });

  return {
    projects,
    attentionQueue: DEMO_CROSS_PROJECT_ATTENTION_QUEUE.filter((a) =>
      ["proj-order-api", "proj-covai-core"].includes(a.projectId),
    ),
    activityFeed: DEMO_PORTFOLIO_ACTIVITY_FEED,
    metadata: { lastSyncedAt: "2026-10-28T22:20:00.000Z" },
  };
}

test("aggregatePortfolioTimeAndRoi attaches CovAI heuristic baseline metadata and handles empty arrays", () => {
  const fixture = buildLivePortfolioFixture();
  const subset = fixture.projects.slice(0, 2);
  const roi = aggregatePortfolioTimeAndRoi(subset);

  assert.equal(roi.activeProjectsCount, 2);
  assert.equal(roi.projectsWithExecutions, 2);
  assert.ok(roi.totalAutoDurationMs > 0);
  assert.ok(roi.totalManualDurationMs > 0);
  assert.ok(roi.totalQaHoursSaved > 0);
  assert.ok(roi.averageSpeedupMultiplier > 1);
  assert.equal(roi.isHeuristicEstimate, true);
  assert.equal(roi.baselineLabel, "Est. (CovAI Baseline)");
  assert.equal(/IEEE\s*829/i.test(roi.methodologyNote), false);

  const emptyRoi = aggregatePortfolioTimeAndRoi([]);
  assert.equal(emptyRoi.activeProjectsCount, 0);
  assert.equal(emptyRoi.totalAutoDurationMs, 0);
  assert.equal(emptyRoi.totalQaHoursSaved, 0);
  assert.equal(emptyRoi.averageSpeedupMultiplier, 0);
  assert.equal(emptyRoi.speedupStr, "—");
});

test("computePortfolioExecutiveKpis returns null metrics instead of fake zeros when empty", () => {
  const emptyKpis = computePortfolioExecutiveKpis([]);
  assert.equal(emptyKpis.totalProjects, 0);
  assert.equal(emptyKpis.card1Health.avgHealthScore, null);
  assert.equal(emptyKpis.card1Health.grade, "—");
  assert.equal(emptyKpis.card2Coverage.unifiedCoveragePct, null);
  assert.equal(emptyKpis.card2Coverage.avgUnitCoveragePct, null);
  assert.equal(emptyKpis.card3Scale.totalExecutedTests, 0);
  assert.equal(emptyKpis.card3Scale.overallPassRatePct, null);
  assert.equal(emptyKpis.timeRoi.totalQaHoursSaved, 0);
});

test("deriveFilteredPortfolioVm enforces D2 KPI Scope isolation across all 5 lifecycle states and directory filters", () => {
  const vm = buildLivePortfolioFixture();

  // 1. Default "open" scope shows DOING (3) + NOT_STARTED (1) in directory,
  // while KPIs strictly measure DOING (3) projects
  const openRes = deriveFilteredPortfolioVm(vm, { lifecycleTab: "open" });
  assert.equal(openRes.isFiltered, false);
  assert.equal(openRes.filteredProjects.length, 4);
  assert.equal(openRes.kpiScopeProjects.length, 3);
  assert.equal(openRes.allLifecycleCounts.all, 6);
  assert.equal(openRes.allLifecycleCounts.open, 4);
  assert.equal(openRes.allLifecycleCounts.active, 3);
  assert.equal(openRes.allLifecycleCounts.DOING, 3);
  assert.equal(openRes.allLifecycleCounts.NOT_STARTED, 1);
  assert.equal(openRes.allLifecycleCounts.PAUSED, 1);
  assert.equal(openRes.allLifecycleCounts.COMPLETED, 1);
  assert.equal(openRes.allLifecycleCounts.CANCELLED, 0);
  assert.equal(openRes.filteredVm.metadata.activeProjectsCount, 3);
  assert.equal(openRes.filteredVm.metadata.matchingProjectsCount, 4);
  assert.equal(openRes.filteredVm.metadata.totalProjectsCount, 6);
  assert.equal(openRes.filteredVm.analytics.benchmarkItems.length, 3);
  assert.equal(openRes.filteredVm.analytics.quadrantNodes.length, 3);

  const baselineKpisSnapshot = JSON.stringify(openRes.filteredVm.kpis);
  const baselineAnalyticsSnapshot = JSON.stringify(openRes.filteredVm.analytics);

  // 2. Filtering directory by COMPLETED, PAUSED, NOT_STARTED, CANCELLED, "all", or search
  // MUST NOT leak excluded projects into Executive KPIs or Portfolio Analytics
  for (const tab of ["COMPLETED", "PAUSED", "NOT_STARTED", "CANCELLED", "all"]) {
    const res = deriveFilteredPortfolioVm(vm, { lifecycleTab: tab });
    assert.equal(res.isFiltered, true);
    assert.equal(JSON.stringify(res.filteredVm.kpis), baselineKpisSnapshot);
    assert.equal(JSON.stringify(res.filteredVm.analytics), baselineAnalyticsSnapshot);
    assert.equal(res.filteredVm.metadata.isFiltered, true);
    assert.equal(res.filteredVm.lifecycleCounts.all, 6);
  }

  const completedRes = deriveFilteredPortfolioVm(vm, { lifecycleTab: "COMPLETED" });
  assert.equal(completedRes.filteredProjects.length, 1);
  assert.equal(completedRes.filteredProjects[0].id, "proj-auth-sso");
  assert.equal(completedRes.activeFilterTags[0].label, "State: Completed");

  const searchRes = deriveFilteredPortfolioVm(vm, {
    lifecycleTab: "open",
    searchQuery: "order",
  });
  assert.equal(searchRes.isFiltered, true);
  assert.equal(searchRes.filteredProjects.length, 1);
  assert.equal(searchRes.filteredProjects[0].id, "proj-order-api");
  assert.equal(JSON.stringify(searchRes.filteredVm.kpis), baselineKpisSnapshot);
  assert.equal(searchRes.filteredVm.activityFeed.length, 1);

  const emptySearchRes = deriveFilteredPortfolioVm(vm, {
    lifecycleTab: "open",
    searchQuery: "no-such-project-xyz",
  });
  assert.equal(emptySearchRes.filteredProjects.length, 0);
  assert.equal(emptySearchRes.filteredVm.metadata.matchingProjectsCount, 0);
  assert.equal(JSON.stringify(emptySearchRes.filteredVm.kpis), baselineKpisSnapshot);
  assert.equal(computePortfolioLifecycleCounts(emptySearchRes.filteredProjects).total, 0);
});

test("deriveFilteredPortfolioVm returns null KPIs when 0 DOING projects exist", () => {
  const vm = buildLivePortfolioFixture();
  const onlyNonDoing = {
    ...vm,
    projects: vm.projects.map((p) =>
      p.lifecycleStatus === "DOING" ? { ...p, lifecycleStatus: "NOT_STARTED" } : p,
    ),
  };

  const res = deriveFilteredPortfolioVm(onlyNonDoing, { lifecycleTab: "open" });
  assert.equal(res.kpiScopeProjects.length, 0);
  assert.equal(res.filteredVm.kpis.card1Health.avgHealthScore, null);
  assert.equal(res.filteredVm.kpis.card2Coverage.unifiedCoveragePct, null);
  assert.equal(res.filteredVm.kpis.card3Scale.totalExecutedTests, 0);
  assert.equal(res.filteredVm.metadata.activeProjectsCount, 0);
});
