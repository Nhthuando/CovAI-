import { useState, useEffect, useRef } from "react";
import {
  Play,
  RotateCcw,
  Printer,
  AlertCircle,
  Loader2,
  Layers,
} from "lucide-react";
import { io } from "socket.io-client";
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
  const [summary, setSummary] = useState(null);
  const [testFiles, setTestFiles] = useState([]);

  // Loading & error states
  const [loading, setLoading] = useState(true);
  const [runningTests, setRunningTests] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Live job execution progress
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(null); // { progress: 0-100, stage: string, message: string }

  // Modals state
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [inspectedScenario, setInspectedScenario] = useState(null);
  const [editorTarget, setEditorTarget] = useState(null); // { filePath, scenarioId, initialMode }

  const socketRef = useRef(null);

  // Load Frameworks, Summary, and Scenarios
  useEffect(() => {
    let ignore = false;
    async function loadData() {
      if (!snapshotId && !projectId) {
        setLoading(false);
        return;
      }

      try {
        if (projectId) {
          const fwRes = await getSystemTestFrameworks(projectId, snapshotId);
          if (!ignore) {
            setFrameworksData(fwRes?.data || null);
            const fwList = fwRes?.data?.frameworks || [];
            if (fwList.some((f) => f.name?.toLowerCase().includes("cypress"))) {
              if (!fwList.some((f) => f.name?.toLowerCase().includes("playwright"))) {
                setActiveFramework("cypress");
              }
            }
          }
        }

        if (snapshotId) {
          try {
            const sumRes = await getSystemTestSummary(snapshotId);
            if (!ignore) {
              setSummary(sumRes?.data || null);
              if (sumRes?.data?.runner) {
                setActiveFramework(sumRes.data.runner.toLowerCase());
              }
            }
          } catch {
            // Summary might not exist yet
          }

          try {
            const scRes = await getSystemTestScenarios(snapshotId);
            if (!ignore) {
              setTestFiles(scRes?.data?.testFiles || []);
            }
          } catch {
            // Scenarios might not exist yet
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err.message || "Failed to load system test status.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      ignore = true;
    };
  }, [projectId, snapshotId, refreshKey]);

  const refreshData = () => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  };

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
      socket.emit("join_snapshot", snapshotId);
    });

    socket.on("job:progress", (payload) => {
      if (
        payload.snapshotId === snapshotId ||
        (activeJobId && payload.jobId === activeJobId)
      ) {
        setJobProgress({
          progress: payload.progress || 0,
          stage: payload.stage || payload.message,
          message: payload.message,
        });

        if (payload.status === "COMPLETED" || payload.progress === 100) {
          setTimeout(() => {
            setRunningTests(false);
            setJobProgress(null);
            setActiveJobId(null);
            refreshData();
          }, 1000);
        } else if (payload.status === "FAILED") {
          setRunningTests(false);
          setJobProgress(null);
          setError(`System test job failed: ${payload.message || "Execution error"}`);
          refreshData();
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [snapshotId, activeJobId]);

  // Run System Tests trigger
  const handleRunTests = async () => {
    if (!snapshotId) {
      setError("No active snapshot available to run system tests.");
      return;
    }

    setRunningTests(true);
    setError(null);
    setJobProgress({ progress: 5, stage: "Starting", message: "Queuing system test job..." });

    try {
      const res = await runSystemTest(snapshotId, {
        framework: activeFramework,
        executionMode,
      });

      if (res?.data?.jobId) {
        setActiveJobId(res.data.jobId);
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
              onClick={() => setActiveFramework("playwright")}
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
              onClick={() => setActiveFramework("cypress")}
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
              onChange={(e) => setExecutionMode(e.target.value)}
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
            className="text-xs h-9"
          >
            Export / Print Report
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            onClick={refreshData}
            disabled={loading || runningTests}
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
            {runningTests ? "Running System Tests..." : "Run System Tests"}
          </Button>
        </div>
      </div>

      {/* Real-time Progress Banner if running */}
      {runningTests && jobProgress && (
        <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 text-xs text-[var(--color-text)] space-y-2">
          <div className="flex items-center justify-between font-semibold">
            <div className="flex items-center gap-2">
              <Loader2 size={15} className="animate-spin text-[var(--color-primary)]" />
              <span>{jobProgress.stage || "Executing system tests"}</span>
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
          onSaved={() => {
            refreshData();
          }}
          onRunFinished={() => {
            refreshData();
          }}
        />
      )}
    </div>
  );
}
