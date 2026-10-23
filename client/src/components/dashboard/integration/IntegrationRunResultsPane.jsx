import React, { useState, useMemo } from "react";
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Code2,
  FileText,
  Activity,
  Layers,
  Info
} from "lucide-react";


const FAILURE_LAYERS_META = {
  ROUTER_NOT_FOUND: {
    label: "Router",
    code: "[ROUTER_NOT_FOUND]",
    style: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    desc: "Đường dẫn Route hoặc URL mount point không khớp router Express.",
  },
  MIDDLEWARE_REJECTED: {
    label: "Middleware",
    code: "[MIDDLEWARE_REJECTED]",
    style: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    desc: "Bị chặn bởi Authentication, JWT token, CORS hoặc Request Validator.",
  },
  CONTROLLER_CRASH: {
    label: "Controller",
    code: "[CONTROLLER_CRASH]",
    style: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    desc: "Lỗi runtime crash (TypeError, ReferenceError) trong controller handler.",
  },
  DATABASE_FAILURE: {
    label: "Database",
    code: "[DATABASE_FAILURE]",
    style: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    desc: "Lỗi kết nối database, schema constraint hoặc Prisma query failure.",
  },
  ASSERTION_FAILED: {
    label: "Assertion",
    code: "[ASSERTION_FAILED]",
    style: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    desc: "HTTP response status code hoặc JSON body không khớp với giá trị mong đợi.",
  },
};

function getScenarioFailureLayer(sc, actualHttp) {
  if (sc.failureLayer && FAILURE_LAYERS_META[sc.failureLayer]) return sc.failureLayer;
  if (actualHttp === 404) return "ROUTER_NOT_FOUND";
  if (actualHttp === 401 || actualHttp === 403) return "MIDDLEWARE_REJECTED";
  const msg = ((sc.failureMessages && sc.failureMessages.join(" ")) || sc.failureDetails?.raw || "").toLowerCase();
  if (msg.includes("prisma") || msg.includes("mongo") || msg.includes("database") || msg.includes("econnrefused")) {
    return "DATABASE_FAILURE";
  }
  if (actualHttp === 500 || msg.includes("typeerror") || msg.includes("referenceerror")) {
    return "CONTROLLER_CRASH";
  }
  return "ASSERTION_FAILED";
}

export default function IntegrationRunResultsPane({
  workspace,
  summary,
  execution,
  endpoints = [],
  isApproved,
  isJobActive,
  pendingAction,
  remainingEndpoints = [],
  totalRemainingScenarios = 0,
  onRunAllTests,
  onRunRemaining,
  onRunEndpoint = () => {},
  onRetryScenario = () => {},
  onAIFixScenario = () => {},
  selectedEndpointId = null,
  onSelectEndpoint = () => {},
}) {
  const [qaEvidenceOpen, setQaEvidenceOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [expandedEndpoints, setExpandedEndpoints] = useState(() => {
    // Endpoints with failures start expanded by default, passing ones collapsed
    const initial = {};
    (endpoints || []).forEach((ep) => {
      const epKey = `${ep.method} ${ep.path}`;
      const hasFailure = (ep.scenarios || []).some((s) => s.status === "failed" || s.rawJestStatus === "failed");
      if (hasFailure) {
        initial[epKey] = true;
      }
    });
    return initial;
  });

  const [expandedScenarios, setExpandedScenarios] = useState(() => {
    const initial = {};
    (endpoints || []).forEach((ep) => {
      (ep.scenarios || []).forEach((s, idx) => {
        if (s.status === "failed" || s.rawJestStatus === "failed") {
          initial[`${ep.method}-${ep.path}-${s.title}-${idx}`] = true;
        }
      });
    });
    return initial;
  });

  const toggleEndpoint = (epKey) => {
    setExpandedEndpoints((prev) => ({
      ...prev,
      [epKey]: !prev[epKey]
    }));
  };

  const toggleScenario = (scKey) => {
    setExpandedScenarios((prev) => ({
      ...prev,
      [scKey]: !prev[scKey]
    }));
  };

  // 1. Gather all failed scenarios across endpoints
  const failedScenariosList = useMemo(() => {
    const list = [];
    (endpoints || []).forEach((ep) => {
      (ep.scenarios || []).forEach((sc, idx) => {
        if (sc.status === "failed" || sc.rawJestStatus === "failed" || sc.executionVerdict === "FAIL") {
          list.push({
            endpoint: ep,
            scenario: sc,
            index: idx,
            key: `${ep.method}-${ep.path}-${sc.title}-${idx}`
          });
        }
      });
    });
    return list;
  }, [endpoints]);

  
  // Audited API level pass/fail/uncovered stats
  const apiStats = useMemo(() => {
    let passedApis = 0;
    let failedApis = 0;
    let uncoveredApis = 0;

    (endpoints || []).forEach((ep) => {
      const hasExecuted = (ep.executedCount || 0) > 0 || (ep.scenarios || []).some((s) => s.status === "passed" || s.status === "failed");
      const hasFail = (ep.failedCount || 0) > 0 || (ep.scenarios || []).some((s) => s.status === "failed" || s.rawJestStatus === "failed" || s.executionVerdict === "FAIL");
      if (!hasExecuted) {
        uncoveredApis++;
      } else if (hasFail) {
        failedApis++;
      } else {
        passedApis++;
      }
    });

    const totalApis = (endpoints || []).length;
    const testedApis = passedApis + failedApis;
    const apiPassRate = testedApis > 0 ? Math.round((passedApis / testedApis) * 100) : 0;
    const apiCoverageRate = totalApis > 0 ? Math.round((testedApis / totalApis) * 100) : 0;

    return {
      totalApis,
      testedApis,
      passedApis,
      failedApis,
      uncoveredApis,
      apiPassRate,
      apiCoverageRate,
    };
  }, [endpoints]);

  // Metric calculations
  const total = summary?.totalTests || 0;
  const passed = summary?.passedTests || 0;
  const failed = summary?.failedTests || 0;
  const skipped = summary?.skippedTests || 0;
  const executed = passed + failed;
  const passRate = executed > 0 ? Math.round((passed / executed) * 100) : 0;
  const testedApis = summary?.testedApis || 0;
  const discoveredApis = summary?.discoveredApis || 0;
  const apiCoverageRate = discoveredApis > 0 ? Math.round((testedApis / discoveredApis) * 100) : 0;
  const avgLatency = summary?.avgRequestLatencyMs ?? summary?.avgEndpointLatencyMs ?? 0;
  const durationMs = summary?.durationMs || 0;

  const semanticState = summary?.semanticState;
  const isFailedRun = failed > 0 || semanticState === "TESTS_FAILED";
  const isSuccessRun = !isFailedRun && executed > 0;

  const getMethodBadgeClass = (method) => {
    switch (method?.toUpperCase()) {
      case "GET":
        return "text-sky-400 bg-sky-500/10 border-sky-500/25";
      case "POST":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
      case "PUT":
      case "PATCH":
        return "text-amber-400 bg-amber-500/10 border-amber-500/25";
      case "DELETE":
        return "text-rose-400 bg-rose-500/10 border-rose-500/25";
      default:
        return "text-slate-400 bg-slate-500/10 border-slate-500/25";
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar font-sans text-[var(--color-text)] bg-[var(--color-surface)] p-6 space-y-6">
      {/* 1. Execution Action Toolbar */}
      <div className="p-3.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
            Integration Test Execution
          </h3>
          <p className="text-[11px] text-[var(--color-text-secondary)] m-0 font-mono mt-0.5">
            Jest & Supertest runner execution results, failure triage, and actionable controls
          </p>
        </div>
        <div className="flex items-center gap-2">
          {remainingEndpoints.length > 0 && totalRemainingScenarios > 0 && (
            <button
              type="button"
              onClick={() => onRunRemaining()}
              disabled={isJobActive || pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-success)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Play size={12} fill="currentColor" />
              <span>
                {pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE"
                  ? "Starting Remaining..."
                  : totalRemainingScenarios === 1
                    ? "Run 1 Remaining / Retry Scenario"
                    : `Run Remaining Tests (${totalRemainingScenarios})`}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onRunAllTests}
            disabled={!isApproved || isJobActive || pendingAction === "RUN" || pendingAction === "RUN_REMAINING"}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs disabled:opacity-50"
          >
            <Play size={12} fill="currentColor" />
            <span>
              {pendingAction === "RUN"
                ? "Starting Execution..."
                : execution
                  ? "Run Tests Again"
                  : "Run All Tests"}
            </span>
          </button>
        </div>
      </div>

      
      {/* Task 5.3: Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: API Pass Rate */}
        <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              API Pass Rate
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold font-mono ${apiStats.apiPassRate >= 80 ? "text-[var(--color-success)]" : apiStats.apiPassRate > 0 ? "text-amber-400" : "text-[var(--color-text-muted)]"}`}>
                {apiStats.apiPassRate}%
              </span>
              <span className="text-xs text-[var(--color-text-muted)] font-mono">
                ({apiStats.passedApis}/{apiStats.testedApis} tested APIs)
              </span>
            </div>
          </div>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-2">
            Tỉ lệ API endpoint vượt qua toàn bộ kịch bản kiểm thử
          </div>
        </div>

        {/* Card 2: API Coverage */}
        <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              API Coverage
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-[var(--color-primary)]">
                {apiStats.apiCoverageRate}%
              </span>
              <span className="text-xs text-[var(--color-text-muted)] font-mono">
                ({apiStats.testedApis}/{apiStats.totalApis} routes)
              </span>
            </div>
          </div>
          <div className="w-full bg-[var(--color-surface-secondary)] h-1.5 rounded-full overflow-hidden mt-2">
            <div className="bg-[var(--color-primary)] h-full transition-all" style={{ width: `${apiStats.apiCoverageRate}%` }} />
          </div>
        </div>

        {/* Card 3: Code Coverage (Istanbul) */}
        <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Code Coverage (Istanbul)
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs font-mono mt-0.5">
              <div>Lines: <strong className="text-[var(--color-success)]">{Number(summary?.codeCoverage?.line || 0).toFixed(0)}%</strong></div>
              <div>Branches: <strong className="text-amber-400">{Number(summary?.codeCoverage?.branch || 0).toFixed(0)}%</strong></div>
              <div>Funcs: <strong className="text-sky-400">{Number(summary?.codeCoverage?.function || 0).toFixed(0)}%</strong></div>
              <div>Stmts: <strong className="text-purple-400">{Number(summary?.codeCoverage?.statement || 0).toFixed(0)}%</strong></div>
            </div>
          </div>
          <div className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
            Đo lường cờ thực thi qua Istanbul V8
          </div>
        </div>

        {/* Card 4: Status Triage */}
        <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Endpoint Status Triage
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-xs">
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20 font-bold">
                ✓ {apiStats.passedApis} Passed
              </span>
              <span className="px-2 py-0.5 rounded bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/20 font-bold">
                ✗ {apiStats.failedApis} Failed
              </span>
              <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)] font-semibold">
                ? {apiStats.uncoveredApis} Uncovered
              </span>
            </div>
          </div>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-2">
            Phân loại trạng thái kiểm thử theo từng route
          </div>
        </div>
      </div>

      {/* 2. Unified Compact Execution Summary */}
      <div className="border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] overflow-hidden shadow-xs">
        {/* Status Verdict Header */}
        <div className={`px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-4 ${
          isFailedRun
            ? "bg-rose-500/10 border-rose-500/20"
            : isSuccessRun
              ? "bg-emerald-500/10 border-emerald-500/20"
              : "bg-[var(--color-surface-secondary)]/50"
        }`}>
          <div className="flex items-center gap-2.5">
            {isFailedRun ? (
              <XCircle size={16} className="text-[var(--color-danger)] shrink-0" />
            ) : isSuccessRun ? (
              <CheckCircle2 size={16} className="text-[var(--color-success)] shrink-0" />
            ) : (
              <Activity size={16} className="text-[var(--color-warning)] shrink-0" />
            )}
            <div>
              <span className={`text-xs font-bold uppercase tracking-wider ${
                isFailedRun ? "text-[var(--color-danger)]" : isSuccessRun ? "text-[var(--color-success)]" : "text-[var(--color-text)]"
              }`}>
                {isFailedRun ? "Tests Failed" : isSuccessRun ? "All Tests Passed" : semanticState || "Execution Finished"}
              </span>
              <span className="text-xs text-[var(--color-text-secondary)] ml-3">
                {isFailedRun
                  ? `${failed} of ${executed} executed scenarios failed assertion checks.`
                  : isSuccessRun
                    ? `All ${executed} executed scenarios passed runner assertions.`
                    : "No test executions recorded."}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-[var(--color-text-secondary)] shrink-0">
            {summary?.executionJobId && (
              <span>Job: <strong className="text-[var(--color-text)] font-semibold">{summary.executionJobId.slice(0, 12)}</strong></span>
            )}
            {durationMs > 0 && (
              <span>Duration: <strong className="text-[var(--color-text)] font-semibold">{durationMs.toLocaleString()}ms</strong></span>
            )}
          </div>
        </div>

        {/* Compact Single-Row Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-y sm:divide-y-0 divide-[var(--color-border)] text-center text-xs">
          <div className="p-3">
            <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider mb-0.5">Scenarios</div>
            <div className="text-base font-bold font-mono text-[var(--color-text)]">{total}</div>
          </div>
          <div className="p-3 bg-emerald-500/5">
            <div className="text-[10px] uppercase font-bold text-[var(--color-success)] tracking-wider mb-0.5">Passed</div>
            <div className="text-base font-bold font-mono text-[var(--color-success)]">{passed}</div>
          </div>
          <div className={`p-3 ${failed > 0 ? "bg-rose-500/10" : ""}`}>
            <div className={`text-[10px] uppercase font-bold tracking-wider mb-0.5 ${failed > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}>Failed</div>
            <div className={`text-base font-bold font-mono ${failed > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}>{failed}</div>
          </div>
          <div className="p-3">
            <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider mb-0.5">Skipped</div>
            <div className="text-base font-bold font-mono text-[var(--color-text-secondary)]">{skipped}</div>
          </div>
          <div className="p-3">
            <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider mb-0.5">Pass Rate</div>
            <div className={`text-base font-bold font-mono ${passRate >= 90 ? "text-[var(--color-success)]" : passRate > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-text-muted)]"}`}>
              {passRate}%
            </div>
          </div>
          <div className="p-3">
            <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider mb-0.5">API Coverage</div>
            <div className="text-base font-bold font-mono text-[var(--color-text)]">
              {testedApis}/{discoveredApis} <span className="text-xs text-[var(--color-text-muted)] font-normal">({apiCoverageRate}%)</span>
            </div>
          </div>
          <div className="p-3">
            <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider mb-0.5">Avg Latency</div>
            <div className="text-base font-bold font-mono text-[var(--color-text)]">
              {avgLatency}<span className="text-[10px] text-[var(--color-text-muted)]">ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Failures Requiring Attention Section (Prominent, High Priority & Task-Oriented) */}
      {failedScenariosList.length > 0 && (
        <div className="border border-rose-500/30 rounded-[var(--radius-md)] bg-[var(--color-surface)] shadow-xs overflow-hidden">
          <div className="px-4 py-2.5 bg-rose-500/10 border-b border-rose-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-[var(--color-danger)]" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)] m-0">
                Failures Requiring Attention ({failedScenariosList.length})
              </h4>
            </div>
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              High-priority failure diagnostics with direct retry actions
            </span>
          </div>

          <div className="divide-y divide-[var(--color-border)]">
            {failedScenariosList.map(({ endpoint: ep, scenario: sc, key }) => {
              const methodBadgeClass = getMethodBadgeClass(ep.method);
              const failDetails = sc.failureDetails || {};
              const sourceFile = failDetails.file ? failDetails.file.split(/[\\/]/).slice(-2).join("/") : null;
              const sourceLine = failDetails.line || null;
              const sourceCol = failDetails.column || null;
              const actualHttp = sc.actualStatus ?? sc.actualStatusFromRuntime ?? null;
              const expectedHttp = sc.expectedStatus ?? null;
              const rawMessage = (sc.failureMessages && sc.failureMessages.length > 0)
                ? sc.failureMessages.join("\n").replace(/\u001b\[[0-9;]*m/g, "")
                : failDetails.raw || "No raw runner output available.";

              return (
                <div key={key} className="p-4 flex flex-col gap-3.5 bg-[var(--color-surface)]">
                  {/* Step 1: Target Header with Immediate Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-[var(--color-border)]/60">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border tracking-tight shrink-0 ${methodBadgeClass}`}>
                        {ep.method}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
                        {ep.path}
                      </span>
                      <span className="text-[var(--color-text-muted)]">/</span>
                      <span className="text-xs font-medium text-[var(--color-text)]">
                        {sc.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono shrink-0">
                      {sourceFile && (
                        <span className="text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] px-2 py-0.5 rounded border border-[var(--color-border)]">
                          {sourceFile}{sourceLine ? `:${sourceLine}` : ""}{sourceCol ? `:${sourceCol}` : ""}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onRetryScenario(ep, sc)}
                        disabled={isJobActive || pendingAction === "RUN_REMAINING"}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25 hover:bg-rose-500/20 transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <RefreshCw size={10} />
                        <span>Retry Scenario</span>
                      </button>
                      {onAIFixScenario && (
                        <button
                          type="button"
                          onClick={() => onAIFixScenario(ep, sc)}
                          disabled={isJobActive || pendingAction === "RUN_REMAINING"}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/25 hover:bg-purple-500/20 transition-colors cursor-pointer flex items-center gap-1"
                          title="Sửa kịch bản bằng AI"
                        >
                          <Sparkles size={10} />
                          <span>Sửa bằng AI</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRunEndpoint(ep)}
                        disabled={isJobActive || pendingAction === "RUN_REMAINING"}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-secondary)]/80 transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <Play size={10} fill="currentColor" />
                        <span>Run Endpoint</span>
                      </button>
                    </div>
                  </div>

                  {/* Core Diagnostic Summary: Expected vs. Actual Behavior */}
                  <div className="p-3.5 rounded border border-rose-500/20 bg-rose-500/5 flex flex-col gap-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-danger)] flex items-center gap-1.5">
                        <AlertTriangle size={13} />
                        <span>Diagnostic Finding: Expected vs. Actual Behavior</span>
                      </span>
                      <span className="text-[9px] font-mono text-[var(--color-text-muted)] uppercase">
                        Evidence: {sc.evidenceSource || "TEST_SERVER_HTTP_RESPONSE"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <div className="text-[10px] text-[var(--color-text-secondary)] mb-0.5">Expected Behavior:</div>
                        <div className="font-mono font-bold text-xs text-[var(--color-success)]">
                          {sc.classification === "TEST_SCRIPT_ERROR"
                            ? "Test Script Execution"
                            : expectedHttp
                              ? `HTTP ${expectedHttp}`
                              : "Error Status (400 or 500)"}
                        </div>
                        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                          {sc.classification === "TEST_SCRIPT_ERROR"
                            ? "Runner should execute test suite without syntax or harness errors."
                            : "Test asserted backend must reject invalid input with 4xx/5xx status."}
                        </div>
                      </div>

                      <div className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <div className="text-[10px] text-[var(--color-text-secondary)] mb-0.5">Actual Server Response:</div>
                        <div className={`font-mono font-bold text-xs ${sc.classification === "TEST_SCRIPT_ERROR" ? "text-rose-400" : actualHttp === 200 ? "text-amber-400" : "text-[var(--color-danger)]"}`}>
                          {sc.classification === "TEST_SCRIPT_ERROR"
                            ? "RUNNER_CRASH_BEFORE_HTTP"
                            : actualHttp !== null
                              ? `HTTP ${actualHttp} ${actualHttp === 200 ? "OK" : ""}`
                              : "NOT_CAPTURED"}
                        </div>
                        <div className="text-[10px] text-amber-400/90 mt-1">
                          {sc.classification === "TEST_SCRIPT_ERROR"
                            ? "Jest runner caught runtime exception prior to completing HTTP request."
                            : actualHttp === 200
                              ? "Server accepted invalid payload without validation rejection."
                              : "Response status code mismatched expected assertion range."}
                        </div>
                      </div>
                    </div>

                    {/* Assertion Failure & Code Location */}
                    <div className="mt-1 pt-2 border-t border-[var(--color-border)]/60">
                      <div className="text-[10px] font-semibold text-[var(--color-text-secondary)] mb-1">
                        Assertion Failure: <span className="font-mono text-[var(--color-text)]">{failDetails.headline || "expect(received).toContain(expected)"}</span>
                      </div>
                      {failDetails.brokenLineText ? (
                        <pre className="p-2 rounded bg-[var(--color-surface)] border border-rose-500/20 font-mono text-[11px] text-[var(--color-danger)] overflow-x-auto whitespace-pre-wrap">
                          {failDetails.brokenLineText}
                        </pre>
                      ) : (
                        <div className="text-[11px] text-[var(--color-text-secondary)]">
                          Failed assertion at <code>{sourceFile || "test"}:{sourceLine || 13}</code>: response status (<code>{actualHttp || 200}</code>) is not contained in expected error status range <code>[400, 500]</code>.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progressive Disclosure: Request Payload & Headers */}
                  <details className="text-xs group border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-surface)]">
                    <summary className="px-3.5 py-2 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer select-none flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Code2 size={13} className="text-[var(--color-primary)]" />
                        <span>Request Context & Payload Sent ({ep.method} {sc.resolvedUrl || ep.path})</span>
                      </span>
                      <span className="text-[10px] font-mono text-[var(--color-text-muted)] group-open:rotate-180 transition-transform">
                        ▼
                      </span>
                    </summary>
                    <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 flex flex-col gap-2">
                      {sc.requestPayload && Object.keys(sc.requestPayload).length > 0 ? (
                        <div>
                          <div className="text-[10px] text-[var(--color-text-secondary)] mb-1">Body Payload:</div>
                          <pre className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-[11px] text-[var(--color-text)] overflow-x-auto max-h-32 custom-scrollbar">
                            {JSON.stringify(sc.requestPayload, null, 2)}
                          </pre>
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--color-text-muted)] italic py-1">
                          {ep.method === "GET" ? "GET request carries no body payload." : "Empty body payload: {}"}
                        </div>
                      )}
                      {sc.queryParams && (
                        <div className="text-[10px] text-[var(--color-text-muted)] font-mono">
                          Query Parameters: {JSON.stringify(sc.queryParams)}
                        </div>
                      )}
                    </div>
                  </details>

                  {/* Progressive Disclosure: Raw Runner Output and Stack Trace */}
                  <details className="text-xs group border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-surface)]">
                    <summary className="px-3.5 py-2 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer select-none flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <FileText size={13} />
                        <span>Raw Runner Output & Stack Trace</span>
                      </span>
                      <span className="text-[10px] font-mono text-[var(--color-text-muted)] group-open:rotate-180 transition-transform">
                        ▼
                      </span>
                    </summary>
                    <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50">
                      <pre className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-[10px] text-rose-400 overflow-x-auto max-h-56 leading-relaxed custom-scrollbar whitespace-pre-wrap">
                        {rawMessage}
                      </pre>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Grouped Endpoint Execution Results */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
              Endpoint Test Results ({endpoints.length} endpoints)
            </h4>
            <p className="text-[11px] text-[var(--color-text-secondary)] m-0 mt-0.5">
              Passing endpoints collapsed by default; click to expand scenario execution records
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const all = {};
                endpoints.forEach((ep) => { all[`${ep.method} ${ep.path}`] = true; });
                setExpandedEndpoints(all);
              }}
              className="text-[11px] text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              Expand All
            </button>
            <span className="text-[var(--color-text-muted)]">|</span>
            <button
              type="button"
              onClick={() => setExpandedEndpoints({})}
              className="text-[11px] text-[var(--color-text-secondary)] hover:underline cursor-pointer"
            >
              Collapse All
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {endpoints.map((ep) => {
            const epKey = `${ep.method} ${ep.path}`;
            const isExpanded = Boolean(expandedEndpoints[epKey]);
            const isTested = ep.executedCount > 0;
            const hasFailure = (ep.scenarios || []).some((s) => s.status === "failed" || s.rawJestStatus === "failed");
            const methodBadgeClass = getMethodBadgeClass(ep.method);

            return (
              <div
                key={epKey}
                className={`border rounded-[var(--radius-md)] bg-[var(--color-surface)] shadow-xs transition-colors ${
                  hasFailure ? "border-rose-500/30" : "border-[var(--color-border)]"
                }`}
              >
                {/* Endpoint Header Row */}
                <div
                  onClick={() => toggleEndpoint(epKey)}
                  className={`px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                    isExpanded
                      ? "bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] rounded-t-[var(--radius-md)]"
                      : "hover:bg-[var(--color-surface-secondary)]/40 rounded-[var(--radius-md)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border tracking-tight shrink-0 ${methodBadgeClass}`}>
                      {ep.method}
                    </span>
                    <span className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={ep.path}>
                      {ep.path}
                    </span>
                    {ep.source?.controllerMethod && (
                      <span className="text-[11px] text-[var(--color-text-muted)] truncate hidden md:inline">
                        → {ep.source.controllerMethod}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    {/* Latency */}
                    {isTested && ep.avgDurationMs > 0 && (
                      <span className="font-mono text-[11px] text-[var(--color-text-muted)] flex items-center gap-1">
                        <Clock size={11} />
                        <span>{ep.avgDurationMs}ms</span>
                      </span>
                    )}

                    {/* Status Pill */}
                    {hasFailure ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25">
                        Fail ({ep.failedCount || 1}/{ep.executedCount || ep.scenarios?.length || 1})
                      </span>
                    ) : isTested ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25">
                        Passed ({ep.passedCount}/{ep.executedCount})
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                        Not Executed
                      </span>
                    )}

                    {/* Action: Run this Endpoint */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRunEndpoint(ep);
                      }}
                      disabled={isJobActive || pendingAction === "RUN_REMAINING"}
                      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] border border-transparent hover:border-[var(--color-border)] transition-colors cursor-pointer"
                      title="Run tests for this endpoint only"
                    >
                      <Play size={12} fill="currentColor" />
                    </button>
                  </div>
                </div>

                {/* Scenarios List (Compact Table Rows) */}
                {isExpanded && (
                  <div className="divide-y divide-[var(--color-border)]/60 rounded-b-[var(--radius-md)]">
                    {ep.scenarios && ep.scenarios.length > 0 ? (
                      ep.scenarios.map((sc, scIdx) => {
                        const scKey = `${ep.method}-${ep.path}-${sc.title}-${scIdx}`;
                        const isFailed = sc.status === "failed" || sc.rawJestStatus === "failed";
                        const isScenarioExpanded = Boolean(expandedScenarios[scKey]);

                        return (
                          <div key={scIdx} className="flex flex-col">
                            <div
                              onClick={() => toggleScenario(scKey)}
                              className={`px-3.5 py-2 flex items-center justify-between gap-3 text-xs cursor-pointer transition-colors ${
                                isFailed
                                  ? "bg-rose-500/5 hover:bg-rose-500/10"
                                  : "hover:bg-[var(--color-surface-secondary)]/40"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className={`font-bold ${isFailed ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
                                  {isFailed ? "✗" : "✓"}
                                </span>
                                <span className={`truncate ${isFailed ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-text)]"}`} title={sc.title}>
                                  {sc.title}
                                </span>
                                <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] shrink-0">
                                  {sc.category || sc.scenarioType || "Scenario"}
                                </span>
                              </div>

                              <div className="flex items-center gap-3 shrink-0 text-xs">
                                {sc.durationMs > 0 && (
                                  <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                                    {sc.durationMs}ms
                                  </span>
                                )}
                                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                                  isFailed
                                    ? "text-[var(--color-danger)] border-rose-500/30 bg-rose-500/10"
                                    : "text-[var(--color-success)] border-emerald-500/30 bg-emerald-500/10"
                                }`}>
                                  {isFailed ? "FAIL" : "PASS"}
                                </span>
                                {isFailed && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRetryScenario(ep, sc);
                                    }}
                                    disabled={isJobActive || pendingAction === "RUN_REMAINING"}
                                    className="p-1 rounded text-rose-400 hover:text-[var(--color-danger)] hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors cursor-pointer"
                                    title="Retry this scenario"
                                  >
                                    <RefreshCw size={11} />
                                  </button>
                                )}
                                <span className="text-[var(--color-text-muted)]">
                                  {isScenarioExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                </span>
                              </div>
                            </div>

                            {/* Expanded Details on Click */}
                            {isScenarioExpanded && (
                              <div className="px-4 py-3 bg-[var(--color-surface-secondary)]/30 border-t border-[var(--color-border)]/60 text-xs flex flex-col gap-2.5">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <div className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] mb-1">Request Details</div>
                                    <div className="font-mono text-[11px] text-[var(--color-text)]">
                                      {ep.method} {sc.resolvedUrl || ep.path}
                                    </div>
                                    {sc.requestPayload && (
                                      <pre className="p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-[10px] text-[var(--color-text)] overflow-x-auto max-h-24 mt-1">
                                        {JSON.stringify(sc.requestPayload, null, 2)}
                                      </pre>
                                    )}
                                  </div>

                                  <div>
                                    <div className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] mb-1">Execution Evidence</div>
                                    <div className="flex flex-col gap-1 text-[11px]">
                                      <div className="flex justify-between">
                                        <span className="text-[var(--color-text-secondary)]">Server Response:</span>
                                        <span className="font-mono font-semibold text-[var(--color-text)]">
                                          {sc.actualStatus ? `HTTP ${sc.actualStatus}` : sc.actualStatusFromRuntime ? `HTTP ${sc.actualStatusFromRuntime}` : "Not captured"}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-[var(--color-text-secondary)]">QA Classification:</span>
                                        <span className="font-mono text-[var(--color-text)]">
                                          {sc.classification || "PASSED"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {isFailed && sc.failureDetails && (
                                  <div className="mt-1">
                                    <div className="text-[10px] uppercase font-bold text-[var(--color-danger)] mb-1">Failure Assertion</div>
                                    <pre className="p-2 rounded bg-rose-500/10 border border-rose-500/20 font-mono text-[10px] text-rose-400 overflow-x-auto whitespace-pre-wrap">
                                      {sc.failureDetails.headline}
                                      {sc.failureDetails.brokenLineText ? `\n> ${sc.failureDetails.brokenLineText}` : ""}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-3 text-xs text-[var(--color-text-muted)] italic">
                        No scenarios executed for this endpoint in recent test run.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Collapsible QA Evidence & Quality Classification Section */}
      {summary?.qualityClassification && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] overflow-hidden shadow-xs">
          <div
            onClick={() => setQaEvidenceOpen(!qaEvidenceOpen)}
            className="px-4 py-3 bg-[var(--color-surface-secondary)]/40 flex items-center justify-between cursor-pointer select-none hover:bg-[var(--color-surface-secondary)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-[var(--color-primary)]" />
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
                  QA Trustworthy Quality Evidence
                </h4>
                <p className="text-[11px] text-[var(--color-text-secondary)] m-0 mt-0.5">
                  Distinguishes raw runner execution passes from independent API contract verification
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                Valid Scenarios Executed: <strong className="text-[var(--color-primary)] font-semibold">{summary.qualityClassification.validExecuted}</strong> / {summary.qualityClassification.total}
              </span>
              <span className="text-[var(--color-text-muted)]">
                {qaEvidenceOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </div>
          </div>

          {qaEvidenceOpen && (
            <div className="p-4 border-t border-[var(--color-border)] flex flex-col gap-4 text-xs">
              <div className="p-3 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] text-[11px] text-[var(--color-text-secondary)] leading-relaxed flex items-start gap-2">
                <Info size={14} className="text-[var(--color-info)] shrink-0 mt-0.5" />
                <div>
                  <strong>Runner Pass vs. QA Contract Verification:</strong> A test may pass in Jest if it asserts HTTP 500 for invalid inputs, but QA marks it as <em className="text-amber-400">Contract Unverified</em> if no OpenAPI/Swagger specification defines a 500 status. A runner assertion pass does not automatically guarantee API contract correctness. Missing contract documentation means unverified, not automatically failed.
                </div>
              </div>

              {/* Compact KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <div className="p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5">
                  <div className="text-[10px] font-bold text-[var(--color-success)] uppercase">Runner Passed</div>
                  <div className="text-sm font-bold font-mono text-[var(--color-text)] mt-1">{summary.qualityClassification.passed}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5 leading-tight">Passed assertion checks</div>
                </div>

                <div className="p-2.5 rounded border border-sky-500/20 bg-sky-500/5">
                  <div className="text-[10px] font-bold text-sky-400 uppercase">Consistent</div>
                  <div className="text-sm font-bold font-mono text-[var(--color-text)] mt-1">{summary.qualityClassification.implementationConsistent ?? summary.qualityClassification.passed}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5 leading-tight">Matches codebase logic</div>
                </div>

                <div className={`p-2.5 rounded border ${summary.qualityClassification.assertionFailures > 0 ? "border-rose-500/30 bg-rose-500/10" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
                  <div className={`text-[10px] font-bold uppercase ${summary.qualityClassification.assertionFailures > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}>Assertion Failures</div>
                  <div className={`text-sm font-bold font-mono mt-1 ${summary.qualityClassification.assertionFailures > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}>{summary.qualityClassification.assertionFailures}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5 leading-tight">Unexpected response from server</div>
                </div>

                <div className="p-2.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <div className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">Test-Script Errors</div>
                  <div className="text-sm font-bold font-mono text-[var(--color-text-muted)] mt-1">{summary.qualityClassification.testScriptErrors}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5 leading-tight">Syntax or mock errors</div>
                </div>

                <div className="p-2.5 rounded border border-amber-500/20 bg-amber-500/5">
                  <div className="text-[10px] font-bold text-amber-400 uppercase">Contract Unverified</div>
                  <div className="text-sm font-bold font-mono text-amber-400 mt-1">{summary.qualityClassification.contractUnverified || 0}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5 leading-tight">Lacking formal contract spec</div>
                </div>

                <div className="p-2.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <div className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">Contract Verified</div>
                  <div className="text-sm font-bold font-mono text-[var(--color-text-muted)] mt-1">{summary.qualityClassification.contractVerified || 0}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5 leading-tight">Verified by OpenAPI/Swagger</div>
                </div>
              </div>

              {/* Audited Metric Definitions Table */}
              <div className="border border-[var(--color-border)] rounded-[var(--radius-sm)] overflow-hidden">
                <div className="px-3 py-2 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text)]">
                    Audited Quality Classification Logic & Evidence Traceability
                  </span>
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                    Every metric defined with numerator, denominator, and source evidence
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                        <th className="py-2 px-3">Metric Name</th>
                        <th className="py-2 px-3">Value / Rate</th>
                        <th className="py-2 px-3">Formula & Denominator</th>
                        <th className="py-2 px-3">Source Evidence</th>
                        <th className="py-2 px-3">Defensible QA Meaning</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)] font-mono">
                      <tr className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                        <td className="py-2 px-3 font-semibold text-[var(--color-text)]">Runner Pass Rate</td>
                        <td className="py-2 px-3 text-[var(--color-success)]">{passRate}% ({passed}/{executed})</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Passed Scenarios / Total Executed</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Jest/Supertest runner exit status</td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] font-sans text-[10px]">Technical assertion passes. Does not imply API contract validity.</td>
                      </tr>
                      <tr className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                        <td className="py-2 px-3 font-semibold text-[var(--color-text)]">Implementation Consistent</td>
                        <td className="py-2 px-3 text-sky-400">{summary.qualityClassification.implementationConsistent ?? passed} / {summary.qualityClassification.total}</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Consistent Passed / Total Scenarios</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Route AST + Controller handler</td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] font-sans text-[10px]">Passes aligning with discovered Express route logic.</td>
                      </tr>
                      <tr className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                        <td className="py-2 px-3 font-semibold text-[var(--color-text)]">Contract Verified</td>
                        <td className="py-2 px-3 text-[var(--color-text)]">{summary.qualityClassification.contractVerified || 0} / {summary.qualityClassification.total}</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Verified Scenarios / Total Scenarios</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">OpenAPI/Swagger documentation</td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] font-sans text-[10px]">Independently corroborated against formal API documentation.</td>
                      </tr>
                      <tr className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                        <td className="py-2 px-3 font-semibold text-amber-400">Contract Unverified</td>
                        <td className="py-2 px-3 text-amber-400">{summary.qualityClassification.contractUnverified || 0} / {summary.qualityClassification.total}</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Catch-all 500s / Total Scenarios</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Missing documentation in contract</td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] font-sans text-[10px]"><strong>Unverified, NOT failed:</strong> Missing contract documentation means unverified, not broken.</td>
                      </tr>
                      <tr className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                        <td className="py-2 px-3 font-semibold text-[var(--color-danger)]">Assertion Failures</td>
                        <td className="py-2 px-3 text-[var(--color-danger)]">{summary.qualityClassification.assertionFailures} / {executed}</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Violated Assertions / Total Executed</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Supertest HTTP response mismatch</td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] font-sans text-[10px]">Server returned status or body contrary to test specification.</td>
                      </tr>
                      <tr className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                        <td className="py-2 px-3 font-semibold text-[var(--color-text-secondary)]">Test-Script Errors</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">{summary.qualityClassification.testScriptErrors} / {summary.qualityClassification.total}</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Script Errors / Total Scenarios</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Jest runner syntax/mock crash</td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] font-sans text-[10px]">Defect in test harness or test script, not the server under test.</td>
                      </tr>
                      <tr className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                        <td className="py-2 px-3 font-semibold text-[var(--color-text-secondary)]">Invalid Tests</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">{summary.qualityClassification.invalidTests || 0} / {summary.qualityClassification.total}</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">Malformed Tests / Total Scenarios</td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">AST static schema validation</td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] font-sans text-[10px]">Scenario itself contains contradictory parameters or malformed assertions.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Code Coverage Section */}
      {summary?.codeCoverage && (
        <div className="border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] overflow-hidden shadow-xs">
          <div
            onClick={() => setCoverageOpen(!coverageOpen)}
            className="px-4 py-3 bg-[var(--color-surface-secondary)]/40 flex items-center justify-between cursor-pointer select-none hover:bg-[var(--color-surface-secondary)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-[var(--color-info)]" />
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
                  Integration Code Coverage
                </h4>
                <p className="text-[11px] text-[var(--color-text-secondary)] m-0 mt-0.5">
                  Istanbul/Jest collected statement, branch, function, and line coverage
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                Lines: <strong className="text-[var(--color-success)] font-semibold">{Number(summary.codeCoverage.line || 0).toFixed(1)}%</strong>
              </span>
              <span className="text-[var(--color-text-muted)]">
                {coverageOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </div>
          </div>

          {coverageOpen && (
            <div className="p-4 border-t border-[var(--color-border)] flex flex-col gap-4 text-xs font-mono">
              {/* Aggregate KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Statements", val: summary.codeCoverage.statement },
                  { label: "Branches", val: summary.codeCoverage.branch },
                  { label: "Functions", val: summary.codeCoverage.function },
                  { label: "Lines", val: summary.codeCoverage.line },
                ].map(({ label, val }) => {
                  const num = Number(val || 0);
                  const color = num >= 80 ? "text-[var(--color-success)]" : num > 0 ? "text-amber-400" : "text-[var(--color-danger)]";
                  return (
                    <div key={label} className="p-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30">
                      <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] mb-1">{label}</div>
                      <div className={`text-lg font-bold ${color}`}>{num.toFixed(1)}%</div>
                    </div>
                  );
                })}
              </div>

              {/* File-Level Drill-Down Table */}
              {summary?.fileCoverages && summary.fileCoverages.length > 0 ? (
                <div className="border border-[var(--color-border)] rounded-[var(--radius-sm)] overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text)]">
                      File-Level Coverage Artifacts ({summary.fileCoverages.length} files)
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                      Evidence from Istanbul coverage collector
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                          <th className="py-2 px-3">Source File</th>
                          <th className="py-2 px-3">Statements</th>
                          <th className="py-2 px-3">Branches</th>
                          <th className="py-2 px-3">Functions</th>
                          <th className="py-2 px-3">Lines</th>
                          <th className="py-2 px-3">Mapped Endpoints</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)] font-mono">
                        {summary.fileCoverages.map((fc, idx) => {
                          const linked = endpoints.filter((ep) => 
                            ep.sourceFile === fc.filePath || 
                            (fc.filePath && ep.sourceFile && (fc.filePath.endsWith(ep.sourceFile) || ep.sourceFile.endsWith(fc.filePath)))
                          );
                          const lineNum = Number(fc.line || 0);
                          const lineCol = lineNum >= 80 ? "text-[var(--color-success)]" : lineNum >= 50 ? "text-amber-400" : "text-[var(--color-danger)]";
                          
                          // Format clean relative path: e.g. server/controllers/cartController.js
                          const parts = (fc.filePath || "").split(/[\\/]/);
                          const serverIdx = parts.lastIndexOf("server");
                          const displayPath = serverIdx !== -1 
                            ? parts.slice(serverIdx).join("/") 
                            : parts.length > 3 ? parts.slice(-3).join("/") : fc.filePath;

                          return (
                            <tr key={idx} className="hover:bg-[var(--color-surface-secondary)]/20 transition-colors">
                              <td className="py-2 px-3 font-medium text-[var(--color-text)] max-w-[220px] truncate" title={fc.filePath}>
                                {displayPath}
                              </td>
                              <td className="py-2 px-3">{Number(fc.statement || 0).toFixed(1)}%</td>
                              <td className="py-2 px-3">{Number(fc.branch || 0).toFixed(1)}%</td>
                              <td className="py-2 px-3">{Number(fc.function || 0).toFixed(1)}%</td>
                              <td className={`py-2 px-3 font-bold ${lineCol}`}>{lineNum.toFixed(1)}%</td>
                              <td className="py-2 px-3 text-[10px]">
                                {linked.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {linked.map((lep) => (
                                      <span key={`${lep.method}-${lep.path}`} className="px-1 py-0.2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                                        {lep.method} {lep.path}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-[var(--color-text-muted)] italic">No direct route mapped</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded bg-[var(--color-surface-secondary)]/30 border border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] italic">
                  File-level coverage artifacts were not emitted for this run. Run tests with coverage collection enabled to inspect individual file and branch coverage.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
