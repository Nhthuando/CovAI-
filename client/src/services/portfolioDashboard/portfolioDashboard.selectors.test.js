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

test("computePortfolioExecutiveKpis calculates accurate portfolio totals from demo projects", () => {
  const kpis = computePortfolioExecutiveKpis(DEMO_PORTFOLIO_PROJECTS);

  // Total projects = 6
  assert.equal(kpis.totalProjects, 6);

  // Gate breakdown: 2 Passed, 2 At Risk, 1 Blocked, 1 Untested
  assert.equal(kpis.gateBreakdown.passed, 2);
  assert.equal(kpis.gateBreakdown.atRisk, 2);
  assert.equal(kpis.gateBreakdown.blocked, 1);
  assert.equal(kpis.gateBreakdown.untested, 1);

  // Health score (tested projects average)
  assert.ok(kpis.card1Health.avgHealthScore >= 70 && kpis.card1Health.avgHealthScore <= 85);
  assert.ok(["A", "B", "C"].includes(kpis.card1Health.grade));

  // Card 3 Scale totals
  // Sum of executed tests across projects: 210+24+8 (payment-gw: 242) + 164+12+6 (auth-sso: 182) + 144+25+13 (covai-core: 182) + 116+0+8 (merchant: 124) + 94+15+10 (order: 119) = 849
  assert.equal(kpis.card3Scale.totalExecutedTests, 849);
  assert.equal(kpis.card3Scale.totalPassedTests, 821);
  assert.equal(kpis.card3Scale.totalFailedTests, 28);
  assert.equal(kpis.card3Scale.overallPassRatePct, 96.7);

  // Card 4 AI Impact totals
  assert.ok(kpis.card4AiImpact.totalAiTests > 0);
  assert.ok(kpis.card4AiImpact.uncoveredGapsCount > 0);
});

test("computeBenchmarkAndQuadrantData classifies projects into valid 4-quadrant categories", () => {
  const { quadrantNodes, benchmarkItems } = computeBenchmarkAndQuadrantData(DEMO_PORTFOLIO_PROJECTS);

  assert.equal(quadrantNodes.length, 6);
  assert.equal(benchmarkItems.length, 6);

  // payment-gw (92.8% cov, 100% pass) -> healthy-stars
  const paymentNode = quadrantNodes.find((n) => n.projectId === "proj-payment-gw");
  assert.equal(paymentNode.quadrantId, "healthy-stars");

  // merchant-admin-portal (53.5% cov, 97.6% pass) -> false-security (high pass, low cov)
  const merchantNode = quadrantNodes.find((n) => n.projectId === "proj-merchant-portal");
  assert.equal(merchantNode.quadrantId, "false-security");

  // order-fulfillment-api (56.3% cov, 85.7% pass)
  const orderNode = quadrantNodes.find((n) => n.projectId === "proj-order-api");
  assert.ok(["active-regressions", "critical-risk", "false-security"].includes(orderNode.quadrantId));

  // merchant portal has 88.5% unit vs 0% api -> hasImbalance is true
  const merchantBench = benchmarkItems.find((b) => b.projectId === "proj-merchant-portal");
  assert.equal(merchantBench.hasImbalance, true);
});

test("filterAndSortPortfolioProjects handles search, status, layer deficit, and sorting", () => {
  // 1. Search filter
  const searchResults = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    searchQuery: "payment",
  });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].name, "payment-gateway-service");

  // 2. Status filter
  const passedProjects = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    statusFilter: "PASSED",
  });
  assert.equal(passedProjects.length, 2);

  const blockedProjects = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    statusFilter: "BLOCKED",
  });
  assert.equal(blockedProjects.length, 1);
  assert.equal(blockedProjects[0].name, "order-fulfillment-api");

  // 3. Layer deficit filter
  const missingInt = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    layerDeficit: "deficit-integration",
  });
  // merchant-admin-portal (0% int) and legacy-inventory-sync (0% int)
  assert.equal(missingInt.length, 2);

  // 4. Sort by health ascending
  const sortedAsc = filterAndSortPortfolioProjects(DEMO_PORTFOLIO_PROJECTS, {
    sortBy: "health-asc",
  });
  assert.equal(sortedAsc[0].healthScore, 0); // legacy-inventory-sync is 0
  assert.equal(sortedAsc[sortedAsc.length - 1].healthScore, 94); // payment-gw is 94
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
        aiAuthoringSavedMinutes: (p.aiMetrics.aiGeneratedTests + p.aiMetrics.aiRepairedTests) * 15,
        totalHoursSaved: savedHours,
      },
    };
  });

  return {
    projects,
    attentionQueue: DEMO_CROSS_PROJECT_ATTENTION_QUEUE.filter((a) =>
      ["proj-order-api", "proj-covai-core"].includes(a.projectId)
    ),
    activityFeed: DEMO_PORTFOLIO_ACTIVITY_FEED,
    metadata: { lastSyncedAt: "2026-10-28T22:20:00.000Z" },
  };
}

test("aggregatePortfolioTimeAndRoi sums metrics accurately across project subsets and handles empty arrays", () => {
  const fixture = buildLivePortfolioFixture();
  const subset = fixture.projects.slice(0, 2);
  const roi = aggregatePortfolioTimeAndRoi(subset);

  assert.equal(roi.activeProjectsCount, 2);
  assert.equal(roi.projectsWithExecutions, 2);
  assert.ok(roi.totalAutoDurationMs > 0);
  assert.ok(roi.totalManualDurationMs > 0);
  assert.ok(roi.totalQaHoursSaved > 0);
  assert.ok(roi.averageSpeedupMultiplier > 1);
  assert.equal(typeof roi.totalAutoExecutionDurationFormatted, "string");
  assert.equal(typeof roi.totalManualExecutionDurationFormatted, "string");

  const emptyRoi = aggregatePortfolioTimeAndRoi([]);
  assert.equal(emptyRoi.activeProjectsCount, 0);
  assert.equal(emptyRoi.totalAutoDurationMs, 0);
  assert.equal(emptyRoi.totalQaHoursSaved, 0);
  assert.equal(emptyRoi.averageSpeedupMultiplier, 0);
  assert.equal(emptyRoi.speedupStr, "—");
});

test("computePortfolioExecutiveKpis attaches timeRoi and handles empty arrays safely", () => {
  const kpis = computePortfolioExecutiveKpis(buildLivePortfolioFixture().projects.slice(0, 2));
  assert.ok(kpis.timeRoi);
  assert.equal(kpis.totalProjects, 2);
  assert.ok(kpis.timeRoi.totalQaHoursSaved > 0);

  const emptyKpis = computePortfolioExecutiveKpis([]);
  assert.equal(emptyKpis.totalProjects, 0);
  assert.equal(emptyKpis.card1Health.avgHealthScore, 0);
  assert.equal(emptyKpis.card1Health.grade, "—");
  assert.equal(emptyKpis.card2Coverage.unifiedCoveragePct, 0);
  assert.equal(emptyKpis.card3Scale.totalExecutedTests, 0);
  assert.equal(emptyKpis.card3Scale.overallPassRatePct, 0);
  assert.equal(emptyKpis.timeRoi.totalQaHoursSaved, 0);
});

test("deriveFilteredPortfolioVm updates KPIs, charts, lifecycle counts, attentionQueue, activityFeed, and metadata in realtime", () => {
  const vm = buildLivePortfolioFixture();

  // 1. Default active scope: DOING (3) + NOT_STARTED (1) = 4 projects
  const activeRes = deriveFilteredPortfolioVm(vm, { lifecycleTab: "active" });
  assert.equal(activeRes.isFiltered, false);
  assert.equal(activeRes.filteredProjects.length, 4);
  assert.equal(activeRes.allLifecycleCounts.all, 6);
  assert.equal(activeRes.allLifecycleCounts.DOING, 3);
  assert.equal(activeRes.allLifecycleCounts.COMPLETED, 1);
  assert.equal(activeRes.filteredVm.lifecycleCounts.total, 4);
  assert.equal(activeRes.filteredVm.lifecycleCounts.COMPLETED, 0);
  assert.equal(activeRes.filteredVm.analytics.benchmarkItems.length, 4);
  assert.equal(activeRes.filteredVm.analytics.quadrantNodes.length, 4);
  assert.equal(activeRes.filteredVm.metadata.totalProjectsCount, 6);
  assert.equal(activeRes.filteredVm.metadata.matchingProjectsCount, 4);

  // 2. Search filter inside active scope: "order" -> matches only proj-order-api
  const searchRes = deriveFilteredPortfolioVm(vm, {
    lifecycleTab: "active",
    searchQuery: "order",
  });
  assert.equal(searchRes.isFiltered, true);
  assert.equal(searchRes.filteredProjects.length, 1);
  assert.equal(searchRes.filteredProjects[0].id, "proj-order-api");
  assert.equal(searchRes.filteredVm.kpis.card1Health.avgHealthScore, 54);
  assert.equal(searchRes.filteredVm.kpis.card3Scale.totalExecutedTests, 119);
  assert.equal(searchRes.filteredVm.analytics.benchmarkItems.length, 1);
  assert.equal(searchRes.filteredVm.analytics.quadrantNodes.length, 1);
  assert.ok(searchRes.filteredVm.timeRoiAnalytics.totalAutoDurationMs > 0);
  assert.ok(searchRes.filteredVm.attentionQueue.every((a) => a.projectId === "proj-order-api"));
  assert.ok(searchRes.filteredVm.activityFeed.every((e) => e.projectId === "proj-order-api"));
  assert.equal(searchRes.filteredVm.activityFeed.length, 1);
  assert.equal(searchRes.allLifecycleCounts.all, 6);

  // 3. COMPLETED lifecycle filter -> non-DOING project with 1 uncovered API synthesizes attention item
  const completedRes = deriveFilteredPortfolioVm(vm, { lifecycleTab: "COMPLETED" });
  assert.equal(completedRes.isFiltered, true);
  assert.equal(completedRes.filteredProjects.length, 1);
  assert.equal(completedRes.filteredProjects[0].id, "proj-auth-sso");
  assert.equal(completedRes.filteredVm.kpis.card1Health.avgHealthScore, 91);
  assert.equal(completedRes.filteredVm.lifecycleCounts.COMPLETED, 1);
  assert.equal(completedRes.filteredVm.lifecycleCounts.DOING, 0);
  assert.equal(completedRes.filteredVm.attentionQueue.length, 1);
  assert.equal(completedRes.filteredVm.attentionQueue[0].category, "missing-deps");
  assert.equal(completedRes.filteredVm.activityFeed.length, 1);
  assert.equal(completedRes.filteredVm.activityFeed[0].projectId, "proj-auth-sso");

  // 4. NOT_STARTED lifecycle filter -> synthesizes zero-test attention item
  const notStartedRes = deriveFilteredPortfolioVm(vm, { lifecycleTab: "NOT_STARTED" });
  assert.equal(notStartedRes.filteredProjects.length, 1);
  assert.equal(notStartedRes.filteredVm.attentionQueue.length, 1);
  assert.equal(notStartedRes.filteredVm.attentionQueue[0].category, "zero-test");

  // 5. Pinned filter under "all" lifecycle scope
  const pinnedRes = deriveFilteredPortfolioVm(vm, {
    lifecycleTab: "all",
    statusFilter: "pinned",
  });
  assert.equal(pinnedRes.filteredProjects.length, 2);
  assert.ok(pinnedRes.activeFilterTags.some((t) => t.key === "lifecycle"));
  assert.ok(pinnedRes.activeFilterTags.some((t) => t.key === "status"));

  // 6. Layer deficit filter under "all" lifecycle scope
  const deficitRes = deriveFilteredPortfolioVm(vm, {
    lifecycleTab: "all",
    layerDeficit: "deficit-integration",
  });
  assert.equal(deficitRes.filteredProjects.length, 2);
  assert.equal(deficitRes.filteredVm.analytics.benchmarkItems.length, 2);

  // 7. Zero-match search filter produces zeroed numeric fields without NaN
  const emptyRes = deriveFilteredPortfolioVm(vm, {
    lifecycleTab: "active",
    searchQuery: "no-such-project-xyz",
  });
  assert.equal(emptyRes.isFiltered, true);
  assert.equal(emptyRes.filteredProjects.length, 0);
  assert.equal(emptyRes.filteredVm.kpis.card1Health.avgHealthScore, 0);
  assert.equal(emptyRes.filteredVm.kpis.card1Health.grade, "—");
  assert.equal(emptyRes.filteredVm.kpis.card2Coverage.unifiedCoveragePct, 0);
  assert.equal(emptyRes.filteredVm.kpis.card3Scale.totalExecutedTests, 0);
  assert.equal(Number.isNaN(emptyRes.filteredVm.kpis.card3Scale.overallPassRatePct), false);
  assert.equal(emptyRes.filteredVm.analytics.benchmarkItems.length, 0);
  assert.equal(emptyRes.filteredVm.analytics.quadrantNodes.length, 0);
  assert.equal(emptyRes.filteredVm.attentionQueue.length, 0);
  assert.equal(emptyRes.filteredVm.activityFeed.length, 0);
  assert.equal(emptyRes.filteredVm.metadata.matchingProjectsCount, 0);
  assert.equal(emptyRes.filteredVm.metadata.totalProjectsCount, 6);
  assert.equal(computePortfolioLifecycleCounts(emptyRes.filteredProjects).total, 0);
});

