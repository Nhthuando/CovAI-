import { useProjectAccess } from "../../hooks/useProjectAccess";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  RotateCcw,
  Printer,
  AlertCircle,
  Loader2,
  Layers,
  ShieldCheck,
  Activity,
  CheckCircle2,
  Monitor,
} from "lucide-react";
import { io } from "socket.io-client";
import { getJobDetailApi } from "../../services/job.service.js";
import Button from "../common/Button.jsx";
import SystemTestAssessmentPanel from "./system/SystemTestAssessmentPanel.jsx";
import SystemTestMetricsCards from "./system/SystemTestMetricsCards.jsx";
import SystemTestScenarioList from "./system/SystemTestScenarioList.jsx";
import SystemTestExecutionView from "./system/SystemTestExecutionView.jsx";
import SystemTestBreakpointModal from "./system/SystemTestBreakpointModal.jsx";
import SystemTestGeneratorModal from "./system/SystemTestGeneratorModal.jsx";
import SystemTestEditorModal from "./system/SystemTestEditorModal.jsx";
import SystemTestReportView from "./system/SystemTestReportView.jsx";
import SystemTestWorkflow from "./system/SystemTestWorkflow.jsx";
import SystemTestLiveRun from "./system/SystemTestLiveRun.jsx";
import {
  getSystemTestFrameworks,
  runSystemTest,
  getSystemTestSummary,
  getSystemTestScenarios,
  systemEvidenceRequest,
} from "../../services/systemTest.service.js";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

export default function SystemTestDashboard({ projectId, snapshotId, onOpenFile }) {
  const projectAccess = useProjectAccess(projectId);
  // Current view: "dashboard" | "report"
  const [currentView, setCurrentView] = useState("dashboard");
  const [resultView, setResultView] = useState("scenarios");

  // Sub-tabs: "coverage" | "scenarios" | "live" | "results"
  const [activeSubTab, setActiveSubTab] = useState("coverage");

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
  const [headedMode, setHeadedMode] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workflowReady, setWorkflowReady] = useState({ ready: false, blockers: [], scenarioIds: [], testFiles: [], selectedCount: 0 });

  // Live job execution progress
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobSelection, setJobSelection] = useState(null);
  const [jobProgress, setJobProgress] = useState(null); // { progress: 0-100, stage: string, message: string }

  // Modals state
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [inspectedScenario, setInspectedScenario] = useState(null);
  const [editorTarget, setEditorTarget] = useState(null); // { filePath, scenarioId, initialMode }
  const [activeAssessmentId, setActiveAssessmentId] = useState(null);
  const [latestAssessmentId, setLatestAssessmentId] = useState(null);

  const socketRef = useRef(null);
  const activeJobRef = useRef(null);
  const frameworkDiscoveryRef = useRef(null);

  // Restore the persisted measurement job after refresh instead of letting Run
  // submit another operation while an existing suite is still executing.
  useEffect(() => {
    let ignore = false;
    if (!snapshotId) return;
      systemEvidenceRequest(snapshotId, 'assessments').then(record => {
        if (record?.id) setLatestAssessmentId(record.id);
        if (ignore || !record?.jobId || !['QUEUED', 'RUNNING'].includes(record.status)) return;
        activeJobRef.current = record.jobId;
        setActiveJobId(record.jobId);
        if (record.id) setActiveAssessmentId(record.id);
        setRunningTests(true);
        setJobSelection({ executionMode: record.reportJson?.input?.executionMode || executionMode, runner: record.runner });
        setJobProgress({ progress: 0, stage: 'Resuming status', message: 'Checking the existing system test job...' });
      }).catch(() => { /* Ordinary runner still works when evidence is unavailable. */ });
    return () => { ignore = true; };
  }, [snapshotId, executionMode]);

  // Framework discovery is independent of the selected result mode.
  useEffect(() => {
    let ignore = false;
    if (projectId && snapshotId) getSystemTestFrameworks(projectId, snapshotId).then(response => {
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
          const stageLog = (response.job.logs || []).filter(log => log.message?.startsWith('Assessment stage: ')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
          applyJobUpdate({ ...response.job, jobId: response.job.id, ...(stageLog ? { stage: 'Measuring system tests', message: stageLog.message.slice('Assessment stage: '.length) } : response.job.type === 'SYSTEM_TEST_ASSESSMENT' ? { stage: 'Running system tests', message: 'Preparing application or executing tests. Open Job Queue for detailed logs.' } : {}) });
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

  const handleConfirmAllAndRun = async () => {
    if (!projectAccess.can("evidence.approve")) return;
    try {
      setError(null);
      setRunningTests(true);
      setActiveSubTab("live");
      setJobProgress({ progress: 10, stage: "Confirming", message: "Auto-confirming test expected outcomes..." });

      const catalogData = await systemEvidenceRequest(snapshotId, "catalog");
      const scenarios = catalogData?.scenarios || [];
      for (const row of scenarios) {
        if (!["EXPECTED_CONFIRMED", "REVIEWED"].includes(row.reviewState)) {
          let hash = row.scenarioHash;
          if (!row.expectedJson || !row.expectedJson.length) {
            await systemEvidenceRequest(snapshotId, `catalog/${row.id}`, {
              method: "PUT",
              data: {
                title: row.title,
                flow: row.flowJson || [],
                inputs: row.inputJson || [],
                expected: ["The asserted value is visible"],
                criterionIds: row.criterionIds || [],
                expectedScenarioHash: row.scenarioHash,
              },
            });
            const updated = await systemEvidenceRequest(snapshotId, "catalog");
            const target = (updated?.scenarios || []).find((s) => s.id === row.id);
            if (target) hash = target.scenarioHash;
          }
          await systemEvidenceRequest(snapshotId, `catalog/${row.id}/confirm-expected`, {
            method: "POST",
            data: { expectedScenarioHash: hash },
          });
        }
      }
      await handleRunTests();
    } catch (err) {
      setRunningTests(false);
      setJobProgress(null);
      setError(err.response?.data?.message || err.message || "Failed to auto-confirm scenarios.");
    }
  };

  // Run System Tests trigger
  const handleRunTests = async (onlyScenario = null, selectedScenarios = null) => {
    if (!projectAccess.can("tests.run")) return;
    if (!snapshotId) {
      setError("No active snapshot available to run system tests.");
      return;
    }

    setActiveSubTab("live");
    setJobSelection({ executionMode, runner: activeFramework });
    setRunningTests(true);
    setError(null);
    setJobProgress({ progress: 5, stage: "Starting", message: "Queuing system test job..." });

    try {
      const capabilities = activeFramework === 'playwright' ? await systemEvidenceRequest(snapshotId, 'capabilities') : null;
      const res = activeFramework === 'playwright' && capabilities?.enabled && capabilities.coverageEnabled
        ? await (async () => {
            const discovered = await systemEvidenceRequest(snapshotId, `discovery?executionMode=${executionMode}`);

            let scenarioIds = [];
            let selectedFiles = [];

            if (selectedScenarios && selectedScenarios.length > 0) {
              scenarioIds = selectedScenarios.map(s => s.id);
              selectedFiles = [...new Set(selectedScenarios.map(s => s.filePath))];
            } else if (onlyScenario) {
              scenarioIds = [onlyScenario.id];
              selectedFiles = [onlyScenario.filePath];
            } else if (workflowReady?.scenarioIds && workflowReady.scenarioIds.length > 0) {
              scenarioIds = workflowReady.scenarioIds;
              selectedFiles = workflowReady.testFiles || [];
            } else {
              // Safety net: fetch runnable scenarios directly from catalog
              const catalogData = await systemEvidenceRequest(snapshotId, 'catalog');
              const validScenarios = (catalogData?.scenarios || []).filter(s => s.filePath);
              if (validScenarios.length > 0) {
                scenarioIds = validScenarios.map(s => s.id);
                selectedFiles = [...new Set(validScenarios.map(s => s.filePath))];
              }
            }

            if (!scenarioIds.length) {
              throw new Error("Select at least one scenario to run.");
            }

            const query = new URLSearchParams({
              reviewMode: 'scenario',
              scenarioIds: scenarioIds.join(','),
              testFiles: selectedFiles.join(','),
            });
            let readiness = await systemEvidenceRequest(snapshotId, `readiness?${query}`);

            // If blocked only because expected outcomes need confirmation, auto-confirm and proceed
            if (!readiness.ready && readiness.blockers?.some(b => b.code === 'EXPECTED_UNCONFIRMED')) {
              try {
                const catalogData = await systemEvidenceRequest(snapshotId, 'catalog');
                const toConfirm = (catalogData?.scenarios || []).filter(
                  s => scenarioIds.includes(s.id) && !['EXPECTED_CONFIRMED', 'REVIEWED'].includes(s.reviewState)
                );
                for (const row of toConfirm) {
                  let hashToConfirm = row.scenarioHash;
                  if (!row.expectedJson?.length) {
                    await systemEvidenceRequest(snapshotId, `catalog/${row.id}`, {
                      method: 'PUT',
                      data: {
                        title: row.title,
                        flow: row.flowJson || [],
                        inputs: row.inputJson || [],
                        expected: ["The asserted value is visible"],
                        criterionIds: row.criterionIds || [],
                        expectedScenarioHash: row.scenarioHash,
                      },
                    });
                    const updatedCatalog = await systemEvidenceRequest(snapshotId, 'catalog');
                    const updatedRow = (updatedCatalog?.scenarios || []).find(s => s.id === row.id);
                    if (updatedRow) hashToConfirm = updatedRow.scenarioHash;
                  }
                  await systemEvidenceRequest(snapshotId, `catalog/${row.id}/confirm-expected`, {
                    method: 'POST',
                    data: { expectedScenarioHash: hashToConfirm }
                  });
                }
                readiness = await systemEvidenceRequest(snapshotId, `readiness?${query}`);
              } catch (confirmErr) {
                console.warn("Auto-confirm caught:", confirmErr);
              }
            }

            if (!readiness.ready) {
              throw new Error(readiness.blockers.map(blocker => blocker.message).join('; '));
            }

            const data = await systemEvidenceRequest(snapshotId, 'assessments', {
              method: 'POST',
              data: {
                ...discovered,
                testFiles: selectedFiles,
                reviewMode: 'scenario',
                scenarioIds,
                headed: headedMode,
              },
            });
            return { data };
          })()
        : await runSystemTest(snapshotId, {
            framework: activeFramework,
            executionMode,
            testFile: onlyScenario?.filePath || undefined,
          });

      setRefreshKey(value => value + 1);

      if (res?.data?.jobId) {
        activeJobRef.current = res.data.jobId;
        setActiveJobId(res.data.jobId);
        if (res?.data?.assessmentId) {
          setActiveAssessmentId(res.data.assessmentId);
          setLatestAssessmentId(res.data.assessmentId);
        }
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
        assessmentId={activeAssessmentId || latestAssessmentId || summary?.assessmentId}
        onBack={() => setCurrentView("dashboard")}
      />
    );
  }

  return (
    <div className="w-full min-h-full bg-[var(--color-bg)] text-[var(--color-text)] font-sans p-4 sm:p-6 space-y-6">
      <SystemTestMetricsCards summary={summary} />

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

          <button
            type="button"
            onClick={() => setHeadedMode(!headedMode)}
            className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-[var(--radius-md)] text-xs font-semibold border transition-all cursor-pointer ${
              headedMode
                ? "bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm"
                : "bg-slate-800/80 border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700/80"
            }`}
            title="When active, Playwright opens a visible Chrome browser window on your Windows desktop with slowed actions"
          >
            <Monitor size={14} className={headedMode ? "text-amber-400" : "text-slate-400"} />
            <span>Desktop Window: <strong className={headedMode ? "text-amber-300" : "text-slate-400"}>{headedMode ? "ON" : "OFF"}</strong></span>
          </button>

          <Button
            variant="primary"
            size="sm"
            icon={runningTests ? Loader2 : Play}
            loading={runningTests}
            disabled={!projectAccess.can("tests.run") || !snapshotId || loading || runningTests || (isZeroTestProject && !testFiles.length && !workflowReady?.scenarioIds?.length)}
            onClick={() => handleRunTests()}
            className="text-xs h-9 font-semibold"
          >
            {runningTests ? "Running System Tests..." : `Run Suite (${modeLabel})`}
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
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200 text-sm flex flex-wrap items-center justify-between gap-3 shadow-sm dark:shadow-lg backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <AlertCircle size={20} className="text-rose-500 dark:text-rose-400 shrink-0" />
            <span className="font-medium leading-relaxed">{error}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {error.includes("Confirm the expected outcome") && (
              <button
                type="button"
                disabled={!projectAccess.can("evidence.approve")} onClick={handleConfirmAllAndRun}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 size={14} />
                Confirm All &amp; Run Now
              </button>
            )}
            <button
              type="button"
              onClick={() => setError(null)}
              className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800/80 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Sub-Tab Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-sm">
          <button
            type="button"
            onClick={() => setActiveSubTab("coverage")}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              activeSubTab === "coverage"
                ? "bg-indigo-600 text-white shadow-md font-bold"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
            }`}
          >
            <ShieldCheck size={17} />
            <span>Coverage &amp; Quality</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
              activeSubTab === "coverage" ? "bg-white/20 text-white" : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"
            }`}>
              4 Dimensions
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("scenarios")}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              activeSubTab === "scenarios"
                ? "bg-indigo-600 text-white shadow-md font-bold"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
            }`}
          >
            <Layers size={17} />
            <span>Scenario Library</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
              activeSubTab === "scenarios" ? "bg-white/20 text-white" : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"
            }`}>
              Workflow &amp; Specs
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("live")}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              activeSubTab === "live"
                ? "bg-indigo-600 text-white shadow-md font-bold"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
            }`}
          >
            <Activity size={17} />
            <span>Live Execution</span>
            {(runningTests || activeJobId) && (
              <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500 font-mono font-bold animate-pulse">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                RUNNING
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("results")}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              activeSubTab === "results"
                ? "bg-indigo-600 text-white shadow-md font-bold"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
            }`}
          >
            <CheckCircle2 size={17} />
            <span>Test Results</span>
            {summary?.totalTests > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                activeSubTab === "results" ? "bg-white/20 text-white" : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"
              }`}>
                {summary.passedTests}/{summary.totalTests} passed
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
          <span>Engine: <strong className="text-[var(--color-text)]">{activeFramework === "cypress" ? "Cypress" : "Playwright"}</strong></span>
          {summary?.latestRun?.finishedAt && (
            <span>Last execution: <strong className="text-[var(--color-text)] font-mono">{new Date(summary.latestRun.finishedAt).toLocaleTimeString()}</strong></span>
          )}
        </div>
      </div>

      {/* Sub-Tab 1: Coverage & Quality Assessment */}
      {activeSubTab === "coverage" && (
        <div className="space-y-4">
          <SystemTestAssessmentPanel
            key={snapshotId}
            snapshotId={snapshotId}
            refreshKey={refreshKey}
            onOpenFile={onOpenFile}
            onRerun={handleRunTests}
            runner={activeFramework}
            executionMode={executionMode}
            onChanged={() => setRefreshKey(value => value + 1)}
          />
        </div>
      )}

      {/* Sub-Tab 2: Scenario Library & Workflow */}
      {activeSubTab === "scenarios" && (
        <div className="space-y-4">
          <SystemTestWorkflow
            snapshotId={snapshotId}
            framework={activeFramework}
            executionMode={executionMode}
            refreshKey={refreshKey}
            onReadyChange={setWorkflowReady}
            onOpenFile={onOpenFile}
            onGenerate={() => setIsGeneratorOpen(true)}
            onChanged={refreshData}
            onRunScenario={row => {
              setActiveSubTab("live");
              handleRunTests(row);
            }}
            onRunSelected={rows => {
              setActiveSubTab("live");
              handleRunTests(null, rows);
            }}
          />
        </div>
      )}

      {/* Sub-Tab 3: Live Playwright Runner & Step Execution */}
      {activeSubTab === "live" && (
        <div className="space-y-4">
          {runningTests || activeJobId ? (
            <SystemTestLiveRun
              projectId={projectId}
              key={activeJobId || 'active-live-run'}
              snapshotId={snapshotId}
              activeJobId={activeJobId}
              initialAssessmentId={activeAssessmentId}
            />
          ) : (
            <div className="p-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-center space-y-4 shadow-sm dark:shadow-xl">
              <div className="inline-flex p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                <Activity size={32} />
              </div>
              <div className="max-w-md mx-auto space-y-2">
                <h3 className="text-lg font-bold text-[var(--color-text)] tracking-tight">
                  Playwright Live Runner Viewport
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Ready to stream real-time browser actions, traffic light controls, step durations, and state changes as scenarios execute.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Button
                  variant="primary"
                  size="md"
                  icon={Play}
                  onClick={() => handleRunTests()}
                  className="!bg-indigo-600 hover:!bg-indigo-500 text-white font-semibold px-5 py-2.5 shadow-md"
                >
                  Start Live Run ({modeLabel})
                </Button>

                <button
                  type="button"
                  onClick={() => setHeadedMode(!headedMode)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    headedMode
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300 shadow-sm"
                      : "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]/50"
                  }`}
                  title="When active, Playwright opens a visible Chrome browser window on your Windows desktop with slowed actions"
                >
                  <Monitor size={14} className={headedMode ? "text-amber-500 dark:text-amber-400" : "text-[var(--color-text-muted)]"} />
                  <span>Desktop Window (Headed): <strong>{headedMode ? "ON" : "OFF"}</strong></span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 4: Execution Results & History */}
      {activeSubTab === "results" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-text-secondary)]">
            <span>Results for: <strong className="text-[var(--color-text)]">{modeLabel} · {activeFramework === "cypress" ? "Cypress" : "Playwright"}</strong></span>
            {summary?.latestRun?.finishedAt && (
              <span>Completed at: <strong className="text-[var(--color-text)] font-mono">{new Date(summary.latestRun.finishedAt).toLocaleString()}</strong></span>
            )}
          </div>

          {(loading || !matchesSelection) ? (
            <div role="status" className="py-12 text-center text-sm text-[var(--color-text-secondary)]">
              <Loader2 size={24} className="animate-spin mx-auto text-indigo-500 dark:text-indigo-400 mb-3" />
              Loading {modeLabel} results…
            </div>
          ) : !summary?.hasRun ? (
            <div className="p-8 border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface)] text-center text-sm text-[var(--color-text-secondary)] space-y-3">
              <p>No {activeFramework === "cypress" ? "Cypress" : "Playwright"} execution results found for {modeLabel}.</p>
              <Button variant="primary" size="sm" icon={Play} disabled={!projectAccess.can("tests.run")} onClick={() => handleRunTests()}>
                Run Test Suite Now
              </Button>
            </div>
          ) : (
            <>
              {/* Metric Summary Cards */}
              <SystemTestMetricsCards summary={summary} />

              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-secondary)] space-y-2">
                <p className="font-semibold text-[var(--color-text)]">Executed Spec Files in this run:</p>
                <ul className="space-y-1 font-mono text-xs text-indigo-600 dark:text-indigo-300 pl-4 list-disc">
                  {testFiles.filter(file => file.scenarios?.length).map(file => (
                    <li key={file.filePath}>{file.filePath}</li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-2 border-b border-[var(--color-border)] pb-3" aria-label="System test result views">
                {["scenarios", "execution"].map(view => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={resultView === view}
                    onClick={() => setResultView(view)}
                    className={`rounded-lg px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                      resultView === view
                        ? "bg-indigo-600 text-white shadow-md"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
                    }`}
                  >
                    {view === "scenarios" ? "Scenario Breakdown" : "Execution Timeline"}
                  </button>
                ))}
              </div>

              {resultView === "execution" ? (
                <SystemTestExecutionView
                  key={`${selectionKey}:${summary.testRunId}`}
                  summary={summary}
                  testFiles={testFiles}
                  snapshotId={snapshotId}
                  onInspect={setInspectedScenario}
                  onOpenEditor={target => {
                    onOpenFile?.(target.filePath);
                    setEditorTarget(target);
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers size={18} className="text-indigo-500 dark:text-indigo-400" />
                      <h3 className="text-base font-bold text-[var(--color-text)]">
                        System Test Scenarios &amp; Spec Files
                      </h3>
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] font-mono">
                      {testFiles.filter(file => file.scenarios?.length).length} spec file(s) executed
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
              )}
            </>
          )}
        </div>
      )}

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
          projectId={projectId}
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
