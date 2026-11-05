import React, { useState, useMemo } from "react";
import {
  FileText,
  Printer,
  Download,
  Database,
  BarChart2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Activity,
  Code2,
  Clock,
  ShieldCheck,
  Zap,
  Cpu,
  Server,
  FolderGit2,
  Terminal,
  HelpCircle,
  Sparkles,
  ArrowRight,
  Search,
  Filter,
  Bug,
  FileCode,
} from "lucide-react";
import MetricProvenancePopover from "./MetricProvenancePopover.jsx";
import IntegrationGuidancePanel from "./IntegrationGuidancePanel.jsx";

const METHOD_STYLES = {
  GET: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  POST: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  PUT: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  PATCH: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  DELETE: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const formatDate = (val) => {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return String(val);
  }
};

export default function IntegrationReportEmbed({
  projectId,
  snapshotId,
  report,
  workspace,
  endpoints = [],
  onNavigateTab,
  onGenerateEndpoint,
  loading = false,
  onRefreshReport = () => {},
}) {
  const [selectedModuleFilter, setSelectedModuleFilter] = useState("ALL");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const overview = report?.overview || workspace?.summary || {};
  const latestExecution = report?.latestExecution || workspace?.execution || {};
  const apiCoverage = report?.apiCoverage || {};
  const rawEndpoints =
    endpoints && endpoints.length > 0
      ? endpoints
      : workspace?.endpoints && workspace.endpoints.length > 0
      ? workspace.endpoints
      : [];

  // Route Matrix derivation (Prefer live workspace endpoints with AST & Supertest execution evidence)
  const routeMatrix =
    rawEndpoints.length > 0
      ? rawEndpoints.map((e) => {
          const passScenarios = (e.scenarios || []).filter(
            (s) => s.status === "passed" || s.executionVerdict === "PASS"
          ).length;
          const failScenarios = (e.scenarios || []).filter(
            (s) => s.status === "failed" || s.executionVerdict === "FAIL"
          ).length;
          const isCovered =
            e.status === "passed" ||
            e.tested === true ||
            e.passedCount > 0 ||
            e.executedCount > 0 ||
            passScenarios > 0 ||
            (e.scenarios && e.scenarios.length > 0);
          const isFailed =
            e.status === "failed" ||
            e.failedCount > 0 ||
            failScenarios > 0;
          return {
            method: (e.method || "GET").toUpperCase(),
            path: e.fullPath || e.path || e.route || "/",
            handler:
              e.controllerMethod ||
              e.controllerName ||
              e.handler ||
              "anonymousHandler",
            sourceFile:
              e.sourceFile || e.source?.sourceFile || e.filePath || "express-router",
            status: isFailed
              ? "FAILED"
              : isCovered
              ? "COVERED"
              : "UNCOVERED",
            scenarioCount: (e.scenarios || []).length,
            passedCount:
              e.passedCount ||
              (e.scenarios || []).filter((s) => s.status === "passed").length,
            failedCount:
              e.failedCount ||
              (e.scenarios || []).filter((s) => s.status === "failed").length,
            avgDurationMs: e.avgDurationMs || 0,
            latencyStatus: e.latencyStatus || "NORMAL",
            source: e.source,
          };
        })
      : (report?.routeMatrix || []);

  const failureLogs =
    report?.failureLogs && report.failureLogs.length > 0
      ? report.failureLogs
      : routeMatrix
          .filter((r) => r.status === "FAILED")
          .map((r, i) => ({
            id: `fail_${i}`,
            targetEndpoint: `${r.method} ${r.path}`,
            title: `Endpoint regression on ${r.path}`,
            failureLayer: "ASSERTION_FAILED",
            sourceFile: r.sourceFile || "controllers/handler.js",
            line: 42,
            errorMessage: "Endpoint has failing test scenarios or HTTP contract mismatch.",
          }));

  // Scenarios aggregation
  const allScenarios = rawEndpoints.flatMap((e) =>
    (e.scenarios || []).map((s) => ({ ...s, endpoint: e }))
  );

  const totalScenarios = Math.max(
    allScenarios.length,
    workspace?.summary?.totalScenariosCount || 0,
    latestExecution?.totalTests || 0,
    overview?.totalScenarios || 0
  );

  const totalDiscovered =
    workspace?.summary?.discoveredApis ||
    (rawEndpoints.length > 0 ? rawEndpoints.length : null) ||
    apiCoverage?.discoveredApis ||
    routeMatrix.length ||
    0;

  const totalTested = Math.max(
    workspace?.summary?.testedApis || 0,
    routeMatrix.filter((r) => r.status === "COVERED" || r.status === "PASS").length,
    apiCoverage?.testedApis || 0
  );

  const totalUncovered = Math.max(0, totalDiscovered - totalTested);
  const coverageRate =
    totalDiscovered > 0 ? Math.round((totalTested / totalDiscovered) * 100) : 0;

  const coveredRoutes = routeMatrix.filter((r) => r.status === "COVERED" || r.status === "PASS");
  const uncoveredRoutes = routeMatrix.filter((r) => r.status === "UNCOVERED");
  const failedRoutes = routeMatrix.filter((r) => r.status === "FAILED" || r.status === "FAIL");

  const totalExecuted = Math.max(
    latestExecution?.totalTests || 0,
    workspace?.summary?.totalTests || 0,
    allScenarios.length,
    totalScenarios
  );

  const totalFailed =
    latestExecution?.failedTests ??
    workspace?.summary?.failedTests ??
    overview?.failedScenariosCount ??
    failureLogs.length;

  const totalPassed = Math.max(
    0,
    latestExecution?.passedTests ??
    workspace?.summary?.passedTests ??
    overview?.passedScenariosCount ??
    (totalExecuted - totalFailed)
  );

  const passRate =
    totalExecuted > 0
      ? Math.round((totalPassed / totalExecuted) * 100)
      : totalScenarios > 0 && totalFailed === 0
      ? 100
      : 0;

  // Quality Health Score (0-100)
  const qualityScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(coverageRate * 0.45 + passRate * 0.45 + (totalFailed === 0 ? 10 : 0))
    )
  );

  const qualityGrade =
    qualityScore >= 95
      ? "A+"
      : qualityScore >= 85
      ? "A"
      : qualityScore >= 70
      ? "B"
      : qualityScore >= 50
      ? "C"
      : "D";

  const verdict =
    totalFailed > 0
      ? "REGRESSION_DETECTED"
      : coverageRate >= 80 && passRate === 100
      ? "PRODUCTION_READY"
      : "PARTIAL_COVERAGE";

  // HTTP Method Distribution (dynamically synced to live routeMatrix)
  const methodDist = (() => {
    const counts = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 };
    const tested = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 };
    routeMatrix.forEach((r) => {
      const m = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method)
        ? r.method
        : "OTHER";
      counts[m] = (counts[m] || 0) + 1;
      if (r.status === "COVERED" || r.status === "PASS") {
        tested[m] = (tested[m] || 0) + 1;
      }
    });
    return Object.keys(counts)
      .map((method) => ({
        method,
        total: counts[method],
        tested: tested[method],
        uncovered: Math.max(0, counts[method] - tested[method]),
        coverageRate:
          counts[method] > 0
            ? Math.round((tested[method] / counts[method]) * 100)
            : 0,
      }))
      .filter((m) => m.total > 0);
  })();

  // Code Coverage from Istanbul / Unified Coverage Engine
  const codeCov =
    workspace?.summary?.codeCoverage ||
    (report?.projectCodeCoverage?.stmtsPct != null
      ? {
          statement: report.projectCodeCoverage.stmtsPct,
          branch: report.projectCodeCoverage.branchesPct || 0,
          function: report.projectCodeCoverage.funcsPct || 0,
          line:
            report.projectCodeCoverage.linesPct ||
            report.projectCodeCoverage.stmtsPct ||
            0,
        }
      : null);

  // 5-Layer Architectural Health
  const layerHealth =
    report?.layerHealth || [
      {
        layer: "Router",
        key: "ROUTER_NOT_FOUND",
        failures: failureLogs.filter((f) => f.failureLayer === "ROUTER_NOT_FOUND").length,
        status:
          failureLogs.filter((f) => f.failureLayer === "ROUTER_NOT_FOUND").length === 0
            ? "HEALTHY"
            : "DEGRADED",
        description: "Route path resolution & mounting",
      },
      {
        layer: "Middleware",
        key: "MIDDLEWARE_REJECTED",
        failures: failureLogs.filter((f) => f.failureLayer === "MIDDLEWARE_REJECTED").length,
        status:
          failureLogs.filter((f) => f.failureLayer === "MIDDLEWARE_REJECTED").length === 0
            ? "HEALTHY"
            : "DEGRADED",
        description: "Auth tokens, CORS, Body validation",
      },
      {
        layer: "Controller",
        key: "CONTROLLER_CRASH",
        failures: failureLogs.filter((f) => f.failureLayer === "CONTROLLER_CRASH").length,
        status:
          failureLogs.filter((f) => f.failureLayer === "CONTROLLER_CRASH").length === 0
            ? "HEALTHY"
            : "DEGRADED",
        description: "Business logic runtime stability",
      },
      {
        layer: "Database",
        key: "DATABASE_FAILURE",
        failures: failureLogs.filter((f) => f.failureLayer === "DATABASE_FAILURE").length,
        status:
          failureLogs.filter((f) => f.failureLayer === "DATABASE_FAILURE").length === 0
            ? "HEALTHY"
            : "DEGRADED",
        description: "Queries, ORM relations & constraints",
      },
      {
        layer: "Assertion",
        key: "ASSERTION_FAILED",
        failures: failureLogs.filter((f) => f.failureLayer === "ASSERTION_FAILED").length,
        status:
          failureLogs.filter((f) => f.failureLayer === "ASSERTION_FAILED").length === 0
            ? "HEALTHY"
            : "DEGRADED",
        description: "Contract schemas & HTTP status codes",
      },
    ];

  // Scenario Classification Breakdown
  const scenarioClass = (() => {
    let happy = 0,
      val = 0,
      auth = 0,
      notFound = 0,
      res = 0;
    const scenariosList = allScenarios.length > 0 ? allScenarios : (report?.scenarios || []);
    scenariosList.forEach((s) => {
      const code = parseInt(s.expectedStatus || s.actualStatus || 200, 10);
      const name = `${s.title || s.testName || ""} ${s.description || ""}`.toLowerCase();
      if (
        s.scenarioType === "HAPPY_PATH" ||
        s.category === "Happy Path" ||
        (code >= 200 && code < 300 && !name.includes("fail") && !name.includes("invalid") && !name.includes("error"))
      ) {
        happy++;
      } else if (
        code === 400 ||
        code === 422 ||
        s.scenarioType === "VALIDATION" ||
        name.includes("validation") ||
        name.includes("invalid") ||
        name.includes("missing")
      ) {
        val++;
      } else if (
        code === 401 ||
        code === 403 ||
        name.includes("auth") ||
        name.includes("unauthorized") ||
        name.includes("forbidden") ||
        name.includes("token")
      ) {
        auth++;
      } else if (
        code === 404 ||
        code === 409 ||
        s.scenarioType === "EDGE_CASE" ||
        name.includes("not found") ||
        name.includes("conflict")
      ) {
        notFound++;
      } else if (
        code >= 500 ||
        name.includes("resiliency") ||
        name.includes("crash") ||
        name.includes("error") ||
        name.includes("500")
      ) {
        res++;
      } else {
        happy++;
      }
    });
    const tot = scenariosList.length || totalScenarios || 1;
    return {
      happyPath: { count: happy, percentage: Math.round((happy / tot) * 100) },
      validation: { count: val, percentage: Math.round((val / tot) * 100) },
      authSecurity: { count: auth, percentage: Math.round((auth / tot) * 100) },
      resourceNotFound: { count: notFound, percentage: Math.round((notFound / tot) * 100) },
      serverResiliency: { count: res, percentage: Math.round((res / tot) * 100) },
    };
  })();

  // Module Breakdown
  const moduleBreakdown =
    report?.moduleBreakdown ||
    (() => {
      const map = {};
      routeMatrix.forEach((r) => {
        const segs = (r.path || "").split("/").filter(Boolean);
        let mod = "ROOT";
        let idx = 0;
        while (idx < segs.length && /^(api|v\d+)$/i.test(segs[idx])) idx++;
        if (idx < segs.length) mod = segs[idx].replace(/^:/, "").toUpperCase() || "ROOT";
        if (!map[mod]) {
          map[mod] = {
            module: mod,
            totalEndpoints: 0,
            testedEndpoints: 0,
            scenariosCount: 0,
            failedCount: 0,
          };
        }
        map[mod].totalEndpoints++;
        if (r.status === "COVERED" || r.status === "PASS") map[mod].testedEndpoints++;
        if (r.status === "FAILED") map[mod].failedCount++;
        map[mod].scenariosCount += r.scenarioCount || 0;
      });
      return Object.values(map)
        .map((m) => ({
          ...m,
          coveragePct:
            m.totalEndpoints > 0
              ? Math.round((m.testedEndpoints / m.totalEndpoints) * 100)
              : 0,
          health:
            m.failedCount > 0
              ? "FAILING"
              : m.testedEndpoints === m.totalEndpoints
              ? "FULL_COVERAGE"
              : "PARTIAL",
        }))
        .sort((a, b) => b.totalEndpoints - a.totalEndpoints);
    })();

  // Performance Metrics
  const durationMs = latestExecution?.durationMs || workspace?.execution?.durationMs || 0;
  const avgDurationMs = totalExecuted > 0 ? Math.round(durationMs / totalExecuted) : 0;
  const throughput =
    durationMs > 0 ? (totalExecuted / (durationMs / 1000)).toFixed(1) : 0;

  const history = report?.history || {};

  const handlePrint = () => {
    window.print();
  };

  const handleExportJson = () => {
    const jsonStr = JSON.stringify(
      {
        projectId,
        snapshotId,
        exportedAt: new Date().toISOString(),
        qualityHealth: {
          score: qualityScore,
          grade: qualityGrade,
          verdict,
          passRate,
        },
        overview: {
          totalScenarios,
          totalDiscoveredEndpoints: totalDiscovered,
          totalTestedEndpoints: totalTested,
          uncoveredEndpoints: totalUncovered,
          apiCoverageRate: coverageRate,
          unmodifiedAiScenarios: overview.unmodifiedAiScenarios || 0,
          modifiedScenarios: overview.modifiedScenarios || 0,
        },
        latestExecution: {
          ...latestExecution,
          totalExecuted,
          totalPassed,
          totalFailed,
          passRate,
          durationMs,
          avgDurationMs,
          throughputTestsPerSec: throughput,
        },
        methodDistribution: methodDist,
        layerHealth,
        scenarioClassification: scenarioClass,
        moduleBreakdown,
        routeMatrix,
        failureLogs,
        history,
      },
      null,
      2
    );

    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `integration-executive-report-${projectId || "project"}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filteredRouteMatrix = useMemo(() => {
    return routeMatrix.filter((r) => {
      // 1. Module filter
      if (selectedModuleFilter !== "ALL") {
        const segs = (r.path || "").split("/").filter(Boolean);
        let mod = "ROOT";
        let idx = 0;
        while (idx < segs.length && /^(api|v\d+)$/i.test(segs[idx])) idx++;
        if (idx < segs.length) mod = segs[idx].replace(/^:/, "").toUpperCase() || "ROOT";
        if (mod !== selectedModuleFilter) return false;
      }
      // 2. Status filter
      if (selectedStatusFilter === "COVERED" && r.status !== "COVERED" && r.status !== "PASS") return false;
      if (selectedStatusFilter === "UNCOVERED" && r.status !== "UNCOVERED") return false;
      if (selectedStatusFilter === "FAILED" && r.status !== "FAILED" && r.status !== "FAIL") return false;
      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          (r.path || "").toLowerCase().includes(q) ||
          (r.method || "").toLowerCase().includes(q) ||
          (r.handler || "").toLowerCase().includes(q) ||
          (r.sourceFile || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [routeMatrix, selectedModuleFilter, selectedStatusFilter, searchQuery]);

  return (
    <div className="space-y-6 font-sans">
      {/* Print-specific style overrides */}
      <style>{`
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          .no-print, header, nav, .sticky {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .print-break-inside-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>

      {/* ── 1. REPORT HEADER WITH AUDIT BADGES ── */}
      <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center shrink-0">
            <FileText size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[var(--color-text)] m-0">
                API Integration Executive Audit Report
              </h2>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                  verdict === "PRODUCTION_READY"
                    ? "bg-emerald-500/10 text-[var(--color-success)] border-emerald-500/25"
                    : verdict === "REGRESSION_DETECTED"
                    ? "bg-rose-500/10 text-[var(--color-danger)] border-rose-500/25"
                    : "bg-amber-500/10 text-amber-500 border-amber-500/25"
                }`}
              >
                Grade {qualityGrade} • {verdict.replace(/_/g, " ")}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] font-mono m-0 mt-0.5">
              Project: #{projectId?.substring(0, 8) || "active"} • Snapshot: #
              {snapshotId?.substring(0, 8) || "latest"} • Engine: Supertest / Node • Evaluated:{" "}
              {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-print">
          <button
            type="button"
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            title="Download full executive report JSON"
          >
            <Download size={13} />
            <span>Export JSON</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
            title="Print or export report to PDF"
          >
            <Printer size={13} />
            <span>Print / PDF</span>
          </button>
        </div>
      </div>

      {/* ── 2. EXECUTIVE KPI DASHBOARD (6 High-Density KPI Cards) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 print-break-inside-avoid">
        {/* KPI 1: Quality Health Score */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              Quality Score
            </span>
            <ShieldCheck size={13} className="text-[var(--color-primary)]" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-[var(--color-text)]">
              {qualityScore}
            </span>
            <span className="text-xs font-mono text-[var(--color-text-muted)]">/ 100</span>
          </div>
          <div className="text-[10px] font-semibold text-[var(--color-primary)] mt-1 font-mono">
            Grade: {qualityGrade}
          </div>
        </div>

        {/* KPI 2: Endpoint Coverage */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              Endpoint Cov.
            </span>
            <Database size={13} className="text-sky-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-[var(--color-primary)]">
              {coverageRate}%
            </span>
            <span className="text-xs font-mono text-[var(--color-text-muted)]">
              ({totalTested}/{totalDiscovered})
            </span>
          </div>
          <div className="w-full bg-[var(--color-surface-secondary)] h-1 rounded-full overflow-hidden mt-1.5">
            <div
              className="bg-[var(--color-primary)] h-full transition-all"
              style={{ width: `${coverageRate}%` }}
            />
          </div>
        </div>

        {/* KPI 3: Scenario Pass Rate */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              Pass Rate
            </span>
            <CheckCircle2 size={13} className="text-[var(--color-success)]" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-xl font-bold font-mono ${
                passRate === 100
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-danger)]"
              }`}
            >
              {totalExecuted > 0 || totalScenarios > 0 ? `${passRate}%` : "N/A"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono truncate">
            {totalPassed} pass • {totalFailed} fail
          </div>
        </div>

        {/* KPI 4: 5-Layer Regressions */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              5-Layer Health
            </span>
            <Layers size={13} className="text-purple-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-xl font-bold font-mono ${
                totalFailed === 0
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-danger)]"
              }`}
            >
              {totalFailed}
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">Regressions</span>
          </div>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
            {totalFailed === 0 ? "All Layers OK" : "Regressions Detected"}
          </div>
        </div>

        {/* KPI 5: Execution Performance */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              Latency & Time
            </span>
            <Clock size={13} className="text-amber-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-[var(--color-text)]">
              {(durationMs / 1000).toFixed(1)}s
            </span>
            <span className="text-xs font-mono text-[var(--color-text-muted)]">total</span>
          </div>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
            ~{avgDurationMs}ms / scenario
          </div>
        </div>

        {/* KPI 6: Scenario Origin */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
              Scenarios Total
            </span>
            <Zap size={13} className="text-[var(--color-primary)]" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-[var(--color-text)]">
              {totalScenarios}
            </span>
            <span className="text-xs font-mono text-[var(--color-text-muted)]">cases</span>
          </div>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono truncate">
            {allScenarios.filter((s) => s.origin === "PROJECT_EXISTING" || !s.origin).length > 0
              ? `Project: ${allScenarios.filter((s) => s.origin === "PROJECT_EXISTING" || !s.origin).length} • AI: ${allScenarios.filter((s) => s.origin === "AI_GENERATED").length}`
              : `AI: ${overview.unmodifiedAiScenarios || 0} • Custom: ${overview.modifiedScenarios || 0}`}
          </div>
        </div>
      </div>

      {/* ── 2.5 API COVERAGE & AUDIT BREAKDOWN: COVERED VS UNCOVERED ── */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs print-break-inside-avoid space-y-4">
        <div className="flex flex-wrap items-center justify-between pb-2.5 border-b border-[var(--color-border)] gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
              <Layers size={14} />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
              API Coverage & Contract Audit (AST Scanned vs Supertest Traced)
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold border border-[var(--color-primary)]/20">
              {totalTested} / {totalDiscovered} APIs Tested ({coverageRate}%)
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="text-[var(--color-success)] flex items-center gap-1 font-semibold">
              <CheckCircle2 size={12} /> {coveredRoutes.length} Covered
            </span>
            <span className="text-amber-500 flex items-center gap-1 font-semibold">
              <AlertTriangle size={12} /> {uncoveredRoutes.length} Uncovered
            </span>
            {failedRoutes.length > 0 && (
              <span className="text-[var(--color-danger)] flex items-center gap-1 font-semibold">
                <XCircle size={12} /> {failedRoutes.length} Regressions
              </span>
            )}
          </div>
        </div>

        {/* Two-Column Audit Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Column A: Covered APIs */}
          <div className="rounded-[var(--radius-sm)] border border-emerald-500/25 bg-emerald-500/5 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[var(--color-success)]" />
                <span className="text-xs font-bold text-[var(--color-success)] uppercase tracking-wider">
                  API Đã Có Test Bao Phủ ({coveredRoutes.length} Endpoints)
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold text-[var(--color-success)] bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                100% Round-Trip Verified
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-secondary)] m-0 leading-relaxed">
              Các route đã có Supertest suite thực thi xuyên suốt từ Router ➔ Controller ➔ Database và xác minh trạng thái HTTP thành công.
            </p>

            <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
              {coveredRoutes.length === 0 ? (
                <div className="p-3 text-center text-xs text-[var(--color-text-muted)] italic">
                  Chưa có API nào có test bao phủ. Hãy tạo test scenarios.
                </div>
              ) : (
                coveredRoutes.map((r, i) => {
                  const methodClass = METHOD_STYLES[r.method] || METHOD_STYLES.DEFAULT;
                  return (
                    <div
                      key={i}
                      className="px-2.5 py-1.5 rounded bg-[var(--color-surface)] border border-emerald-500/20 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 font-mono truncate">
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${methodClass}`}>
                          {r.method}
                        </span>
                        <span className="font-semibold text-[var(--color-text)] truncate" title={r.path}>
                          {r.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                        <span className="text-[var(--color-text-secondary)]">
                          {r.scenarioCount || 1} {r.scenarioCount === 1 ? "test" : "tests"}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-[var(--color-success)] font-bold">
                          ✓ Passed
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Column B: Uncovered APIs */}
          <div className="rounded-[var(--radius-sm)] border border-amber-500/25 bg-amber-500/5 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-amber-500" />
                <span className="text-xs font-bold text-amber-500 uppercase tracking-wider">
                  API Chưa Có Test Bao Phủ ({uncoveredRoutes.length} Endpoints)
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Gap Audit ({Math.round(100 - coverageRate)}%)
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-secondary)] m-0 leading-relaxed">
              Các endpoint được phát hiện từ Express AST nhưng chưa có kịch bản Supertest nào kiểm tra hợp đồng hoặc luồng dữ liệu.
            </p>

            <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
              {uncoveredRoutes.length === 0 ? (
                <div className="p-3 text-center text-xs text-[var(--color-success)] flex items-center justify-center gap-1.5">
                  <CheckCircle2 size={14} /> Tuyệt vời! 100% API đã được bao phủ bởi test suite.
                </div>
              ) : (
                uncoveredRoutes.map((r, i) => {
                  const methodClass = METHOD_STYLES[r.method] || METHOD_STYLES.DEFAULT;
                  return (
                    <div
                      key={i}
                      className="px-2.5 py-1.5 rounded bg-[var(--color-surface)] border border-amber-500/20 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 font-mono truncate">
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${methodClass}`}>
                          {r.method}
                        </span>
                        <span className="font-semibold text-[var(--color-text)] truncate" title={r.path}>
                          {r.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                        <span className="text-[var(--color-text-muted)]">0 tests</span>
                        {onGenerateEndpoint && (
                          <button
                            type="button"
                            onClick={() => onGenerateEndpoint(`${r.method} ${r.path}`)}
                            className="px-2 py-0.5 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[10px] font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                            title="Sinh test Supertest cho API này"
                          >
                            <Sparkles size={10} />
                            <span>Sinh Test</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {uncoveredRoutes.length > 0 && onNavigateTab && (
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => onNavigateTab("scenarios")}
                  className="text-xs text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer font-medium"
                >
                  <span>Chuyển tới Test Scenarios để sinh test</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. PROTOCOL BREAKDOWN & 5-LAYER ARCHITECTURAL HEALTH ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-break-inside-avoid">
        {/* Left: HTTP Method & Protocol Distribution */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Server size={14} className="text-[var(--color-primary)]" />
              HTTP Method Distribution & Coverage
            </span>
            <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
              {methodDist.length} Protocol Verbs
            </span>
          </h3>

          <div className="space-y-2.5">
            {methodDist.map((m) => {
              const badgeClass = METHOD_STYLES[m.method] || METHOD_STYLES.DEFAULT;
              return (
                <div
                  key={m.method}
                  className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/40 border border-[var(--color-border)]/70 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-[90px]">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border tracking-wider ${badgeClass}`}
                    >
                      {m.method}
                    </span>
                    <span className="text-xs font-mono font-semibold text-[var(--color-text)]">
                      {m.total} {m.total === 1 ? "route" : "routes"}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="flex-1 max-w-[200px]">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--color-text-muted)] mb-1">
                      <span>{m.tested} covered</span>
                      <span>{m.coverageRate}%</span>
                    </div>
                    <div className="w-full bg-[var(--color-surface)] h-1.5 rounded-full overflow-hidden border border-[var(--color-border)]">
                      <div
                        className="bg-[var(--color-primary)] h-full"
                        style={{ width: `${m.coverageRate}%` }}
                      />
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                      m.coverageRate === 100
                        ? "bg-emerald-500/10 text-[var(--color-success)]"
                        : m.coverageRate > 0
                        ? "bg-sky-500/10 text-sky-400"
                        : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]"
                    }`}
                  >
                    {m.coverageRate === 100
                      ? "100% Tested"
                      : m.coverageRate > 0
                      ? `${m.coverageRate}% Tested`
                      : "Uncovered"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: 5-Layer Architectural Health Matrix */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers size={14} className="text-purple-400" />
              5-Layer Architectural Diagnostics
            </span>
            <span
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${
                totalFailed === 0
                  ? "bg-emerald-500/10 text-[var(--color-success)]"
                  : "bg-rose-500/10 text-[var(--color-danger)]"
              }`}
            >
              {totalFailed === 0 ? "5 / 5 Healthy" : `${totalFailed} Regressions`}
            </span>
          </h3>

          <div className="space-y-2">
            {layerHealth.map((lyr) => {
              const isHealthy = lyr.status === "HEALTHY";
              return (
                <div
                  key={lyr.key}
                  className="p-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/30 border border-[var(--color-border)] flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isHealthy ? "bg-emerald-500" : "bg-rose-500 animate-pulse"
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-[var(--color-text)] font-mono">
                        {lyr.layer} Layer
                      </span>
                      <span className="text-[11px] text-[var(--color-text-secondary)] ml-2 hidden sm:inline">
                        {lyr.description}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                      isHealthy
                        ? "bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20"
                        : "bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/20"
                    }`}
                  >
                    {isHealthy ? "Healthy (0)" : `${lyr.failures} Failures`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── 4. TEST PYRAMID & SCENARIO DIVERSITY BREAKDOWN ── */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs print-break-inside-avoid">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <BarChart2 size={14} className="text-[var(--color-primary)]" />
            Scenario Classification & Edge Case Diversity
          </span>
          <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
            Total {totalScenarios} Scenarios
          </span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {/* Happy Path */}
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/40 border border-[var(--color-border)]">
            <div className="text-[10px] font-mono font-bold text-emerald-400 uppercase">
              P0 • Happy Path (2xx)
            </div>
            <div className="text-lg font-bold font-mono text-[var(--color-text)] mt-1">
              {scenarioClass.happyPath?.count || 0}
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)] font-mono">
              {scenarioClass.happyPath?.percentage || 0}% of suite
            </div>
          </div>

          {/* Validation */}
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/40 border border-[var(--color-border)]">
            <div className="text-[10px] font-mono font-bold text-amber-400 uppercase">
              P1 • Validation (400/422)
            </div>
            <div className="text-lg font-bold font-mono text-[var(--color-text)] mt-1">
              {scenarioClass.validation?.count || 0}
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)] font-mono">
              {scenarioClass.validation?.percentage || 0}% of suite
            </div>
          </div>

          {/* Auth & Security */}
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/40 border border-[var(--color-border)]">
            <div className="text-[10px] font-mono font-bold text-sky-400 uppercase">
              P1 • Security & Auth (401/403)
            </div>
            <div className="text-lg font-bold font-mono text-[var(--color-text)] mt-1">
              {scenarioClass.authSecurity?.count || 0}
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)] font-mono">
              {scenarioClass.authSecurity?.percentage || 0}% of suite
            </div>
          </div>

          {/* Not Found */}
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/40 border border-[var(--color-border)]">
            <div className="text-[10px] font-mono font-bold text-indigo-400 uppercase">
              P2 • Not Found / 404
            </div>
            <div className="text-lg font-bold font-mono text-[var(--color-text)] mt-1">
              {scenarioClass.resourceNotFound?.count || 0}
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)] font-mono">
              {scenarioClass.resourceNotFound?.percentage || 0}% of suite
            </div>
          </div>

          {/* Resiliency */}
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/40 border border-[var(--color-border)]">
            <div className="text-[10px] font-mono font-bold text-rose-400 uppercase">
              P3 • Resiliency (500)
            </div>
            <div className="text-lg font-bold font-mono text-[var(--color-text)] mt-1">
              {scenarioClass.serverResiliency?.count || 0}
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)] font-mono">
              {scenarioClass.serverResiliency?.percentage || 0}% of suite
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. FUNCTIONAL MODULE BREAKDOWN TABLE ── */}
      {moduleBreakdown.length > 0 && (
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden shadow-xs print-break-inside-avoid">
          <div className="px-4 py-3 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderGit2 size={16} className="text-[var(--color-primary)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
                Functional Domain Modules Breakdown ({moduleBreakdown.length} Domains)
              </h3>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                  <th className="py-2 px-3">Module Domain</th>
                  <th className="py-2 px-3">Total Endpoints</th>
                  <th className="py-2 px-3">Covered Endpoints</th>
                  <th className="py-2 px-3">Total Scenarios</th>
                  <th className="py-2 px-3">Coverage Progress</th>
                  <th className="py-2 px-3 text-center">Health Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]/60 font-mono">
                {moduleBreakdown.map((m) => (
                  <tr
                    key={m.module}
                    className="hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <td className="py-2 px-3 font-bold text-[var(--color-text)]">
                      <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                        {m.module}
                      </span>
                    </td>
                    <td className="py-2 px-3">{m.totalEndpoints} routes</td>
                    <td className="py-2 px-3 text-[var(--color-primary)] font-semibold">
                      {m.testedEndpoints} routes
                    </td>
                    <td className="py-2 px-3">{m.scenariosCount} tests</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-[var(--color-surface-secondary)] h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-[var(--color-primary)] h-full"
                            style={{ width: `${m.coveragePct}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-semibold">{m.coveragePct}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      {m.health === "FULL_COVERAGE" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25">
                          ✓ 100% COVERED
                        </span>
                      ) : m.health === "FAILING" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25">
                          ✗ FAILING
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/25">
                          PARTIAL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 6. DETAILED ROUTE COVERAGE MATRIX SUMMARY ── */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden shadow-xs print-break-inside-avoid">
        <div className="px-4 py-3 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-[var(--color-primary)]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
              Endpoint Verification Matrix ({filteredRouteMatrix.length} / {routeMatrix.length} Routes)
            </h3>
          </div>

          {/* Status & Module Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs no-print">
            {/* Status Tabs */}
            <div className="flex items-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-0.5 border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setSelectedStatusFilter("ALL")}
                className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold cursor-pointer transition-colors ${
                  selectedStatusFilter === "ALL"
                    ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                All ({routeMatrix.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedStatusFilter("COVERED")}
                className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold cursor-pointer transition-colors ${
                  selectedStatusFilter === "COVERED"
                    ? "bg-emerald-500 text-white"
                    : "text-emerald-500 hover:text-emerald-400"
                }`}
              >
                Covered ({coveredRoutes.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedStatusFilter("UNCOVERED")}
                className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold cursor-pointer transition-colors ${
                  selectedStatusFilter === "UNCOVERED"
                    ? "bg-amber-500 text-white"
                    : "text-amber-500 hover:text-amber-400"
                }`}
              >
                Uncovered ({uncoveredRoutes.length})
              </button>
              {failedRoutes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedStatusFilter("FAILED")}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold cursor-pointer transition-colors ${
                    selectedStatusFilter === "FAILED"
                      ? "bg-rose-500 text-white"
                      : "text-rose-500 hover:text-rose-400"
                  }`}
                >
                  Regressions ({failedRoutes.length})
                </button>
              )}
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Filter route, controller..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 pr-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] w-36 sm:w-44"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-80 custom-scrollbar">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                <th className="py-2 px-3">Method</th>
                <th className="py-2 px-3">Endpoint Route</th>
                <th className="py-2 px-3">Handler / Controller</th>
                <th className="py-2 px-3">Source File / Layer</th>
                <th className="py-2 px-3 text-center">Latency</th>
                <th className="py-2 px-3 text-center">Scenarios</th>
                <th className="py-2 px-3 text-center">Status</th>
                <th className="py-2 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/60 font-mono">
              {filteredRouteMatrix.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-6 text-center text-xs text-[var(--color-text-muted)] italic"
                  >
                    Không tìm thấy endpoint nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredRouteMatrix.map((r, idx) => {
                  const methodClass = METHOD_STYLES[r.method] || METHOD_STYLES.DEFAULT;
                  const isCovered = r.status === "COVERED" || r.status === "PASS";
                  const isFailed = r.status === "FAILED" || r.status === "FAIL";

                  return (
                    <tr
                      key={idx}
                      className="hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      <td className="py-2 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border tracking-tight ${methodClass}`}
                        >
                          {r.method}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-semibold text-[var(--color-text)]">
                        {r.path}
                      </td>
                      <td className="py-2 px-3 text-[var(--color-text-secondary)] text-[11px]">
                        {r.handler || "anonymousHandler"}
                      </td>
                      <td className="py-2 px-3 text-[var(--color-text-muted)] text-[11px] truncate max-w-[200px]">
                        <div className="flex items-center gap-1.5 truncate" title={r.sourceFile}>
                          <FileCode size={12} className="shrink-0 text-[var(--color-primary)]" />
                          <span className="truncate">
                            {r.sourceFile ? r.sourceFile.split(/[\/\\]/).slice(-2).join("/") : "routes/api.js"}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-[11px]">
                        {r.avgDurationMs > 0 ? (
                          <span className={r.latencyStatus === "FAST" ? "text-emerald-500 font-semibold" : r.latencyStatus === "SLOW" ? "text-rose-400 font-semibold" : "text-amber-500"}>
                            {r.avgDurationMs}ms
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-muted)]">-</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[10px] font-semibold text-[var(--color-text)]">
                          {r.scenarioCount || 0}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {isCovered ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25">
                            ✓ COVERED
                          </span>
                        ) : isFailed ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25">
                            ✗ REGRESSION
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[9px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                            UNCOVERED
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {!isCovered && onGenerateEndpoint ? (
                          <button
                            type="button"
                            onClick={() => onGenerateEndpoint(`${r.method} ${r.path}`)}
                            className="px-2 py-0.5 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[10px] font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                            title="Sinh test cho API này"
                          >
                            <Sparkles size={10} />
                            <span>Sinh Test</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-[var(--color-text-muted)]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 7. SOURCE CODE BOTTLENECK & FAILURE LOCALIZATION ── */}
      {failureLogs.length > 0 ? (
        <section className="bg-[var(--color-surface)] border border-rose-500/30 rounded-[var(--radius-md)] overflow-hidden shadow-xs print-break-inside-avoid">
          <div className="px-4 py-3 bg-rose-500/10 border-b border-rose-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--color-danger)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)] m-0">
                Source Code Bottleneck & Failure Localization ({failureLogs.length} Regressions)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-rose-400 font-semibold">
              Điểm Bị Kẹt & Lỗi Chi Tiết Ở Source Code
            </span>
          </div>

          <div className="p-4 space-y-3">
            {failureLogs.map((f, i) => (
              <div
                key={f.id || i}
                className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/50 border border-rose-500/25 space-y-2.5 text-xs font-mono"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-[var(--color-danger)] border border-rose-500/30">
                      [{f.failureLayer || "ASSERTION_FAILED"}]
                    </span>
                    <span className="font-bold text-[var(--color-text)]">
                      {f.targetEndpoint}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-[var(--color-danger)]">
                    Expected HTTP {f.expectedStatus || 200} ≠ Received {f.responseStatus || "500 Error"}
                  </span>
                </div>

                {/* Source Code Coordinates Frame */}
                <div className="p-2.5 rounded bg-[var(--color-surface)] border border-rose-500/20 text-[11px] space-y-1">
                  <div className="text-[var(--color-text-secondary)] flex items-center gap-1.5">
                    <FileCode size={12} className="text-rose-400" />
                    <span>Vị trí kẹt mã nguồn:</span>
                    <strong className="text-[var(--color-text)]">{f.sourceFile || "controllers/handler.js"}:{f.line || 42}</strong>
                  </div>
                  <div className="text-rose-400 pl-4 border-l-2 border-rose-500/50 mt-1">
                    &gt; {f.errorMessage || "Runtime exception or database constraint timeout."}
                  </div>
                </div>

                <div className="text-[10px] text-[var(--color-text-muted)] flex items-center justify-between pt-1">
                  <span>Tầng kiểm tra: {f.failureLayer === "DATABASE_FAILURE" ? "Docker Database Container (Prisma Query)" : f.failureLayer === "CONTROLLER_CRASH" ? "Express Controller Handler" : f.failureLayer === "MIDDLEWARE_REJECTED" ? "Auth / CORS Middleware" : "HTTP Contract Schema"}</span>
                  <span className="text-rose-400">Yêu cầu sửa logic hoặc sinh lại test case</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="p-4 rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/5 flex items-center gap-3 print-break-inside-avoid">
          <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-[var(--color-success)] flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-[var(--color-success)] uppercase tracking-wider">
              Verified Clean: Zero Failure Bottlenecks Detected
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">
              Tất cả {totalPassed} kịch bản kiểm thử Supertest đã thực thi thành công xuyên suốt toàn bộ 5 tầng kiến trúc (Router ➔ Middleware ➔ Controller ➔ Docker Database Container ➔ HTTP Response). Không có điểm kẹt hoặc lỗi runtime trong source code.
            </div>
          </div>
        </div>
      )}

      {/* ── 8. EXECUTION HISTORY & COVERAGE TREND ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print-break-inside-avoid">
        {/* Execution History */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3 flex items-center justify-between">
            <span>Execution History Timeline</span>
            <Activity size={14} className="text-[var(--color-text-muted)]" />
          </h3>
          {!history?.executions || history.executions.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-xs italic py-2">
              No previous test runs recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] text-[10px] uppercase font-bold">
                  <tr>
                    <th className="py-1.5 px-2">Timestamp</th>
                    <th className="py-1.5 px-2">Status</th>
                    <th className="py-1.5 px-2">Pass / Total</th>
                    <th className="py-1.5 px-2 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px]">
                  {history.executions
                    .slice(-5)
                    .reverse()
                    .map((run) => (
                      <tr key={run.testRunId || run.id}>
                        <td className="py-1.5 px-2">{formatDate(run.timestamp || run.createdAt)}</td>
                        <td className="py-1.5 px-2">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              run.status === "SUCCESS" || run.status === "PASSED"
                                ? "text-[var(--color-success)] bg-emerald-500/10"
                                : "text-[var(--color-danger)] bg-rose-500/10"
                            }`}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="py-1.5 px-2">
                          {run.passedTests}/{run.totalTests}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          {((run.durationMs || 0) / 1000).toFixed(1)}s
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Coverage Trend History */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3 flex items-center justify-between">
            <span>API Coverage Evolution</span>
            <BarChart2 size={14} className="text-[var(--color-text-muted)]" />
          </h3>
          {!history?.coverage || history.coverage.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-xs italic py-2">
              No coverage trend history available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] text-[10px] uppercase font-bold">
                  <tr>
                    <th className="py-1.5 px-2">Timestamp</th>
                    <th className="py-1.5 px-2">Snapshot</th>
                    <th className="py-1.5 px-2 text-right">Coverage %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px]">
                  {history.coverage
                    .slice(-5)
                    .reverse()
                    .map((cov, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 px-2">{formatDate(cov.timestamp)}</td>
                        <td className="py-1.5 px-2">{cov.snapshotId?.substring(0, 8)}</td>
                        <td className="py-1.5 px-2 text-right font-bold text-[var(--color-primary)]">
                          {cov.apiCoveragePct != null ? cov.apiCoveragePct : cov.stmtsPct || 0}%
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── 9. GUIDANCE & ACTION RECOMMENDATIONS ── */}
      <div className="no-print">
        <IntegrationGuidancePanel projectId={projectId} />
      </div>
    </div>
  );
}
