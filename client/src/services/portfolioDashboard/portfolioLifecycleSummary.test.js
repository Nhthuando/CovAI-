import test from "node:test";
import assert from "node:assert/strict";
import { resolvePortfolioLifecycleSummary } from "./portfolioLifecycleSummary.js";

test("resolvePortfolioLifecycleSummary tracks DOING-only KPI scope and counts all non-DOING states as excluded", () => {
  const allCounts = { DOING: 3, NOT_STARTED: 1, COMPLETED: 2, PAUSED: 1, CANCELLED: 0 };
  const filteredCounts = { DOING: 3, NOT_STARTED: 1, COMPLETED: 0, PAUSED: 0, CANCELLED: 0 };

  const res = resolvePortfolioLifecycleSummary({
    isFiltered: false,
    filteredCounts,
    allCounts,
  });

  assert.equal(res.displayCounts, allCounts);
  assert.equal(res.doingCount, 3);
  assert.equal(res.notStartedCount, 1);
  assert.equal(res.isolatedCount, 3);
  assert.equal(res.excludedFromActiveCount, 4);
  assert.equal(res.scopeBadge, "KPI Scope: Doing only · 4 excluded");
  assert.equal(res.donutScopeLabel, "All projects");
  assert.equal(res.isShowingFullBreakdown, true);
});

test("resolvePortfolioLifecycleSummary explains when 0 DOING projects are active", () => {
  const allCounts = { DOING: 0, NOT_STARTED: 2, COMPLETED: 1, PAUSED: 0, CANCELLED: 0 };
  const res = resolvePortfolioLifecycleSummary({
    isFiltered: false,
    filteredCounts: allCounts,
    allCounts,
  });

  assert.equal(res.excludedFromActiveCount, 3);
  assert.equal(res.scopeBadge, "KPI Scope: Doing only · 0 active (3 excluded)");
});

test("resolvePortfolioLifecycleSummary keeps full portfolio breakdown even when directory filter is active", () => {
  const allCounts = { DOING: 3, NOT_STARTED: 1, COMPLETED: 2, PAUSED: 1, CANCELLED: 0 };
  const filteredCounts = { DOING: 0, NOT_STARTED: 0, COMPLETED: 2, PAUSED: 0, CANCELLED: 0 };

  const res = resolvePortfolioLifecycleSummary({
    isFiltered: true,
    filteredCounts,
    allCounts,
  });

  assert.equal(res.displayCounts, allCounts);
  assert.equal(res.excludedFromActiveCount, 4);
  assert.equal(res.scopeBadge, "KPI Scope: Doing only · 4 excluded");
  assert.equal(res.donutScopeLabel, "All projects");
  assert.equal(res.isShowingFullBreakdown, false);
});

test("resolvePortfolioLifecycleSummary handles missing or null counts safely", () => {
  const res = resolvePortfolioLifecycleSummary();
  assert.equal(res.displayCounts, null);
  assert.equal(res.excludedFromActiveCount, 0);
  assert.equal(res.scopeBadge, "KPI Scope: Doing only");
  assert.equal(res.donutScopeLabel, "All projects");
});
