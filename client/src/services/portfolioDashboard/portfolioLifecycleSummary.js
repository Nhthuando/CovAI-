/**
 * Resolve portfolio lifecycle breakdown counts and KPI scope badge under D2 rules.
 * KPIs strictly measure DOING projects; all non-DOING states are excluded from KPI totals.
 */
export function resolvePortfolioLifecycleSummary({
  isFiltered = false,
  filteredCounts = null,
  allCounts = null,
} = {}) {
  const counts = allCounts || filteredCounts || null;
  const doingCount = Number(counts?.DOING || 0);
  const notStartedCount = Number(counts?.NOT_STARTED || 0);
  const isolatedCount =
    Number(counts?.COMPLETED || 0) +
    Number(counts?.PAUSED || 0) +
    Number(counts?.CANCELLED || 0);
  const excludedFromActiveCount = notStartedCount + isolatedCount;

  const displayCounts = counts;

  let scopeBadge = "KPI Scope: Doing only";
  if (counts && doingCount === 0 && excludedFromActiveCount > 0) {
    scopeBadge = `KPI Scope: Doing only · 0 active (${excludedFromActiveCount} excluded)`;
  } else if (excludedFromActiveCount > 0) {
    scopeBadge = `KPI Scope: Doing only · ${excludedFromActiveCount} excluded`;
  }

  return {
    displayCounts,
    doingCount,
    notStartedCount,
    isolatedCount,
    excludedFromActiveCount,
    scopeBadge,
    donutScopeLabel: "All projects",
    isShowingFullBreakdown: !isFiltered,
  };
}
