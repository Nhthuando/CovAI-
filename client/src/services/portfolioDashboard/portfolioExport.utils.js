import {
  PORTFOLIO_EXPORT_SCOPE_META,
  normalizePortfolioExportScope,
  normalizePortfolioExportFormat,
  isKpiIncludedLifecycleStatus,
} from "../../../../shared/portfolioGovernance.js";

/**
 * Parse Content-Disposition filename (supporting RFC 5987 filename*= and quoted filename="").
 */
export function parseContentDispositionFilename(
  headerValue = "",
  fallbackFilename = "covai-portfolio-report.pdf",
) {
  if (!headerValue || typeof headerValue !== "string") {
    return fallbackFilename;
  }

  const utf8Match = headerValue.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ""));
      if (decoded) return decoded;
    } catch {
      // Fallback to standard filename parsing below
    }
  }

  const basicMatch = headerValue.match(/filename\s*=\s*"([^"]+)"/i) ||
    headerValue.match(/filename\s*=\s*([^;\s]+)/i);
  if (basicMatch?.[1]) {
    const clean = basicMatch[1].trim().replace(/^["']|["']$/g, "");
    if (clean) return clean;
  }

  return fallbackFilename;
}

/**
 * Construct canonical fallback filename matching backend naming convention.
 */
export function buildClientExportFilename({
  scope = "active_kpi",
  format = "pdf",
  date = new Date(),
} = {}) {
  const canonicalScope = normalizePortfolioExportScope(scope) || "active_kpi";
  const canonicalFormat = normalizePortfolioExportFormat(format) || "pdf";
  const slug = PORTFOLIO_EXPORT_SCOPE_META[canonicalScope]?.filenameSlug || "active-kpi";
  const d = new Date(date);
  const yyyyMmDd = Number.isNaN(d.getTime())
    ? "report"
    : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate(),
      ).padStart(2, "0")}`;
  return `covai-portfolio-report-${slug}-${yyyyMmDd}.${canonicalFormat}`;
}

/**
 * Compute deterministic live scope preview counts for ExportPortfolioReportModal.
 */
export function computeExportScopePreview({
  scope = "active_kpi",
  allProjects = [],
  filteredProjects = [],
  isFiltered = false,
} = {}) {
  const canonicalScope = normalizePortfolioExportScope(scope) || "active_kpi";
  const scopeMeta = PORTFOLIO_EXPORT_SCOPE_META[canonicalScope];
  const allList = Array.isArray(allProjects) ? allProjects : [];
  const filteredList = Array.isArray(filteredProjects) ? filteredProjects : allList;

  let targetProjects;
  if (canonicalScope === "active_kpi") {
    targetProjects = allList.filter((p) => isKpiIncludedLifecycleStatus(p.lifecycleStatus));
  } else if (canonicalScope === "all") {
    targetProjects = allList;
  } else {
    targetProjects = filteredList;
  }

  const doingCount = targetProjects.filter((p) =>
    isKpiIncludedLifecycleStatus(p.lifecycleStatus),
  ).length;
  const excludedCount = targetProjects.length - doingCount;
  const untestedDoingCount = targetProjects.filter(
    (p) =>
      isKpiIncludedLifecycleStatus(p.lifecycleStatus) &&
      (p.gateStatus === "UNTESTED" || !p.gateStatus),
  ).length;

  let warningMessage = null;
  if (allList.length === 0) {
    warningMessage =
      "Your workspace has 0 projects. The exported report will reflect an empty portfolio state.";
  } else if (canonicalScope === "active_kpi" && doingCount === 0) {
    warningMessage =
      "0 projects are currently in Doing state. The exported report will honestly show N/A KPIs and explain isolated/backlog counts.";
  } else if (canonicalScope === "filtered" && targetProjects.length === 0) {
    warningMessage =
      "Current directory filters match 0 projects. Executive KPIs remain locked to workspace Doing projects.";
  } else if (canonicalScope === "filtered" && !isFiltered) {
    warningMessage =
      "No extra directory filters are currently applied beyond the default Open (Doing & Not Started) view.";
  } else if (canonicalScope === "all" && excludedCount > 0) {
    warningMessage = `${excludedCount} non-Doing project(s) will appear in the matrix as Isolated / Backlog while Executive KPIs remain locked to the ${doingCount} Doing project(s).`;
  }

  return {
    scope: canonicalScope,
    scopeMeta,
    projectCount: targetProjects.length,
    doingCount,
    excludedCount,
    untestedDoingCount,
    hasZeroDoing: doingCount === 0,
    warningMessage,
    selectedProjectIds: targetProjects.map((p) => p.id).filter(Boolean),
  };
}
