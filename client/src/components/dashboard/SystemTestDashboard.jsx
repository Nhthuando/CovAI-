import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  RotateCcw,
  Printer,
  AlertCircle,
  Loader2,
  Layers,
} from "lucide-react";
import { io } from "socket.io-client";
import { getJobDetailApi } from "../../services/job.service.js";
import Button from "../common/Button.jsx";
import SystemTestMetricsCards from "./system/SystemTestMetricsCards.jsx";
import SystemTestZeroStateBanner from "./system/SystemTestZeroStateBanner.jsx";
import SystemTestScenarioList from "./system/SystemTestScenarioList.jsx";
import SystemTestBreakpointModal from "./system/SystemTestBreakpointModal.jsx";
import SystemTestGeneratorModal from "./system/SystemTestGeneratorModal.jsx";
import SystemTestEditorModal from "./system/SystemTestEditorModal.jsx";
import SystemTestReportView from "./system/SystemTestReportView.jsx";
import {
  getSystemTestFrameworks,
  runSystemTest,
  getSystemTestSummary,
  getSystemTestScenarios,
} from "../../services/systemTest.service.js";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

export default function SystemTestDashboard({ projectId, snapshotId, onOpenFile }) {
  // Current view: "dashboard" | "report"
  const [currentView, setCurrentView] = useState("dashboard");

  // Selected framework: "playwright" | "cypress"
  const [activeFramework, setActiveFramework] = useState("playwright");
  const [executionMode, setExecutionMode] = useState("frontend"); // "frontend" | "full"

  // Data states
  const [frameworksData, setFrameworksData] = useState(null);
  const [results, setResults] = useState(null);
  const selectionKey = [snapshotId, activeFramework, executionMode].join(':');
  const matchesSelection = results?.selectionKey === selectionKey;
  const summary = matchesSelection ? results.summary : null;
  const testFiles = matchesSelection ? results.testFiles : [];
  const modeLabel = executionMode === 'full' ? 'Full Stack' : 'Frontend Dev Server';

  // Loading & error states
  const [loading, setLoading] = useState(true);
  const [runningTests, setRunningTests] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Live job execution progress
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobSelection, setJobSelection] = useState(null);
  const [jobProgress, setJobProgress] = useState(null); // { progress: 0-100, stage: string, message: string }

  // Modals state
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [inspectedScenario, setInspectedScenario] = useState(null);
  const [editorTarget, setEditorTarget] = useState(null); // { filePath, scenarioId, initialMode }

  const socketRef = useRef(null);
  const activeJobRef = useRef(null);
  const frameworkDiscoveryRef = useRef(null);

  // Framework discovery is independent of the selected result mode.
  useEffect(() => {
    let ignore = false;
    if (projectId) getSystemTestFrameworks(projectId, snapshotId).then(response => {
      if (ignore) return;
      setFrameworksData(response?.data || null);
      const list = response?.data?.frameworks || [];
      const discoveryKey = `${projectId}:${snapshotId}`;
      if (frameworkDiscoveryRef.current !== discoveryKey) {
        frameworkDiscoveryRef.current = discoveryKey;
        if (list.some(f => f.name?.toLowerCase().includes('cypress')) && !list.some(f => f.name?.toLowerCase().includes('playwright'))) setActiveFramework('cypress');
      }
    }).catch(err => { if (!ignore) setError(err.message || 'Failed to load system test frameworks.'); });
    return () => { ignore = true; };
  }, [projectId, snapshotId, refreshKey]);

  // Pin scenarios to the same run as the summary, even if another job finishes mid-fetch.
  useEffect(() => {
    let ignore = false;
    async function loadResults() {
      try {
        if (!snapshotId) {
          if (!ignore) setResults({ selectionKey, summary: null, testFiles: [] });
          return;
        }
        const filters = { executionMode, runner: activeFramework };
        const sumRes = await getSystemTestSummary(snapshotId, filters);
        if (ignore) return;
        const selectedSummary = sumRes?.data || null;
        let files = [];
        if (selectedSummary?.hasRun && selectedSummary.testRunId) {
          const scRes = await getSystemTestScenarios(snapshotId, { ...filters, testRunId: selectedSummary.testRunId });
          files = scRes?.data?.testFiles || [];
        }
        if (!ignore) setResults({ selectionKey, summary: selectedSummary, testFiles: files });
      } catch (err) {
        if (!ignore) {
          setResults({ selectionKey, summary: null, testFiles: [] });
          setError(err.response?.data?.message || err.message || 'Failed to load system test results.');
        }
      } finally { if (!ignore) setLoading(false); }
    }
    loadResults();
    return () => { ignore = true; };
  }, [snapshotId, executionMode, activeFramework, selectionKey, refreshKey]);

  const selectResults = (mode, framework) => {
    setExecutionMode(mode);
    setActiveFramework(framework);
    setInspectedScenario(null);
    setEditorTarget(null);
    setError(null);
  };

  const refreshData = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const applyJobUpdate = useCallback((payload) => {
    if (!activeJobRef.current || payload.jobId !== activeJobRef.current) return;
    const status = payload.status;
    if (["FAILED", "CANCELED", "CANCELLED", "SUCCESS", "COMPLETED"].includes(status)) {
      activeJobRef.current = null;
      setRunningTests(false);
      setJobProgress(null);
      setActiveJobId(null);
      if (status === "FAILED") {
        setError(`System test job failed: ${payload.errorMessage || payload.message || "Execution error"}`);
      } else if (status === "CANCELED" || status === "CANCELLED") {
        setError("System test job was canceled.");
      }
      refreshData();
      return;
    }
    setJobProgress((previous) => ({
      progress: payload.progress ?? previous?.progress ?? 0,
      stage: payload.stage || previous?.stage || "Running",
      message: payload.message || previous?.message,
    }));
  }, [refreshData]);

  // Read persisted status as well as socket events, including after reconnects.
  useEffect(() => {
    if (!activeJobId) return;
    let ignore = false;
    let timer;
    const poll = async () => {
      try {
        const response = await getJobDetailApi(activeJobId);
        if (!ignore && response?.job) {
          applyJobUpdate({ ...response.job, jobId: response.job.id });
        }
      } catch (err) {
        if (!ignore) setError(`Unable to check system test status: ${err.message}`);
      }
      if (!ignore && activeJobRef.current === activeJobId) {
        timer = setTimeout(poll, 2000);
      }
    };
    poll();
    return () => { ignore = true; clearTimeout(timer); };
  }, [activeJobId, applyJobUpdate]);

  // Socket.IO for live progress
  useEffect(() => {
    if (!snapshotId) return;

    let token = localStorage.getItem("token");
    try {
      token ||= JSON.parse(localStorage.getItem("user") || "null")?.token;
    } catch {
      // ignore token parse error
    }

    const socket = io(SOCKET_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on("connect", () => {
      try {
        const userId = JSON.parse(atob(token.split(".")[1])).userId;
        if (userId) socket.emit("subscribe_notifications", userId);
      } catch {
        // The status API remains available if socket authentication fails.
      }
    });

    socket.on("job:progress", (payload) => {
      applyJobUpdate(payload);
    });

    return () => {
      socket.disconnect();
    };
  }, [snapshotId, applyJobUpdate]);

  // Run System Tests trigger
  const handleRunTests = async () => {
    if (!snapshotId) {
      setError("No active snapshot available to run system tests.");
      return;
    }

    setJobSelection({ executionMode, runner: activeFramework });
    setRunningTests(true);
    setError(null);
    setJobProgress({ progress: 5, stage: "Starting", message: "Queuing system test job..." });

    try {
      const res = await runSystemTest(snapshotId, {
        framework: activeFramework,
        executionMode,
      });

      if (res?.data?.jobId) {
        activeJobRef.current = res.data.jobId;
        setActiveJobId(res.data.jobId);
      } else {
        throw new Error("Server did not return a system test job ID.");
      }
    } catch (err) {
      setRunningTests(false);
      setJobProgress(null);
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to start system test execution."
      );
    }
  };

  const isZeroTestProject =
    frameworksData?.isZeroTestProject ||
    (frameworksData?.hasSystemTests === false && testFiles.length === 0);

  // If in Report View mode, render SystemTestReportView
  if (currentView === "report") {
    return (
      <SystemTestReportView
        summary={summary}
        testFiles={testFiles}
        snapshotId={snapshotId}
        onBack={() => setCurrentView("dashboard")}
      />
    );
  }

  return (
    <div className="w-full min-h-full bg-[var(--color-bg)] text-[var(--color-text)] font-sans p-4 sm:p-6 space-y-6">
      {/* Top Action Bar */}
      <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Framework Selector & Mode */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-medium">
            <button
              type="button"
              onClick={() => selectResults(executionMode, "playwright")}
              className={`px-3 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                activeFramework === "playwright"
                  ? "bg-[var(--color-primary)] text-white font-semibold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
            >
              Playwright
            </button>
            <button
              type="button"
              onClick={() => selectResults(executionMode, "cypress")}
              className={`px-3 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                activeFramework === "cypress"
                  ? "bg-[var(--color-primary)] text-white font-semibold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
            >
              Cypress
            </button>
          </div>

          <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
            <span className="text-[11px] font-medium">Mode:</span>
            <select
              value={executionMode}
              onChange={(e) => selectResults(e.target.value, activeFramework)}
              className="bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--color-text)] focus:outline-hidden focus:border-[var(--color-primary)]"
            >
              <option value="frontend">Frontend Dev Server</option>
              <option value="full">Full Stack (AUT + API)</option>
            </select>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
          <Button
            variant="secondary"
            size="sm"
            icon={Printer}
            onClick={() => setCurrentView("report")}
            disabled={loading || !matchesSelection || !summary?.hasRun}
            className="text-xs h-9"
          >
            Export / Print Report
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            onClick={refreshData}
            disabled={loading || !matchesSelection || runningTests}
            className="text-xs h-9"
            title="Refresh dashboard data"
          />

          <Button
            variant="primary"
            size="sm"
            icon={runningTests ? Loader2 : Play}
            loading={runningTests}
            disabled={loading || runningTests}
            onClick={handleRunTests}
            className="text-xs h-9 font-semibold"
          >
            {runningTests ? "Running System Tests..." : `Run ${modeLabel}`}
          </Button>
        </div>
      </div>

      {/* Real-time Progress Banner if running */}
      {runningTests && jobProgress && (
        <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 text-xs text-[var(--color-text)] space-y-2">
          <div className="flex items-center justify-between font-semibold">
            <div className="flex items-center gap-2">
              <Loader2 size={15} className="animate-spin text-[var(--color-primary)]" />
              <span>{`${jobSelection?.executionMode === "full" ? "Full Stack" : "Frontend Dev Server"} · ${jobSelection?.runner || activeFramework} · ${jobProgress.stage || "Executing system tests"}`}</span>
            </div>
            <span className="font-mono text-[var(--color-primary)]">
              {jobProgress.progress}%
            </span>
          </div>

          <div className="w-full bg-[var(--color-surface-secondary)] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[var(--color-primary)] h-full transition-all duration-300"
              style={{ width: `${jobProgress.progress}%` }}
            />
          </div>

          {jobProgress.message && (
            <div className="text-[11px] text-[var(--color-text-secondary)] font-mono truncate">
              {jobProgress.message}
            </div>
          )}
        </div>
      )}

      {/* Global Error Banner */}
      {error && (
        <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[var(--color-danger)] text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Zero Test Project Banner */}
      {isZeroTestProject && (
        <SystemTestZeroStateBanner
          framework={activeFramework}
          onOpenGenerator={() => setIsGeneratorOpen(true)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]" aria-live="polite">
        <span>Results: <strong className="text-[var(--color-text)]">{modeLabel} · {activeFramework === 'cypress' ? 'Cypress' : 'Playwright'}</strong></span>
        {summary?.latestRun?.finishedAt && <span>Last run: {new Date(summary.latestRun.finishedAt).toLocaleString()}</span>}
      </div>
      {(loading || !matchesSelection) ? (
        <div role="status" className="py-8 text-center text-sm text-[var(--color-text-muted)]">Loading {modeLabel} results…</div>
      ) : !summary?.hasRun ? (
        <div className="p-6 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-secondary)]">
          No {activeFramework === 'cypress' ? 'Cypress' : 'Playwright'} results for {modeLabel} yet. Run this mode to see its scenarios and evidence.
        </div>
      ) : <>
      {/* Metric Cards (Task 6.1) */}
      <SystemTestMetricsCards summary={summary} />

      {/* Scenarios Table & Breakpoint Explorer (Task 6.2) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-[var(--color-primary)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              System Test Scenarios & Spec Files
            </h3>
          </div>
          <span className="text-xs text-[var(--color-text-muted)] font-mono">
            {testFiles.length} {testFiles.length === 1 ? "spec file" : "spec files"} detected
          </span>
        </div>

        <SystemTestScenarioList
          snapshotId={snapshotId}
          testFiles={testFiles}
          onInspectBreakpoint={(scenario) => setInspectedScenario(scenario)}
          onOpenEditor={({ filePath, scenarioId, initialMode }) => {
            onOpenFile?.(filePath);
            setEditorTarget({
              filePath,
              scenarioId: scenarioId || null,
              initialMode: initialMode || null,
            });
          }}
        />
      </div>

      </>}

      {/* Breakpoint Inspection Modal */}
      {inspectedScenario && (
        <SystemTestBreakpointModal
          isOpen={!!inspectedScenario}
          onClose={() => setInspectedScenario(null)}
          scenario={inspectedScenario}
          snapshotId={snapshotId}
          onOpenEditor={({ filePath, scenarioId, initialMode }) => {
            setInspectedScenario(null);
            setEditorTarget({
              filePath,
              scenarioId,
              initialMode,
            });
          }}
        />
      )}

      {/* Cold-Start Test Generator Modal */}
      {isGeneratorOpen && (
        <SystemTestGeneratorModal
          isOpen={isGeneratorOpen}
          onClose={() => setIsGeneratorOpen(false)}
          snapshotId={snapshotId}
          initialFramework={activeFramework}
          onSuccess={() => {
            refreshData();
          }}
        />
      )}

      {/* In-Browser Test Editor Modal (Task 6.3) */}
      {editorTarget && (
        <SystemTestEditorModal
          isOpen={!!editorTarget}
          onClose={() => setEditorTarget(null)}
          snapshotId={snapshotId}
          filePath={editorTarget.filePath}
          scenarioId={editorTarget.scenarioId}
          initialMode={editorTarget.initialMode}
          framework={activeFramework}
          executionMode={executionMode}
          onSaved={() => {
            refreshData();
          }}
          onRunFinished={(result) => {
            if (result?.jobId) {
              setJobSelection({ executionMode, runner: activeFramework });
              setRunningTests(true);
              setJobProgress({ progress: 5, stage: 'Starting', message: 'Queuing single test file...' });
              activeJobRef.current = result.jobId;
              setActiveJobId(result.jobId);
            } else refreshData();
          }}
        />
      )}
    </div>
  );
}
