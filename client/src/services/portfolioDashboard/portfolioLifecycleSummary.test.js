import test from "node:test";
import assert from "node:assert/strict";
import { resolvePortfolioLifecycleSummary } from "./portfolioLifecycleSummary.js";

test("resolvePortfolioLifecycleSummary shows full breakdown and exclusion count on default Active scope", () => {
  const allCounts = { DOING: 3, NOT_STARTED: 1, COMPLETED: 2, PAUSED: 1, CANCELLED: 0 };
  const filteredCounts = { DOING: 3, NOT_STARTED: 1, COMPLETED: 0, PAUSED: 0, CANCELLED: 0 };

  const res = resolvePortfolioLifecycleSummary({
    isFiltered: false,
    filteredCounts,
    allCounts,
  });

  assert.equal(res.displayCounts, allCounts);
  assert.equal(res.excludedFromActiveCount, 3);
  assert.equal(res.scopeBadge, "Active only · 3 excluded");
  assert.equal(res.donutScopeLabel, "All projects");
  assert.equal(res.isShowingFullBreakdown, true);
});

test("resolvePortfolioLifecycleSummary returns plain Active scope badge when 0 projects are excluded", () => {
  const allCounts = { DOING: 2, NOT_STARTED: 1, COMPLETED: 0, PAUSED: 0, CANCELLED: 0 };
  const res = resolvePortfolioLifecycleSummary({
    isFiltered: false,
    filteredCounts: allCounts,
    allCounts,
  });

  assert.equal(res.excludedFromActiveCount, 0);
  assert.equal(res.scopeBadge, "Active scope");
});

test("resolvePortfolioLifecycleSummary switches to filtered counts when any filter is active", () => {
  const allCounts = { DOING: 3, NOT_STARTED: 1, COMPLETED: 2, PAUSED: 1, CANCELLED: 0 };
  const filteredCounts = { DOING: 0, NOT_STARTED: 0, COMPLETED: 2, PAUSED: 0, CANCELLED: 0 };

  const res = resolvePortfolioLifecycleSummary({
    isFiltered: true,
    filteredCounts,
    allCounts,
  });

  assert.equal(res.displayCounts, filteredCounts);
  assert.equal(res.excludedFromActiveCount, 3);
  assert.equal(res.scopeBadge, "Filtered scope");
  assert.equal(res.donutScopeLabel, "Filtered");
  assert.equal(res.isShowingFullBreakdown, false);
});

test("resolvePortfolioLifecycleSummary handles missing or null counts safely", () => {
  const res = resolvePortfolioLifecycleSummary();
  assert.equal(res.displayCounts, null);
  assert.equal(res.excludedFromActiveCount, 0);
  assert.equal(res.scopeBadge, "Active scope");
  assert.equal(res.donutScopeLabel, "All projects");
});
