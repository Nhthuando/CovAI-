import test from "node:test";
import assert from "node:assert/strict";
import {
  computePortfolioExecutiveKpis,
  computeBenchmarkAndQuadrantData,
  filterAndSortPortfolioProjects,
  formatPortfolioDuration,
} from "./portfolioDashboard.selectors.js";
import { DEMO_PORTFOLIO_PROJECTS } from "./portfolioDashboard.mock.js";

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

