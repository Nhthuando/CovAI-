/**
 * @file portfolioReport.service.js
 * @description Canonical Single-Source-of-Truth builder & serializers (DTO, CSV, JSON)
 * and 100% deterministic rule-based Priority Findings engine for Portfolio Export Reports.
 */

import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { buildPortfolioOverview } from "./portfolioDashboard.service.js";
import {
  LIFECYCLE_META,
  PORTFOLIO_EXPORT_SCOPE_META,
  PORTFOLIO_QUALITY_GATE,
  PORTFOLIO_RISK_QUADRANT_CUTOFFS,
  PORTFOLIO_ROI_BASELINE,
  isKpiIncludedLifecycleStatus,
  normalizePortfolioExportScope,
  roundMetric,
} from "../../../shared/portfolioGovernance.js";

const STALE_EXECUTION_DAYS = 30;
const CSV_FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatUtc7Timestamp(value) {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d)} (UTC+7)`;
}

export function buildReportCode(now = new Date()) {
  const d = new Date(now);
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `PORT-${yyyy}${mm}${dd}-${hh}${min}`;
}

export function buildPortfolioExportFilename({
  scope = "active_kpi",
  format = "pdf",
  now = new Date(),
} = {}) {
  const canonicalScope = normalizePortfolioExportScope(scope) || "active_kpi";
  const meta = PORTFOLIO_EXPORT_SCOPE_META[canonicalScope] || PORTFOLIO_EXPORT_SCOPE_META.active_kpi;
  const d = new Date(now);
  const dateStr = Number.isNaN(d.getTime())
    ? "report"
    : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const ext = format === "pdf" || format === "csv" ? format : "json";
  return `covai-portfolio-report-${meta.filenameSlug}-${dateStr}.${ext}`;
}

/**
 * 100% Rule-Based Deterministic Priority Findings Engine (Zero AI / Zero Hallucination).
 * Every finding cites real project names and verified numeric values only.
 */
export function synthesizeDeterministicPortfolioFindings({
  overview = {},
  scopeProjects = [],
  scope = "active_kpi",
  now = new Date(),
} = {}) {
  const findings = [];
  const allProjects = overview?.projects || [];
  const lc = overview?.lifecycleCounts || {};
  const nowMs = new Date(now).getTime();

  if (allProjects.length === 0) {
    findings.push({
      id: "finding-portfolio-empty",
      priority: "P2",
      severity: "INFO",
      category: "portfolio-empty",
      projectId: null,
      projectName: null,
      title: "No projects found in workspace",
      detail: "0 accessible projects exist for this account.",
      recommendation:
        "Import a GitHub repository or upload a project snapshot and execute an initial test suite to populate Portfolio KPIs.",
    });
    return findings;
  }

  if (scopeProjects.length === 0) {
    findings.push({
      id: "finding-scope-empty",
      priority: "P2",
      severity: "INFO",
      category: "scope-empty",
      projectId: null,
      projectName: null,
      title:
        scope === "active_kpi"
          ? "No active (Doing) projects in KPI scope"
          : "No projects matched the selected export scope",
      detail: `Workspace totals: ${lc.DOING || 0} Doing, ${lc.NOT_STARTED || 0} Not Started, ${lc.PAUSED || 0} Paused, ${lc.COMPLETED || 0} Completed, ${lc.CANCELLED || 0} Cancelled. Executive KPIs remain unmeasured (—) while Doing count is 0.`,
      recommendation:
        scope === "active_kpi"
          ? "Execute a test suite or update a project lifecycle state to Doing to populate active Portfolio KPIs."
          : "Adjust directory filters or select All Projects to export isolated or backlog repositories.",
    });
    return findings;
  }

  const doingInScope = scopeProjects.filter((p) =>
    isKpiIncludedLifecycleStatus(p.lifecycleStatus),
  );

  if (scope !== "active_kpi" && doingInScope.length === 0) {
    findings.push({
      id: "finding-no-doing-in-selection",
      priority: "P2",
      severity: "INFO",
      category: "no-doing-projects",
      projectId: null,
      projectName: null,
      title: "Zero Doing projects in exported selection",
      detail: `All ${scopeProjects.length} project(s) in this export are isolated or Not Started. Executive KPI cards reflect only workspace-wide Doing projects (${lc.DOING || 0} active).`,
      recommendation:
        "Transition active projects to Doing (or trigger test runs on Not Started backlog) to track release quality in KPIs.",
    });
  }

  let hasNonInfoIssues = false;

  for (const p of doingInScope) {
    const unit = p.pillars?.unit || {};
    const integration = p.pillars?.integration || {};
    const system = p.pillars?.system || {};
    const unitFailed = Number(unit.failedTests || 0);
    const intFailed = Number(integration.failedTests || 0);
    const sysFailed = Number(system.failedTests || 0);
    const totalFailed = unitFailed + intFailed + sysFailed;
    const executedTests =
      Number(unit.totalTests || 0) +
      Number(integration.totalTests || 0) +
      Number(system.totalTests || 0);

    // P0 / CRITICAL: Test failures or pass rate below minimum gate (80%)
    if (
      totalFailed > 0 ||
      (p.passRatePct !== null &&
        p.passRatePct !== undefined &&
        p.passRatePct < PORTFOLIO_QUALITY_GATE.minPassRatePct)
    ) {
      hasNonInfoIssues = true;
      const layerBreakdown = [
        unitFailed > 0 ? `Unit: ${unitFailed}` : null,
        intFailed > 0 ? `API: ${intFailed}` : null,
        sysFailed > 0 ? `E2E: ${sysFailed}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      findings.push({
        id: `finding-blocker-${p.id}`,
        priority: "P0",
        severity: "CRITICAL",
        category: "release-blocker",
        projectId: p.id,
        projectName: p.name,
        title: `Release blocker in ${p.name}: ${totalFailed} failing test(s)`,
        detail: `${p.name} (${p.branch || "local"}) recorded ${totalFailed} failed test(s)${
          layerBreakdown ? ` [${layerBreakdown}]` : ""
        } across ${executedTests} executed tests (Pass Rate: ${
          p.passRatePct !== null && p.passRatePct !== undefined ? `${p.passRatePct}%` : "N/A"
        }).`,
        recommendation:
          "Fix failing assertions in the affected test layer before approving release readiness.",
      });
    } else if (
      p.passRatePct !== null &&
      p.passRatePct !== undefined &&
      p.passRatePct < PORTFOLIO_RISK_QUADRANT_CUTOFFS.passRateCutoff
    ) {
      hasNonInfoIssues = true;
      findings.push({
        id: `finding-passrate-${p.id}`,
        priority: "P1",
        severity: "HIGH",
        category: "low-pass-rate",
        projectId: p.id,
        projectName: p.name,
        title: `Low test pass rate in ${p.name} (${p.passRatePct}%)`,
        detail: `Pass rate (${p.passRatePct}%) is below the ${PORTFOLIO_RISK_QUADRANT_CUTOFFS.passRateCutoff}% Risk Quadrant threshold.`,
        recommendation:
          "Investigate unstable or failing test executions to restore pass rate >= 85%.",
      });
    }

    // P2 / MEDIUM: Active Doing project with 0 executed tests
    if (p.gateStatus === "UNTESTED" || executedTests === 0) {
      hasNonInfoIssues = true;
      findings.push({
        id: `finding-untested-${p.id}`,
        priority: "P2",
        severity: "MEDIUM",
        category: "untested-active",
        projectId: p.id,
        projectName: p.name,
        title: `Untested active project: ${p.name}`,
        detail: `${p.name} is in Doing state with 0 executed tests${
          (integration.totalApis || 0) > 0
            ? ` and ${integration.totalApis} discovered API endpoint(s)`
            : ""
        }. Excluded from Risk Quadrants until tested.`,
        recommendation:
          "Run Unit tests or generate automated Integration/E2E suites for the active snapshot.",
      });
      continue;
    }

    // P1 / HIGH: Unified coverage below 80% target
    if (
      p.unifiedCoveragePct !== null &&
      p.unifiedCoveragePct !== undefined &&
      p.unifiedCoveragePct < PORTFOLIO_QUALITY_GATE.coverageTargetPct
    ) {
      hasNonInfoIssues = true;
      findings.push({
        id: `finding-coverage-${p.id}`,
        priority: "P1",
        severity: "HIGH",
        category: "coverage-below-target",
        projectId: p.id,
        projectName: p.name,
        title: `Coverage below 80% target in ${p.name} (${p.unifiedCoveragePct}%)`,
        detail: `Unified coverage is ${p.unifiedCoveragePct}% (Unit: ${
          unit.coveragePct ?? "N/A"
        }%, API: ${integration.coveragePct ?? "N/A"}%, E2E: ${
          system.coveragePct ?? "N/A"
        }%). Target is >= ${PORTFOLIO_QUALITY_GATE.coverageTargetPct}%.`,
        recommendation:
          "Add tests targeting the lowest measured layer to raise unified coverage above 80%.",
      });
    }

    // P1 / HIGH: Uncovered discovered APIs
    if ((integration.uncoveredApis || 0) > 0) {
      hasNonInfoIssues = true;
      findings.push({
        id: `finding-uncovered-apis-${p.id}`,
        priority: "P1",
        severity: "HIGH",
        category: "uncovered-apis",
        projectId: p.id,
        projectName: p.name,
        title: `${integration.uncoveredApis} uncovered API endpoint(s) in ${p.name}`,
        detail: `${integration.coveredApis || 0} of ${integration.totalApis || 0} discovered API endpoints are covered (${integration.coveragePct ?? 0}%).`,
        recommendation:
          "Run Supertest or Playwright API coverage on uncovered routes to prevent contract regressions.",
      });
    }

    // P1 / HIGH: Low-branch unit files (< 75%)
    const lowBranchFiles = Number(p.aiMetrics?.lowBranchUnitFilesCount || 0);
    if (lowBranchFiles > 0) {
      hasNonInfoIssues = true;
      findings.push({
        id: `finding-low-branch-${p.id}`,
        priority: "P1",
        severity: "HIGH",
        category: "low-branch-files",
        projectId: p.id,
        projectName: p.name,
        title: `${lowBranchFiles} source file(s) below 75% branch coverage in ${p.name}`,
        detail: `${lowBranchFiles} unit coverage file(s) remain below the ${PORTFOLIO_QUALITY_GATE.lowBranchThresholdPct}% branch threshold.`,
        recommendation:
          "Use AI Unit Test Suggestions on low-branch functions to exercise conditional edge cases.",
      });
    }

    // P2 / MEDIUM: Unmeasured test layers
    const missingLayers = [];
    if (unit.coveragePct === null || unit.coveragePct === undefined) missingLayers.push("Unit");
    if (integration.coveragePct === null || integration.coveragePct === undefined) {
      missingLayers.push("API");
    }
    if (system.coveragePct === null || system.coveragePct === undefined) {
      missingLayers.push("E2E");
    }
    if (missingLayers.length > 0) {
      hasNonInfoIssues = true;
      findings.push({
        id: `finding-unmeasured-layers-${p.id}`,
        priority: "P2",
        severity: "MEDIUM",
        category: "unmeasured-layers",
        projectId: p.id,
        projectName: p.name,
        title: `Unmeasured layer(s) in ${p.name}: ${missingLayers.join(", ")}`,
        detail: `${p.name} lacks measured coverage instrumentation for ${missingLayers.join(", ")}. Unified score is re-normalized over measured layers only.`,
        recommendation: `Execute ${missingLayers.join("/")} test suites with coverage enabled for complete multi-layer visibility.`,
      });
    }

    // P3 / INFO: Stale execution (> 30 days)
    if (p.provenance?.lastExecutedAt && Number.isFinite(nowMs)) {
      const lastMs = new Date(p.provenance.lastExecutedAt).getTime();
      const ageDays = Math.floor((nowMs - lastMs) / 86_400_000);
      if (Number.isFinite(lastMs) && ageDays > STALE_EXECUTION_DAYS) {
        findings.push({
          id: `finding-stale-${p.id}`,
          priority: "P3",
          severity: "INFO",
          category: "stale-execution",
          projectId: p.id,
          projectName: p.name,
          title: `Stale test results in ${p.name} (${ageDays} days old)`,
          detail: `Most recent test execution was recorded ${ageDays} day(s) ago (${formatUtc7Timestamp(
            p.provenance.lastExecutedAt,
          )}).`,
          recommendation: "Re-run suites on the latest snapshot to verify current branch health.",
        });
      }
    }
  }

  // P3 / INFO: Lifecycle Governance Hygiene across workspace
  const isolatedCount =
    Number(lc.PAUSED || 0) + Number(lc.COMPLETED || 0) + Number(lc.CANCELLED || 0);
  if (isolatedCount > 0) {
    findings.push({
      id: "finding-lifecycle-isolation",
      priority: "P3",
      severity: "INFO",
      category: "lifecycle-governance",
      projectId: null,
      projectName: null,
      title: `${isolatedCount} isolated project(s) excluded from Executive KPIs`,
      detail: `${lc.PAUSED || 0} Paused, ${lc.COMPLETED || 0} Completed, and ${
        lc.CANCELLED || 0
      } Cancelled project(s) are strictly isolated from Portfolio Executive KPIs and Risk Quadrants.`,
      recommendation:
        "No action needed unless an isolated repository returns to active development.",
    });
  }

  if ((lc.NOT_STARTED || 0) > 0 && (lc.DOING || 0) > 0) {
    findings.push({
      id: "finding-backlog-not-started",
      priority: "P3",
      severity: "INFO",
      category: "lifecycle-backlog",
      projectId: null,
      projectName: null,
      title: `${lc.NOT_STARTED} project(s) in Not Started backlog`,
      detail: `${lc.NOT_STARTED} imported repository(ies) await an initial test run and are excluded from KPI averages.`,
      recommendation:
        "Run an initial suite or AI synthesis job to auto-transition active repositories to Doing.",
    });
  }

  // Verified Healthy Conclusion ONLY when all Doing projects are tested, 0 failures, and >= 80% coverage across all 3 layers
  if (doingInScope.length > 0 && !hasNonInfoIssues) {
    const kpis = overview?.activeKpis || {};
    findings.unshift({
      id: "finding-verified-healthy",
      priority: "P3",
      severity: "INFO",
      category: "verified-healthy",
      projectId: null,
      projectName: null,
      title: `All ${doingInScope.length} active (Doing) project(s) meet CovAI quality gates`,
      detail: `0 test failures, ${kpis.card2Coverage?.unifiedCoveragePct ?? "N/A"}% unified coverage (target >= ${PORTFOLIO_QUALITY_GATE.coverageTargetPct}%), and ${kpis.card3Scale?.overallPassRatePct ?? "N/A"}% pass rate across all measured layers.`,
      recommendation: "Maintain coverage and pass rates on upcoming snapshots.",
    });
  }

  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };
  return findings.sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
  );
}

/**
 * Canonical DTO builder shared by PDF, CSV, and JSON Portfolio Exports.
 */
export async function buildPortfolioReportDto({
  userId,
  scope = "active_kpi",
  projectIds = null,
  sections = null,
  filterSummary = null,
  db = prisma,
  overview = null,
  now = new Date(),
} = {}) {
  if (!userId) {
    throw new ServiceError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const canonicalScope = normalizePortfolioExportScope(scope);
  if (!canonicalScope) {
    throw new ServiceError(
      `Invalid export scope "${scope}". Expected one of: active_kpi, all, filtered.`,
      400,
      "INVALID_EXPORT_SCOPE",
    );
  }

  const [resolvedOverview, exporterUser] = await Promise.all([
    overview || buildPortfolioOverview({ userId, db }),
    typeof db?.user?.findUnique === "function"
      ? db.user
          .findUnique({
            where: { id: userId },
            select: { id: true, name: true, email: true },
          })
          .catch((err) => {
            console.warn("[buildPortfolioReportDto] User lookup failed:", err?.message || err);
            return null;
          })
      : Promise.resolve(null),
  ]);

  const allProjects = resolvedOverview?.projects || [];
  const accessibleById = new Map(allProjects.map((p) => [p.id, p]));

  let selectedProjects = [];
  if (canonicalScope === "active_kpi") {
    selectedProjects = allProjects.filter((p) =>
      isKpiIncludedLifecycleStatus(p.lifecycleStatus),
    );
  } else if (canonicalScope === "all") {
    selectedProjects = [...allProjects];
  } else {
    // STRICT IDOR GUARD: only allow projects already authorized for userId in buildPortfolioOverview
    if (Array.isArray(projectIds)) {
      const seen = new Set();
      for (const rawId of projectIds) {
        const cleanId = typeof rawId === "string" ? rawId.trim() : "";
        if (!cleanId || seen.has(cleanId)) continue;
        seen.add(cleanId);
        const match = accessibleById.get(cleanId);
        if (match) selectedProjects.push(match);
      }
    } else {
      selectedProjects = allProjects.filter(
        (p) => p.lifecycleStatus === "DOING" || p.lifecycleStatus === "NOT_STARTED",
      );
    }
  }

  const scopeMeta = PORTFOLIO_EXPORT_SCOPE_META[canonicalScope];
  const lc = resolvedOverview?.lifecycleCounts || {
    total: allProjects.length,
    DOING: allProjects.filter((p) => p.lifecycleStatus === "DOING").length,
    NOT_STARTED: allProjects.filter((p) => p.lifecycleStatus === "NOT_STARTED").length,
    PAUSED: allProjects.filter((p) => p.lifecycleStatus === "PAUSED").length,
    COMPLETED: allProjects.filter((p) => p.lifecycleStatus === "COMPLETED").length,
    CANCELLED: allProjects.filter((p) => p.lifecycleStatus === "CANCELLED").length,
  };

  const quadrantNodes = resolvedOverview?.analytics?.quadrantNodes || [];
  const riskCounts = {
    healthyStars: quadrantNodes.filter((n) => n.quadrantId === "healthy-stars").length,
    falseSecurity: quadrantNodes.filter((n) => n.quadrantId === "false-security").length,
    activeRegressions: quadrantNodes.filter((n) => n.quadrantId === "active-regressions").length,
    criticalRisk: quadrantNodes.filter((n) => n.quadrantId === "critical-risk").length,
    untested: quadrantNodes.filter((n) => n.quadrantId === "untested" || n.isUntested).length,
  };

  const normalizedProjects = selectedProjects.map((p) => {
    const unit = p.pillars?.unit || {};
    const integration = p.pillars?.integration || {};
    const system = p.pillars?.system || {};
    const executedTests =
      Number(unit.totalTests || 0) +
      Number(integration.totalTests || 0) +
      Number(system.totalTests || 0);
    const passedTests =
      Number(unit.passedTests || 0) +
      Number(integration.passedTests || 0) +
      Number(system.passedTests || 0);
    const failedTests =
      Number(unit.failedTests || 0) +
      Number(integration.failedTests || 0) +
      Number(system.failedTests || 0);
    const includedInKpi = isKpiIncludedLifecycleStatus(p.lifecycleStatus);
    const lifecycleMeta = LIFECYCLE_META[p.lifecycleStatus] || LIFECYCLE_META.NOT_STARTED;

    return {
      id: p.id,
      name: p.name,
      branch: p.branch || "local",
      branchSource: p.branchSource || null,
      snapshotLabel: p.snapshotLabel || null,
      lifecycleStatus: p.lifecycleStatus || "NOT_STARTED",
      lifecycleLabel: lifecycleMeta.label,
      kpiScope: includedInKpi ? "Included" : "Isolated",
      isExcludedFromActiveKpis: !includedInKpi,
      healthScore: p.healthScore ?? null,
      grade: p.grade || "—",
      gateStatus: p.gateStatus || "UNTESTED",
      gateLabel: p.gateLabel || "UNTESTED",
      unifiedCoveragePct: p.unifiedCoveragePct ?? null,
      unitCoveragePct: unit.coveragePct ?? null,
      apiCoveragePct: integration.coveragePct ?? null,
      e2eCoveragePct: system.coveragePct ?? null,
      executedTests,
      passedTests,
      failedTests,
      passRatePct: p.passRatePct ?? null,
      autoDurationMs: Number(p.timeRoi?.actualAutoDurationMs || 0),
      estimatedManualHours: roundMetric(Number(p.timeRoi?.estimatedManualHours || 0), 2) ?? 0,
      estimatedHoursSaved: roundMetric(Number(p.timeRoi?.totalHoursSaved || 0), 2) ?? 0,
      speedupMultiplier: Number(p.timeRoi?.speedupMultiplier || 0),
      speedupStr: p.timeRoi?.speedupStr || "—",
      aiGeneratedTests: Number(p.aiMetrics?.aiGeneratedTests || 0),
      aiRepairedTests: Number(p.aiMetrics?.aiRepairedTests || 0),
      uncoveredGaps: Number(p.aiMetrics?.uncoveredGaps || 0),
      isPinned: Boolean(p.isPinned),
      repoUrl: p.repoUrl || null,
      frameworks: Array.isArray(p.frameworks) ? p.frameworks : [],
      lastExecutedAt: p.provenance?.lastExecutedAt || null,
    };
  });

  const priorityFindings = synthesizeDeterministicPortfolioFindings({
    overview: resolvedOverview,
    scopeProjects: selectedProjects,
    scope: canonicalScope,
    now,
  });

  const displayLabel =
    exporterUser?.name && exporterUser?.email
      ? `${exporterUser.name} (${exporterUser.email})`
      : exporterUser?.name || exporterUser?.email || `User ${userId}`;

  const isolatedProjectsCount =
    Number(lc.PAUSED || 0) + Number(lc.COMPLETED || 0) + Number(lc.CANCELLED || 0);

  const normalizedSections = {
    executiveKpis: sections?.executiveKpis !== false,
    lifecycleAndRisk: sections?.lifecycleAndRisk !== false,
    projectMatrix: sections?.projectMatrix !== false,
    priorityFindings: sections?.priorityFindings !== false,
  };

  return {
    metadata: {
      reportId: buildReportCode(now),
      title: "CovAI Multi-Project Portfolio Quality & Coverage Report",
      generatedAt: new Date(now).toISOString(),
      generatedAtFormatted: formatUtc7Timestamp(now),
      generatedBy: {
        id: exporterUser?.id || userId,
        name: exporterUser?.name || null,
        email: exporterUser?.email || null,
        displayLabel,
      },
      scope: canonicalScope,
      scopeLabel: scopeMeta.label,
      scopeDescription: scopeMeta.description,
      kpiScopeNote:
        canonicalScope === "active_kpi"
          ? "Executive KPIs and Quality Matrix reflect Active KPI Scope (Doing projects only)."
          : "Executive KPIs strictly measure Active KPI Scope (Doing projects only). Isolated and Not Started projects are labeled in the Project Matrix.",
      filterSummary: typeof filterSummary === "string" && filterSummary.trim() ? filterSummary.trim() : null,
      totalAccessibleProjects: allProjects.length,
      exportedProjectsCount: normalizedProjects.length,
      doingProjectsCount: Number(lc.DOING || 0),
      notStartedProjectsCount: Number(lc.NOT_STARTED || 0),
      isolatedProjectsCount,
      methodology: {
        coverageWeights:
          "50% Unit / 30% API / 20% E2E (re-normalized across measured layers only)",
        coverageTargetPct: PORTFOLIO_QUALITY_GATE.coverageTargetPct,
        passRateFormula: "Passed / (Passed + Failed)",
        roiBaselineLabel: PORTFOLIO_ROI_BASELINE.label,
        roiMethodologyNote: PORTFOLIO_ROI_BASELINE.methodologyNote,
      },
      sections: normalizedSections,
    },
    executiveKpis: resolvedOverview?.activeKpis || null,
    timeRoi: resolvedOverview?.timeRoiAnalytics || resolvedOverview?.activeKpis?.timeRoi || null,
    lifecycleDistribution: {
      total: Number(lc.total ?? allProjects.length),
      DOING: Number(lc.DOING || 0),
      NOT_STARTED: Number(lc.NOT_STARTED || 0),
      PAUSED: Number(lc.PAUSED || 0),
      COMPLETED: Number(lc.COMPLETED || 0),
      CANCELLED: Number(lc.CANCELLED || 0),
      includedInKpiCount: Number(lc.DOING || 0),
      isolatedFromKpiCount: isolatedProjectsCount + Number(lc.NOT_STARTED || 0),
    },
    riskDistribution: {
      coverageCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.coverageCutoff,
      passRateCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.passRateCutoff,
      counts: riskCounts,
      nodes: quadrantNodes,
    },
    projects: normalizedProjects,
    priorityFindings,
  };
}

/**
 * Neutralize CSV Formula Injection payloads (=, +, -, @, \t, \r) on string cells
 * and apply RFC 4180 CSV escaping.
 */
export function sanitizeCsvCell(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  let str = String(value).replace(/\r\n/g, "\n").normalize("NFC");
  if (CSV_FORMULA_TRIGGER_RE.test(str)) {
    str = `'${str}`;
  }

  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize canonical DTO as Excel-ready UTF-8 BOM CSV with Formula Injection protection.
 */
export function formatPortfolioReportCsv(dto) {
  const headers = [
    "Project Name",
    "Branch",
    "Lifecycle State",
    "KPI Scope",
    "Health Score",
    "Grade",
    "Gate Status",
    "Unified Coverage %",
    "Unit Coverage %",
    "API Coverage %",
    "E2E Coverage %",
    "Executed Tests",
    "Passed Tests",
    "Failed Tests",
    "Pass Rate %",
    "Auto Duration (s)",
    "Est. Manual (h)",
    "Est. QA Hours Saved",
    "Speedup",
    "AI Generated",
    "AI Healed",
    "Coverage Gaps",
    "Pinned",
    "Repository URL",
    "Last Run",
  ];

  const rows = (dto?.projects || []).map((p) => [
    p.name,
    p.branch || "local",
    p.lifecycleStatus,
    p.kpiScope,
    p.healthScore !== null && p.healthScore !== undefined ? p.healthScore : "N/A",
    p.grade || "—",
    p.gateStatus,
    p.unifiedCoveragePct !== null && p.unifiedCoveragePct !== undefined
      ? p.unifiedCoveragePct
      : "N/A",
    p.unitCoveragePct !== null && p.unitCoveragePct !== undefined ? p.unitCoveragePct : "N/A",
    p.apiCoveragePct !== null && p.apiCoveragePct !== undefined ? p.apiCoveragePct : "N/A",
    p.e2eCoveragePct !== null && p.e2eCoveragePct !== undefined ? p.e2eCoveragePct : "N/A",
    p.executedTests,
    p.passedTests,
    p.failedTests,
    p.passRatePct !== null && p.passRatePct !== undefined ? p.passRatePct : "N/A",
    Number((Number(p.autoDurationMs || 0) / 1000).toFixed(1)),
    p.estimatedManualHours,
    p.estimatedHoursSaved,
    p.speedupStr || "—",
    p.aiGeneratedTests,
    p.aiRepairedTests,
    p.uncoveredGaps,
    p.isPinned ? "Yes" : "No",
    p.repoUrl || "Local Workspace",
    p.lastExecutedAt || "Never",
  ]);

  const lines = [
    headers.map(sanitizeCsvCell).join(","),
    ...rows.map((row) => row.map(sanitizeCsvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

/**
 * Serialize canonical DTO as formatted JSON.
 */
export function formatPortfolioReportJson(dto) {
  return JSON.stringify(
    {
      metadata: dto.metadata,
      executiveKpis: dto.executiveKpis,
      timeRoi: dto.timeRoi,
      lifecycleDistribution: dto.lifecycleDistribution,
      riskDistribution: dto.riskDistribution,
      projects: dto.projects,
      priorityFindings: dto.priorityFindings,
    },
    null,
    2,
  );
}
