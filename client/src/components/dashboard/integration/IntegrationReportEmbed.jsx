import React, { useState, useMemo } from "react";
import { useChatTestContext } from "../../../hooks/useChatTestContext";
import {
  FileText,
  Download,
  CheckCircle2,
  XCircle,
  Activity,
  Search,
  Zap,
  ArrowRight,
  Loader2,
  Printer,
} from "lucide-react";
import IntegrationGuidancePanel from "./IntegrationGuidancePanel.jsx";
import {
  getEndpointCaseCoverage,
  summarizeIntegrationFailure,
} from "./integrationCaseCoverage.js";
import { downloadIntegrationReportApi } from "../../../services/report.service.js";

const METHOD_STYLES = {
  GET: "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
  POST: "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border-strong)]",
  PUT: "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)]",
  PATCH:
    "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
  DELETE:
    "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)]",
  DEFAULT:
    "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const formatDate = (val) => {
  if (!val) return "—";
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
  hasScanned,
  hasExecutedCoverage,
  onScanApis,
  onRunCoverage,
  onNavigateTab,
  onGenerateEndpoint,
  loading = false,
  onRefreshReport = () => {},
  onChatContextChange,
}) {
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [exportingFormat, setExportingFormat] = useState(null);
  const [exportError, setExportError] = useState("");

  const effectiveHasScanned =
    hasScanned !== undefined
      ? Boolean(hasScanned)
      : Boolean(
          report?.apiCoverage?.hasScannedEndpoints ||
          report?.overview?.hasScannedEndpoints ||
          workspace?.generation?.hasScannedEndpoints ||
          endpoints.length > 0,
        );

  const usePeakReport = Boolean(
    report?.isPeakCoverageReport &&
    Array.isArray(report?.routeMatrix) &&
    report.routeMatrix.length > 0,
  );

  const overview = report?.overview || workspace?.summary || {};
  const latestExecution = usePeakReport
    ? report?.latestExecution || {}
    : report?.latestExecution || workspace?.execution || {};
  const apiCoverage = report?.apiCoverage || {};
  const rawEndpoints = usePeakReport
    ? []
    : endpoints && endpoints.length > 0
      ? endpoints
      : workspace?.endpoints && workspace.endpoints.length > 0
        ? workspace.endpoints
        : [];

  const routeMatrix =
    rawEndpoints.length > 0
      ? rawEndpoints.map((e) => {
          const passScenarios = (e.scenarios || []).filter(
            (s) => s.status === "passed" || s.executionVerdict === "PASS",
          ).length;
          const failScenarios = (e.scenarios || []).filter(
            (s) => s.status === "failed" || s.executionVerdict === "FAIL",
          ).length;
          const isFailed =
            e.status === "failed" || e.failedCount > 0 || failScenarios > 0;
          const caseCoverage = getEndpointCaseCoverage(e, e.scenarios || []);
          const isCovered =
            !isFailed &&
            (e.status === "Covered" ||
              e.status === "passed" ||
              e.passedCount > 0 ||
              passScenarios > 0);
          return {
            method: (e.method || "GET").toUpperCase(),
            path: e.fullPath || e.path || e.route || "/",
            handler:
              e.controllerMethod ||
              e.controllerName ||
              e.handler ||
              "anonymousHandler",
            sourceFile:
              e.sourceFile ||
              e.source?.sourceFile ||
              e.filePath ||
              "express-router",
            status: isFailed
              ? "FAILED"
              : isCovered && caseCoverage.isFullyVerified
                ? "COVERED"
                : isCovered
                  ? "PARTIAL"
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
            caseCoverage,
            rawEndpoint: e,
          };
        })
      : (report?.routeMatrix || []).map((r) => ({
          ...r,
          caseCoverage:
            r.caseCoverage || getEndpointCaseCoverage(r, r.scenarios || []),
        }));

  const allScenarios = usePeakReport
    ? routeMatrix.flatMap((r) =>
        (r.scenarios || []).map((s) => ({ ...s, endpoint: r })),
      )
    : rawEndpoints.flatMap((e) =>
        (e.scenarios || []).map((s) => ({ ...s, endpoint: e })),
      );

  const failedScenarioLogs = allScenarios
    .filter((s) => s.status === "failed" || s.executionVerdict === "FAIL")
    .map((s, i) => {
      const diag = s.failureDiagnostics || null;
      const lastLine = diag?.lastExecutedLine || null;
      const epLabel = s.targetEndpoint || (s.endpoint ? `${s.endpoint.method} ${s.endpoint.path}` : "API Endpoint");
      return {
        id: s.id || s.scenarioId || `sc_fail_${i}`,
        targetEndpoint: epLabel,
        title: s.name || s.title || epLabel,
        failureLayer: diag?.failureLayer || s.failureLayer || "ASSERTION_FAILED",
        failingComponent: diag?.failingComponent || s.endpoint?.controllerFile || s.endpoint?.sourceFile || null,
        sourceFile: lastLine?.filePath || s.endpoint?.controllerFile || s.endpoint?.sourceFile || null,
        line: lastLine?.line || s.endpoint?.controllerLineStart || null,
        codeSnippet: lastLine?.codeSnippet || null,
        suggestedFix: diag?.suggestedFix || null,
        serverErrorMessage:
          s.serverErrorMessage ||
          diag?.diagnosticsDetails?.serverErrorMessage ||
          null,
        responseBodyPreview:
          s.responseBodyPreview ||
          diag?.diagnosticsDetails?.responseBodyPreview ||
          null,
        expectedStatus: s.expectedStatus ?? null,
        responseStatus: s.actualStatus ?? s.actualStatusFromRuntime ?? null,
        errorMessage:
          diag?.explanation ||
          s.failureSummary ||
          s.executionReason ||
          "Scenario failed during HTTP assertion or runtime execution.",
        rawErrorMessage:
          Array.isArray(s.failureMessages) && s.failureMessages.length > 0
            ? s.failureMessages.join("\n")
            : s.failureSummary || s.executionReason || "",
      };
    });

  const failureLogs =
    report?.failureLogs && report.failureLogs.length > 0
      ? report.failureLogs.map((f) => {
          const match = failedScenarioLogs.find(
            (sf) =>
              sf.targetEndpoint === f.targetEndpoint &&
              (!f.title || sf.title === f.title),
          );
          if (!match) return f;
          return {
            ...match,
            ...f,
            failureLayer: f.failureLayer || match.failureLayer,
            failingComponent: f.failingComponent || match.failingComponent,
            sourceFile: f.sourceFile || match.sourceFile,
            line: f.line ?? match.line,
            codeSnippet: f.codeSnippet || match.codeSnippet,
            suggestedFix: f.suggestedFix || match.suggestedFix,
            serverErrorMessage: f.serverErrorMessage || match.serverErrorMessage,
            responseBodyPreview: f.responseBodyPreview || match.responseBodyPreview,
          };
        })
      : failedScenarioLogs.length > 0
        ? failedScenarioLogs
        : routeMatrix
            .filter((r) => r.status === "FAILED")
            .map((r, i) => ({
              id: `fail_${i}`,
              targetEndpoint: `${r.method} ${r.path}`,
              title: `Endpoint regression on ${r.path}`,
              failureLayer: "ASSERTION_FAILED",
              sourceFile: r.sourceFile || "controllers/handler.js",
              line: 42,
              errorMessage:
                "Endpoint has failing test scenarios or HTTP contract mismatch.",
            }));

  const totalScenarios = Math.max(
    allScenarios.length,
    latestExecution?.totalTests || 0,
    overview?.totalScenarios || 0,
    usePeakReport ? 0 : workspace?.summary?.totalScenariosCount || 0,
  );

  const totalDiscovered =
    (usePeakReport
      ? apiCoverage?.discoveredApis || routeMatrix.length
      : null) ||
    workspace?.summary?.discoveredApis ||
    (rawEndpoints.length > 0 ? rawEndpoints.length : null) ||
    apiCoverage?.discoveredApis ||
    routeMatrix.length ||
    0;

  const coveredRoutes = routeMatrix.filter(
    (r) => r.status === "COVERED" || r.status === "PASS",
  );
  const partialRoutes = routeMatrix.filter((r) => r.status === "PARTIAL");
  const uncoveredRoutes = routeMatrix.filter((r) => r.status === "UNCOVERED");
  const failedRoutes = routeMatrix.filter(
    (r) => r.status === "FAILED" || r.status === "FAIL",
  );

  const totalTested = coveredRoutes.length;
  const coverageRate =
    totalDiscovered > 0 ? Math.round((totalTested / totalDiscovered) * 100) : 0;

  const executedPassCount = allScenarios.filter(
    (s) => s.status === "passed" || s.executionVerdict === "PASS",
  ).length;
  const executedFailCount = allScenarios.filter(
    (s) => s.status === "failed" || s.executionVerdict === "FAIL",
  ).length;

  const totalExecuted = usePeakReport
    ? Math.max(
        executedPassCount + executedFailCount,
        latestExecution?.totalTests || 0,
      )
    : Math.max(
        executedPassCount + executedFailCount,
        latestExecution?.totalTests || 0,
        workspace?.summary?.totalTests || 0,
      );

  const totalFailed =
    executedFailCount > 0
      ? executedFailCount
      : (latestExecution?.failedTests ??
        (usePeakReport ? 0 : workspace?.summary?.failedTests) ??
        overview?.failedScenariosCount ??
        failureLogs.length);

  const totalPassed =
    executedPassCount > 0
      ? executedPassCount
      : Math.max(
          0,
          latestExecution?.passedTests ??
            (usePeakReport ? null : workspace?.summary?.passedTests) ??
            overview?.passedScenariosCount ??
            totalExecuted - totalFailed,
        );

  const effectiveHasExecuted =
    hasExecutedCoverage !== undefined
      ? Boolean(hasExecutedCoverage)
      : Boolean(
          report?.apiCoverage?.hasExecutedCoverage ||
          report?.overview?.hasExecutedCoverage ||
          totalExecuted > 0,
        );

  const passRate =
    effectiveHasExecuted && totalExecuted > 0
      ? Math.round((totalPassed / totalExecuted) * 100)
      : 0;

  useChatTestContext(onChatContextChange, {
    projectId, snapshotId, testType: "integration", testRunId: latestExecution?.testRunId,
    displayedMetrics: {
      kind: "integration", tab: "report",
      state: loading && !workspace && !report ? "loading" : totalExecuted > 0 ? "ready" : "not-run",
      counts: {
        endpoints: totalDiscovered, testedEndpoints: totalTested,
        passedEndpoints: coveredRoutes.length, failedEndpoints: failedRoutes.length,
        scenarios: totalScenarios, passedScenarios: totalPassed, failedScenarios: totalFailed,
        apiCoveragePct: coverageRate, scenarioPassRate: passRate,
      },
    },
  });

  // Quality Health Score (0-100)
  const qualityScore = effectiveHasExecuted
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            coverageRate * 0.45 +
              passRate * 0.45 +
              (totalFailed === 0 ? 10 : 0),
          ),
        ),
      )
    : null;

  const qualityGrade = !effectiveHasExecuted
    ? "—"
    : qualityScore >= 95
      ? "A+"
      : qualityScore >= 85
        ? "A"
        : qualityScore >= 70
          ? "B"
          : qualityScore >= 50
            ? "C"
            : "D";

  const verdict = !effectiveHasExecuted
    ? "PENDING_ANALYSIS"
    : totalFailed > 0
      ? "REGRESSION_DETECTED"
      : coverageRate >= 80 && passRate === 100
        ? "PRODUCTION_READY"
        : "PARTIAL_COVERAGE";

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

  const codeCov =
    (usePeakReport && report?.projectCodeCoverage?.stmtsPct != null
      ? {
          statement: report.projectCodeCoverage.stmtsPct,
          branch: report.projectCodeCoverage.branchesPct || 0,
          function: report.projectCodeCoverage.funcsPct || 0,
          line:
            report.projectCodeCoverage.linesPct ||
            report.projectCodeCoverage.stmtsPct ||
            0,
        }
      : null) ||
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

  const layerHealth = report?.layerHealth || [
    {
      layer: "Router",
      key: "ROUTER_NOT_FOUND",
      failures: failureLogs.filter((f) => f.failureLayer === "ROUTER_NOT_FOUND")
        .length,
      status:
        failureLogs.filter((f) => f.failureLayer === "ROUTER_NOT_FOUND")
          .length === 0
          ? "HEALTHY"
          : "DEGRADED",
      description: "Route path resolution & mounting",
    },
    {
      layer: "Middleware",
      key: "MIDDLEWARE_REJECTED",
      failures: failureLogs.filter(
        (f) => f.failureLayer === "MIDDLEWARE_REJECTED",
      ).length,
      status:
        failureLogs.filter((f) => f.failureLayer === "MIDDLEWARE_REJECTED")
          .length === 0
          ? "HEALTHY"
          : "DEGRADED",
      description: "Auth tokens, CORS, body validation",
    },
    {
      layer: "Controller",
      key: "CONTROLLER_CRASH",
      failures: failureLogs.filter((f) => f.failureLayer === "CONTROLLER_CRASH")
        .length,
      status:
        failureLogs.filter((f) => f.failureLayer === "CONTROLLER_CRASH")
          .length === 0
          ? "HEALTHY"
          : "DEGRADED",
      description: "Business logic runtime stability",
    },
    {
      layer: "Database",
      key: "DATABASE_FAILURE",
      failures: failureLogs.filter((f) => f.failureLayer === "DATABASE_FAILURE")
        .length,
      status:
        failureLogs.filter((f) => f.failureLayer === "DATABASE_FAILURE")
          .length === 0
          ? "HEALTHY"
          : "DEGRADED",
      description: "Queries, ORM relations & constraints",
    },
    {
      layer: "Assertion",
      key: "ASSERTION_FAILED",
      failures: failureLogs.filter((f) => f.failureLayer === "ASSERTION_FAILED")
        .length,
      status:
        failureLogs.filter((f) => f.failureLayer === "ASSERTION_FAILED")
          .length === 0
          ? "HEALTHY"
          : "DEGRADED",
      description: "Contract schemas & HTTP status codes",
    },
  ];

  const scenarioClass = (() => {
    let happy = 0;
    let val = 0;
    let auth = 0;
    let notFound = 0;
    let res = 0;
    const scenariosList =
      allScenarios.length > 0 ? allScenarios : report?.scenarios || [];
    scenariosList.forEach((s) => {
      const code = parseInt(s.expectedStatus || s.actualStatus || 200, 10);
      const name =
        `${s.title || s.testName || ""} ${s.description || ""}`.toLowerCase();
      if (
        s.scenarioType === "HAPPY_PATH" ||
        s.category === "Happy Path" ||
        (code >= 200 &&
          code < 300 &&
          !name.includes("fail") &&
          !name.includes("invalid") &&
          !name.includes("error"))
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
      resourceNotFound: {
        count: notFound,
        percentage: Math.round((notFound / tot) * 100),
      },
      serverResiliency: {
        count: res,
        percentage: Math.round((res / tot) * 100),
      },
    };
  })();

  const moduleBreakdown =
    report?.moduleBreakdown ||
    (() => {
      const map = {};
      routeMatrix.forEach((r) => {
        const segs = (r.path || "").split("/").filter(Boolean);
        let mod = "ROOT";
        let idx = 0;
        while (idx < segs.length && /^(api|v\d+)$/i.test(segs[idx])) idx++;
        if (idx < segs.length)
          mod = segs[idx].replace(/^:/, "").toUpperCase() || "ROOT";
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
        if (r.status === "COVERED" || r.status === "PASS")
          map[mod].testedEndpoints++;
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

  const durationMs =
    latestExecution?.durationMs || workspace?.execution?.durationMs || 0;
  const avgDurationMs =
    totalExecuted > 0 ? Math.round(durationMs / totalExecuted) : 0;
  const history = report?.history || {};

  const handleServerExport = async (format) => {
    if (!projectId || exportingFormat) return;
    setExportingFormat(format);
    setExportError("");
    try {
      await downloadIntegrationReportApi(projectId, {
        snapshotId: snapshotId || overview?.snapshotId || null,
        format,
      });
    } catch (err) {
      setExportError(
        err?.message || `Failed to export ${format.toUpperCase()} report.`,
      );
    } finally {
      setExportingFormat(null);
    }
  };

  const filteredRouteMatrix = useMemo(() => {
    return routeMatrix.filter((r) => {
      if (
        selectedStatusFilter === "COVERED" &&
        r.status !== "COVERED" &&
        r.status !== "PASS"
      )
        return false;
      if (selectedStatusFilter === "PARTIAL" && r.status !== "PARTIAL")
        return false;
      if (selectedStatusFilter === "UNCOVERED" && r.status !== "UNCOVERED")
        return false;
      if (
        selectedStatusFilter === "FAILED" &&
        r.status !== "FAILED" &&
        r.status !== "FAIL"
      )
        return false;
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
  }, [routeMatrix, selectedStatusFilter, searchQuery]);

  if (loading && !report && routeMatrix.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-xs text-[var(--color-text-muted)]">
        Loading integration report...
      </div>
    );
  }

  if (!effectiveHasScanned) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center flex flex-col items-center justify-center gap-3">
        <div className="w-9 h-9 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)]">
          <FileText size={18} />
        </div>
        <div className="space-y-1 max-w-md">
          <h3 className="text-sm font-semibold text-[var(--color-text)] m-0">
            API endpoints have not been scanned yet
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] m-0 leading-relaxed">
            Scan the repository to discover Express/Node routes and generate the
            integration coverage report.
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {onScanApis ? (
            <button
              type="button"
              onClick={onScanApis}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors cursor-pointer"
            >
              <Search size={13} />
              <span>Scan API Routes</span>
            </button>
          ) : (
            onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab("endpoints")}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors cursor-pointer"
              >
                <ArrowRight size={13} />
                <span>Go to Endpoints Matrix</span>
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  const totalReqCases = routeMatrix.reduce(
    (sum, r) => sum + (r.caseCoverage?.totalRequired || 0),
    0,
  );
  const totalCovCases = routeMatrix.reduce(
    (sum, r) => sum + (r.caseCoverage?.coveredCount || 0),
    0,
  );
  const overallCasePct =
    totalReqCases > 0 ? Math.round((totalCovCases / totalReqCases) * 100) : 0;

  const scenarioItems = [
    {
      key: "happy",
      label: "Happy Path (2xx)",
      count: scenarioClass.happyPath?.count || 0,
      pct: scenarioClass.happyPath?.percentage || 0,
      barColor: "bg-[var(--color-primary)]/60",
      dotColor: "bg-[var(--color-primary)]/75",
    },
    {
      key: "val",
      label: "Validation (400/422)",
      count: scenarioClass.validation?.count || 0,
      pct: scenarioClass.validation?.percentage || 0,
      barColor: "bg-slate-400/55",
      dotColor: "bg-slate-400/75",
    },
    {
      key: "auth",
      label: "Auth (401/403)",
      count: scenarioClass.authSecurity?.count || 0,
      pct: scenarioClass.authSecurity?.percentage || 0,
      barColor: "bg-slate-500/55",
      dotColor: "bg-slate-500/75",
    },
    {
      key: "notFound",
      label: "Not Found (404)",
      count: scenarioClass.resourceNotFound?.count || 0,
      pct: scenarioClass.resourceNotFound?.percentage || 0,
      barColor: "bg-slate-600/55",
      dotColor: "bg-slate-600/75",
    },
    {
      key: "res",
      label: "Resiliency (500)",
      count: scenarioClass.serverResiliency?.count || 0,
      pct: scenarioClass.serverResiliency?.percentage || 0,
      barColor: "bg-rose-400/45",
      dotColor: "bg-rose-400/65",
    },
  ];

  return (
    <div className="space-y-5 font-sans">
      {/* ── 1. REPORT HEADER & EXPORT BAR ── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-[var(--color-text)] m-0">
              Integration Test Report
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                verdict === "REGRESSION_DETECTED"
                  ? "bg-rose-500/[0.06] text-rose-300/85 border-rose-500/20"
                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  verdict === "PRODUCTION_READY"
                    ? "bg-emerald-500/65"
                    : verdict === "REGRESSION_DETECTED"
                      ? "bg-rose-400/75"
                      : verdict === "PENDING_ANALYSIS"
                        ? "bg-[var(--color-border-strong)]"
                        : "bg-amber-500/60"
                }`}
              />
              {verdict === "PENDING_ANALYSIS"
                ? "Pending analysis"
                : verdict === "PRODUCTION_READY"
                  ? "Production ready"
                  : verdict === "REGRESSION_DETECTED"
                    ? "Regression detected"
                    : "Needs attention"}
            </span>
            {usePeakReport && (
              <span
                className="px-2 py-0.5 rounded-md text-[11px] font-mono tabular-nums bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
                title="Preserves the highest coverage snapshot achieved for audit reporting."
              >
                Peak snapshot · {coverageRate}% routes
                {codeCov?.line != null
                  ? ` · ${Number(codeCov.line).toFixed(1)}% line cov`
                  : ""}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums">
            <span>Project #{projectId?.substring(0, 8) || "active"}</span>
            <span>
              Snapshot #
              {(snapshotId || overview?.snapshotId)?.substring(0, 8) ||
                "latest"}
            </span>
            <span>Runner: Supertest / Node</span>
            <span>Evaluated {new Date().toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 no-print shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors duration-150 cursor-pointer"
            title="Print current view"
          >
            <Printer size={13} />
            <span className="hidden sm:inline">Print</span>
          </button>
          <button
            type="button"
            onClick={() => handleServerExport("json")}
            disabled={Boolean(exportingFormat)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            title="Download canonical JSON integration report"
          >
            {exportingFormat === "json" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
            <span>
              {exportingFormat === "json" ? "Exporting..." : "Export JSON"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleServerExport("pdf")}
            disabled={Boolean(exportingFormat)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            title="Download formatted A4 PDF report"
          >
            {exportingFormat === "pdf" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <FileText size={13} />
            )}
            <span>
              {exportingFormat === "pdf" ? "Generating PDF..." : "Export PDF"}
            </span>
          </button>
        </div>
      </div>

      {exportError && (
        <div
          role="alert"
          className="px-4 py-2.5 rounded-md border border-rose-500/20 bg-rose-500/[0.06] text-xs text-rose-300/85 flex items-center justify-between gap-2 no-print"
        >
          <span>{exportError}</span>
          <button
            type="button"
            onClick={() => setExportError("")}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {!effectiveHasExecuted && (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-2.5 text-xs text-[var(--color-text-secondary)]">
            <Activity
              size={14}
              className="text-[var(--color-text-muted)] shrink-0"
            />
            <span>
              Discovered{" "}
              <strong className="font-mono text-[var(--color-text)]">
                {totalDiscovered}
              </strong>{" "}
              API {totalDiscovered === 1 ? "route" : "routes"}. Run coverage to
              execute scenarios and measure pass rates.
            </span>
          </div>
          {onRunCoverage && (
            <button
              type="button"
              onClick={onRunCoverage}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer"
            >
              <Zap size={12} />
              <span>Run Coverage</span>
            </button>
          )}
        </div>
      )}

      {/* ── 2. EXECUTIVE SCORE & TELEMETRY STRIP ── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] overflow-hidden">
        <div className="lg:col-span-4 p-4 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-medium text-[var(--color-text-secondary)]">
              Quality score
            </div>
            <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
              <span className="text-3xl font-bold tracking-tight text-[var(--color-text)]">
                {effectiveHasExecuted ? qualityScore : "—"}
              </span>
              {effectiveHasExecuted && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  / 100
                </span>
              )}
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)]">
              {effectiveHasExecuted
                ? "Route verification, pass rate & layer health"
                : "Run coverage to compute audit score"}
            </div>
          </div>

          {effectiveHasExecuted && (
            <div className="w-11 h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex flex-col items-center justify-center shrink-0">
              <span className="text-[10px] text-[var(--color-text-muted)] leading-none">
                Grade
              </span>
              <span className="text-base font-bold font-mono text-[var(--color-text)] leading-tight mt-0.5">
                {qualityGrade}
              </span>
            </div>
          )}
        </div>

        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[var(--color-border)]">
          <div className="p-3.5 flex flex-col justify-between gap-1.5">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              Endpoint coverage
            </span>
            <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
              <span className="text-lg font-bold text-[var(--color-text)]">
                {effectiveHasExecuted ? `${coverageRate}%` : "—"}
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {totalTested}/{totalDiscovered}
              </span>
            </div>
            <div className="w-full bg-[var(--color-surface-secondary)] h-1 rounded-sm overflow-hidden">
              <div
                className="bg-[var(--color-primary)]/70 h-full transition-all"
                style={{ width: `${effectiveHasExecuted ? coverageRate : 0}%` }}
              />
            </div>
          </div>

          <div className="p-3.5 flex flex-col justify-between gap-1">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              Contract cases
            </span>
            <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
              <span className="text-lg font-bold text-[var(--color-text)]">
                {overallCasePct}%
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {totalCovCases}/{totalReqCases}
              </span>
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)] truncate">
              Required HTTP checks
            </div>
          </div>

          <div className="p-3.5 flex flex-col justify-between gap-1">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              Pass rate
            </span>
            <div className="font-mono tabular-nums">
              <span
                className={`text-lg font-bold ${
                  !effectiveHasExecuted
                    ? "text-[var(--color-text-muted)]"
                    : passRate === 100
                      ? "text-[var(--color-text)]"
                      : "text-rose-300/85"
                }`}
              >
                {effectiveHasExecuted &&
                (totalExecuted > 0 || totalScenarios > 0)
                  ? `${passRate}%`
                  : "—"}
              </span>
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums truncate">
              {effectiveHasExecuted
                ? `${totalPassed} pass / ${totalFailed} fail`
                : "Not run yet"}
            </div>
          </div>

          <div className="p-3.5 flex flex-col justify-between gap-1">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              Regressions
            </span>
            <div className="flex items-baseline gap-1 font-mono tabular-nums">
              <span
                className={`text-lg font-bold ${
                  !effectiveHasExecuted
                    ? "text-[var(--color-text-muted)]"
                    : totalFailed === 0
                      ? "text-[var(--color-text)]"
                      : "text-rose-300/85"
                }`}
              >
                {effectiveHasExecuted ? totalFailed : "—"}
              </span>
              {effectiveHasExecuted && (
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  {totalFailed === 1 ? "issue" : "issues"}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)] truncate">
              {!effectiveHasExecuted
                ? "Pending"
                : totalFailed === 0
                  ? "All layers healthy"
                  : "Needs inspection"}
            </div>
          </div>

          <div className="p-3.5 flex flex-col justify-between gap-1 col-span-2 sm:col-span-1">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              Duration
            </span>
            <div className="font-mono tabular-nums">
              <span className="text-lg font-bold text-[var(--color-text)]">
                {(durationMs / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums">
              ~{avgDurationMs}ms / case
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. FAILURE LOCALIZATION (Prominent only when failures exist) ── */}
      {failureLogs.length > 0 ? (
        <section className="rounded-lg border border-[var(--color-border)] border-l-2 border-l-rose-400/60 bg-[var(--color-surface)] overflow-hidden">
          <div className="px-4 py-2.5 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <XCircle size={14} className="text-rose-400/80 shrink-0" />
              <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
                Failing Scenarios & Root Causes ({failureLogs.length})
              </h3>
            </div>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
              Localized by request lifecycle layer
            </span>
          </div>

          <div className="divide-y divide-[var(--color-border)]">
            {failureLogs.map((f, i) => {
              const rawText = (f.rawErrorMessage || f.errorMessage || "")
                .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "")
                .replace(/\u001b/g, "");
              const conciseSummary = summarizeIntegrationFailure(f.errorMessage);
              const showRawToggle = Boolean(rawText && rawText.trim() !== conciseSummary.trim());

              return (
                <div key={f.id || i} className="px-4 py-3 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono min-w-0">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/[0.06] text-rose-300/85 border border-rose-500/20 shrink-0">
                        {f.failureLayer || "ASSERTION_FAILED"}
                      </span>
                      <span className="font-semibold text-[var(--color-text)] truncate">
                        {f.targetEndpoint}
                      </span>
                      {f.title && f.title !== f.targetEndpoint && (
                        <span className="text-[11px] font-sans text-[var(--color-text-muted)] truncate">
                          — {f.title}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      {f.failingComponent && (
                        <span className="font-mono text-[10px] text-[var(--color-text-muted)] truncate max-w-[200px]">
                          {f.failingComponent}
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-rose-300/85 tabular-nums">
                        Expected {f.expectedStatus || 200} · Received{" "}
                        {f.responseStatus || "Error"}
                      </span>
                    </div>
                  </div>
                  <div className="font-sans text-[12px] text-[var(--color-text-secondary)] pl-3 border-l-2 border-rose-400/35 space-y-1.5">
                    <p className="m-0">{conciseSummary}</p>
                    {f.serverErrorMessage && (
                      <div className="px-2 py-1 rounded bg-[var(--color-bg)] border border-rose-500/20 font-mono text-[10px] text-rose-300 break-words">
                        <span className="text-[var(--color-text-muted)] mr-1.5">
                          Server Error:
                        </span>
                        {f.serverErrorMessage}
                      </div>
                    )}
                    {f.line && (f.sourceFile || f.codeSnippet) && (
                      <div className="rounded bg-[var(--color-bg)] border border-[var(--color-border)] p-2 space-y-1">
                        <div className="font-mono text-[10px] text-[var(--color-text-muted)]">
                          Stopped near{" "}
                          <span className="text-[var(--color-text)] tabular-nums">
                            {f.sourceFile ? `${f.sourceFile}:${f.line}` : `Line ${f.line}`}
                          </span>
                        </div>
                        {f.codeSnippet && (
                          <pre className="m-0 font-mono text-[10px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">
                            {f.codeSnippet}
                          </pre>
                        )}
                      </div>
                    )}
                    {f.suggestedFix && (
                      <p className="m-0 text-[11px] text-[var(--color-text-muted)]">
                        <span className="font-semibold text-[var(--color-text-secondary)]">
                          Suggested fix:{" "}
                        </span>
                        {f.suggestedFix}
                      </p>
                    )}
                  </div>
                  {(showRawToggle || f.responseBodyPreview) && (
                    <details className="pl-3 pt-0.5">
                      <summary className="text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer select-none">
                        Technical details
                      </summary>
                      {f.responseBodyPreview && (
                        <pre className="mt-1.5 p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[10px] text-rose-300/90 whitespace-pre-wrap break-words max-h-28 overflow-y-auto custom-scrollbar">
                          {`Response body: ${f.responseBodyPreview}`}
                        </pre>
                      )}
                      {showRawToggle && (
                        <pre className="mt-1.5 p-2.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[10px] text-[var(--color-text-muted)] whitespace-pre-wrap break-words max-h-40 overflow-y-auto custom-scrollbar">
                          {rawText}
                        </pre>
                      )}
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        effectiveHasExecuted && (
          <div className="px-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <CheckCircle2 size={14} className="text-emerald-500/70 shrink-0" />
              <span>
                All{" "}
                <strong className="font-mono text-[var(--color-text)]">
                  {totalPassed}
                </strong>{" "}
                executed scenarios passed across all 5 request layers with zero
                regressions.
              </span>
            </div>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)] shrink-0">
              0 failures
            </span>
          </div>
        )
      )}

      {/* ── 4. PROTOCOL BREAKDOWN & 5-LAYER DIAGNOSTICS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
              HTTP method coverage
            </h3>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
              {methodDist.length} verbs
            </span>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {methodDist.map((m) => {
              const badgeClass =
                METHOD_STYLES[m.method] || METHOD_STYLES.DEFAULT;
              return (
                <div
                  key={m.method}
                  className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-[110px]">
                    <span
                      className={`inline-flex items-center justify-center w-14 py-0.5 rounded font-mono text-[10px] font-semibold border ${badgeClass}`}
                    >
                      {m.method}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                      {m.total} {m.total === 1 ? "route" : "routes"}
                    </span>
                  </div>

                  <div className="flex-1 max-w-[200px]">
                    <div className="w-full bg-[var(--color-surface-secondary)] h-1.5 rounded-sm overflow-hidden">
                      <div
                        className="bg-[var(--color-primary)]/70 h-full"
                        style={{ width: `${m.coverageRate}%` }}
                      />
                    </div>
                  </div>

                  <div className="font-mono text-[11px] tabular-nums text-right min-w-[78px]">
                    <span className="text-[var(--color-text)] font-medium">
                      {m.tested}/{m.total}
                    </span>{" "}
                    <span className="text-[var(--color-text-muted)]">
                      ({m.coverageRate}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
              5-layer request health
            </h3>
            <span
              className={`text-[11px] font-mono tabular-nums ${
                totalFailed === 0 ? "text-[var(--color-text-muted)]" : "text-rose-300/85"
              }`}
            >
              {totalFailed === 0 ? "5/5 healthy" : `${totalFailed} failed`}
            </span>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {layerHealth.map((lyr) => {
              const isHealthy = lyr.status === "HEALTHY";
              return (
                <div
                  key={lyr.key}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isHealthy ? "bg-emerald-500/65" : "bg-rose-400/75"
                      }`}
                    />
                    <span className="font-mono font-medium text-[var(--color-text)] shrink-0">
                      {lyr.layer}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] truncate">
                      {lyr.description}
                    </span>
                  </div>
                  <span
                    className={`font-mono text-[11px] tabular-nums shrink-0 ${
                      isHealthy
                        ? "text-[var(--color-text-muted)]"
                        : "text-rose-300/85 font-medium"
                    }`}
                  >
                    {isHealthy ? "0 failures" : `${lyr.failures} failures`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── 5. SCENARIO DISTRIBUTION BAR (Compact, no rainbow cards) ── */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
            Scenario distribution
          </h3>
          <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
            {totalScenarios} total scenarios
          </span>
        </div>

        <div className="w-full h-2 rounded-sm bg-[var(--color-surface-secondary)] overflow-hidden flex">
          {scenarioItems.map((item) =>
            item.pct > 0 ? (
              <div
                key={item.key}
                className={`${item.barColor} h-full`}
                style={{ width: `${item.pct}%` }}
                title={`${item.label}: ${item.count} (${item.pct}%)`}
              />
            ) : null,
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
          {scenarioItems.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-2 font-mono tabular-nums"
            >
              <span className={`w-2 h-2 rounded-full ${item.dotColor}`} />
              <span className="text-[var(--color-text-secondary)] font-sans">
                {item.label}
              </span>
              <span className="font-semibold text-[var(--color-text)]">
                {item.count}
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                ({item.pct}%)
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 6. UNIFIED ENDPOINT & CONTRACT CASE AUDIT TABLE ── */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-4 py-3 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
              Endpoint & contract audit
            </h3>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
              {filteredRouteMatrix.length}/{routeMatrix.length} routes
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs no-print">
            <div className="flex items-center rounded-md bg-[var(--color-bg)] p-0.5 border border-[var(--color-border)]">
              {[
                { id: "ALL", label: `All (${routeMatrix.length})` },
                { id: "COVERED", label: `Covered (${coveredRoutes.length})` },
                ...(partialRoutes.length > 0
                  ? [
                      {
                        id: "PARTIAL",
                        label: `Partial (${partialRoutes.length})`,
                      },
                    ]
                  : []),
                {
                  id: "UNCOVERED",
                  label: `Uncovered (${uncoveredRoutes.length})`,
                },
                ...(failedRoutes.length > 0
                  ? [{ id: "FAILED", label: `Failed (${failedRoutes.length})` }]
                  : []),
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedStatusFilter(tab.id)}
                  className={`px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                    selectedStatusFilter === tab.id
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-medium border border-[var(--color-border)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
              />
              <input
                type="text"
                placeholder="Filter route or handler..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 pr-2.5 py-1 text-xs rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] w-44 font-mono"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 text-[11px] font-medium text-[var(--color-text-muted)]">
                <th className="py-2.5 px-4">Endpoint</th>
                <th className="py-2.5 px-3">Handler</th>
                <th className="py-2.5 px-3">Required contract cases</th>
                <th className="py-2.5 px-3 text-right">Scenarios</th>
                <th className="py-2.5 px-3 text-right">Latency</th>
                <th className="py-2.5 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredRouteMatrix.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-xs text-[var(--color-text-muted)] font-mono"
                  >
                    No endpoints match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredRouteMatrix.map((r, idx) => {
                  const methodClass =
                    METHOD_STYLES[r.method] || METHOD_STYLES.DEFAULT;
                  const cc = r.caseCoverage || {
                    cases: [],
                    coveredCount: 0,
                    totalRequired: 1,
                    isComplete: false,
                    passedCount: r.passedCount || 0,
                  };
                  const missingCount = Math.max(
                    0,
                    cc.totalRequired - cc.coveredCount,
                  );

                  return (
                    <tr
                      key={`${r.method}-${r.path}-${idx}`}
                      className="hover:bg-[var(--color-surface-secondary)]/30 transition-colors"
                    >
                      <td className="py-3 px-4 align-top">
                        <div className="flex items-center gap-2 font-mono">
                          <span
                            className={`inline-flex items-center justify-center w-14 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${methodClass}`}
                          >
                            {r.method}
                          </span>
                          <span className="font-medium text-[var(--color-text)]">
                            {r.path}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top font-mono text-[11px]">
                        <div className="text-[var(--color-text-secondary)] truncate max-w-[170px]">
                          {r.handler || "anonymousHandler"}
                        </div>
                        <div
                          className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[170px]"
                          title={r.sourceFile}
                        >
                          {r.sourceFile
                            ? r.sourceFile.split(/[/\\]/).slice(-2).join("/")
                            : "routes/api.js"}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(cc.cases || []).map((c) => (
                            <span
                              key={c.key}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                c.covered
                                  ? "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                                  : "bg-transparent text-[var(--color-text-muted)] border-[var(--color-border)] border-dashed"
                              }`}
                            >
                              <span
                                className={
                                  c.covered
                                    ? "text-emerald-500/70"
                                    : "text-[var(--color-text-muted)]"
                                }
                              >
                                {c.covered ? "✓" : "○"}
                              </span>
                              <span>{c.label}</span>
                            </span>
                          ))}
                          {missingCount > 0 &&
                            (onGenerateEndpoint || onNavigateTab) && (
                              <button
                                type="button"
                                onClick={() =>
                                  onGenerateEndpoint && r.rawEndpoint
                                    ? onGenerateEndpoint(r.rawEndpoint)
                                    : onNavigateTab?.("endpoints")
                                }
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer no-print"
                              >
                                <Zap size={10} className="text-[var(--color-text-muted)]" />
                                <span>Generate {missingCount} missing</span>
                              </button>
                            )}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top text-right font-mono tabular-nums text-[11px]">
                        <span className="text-[var(--color-text)] font-medium">
                          {r.passedCount ?? 0}/{r.scenarioCount || 0}
                        </span>{" "}
                        <span className="text-[var(--color-text-muted)]">
                          pass
                        </span>
                      </td>

                      <td className="py-3 px-3 align-top text-right font-mono tabular-nums text-[11px] text-[var(--color-text-muted)]">
                        {r.avgDurationMs > 0 ? `${r.avgDurationMs}ms` : "—"}
                      </td>

                      <td className="py-3 px-4 align-top text-right">
                        {r.status === "COVERED" || r.status === "PASS" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/65" />
                            Covered
                          </span>
                        ) : r.status === "PARTIAL" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-muted)] font-mono tabular-nums">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                            Partial ({cc.passedCasesCount}/{cc.totalRequired})
                          </span>
                        ) : r.status === "FAILED" || r.status === "FAIL" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-300/85">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400/75" />
                            Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border-strong)]" />
                            Uncovered
                          </span>
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

      {/* ── 7. MODULES & EXECUTION HISTORY ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {moduleBreakdown.length > 0 && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
                Module breakdown
              </h3>
              <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
                {moduleBreakdown.length}{" "}
                {moduleBreakdown.length === 1 ? "module" : "modules"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 text-[11px] font-medium text-[var(--color-text-muted)]">
                    <th className="py-2 px-3">Module</th>
                    <th className="py-2 px-3 text-right">Routes</th>
                    <th className="py-2 px-3 text-right">Scenarios</th>
                    <th className="py-2 px-3 text-right">Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px] tabular-nums">
                  {moduleBreakdown.map((m) => (
                    <tr key={m.module}>
                      <td className="py-2 px-3 font-semibold text-[var(--color-text)]">
                        {m.module}
                      </td>
                      <td className="py-2 px-3 text-right text-[var(--color-text-secondary)]">
                        {m.testedEndpoints}/{m.totalEndpoints}
                      </td>
                      <td className="py-2 px-3 text-right text-[var(--color-text-secondary)]">
                        {m.scenariosCount}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={
                            m.health === "FAILING"
                              ? "text-rose-300/85 font-medium"
                              : "text-[var(--color-text-secondary)] font-medium"
                          }
                        >
                          {m.coveragePct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section
          className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden ${
            moduleBreakdown.length === 0 ? "lg:col-span-2" : ""
          }`}
        >
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
              Recent execution runs
            </h3>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
              {history?.executions?.length || 0} recorded
            </span>
          </div>
          {!history?.executions || history.executions.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--color-text-muted)]">
              No previous test runs recorded.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 text-[11px] font-medium text-[var(--color-text-muted)]">
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Passed</th>
                    <th className="py-2 px-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px] tabular-nums">
                  {history.executions
                    .slice(-6)
                    .reverse()
                    .map((run) => {
                      const ok =
                        run.status === "SUCCESS" || run.status === "PASSED";
                      return (
                        <tr key={run.testRunId || run.id}>
                          <td className="py-2 px-3 text-[var(--color-text-secondary)]">
                            {formatDate(run.timestamp || run.createdAt)}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`inline-flex items-center gap-1.5 ${
                                ok ? "text-[var(--color-text-secondary)]" : "text-rose-300/85"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  ok ? "bg-emerald-500/65" : "bg-rose-400/75"
                                }`}
                              />
                              {run.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-[var(--color-text)]">
                            {run.passedTests}/{run.totalTests}
                          </td>
                          <td className="py-2 px-3 text-right text-[var(--color-text-muted)]">
                            {((run.durationMs || 0) / 1000).toFixed(1)}s
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── 8. GUIDANCE & ACTION RECOMMENDATIONS ── */}
      <div className="no-print">
        <IntegrationGuidancePanel projectId={projectId} />
      </div>
    </div>
  );
}
