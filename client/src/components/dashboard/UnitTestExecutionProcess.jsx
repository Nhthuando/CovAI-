import { useState, useEffect, useMemo, useRef } from "react";
import {
  Terminal,
  Package,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  RotateCcw,
  Search,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  ListOrdered,
  Folder,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";
import { getProjectJobsApi, getJobDetailApi } from "../../services/job.service.js";

export default function UnitTestExecutionProcess({
  testSuites: discoveredSuites = [],
  executions = {},
  snapshotId,
  projectId,
  isLight = false,
  onOpenFile,
  onRunTests,
  running = false,
  runProgress = 0,
  runStep = "",
  rawTotals = null,
  summary = null,
  missingDependency = null,
  dependencyInstallError = "",
  dependencyInstallLogs = [],
  onInstallDependency = null,
  isInstallingDependency = false,
}) {
  // Inner tabs for the terminal console window: "terminal" | "pipeline" | "files"
  const [activeConsoleTab, setActiveConsoleTab] = useState("terminal");

  // Terminal Controls
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Raw logs & job state
  const [rawLogs, setRawLogs] = useState("");
  const [latestJob, setLatestJob] = useState(null);
  const [currentRunStartedAt, setCurrentRunStartedAt] = useState(() => running ? Date.now() : null);
  const [now, setNow] = useState(Date.now);
  const lastRunningProgress = useRef(null);
  useEffect(() => {
    setLatestJob(null);
    if (!running) return;
    setCurrentRunStartedAt(Date.now());
    lastRunningProgress.current = null;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, snapshotId]);
  useEffect(() => {
    if (running && runProgress > 0) lastRunningProgress.current = runProgress;
  }, [running, runProgress]);
  const [expandedFileId, setExpandedFileId] = useState(null);

  const terminalEndRef = useRef(null);

  // Extract raw test execution data from executions or testSuites
  const jestRun = executions?.jest;
  const vitestRun = executions?.vitest;


  const testSuites = useMemo(
    () => discoveredSuites.filter((suite) => suite.status === "passed" || suite.status === "failed"),
    [discoveredSuites],
  );

  // Global KPIs calculation
  const kpis = useMemo(() => {
    const totalSuites = testSuites.length;
    const passedSuites = testSuites.filter((s) => s.status === "passed" && (s.failedTests || 0) === 0).length;
    const failedSuites = testSuites.filter((s) => s.status === "failed" || (s.failedTests || 0) > 0).length;

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let totalDurationMs = 0;

    testSuites.forEach((s) => {
      totalTests += s.totalTests || (s.assertions?.length || 0);
      passedTests += s.passedTests || 0;
      failedTests += s.failedTests || 0;
      totalDurationMs += s.durationMs || 0;
    });

    if (totalTests === 0 && (jestRun || vitestRun)) {
      totalTests = (jestRun?.totalTests || 0) + (vitestRun?.totalTests || 0);
      passedTests = (jestRun?.passedTests || 0) + (vitestRun?.passedTests || 0);
      failedTests = (jestRun?.failedTests || 0) + (vitestRun?.failedTests || 0);
    }

    if (totalDurationMs === 0) {
      totalDurationMs = (jestRun?.durationMs || 0) + (vitestRun?.durationMs || 0);
    }

    const startedAt = latestJob?.startedAt || latestJob?.createdAt || (running ? currentRunStartedAt : null);
    const finishedAt = latestJob?.finishedAt || latestJob?.updatedAt;
    const jobDuration = startedAt && (running || finishedAt)
      ? Math.max(0, (running ? now : new Date(finishedAt).getTime()) - new Date(startedAt).getTime())
      : null;
    const durationMs = jobDuration ?? totalDurationMs;
    const durationSeconds = durationMs > 0 ? (durationMs / 1000).toFixed(2) : "—";
    const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 100;

    // Statement coverage
    const statPctRaw = rawTotals?.statements?.pct != null
      ? Number(rawTotals.statements.pct)
      : summary?.coverage?.statements != null
        ? Number(summary.coverage.statements)
        : (jestRun?.coverageStatementsPct || vitestRun?.coverageStatementsPct || 0);

    const statementPct = Number(statPctRaw).toFixed(1);

    return {
      totalSuites,
      passedSuites,
      failedSuites,
      totalTests,
      passedTests,
      failedTests,
      passRate,
      durationSeconds,
      statementPct,
    };
  }, [testSuites, jestRun, vitestRun, rawTotals, summary, latestJob, running, currentRunStartedAt, now]);

  const selectLatestJob = (jobs) => jobs.filter(j =>
    ["RUN_TESTS", "RUN_VITEST_TESTS", "ANALYSIS"].includes(j.type) &&
    (!snapshotId || j.snapshotId === snapshotId || !j.snapshotId) &&
    (!running || ["RUNNING", "PENDING", "QUEUED", "ACTIVE"].includes(j.status) ||
      new Date(j.startedAt || j.createdAt).getTime() >= currentRunStartedAt)
  ).sort((a, b) => new Date(b.startedAt || b.createdAt || 0) - new Date(a.startedAt || a.createdAt || 0))[0];

  // Fetch real job output/logs from server (manual refresh)
  const handleRefreshLogs = async () => {
    if (!projectId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const projJobs = await getProjectJobsApi(projectId).catch(() => ({ jobs: [] }));
      const jobs = projJobs?.jobs || [];
      const relevantJob = selectLatestJob(jobs);

      if (relevantJob?.id) {
        setLatestJob(relevantJob);
        const detail = await getJobDetailApi(relevantJob.id).catch(() => null);
        const jobData = detail?.job;
        if (jobData) {
          const out = jobData.output?.stdout || "";
          const err = jobData.output?.stderr || "";
          const fullText = [out, err].filter(Boolean).join("\n");
          setLatestJob((previous) => ({ ...previous, ...jobData }));
          setRawLogs(fullText);
        }
      }
    } catch (e) {
      console.warn("[UnitTestExecutionProcess] refresh logs error:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    if (!projectId) return;

    const fetchLatest = () => getProjectJobsApi(projectId)
      .then(async (projJobs) => {
        if (ignore) return;
        const jobs = projJobs?.jobs || [];
        const relevantJob = selectLatestJob(jobs);

        if (relevantJob?.id && !ignore) {
          setLatestJob(relevantJob);
          setRawLogs("");
          const detail = await getJobDetailApi(relevantJob.id).catch(() => null);
          const jobData = detail?.job;
          if (jobData && !ignore) {
            const out = jobData.output?.stdout || "";
            const err = jobData.output?.stderr || "";
            const fullText = [out, err].filter(Boolean).join("\n");
            setLatestJob((previous) => ({ ...previous, ...jobData }));
            setRawLogs(fullText);
          }
        }
      })
      .catch((e) => {
        console.warn("[UnitTestExecutionProcess] initial load error:", e);
      });
    fetchLatest();
    const timer = running ? setInterval(fetchLatest, 3000) : null;

    return () => {
      ignore = true;
      if (timer) clearInterval(timer);
    };
  }, [projectId, snapshotId, running, currentRunStartedAt]);

  // Auto-scroll terminal
  useEffect(() => {
    if (autoScroll && terminalEndRef.current && activeConsoleTab === "terminal") {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [rawLogs, dependencyInstallLogs, autoScroll, activeConsoleTab, running, runStep]);

  const formattedLogs = [rawLogs || "Waiting for test execution output...", ...dependencyInstallLogs,
    !dependencyInstallLogs.length && dependencyInstallError && `[ERROR] ${dependencyInstallError}`]
    .filter(Boolean).join("\n");

  // If live running, append live status line
  const displayedLogText = useMemo(() => {
    if (running && runStep) {
      return `${formattedLogs}\n\n[${new Date().toLocaleTimeString()}] ▶ [Step ${Math.min(5, Math.ceil(runProgress / 20))}/5] ${runStep} (${runProgress}%)`;
    }
    return formattedLogs;
  }, [formattedLogs, running, runStep, runProgress]);

  // Log lines with search filter applied
  const logLines = useMemo(() => {
    const all = displayedLogText.split("\n");
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((l) => l.toLowerCase().includes(q));
  }, [displayedLogText, searchQuery]);

  // Copy logs handler
  const handleCopyLogs = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(displayedLogText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Pipeline step definition
  const pipelineSteps = [
    {
      id: 1,
      name: "STEP 1",
      title: "Sandbox Env",
      subtext: "Docker / Host runtime init",
      threshold: 20,
    },
    {
      id: 2,
      name: "STEP 2",
      title: "Deps & Build",
      subtext: "Build & package validation",
      threshold: 40,
    },
    {
      id: 3,
      name: "STEP 3",
      title: "Test Discovery",
      subtext: "Scan Jest & Vitest specs",
      threshold: 60,
    },
    {
      id: 4,
      name: "STEP 4",
      title: "Runner Execution",
      subtext: "Execute assertions & tests",
      threshold: 85,
    },
    {
      id: 5,
      name: "STEP 5",
      title: "Coverage & Sync",
      subtext: "V8 AST & report aggregation",
      threshold: 100,
    },
  ];

  const jobStatus = latestJob?.status;
  const isSuccess = !running && jobStatus === "SUCCESS" && kpis.failedTests === 0;
  const getStepStatus = (stepIndex, threshold) => {
    if (!running && jobStatus === "SUCCESS") return "completed";
    const failed = !running && jobStatus === "FAILED";
    const progress = running ? runProgress : failed ? Math.min(latestJob?.progress ?? lastRunningProgress.current ?? 99, 99) : 0;
    if (progress >= threshold) return "completed";
    const previousThreshold = stepIndex === 1 ? 0 : pipelineSteps[stepIndex - 2].threshold;
    if (progress >= previousThreshold) {
      if (running) return "running";
      if (failed) return "failed";
    }
    return "pending";
  };

  // Render log line syntax styling
  const renderLogLine = (line, idx) => {
    const trimmed = line.trim();

    // FAIL line
    if (trimmed.startsWith("FAIL ")) {
      const rest = line.substring(line.indexOf("FAIL ") + 5);
      return (
        <div key={idx} style={{ color: "#f85149", fontWeight: 700, display: "flex", gap: 6 }}>
          <span style={{ background: "#f85149", color: "#0d1117", padding: "0 4px", borderRadius: 3, fontSize: 11 }}>FAIL</span>
          <span>{rest}</span>
        </div>
      );
    }

    // PASS line
    if (trimmed.startsWith("PASS ")) {
      const rest = line.substring(line.indexOf("PASS ") + 5);
      return (
        <div key={idx} style={{ color: "#3fb950", fontWeight: 650, display: "flex", gap: 6 }}>
          <span style={{ background: "#238636", color: "#ffffff", padding: "0 4px", borderRadius: 3, fontSize: 11, fontWeight: 800 }}>PASS</span>
          <span style={{ color: "#e6edf3" }}>{rest}</span>
        </div>
      );
    }

    // Red error indicator line: > 45 |
    if (trimmed.startsWith("> ") || trimmed.includes(" ^")) {
      return (
        <div key={idx} style={{ color: "#ff7b72", fontWeight: 600 }}>
          {line}
        </div>
      );
    }

    // Stack trace line: at Object...
    if (trimmed.startsWith("at ")) {
      return (
        <div key={idx} style={{ color: "#8b949e", paddingLeft: 12 }}>
          {line}
        </div>
      );
    }

    // Warning or caution line
    if (trimmed.startsWith("Force exiting Jest") || trimmed.includes("warning")) {
      return (
        <div key={idx} style={{ color: "#d29922" }}>
          {line}
        </div>
      );
    }

    // Test summary lines
    if (trimmed.startsWith("Test Suites:") || trimmed.startsWith("Tests:") || trimmed.startsWith("Time:")) {
      return (
        <div key={idx} style={{ color: "#f0f6fc", fontWeight: 700 }}>
          {line}
        </div>
      );
    }

    // Normal line
    return (
      <div key={idx} style={{ color: "#e6edf3" }}>
        {line || " "}
      </div>
    );
  };

  return (
    <div data-light={isLight ? "true" : "false"} className="flex flex-col gap-3.5">
      {/* ── 1. HEADER STATUS & ACTION BANNER ───────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
            {running ? (
              <Loader2 size={17} className="animate-spin text-[var(--color-primary)]" />
            ) : isSuccess ? (
              <CheckCircle2 size={17} className="text-emerald-500/75" />
            ) : (
              <XCircle size={17} className="text-rose-400/80" />
            )}
          </div>

          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-text)] tracking-tight">
                Unit Test Execution Process
              </span>

              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono border ${
                  running
                    ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border-strong)]"
                    : isSuccess
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                      : "bg-rose-500/[0.06] text-rose-300/85 border-rose-500/20"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    running
                      ? "bg-[var(--color-primary)]"
                      : isSuccess
                        ? "bg-emerald-500/65"
                        : "bg-rose-400/75"
                  }`}
                />
                {running ? `Running (${runProgress}%)` : isSuccess ? "Success (100%)" : jobStatus || "Not run"}
              </span>

              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] font-mono tabular-nums">
                <Clock size={12} />
                <span>{kpis.durationSeconds === "—" ? "—" : `${kpis.durationSeconds}s`}</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)] font-mono">
              <span>Engine: Vitest & Jest</span>
              <span>
                Started:{" "}
                {latestJob?.startedAt || latestJob?.createdAt || (running && currentRunStartedAt)
                  ? new Date(latestJob?.startedAt || latestJob?.createdAt || currentRunStartedAt).toLocaleTimeString()
                  : "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRefreshLogs}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh logs from backend"
          >
            <RotateCcw size={12} className={isRefreshing ? "animate-spin" : ""} />
            <span>Refresh Logs</span>
          </button>

          <button
            type="button"
            onClick={() => onRunTests && onRunTests({ restart: !!running })}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] transition-colors duration-150 active:scale-[0.98] cursor-pointer"
            title={running ? "Process is running. Click to restart test execution." : "Run unit tests and collect coverage."}
          >
            {running ? <RotateCcw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
            <span>{running ? "Re-run Unit Tests" : "Run Unit Tests"}</span>
          </button>
        </div>
      </div>

      {/* ── 2. EXECUTION PIPELINE (5 Steps) ────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--color-text)]">
            Execution pipeline
          </span>
          <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
            {running
              ? `In progress (${runProgress}%)`
              : jobStatus === "SUCCESS"
                ? "5/5 steps completed"
                : jobStatus === "FAILED"
                  ? "Execution failed"
                  : "Waiting for a run"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {pipelineSteps.map((step) => {
            const status = getStepStatus(step.id, step.threshold);
            const isCompleted = status === "completed";
            const isRunningStep = status === "running";

            return (
              <div
                key={step.id}
                className={`rounded-md border p-3 flex flex-col justify-between gap-2 transition-colors ${
                  isRunningStep
                    ? "bg-[var(--color-surface-secondary)] border-[var(--color-primary)]/50"
                    : "bg-[var(--color-bg)] border-[var(--color-border)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-medium text-[var(--color-text-muted)]">
                    {step.name}
                  </span>

                  {isCompleted ? (
                    <CheckCircle2 size={13} className="text-emerald-500/75 shrink-0" />
                  ) : isRunningStep ? (
                    <Loader2 size={13} className="animate-spin text-[var(--color-primary)] shrink-0" />
                  ) : status === "failed" ? (
                    <XCircle size={13} className="text-rose-400/80 shrink-0" aria-label="Failed" />
                  ) : (
                    <span className="w-3 h-3 rounded-full border border-[var(--color-border-strong)] shrink-0" />
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    {step.title}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                    {step.subtext}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 3. UNIFIED EXECUTION METRICS STRIP ─────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] overflow-hidden">
        <div className="px-4 py-3 flex flex-col justify-between gap-1">
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Executed test suites
          </span>
          <div className="text-xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {`${kpis.passedSuites}/${kpis.totalSuites || 0}`}
          </div>
          <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
            {`${kpis.passRate}% passed`}
          </span>
        </div>

        <div className="px-4 py-3 flex flex-col justify-between gap-1">
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Total assertions
          </span>
          <div className="text-xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {kpis.totalTests}
          </div>
          <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
            {kpis.failedTests > 0 ? `${kpis.failedTests} failed` : `${kpis.passedTests} passed`}
          </span>
        </div>

        <div className="px-4 py-3 flex flex-col justify-between gap-1">
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Execution duration
          </span>
          <div className="text-xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {kpis.durationSeconds === "—" ? "—" : `${kpis.durationSeconds}s`}
          </div>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            Runner elapsed time
          </span>
        </div>

        <div className="px-4 py-3 flex flex-col justify-between gap-1">
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Statement coverage
          </span>
          <div className="text-xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {`${kpis.statementPct}%`}
          </div>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            Measured statements
          </span>
        </div>
      </div>

      {/* ── 4. TERMINAL & EXECUTION CONSOLE WINDOW ─────────────────────── */}
      <div className="rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Window Title & Navigation Bar */}
        <div className="px-4 py-2.5 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
          {/* Inner Tabs */}
          <div className="flex items-center gap-1 rounded-md bg-[var(--color-bg)] p-0.5 border border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => setActiveConsoleTab("terminal")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeConsoleTab === "terminal"
                  ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
              }`}
            >
              <Terminal size={12} />
              <span>Terminal Output</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveConsoleTab("pipeline")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeConsoleTab === "pipeline"
                  ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
              }`}
            >
              <ListOrdered size={12} />
              <span>Pipeline Steps</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveConsoleTab("files")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeConsoleTab === "files"
                  ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
              }`}
            >
              <Folder size={12} />
              <span>{`Executed Test Files (${testSuites.length})`}</span>
            </button>
          </div>

          {/* Right: Search, Auto-scroll, Copy */}
          <div className="flex items-center gap-2">
            {activeConsoleTab === "terminal" && (
              <div className="relative flex items-center">
                <Search size={12} className="absolute left-2.5 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 pr-2.5 py-1 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] w-40 font-mono"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setAutoScroll((prev) => !prev)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                autoScroll
                  ? "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-primary)]/50"
                  : "bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]"
              }`}
              title="Toggle automatic scroll down"
            >
              Auto-scroll
            </button>

            <button
              type="button"
              onClick={handleCopyLogs}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--color-bg)] hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer"
              title="Copy terminal logs to clipboard"
            >
              {copied ? <Check size={12} className="text-emerald-500/75" /> : <Copy size={12} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>

        {/* ── Tab Content Area ── */}
        {activeConsoleTab === "terminal" ? (
          <>
            {missingDependency && (
              <div className="px-4 py-2.5 bg-rose-500/[0.06] border-b border-rose-500/20 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <Package size={14} className="text-rose-400/80 shrink-0" />
                  <span className="font-medium text-[var(--color-text)]">
                    Missing dependency: <code className="font-mono text-rose-300/90">{missingDependency.packageName}</code>
                  </span>
                  {missingDependency.importedFrom && (
                    <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                      ({missingDependency.importedFrom})
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onInstallDependency && onInstallDependency(missingDependency.packageName)}
                  disabled={isInstallingDependency}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isInstallingDependency ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Installing...</span>
                    </>
                  ) : (
                    <>
                      <Download size={12} />
                      <span>Install &apos;{missingDependency.packageName}&apos;</span>
                    </>
                  )}
                </button>
              </div>
            )}
            <div className="p-4 min-h-[360px] max-h-[500px] overflow-y-auto font-mono text-xs leading-relaxed bg-[#0c1017] text-[#e6edf3] break-words custom-scrollbar">
              {logLines.map((line, idx) => renderLogLine(line, idx))}
              <div ref={terminalEndRef} />
            </div>
          </>
        ) : activeConsoleTab === "pipeline" ? (
          <div className="p-4 min-h-[360px] max-h-[500px] overflow-y-auto bg-[var(--color-bg)] divide-y divide-[var(--color-border)] custom-scrollbar">
            {pipelineSteps.map((step) => {
              const status = getStepStatus(step.id, step.threshold);
              const isCompleted = status === "completed";
              const isRunningStep = status === "running";

              return (
                <div key={step.id} className="py-3 first:pt-1 last:pb-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      {isCompleted ? (
                        <CheckCircle2 size={15} className="text-emerald-500/75 shrink-0" />
                      ) : isRunningStep ? (
                        <Loader2 size={15} className="animate-spin text-[var(--color-primary)] shrink-0" />
                      ) : status === "failed" ? (
                        <XCircle size={15} className="text-rose-400/80 shrink-0" />
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border border-[var(--color-border-strong)] shrink-0" />
                      )}
                      <div>
                        <span className="text-xs font-semibold text-[var(--color-text)]">
                          {`${step.name}: ${step.title}`}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)] ml-2">
                          {step.subtext}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                        status === "failed"
                          ? "bg-rose-500/[0.06] text-rose-300/85 border-rose-500/20"
                          : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                      }`}
                    >
                      {isCompleted ? "Completed" : isRunningStep ? "Running" : status === "failed" ? "Failed" : "Pending"}
                    </span>
                  </div>

                  {isCompleted && (
                    <div className="pl-6 text-[11px] font-mono text-[var(--color-text-muted)]">
                      {step.id === 1 && "Docker runtime initialized, workspace isolation active."}
                      {step.id === 2 && "Node modules & Jest/Vitest dependencies validated."}
                      {step.id === 3 && `${testSuites.length} unit test suite specifications discovered.`}
                      {step.id === 4 && `Test assertions executed with ${kpis.durationSeconds}s runtime.`}
                      {step.id === 5 && `Coverage merged (${kpis.statementPct}% statements achieved).`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 min-h-[360px] max-h-[500px] overflow-y-auto bg-[var(--color-bg)] custom-scrollbar">
            {testSuites.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--color-text-muted)]">
                <Folder size={26} className="mx-auto mb-2 opacity-50" />
                <div>No executed test suite files detected.</div>
              </div>
            ) : (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)] overflow-hidden">
                {testSuites.map((suite, idx) => {
                  const isPass = suite.status === "passed" && (suite.failedTests || 0) === 0;
                  const durationSec = suite.durationMs ? (suite.durationMs / 1000).toFixed(3) : "—";
                  const cleanPath = cleanDisplayPath(suite.filePath);
                  const isExpanded = expandedFileId === suite.filePath;

                  return (
                    <div key={suite.id || `${suite.filePath || "suite"}-${idx}`}>
                      <div
                        onClick={() => setExpandedFileId(isExpanded ? null : suite.filePath)}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--color-surface-secondary)]/40 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono border shrink-0 ${
                              isPass
                                ? "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                                : "bg-rose-500/[0.06] text-rose-300/85 border-rose-500/20"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isPass ? "bg-emerald-500/65" : "bg-rose-400/75"
                              }`}
                            />
                            {isPass ? "PASS" : "FAIL"}
                          </span>
                          <span className="text-xs font-mono font-medium text-[var(--color-text)] truncate">
                            {cleanPath}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
                            {`${durationSec}s`}
                          </span>

                          {onOpenFile && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenFile(suite.filePath);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer"
                            >
                              <ExternalLink size={10} />
                              <span>Open</span>
                            </button>
                          )}

                          {isExpanded ? (
                            <ChevronDown size={13} className="text-[var(--color-text-muted)]" />
                          ) : (
                            <ChevronRight size={13} className="text-[var(--color-text-muted)]" />
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-4 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-bg)] text-xs">
                          {(suite.assertions || []).length === 0 ? (
                            <div className="text-[var(--color-text-muted)]">
                              No assertion details recorded for this file.
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {suite.assertions.map((a, aIdx) => (
                                <div key={aIdx} className="flex items-center gap-2 font-mono text-[11px]">
                                  <span
                                    className={
                                      a.status === "passed"
                                        ? "text-emerald-500/75"
                                        : "text-rose-400/80"
                                    }
                                  >
                                    {a.status === "passed" ? "✓" : "✗"}
                                  </span>
                                  <span className="text-[var(--color-text-secondary)]">{a.title}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
