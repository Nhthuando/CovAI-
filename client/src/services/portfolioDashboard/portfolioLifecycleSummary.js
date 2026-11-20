/**
 * Resolve which lifecycle breakdown counts and scope badges to display in Portfolio KPIs and Donut
 * without altering filtered counts when an explicit filter is active.
 */
export function resolvePortfolioLifecycleSummary({
  isFiltered = false,
  filteredCounts = null,
  allCounts = null,
} = {}) {
  const excludedFromActiveCount =
    Number(allCounts?.COMPLETED || 0) +
    Number(allCounts?.PAUSED || 0) +
    Number(allCounts?.CANCELLED || 0);

  const displayCounts = isFiltered
    ? filteredCounts || allCounts || null
    : allCounts || filteredCounts || null;

  let scopeBadge = "Active scope";
  if (isFiltered) {
    scopeBadge = "Filtered scope";
  } else if (excludedFromActiveCount > 0) {
    scopeBadge = `Active only · ${excludedFromActiveCount} excluded`;
  }

  return {
    displayCounts,
    excludedFromActiveCount,
    scopeBadge,
    donutScopeLabel: isFiltered ? "Filtered" : "All projects",
    isShowingFullBreakdown: !isFiltered,
  };
}
