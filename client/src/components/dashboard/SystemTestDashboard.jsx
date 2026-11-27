import { attachSocketAuthRecovery, socketAuth } from "../../lib/authSession.js";
import SystemTestSetupDialog from "./system/SystemTestSetupDialog.jsx";
import { ExternalServicesBanner } from "./system/ExternalTestKeyNotices.jsx";
import { stripAnsi } from "../../utils/stripAnsi.js";
import { systemTestEntryState } from "./system/systemTestEntryModel.js";
import SystemTestVersionHistory from "./system/SystemTestVersionHistory.jsx";
import useSystemTestWorkspace from "../../hooks/useSystemTestWorkspace.js";
import { useProjectAccess } from "../../hooks/useProjectAccess";
import { useChatTestContext } from "../../hooks/useChatTestContext";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  RotateCcw,
  Printer,
  Loader2,
  Layers,
  ShieldCheck,
  CheckCircle2,
  Activity,
  Monitor,
  FileCode2,
  History,
  Settings2,
} from "lucide-react";
import { io } from "socket.io-client";
import { getJobDetailApi } from "../../services/job.service.js";
import { openFloatingJobQueue } from "../../lib/floatingJobQueuePrefs.js";
import Button from "../common/Button.jsx";
import SystemTestAssessmentPanel from "./system/SystemTestAssessmentPanel.jsx";
import SystemTestErrorNotice from "./system/SystemTestErrorNotice.jsx";
import SystemTestMetricsCards from "./system/SystemTestMetricsCards.jsx";
import SystemTestScenarioList from "./system/SystemTestScenarioList.jsx";
import SystemTestExecutionView from "./system/SystemTestExecutionView.jsx";
import SystemTestBreakpointModal from "./system/SystemTestBreakpointModal.jsx";
import SystemTestGeneratorModal from "./system/SystemTestGeneratorModal.jsx";
import SystemTestZeroStateBanner from "./system/SystemTestZeroStateBanner.jsx";
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

import SystemTestWorkspace from "./system/SystemTestWorkspace.jsx";
const countFrameworkSpecs = (list, name) =>
  list
    .filter((f) =>
      String(f?.name || "")
        .toLowerCase()
        .includes(name),
    )
    .reduce((sum, f) => sum + (Number(f?.testFileCount) || 0), 0);

const pickDefaultSystemFramework = (list = [], current = "playwright") => {
  const has = (name) =>
    list.some((f) =>
      String(f?.name || "")
        .toLowerCase()
        .includes(name),
    );
  const pw = countFrameworkSpecs(list, "playwright");
  const cy = countFrameworkSpecs(list, "cypress");
  if (pw > 0 && cy === 0) return "playwright";
  if (cy > 0 && pw === 0) return "cypress";
  if (pw > 0 && cy > 0)
    return ["playwright", "cypress"].includes(current) ? current : "playwright";
  if (has("cypress") && !has("playwright")) return "cypress";
  return "playwright";
};

export default function SystemTestDashboard(props) {
  return (
    <SystemTestWorkspace
      key={`${props.projectId}:${props.snapshotId}`}
      {...props}
    />
  );
}

function SystemTestDashboardWorkspace({
  projectId,
  snapshotId,
  focusScenario = null,
  onOpenFile,
  onChatContextChange,
}) {
  const projectAccess = useProjectAccess(projectId);
  // Current view: "dashboard" | "report"
  const [currentView, setCurrentView] = useState("dashboard");
  const [resultView, setResultView] = useState("scenarios");

  // Sub-tabs: "coverage" | "scenarios" | "live" | "results"
  const [activeSubTab, setActiveSubTab] = useState("scenarios");

  useEffect(() => {
    if (focusScenario) {
      queueMicrotask(() => {
        setActiveSubTab("scenarios");
        setResultView("scenarios");
      });
    }
  }, [focusScenario]);

  // Selected framework: "playwright" | "cypress"
  const [activeFramework, setActiveFramework] = useState("playwright");
  const executionMode = "full";

  // Data states
  const [frameworksData, setFrameworksData] = useState(null);
  const frameworkOptions = [
    { value: "playwright", label: "Playwright" },
    { value: "cypress", label: "Cypress" },
  ].map((option) => ({
    ...option,
    count: countFrameworkSpecs(frameworksData?.frameworks || [], option.value),
  }));
  const [discoveryError, setDiscoveryError] = useState(null);
  const [results, setResults] = useState(null);
  const selectionKey = [snapshotId, activeFramework, executionMode].join(":");
  const matchesSelection = results?.selectionKey === selectionKey;
  const summary = matchesSelection ? results.summary : null;
  const testFiles = matchesSelection ? results.testFiles : [];
  const modeLabel = "Full Stack";

  // Loading & error states
  const [loading, setLoading] = useState(true);
  const [runningTests, setRunningTests] = useState(false);
  const [error, setError] = useState(null);
  const [headedMode, setHeadedMode] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [snapshotPreparing, setSnapshotPreparing] = useState(false);
  const workspace = useSystemTestWorkspace({
    snapshotId,
    runner: activeFramework,
    executionMode,
    refreshKey,
  });
  const [workflowReady, setWorkflowReady] = useState({
    ready: false,
    blockers: [],
    scenarioIds: [],
    testFiles: [],
    selectedCount: 0,
  });

  // Live job execution progress
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobSelection, setJobSelection] = useState(null);
  const [jobProgress, setJobProgress] = useState(null); // { progress: 0-100, stage: string, message: string }

  // Modals state
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [focusServiceId, setFocusServiceId] = useState();
  const [setupReport, setSetupReport] = useState(null);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const runRequestRef = useRef(false);
  const pendingRunRef = useRef(null);
  const [inspectedScenario, setInspectedScenario] = useState(null);
  const assessmentPresentation = workspace.assessment?.presentation;
  const assessmentExecution = assessmentPresentation?.execution;
  const metricsSummary = assessmentExecution
    ? {
        ...summary,
        hasRun: true,
        totalTests: assessmentExecution.selected,
        passedTests: assessmentExecution.passed,
        failedTests: assessmentExecution.failed,
        blockedByExternal:
          assessmentExecution.blockedByExternal ?? summary?.blockedByExternal,
        externalServices:
          assessmentPresentation.externalServices ?? summary?.externalServices,
        flakyTests: assessmentExecution.flaky,
        skippedTests: assessmentExecution.skipped,
        durationMs: assessmentExecution.elapsedMs,
        runner: workspace.assessment.runner,
      }
    : summary;
  const testRunId = assessmentExecution
    ? workspace.assessment.testRunId
    : summary?.testRunId;
  useChatTestContext(onChatContextChange, {
    projectId,
    snapshotId,
    testType: "system",
    testRunId,
    scenarioId:
      testRunId && inspectedScenario?.testRunId === testRunId
        ? inspectedScenario.id
        : undefined,
    displayedMetrics: {
      kind: "system",
      tab: currentView === "report" ? "report" : activeSubTab,
      framework: metricsSummary?.runner || activeFramework,
      executionMode,
      assessmentId: assessmentExecution ? workspace.assessment.id : undefined,
      state: metricsSummary?.hasRun
        ? "ready"
        : loading
          ? "loading"
          : error || workspace.error
            ? "unavailable"
            : "not-run",
      counts: metricsSummary?.hasRun
        ? {
            scenarios: metricsSummary.totalTests || 0,
            passed: metricsSummary.passedTests || 0,
            failed: metricsSummary.failedTests || 0,
            flaky: metricsSummary.flakyTests || 0,
            skipped: metricsSummary.skippedTests || 0,
            durationMs: metricsSummary.durationMs || 0,
            passRate:
              metricsSummary.totalTests > 0
                ? Math.round(
                    ((metricsSummary.passedTests || 0) /
                      metricsSummary.totalTests) *
                      100,
                  )
                : null,
          }
        : undefined,
    },
  });
  const [editorTarget, setEditorTarget] = useState(null); // { filePath, scenarioId, initialMode }
  const [activeAssessmentId, setActiveAssessmentId] = useState(null);

  const socketRef = useRef(null);
  const activeJobRef = useRef(null);
  const frameworkDiscoveryRef = useRef(null);

  // Restore the persisted measurement job after refresh instead of letting Run
  // submit another operation while an existing suite is still executing.
  useEffect(() => {
    let ignore = false;
    if (!snapshotId) return;
    systemEvidenceRequest(snapshotId, "assessments")
      .then((record) => {
        if (
          ignore ||
          !record?.jobId ||
          !["QUEUED", "RUNNING"].includes(record.status)
        )
          return;
        activeJobRef.current = record.jobId;
        setActiveJobId(record.jobId);
        if (record.id) setActiveAssessmentId(record.id);
        setRunningTests(true);
        setJobSelection({
          executionMode:
            record.reportJson?.input?.executionMode || executionMode,
          runner: record.runner,
        });
        setJobProgress({
          progress: 0,
          stage: "Resuming status",
          message: "Checking the existing system test job...",
        });
      })
      .catch(() => {
        /* Ordinary runner still works when evidence is unavailable. */
      });
    return () => {
      ignore = true;
    };
  }, [snapshotId, executionMode]);

  // Framework discovery is independent of the selected result mode.
  useEffect(() => {
    let ignore = false;
    let retryTimer;
    if (projectId && snapshotId)
      getSystemTestFrameworks(projectId, snapshotId)
        .then((response) => {
          if (ignore) return;
          setSnapshotPreparing(false);
          setFrameworksData(response?.data || null);
          setDiscoveryError(null);
          const list = response?.data?.frameworks || [];
          const discoveryKey = `${projectId}:${snapshotId}`;
          if (frameworkDiscoveryRef.current !== discoveryKey) {
            frameworkDiscoveryRef.current = discoveryKey;
            setActiveFramework((prev) =>
              pickDefaultSystemFramework(list, prev),
            );
          }
        })
        .catch((err) => {
          if (ignore) return;
          const message =
            err.response?.data?.message ||
            err.message ||
            "Could not check system test files.";
          // A freshly uploaded or imported snapshot is still being extracted and
          // indexed. Wait for it instead of showing an error with a manual Retry.
          if (err.response?.status === 409 && /not ready/i.test(message)) {
            setSnapshotPreparing(true);
            retryTimer = setTimeout(
              () => setRefreshKey((value) => value + 1),
              3000,
            );
            return;
          }
          setSnapshotPreparing(false);
          setDiscoveryError(message);
        });
    return () => {
      ignore = true;
      clearTimeout(retryTimer);
    };
  }, [projectId, snapshotId, refreshKey]);

  // Pin scenarios to the same run as the summary, even if another job finishes mid-fetch.
  useEffect(() => {
    let ignore = false;
    async function loadResults() {
      try {
        if (!snapshotId) {
          if (!ignore)
            setResults({ selectionKey, summary: null, testFiles: [] });
          return;
        }
        const filters = { executionMode, runner: activeFramework };
        const sumRes = await getSystemTestSummary(snapshotId, filters);
        if (ignore) return;
        const selectedSummary = sumRes?.data || null;
        let files = [];
        if (selectedSummary?.hasRun && selectedSummary.testRunId) {
          const scRes = await getSystemTestScenarios(snapshotId, {
            ...filters,
            testRunId: selectedSummary.testRunId,
          });
          files = scRes?.data?.testFiles || [];
        }
        if (!ignore)
          setResults({
            selectionKey,
            summary: selectedSummary,
            testFiles: files,
          });
      } catch (err) {
        if (!ignore) {
          setResults({ selectionKey, summary: null, testFiles: [] });
          setError(
            err.response?.data?.message ||
              err.message ||
              "Failed to load system test results.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadResults();
    return () => {
      ignore = true;
    };
  }, [snapshotId, executionMode, activeFramework, selectionKey, refreshKey]);

  const refreshData = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const { selectAssessment } = workspace;

  const applyJobUpdate = useCallback(
    (payload) => {
      if (!activeJobRef.current || payload.jobId !== activeJobRef.current)
        return;
      const status = payload.status;
      if (
        ["FAILED", "CANCELED", "CANCELLED", "SUCCESS", "COMPLETED"].includes(
          status,
        )
      ) {
        activeJobRef.current = null;
        setRunningTests(false);
        setJobProgress(null);
        setActiveJobId(null);
        if (status === "FAILED") {
          setError(
            `System test job failed: ${payload.errorMessage || payload.message || "Execution error"}`,
          );
          if (
            /requires test environment configuration|SYSTEM_TEST_ENVIRONMENT_REQUIRED/i.test(
              payload.errorMessage || payload.message || "",
            )
          )
            setSetupOpen(true);
        } else if (status === "CANCELED" || status === "CANCELLED") {
          setError("System test job was canceled.");
        }
        if (["SUCCESS", "COMPLETED"].includes(status)) {
          if (activeAssessmentId) selectAssessment(activeAssessmentId);
          setActiveSubTab("results");
        }
        refreshData();
        return;
      }
      setJobProgress((previous) => ({
        progress: payload.progress ?? previous?.progress ?? 0,
        stage: payload.stage || previous?.stage || "Running",
        message: payload.message || previous?.message,
      }));
    },
    [refreshData, activeAssessmentId, selectAssessment],
  );

  // Read persisted status as well as socket events, including after reconnects.
  useEffect(() => {
    if (!activeJobId) return;
    let ignore = false;
    let timer;
    const poll = async () => {
      try {
        const response = await getJobDetailApi(activeJobId);
        if (!ignore && response?.job) {
          const stageLog = (response.job.logs || [])
            .filter((log) => log.message?.startsWith("Assessment stage: "))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
          applyJobUpdate({
            ...response.job,
            jobId: response.job.id,
            ...(stageLog
              ? {
                  stage: "Measuring system tests",
                  message: stageLog.message.slice("Assessment stage: ".length),
                }
              : response.job.type === "SYSTEM_TEST_ASSESSMENT"
                ? {
                    stage: "Running system tests",
                    message:
                      "Preparing application or executing tests. Open Job Queue for detailed logs.",
                  }
                : {}),
          });
        }
      } catch (err) {
        if (!ignore)
          setError(`Unable to check system test status: ${err.message}`);
      }
      if (!ignore && activeJobRef.current === activeJobId) {
        timer = setTimeout(poll, 2000);
      }
    };
    poll();
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
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

    const socket = io(SOCKET_URL, { auth: socketAuth });
    attachSocketAuthRecovery(socket);
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
  const handleRunTests = async (
    onlyScenario = null,
    selectedScenarios = null,
  ) => {
    if (!projectAccess.can("tests.run")) return;
    if (!snapshotId) {
      setError("No active snapshot available to run system tests.");
      return;
    }

    if (runRequestRef.current || activeJobRef.current) return;
    runRequestRef.current = true;
    setCheckingSetup(true);
    setError(null);
    try {
      const setup = await systemEvidenceRequest(snapshotId, "setup");
      setSetupReport(setup);
      if (!setup.ready) {
        runRequestRef.current = false;
        if (
          setup.issues.some((issue) => issue.code === "ENVIRONMENT_REQUIRED")
        ) {
          pendingRunRef.current = { onlyScenario, selectedScenarios };
          setSetupOpen(true);
        } else setError(setup.issues.map((issue) => issue.message).join(" "));
        return;
      }
    } catch (err) {
      runRequestRef.current = false;
      setError(
        err.response?.data?.message ||
          err.message ||
          "Could not check project setup.",
      );
      return;
    } finally {
      setCheckingSetup(false);
    }

    setActiveSubTab("live");
    setJobSelection({ executionMode, runner: activeFramework });
    setRunningTests(true);
    setError(null);
    setJobProgress({
      progress: 5,
      stage: "Starting",
      message: "Queuing system test job...",
    });

    try {
      const capabilities =
        activeFramework === "playwright"
          ? await systemEvidenceRequest(snapshotId, "capabilities")
          : null;
      const res =
        activeFramework === "playwright" &&
        capabilities?.enabled &&
        capabilities.coverageEnabled
          ? await (async () => {
              let scenarioIds = [];
              let selectedFiles = [];

              if (selectedScenarios && selectedScenarios.length > 0) {
                scenarioIds = selectedScenarios.map((s) => s.id);
                selectedFiles = [
                  ...new Set(selectedScenarios.map((s) => s.filePath)),
                ];
              } else if (onlyScenario) {
                scenarioIds = [onlyScenario.id];
                selectedFiles = [onlyScenario.filePath];
              } else if (
                workflowReady?.scenarioIds &&
                workflowReady.scenarioIds.length > 0
              ) {
                scenarioIds = workflowReady.scenarioIds;
                selectedFiles = workflowReady.testFiles || [];
              }

              if (!scenarioIds.length) {
                const data = await systemEvidenceRequest(
                  snapshotId,
                  "assessments",
                  {
                    method: "POST",
                    data: {
                      autoDiscover: true,
                      runner: "playwright",
                      executionMode,
                      allowGenerate: projectAccess.can("ai.use"),
                      headed: headedMode,
                    },
                  },
                );
                return { data };
              }

              const discovered = await systemEvidenceRequest(
                snapshotId,
                `discovery?executionMode=${executionMode}`,
              );
              const query = new URLSearchParams({
                reviewMode: "execution",
                scenarioIds: scenarioIds.join(","),
                testFiles: selectedFiles.join(","),
              });
              const readiness = await systemEvidenceRequest(
                snapshotId,
                `readiness?${query}`,
              );

              if (!readiness.ready) {
                throw new Error(
                  readiness.blockers
                    .map((blocker) => blocker.message)
                    .join("; "),
                );
              }

              const data = await systemEvidenceRequest(
                snapshotId,
                "assessments",
                {
                  method: "POST",
                  data: {
                    ...discovered,
                    testFiles: selectedFiles,
                    reviewMode: "execution",
                    scenarioIds,
                    headed: headedMode,
                  },
                },
              );
              return { data };
            })()
          : systemTestEntryState({
                discovery: frameworksData,
                error: discoveryError,
                activeJob: false,
              }) === "empty"
            ? (() => {
                // The legacy analysis job only runs existing spec files; it cannot
                // generate tests, so do not queue a job that is certain to fail.
                throw new Error(
                  "Automatic test generation is turned off on this server. Generate tests and apply them first, or ask the administrator to enable SYSTEM_ASSESSMENT_ENABLED and SYSTEM_MEASURED_COVERAGE_ENABLED.",
                );
              })()
            : await runSystemTest(snapshotId, {
                framework: activeFramework,
                executionMode,
                testFile: onlyScenario?.filePath || undefined,
              });

      setRefreshKey((value) => value + 1);

      if (res?.data?.jobId) {
        activeJobRef.current = res.data.jobId;
        setActiveJobId(res.data.jobId);
        if (res?.data?.assessmentId) {
          setActiveAssessmentId(res.data.assessmentId);
        }
      } else {
        throw new Error("Server did not return a system test job ID.");
      }
    } catch (err) {
      setRunningTests(false);
      if (
        err.response?.data?.code === "SYSTEM_TEST_ENVIRONMENT_REQUIRED" ||
        /requires test environment configuration/i.test(
          err.response?.data?.message || err.message || "",
        )
      )
        setSetupOpen(true);
      setJobProgress(null);
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to start system test execution.",
      );
    } finally {
      runRequestRef.current = false;
    }
  };
  function openExternalSetup(serviceId) {
    setFocusServiceId(serviceId);
    setSetupOpen(true);
  }

  const externalBanner = (
    <ExternalServicesBanner
      snapshotId={snapshotId}
      setup={setupReport}
      summary={summary}
      onOpenSetup={openExternalSetup}
    />
  );
  const setupDialog = setupOpen ? (
    <SystemTestSetupDialog
      focusServiceId={focusServiceId}
      projectId={projectId}
      snapshotId={snapshotId}
      onClose={() => {
        pendingRunRef.current = null;
        setFocusServiceId(undefined);
        setSetupOpen(false);
      }}
      onChanged={refreshData}
      onStatus={setSetupReport}
      onReady={() => {
        const pending = pendingRunRef.current;
        if (pending) {
          pendingRunRef.current = null;
          setFocusServiceId(undefined);
          setSetupOpen(false);
          void handleRunTests(pending.onlyScenario, pending.selectedScenarios);
        }
      }}
      runtimeMessage={error}
      onGenerate={() => {
        pendingRunRef.current = null;
        setFocusServiceId(undefined);
        setSetupOpen(false);
        setIsGeneratorOpen(true);
      }}
    />
  ) : null;

  const entryState = systemTestEntryState({
    discovery: frameworksData,
    error: discoveryError,
    activeJob: runningTests || !!activeJobId,
  });
  const hasNoTests = entryState === "empty";

  if (entryState === "error")
    return (
      <div
        role="alert"
        className="mx-auto max-w-lg space-y-4 p-8 text-center text-sm"
      >
        <p>
          {discoveryError ||
            frameworksData?.error ||
            "Could not check system test files."}
        </p>
        <Button onClick={refreshData} icon={RotateCcw}>
          Retry
        </Button>
      </div>
    );

  // When checking frameworks and initial discovery is in flight
  if (entryState === "loading") {
    return (
      <div
        className="w-full min-h-[400px] flex flex-col items-center justify-center p-12 text-center space-y-3 bg-[var(--color-bg)] text-[var(--color-text)]"
        aria-busy="true"
      >
        <Loader2
          size={32}
          className="animate-spin text-[var(--color-primary)]"
        />
        <p className="text-sm font-semibold">
          {snapshotPreparing
            ? "Preparing the imported project..."
            : "Checking system test configuration..."}
        </p>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {snapshotPreparing
            ? "Files are still being extracted and indexed. This page continues automatically when the snapshot is ready."
            : "Looking for test files in this snapshot."}
        </p>
      </div>
    );
  }

  // Zero-State: When no test files exist in the project, show clean AI generator view
  if (hasNoTests && !workspace.assessment) {
    return (
      <div className="system-test-workspace flex w-full min-h-full flex-col items-center justify-center gap-4 bg-[var(--color-bg)] p-4 font-sans text-[var(--color-text)] sm:p-6">
        <style>{`@media (prefers-reduced-motion: reduce) { .system-test-workspace *, .system-test-workspace *::before { animation: none!important; transition: none!important; scroll-behavior: auto!important; } }`}</style>
        <SystemTestErrorNotice
          className="max-w-2xl"
          message={error}
          onDismiss={() => setError(null)}
          onOpenLogs={() => openFloatingJobQueue({ domain: "system" })}
          onOpenSetup={() => setSetupOpen(true)}
        />
        {setupDialog}
        {/* Empty state stays compact until Apply creates real spec files. */}
        <SystemTestZeroStateBanner
          framework={activeFramework}
          executionMode={executionMode}
          onOpenGenerator={() => setIsGeneratorOpen(true)}
          canGenerate={projectAccess.can("ai.use")}
        />

        <button
          type="button"
          className="text-xs underline"
          onClick={() => setSetupOpen(true)}
        >
          Check project setup
        </button>
        <Button
          icon={Play}
          loading={checkingSetup}
          disabled={
            !projectAccess.can("tests.run") ||
            !projectAccess.can("ai.use") ||
            checkingSetup
          }
          onClick={() => handleRunTests()}
        >
          Run automatically
        </Button>
        <p className="max-w-md text-center text-xs text-[var(--color-text-secondary)]">
          Detect services, generate missing tests and execute in an isolated
          workspace. Business expectations remain unreviewed.
        </p>
        {/* Cold-Start Test Generator Modal */}
        {isGeneratorOpen && (
          <SystemTestGeneratorModal
            isOpen={isGeneratorOpen}
            onOpenSetup={openExternalSetup}
            onClose={() => {
              setIsGeneratorOpen(false);
              refreshData();
            }}
            snapshotId={snapshotId}
            projectId={projectId}
            initialFramework={activeFramework}
            executionMode={executionMode}
            onSuccess={() => {
              setActiveSubTab("scenarios");
              refreshData();
            }}
          />
        )}
      </div>
    );
  }

  // If in Report View mode, render SystemTestReportView
  if (currentView === "report") {
    return (
      <>
        <SystemTestReportView
          assessment={workspace.assessment}
          snapshotId={snapshotId}
          onBack={() => setCurrentView("dashboard")}
          onOpenSetup={openExternalSetup}
        />
        {setupDialog}
      </>
    );
  }

  return (
    <div className="system-test-workspace w-full min-h-full bg-[var(--color-bg)] text-[var(--color-text)] font-sans p-4 sm:p-6 space-y-6">
      <style>{`@media (prefers-reduced-motion: reduce) { .system-test-workspace *, .system-test-workspace *::before { animation: none!important; transition: none!important; scroll-behavior: auto!important; } }`}</style>
      {/* Header: what this page does, plus the primary run action */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-[var(--color-text)]">
            System Test Coverage
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Verify user journeys across the frontend, real API and database.
          </p>
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-3 text-xs">
        Assessment
        <select
          aria-label="Selected assessment"
          value={workspace.assessment?.id || ""}
          onChange={(event) => workspace.selectAssessment(event.target.value)}
          className="max-w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
        >
          <option value="">Latest completed assessment</option>
          {workspace.history
            .filter((row) => row.status === "COMPLETED")
            .map((row) => (
              <option key={row.id} value={row.id}>
                {new Date(row.createdAt).toLocaleString("en-GB")} ? {row.runner}
              </option>
            ))}
        </select>
      </label>
      {workspace.error && (
        <p role="alert" className="text-sm text-rose-600">
          {stripAnsi(workspace.error)}
        </p>
      )}
      {workspace.nextCursor && (
        <button
          type="button"
          className="text-xs underline"
          onClick={workspace.loadMore}
        >
          Load older assessments
        </button>
      )}
      <SystemTestMetricsCards summary={metricsSummary} />

      {historyOpen && (
        <SystemTestVersionHistory
          projectId={projectId}
          snapshotId={snapshotId}
          executionMode={executionMode}
          onClose={() => setHistoryOpen(false)}
          onChanged={refreshData}
          onCheck={(data) => {
            activeJobRef.current = data.jobId;
            setActiveJobId(data.jobId);
            setActiveAssessmentId(data.assessmentId);
            setRunningTests(true);
            setActiveSubTab("live");
          }}
        />
      )}
      <button
        type="button"
        className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs"
        onClick={() => setHistoryOpen(true)}
      >
        Version history
      </button>
      {setupDialog}
      {setupReport && !setupReport.ready && (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          Startup setup needs attention.
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="font-medium underline"
          >
            Review setup
          </button>
        </p>
      )}
      {externalBanner}
      {/* Top Action Bar */}
      <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Engine Badge */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20 text-xs font-semibold">
            <ShieldCheck size={14} />
            {activeFramework === "cypress" ? "Cypress" : "Playwright"} /{" "}
            {modeLabel}
          </span>
          {frameworkOptions.every(({ count }) => count > 0) && (
            <div
              role="group"
              aria-label="System test framework"
              className="inline-flex gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5"
            >
              {frameworkOptions.map(({ value, label, count }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={activeFramework === value}
                  disabled={runningTests || checkingSetup}
                  onClick={() => setActiveFramework(value)}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 disabled:opacity-50 ${
                    activeFramework === value
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {label}{" "}
                  <span className="font-mono tabular-nums">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={runningTests ? Loader2 : Play}
            loading={runningTests || checkingSetup}
            disabled={
              !projectAccess.can("tests.run") ||
              !snapshotId ||
              loading ||
              runningTests ||
              checkingSetup
            }
            onClick={() => handleRunTests()}
            title="Run System Test Analysis (Playwright / Cypress)"
            className="text-xs h-8 font-medium"
          >
            {checkingSetup
              ? "Checking setup..."
              : runningTests
                ? "Running (" +
                  Math.max(5, Math.min(100, jobProgress?.progress ?? 5)) +
                  "%)..."
                : "Run System Test"}
          </Button>
        </div>
      </div>

      {historyOpen && (
        <SystemTestVersionHistory
          projectId={projectId}
          snapshotId={snapshotId}
          executionMode={executionMode}
          onClose={() => setHistoryOpen(false)}
          onChanged={refreshData}
          onCheck={(data) => {
            activeJobRef.current = data.jobId;
            setActiveJobId(data.jobId);
            setActiveAssessmentId(data.assessmentId);
            setRunningTests(true);
            setActiveSubTab("live");
          }}
        />
      )}
      {/* Toolbar: which result is shown, and secondary actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)]">
            <ShieldCheck
              size={13}
              className="text-[var(--color-primary)]"
              aria-hidden="true"
            />
            {activeFramework === "cypress" ? "Cypress" : "Playwright"} /{" "}
            {modeLabel}
          </span>
          <span className="text-[11px] border border-[var(--color-border)] bg-[var(--color-bg)] rounded-md px-2 py-1 text-[var(--color-text-muted)]">
            Full system · Real API &amp; database
          </span>
          <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span>Assessment</span>
            <select
              aria-label="Selected assessment"
              value={workspace.assessment?.id || ""}
              onChange={(event) =>
                workspace.selectAssessment(event.target.value)
              }
              className="h-8 max-w-[15rem] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
            >
              <option value="">Latest completed</option>
              {workspace.history
                .filter((row) => row.status === "COMPLETED")
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {new Date(row.createdAt).toLocaleString("en-GB")} ·{" "}
                    {row.runner}
                  </option>
                ))}
            </select>
          </label>
          {workspace.nextCursor && (
            <button
              type="button"
              className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)] cursor-pointer"
              onClick={workspace.loadMore}
            >
              Load older
            </button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={History}
            onClick={() => setHistoryOpen(true)}
            className="text-xs h-8"
          >
            Version history
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Settings2}
            disabled={runningTests || checkingSetup}
            onClick={() => setSetupOpen(true)}
            className="text-xs h-8"
          >
            Check setup
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={FileCode2}
            onClick={() => setIsGeneratorOpen(true)}
            disabled={loading || runningTests}
            className="text-xs h-8"
            title="Auto-generate system test scenarios with AI"
          >
            Generate tests
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Printer}
            onClick={() => setCurrentView("report")}
            disabled={loading || !workspace.assessment}
            className="text-xs h-8"
          >
            Export report
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            onClick={refreshData}
            disabled={loading || !matchesSelection || runningTests}
            className="text-xs h-8"
            title="Refresh dashboard data"
          >
            Refresh
          </Button>
          <button
            type="button"
            aria-pressed={headedMode}
            onClick={() => setHeadedMode(!headedMode)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 active:scale-[0.98] cursor-pointer ${
              headedMode
                ? "border-amber-500/35 bg-amber-500/[0.08] text-amber-400"
                : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
            }`}
            title="When on, Playwright opens a visible browser window on this machine and slows actions down"
          >
            <Monitor size={13} aria-hidden="true" />
            <span>
              Desktop window: <strong>{headedMode ? "On" : "Off"}</strong>
            </span>
          </button>
        </div>
      </div>

      {workspace.error && (
        <SystemTestErrorNotice message={stripAnsi(workspace.error)} />
      )}
      {setupReport && !setupReport.ready && (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] border-l-2 border-l-amber-500/70 bg-[var(--color-surface)] px-3.5 py-2.5 text-xs text-[var(--color-text-secondary)]">
          <span>Startup setup needs attention.</span>
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="font-medium text-[var(--color-text)] underline cursor-pointer"
          >
            Review setup
          </button>
        </p>
      )}
      <SystemTestMetricsCards
        coverageTiers={
          workspace.assessment?.coverage?.tiers || summary?.coverage?.tiers
        }
        summary={metricsSummary}
      />

      {/* Real-time Progress Banner if running */}
      {runningTests && jobProgress && (
        <div className="p-3.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] border-l-2 border-l-[var(--color-primary)] text-xs text-[var(--color-text)] space-y-2">
          <div className="flex items-center justify-between font-medium">
            <div className="flex items-center gap-2">
              <Loader2
                size={14}
                className="animate-spin text-[var(--color-primary)]"
              />
              <span>{`${jobSelection?.executionMode === "full" ? "Full Stack" : "Frontend Dev Server"} · ${jobSelection?.runner || activeFramework} · ${jobProgress.stage || "Executing system tests"}`}</span>
            </div>
            <span className="font-mono tabular-nums text-[var(--color-text-secondary)]">
              {jobProgress.progress}%
            </span>
          </div>

          <div className="w-full bg-[var(--color-surface-secondary)] h-1 rounded-sm overflow-hidden">
            <div
              className="bg-[var(--color-primary)]/80 h-full transition-colors duration-300"
              style={{ width: `${jobProgress.progress}%` }}
            />
          </div>

          {jobProgress.message && (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 break-words text-[11px] font-mono text-[var(--color-text-secondary)]">
                {jobProgress.message}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Global Error Banner */}
      <SystemTestErrorNotice
        message={stripAnsi(error)}
        onDismiss={() => setError(null)}
        onOpenLogs={() => openFloatingJobQueue({ domain: "system" })}
        onOpenSetup={() => setSetupOpen(true)}
      />

      {/* Sub-Tab Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)]">
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => setActiveSubTab("scenarios")}
            className={`flex items-center gap-2 pb-2.5 px-0.5 text-xs border-b-2 transition-colors duration-150 cursor-pointer ${
              activeSubTab === "scenarios"
                ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium"
            }`}
          >
            <Layers size={14} />
            <span>Scenarios</span>
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] font-mono">
              Workflow &amp; Specs
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("live")}
            className={`flex items-center gap-2 pb-2.5 px-0.5 text-xs border-b-2 transition-colors duration-150 cursor-pointer ${
              activeSubTab === "live"
                ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium"
            }`}
          >
            <Activity size={14} />
            <span>Live run</span>
            {(runningTests || activeJobId) && (
              <span className="inline-flex items-center gap-1.5 text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] font-mono">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500/85" />
                </span>
                Running
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("results")}
            className={`flex items-center gap-2 pb-2.5 px-0.5 text-xs border-b-2 transition-colors duration-150 cursor-pointer ${
              activeSubTab === "results"
                ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium"
            }`}
          >
            <CheckCircle2 size={14} />
            <span>Results</span>
            {summary?.totalTests > 0 && (
              <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] font-mono tabular-nums">
                {summary.passedTests}/{summary.totalTests} passed
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 pb-2 text-xs text-[var(--color-text-secondary)]">
          <span>
            Engine:{" "}
            <strong className="font-medium text-[var(--color-text)]">
              {activeFramework === "cypress" ? "Cypress" : "Playwright"}
            </strong>
          </span>
          {summary?.latestRun?.finishedAt && (
            <span>
              Last execution:{" "}
              <strong className="font-medium text-[var(--color-text)] font-mono tabular-nums">
                {new Date(summary.latestRun.finishedAt).toLocaleTimeString()}
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* Sub-Tab 1: Coverage & Quality Assessment */}
      {activeSubTab === "results" && (
        <div className="space-y-4">
          <SystemTestAssessmentPanel
            selectedAssessment={workspace.assessment}
            key={snapshotId}
            projectId={projectId}
            snapshotId={snapshotId}
            refreshKey={refreshKey}
            onOpenFile={onOpenFile}
            onRerun={handleRunTests}
            onOpenSetup={openExternalSetup}
            runner={activeFramework}
            executionMode={executionMode}
            onChanged={() => setRefreshKey((value) => value + 1)}
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
            onRunScenario={(row) => {
              setActiveSubTab("live");
              handleRunTests(row);
            }}
            onRunSelected={(rows) => {
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
              key={activeJobId || "active-live-run"}
              snapshotId={snapshotId}
              activeJobId={activeJobId}
              initialAssessmentId={activeAssessmentId}
            />
          ) : (
            <div className="p-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-center space-y-4">
              <div className="inline-flex p-2.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)]">
                <Activity size={24} />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <h3 className="text-sm font-semibold text-[var(--color-text)] tracking-tight">
                  Playwright Live Runner Viewport
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  Ready to stream real-time browser actions, screenshots, step
                  durations, and state changes as scenarios execute.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  icon={Play}
                  onClick={() => handleRunTests()}
                  className="font-medium"
                >
                  Start Live Run ({modeLabel})
                </Button>

                <button
                  type="button"
                  onClick={() => setHeadedMode(!headedMode)}
                  className={`inline-flex h-8 items-center gap-2 px-3 rounded-md text-xs font-medium border transition-colors duration-150 cursor-pointer ${
                    headedMode
                      ? "bg-amber-500/[0.08] border-amber-500/35 text-amber-400"
                      : "bg-[var(--color-bg)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
                  }`}
                  title="When active, Playwright opens a visible Chrome browser window on your Windows desktop with slowed actions"
                >
                  <Monitor
                    size={13}
                    className={
                      headedMode
                        ? "text-amber-400"
                        : "text-[var(--color-text-muted)]"
                    }
                  />
                  <span>
                    Desktop Window (Headed):{" "}
                    <strong>{headedMode ? "ON" : "OFF"}</strong>
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 4: Execution Results & History */}
      {activeSubTab === "results" && !workspace.assessment && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
            <span>
              Results for:{" "}
              <strong className="font-medium text-[var(--color-text)]">
                {modeLabel} ·{" "}
                {activeFramework === "cypress" ? "Cypress" : "Playwright"}
              </strong>
            </span>
            {summary?.latestRun?.finishedAt && (
              <span>
                Completed at:{" "}
                <strong className="font-medium text-[var(--color-text)] font-mono tabular-nums">
                  {new Date(summary.latestRun.finishedAt).toLocaleString()}
                </strong>
              </span>
            )}
          </div>

          {loading || !matchesSelection ? (
            <div
              role="status"
              className="py-12 text-center text-xs text-[var(--color-text-secondary)]"
            >
              <Loader2
                size={22}
                className="animate-spin mx-auto text-[var(--color-primary)] mb-2.5"
              />
              Loading {modeLabel} results…
            </div>
          ) : !summary?.hasRun ? (
            <div className="p-8 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-center text-xs text-[var(--color-text-secondary)] space-y-3">
              <p>
                No {activeFramework === "cypress" ? "Cypress" : "Playwright"}{" "}
                execution results found for {modeLabel}.
              </p>
              <Button
                variant="primary"
                size="sm"
                icon={Play}
                disabled={!projectAccess.can("tests.run")}
                onClick={() => handleRunTests()}
              >
                Run Test Suite Now
              </Button>
            </div>
          ) : (
            <>
              {/* Metric Summary Cards */}
              <style>{`@media (prefers-reduced-motion: reduce) { .system-test-workspace *, .system-test-workspace *::before { animation: none!important; transition: none!important; scroll-behavior: auto!important; } }`}</style>
              <label className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                Assessment
                <select
                  aria-label="Selected assessment"
                  value={workspace.assessment?.id || ""}
                  onChange={(event) =>
                    workspace.selectAssessment(event.target.value)
                  }
                  className="max-w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)]"
                >
                  <option value="">Latest completed assessment</option>
                  {workspace.history
                    .filter((row) => row.status === "COMPLETED")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {new Date(row.createdAt).toLocaleString("en-GB")} ·{" "}
                        {row.runner}
                      </option>
                    ))}
                </select>
              </label>
              {workspace.error && (
                <p role="alert" className="text-xs text-rose-400">
                  {stripAnsi(workspace.error)}
                </p>
              )}
              {workspace.nextCursor && (
                <button
                  type="button"
                  className="text-xs underline cursor-pointer"
                  onClick={workspace.loadMore}
                >
                  Load older assessments
                </button>
              )}
              <SystemTestMetricsCards summary={metricsSummary} />

              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs text-[var(--color-text-secondary)] space-y-2">
                <p className="font-medium text-[var(--color-text)]">
                  Executed Spec Files in this run:
                </p>
                <ul className="space-y-1 font-mono text-xs text-[var(--color-text-secondary)] pl-4 list-disc">
                  {testFiles
                    .filter((file) => file.scenarios?.length)
                    .map((file) => (
                      <li key={file.filePath}>{file.filePath}</li>
                    ))}
                </ul>
              </div>

              <div
                className="flex gap-5 border-b border-[var(--color-border)]"
                aria-label="System test result views"
              >
                {["scenarios", "execution"].map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={resultView === view}
                    onClick={() => setResultView(view)}
                    className={`pb-2.5 px-0.5 text-xs border-b-2 transition-colors duration-150 cursor-pointer ${
                      resultView === view
                        ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium"
                    }`}
                  >
                    {view === "scenarios"
                      ? "Scenario Breakdown"
                      : "Execution Timeline"}
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
                  onOpenSetup={openExternalSetup}
                  onOpenEditor={(target) => {
                    onOpenFile?.(target.filePath);
                    setEditorTarget(target);
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers
                        size={15}
                        className="text-[var(--color-text-muted)]"
                      />
                      <h3 className="text-sm font-semibold text-[var(--color-text)]">
                        System Test Scenarios &amp; Spec Files
                      </h3>
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] font-mono tabular-nums">
                      {
                        testFiles.filter((file) => file.scenarios?.length)
                          .length
                      }{" "}
                      spec file(s) executed
                    </span>
                  </div>

                  <SystemTestScenarioList
                    snapshotId={snapshotId}
                    testFiles={testFiles}
                    onInspectBreakpoint={(scenario) =>
                      setInspectedScenario(scenario)
                    }
                    onOpenSetup={openExternalSetup}
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
          onOpenSetup={openExternalSetup}
          onClose={() => setIsGeneratorOpen(false)}
          snapshotId={snapshotId}
          projectId={projectId}
          initialFramework={activeFramework}
          executionMode={executionMode}
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
              setJobProgress({
                progress: 5,
                stage: "Starting",
                message: "Queuing single test file...",
              });
              activeJobRef.current = result.jobId;
              setActiveJobId(result.jobId);
            } else refreshData();
          }}
        />
      )}
    </div>
  );
}
