import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  Sparkles,
  GitBranch,
  Cpu,
  FileCode,
  Search,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Code2,
  ExternalLink,
  FlaskConical,
  Clock,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Check,
  X,
  Zap,
  BarChart3,
  Network,
  Loader2,
  Layers,
  Activity,
} from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";
import {
  getCoverageFiles,
  getCoverageFrameworks,
  getCoverageFunctions,
  getCoverageSummary,
  getCoverageTestSuites,
  getTestExecution,
  runCoverageByType,
  getFileCoverage,
  suggestUnitTestcase,
  applyUnitTestSuggestion,
} from "../../services/coverage.service.js";
import {
  useCoverageDashboard,
  invalidateCoverageQueries,
  updateCoverageFilesData,
} from "../../hooks/useCoverageQuery.js";
import { getJobDetailApi, cancelJobApi, getProjectJobsApi } from "../../services/job.service.js";
import { queryClient } from "../../lib/queryClient.js";
import { getProjectCfgApi } from "../../services/project.service.js";
import FunctionExecutionFlow from "./FunctionExecutionFlow.jsx";
import FileCodeExecutionView from "./FileCodeExecutionView.jsx";
import FileBranchCFGView from "./FileBranchCFGView.jsx";
import FileFunctionCallGraphView from "./FileFunctionCallGraphView.jsx";
import UnitTestExecutionVisualizer from "./UnitTestExecutionVisualizer.jsx";
import CFGCalculator from "./CFGCalculator.jsx";
import WaveProgressBar from "./WaveProgressBar.jsx";
import InlineTestSuggestions from "./InlineTestSuggestions.jsx";
import { CoverageDashboardSkeleton } from "../common/Skeleton.jsx";
import { useRunningProcess } from "../../contexts/RunningProcessContext.jsx";

const CONFIG = {
  unit: {
    title: "Unit Test Coverage",
    subtitle: "Independent testing of functions, condition branches, and statements.",
    supported: "Jest · Vitest",
    accent: "#a78bfa",
    focus: ["Statements", "Branches", "Functions", "Lines"],
    explanation: [
      ["Statement coverage", "Percentage of statements executed by tests."],
      ["Branch coverage", "Percentage of if/else/switch condition paths executed."],
      ["Function coverage", "Percentage of functions or methods executed."],
    ],
  },
  integration: {
    title: "Integration Test Coverage",
    subtitle:
      "Verifying APIs and data exchange between frontend, backend, and services.",
    supported: "Playwright · Supertest",
    accent: "#fbbf24",
    focus: [
      "API files",
      "Covered API files",
      "Average coverage",
      "Critical APIs",
    ],
    explanation: [
      ["API contracts", "Request, response, status code, and returned data."],
      [
        "Frontend ↔ Backend",
        "API calls from UI to routes/controllers.",
      ],
      [
        "Service integration",
        "Controller flows, services, and database/dependencies.",
      ],
    ],
  },
  system: {
    title: "System Test Coverage",
    subtitle: "E2E testing of complete features from a user perspective.",
    supported: "Playwright · Cypress",
    accent: "#ec4899",
    focus: ["E2E tests", "Passed", "Failed", "Feature coverage"],
    explanation: [
      [
        "User journeys",
        "Auth flows, actions, and end-to-end business workflows.",
      ],
      [
        "Browser behavior",
        "UI, navigation, and browser interactions.",
      ],
      ["Full system", "Frontend, backend, and data working together."],
    ],
  },
};

const pct = (value) => `${Number(value || 0).toFixed(1)}%`;
const coverageColor = (value) =>
  value >= 80 ? "#22c55e" : value >= 60 ? "#fbbf24" : "#f87171";
const getCoverageColor = (value, isLight = false) => {
  if (isLight) {
    return value >= 80 ? "#16a34a" : value >= 60 ? "#d97706" : "#dc2626";
  }
  return coverageColor(value);
};
const apiFile = (file) =>
  /(^|\/)(api|routes?|controllers?|services?|endpoints?)(\/|\.|$)/i.test(
    file.filePath,
  );
const isTestFile = (filePath) => {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    /(^|\/)(tests?|__tests__|spec|cypress|e2e)\//i.test(normalized) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(normalized)
  );
};
const isFrontendFile = (filePath) => {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    /(^|\/)(client|frontend|components|pages|views)\//i.test(normalized) ||
    /\.[jt]sx(\?.*)?$/i.test(normalized) ||
    normalized.includes(".jsx") ||
    normalized.includes(".tsx")
  );
};

export const cleanDisplayPath = (fullPath = "") => {
  if (!fullPath) return "";
  let normalized = fullPath.replace(/\\/g, "/").replace(/^\.?\//, "").trim();

  // Match inside docker or repo storage: storage/projects/<id>/.../repo/<relativePath>
  const repoMatch = normalized.match(/(?:^|\/)repo\/(.+)$/i);
  if (repoMatch) return repoMatch[1].replace(/^\/+/, "");

  // If path ends with /repo or is just /app/storage/..., don't show full internal path
  if (/(?:^|\/)(?:repo|storage\/projects\/[^/]+(?:\/[^/]+)*)\/?$/i.test(normalized)) {
    return "";
  }

  const storageMatch = normalized.match(/(?:^|\/)storage\/projects\/[^/]+(?:\/[^/]+)*?\/(.+)$/i);
  if (storageMatch) return storageMatch[1].replace(/^\/+/, "");

  const uploadMatch = normalized.match(/(?:^|\/)uploads\/snapshots\/[^/]+(?:\/[^/]+)*?\/(.+)$/i);
  if (uploadMatch) return uploadMatch[1].replace(/^\/+/, "");

  normalized = normalized.replace(/^[a-zA-Z]:\//, "");
  normalized = normalized.replace(/^\/app\/storage\/?/i, "");
  return normalized.replace(/^\/+/, "");
};

export const sanitizeErrorText = (text = "") => {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/(?:\/app|[a-zA-Z]:[\\/][^ \t\r\n'\"()]*)?[\\/]storage[\\/]projects[\\/][^ \t\r\n'\"()]+(?:[\\/][^ \t\r\n'\"()]+)*?[\\/]repo[\\/]/gi, "")
    .replace(/(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/repo\//gi, "")
    .replace(/(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/snapshots\/[^\s'\"()]+\/coverage\//gi, "")
    .replace(/(?:\/app)?\/storage\/projects\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?/gi, "")
    .replace(/\/app\/storage\/?/gi, "");
};

export const resolveFunctionName = (fn, flowFunctions = []) => {
  if (
    fn?.realName &&
    !fn.realName.startsWith("(") &&
    !fn.realName.startsWith("anonymous")
  ) {
    return fn.realName;
  }
  const raw = fn?.functionName || "";
  if (raw && !raw.startsWith("(") && !raw.startsWith("anonymous")) {
    return raw;
  }
  if (Array.isArray(flowFunctions)) {
    const matched = flowFunctions.find(
      (f) => f.startLine === fn.startLine || f.line === fn.startLine,
    );
    if (
      matched?.realName &&
      !matched.realName.startsWith("(") &&
      !matched.realName.startsWith("anonymous")
    ) {
      return matched.realName;
    }
  }
  if (fn?.startLine) {
    return `func_L${fn.startLine}`;
  }
  return raw || "anonymous";
};

const cardStyle = {
  background: "rgba(255,255,255,.025)",
  border: "1px solid rgba(255,255,255,.075)",
  borderRadius: 12,
  padding: 17,
};
const buttonStyle = (color) => ({
  background: `${color}18`,
  color,
  border: `1px solid ${color}55`,
  borderRadius: 8,
  padding: "8px 14px",
  fontWeight: 650,
  cursor: "pointer",
});

export function PaginationControl({
  currentPage,
  totalItems,
  pageSize = 50,
  onPageChange,
  isLight = false,
  itemLabel = "files",
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems === 0) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = [1];
    let left = Math.max(2, currentPage - 1);
    let right = Math.min(totalPages - 1, currentPage + 1);

    if (currentPage <= 3) {
      right = 4;
    } else if (currentPage >= totalPages - 2) {
      left = totalPages - 3;
    }

    if (left > 2) pages.push("...");
    for (let i = left; i <= right; i++) {
      pages.push(i);
    }
    if (right < totalPages - 1) pages.push("...");
    pages.push(totalPages);
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div
      style={{
        padding: "10px 18px",
        borderTop: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
        background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        fontSize: 12,
      }}
    >
      <div style={{ color: isLight ? "#64748b" : "#94a3b8", display: "flex", alignItems: "center", gap: 5 }}>
        <span>Showing</span>
        <b style={{ color: isLight ? "#0f172a" : "#f1f5f9" }}>{startItem} – {endItem}</b>
        <span>of</span>
        <b style={{ color: isLight ? "#0f172a" : "#f1f5f9" }}>{totalItems}</b>
        <span>{itemLabel} (Page {currentPage} / {totalPages})</span>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            style={{
              padding: "3px 8px",
              borderRadius: 5,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
              color: currentPage === 1 ? (isLight ? "#cbd5e1" : "#475569") : (isLight ? "#334155" : "#e2e8f0"),
              cursor: currentPage === 1 ? "not-allowed" : "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
            title="First page"
          >
            « First
          </button>

          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            style={{
              padding: "3px 9px",
              borderRadius: 5,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
              color: currentPage === 1 ? (isLight ? "#cbd5e1" : "#475569") : (isLight ? "#334155" : "#e2e8f0"),
              cursor: currentPage === 1 ? "not-allowed" : "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
            title="Previous page"
          >
            ‹ Prev
          </button>

          {pages.map((p, idx) => {
            if (p === "...") {
              return (
                <span key={`dots-${idx}`} style={{ color: isLight ? "#94a3b8" : "#64748b", padding: "0 2px" }}>
                  ...
                </span>
              );
            }
            const isCurrent = p === currentPage;
            return (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                style={{
                  minWidth: 26,
                  height: 26,
                  padding: "0 6px",
                  borderRadius: 5,
                  background: isCurrent
                    ? (isLight ? "#7c3aed" : "rgba(124, 58, 237, 0.3)")
                    : (isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)"),
                  border: isCurrent
                    ? (isLight ? "1px solid #7c3aed" : "1px solid rgba(192, 132, 252, 0.5)")
                    : (isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)"),
                  color: isCurrent
                    ? (isLight ? "#ffffff" : "#c084fc")
                    : (isLight ? "#334155" : "#e2e8f0"),
                  fontWeight: isCurrent ? 700 : 500,
                  fontSize: 11.5,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {p}
              </button>
            );
          })}

          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            style={{
              padding: "3px 9px",
              borderRadius: 5,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
              color: currentPage === totalPages ? (isLight ? "#cbd5e1" : "#475569") : (isLight ? "#334155" : "#e2e8f0"),
              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
            title="Next page"
          >
            Next ›
          </button>

          <button
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            style={{
              padding: "3px 8px",
              borderRadius: 5,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
              color: currentPage === totalPages ? (isLight ? "#cbd5e1" : "#475569") : (isLight ? "#334155" : "#e2e8f0"),
              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
            title="Last page"
          >
            Last »
          </button>
        </div>
      )}
    </div>
  );
}

async function waitForJob(jobId, onProgress) {
  let lastProgress = 8;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await getJobDetailApi(jobId);
    const job = response?.job;
    if (job) {
      const prog = typeof job.progress === "number" ? Math.max(lastProgress, job.progress) : lastProgress;
      lastProgress = prog;
      if (onProgress) {
        onProgress(prog, job.status);
      }
    }
    if (job?.status === "SUCCESS") {
      if (onProgress) onProgress(100, "SUCCESS");
      return;
    }
    if (["FAILED", "CANCELED"].includes(job?.status))
      throw new Error(
        job?.errorMessage ||
          job?.error ||
          `${job.status}: coverage analysis failed.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  try {
    await cancelJobApi(jobId);
  } catch (_) { }
  throw new Error("Coverage analysis timed out. The job was automatically paused/canceled to unblock the project.");
}

export const invalidateDashboardCache = (snapshotId) => {
  invalidateCoverageQueries(snapshotId);
};

export default function CoverageTypeDashboard({
  type,
  snapshotId,
  projectId,
  onOpenFile,
  onGenerate,
  generating,
  onSuggestTestcase,
  onOpenCFG,
  runTrigger,
}) {
  const config = CONFIG[type];
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  // React Query cached dashboard data - instant render on tab switch without loading lag
  const {
    data: coverageData,
    isLoading: isCoverageQueryLoading,
    isFetching: isCoverageQueryFetching,
    refetch: refetchCoverage,
  } = useCoverageDashboard(snapshotId, type, projectId);

  const summary = coverageData?.summary || null;
  const files = coverageData?.files || [];
  const executions = coverageData?.executions || {};
  const frameworks = coverageData?.frameworks || null;
  const functionsList = coverageData?.functionsList || [];
  const testSuites = coverageData?.testSuites || [];

  // Instant render: non-blocking loading only if cold fetch has zero cached data
  const loading = !coverageData && isCoverageQueryLoading && Boolean(snapshotId);
  const loadingFunctions = !coverageData?.functionsList?.length && isCoverageQueryLoading && type === "unit";
  const loadingTestSuites = !coverageData?.testSuites?.length && isCoverageQueryLoading && type === "unit";

  const {
    processes,
    startAnalysis,
    updateAnalysisProgress,
    completeAnalysis,
    startSuggestion,
    updateSuggestionProgress,
    completeSuggestion,
    startBulkApply,
    updateBulkApplyStep,
    completeBulkApply,
    getSuggestions,
    saveSuggestions,
    saveFileSuggestions,
  } = useRunningProcess();

  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runStep, setRunStep] = useState("");
  const [error, setError] = useState("");
  const [activeFramework, setActiveFramework] = useState("");
  const [generateError, setGenerateError] = useState("");

  // Mode view for Unit test: "testcases" (default for unit) | "visualization" | "all" | "statements" | "branches" | "functions"
  const [activeMetricView, setActiveMetricView] = useState(
    type === "unit" ? "testcases" : "all",
  );

  // View mode for Unit Testcases: "table" | "visualization"
  const [testCaseViewMode, setTestCaseViewMode] = useState("table");

  // View mode for Function coverage
  const [functionViewMode, setFunctionViewMode] = useState("map"); // "map" | "table"
  const [selectedSourceFile, setSelectedSourceFile] = useState("");
  const [flowData, setFlowData] = useState(null);
  const [loadingFlow, setLoadingFlow] = useState(false);
  const [showCfgModal, setShowCfgModal] = useState(false);

  // Multi-accordion state: Set of expanded filePaths (supports opening File A, File B, File C simultaneously)
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [fileCoverageCache, setFileCoverageCache] = useState({});

  // Inline suggestions state by filePath: { [filePath]: [suggestion1, ...] }
  // Initialized from persistent cache so switching pages or reloading never loses generated tests
  const [inlineSuggestions, setInlineSuggestions] = useState(() => {
    return (snapshotId ? getSuggestions(snapshotId) : {}) || {};
  });
  const [loadingSuggestions, setLoadingSuggestions] = useState({});
  const [applyingSuggestionIds, setApplyingSuggestionIds] = useState(new Set());
  const [applyResultsByFile, setApplyResultsByFile] = useState({});
  const [applyProgressSteps, setApplyProgressSteps] = useState({});

  // Restore cached suggestions if snapshotId changes
  useEffect(() => {
    if (snapshotId) {
      const cached = getSuggestions(snapshotId);
      if (cached && Object.keys(cached).length > 0) {
        setInlineSuggestions((prev) => ({
          ...cached,
          ...prev,
        }));
      }
    }
  }, [snapshotId, getSuggestions]);

  // Synchronize cached suggestions whenever inlineSuggestions changes (avoids calling setState during render phase)
  useEffect(() => {
    if (snapshotId && inlineSuggestions && Object.keys(inlineSuggestions).length > 0) {
      saveSuggestions(snapshotId, inlineSuggestions);
    }
  }, [snapshotId, inlineSuggestions, saveSuggestions]);

  // Sync analysis running state with runningProcessContext
  useEffect(() => {
    if (processes.analysis.isRunning && processes.analysis.snapshotId === snapshotId) {
      setRunning(true);
      if (typeof processes.analysis.progress === "number") {
        setRunProgress(processes.analysis.progress);
      }
      if (processes.analysis.step) {
        setRunStep(processes.analysis.step);
      }
    }
  }, [processes.analysis, snapshotId]);

  // Ensure file coverage data is always available in cache when a file is viewed/expanded
  const ensureFileCoverage = useCallback(
    async (filePath, force = false) => {
      if (!snapshotId || !filePath) return null;
      if (!force && fileCoverageCache[filePath]?.data) return fileCoverageCache[filePath].data;

      setFileCoverageCache((prev) => ({
        ...prev,
        [filePath]: { loading: true },
      }));

      try {
        const res = await queryClient.fetchQuery({
          queryKey: ["fileCoverage", snapshotId, filePath],
          queryFn: () => getFileCoverage(snapshotId, filePath),
          staleTime: force ? 0 : 15 * 60 * 1000,
        });
        const data = res?.data || res;
        setFileCoverageCache((prev) => ({
          ...prev,
          [filePath]: { loading: false, data },
        }));
        return data;
      } catch (err) {
        console.warn("Error fetching file coverage for", filePath, err);
        setFileCoverageCache((prev) => ({
          ...prev,
          [filePath]: { loading: false, error: err.message },
        }));
        return null;
      }
    },
    [snapshotId, fileCoverageCache],
  );

  const toggleExpandFile = useCallback(
    async (filePath) => {
      setExpandedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(filePath)) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        return next;
      });

      // Automatically fetch file coverage details if not yet in cache
      ensureFileCoverage(filePath);
    },
    [ensureFileCoverage],
  );

  // Trigger inline suggestion generation directly below the source file without opening separate screen
  const handleSuggestTestcaseInline = useCallback(
    async (filePath) => {
      if (!snapshotId || !filePath) return;
      // Auto-expand this file so the suggestion displays immediately inline
      setExpandedFiles((prev) => new Set(prev).add(filePath));
      // Pre-load coverage data so execution view displays smoothly without error
      ensureFileCoverage(filePath);

      setLoadingSuggestions((prev) => ({ ...prev, [filePath]: true }));
      try {
        const res = await suggestUnitTestcase(snapshotId, filePath, projectId, activeFramework);
        const data = res?.data || res;
        const sugs = Array.isArray(data?.suggestions)
          ? data.suggestions
          : (data?.suggestion ? [data.suggestion] : (Array.isArray(data) ? data : []));
        const finalSugs = sugs.length > 0 ? sugs : (data ? [data] : []);

        const mappedSugs = finalSugs.map((s, idx) => ({
          ...s,
          suggestionId: s.suggestionId || `${filePath}-sug-${idx + 1}`,
          status: s.status || "GENERATED",
        }));

        setInlineSuggestions((prev) => ({
          ...prev,
          [filePath]: mappedSugs,
        }));
        return mappedSugs;
      } catch (err) {
        console.error("Failed to generate test suggestions inline:", err);
        return [];
      } finally {
        setLoadingSuggestions((prev) => ({ ...prev, [filePath]: false }));
      }
    },
    [snapshotId, projectId, activeFramework, ensureFileCoverage, saveSuggestions],
  );

  // Auto-fetch file coverage details for any expanded file if missing from cache
  useEffect(() => {
    expandedFiles.forEach((fPath) => {
      if (!fileCoverageCache[fPath]) {
        ensureFileCoverage(fPath);
      }
    });
  }, [expandedFiles, fileCoverageCache, ensureFileCoverage]);


  // Apply single suggestion inline, execute runner, update real coverage
  const handleApplySuggestionInline = useCallback(
    async (filePath, suggestion) => {
      if (!snapshotId || !suggestion) return;
      const sugId = suggestion.suggestionId || suggestion.id;
      setApplyingSuggestionIds((prev) => new Set(prev).add(sugId));
      setApplyProgressSteps((prev) => ({
        ...prev,
        [filePath]: "Writing modified test file to disk...",
      }));

      // Status transition: GENERATED/EDITED -> APPLYING
      setInlineSuggestions((prev) => {
        const fileSugs = prev[filePath] || [];
        return {
          ...prev,
          [filePath]: fileSugs.map((s) =>
            (s.suggestionId === sugId || s.id === sugId)
              ? { ...s, status: "APPLYING" }
              : s,
          ),
        };
      });

      try {
        setApplyProgressSteps((prev) => ({
          ...prev,
          [filePath]: "Executing test runner & verifying real new coverage...",
        }));

        const res = await applyUnitTestSuggestion(snapshotId, {
          suggestion,
          projectId,
        });

        const resultData = res?.data || res;
        const testStatus = resultData?.testStatus || resultData?.status;
        const isPassed = testStatus === "PASSED" || resultData?.success === true;

        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) =>
              (s.suggestionId === sugId || s.id === sugId)
                ? {
                  ...s,
                  status: isPassed ? "PASSED" : "FAILED",
                  testRunError: resultData?.testRunError || resultData?.errorDetail || resultData?.message || null,
                }
                : s,
            ),
          };
        });

        const fileResult = resultData?.perFileResults?.[filePath];
        const currentFile = selectedFiles.find((f) => f.filePath === filePath);
        const currentFileCov = currentFile ? {
          statements: currentFile.stmtsPct || 0,
          branches: currentFile.branchesPct || 0,
          functions: currentFile.funcsPct || 0,
          lines: currentFile.linesPct || 0,
        } : null;

        const oldCov = fileResult?.oldCoverage || currentFileCov || resultData?.previousCoverage;
        const newCov = fileResult?.newCoverage || currentFileCov || resultData?.newCoverage;

        if (oldCov && newCov) {
          setApplyResultsByFile((prev) => ({
            ...prev,
            [filePath]: {
              ...resultData,
              oldCoverage: oldCov,
              newCoverage: newCov,
              isPassed,
            },
          }));
        }

        if (resultData?.perFileResults) {
          updateCoverageFilesData(snapshotId, type, projectId, resultData.perFileResults);
        }

        // Invalidate cached query data and refetch new verified coverage from test runner
        invalidateCoverageQueries(snapshotId);
        await refetchCoverage();

        // Refresh file coverage in-place so FileCodeExecutionView immediately updates with fresh hits & lines
        await ensureFileCoverage(filePath, true);
      } catch (err) {
        console.error("Failed to apply suggestion:", err);
        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) =>
              (s.suggestionId === sugId || s.id === sugId)
                ? { ...s, status: "FAILED", testRunError: err.message }
                : s,
            ),
          };
        });
      } finally {
        setApplyingSuggestionIds((prev) => {
          const next = new Set(prev);
          next.delete(sugId);
          return next;
        });
        setApplyProgressSteps((prev) => {
          const next = { ...prev };
          delete next[filePath];
          return next;
        });
      }
    },
    [snapshotId, projectId, refetchCoverage, ensureFileCoverage],
  );

  // Apply all suggestions inline safely without overwriting
  const handleApplyAllInline = useCallback(
    async (filePath, suggestions) => {
      if (!snapshotId || !suggestions?.length) return;
      const sugIds = suggestions.map((s) => s.suggestionId || s.id);
      setApplyingSuggestionIds((prev) => {
        const next = new Set(prev);
        sugIds.forEach((id) => next.add(id));
        return next;
      });

      setApplyProgressSteps((prev) => ({
        ...prev,
        [filePath]: `Applying ${suggestions.length} suggestions safely without conflicts...`,
      }));

      setInlineSuggestions((prev) => {
        const fileSugs = prev[filePath] || [];
        return {
          ...prev,
          [filePath]: fileSugs.map((s) =>
            sugIds.includes(s.suggestionId || s.id)
              ? { ...s, status: "APPLYING" }
              : s,
          ),
        };
      });

      try {
        setApplyProgressSteps((prev) => ({
          ...prev,
          [filePath]: "Running tests to measure verified new coverage...",
        }));

        const res = await applyUnitTestSuggestion(snapshotId, {
          suggestions,
          projectId,
        });

        const resultData = res?.data || res;
        const testStatus = resultData?.testStatus || resultData?.status;
        const isPassed = testStatus === "PASSED" || resultData?.success === true;

        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) =>
              sugIds.includes(s.suggestionId || s.id)
                ? {
                  ...s,
                  status: isPassed ? "PASSED" : "FAILED",
                  testRunError: resultData?.testRunError || resultData?.errorDetail || resultData?.message || null,
                }
                : s,
            ),
          };
        });

        const fileResult = resultData?.perFileResults?.[filePath];
        const currentFile = selectedFiles.find((f) => f.filePath === filePath);
        const currentFileCov = currentFile ? {
          statements: currentFile.stmtsPct || 0,
          branches: currentFile.branchesPct || 0,
          functions: currentFile.funcsPct || 0,
          lines: currentFile.linesPct || 0,
        } : null;

        const oldCov = fileResult?.oldCoverage || currentFileCov || resultData?.previousCoverage;
        const newCov = fileResult?.newCoverage || currentFileCov || resultData?.newCoverage;

        if (oldCov && newCov) {
          setApplyResultsByFile((prev) => ({
            ...prev,
            [filePath]: {
              ...resultData,
              oldCoverage: oldCov,
              newCoverage: newCov,
              isPassed,
            },
          }));
        }

        if (resultData?.perFileResults) {
          updateCoverageFilesData(snapshotId, type, projectId, resultData.perFileResults);
        }

        invalidateCoverageQueries(snapshotId);
        await refetchCoverage();

        // Refresh file coverage in-place so FileCodeExecutionView immediately updates with fresh hits & lines
        await ensureFileCoverage(filePath, true);
      } catch (err) {
        console.error("Failed to apply all suggestions:", err);
      } finally {
        setApplyingSuggestionIds((prev) => {
          const next = new Set(prev);
          sugIds.forEach((id) => next.delete(id));
          return next;
        });
        setApplyProgressSteps((prev) => {
          const next = { ...prev };
          delete next[filePath];
          return next;
        });
      }
    },
    [snapshotId, projectId, refetchCoverage, ensureFileCoverage],
  );

  // Reject a suggestion
  const handleRejectInline = useCallback((filePath, sugId) => {
    setInlineSuggestions((prev) => {
      const fileSugs = prev[filePath] || [];
      return {
        ...prev,
        [filePath]: fileSugs.map((s) =>
          (s.suggestionId === sugId || s.id === sugId)
            ? { ...s, status: "REJECTED" }
            : s,
        ),
      };
    });
  }, []);

  // Update code for a specific suggestion in a file (from direct line editing)
  const handleUpdateSuggestionCode = useCallback((filePath, sugId, newCode) => {
    setInlineSuggestions((prev) => {
      const fileSugs = prev[filePath] || [];
      return {
        ...prev,
        [filePath]: fileSugs.map((s) =>
          (s.suggestionId === sugId || s.id === sugId)
            ? { ...s, generatedCode: newCode, suggestedTestCode: newCode, status: "EDITED" }
            : s,
        ),
      };
    });
  }, [snapshotId, saveSuggestions]);

  // Compute all pending suggestions across all files - strictly for Unit Tests
  const allPendingSuggestions = useMemo(() => {
    if (type !== "unit") return [];
    const list = [];
    Object.entries(inlineSuggestions).forEach(([fPath, sugs]) => {
      (sugs || []).forEach((s) => {
        if (s.status !== "REJECTED" && s.status !== "PASSED" && s.status !== "APPLIED") {
          list.push({ ...s, sourceFile: s.sourceFile || fPath });
        }
      });
    });
    return list;
  }, [inlineSuggestions, type]);

  const filesWithPendingSuggestions = useMemo(() => {
    const set = new Set();
    allPendingSuggestions.forEach((s) => set.add(s.sourceFile || s.filePath));
    return Array.from(set);
  }, [allPendingSuggestions]);

  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [bulkApplyStep, setBulkApplyStep] = useState("");

  // Apply all suggestions across all files simultaneously
  const handleApplyAllGlobal = useCallback(async () => {
    if (!snapshotId || allPendingSuggestions.length === 0 || isBulkApplying) return;

    setIsBulkApplying(true);
    const stepMsg = `Applying ${allPendingSuggestions.length} test suggestions across ${filesWithPendingSuggestions.length} files...`;
    setBulkApplyStep(stepMsg);
    startBulkApply({
      snapshotId,
      projectId,
      totalCount: allPendingSuggestions.length,
      step: stepMsg,
    });

    const allSugIds = allPendingSuggestions.map((s) => s.suggestionId || s.id);
    setApplyingSuggestionIds((prev) => {
      const next = new Set(prev);
      allSugIds.forEach((id) => next.add(id));
      return next;
    });

    setInlineSuggestions((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((fPath) => {
        next[fPath] = (next[fPath] || []).map((s) =>
          allSugIds.includes(s.suggestionId || s.id) ? { ...s, status: "APPLYING" } : s
        );
      });
      return next;
    });

    try {
      const runnerStep = "Executing test suites to verify coverage increase...";
      setBulkApplyStep(runnerStep);
      updateBulkApplyStep(runnerStep);

      const cleanedSuggestions = allPendingSuggestions.map((s) => ({
        suggestionId: s.suggestionId || s.id,
        sourceFile: s.sourceFile,
        testFile: s.testFile || s.targetTestFile,
        generatedCode: s.generatedCode || s.suggestedTestCode,
        suggestedTestCode: s.suggestedTestCode || s.generatedCode,
        framework: s.framework,
        targetLines: s.targetLines,
        targetBranches: s.targetBranches,
      }));

      const res = await applyUnitTestSuggestion(snapshotId, {
        suggestions: cleanedSuggestions,
        projectId,
      });

      const resultData = res?.data || res;
      const testStatus = resultData?.testStatus || resultData?.status;
      const isPassed = testStatus === "PASSED" || resultData?.success === true;

      setInlineSuggestions((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((fPath) => {
          next[fPath] = (next[fPath] || []).map((s) => {
            const sid = s.suggestionId || s.id;
            if (allSugIds.includes(sid)) {
              const matchedApplied = (resultData?.appliedSuggestions || []).find(
                (a) => (a.suggestionId || a.id) === sid
              );
              const itemPassed = matchedApplied
                ? matchedApplied.status === "PASSED"
                : isPassed;
              return {
                ...s,
                status: itemPassed ? "PASSED" : "FAILED",
                testRunError: !itemPassed
                  ? (matchedApplied?.error || resultData?.testRunError || resultData?.errorDetail || resultData?.message || null)
                  : null,
              };
            }
            return s;
          });
        });
        return next;
      });

      filesWithPendingSuggestions.forEach((fPath) => {
        const fileResult = resultData?.perFileResults?.[fPath];
        const currentFile = selectedFiles.find((f) => f.filePath === fPath);
        const currentFileCov = currentFile ? {
          statements: currentFile.stmtsPct || 0,
          branches: currentFile.branchesPct || 0,
          functions: currentFile.funcsPct || 0,
          lines: currentFile.linesPct || 0,
        } : null;

        const oldCov = fileResult?.oldCoverage || currentFileCov || resultData?.previousCoverage;
        const newCov = fileResult?.newCoverage || currentFileCov || resultData?.newCoverage;

        if (oldCov && newCov) {
          setApplyResultsByFile((prev) => ({
            ...prev,
            [fPath]: {
              ...resultData,
              oldCoverage: oldCov,
              newCoverage: newCov,
              isPassed,
            },
          }));
        }
      });

      if (resultData?.perFileResults) {
        updateCoverageFilesData(snapshotId, type, projectId, resultData.perFileResults);
      }

      setBulkSuggestMessage(
        isPassed
          ? `✓ Successfully applied ${allPendingSuggestions.length} test suggestions across ${filesWithPendingSuggestions.length} files! Coverage updated.`
          : `Applied ${allPendingSuggestions.length} suggestions (Runner reported some failures).`
      );

      completeBulkApply(resultData);
      invalidateCoverageQueries(snapshotId);
      await refetchCoverage();

      await Promise.all(filesWithPendingSuggestions.map((fPath) => ensureFileCoverage(fPath, true)));
    } catch (err) {
      console.error("Failed to apply all suggestions globally:", err);
      setBulkSuggestMessage(`Error applying suggestions: ${err.message}`);
      completeBulkApply({ error: err.message });
    } finally {
      setIsBulkApplying(false);
      setBulkApplyStep("");
      setApplyingSuggestionIds((prev) => {
        const next = new Set(prev);
        allSugIds.forEach((id) => next.delete(id));
        return next;
      });
      setTimeout(() => setBulkSuggestMessage(""), 10000);
    }
  }, [snapshotId, allPendingSuggestions, filesWithPendingSuggestions, isBulkApplying, projectId, refetchCoverage, ensureFileCoverage, startBulkApply, updateBulkApplyStep, completeBulkApply, saveSuggestions]);

  // Test suites & functions search and filter state
  const [expandedSuite, setExpandedSuite] = useState(null);
  const [testSuiteSearch, setTestSuiteSearch] = useState("");
  const [functionSearch, setFunctionSearch] = useState("");
  const [functionStatusFilter, setFunctionStatusFilter] = useState("all");

  // Pagination states (50 items per page)
  const [sourceFilePage, setSourceFilePage] = useState(1);
  const [sourceFileSearch, setSourceFileSearch] = useState("");
  const SOURCE_FILES_PER_PAGE = 50;

  const [testSuitePage, setTestSuitePage] = useState(1);
  const TEST_SUITES_PER_PAGE = 50;

  const [functionPage, setFunctionPage] = useState(1);
  const FUNCTIONS_PER_PAGE = 50;

  // Reset pagination when search or filters change
  useEffect(() => {
    setSourceFilePage(1);
  }, [activeMetricView, type, sourceFileSearch]);

  useEffect(() => {
    setTestSuitePage(1);
  }, [testSuiteSearch]);

  useEffect(() => {
    setFunctionPage(1);
  }, [functionSearch, functionStatusFilter]);

  const loadFlowData = useCallback(
    async (filePath) => {
      if (!snapshotId || !filePath) return;
      setLoadingFlow(true);
      try {
        const res = await queryClient.fetchQuery({
          queryKey: ["fileCoverage", snapshotId, filePath],
          queryFn: () => getFileCoverage(snapshotId, filePath),
          staleTime: 15 * 60 * 1000,
        });
        setFlowData(res?.data || res || null);
      } catch (err) {
        console.warn("Could not load file coverage flow:", err);
        setFlowData(null);
      } finally {
        setLoadingFlow(false);
      }
    },
    [snapshotId],
  );

  const run = async () => {
    if (!snapshotId || running) return;
    setRunning(true);
    setRunProgress(8);
    const initialStep = type === "system"
      ? "Initializing E2E system testing environment..."
      : type === "integration"
        ? "Initializing API integration test environment..."
        : "Initializing unit test analysis environment...";
    setRunStep(initialStep);
    setError("");
    startAnalysis({ snapshotId, projectId, type });
    try {
      let response;
      try {
        response = await runCoverageByType(snapshotId, type);
      } catch (err) {
        if (err.message && (err.message.includes("already queued") || err.message.includes("running") || err.message.includes("409"))) {
          const projJobs = await getProjectJobsApi(projectId).catch(() => ({ jobs: [] }));
          const active = (projJobs.jobs || []).find((j) => ["QUEUED", "RUNNING"].includes(j.status));
          if (active) {
            response = { data: { jobs: [active] } };
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      const fw = response.data?.framework || (type === "unit" ? "jest & vitest" : type === "system" ? "playwright · cypress" : "supertest");
      setActiveFramework(fw);
      const jobs = response.data?.jobs || (response.data?.job ? [response.data.job] : []);
      if (jobs.length === 0) throw new Error("Backend did not return test run jobs.");
      for (const j of jobs) {
        if (j?.id) {
          startAnalysis({ snapshotId, projectId, type, jobId: j.id });
          await waitForJob(j.id, (prog) => {
            setRunProgress(prog);
            let s = "Preparing execution environment...";
            if (type === "system") {
              if (prog <= 25) {
                s = "Preparing Playwright & Cypress browser drivers...";
              } else if (prog <= 65) {
                s = "Executing E2E user journeys & browser automation...";
              } else if (prog <= 85) {
                s = "Collecting system coverage & session recordings...";
              } else if (prog < 100) {
                s = "Calculating end-to-end feature coverage metrics...";
              } else {
                s = "System test execution completed!";
              }
            } else if (type === "integration") {
              if (prog <= 25) {
                s = "Preparing Supertest integration test suite...";
              } else if (prog <= 70) {
                s = "Executing HTTP route endpoints & assertions...";
              } else if (prog < 100) {
                s = "Calculating API integration coverage metrics...";
              } else {
                s = "Integration test execution completed!";
              }
            } else {
              if (prog <= 20) {
                s = "Preparing dependencies & Docker environment...";
              } else if (prog <= 45) {
                s = "Running Jest unit test suites & generating coverage...";
              } else if (prog <= 65) {
                s = "Running Vitest unit test suites & generating coverage...";
              } else if (prog <= 85) {
                s = "Merging multi-framework coverage & analyzing AST functions...";
              } else if (prog < 100) {
                s = "Saving analysis results & syncing data...";
              } else {
                s = "Test analysis completed!";
              }
            }
            setRunStep(s);
            updateAnalysisProgress(prog, s);
          });
        }
      }
      setRunProgress(100);
      setRunStep(type === "system" ? "System test completed successfully!" : "Analysis completed successfully!");
      completeAnalysis(true);
      invalidateCoverageQueries(snapshotId);
      await refetchCoverage();
    } catch (runError) {
      setError(runError.message || "Analysis process failed.");
      completeAnalysis(false, runError.message);
    } finally {
      setTimeout(() => {
        setRunning(false);
        setRunProgress(0);
        setRunStep("");
      }, 1800);
    }
  };

  useEffect(() => {
    if (runTrigger > 0 && snapshotId && !running) {
      run();
    }
  }, [runTrigger]);

  const cov = summary?.coverage || {};
  const rawTotals = summary?.rawTotals || null;

  const getPctVal = (covVal, rawMetric) => {
    if (rawMetric) {
      const total = Number(rawMetric.total || 0);
      const covered = Number(rawMetric.covered || 0);
      if (total === 0 && covered === 0) {
        return 0;
      }
      if (rawMetric.pct != null && !isNaN(Number(rawMetric.pct))) {
        if (total === 0 && covered === 0) {
          return 0;
        }
        return Number(rawMetric.pct);
      }
      if (total > 0) {
        return (covered / total) * 100;
      }
    }
    const parsedCov = covVal != null && covVal !== "" ? Number(covVal) : null;
    if (parsedCov !== null && !isNaN(parsedCov)) {
      return parsedCov;
    }
    return 0;
  };

  const statPct = getPctVal(cov.statements, rawTotals?.statements);
  let branchPct = getPctVal(cov.branches, rawTotals?.branches);
  const funcPct = getPctVal(cov.functions, rawTotals?.functions);
  const linePct = getPctVal(cov.lines, rawTotals?.lines);

  // If 0% statements or lines are covered, branch coverage cannot be 100%
  const branchesCovered = Number(rawTotals?.branches?.covered || 0);
  const stmtsCovered = Number(rawTotals?.statements?.covered || 0);
  const linesCovered = Number(rawTotals?.lines?.covered || 0);
  if (branchesCovered === 0 && (statPct === 0 || linePct === 0 || (stmtsCovered === 0 && linesCovered === 0))) {
    branchPct = 0;
  }

  const selectedFiles = useMemo(() => {
    let nonTestFiles = files.filter((f) => !isTestFile(f.filePath));
    if (type === "unit") {
      nonTestFiles = nonTestFiles.filter((f) => {
        if (isFrontendFile(f.filePath)) return false;
        const norm = (f.filePath || "").replace(/\\/g, "/").toLowerCase();
        const isRouteOrEntry = /(^|\/)(routes?|endpoints?)(\/|\.|$)/i.test(norm) ||
          /\.(route|routes)\.[cm]?[jt]sx?$/i.test(norm) ||
          /(^|\/)(app|server)\.[cm]?[jt]sx?$/i.test(norm) ||
          /^(src\/)?(index|main)\.[cm]?[jt]sx?$/i.test(norm.replace(/^\.?\//, ""));
        return !isRouteOrEntry;
      });
    }
    return type === "integration" ? nonTestFiles.filter(apiFile) : nonTestFiles;
  }, [files, type]);

  // Display files sorted/filtered by active metric view
  const displayFiles = useMemo(() => {
    if (activeMetricView === "statements") {
      return [...selectedFiles].sort(
        (a, b) => (a.stmtsPct || 0) - (b.stmtsPct || 0),
      );
    }
    if (activeMetricView === "branches") {
      return [...selectedFiles].sort(
        (a, b) => (a.branchesPct || 0) - (b.branchesPct || 0),
      );
    }
    return selectedFiles;
  }, [selectedFiles, activeMetricView]);

  // Filtered source files with search
  const filteredSourceFiles = useMemo(() => {
    let list = displayFiles;
    if (sourceFileSearch.trim()) {
      const q = sourceFileSearch.toLowerCase();
      list = list.filter((f) => f.filePath?.toLowerCase().includes(q));
    }
    return list;
  }, [displayFiles, sourceFileSearch]);

  // Paginated source files (50 per page)
  const paginatedSourceFiles = useMemo(() => {
    const start = (sourceFilePage - 1) * SOURCE_FILES_PER_PAGE;
    return filteredSourceFiles.slice(start, start + SOURCE_FILES_PER_PAGE);
  }, [filteredSourceFiles, sourceFilePage]);

  // Sync selectedSourceFile when displayFiles load
  useEffect(() => {
    if (displayFiles.length > 0) {
      if (
        !selectedSourceFile ||
        !displayFiles.some((f) => f.filePath === selectedSourceFile)
      ) {
        setSelectedSourceFile(displayFiles[0].filePath);
      }
    }
  }, [displayFiles, selectedSourceFile]);

  // Load flow data when selectedSourceFile changes or metric view changes to statements/branches/functions
  useEffect(() => {
    if (
      selectedSourceFile &&
      (activeMetricView === "statements" ||
        activeMetricView === "branches" ||
        activeMetricView === "functions")
    ) {
      loadFlowData(selectedSourceFile);
    }
  }, [selectedSourceFile, activeMetricView, loadFlowData]);

  // Filtered functions list for Function Coverage view
  const filteredFunctions = useMemo(() => {
    let list = functionsList.filter((f) => !isTestFile(f.filePath));
    if (type === "unit") {
      list = list.filter((f) => !isFrontendFile(f.filePath));
    }
    if (functionStatusFilter === "covered") {
      list = list.filter((f) => f.hit > 0);
    } else if (functionStatusFilter === "uncovered") {
      list = list.filter((f) => f.hit === 0);
    }
    if (functionSearch.trim()) {
      const q = functionSearch.toLowerCase();
      list = list.filter(
        (f) =>
          f.functionName?.toLowerCase().includes(q) ||
          f.filePath?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [functionsList, functionStatusFilter, functionSearch, type]);

  // Paginated functions (50 per page)
  const paginatedFunctions = useMemo(() => {
    const start = (functionPage - 1) * FUNCTIONS_PER_PAGE;
    return filteredFunctions.slice(start, start + FUNCTIONS_PER_PAGE);
  }, [filteredFunctions, functionPage]);

  // Unit test suites list (Jest & Vitest backend test files only)
  const unitTestSuites = useMemo(() => {
    let list = testSuites;
    if (type === "unit") {
      list = list.filter((s) => !isFrontendFile(s.filePath) && !isFrontendFile(s.fileName));
    }
    return list;
  }, [testSuites, type]);

  // Filtered unit test suites list (Jest & Vitest test files only)
  const filteredTestSuites = useMemo(() => {
    if (!testSuiteSearch.trim()) return unitTestSuites;
    const q = testSuiteSearch.toLowerCase();
    return unitTestSuites.filter(
      (s) =>
        s.filePath?.toLowerCase().includes(q) ||
        s.fileName?.toLowerCase().includes(q) ||
        s.framework?.toLowerCase().includes(q),
    );
  }, [unitTestSuites, testSuiteSearch]);

  // Paginated test suites (50 per page)
  const paginatedTestSuites = useMemo(() => {
    const start = (testSuitePage - 1) * TEST_SUITES_PER_PAGE;
    return filteredTestSuites.slice(start, start + TEST_SUITES_PER_PAGE);
  }, [filteredTestSuites, testSuitePage]);

  // Bulk suggest tests based on Source File coverage (Lines, Branches, Funcs, Stmts)
  // Generates suggestions directly inline below each file without redirecting to a separate panel
  const [isBulkSuggesting, setIsBulkSuggesting] = useState(false);
  const [bulkSuggestMessage, setBulkSuggestMessage] = useState("");

  const handleBulkSuggestTest = async () => {
    let sourceFiles = selectedFiles;
    if ((!sourceFiles || sourceFiles.length === 0) && snapshotId) {
      try {
        const res = await getCoverageFiles(snapshotId, { sortBy: "linesPct", order: "asc", limit: 200, type });
        sourceFiles = res?.data?.files?.filter((f) => !isTestFile(f.filePath) && !isFrontendFile(f.filePath)) || [];
      } catch (err) {
        console.warn("Could not load source files:", err);
      }
    }

    if (type === "unit") {
      const needImprovementFiles = (sourceFiles || []).filter((sf) => {
        const linesPct = sf.linesPct ?? 100;
        const branchesPct = sf.branchesPct ?? 100;
        const stmtsPct = sf.stmtsPct ?? 100;
        return linesPct < 100 || branchesPct < 100 || stmtsPct < 100;
      });

      if (needImprovementFiles.length === 0) {
        setBulkSuggestMessage("All source files have reached 100% test coverage!");
        setTimeout(() => setBulkSuggestMessage(""), 5000);
        return;
      }

      setIsBulkSuggesting(true);
      const startMsg = `Generating inline test suggestions for ${needImprovementFiles.length} files...`;
      setBulkSuggestMessage(startMsg);
      startSuggestion({
        snapshotId,
        projectId,
        type,
        totalFiles: needImprovementFiles.length,
        initialMessage: startMsg,
      });

      // Expand all files that need improvement simultaneously so user can review all at once
      setExpandedFiles(new Set(needImprovementFiles.map((f) => f.filePath)));
      needImprovementFiles.forEach((f) => ensureFileCoverage(f.filePath));

      try {
        let completed = 0;
        const BATCH_SIZE = 2;
        for (let i = 0; i < needImprovementFiles.length; i += BATCH_SIZE) {
          const batch = needImprovementFiles.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (fileObj) => {
              const resSugs = await handleSuggestTestcaseInline(fileObj.filePath);
              completed += 1;
              const msg = `Generating inline test suggestions for ${needImprovementFiles.length} files (${completed}/${needImprovementFiles.length})...`;
              setBulkSuggestMessage(msg);
              updateSuggestionProgress({
                snapshotId,
                completedFiles: completed,
                totalFiles: needImprovementFiles.length,
                currentFile: fileObj.filePath,
                message: msg,
                filePath: fileObj.filePath,
                fileSuggestions: resSugs,
              });
            })
          );
        }
        const doneMsg = `✓ Generated inline test suggestions under ${needImprovementFiles.length} files. You can edit code and click Apply directly in the dropdown.`;
        setBulkSuggestMessage(doneMsg);
        completeSuggestion(doneMsg);
      } catch (err) {
        console.error("Bulk inline suggest failed:", err);
        const errMsg = `Error generating testcases: ${err.message}`;
        setBulkSuggestMessage(errMsg);
        completeSuggestion(errMsg);
      } finally {
        setIsBulkSuggesting(false);
        setTimeout(() => setBulkSuggestMessage(""), 10000);
      }
      return;
    }

    // For non-unit tests (e.g. integration / system), fallback to external handler if present
    onSuggestTestcase?.(sourceFiles[0]?.filePath, {
      isBulk: true,
      snapshotId,
      projectId,
    });
  };

  const relevantRuns = useMemo(
    () =>
      (type === "unit"
        ? [executions.jest, executions.vitest]
        : type === "integration"
          ? [executions.supertest, executions.playwright]
          : [executions.playwright, executions.cypress]
      ).filter(Boolean),
    [executions, type],
  );

  const totals = relevantRuns.reduce(
    (acc, item) => ({
      total: acc.total + (item.totalTests || 0),
      passed: acc.passed + (item.passedTests || 0),
      failed: acc.failed + (item.failedTests || 0),
    }),
    { total: 0, passed: 0, failed: 0 },
  );

  const avg = selectedFiles.length
    ? selectedFiles.reduce((sum, file) => sum + (file.linesPct || 0), 0) /
      selectedFiles.length
    : 0;

  const isLatestRunFailed = Boolean(
    (summary?.latestRunStatus === "failed" || coverageData?.latestRunStatus === "failed") &&
    (type === "unit"
      ? true
      : (summary?.latestRunError || relevantRuns.some((r) => r?.status === "FAILED")))
  );
  const hasPartialFailures = type === "unit"
    ? (summary?.latestRunStatus === "passed_with_failures" || coverageData?.latestRunStatus === "passed_with_failures" || summary?.hasTestFailures)
    : (totals.failed > 0);
  const lastSuccessfulCov = type === "unit"
    ? (summary?.lastSuccessfulCoverage || coverageData?.lastSuccessfulCoverage)
    : (summary?.lastSuccessfulCoverage?.statements > 0 ? summary.lastSuccessfulCoverage : null);
  const latestRunErr = summary?.latestRunError || coverageData?.latestRunError;
  const failedSuiteName = cleanDisplayPath(summary?.failedSuite || coverageData?.failedSuite);

  const lastSuccessfulValues = useMemo(() => {
    if (!lastSuccessfulCov) return [0, 0, 0, 0];
    return [
      lastSuccessfulCov.statements ?? lastSuccessfulCov.lines ?? 0,
      lastSuccessfulCov.branches ?? 0,
      lastSuccessfulCov.functions ?? 0,
      lastSuccessfulCov.lines ?? 0,
    ];
  }, [lastSuccessfulCov]);

  const values =
    type === "unit"
      ? [statPct, branchPct, funcPct, linePct]
      : type === "integration"
        ? [
            selectedFiles.length,
            selectedFiles.filter((f) => f.linesPct > 0).length,
            pct(avg),
            selectedFiles.filter((f) => f.linesPct < 60).length,
          ]
        : [totals.total, totals.passed, totals.failed, pct(linePct || cov.lines)];

  return (
    <div
      style={{
        minHeight: "100%",
        padding: "28px 34px",
        color: isLight ? "#0f172a" : "var(--color-text)",
        background: isLight ? "#f8fafc" : "var(--color-bg)",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 20,
          alignItems: "flex-start",
          marginBottom: 22,
        }}
      >
        <div>
          {type === "unit" ? (
            <>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 8px",
                  borderRadius: 5,
                  background: isLight ? "#eef2ff" : "rgba(99, 102, 241, 0.15)",
                  border: isLight ? "1px solid #e0e7ff" : "1px solid rgba(99, 102, 241, 0.35)",
                  color: isLight ? "#4f46e5" : "#a5b4fc",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.4px",
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                <FlaskConical size={12} />
                <span>Unit Testing Suite</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: isLight ? "#0f172a" : "#f8fafc", letterSpacing: "-0.02em" }}>
                {config.title}
              </h1>
              <p style={{ color: isLight ? "#475569" : "#94a3b8", fontSize: 13.5, margin: "6px 0 0" }}>
                {config.subtitle}
              </p>
              <div style={{ color: isLight ? "#64748b" : "#94a3b8", fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Engines:</span>
                <span style={{ padding: "2px 7px", borderRadius: 4, background: isLight ? "#fff1f2" : "rgba(244, 63, 94, 0.15)", border: isLight ? "1px solid #fecdd3" : "1px solid rgba(244, 63, 94, 0.35)", color: isLight ? "#be123c" : "#fb7185", fontWeight: 700, fontSize: 11 }}>Jest</span>
                <span style={{ padding: "2px 7px", borderRadius: 4, background: isLight ? "#f0fdf4" : "rgba(16, 185, 129, 0.15)", border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(16, 185, 129, 0.35)", color: isLight ? "#15803d" : "#4ade80", fontWeight: 700, fontSize: 11 }}>Vitest</span>
                {frameworks && (
                  <span>
                    {" "}· Detected:{" "}
                    <b style={{ color: isLight ? "#1e293b" : "#f1f5f9", fontWeight: 700 }}>
                      {frameworks.supported?.[type]?.join(", ") || "none"}
                    </b>
                  </span>
                )}
                {activeFramework && (
                  <span>
                    {" "}· Last execution:{" "}
                    <b style={{ padding: "2px 8px", borderRadius: 4, background: isLight ? "#eef2ff" : "rgba(99, 102, 241, 0.2)", border: isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.4)", color: isLight ? "#4338ca" : "#c7d2fe", fontSize: 11 }}>{activeFramework}</b>
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: 27, color: isLight ? "#0f172a" : "#f8fafc" }}>{config.title}</h1>
              <p style={{ color: isLight ? "#475569" : "#8b949e", fontSize: 13, margin: "7px 0 0" }}>
                {config.subtitle}
              </p>
              <div style={{ color: isLight ? "#64748b" : "#6e7681", fontSize: 12, marginTop: 7 }}>
                Supported:{" "}
                <span style={{ color: config.accent }}>{config.supported}</span>
                {frameworks && (
                  <span>
                    {" "}
                    · Detected:{" "}
                    <b style={{ color: isLight ? "#1e293b" : "#c9d1d9" }}>
                      {frameworks.supported?.[type]?.join(", ") || "none"}
                    </b>
                  </span>
                )}
                {activeFramework && (
                  <span>
                    {" "}
                    · Last run:{" "}
                    <b style={{ color: config.accent }}>{activeFramework}</b>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 9 }}>
          {onGenerate && (
            <button
              onClick={async () => {
                setGenerateError("");
                try {
                  await onGenerate(type);
                } catch (err) {
                  setGenerateError(err.message || "Generation failed.");
                }
              }}
              disabled={loading || running || generating}
              style={buttonStyle("#67e8f9")}
            >
              {generating ? "Generating..." : "Generate AI Tests"}
            </button>
          )}
          {type === "unit" && (
            <button
              onClick={handleBulkSuggestTest}
              disabled={loading || running || isBulkSuggesting}
              style={{
                background: isLight
                  ? (isBulkSuggesting ? "#ede9fe" : "#ffffff")
                  : (isBulkSuggesting ? "rgba(168, 85, 247, 0.25)" : "rgba(168, 85, 247, 0.12)"),
                border: isLight
                  ? "1px solid #c4b5fd"
                  : "1px solid rgba(168, 85, 247, 0.35)",
                color: isLight ? "#6d28d9" : "#d8b4fe",
                boxShadow: isLight
                  ? "0 1px 2px rgba(109, 40, 217, 0.08)"
                  : "0 1px 4px rgba(0, 0, 0, 0.2)",
                borderRadius: 8,
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 650,
                fontSize: 12.5,
                cursor: isBulkSuggesting ? "wait" : "pointer",
                transition: "all 0.15s ease",
              }}
              title="Generate unit test assertions and coverage specs for uncovered functions"
            >
              <FlaskConical size={14} className={isLight ? "text-purple-600" : "text-purple-400"} />
              <span>{isBulkSuggesting ? "Generating test cases..." : "Suggest Unit Tests"}</span>
            </button>
          )}
          {type === "unit" && allPendingSuggestions.length > 0 && (
            <button
              onClick={handleApplyAllGlobal}
              disabled={loading || running || isBulkApplying}
              style={{
                background: isLight
                  ? "#16a34a"
                  : "linear-gradient(135deg, rgba(34,197,94,0.3), rgba(16,185,129,0.3))",
                border: isLight
                  ? "1px solid #15803d"
                  : "1px solid rgba(34,197,94,0.6)",
                color: isLight ? "#ffffff" : "#4ade80",
                borderRadius: 8,
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
                fontSize: 12.5,
                cursor: isBulkApplying ? "wait" : "pointer",
                boxShadow: isLight
                  ? "0 1px 3px rgba(22, 163, 74, 0.25)"
                  : "0 0 16px rgba(34,197,94,0.25)",
              }}
              title="Apply all generated test suggestions across all files and update coverage"
            >
              {isBulkApplying ? (
                <>
                  <Loader2 size={14} className={`animate-spin ${isLight ? "text-white" : "text-green-400"}`} />
                  <span>{bulkApplyStep || "Applying all..."}</span>
                </>
              ) : (
                <>
                  <Zap size={14} className={isLight ? "text-white" : "text-green-400"} />
                  <span>Apply All ({allPendingSuggestions.length} tests)</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={async () => {
              invalidateCoverageQueries(snapshotId);
              await refetchCoverage();
            }}
            disabled={loading || running}
            style={{
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
              color: isLight ? "#334155" : "#e2e8f0",
              borderRadius: 8,
              padding: "8px 14px",
              fontWeight: 650,
              fontSize: 12.5,
              cursor: "pointer",
              boxShadow: isLight ? "0 1px 2px rgba(0,0,0,0.03)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            Refresh
          </button>
          {type === "unit" && (
            <button
              onClick={run}
              disabled={!snapshotId || running}
              style={{
                background: running
                  ? (isLight ? "#eef2ff" : "rgba(99, 102, 241, 0.2)")
                  : (isLight ? "#4f46e5" : "#6366f1"),
                border: running
                  ? (isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.4)")
                  : (isLight ? "1px solid #4338ca" : "1px solid #4f46e5"),
                color: running
                  ? (isLight ? "#4338ca" : "#c7d2fe")
                  : "#ffffff",
                boxShadow: running
                  ? "none"
                  : (isLight ? "0 2px 6px rgba(79, 70, 229, 0.25)" : "0 2px 10px rgba(99, 102, 241, 0.35)"),
                borderRadius: 8,
                padding: "8px 16px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: running ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
              title="Run Unit Test Analysis (Jest / Vitest)"
            >
              {running ? `Running (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)...` : "Run Analysis Unit"}
            </button>
          )}
          {type === "system" && (
            <button
              onClick={run}
              disabled={!snapshotId || running}
              style={{
                background: running
                  ? (isLight ? "#fce7f3" : "rgba(236, 72, 153, 0.2)")
                  : (isLight ? "#db2777" : "#ec4899"),
                border: running
                  ? (isLight ? "1px solid #fbcfe8" : "1px solid rgba(236, 72, 153, 0.4)")
                  : (isLight ? "1px solid #be185d" : "1px solid #db2777"),
                color: running
                  ? (isLight ? "#9d174d" : "#fbcfe8")
                  : "#ffffff",
                boxShadow: running
                  ? "none"
                  : (isLight ? "0 2px 6px rgba(219, 39, 119, 0.25)" : "0 2px 10px rgba(236, 72, 153, 0.35)"),
                borderRadius: 8,
                padding: "8px 16px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: running ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
              title="Run System Test Analysis (Playwright / Cypress)"
            >
              {running ? `Running (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)...` : "Run System Test"}
            </button>
          )}
          {type === "integration" && (
            <button
              onClick={run}
              disabled={!snapshotId || running}
              style={{
                background: running
                  ? (isLight ? "#e0f2fe" : "rgba(14, 165, 233, 0.2)")
                  : (isLight ? "#0284c7" : "#0ea5e9"),
                border: running
                  ? (isLight ? "1px solid #bae6fd" : "1px solid rgba(14, 165, 233, 0.4)")
                  : (isLight ? "1px solid #0369a1" : "1px solid #0284c7"),
                color: running
                  ? (isLight ? "#0369a1" : "#bae6fd")
                  : "#ffffff",
                boxShadow: running
                  ? "none"
                  : (isLight ? "0 2px 6px rgba(14, 165, 233, 0.25)" : "0 2px 10px rgba(14, 165, 233, 0.35)"),
                borderRadius: 8,
                padding: "8px 16px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: running ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
              title="Run Integration Test Analysis (Supertest)"
            >
              {running ? `Running (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)...` : "Run Integration Test"}
            </button>
          )}
        </div>
      </div>

      {type === "unit" && (bulkSuggestMessage || allPendingSuggestions.length > 0) && (
        <div
          style={{
            padding: "12px 18px",
            marginBottom: 16,
            borderRadius: 8,
            background: isLight
              ? (allPendingSuggestions.length > 0 ? "#f0fdf4" : "#f5f3ff")
              : (allPendingSuggestions.length > 0 ? "rgba(34, 197, 94, 0.12)" : "rgba(168, 85, 247, 0.12)"),
            border: isLight
              ? (allPendingSuggestions.length > 0 ? "1px solid #bbf7d0" : "1px solid #ddd6fe")
              : (allPendingSuggestions.length > 0 ? "1px solid rgba(34, 197, 94, 0.4)" : "1px solid rgba(168, 85, 247, 0.35)"),
            color: isLight
              ? (allPendingSuggestions.length > 0 ? "#15803d" : "#6d28d9")
              : (allPendingSuggestions.length > 0 ? "#86efac" : "#d8b4fe"),
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            boxShadow: isLight ? "0 1px 2px rgba(0,0,0,0.02)" : "0 1px 4px rgba(0,0,0,0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sparkles size={16} className={allPendingSuggestions.length > 0 ? "text-green-400" : "text-purple-400"} />
            <span style={{ fontWeight: 500 }}>
              {bulkSuggestMessage || `${allPendingSuggestions.length} generated test suggestions ready across ${filesWithPendingSuggestions.length} files. Click any line in code to edit directly.`}
            </span>
          </div>

          {allPendingSuggestions.length > 0 && (
            <button
              onClick={handleApplyAllGlobal}
              disabled={isBulkApplying || running}
              style={{
                padding: "6px 14px",
                background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                border: "1px solid #22c55e",
                borderRadius: 6,
                color: "#ffffff",
                fontSize: 12,
                fontWeight: 700,
                cursor: isBulkApplying ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 8px rgba(22, 163, 74, 0.3)",
              }}
              className="hover:opacity-90"
            >
              {isBulkApplying ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>{bulkApplyStep || "Applying all..."}</span>
                </>
              ) : (
                <>
                  <Zap size={13} />
                  <span>Apply All Generated Tests ({allPendingSuggestions.length})</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {running && (
        <WaveProgressBar
          progress={runProgress}
          step={runStep}
          framework={activeFramework || (type === "unit" ? "Jest & Vitest" : config.title)}
          color={config.accent}
        />
      )}

      {generateError && (
        <div
          style={{
            padding: "12px 15px",
            marginBottom: 18,
            borderRadius: 9,
            color: "#fca5a5",
            background: "rgba(239,68,68,.1)",
            border: "1px solid rgba(239,68,68,.3)",
          }}
        >
          {generateError}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "12px 15px",
            marginBottom: 18,
            borderRadius: 9,
            color: "#fca5a5",
            background: "rgba(239,68,68,.1)",
            border: "1px solid rgba(239,68,68,.3)",
          }}
        >
          {error}
        </div>
      )}

      {/* Test Execution Failure Banner with Diagnostic Detail & Previous Coverage Notice */}
      {isLatestRunFailed && (
        <div
          style={{
            padding: "16px 20px",
            marginBottom: 20,
            borderRadius: 10,
            background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.12)",
            border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>❌</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: isLight ? "#991b1b" : "#fca5a5" }}>
                Test execution failed for current run
              </div>
              <div style={{ fontSize: 12, color: isLight ? "#b91c1c" : "#cbd5e1", marginTop: 2 }}>
                Coverage: <span style={{ color: "#ef4444", fontWeight: 600 }}>Unavailable for current run</span> (Results of failed runs excluded)
              </div>
            </div>
          </div>

          {failedSuiteName && (
            <div style={{ fontSize: 12, color: isLight ? "#334155" : "#e2e8f0" }}>
              <span style={{ color: isLight ? "#64748b" : "#94a3b8" }}>Failed Suite: </span>
              <code style={{ background: isLight ? "#fff1f2" : "rgba(0,0,0,0.4)", border: isLight ? "1px solid #fecdd3" : "none", padding: "2px 6px", borderRadius: 4, color: isLight ? "#be123c" : "#f87171" }}>
                {cleanDisplayPath(failedSuiteName)}
              </code>
            </div>
          )}

          {latestRunErr && (
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                background: isLight ? "#ffffff" : "rgba(0, 0, 0, 0.5)",
                border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.25)",
                padding: "10px 14px",
                borderRadius: 6,
                color: isLight ? "#991b1b" : "#fca5a5",
                whiteSpace: "pre-wrap",
                maxHeight: 140,
                overflowY: "auto",
              }}
            >
              {sanitizeErrorText(latestRunErr)}
            </div>
          )}

          {lastSuccessfulCov && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 14,
                fontSize: 12,
                padding: "10px 14px",
                background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
                borderRadius: 6,
                border: isLight ? "1px dashed #cbd5e1" : "1px dashed rgba(255, 255, 255, 0.2)",
                color: isLight ? "#475569" : "#94a3b8",
              }}
            >
              <span style={{ fontWeight: 600, color: isLight ? "#0f172a" : "#e2e8f0" }}>
                ℹ️ Displaying results from previous successful run (cached):
              </span>
              <span>
                Statements: <b style={{ color: isLight ? "#0f172a" : "#cbd5e1" }}>{lastSuccessfulCov.statements || lastSuccessfulCov.lines || 0}%</b>
              </span>
              <span>
                Branches: <b style={{ color: isLight ? "#0f172a" : "#cbd5e1" }}>{lastSuccessfulCov.branches || 0}%</b>
              </span>
              <span>
                Functions: <b style={{ color: isLight ? "#0f172a" : "#cbd5e1" }}>{lastSuccessfulCov.functions || 0}%</b>
              </span>
              <span>
                Lines: <b style={{ color: isLight ? "#0f172a" : "#cbd5e1" }}>{lastSuccessfulCov.lines || 0}%</b>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Partial Test Assertions Notice (Coverage is valid, but some assertions failed) */}
      {!isLatestRunFailed && hasPartialFailures && (
        <div
          style={{
            padding: "12px 18px",
            marginBottom: 20,
            borderRadius: 10,
            background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.1)",
            border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.35)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: isLight ? "#92400e" : "#fcd34d" }}>
                Coverage measured from current run (some test assertions failed)
              </div>
              <div style={{ fontSize: 12, color: isLight ? "#b45309" : "#94a3b8", marginTop: 2 }}>
                The files below display accurate % code coverage based on actual tests executed.
              </div>
            </div>
          </div>
          {failedSuiteName && (
            <div style={{ fontSize: 12, color: isLight ? "#334155" : "#cbd5e1" }}>
              <span style={{ color: isLight ? "#64748b" : "#94a3b8" }}>Suites with failed tests: </span>
              <code style={{ background: isLight ? "#fefce8" : "rgba(0,0,0,0.4)", border: isLight ? "1px solid #fef08a" : "none", padding: "2px 6px", borderRadius: 4, color: isLight ? "#a16207" : "#fcd34d" }}>
                {cleanDisplayPath(failedSuiteName)}
              </code>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <CoverageDashboardSkeleton />
      ) : (
        <>
          {/* Focus Metrics Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
              gap: 13,
            }}
          >
            {config.focus.map((label, i) => {
              let metricVal = Number(values[i] || 0);
              const rawInfo = i === 0 ? rawTotals?.statements : i === 1 ? rawTotals?.branches : i === 2 ? rawTotals?.functions : rawTotals?.lines;
              if (i === 1 && (Number(rawInfo?.covered || 0) === 0) && (Number(values[0] || 0) === 0 || Number(values[3] || 0) === 0)) {
                metricVal = 0;
              }
              const color = getCoverageColor(metricVal, isLight);
              const MetricIcon = i === 0 ? FileCode : i === 1 ? GitBranch : i === 2 ? Cpu : Layers;

              if (type === "unit") {
                return (
                  <div
                    key={label}
                    style={{
                      background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
                      border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: 10,
                      padding: "16px 18px",
                      boxShadow: isLight
                        ? "0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 1px 2px -1px rgba(15, 23, 42, 0.02)"
                        : "0 1px 3px rgba(0, 0, 0, 0.2)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div
                        style={{
                          color: isLight ? "#64748b" : "#94a3b8",
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <MetricIcon size={13} style={{ color: i === 0 ? (isLight ? "#6366f1" : "#818cf8") : i === 1 ? (isLight ? "#d97706" : "#fbbf24") : i === 2 ? (isLight ? "#0284c7" : "#38bdf8") : (isLight ? "#059669" : "#34d399") }} />
                        <span>{label}</span>
                      </div>

                      {!isLatestRunFailed && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: metricVal >= 80
                              ? (isLight ? "#ecfdf5" : "rgba(16, 185, 129, 0.15)")
                              : metricVal >= 60
                                ? (isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.15)")
                                : (isLight ? "#fff1f2" : "rgba(239, 68, 68, 0.15)"),
                            color: metricVal >= 80
                              ? (isLight ? "#059669" : "#34d399")
                              : metricVal >= 60
                                ? (isLight ? "#d97706" : "#fbbf24")
                                : (isLight ? "#e11d48" : "#f87171"),
                            border: metricVal >= 80
                              ? (isLight ? "1px solid #a7f3d0" : "1px solid rgba(16, 185, 129, 0.35)")
                              : metricVal >= 60
                                ? (isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.35)")
                                : (isLight ? "1px solid #fecdd3" : "1px solid rgba(239, 68, 68, 0.35)"),
                          }}
                        >
                          {metricVal >= 80 ? "✓ PASSING" : metricVal >= 60 ? "⚠ FAIR" : "× LOW"}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        color: isLatestRunFailed ? (isLight ? "#dc2626" : "#f87171") : (isLight ? "#0f172a" : "#f8fafc"),
                        fontSize: isLatestRunFailed ? 18 : 28,
                        fontWeight: 800,
                        marginTop: 8,
                        fontFamily: "var(--font-mono, monospace)",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {isLatestRunFailed ? "Unavailable" : pct(metricVal)}
                    </div>

                    {/* Fraction & Mini progress bar */}
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: isLight ? "#64748b" : "#94a3b8",
                          fontFamily: "var(--font-mono, monospace)",
                          marginBottom: 4,
                        }}
                      >
                        {rawInfo?.total != null && rawInfo.total > 0 ? (
                          <span>{rawInfo.covered || 0} / {rawInfo.total} {label.toLowerCase()}</span>
                        ) : rawInfo?.total === 0 ? (
                          <span>0 / 0 {label.toLowerCase()}</span>
                        ) : (
                          <span>Calculated {label.toLowerCase()}</span>
                        )}
                      </div>

                      <div
                        style={{
                          width: "100%",
                          height: 4,
                          background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.08)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, metricVal))}%`,
                            height: "100%",
                            background: color,
                            borderRadius: 2,
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>
                    </div>

                    {isLatestRunFailed && lastSuccessfulCov && (
                      <div style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8", marginTop: 6 }}>
                        Last successful: <b style={{ color: isLight ? "#334155" : "#cbd5e1" }}>{pct(lastSuccessfulValues[i])}</b> (cached)
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div key={label} style={cardStyle}>
                  <div
                    style={{
                      color: "#8b949e",
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      color:
                        type === "unit"
                          ? (isLatestRunFailed ? "#f87171" : coverageColor(values[i]))
                          : config.accent,
                      fontSize: isLatestRunFailed && type === "unit" ? 18 : 27,
                      fontWeight: 750,
                      marginTop: 8,
                    }}
                  >
                    {type === "unit" ? (isLatestRunFailed ? "Unavailable" : pct(values[i])) : values[i]}
                  </div>
                  {isLatestRunFailed && type === "unit" && lastSuccessfulCov && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                      Last successful: <b style={{ color: "#cbd5e1" }}>{pct(lastSuccessfulValues[i])}</b> (cached)
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Interactive Feature Cards (Statement, Branch, Function Coverage) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 13,
              marginTop: 18,
            }}
          >
            {type === "unit"
              ? [
                  {
                    key: "statements",
                    title: "Statement coverage",
                    description: "How many statements were executed during testing.",
                    pctValue: statPct,
                    raw: rawTotals?.statements,
                    icon: FileCode,
                    accentColor: isLight ? "#6366f1" : "#a78bfa",
                  },
                  {
                    key: "branches",
                    title: "Branch coverage",
                    description:
                      "How many if/else/switch branches were traversed.",
                    pctValue: branchPct,
                    raw: rawTotals?.branches,
                    icon: GitBranch,
                    accentColor: isLight ? "#d97706" : "#fbbf24",
                  },
                  {
                    key: "functions",
                    title: "Function coverage",
                    description: "How many functions or methods were called.",
                    pctValue: funcPct,
                    raw: rawTotals?.functions,
                    icon: Cpu,
                    accentColor: isLight ? "#0284c7" : "#38bdf8",
                  },
                ].map((item) => {
                  const isActive = activeMetricView === item.key;
                  const Icon = item.icon;
                  const pctNum = Number(item.pctValue || 0);

                  return (
                    <div
                      key={item.key}
                      onClick={() => {
                        const next = isActive ? "testcases" : item.key;
                        setActiveMetricView(next);
                      }}
                      style={{
                        background: isActive
                          ? (isLight
                              ? (item.key === "statements" ? "#faf5ff" : item.key === "branches" ? "#fffbeb" : "#f0f9ff")
                              : `${item.accentColor}18`)
                          : (isLight ? "#ffffff" : "rgba(255, 255, 255, 0.025)"),
                        border: isActive
                          ? `2px solid ${item.accentColor}`
                          : (isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)"),
                        borderRadius: 12,
                        padding: 18,
                        cursor: "pointer",
                        boxShadow: isActive
                          ? (isLight ? `0 4px 14px ${item.accentColor}20` : `0 0 16px ${item.accentColor}25`)
                          : (isLight ? "0 1px 3px rgba(15, 23, 42, 0.03)" : "none"),
                        transition: "all 0.2s ease",
                      }}
                      className={isActive ? "" : (isLight ? "hover:border-slate-300 hover:shadow-md transition-all" : "hover:border-white/20 transition-all")}
                      title={`Click to filter by ${item.title}`}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: isLight ? "#0f172a" : "#f8fafc",
                            fontWeight: 750,
                            fontSize: 14.5,
                          }}
                        >
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              background: `${item.accentColor}18`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: item.accentColor,
                              flexShrink: 0,
                            }}
                          >
                            <Icon size={16} />
                          </div>
                          <span>{item.title}</span>
                        </div>

                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 12,
                            background: isActive
                              ? item.accentColor
                              : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.06)"),
                            color: isActive
                              ? "#ffffff"
                              : (isLight ? "#475569" : "#94a3b8"),
                          }}
                        >
                          {isActive ? "Active View" : "Details →"}
                        </span>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 26,
                            fontWeight: 800,
                            color: isLight ? "#0f172a" : "#f8fafc",
                            fontFamily: "var(--font-mono, monospace)",
                            letterSpacing: "-0.02em",
                          }}
                        >
                          {pct(pctNum)}
                        </span>
                        {item.raw?.total != null && item.raw.total > 0 ? (
                          <span
                            style={{
                              fontSize: 12,
                              color: isLight ? "#64748b" : "#94a3b8",
                              fontFamily: "var(--font-mono, monospace)",
                            }}
                          >
                            ({item.raw.covered || 0} / {item.raw.total} covered)
                          </span>
                        ) : item.raw?.total === 0 ? (
                          <span
                            style={{
                              fontSize: 12,
                              color: isLight ? "#64748b" : "#94a3b8",
                              fontFamily: "var(--font-mono, monospace)",
                            }}
                          >
                            (0 / 0 covered)
                          </span>
                        ) : null}
                      </div>

                      {/* Progress Bar */}
                      <div
                        style={{
                          width: "100%",
                          height: 5,
                          background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.08)",
                          border: isLight ? "1px solid #e2e8f0" : "none",
                          borderRadius: 3,
                          marginTop: 10,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, pctNum))}%`,
                            height: "100%",
                            background: item.accentColor,
                            borderRadius: 3,
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          color: isLight ? "#475569" : "#94a3b8",
                          fontSize: 12,
                          lineHeight: 1.5,
                          marginTop: 9,
                        }}
                      >
                        {item.description}
                      </div>
                    </div>
                  );
                })
              : config.explanation.map(([title, text]) => (
                  <div key={title} style={cardStyle}>
                    <div
                      style={{
                        color: config.accent,
                        fontWeight: 650,
                        fontSize: 14,
                      }}
                    >
                      {title}
                    </div>
                    <div
                      style={{
                        color: "#8b949e",
                        fontSize: 12,
                        lineHeight: 1.55,
                        marginTop: 7,
                      }}
                    >
                      {text}
                    </div>
                  </div>
                ))}
          </div>

          {/* Mode Navigation Tabs (Unit Test Coverage) */}
          {type === "unit" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 20,
                overflowX: "auto",
                padding: "4px 6px",
                background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.03)",
                borderRadius: 10,
                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              {[
                {
                  id: "testcases",
                  label: "File Testcase (Jest / Vitest)",
                  count: unitTestSuites.length,
                  icon: FlaskConical,
                  accent: isLight ? "#7c3aed" : "#c084fc",
                },
                ...(type === "unit"
                  ? [
                      {
                        id: "visualization",
                        label: "Test Execution Visualization",
                        count: `${totals.passed}/${totals.total || unitTestSuites.length}`,
                        icon: Activity,
                        accent: isLight ? "#059669" : "#34d399",
                      },
                    ]
                  : []),
                {
                  id: "all",
                  label: "Source file coverage",
                  count: selectedFiles.length,
                  icon: ListChecks,
                  accent: isLight ? "#2563eb" : "#60a5fa",
                },
                {
                  id: "statements",
                  label: "Statement coverage",
                  count: pct(statPct),
                  icon: FileCode,
                  accent: isLight ? "#6366f1" : "#a78bfa",
                },
                {
                  id: "branches",
                  label: "Branch coverage",
                  count: pct(branchPct),
                  icon: GitBranch,
                  accent: isLight ? "#d97706" : "#fbbf24",
                },
                {
                  id: "functions",
                  label: "Function coverage",
                  count: pct(funcPct),
                  icon: Cpu,
                  accent: isLight ? "#0284c7" : "#38bdf8",
                },
              ].map((tab) => {
                const isCurrent = activeMetricView === tab.id;
                const TabIcon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveMetricView(tab.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: isCurrent ? 700 : 500,
                      cursor: "pointer",
                      background: isCurrent
                        ? (isLight ? "#ffffff" : "rgba(255, 255, 255, 0.08)")
                        : "transparent",
                      color: isCurrent
                        ? (isLight ? "#0f172a" : "#f8fafc")
                        : (isLight ? "#64748b" : "#94a3b8"),
                      border: isCurrent
                        ? (isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)")
                        : "1px solid transparent",
                      boxShadow: isCurrent
                        ? (isLight ? "0 1px 3px rgba(15, 23, 42, 0.06)" : "0 1px 3px rgba(0, 0, 0, 0.2)")
                        : "none",
                      transition: "all 0.15s ease",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {TabIcon && (
                      <TabIcon
                        size={14}
                        style={{ color: isCurrent ? tab.accent : (isLight ? "#94a3b8" : "#64748b") }}
                      />
                    )}
                    <span>{tab.label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 9999,
                        background: isCurrent
                          ? (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.1)")
                          : (isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.05)"),
                        color: isCurrent
                          ? (isLight ? "#334155" : "#f8fafc")
                          : (isLight ? "#64748b" : "#94a3b8"),
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}

              {activeMetricView !== "testcases" && activeMetricView !== "visualization" && (
                <button
                  onClick={() => setActiveMetricView("testcases")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 650,
                    color: isLight ? "#6d28d9" : "#c084fc",
                    background: isLight ? "#ede9fe" : "rgba(124, 58, 237, 0.15)",
                    border: isLight ? "1px solid #c4b5fd" : "1px solid rgba(192, 132, 252, 0.3)",
                    cursor: "pointer",
                    marginLeft: "auto",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                  title="Back to test case files list"
                >
                  <FlaskConical size={12} />
                  <span>View testcase files</span>
                </button>
              )}
            </div>
          )}

          {/* Active View Explanatory Banner */}
          {type === "unit" && activeMetricView !== "testcases" && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 16px",
                borderRadius: 8,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
                background: isLight
                  ? activeMetricView === "visualization"
                    ? "#ecfdf5"
                    : activeMetricView === "testcases"
                      ? "#faf5ff"
                      : activeMetricView === "statements"
                        ? "#eef2ff"
                        : activeMetricView === "branches"
                          ? "#fffbeb"
                          : activeMetricView === "functions"
                            ? "#f0f9ff"
                            : "#f8fafc"
                  : activeMetricView === "visualization"
                    ? "rgba(16, 185, 129, 0.08)"
                    : activeMetricView === "testcases"
                      ? "rgba(192, 132, 252, 0.08)"
                      : activeMetricView === "statements"
                        ? "rgba(167, 139, 250, 0.08)"
                        : activeMetricView === "branches"
                          ? "rgba(251, 191, 36, 0.08)"
                          : activeMetricView === "functions"
                            ? "rgba(56, 189, 248, 0.08)"
                            : "rgba(255, 255, 255, 0.04)",
                border: isLight
                  ? activeMetricView === "visualization"
                    ? "1px solid #a7f3d0"
                    : activeMetricView === "testcases"
                      ? "1px solid #e9d5ff"
                      : activeMetricView === "statements"
                        ? "1px solid #c7d2fe"
                        : activeMetricView === "branches"
                          ? "1px solid #fde68a"
                          : activeMetricView === "functions"
                            ? "1px solid #bae6fd"
                            : "1px solid #e2e8f0"
                  : activeMetricView === "visualization"
                    ? "1px solid rgba(16, 185, 129, 0.25)"
                    : activeMetricView === "testcases"
                      ? "1px solid rgba(192, 132, 252, 0.25)"
                      : activeMetricView === "statements"
                        ? "1px solid rgba(167, 139, 250, 0.25)"
                        : activeMetricView === "branches"
                          ? "1px solid rgba(251, 191, 36, 0.25)"
                          : activeMetricView === "functions"
                            ? "1px solid rgba(56, 189, 248, 0.25)"
                            : "1px solid rgba(255, 255, 255, 0.08)",
                color: isLight
                  ? activeMetricView === "visualization"
                    ? "#065f46"
                    : activeMetricView === "testcases"
                      ? "#581c87"
                      : activeMetricView === "statements"
                        ? "#3730a3"
                        : activeMetricView === "branches"
                          ? "#92400e"
                          : activeMetricView === "functions"
                            ? "#075985"
                            : "#334155"
                  : activeMetricView === "visualization"
                    ? "#6ee7b7"
                    : activeMetricView === "testcases"
                      ? "#e9d5ff"
                      : activeMetricView === "statements"
                        ? "#c4b5fd"
                        : activeMetricView === "branches"
                          ? "#fde68a"
                          : activeMetricView === "functions"
                            ? "#bae6fd"
                            : "#8b949e",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 260,
                }}
              >
                {activeMetricView === "visualization" ? (
                  <>
                    <Activity
                      size={15}
                      style={{ flexShrink: 0, color: isLight ? "#059669" : "#34d399" }}
                    />
                    <span>
                      <b>Test Execution Visualization Unit:</b> Real-time interactive execution
                      timeline, test suite waterfall, assertion status tree, and bottleneck diagnostics.
                    </span>
                  </>
                ) : activeMetricView === "testcases" ? (
                  <>
                    <FlaskConical
                      size={15}
                      style={{ flexShrink: 0, color: isLight ? "#7c3aed" : "#c084fc" }}
                    />
                    <span>
                      <b>Unit Test Files:</b> List of test specification files
                      from <b>Jest</b> and <b>Vitest</b>. Playwright, Cypress,
                      and Supertest files are automatically filtered out from
                      the Unit Test scope.
                    </span>
                  </>
                ) : activeMetricView === "statements" ? (
                  <>
                    <FileCode
                      size={15}
                      style={{ flexShrink: 0, color: isLight ? "#4f46e5" : "#a78bfa" }}
                    />
                    <span>
                      <b>Statement Coverage:</b> Statistical percentage of source
                      code statements executed during unit testing.
                    </span>
                  </>
                ) : activeMetricView === "branches" ? (
                  <>
                    <GitBranch
                      size={15}
                      style={{ flexShrink: 0, color: isLight ? "#d97706" : "#fbbf24" }}
                    />
                    <span>
                      <b>Branch Coverage:</b> Statistical percentage of conditional
                      branches (if/else, switch, ternary) evaluated across all paths.
                    </span>
                  </>
                ) : activeMetricView === "functions" ? (
                  <>
                    <Cpu
                      size={15}
                      style={{ flexShrink: 0, color: isLight ? "#0284c7" : "#38bdf8" }}
                    />
                    <span>
                      <b>Function Coverage:</b> Identified functions and methods,
                      tracking execution call counts and CFG mapping.
                    </span>
                  </>
                ) : (
                  <>
                    <ListChecks size={15} style={{ flexShrink: 0, color: isLight ? "#2563eb" : undefined }} />
                    <span>
                      <b>Source File Coverage:</b> Overall coverage breakdown of
                      source files under test (Lines, Branches, Functions,
                      Statements).
                    </span>
                  </>
                )}
              </div>

              {/* View Mode Switcher for Unit Testcases */}
              {type === "unit" && activeMetricView === "testcases" && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setTestCaseViewMode("table")}
                    style={{
                      fontSize: 11,
                      fontWeight: 650,
                      padding: "4px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        testCaseViewMode === "table"
                          ? (isLight ? "#7c3aed" : "var(--color-primary)")
                          : (isLight ? "#ffffff" : "var(--color-surface)"),
                      color:
                        testCaseViewMode === "table"
                          ? "#ffffff"
                          : (isLight ? "#475569" : "var(--color-text-secondary)"),
                      border:
                        testCaseViewMode === "table"
                          ? (isLight ? "1px solid #7c3aed" : "1px solid var(--color-primary)")
                          : (isLight ? "1px solid #cbd5e1" : "1px solid var(--color-border)"),
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                      boxShadow: isLight && testCaseViewMode === "table" ? "0 1px 2px rgba(124, 58, 237, 0.2)" : "none",
                    }}
                  >
                    <FlaskConical size={12} />
                    <span>📋 File Table</span>
                  </button>
                  <button
                    onClick={() => setTestCaseViewMode("visualization")}
                    style={{
                      fontSize: 11,
                      fontWeight: 650,
                      padding: "4px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        testCaseViewMode === "visualization"
                          ? (isLight ? "#7c3aed" : "var(--color-primary)")
                          : (isLight ? "#ffffff" : "var(--color-surface)"),
                      color:
                        testCaseViewMode === "visualization"
                          ? "#ffffff"
                          : (isLight ? "#475569" : "var(--color-text-secondary)"),
                      border:
                        testCaseViewMode === "visualization"
                          ? (isLight ? "1px solid #7c3aed" : "1px solid var(--color-primary)")
                          : (isLight ? "1px solid #cbd5e1" : "1px solid var(--color-border)"),
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                      boxShadow: isLight && testCaseViewMode === "visualization" ? "0 1px 2px rgba(124, 58, 237, 0.2)" : "none",
                    }}
                  >
                    <Activity size={12} />
                    <span>⚡ Execution Visualization</span>
                  </button>
                </div>
              )}

              {/* View Mode Switcher for Function */}
              {activeMetricView === "functions" && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setFunctionViewMode("map")}
                    style={{
                      fontSize: 11,
                      fontWeight: 650,
                      padding: "4px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        functionViewMode === "map"
                          ? (isLight ? "#0284c7" : "var(--color-primary)")
                          : (isLight ? "#ffffff" : "var(--color-surface)"),
                      color:
                        functionViewMode === "map"
                          ? "#ffffff"
                          : (isLight ? "#475569" : "var(--color-text-secondary)"),
                      border:
                        functionViewMode === "map"
                          ? (isLight ? "1px solid #0284c7" : "1px solid var(--color-primary)")
                          : (isLight ? "1px solid #cbd5e1" : "1px solid var(--color-border)"),
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                      boxShadow: isLight && functionViewMode === "map" ? "0 1px 2px rgba(2, 132, 199, 0.2)" : "none",
                    }}
                  >
                    <Cpu size={12} />
                    <span>🕸️ Method Call Map</span>
                  </button>
                  <button
                    onClick={() => setFunctionViewMode("table")}
                    style={{
                      fontSize: 11,
                      fontWeight: 650,
                      padding: "4px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        functionViewMode === "table"
                          ? (isLight ? "#0284c7" : "var(--color-primary)")
                          : (isLight ? "#ffffff" : "var(--color-surface)"),
                      color:
                        functionViewMode === "table"
                          ? "#ffffff"
                          : (isLight ? "#475569" : "var(--color-text-secondary)"),
                      border:
                        functionViewMode === "table"
                          ? (isLight ? "1px solid #0284c7" : "1px solid var(--color-primary)")
                          : (isLight ? "1px solid #cbd5e1" : "1px solid var(--color-border)"),
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                      boxShadow: isLight && functionViewMode === "table" ? "0 1px 2px rgba(2, 132, 199, 0.2)" : "none",
                    }}
                  >
                    <ListChecks size={12} />
                    <span>📋 Detail Table</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── TABLE VIEW SWITCHER ─────────────────────────────────── */}
          {type === "unit" && (activeMetricView === "visualization" || (activeMetricView === "testcases" && testCaseViewMode === "visualization")) ? (
            <div style={{ marginTop: 14 }}>
              <UnitTestExecutionVisualizer
                testSuites={unitTestSuites}
                executions={executions}
                sourceFiles={selectedFiles}
                isLight={isLight}
                onOpenFile={onOpenFile}
                onSelectSourceFile={(filePath) => {
                  setSelectedSourceFile(filePath);
                  setActiveMetricView("all");
                  ensureFileCoverage(filePath);
                }}
                onRunTests={run}
                running={running}
                runProgress={runProgress}
                runStep={runStep}
              />
            </div>
          ) : type === "unit" && activeMetricView === "testcases" ? (
            /* ── A. Unit Testcase Files Table (Jest / Vitest only) ───── */
            <div
              style={{
                ...cardStyle,
                marginTop: 14,
                padding: 0,
                overflow: "hidden",
                background: isLight ? "#ffffff" : cardStyle.background,
                border: isLight ? "1px solid #e2e8f0" : cardStyle.border,
                boxShadow: isLight ? "0 1px 3px rgba(15, 23, 42, 0.05)" : "none",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  fontWeight: 700,
                  borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,.07)",
                  background: isLight ? "#ffffff" : "transparent",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FlaskConical size={16} style={{ color: isLight ? "#7c3aed" : "#c084fc" }} />
                  <span style={{ color: isLight ? "#0f172a" : undefined }}>File Testcase (Jest & Vitest)</span>
                  <span
                    style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e", fontWeight: 400 }}
                  >
                    ({filteredTestSuites.length} test files)
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => setTestCaseViewMode("visualization")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 9px",
                      borderRadius: 6,
                      background: isLight ? "#ede9fe" : "rgba(124, 58, 237, 0.2)",
                      color: isLight ? "#6d28d9" : "#c084fc",
                      border: isLight ? "1px solid #c4b5fd" : "1px solid rgba(192, 132, 252, 0.35)",
                      fontSize: 11,
                      fontWeight: 650,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    title="Switch to Test Execution Visualization Unit"
                  >
                    <Activity size={12} />
                    <span>Visualize Execution</span>
                  </button>

                  {/* Search input */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: isLight ? "#ffffff" : "rgba(255,255,255,0.04)",
                      border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                    }}
                  >
                    <Search size={13} style={{ color: isLight ? "#64748b" : "#8b949e" }} />
                    <input
                      type="text"
                      placeholder="Search testcase files..."
                      value={testSuiteSearch}
                      onChange={(e) => setTestSuiteSearch(e.target.value)}
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: isLight ? "#0f172a" : "#e6edf3",
                        fontSize: 12,
                        width: 150,
                      }}
                    />
                  </div>
                </div>
              </div>

              {loadingTestSuites ? (
                <div
                  style={{ padding: 30, textAlign: "center", color: isLight ? "#64748b" : "#6e7681" }}
                >
                  Loading test case files...
                </div>
              ) : filteredTestSuites.length === 0 ? (
                <div
                  style={{ padding: 30, textAlign: "center", color: isLight ? "#64748b" : "#6e7681" }}
                >
                  No Jest or Vitest test case files found. Click
                  "Run Analysis Unit" to run and analyze.
                </div>
              ) : (
                <div>
                  <div style={{ overflowX: "auto" }}>
                    {/* Table Header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "40px minmax(180px, 1.3fr) 85px 100px 80px 95px 105px",
                      gap: 10,
                      minWidth: 720,
                      padding: "10px 18px",
                      background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)",
                      borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.05)",
                      fontSize: 11,
                      fontWeight: 650,
                      color: isLight ? "#475569" : "#8b949e",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    <span style={{ textAlign: "center" }}>#</span>
                    <span>File Testcase</span>
                    <span style={{ textAlign: "center" }}>Framework</span>
                    <span style={{ textAlign: "right" }}>Test Cases</span>
                    <span style={{ textAlign: "right" }}>Duration</span>
                    <span style={{ textAlign: "center" }}>Status</span>
                    <span style={{ textAlign: "center" }}>Actions</span>
                  </div>

                  {/* Rows */}
                  {paginatedTestSuites.map((suite, idx) => {
                    const isPassed =
                      suite.status === "passed" && suite.failedTests === 0;
                    const isExpanded = expandedSuite === suite.filePath;

                    return (
                      <div key={suite.filePath}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "40px minmax(180px, 1.3fr) 85px 100px 80px 95px 105px",
                            gap: 10,
                            minWidth: 720,
                            padding: "12px 18px",
                            alignItems: "center",
                            borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,.04)",
                            transition: "background 0.15s ease",
                            background: isExpanded
                              ? (isLight ? "#faf5ff" : "rgba(192, 132, 252, 0.04)")
                              : "transparent",
                          }}
                          className={isLight ? "hover:bg-slate-50/80" : "hover:bg-white/[0.02]"}
                        >
                          {/* File Index */}
                          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: "var(--font-mono, monospace)",
                                color: isLight ? "#64748b" : "#94a3b8",
                                background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)",
                                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                                borderRadius: 6,
                                padding: "2px 6px",
                                minWidth: 26,
                                textAlign: "center",
                              }}
                            >
                              {(testSuitePage - 1) * TEST_SUITES_PER_PAGE + idx + 1}
                            </span>
                          </div>

                          {/* File path */}
                          <div
                            onClick={() => onOpenFile?.(suite.filePath)}
                            style={{
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              overflow: "hidden",
                            }}
                            title={`Open test file ${suite.filePath}`}
                          >
                            <FlaskConical
                              size={15}
                              style={{
                                color:
                                  suite.framework === "vitest"
                                    ? (isLight ? "#0284c7" : "#38bdf8")
                                    : (isLight ? "#7c3aed" : "#c084fc"),
                                flexShrink: 0,
                              }}
                            />
                            {(() => {
                              const cleaned = cleanDisplayPath(suite.filePath);
                              const parts = cleaned.split("/");
                              if (parts.length <= 1) {
                                return (
                                  <span
                                    style={{
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      color: isLight ? "#0f172a" : "#e6edf3",
                                      fontSize: 13,
                                      fontWeight: 600,
                                      fontFamily: "var(--font-mono)",
                                    }}
                                  >
                                    {cleaned}
                                  </span>
                                );
                              }
                              const dir = parts.slice(0, -1).join(" / ");
                              const file = parts[parts.length - 1];
                              return (
                                <span
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontSize: 13,
                                    fontFamily: "var(--font-mono)",
                                  }}
                                  title={cleaned}
                                >
                                  <span style={{ color: isLight ? "#64748b" : "#8b949e", marginRight: 5 }}>{dir} /</span>
                                  <span style={{ color: isLight ? "#0f172a" : "#e6edf3", fontWeight: 600 }}>{file}</span>
                                </span>
                              );
                            })()}
                          </div>

                          {/* Framework Badge */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 6,
                                background:
                                  suite.framework === "vitest"
                                    ? (isLight ? "#f0fdf4" : "rgba(56, 189, 248, 0.15)")
                                    : (isLight ? "#fff1f2" : "rgba(192, 132, 252, 0.15)"),
                                color:
                                  suite.framework === "vitest"
                                    ? (isLight ? "#15803d" : "#38bdf8")
                                    : (isLight ? "#be123c" : "#c084fc"),
                                border:
                                  suite.framework === "vitest"
                                    ? (isLight ? "1px solid #bbf7d0" : "1px solid rgba(56, 189, 248, 0.35)")
                                    : (isLight ? "1px solid #fecdd3" : "1px solid rgba(192, 132, 252, 0.35)"),
                                textTransform: "uppercase",
                              }}
                            >
                              {suite.framework}
                            </span>
                          </div>

                          {/* Test Cases Count */}
                          <div
                            style={{
                              textAlign: "right",
                              fontSize: 12,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            <span style={{ color: isLight ? "#16a34a" : "#4ade80", fontWeight: 600 }}>
                              ✓ {suite.passedTests || 0}
                            </span>
                            {suite.failedTests > 0 && (
                              <span
                                style={{
                                  color: isLight ? "#dc2626" : "#f87171",
                                  fontWeight: 600,
                                  marginLeft: 6,
                                }}
                              >
                                × {suite.failedTests}
                              </span>
                            )}
                          </div>

                          {/* Duration */}
                          <div
                            style={{
                              textAlign: "right",
                              fontSize: 12,
                              color: isLight ? "#64748b" : "#8b949e",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {suite.durationMs ? `${suite.durationMs}ms` : "—"}
                          </div>

                          {/* Status */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 10,
                                background: isPassed
                                  ? (isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.15)")
                                  : suite.status === "pending"
                                    ? (isLight ? "#fefce8" : "rgba(234, 179, 8, 0.15)")
                                    : (isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.15)"),
                                color: isPassed
                                  ? (isLight ? "#15803d" : "#4ade80")
                                  : suite.status === "pending"
                                    ? (isLight ? "#a16207" : "#fde047")
                                    : (isLight ? "#b91c1c" : "#fca5a5"),
                                border: isPassed
                                  ? (isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)")
                                  : suite.status === "pending"
                                    ? (isLight ? "1px solid #fef08a" : "1px solid rgba(234, 179, 8, 0.3)")
                                    : (isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.3)"),
                              }}
                            >
                              {isPassed ? "✓ PASSED" : suite.status === "pending" ? "— PENDING" : "× FAILED"}
                            </span>
                          </div>

                          {/* Actions */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                            }}
                          >
                            <button
                              onClick={() => onOpenFile?.(suite.filePath)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: isLight ? "#ffffff" : "rgba(255,255,255,0.05)",
                                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                                color: isLight ? "#334155" : "#c9d1d9",
                                fontSize: 11,
                                fontWeight: isLight ? 600 : 400,
                                cursor: "pointer",
                              }}
                              title="Open test file in editor"
                            >
                              Open test
                            </button>

                            {((suite.assertions && suite.assertions.length > 0) || suite.message) && (
                              <button
                                onClick={() =>
                                  setExpandedSuite(
                                    isExpanded ? null : suite.filePath,
                                  )
                                }
                                style={{
                                  padding: "4px 6px",
                                  borderRadius: 5,
                                  background: isLight ? "#ffffff" : "rgba(255,255,255,0.03)",
                                  border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.08)",
                                  color: isLight ? "#64748b" : "#8b949e",
                                  fontSize: 11,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                }}
                                title={suite.message ? "View error details" : "View child test cases"}
                              >
                                {isExpanded ? (
                                  <ChevronDown size={13} />
                                ) : (
                                  <ChevronRight size={13} />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Expanded Test Cases Accordion */}
                        {isExpanded && (suite.assertions?.length > 0 || suite.message) && (
                          <div
                            style={{
                              background: isLight ? "#f8fafc" : "rgba(0,0,0,0.25)",
                              padding: "12px 24px",
                              borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,.05)",
                            }}
                          >
                            {/* Error message banner */}
                            {suite.message && (
                              <div style={{
                                background: isLight ? "#fef2f2" : "rgba(239,68,68,0.08)",
                                border: isLight ? "1px solid #fecaca" : "1px solid rgba(239,68,68,0.25)",
                                borderRadius: 6,
                                padding: "8px 12px",
                                marginBottom: suite.assertions?.length > 0 ? 10 : 0,
                                fontSize: 11,
                                fontFamily: "var(--font-mono)",
                                color: isLight ? "#991b1b" : "#fca5a5",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                maxHeight: 200,
                                overflowY: "auto",
                              }}>
                                <span style={{ fontWeight: 700, display: "block", marginBottom: 4, color: isLight ? "#dc2626" : "#f87171" }}>
                                  ⚠ Error Details:
                                </span>
                                {suite.message}
                              </div>
                            )}
                            {suite.assertions && suite.assertions.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: isLight ? "#475569" : "#8b949e",
                                    marginBottom: 6,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Test cases in {suite.fileName}:
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                  {suite.assertions.map((testCase, idx) => {
                                    const targetFn = testCase.targetFunction ||
                                      (Array.isArray(testCase.ancestorTitles) && testCase.ancestorTitles.length > 1
                                        ? testCase.ancestorTitles[testCase.ancestorTitles.length - 1]
                                        : null);

                                    return (
                                      <div
                                        key={idx}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 9,
                                          fontSize: 12,
                                          fontFamily: "var(--font-mono)",
                                          padding: "4px 0",
                                          borderBottom: isLight ? "1px dashed #e2e8f0" : "1px dashed rgba(255,255,255,0.03)",
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 10.5,
                                            fontWeight: 700,
                                            fontFamily: "var(--font-mono)",
                                            color: isLight ? "#94a3b8" : "#64748b",
                                            minWidth: 22,
                                          }}
                                        >
                                          #{idx + 1}
                                        </span>
                                        {testCase.status === "passed" ? (
                                          <Check size={13} style={{ color: isLight ? "#16a34a" : "#4ade80", flexShrink: 0 }} />
                                        ) : (
                                          <X size={13} style={{ color: isLight ? "#dc2626" : "#f87171", flexShrink: 0 }} />
                                        )}
                                        {targetFn && (
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: 3,
                                              fontSize: 10.5,
                                              fontWeight: 700,
                                              padding: "1px 7px",
                                              borderRadius: 4,
                                              background: isLight ? "#eff6ff" : "rgba(59, 130, 246, 0.16)",
                                              color: isLight ? "#1d4ed8" : "#60a5fa",
                                              border: isLight ? "1px solid #bfdbfe" : "1px solid rgba(59, 130, 246, 0.35)",
                                              whiteSpace: "nowrap",
                                              flexShrink: 0,
                                              letterSpacing: "0.2px",
                                            }}
                                            title={`Target function: ${targetFn}`}
                                          >
                                            <span style={{ color: isLight ? "#3b82f6" : "#93c5fd", opacity: 0.8 }}>ƒ</span>
                                            {targetFn}
                                          </span>
                                        )}
                                        <span
                                          style={{
                                            color:
                                              testCase.status === "passed"
                                                ? (isLight ? "#1e293b" : "#c9d1d9")
                                                : (isLight ? "#991b1b" : "#fca5a5"),
                                            flex: 1,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                          title={testCase.title}
                                        >
                                          {testCase.title}
                                        </span>
                                        {testCase.duration ? (
                                          <span
                                            style={{
                                              color: isLight ? "#64748b" : "#6e7681",
                                              fontSize: 11,
                                              marginLeft: "auto",
                                              flexShrink: 0,
                                              paddingLeft: 10,
                                            }}
                                          >
                                            {testCase.duration}ms
                                          </span>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <PaginationControl
                  currentPage={testSuitePage}
                  totalItems={filteredTestSuites.length}
                  pageSize={TEST_SUITES_PER_PAGE}
                  onPageChange={setTestSuitePage}
                  isLight={isLight}
                  itemLabel="test files"
                />
              </div>
            )}
            </div>
          ) : type === "unit" && activeMetricView === "functions" ? (
            functionViewMode === "map" ? (
              <div style={{ marginTop: 14 }}>
                <FunctionExecutionFlow
                  functionsList={filteredFunctions.map((fn) => ({
                    ...fn,
                    realName: resolveFunctionName(fn, flowData?.functions),
                  }))}
                  loading={loadingFunctions}
                  onOpenFile={onOpenFile}
                  onSuggestTestcase={onSuggestTestcase}
                  onOpenCfg={(filePath, funcName) => {
                    if (onOpenCFG) {
                      onOpenCFG(filePath, funcName);
                    } else {
                      setShowCfgModal(true);
                    }
                  }}
                />
              </div>
            ) : (
              /* ── B. Function Coverage Explorer Table ─────────────────── */
              <div
                style={{
                  ...cardStyle,
                  marginTop: 14,
                  padding: 0,
                  overflow: "hidden",
                  background: isLight ? "#ffffff" : cardStyle.background,
                  border: isLight ? "1px solid #e2e8f0" : cardStyle.border,
                  boxShadow: isLight ? "0 1px 3px rgba(15, 23, 42, 0.05)" : "none",
                }}
              >
                <div
                  style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,.07)",
                    background: isLight ? "#ffffff" : "transparent",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <Cpu size={16} style={{ color: isLight ? "#0284c7" : "#38bdf8" }} />
                    <span style={{ color: isLight ? "#0f172a" : undefined }}>Function Coverage Breakdown</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: isLight ? "#64748b" : "#8b949e",
                        fontWeight: 400,
                      }}
                    >
                      ({filteredFunctions.length} functions)
                    </span>
                  </div>

                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: isLight ? "#ffffff" : "rgba(255,255,255,0.04)",
                        border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 12,
                      }}
                    >
                      <Search size={13} style={{ color: isLight ? "#64748b" : "#8b949e" }} />
                      <input
                        type="text"
                        placeholder="Search function or file..."
                        value={functionSearch}
                        onChange={(e) => setFunctionSearch(e.target.value)}
                        style={{
                          background: "transparent",
                          border: "none",
                          outline: "none",
                          color: isLight ? "#0f172a" : "#e6edf3",
                          fontSize: 12,
                          width: 140,
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 4 }}>
                      {[
                        { id: "all", label: "All" },
                        { id: "uncovered", label: "⚑ Uncalled (0 hits)" },
                        { id: "covered", label: "✓ Called" },
                      ].map((st) => (
                        <button
                          key={st.id}
                          onClick={() => setFunctionStatusFilter(st.id)}
                          style={{
                            fontSize: 11,
                            fontWeight: functionStatusFilter === st.id ? 650 : 500,
                            padding: "4px 10px",
                            borderRadius: 5,
                            cursor: "pointer",
                            background:
                              functionStatusFilter === st.id
                                ? (isLight ? "#e0f2fe" : "rgba(56, 189, 248, 0.2)")
                                : (isLight ? "#ffffff" : "rgba(255,255,255,0.03)"),
                            color:
                              functionStatusFilter === st.id
                                ? (isLight ? "#0369a1" : "#38bdf8")
                                : (isLight ? "#64748b" : "#8b949e"),
                            border:
                              functionStatusFilter === st.id
                                ? (isLight ? "1px solid #7dd3fc" : "1px solid rgba(56, 189, 248, 0.4)")
                                : (isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.05)"),
                            transition: "all 0.15s ease",
                          }}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {loadingFunctions ? (
                  <div
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: isLight ? "#64748b" : "#6e7681",
                    }}
                  >
                    Loading function list...
                  </div>
                ) : filteredFunctions.length === 0 ? (
                  <div
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: isLight ? "#64748b" : "#6e7681",
                    }}
                  >
                    {functionsList.length === 0
                      ? "No function data available. Click 'Run Analysis Unit' to analyze Jest/Vitest."
                      : "No matching functions found for the filter."}
                  </div>
                ) : (
                  <div>
                    <div style={{ overflowX: "auto" }}>
                      <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "40px minmax(180px, 1.2fr) minmax(200px, 1.4fr) 85px 100px 95px 140px",
                        gap: 10,
                        minWidth: 760,
                        padding: "10px 18px",
                        background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)",
                        borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.05)",
                        fontSize: 11,
                        fontWeight: 650,
                        color: isLight ? "#475569" : "#8b949e",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      <span style={{ textAlign: "center" }}>#</span>
                      <span>Function Name</span>
                      <span>Source File</span>
                      <span>Location</span>
                      <span style={{ textAlign: "right" }}>Call Count</span>
                      <span style={{ textAlign: "center" }}>Status</span>
                      <span style={{ textAlign: "center" }}>Actions</span>
                    </div>

                    {paginatedFunctions.map((fn, idx) => {
                      const isCovered = fn.hit > 0;
                      return (
                        <div
                          key={
                            fn.id ||
                            `${fn.filePath}:${fn.functionName}:${fn.startLine}`
                          }
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "40px minmax(180px, 1.2fr) minmax(200px, 1.4fr) 85px 100px 95px 140px",
                            gap: 10,
                            minWidth: 760,
                            padding: "10px 18px",
                            alignItems: "center",
                            borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,.04)",
                            transition: "background 0.15s ease",
                          }}
                          className={isLight ? "hover:bg-slate-50/80" : "hover:bg-white/[0.02]"}
                        >
                          {/* Function Index */}
                          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: "var(--font-mono, monospace)",
                                color: isLight ? "#64748b" : "#94a3b8",
                                background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)",
                                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                                borderRadius: 6,
                                padding: "2px 6px",
                                minWidth: 26,
                                textAlign: "center",
                              }}
                            >
                              {(functionPage - 1) * FUNCTIONS_PER_PAGE + idx + 1}
                            </span>
                          </div>

                          <div
                            onClick={() => onOpenFile?.(fn.filePath)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              overflow: "hidden",
                              cursor: "pointer",
                            }}
                            title={`Open file ${fn.filePath} at function ${fn.functionName}`}
                          >
                            <Code2
                              size={14}
                              style={{
                                color: isCovered
                                  ? (isLight ? "#0284c7" : "#38bdf8")
                                  : (isLight ? "#d97706" : "#fbbf24"),
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 13,
                                color: isCovered
                                  ? (isLight ? "#0f172a" : "#e6edf3")
                                  : (isLight ? "#b45309" : "#fde68a"),
                                fontWeight: 600,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {resolveFunctionName(fn, flowData?.functions)}()
                            </span>
                          </div>

                          <div
                            onClick={() => onOpenFile?.(fn.filePath)}
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: isLight ? "#64748b" : "#8b949e",
                              fontSize: 12,
                              fontFamily: "var(--font-mono)",
                              cursor: "pointer",
                            }}
                            title={fn.filePath}
                          >
                            {cleanDisplayPath(fn.filePath)}
                          </div>

                          <div
                            style={{
                              fontSize: 11,
                              color: isLight ? "#64748b" : "#8b949e",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            L{fn.startLine || 1}
                            {fn.endLine ? ` - L${fn.endLine}` : ""}
                          </div>

                          <div
                            style={{
                              textAlign: "right",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                              fontWeight: 600,
                              color: isCovered
                                ? (isLight ? "#16a34a" : "#22c55e")
                                : (isLight ? "#d97706" : "#fbbf24"),
                            }}
                          >
                            {isCovered ? `${fn.hit} hits` : "0 hits"}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 10,
                                background: isCovered
                                  ? (isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.15)")
                                  : (isLight ? "#fefce8" : "rgba(251, 191, 36, 0.15)"),
                                color: isCovered
                                  ? (isLight ? "#15803d" : "#4ade80")
                                  : (isLight ? "#a16207" : "#fde047"),
                                border: isCovered
                                  ? (isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)")
                                  : (isLight ? "1px solid #fef08a" : "1px solid rgba(251, 191, 36, 0.3)"),
                              }}
                            >
                              {isCovered ? "✓ PASS" : "⚑ UNCALLED"}
                            </span>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                            }}
                          >
                            <button
                              onClick={() => onOpenFile?.(fn.filePath)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: isLight ? "#ffffff" : "rgba(255,255,255,0.05)",
                                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                                color: isLight ? "#334155" : "#c9d1d9",
                                fontSize: 11,
                                fontWeight: isLight ? 600 : 400,
                                cursor: "pointer",
                              }}
                              title="View function source code"
                            >
                              Open code
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <PaginationControl
                    currentPage={functionPage}
                    totalItems={filteredFunctions.length}
                    pageSize={FUNCTIONS_PER_PAGE}
                    onPageChange={setFunctionPage}
                    isLight={isLight}
                    itemLabel="functions"
                  />
                </div>
              )}
              </div>
            )
          ) : (
            /* ── C. Source File Coverage Table (All / Statements / Branches) ── */
            <div
              style={{
                ...cardStyle,
                marginTop: 14,
                padding: 0,
                overflow: "hidden",
                background: isLight ? "#ffffff" : cardStyle.background,
                border: isLight ? "1px solid #e2e8f0" : cardStyle.border,
                boxShadow: isLight ? "0 1px 3px rgba(15, 23, 42, 0.05)" : "none",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  fontWeight: 700,
                  borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,.07)",
                  background: isLight ? "#ffffff" : "transparent",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ color: isLight ? "#0f172a" : undefined }}>
                  {type === "integration"
                    ? "API / integration files"
                    : type === "system"
                      ? "Files exercised by E2E tests"
                      : activeMetricView === "statements"
                        ? "Source files (Sorted by statements)"
                        : activeMetricView === "branches"
                          ? "Source files (Sorted by branches)"
                          : "Source file coverage"}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Search input for source files */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: isLight ? "#ffffff" : "rgba(255,255,255,0.04)",
                      border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                    }}
                  >
                    <Search size={13} style={{ color: isLight ? "#64748b" : "#8b949e" }} />
                    <input
                      type="text"
                      placeholder="Search source files..."
                      value={sourceFileSearch}
                      onChange={(e) => setSourceFileSearch(e.target.value)}
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: isLight ? "#0f172a" : "#e6edf3",
                        fontSize: 12,
                        width: 140,
                      }}
                    />
                  </div>

                  <span
                    style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e", fontWeight: 400 }}
                  >
                    {filteredSourceFiles.length !== displayFiles.length
                      ? `${filteredSourceFiles.length} of ${displayFiles.length} files`
                      : `${displayFiles.length} files analyzed`}
                  </span>
                  {type === "unit" && allPendingSuggestions.length > 0 && (
                    <button
                      onClick={handleApplyAllGlobal}
                      disabled={isBulkApplying}
                      style={{
                        padding: "3px 10px",
                        background: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.15)",
                        border: isLight ? "1px solid #86efac" : "1px solid rgba(34, 197, 94, 0.4)",
                        borderRadius: 5,
                        color: isLight ? "#15803d" : "#4ade80",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: isBulkApplying ? "wait" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                      title="Apply all generated test suggestions across all files"
                    >
                      <Zap size={12} />
                      <span>Apply All ({allPendingSuggestions.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {displayFiles.length === 0 ? (
                <div
                  style={{ padding: 30, textAlign: "center", color: isLight ? "#64748b" : "#6e7681" }}
                >
                  {type === "system"
                    ? "No E2E test data available. Click Run System Test to start."
                    : type === "integration"
                      ? "No integration test data available. Click Run Integration Test to start."
                      : "No data available. Click Run Analysis Unit to start."}
                </div>
              ) : (
                <div>
                  <div style={{ overflowX: "auto" }}>
                    {/* Table Header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "40px minmax(220px, 1fr) repeat(4, 75px) 115px",
                      gap: 10,
                      minWidth: 700,
                      padding: "10px 18px",
                      background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)",
                      borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.05)",
                      fontSize: 11,
                      fontWeight: 650,
                      color: isLight ? "#475569" : "#8b949e",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    <span style={{ textAlign: "center" }}>#</span>
                    <span>Source File</span>
                    <span style={{ textAlign: "right" }}>Lines</span>
                    <span
                      style={{
                        textAlign: "right",
                        color:
                          activeMetricView === "branches"
                            ? (isLight ? "#d97706" : "#fbbf24")
                            : undefined,
                      }}
                    >
                      Branches
                    </span>
                    <span style={{ textAlign: "right" }}>Funcs</span>
                    <span
                      style={{
                        textAlign: "right",
                        color:
                          activeMetricView === "statements"
                            ? (isLight ? "#6366f1" : "#a78bfa")
                            : undefined,
                      }}
                    >
                      Stmts
                    </span>
                    <span style={{ textAlign: "center" }}>Actions</span>
                  </div>

                  {/* Table Rows */}
                  {paginatedSourceFiles.map((file, idx) => {
                    const isFull = (file.linesPct || 0) >= 100;
                    const isExpanded = expandedFiles.has(file.filePath);
                    const cacheEntry = fileCoverageCache[file.filePath];
                    const isLoadingDetails = cacheEntry?.loading;
                    const fileDetails = cacheEntry?.data;
                    const fileSuggestions = inlineSuggestions[file.filePath] || [];
                    const isSuggesting = loadingSuggestions[file.filePath] || false;
                    const lastApply = applyResultsByFile[file.filePath] || null;
                    const progressStep = applyProgressSteps[file.filePath] || "";

                    return (
                      <div key={file.filePath}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "40px minmax(220px, 1fr) repeat(4, 75px) 115px",
                            gap: 10,
                            minWidth: 700,
                            padding: "10px 18px",
                            alignItems: "center",
                            borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,.04)",
                            transition: "background 0.15s ease",
                            background: isExpanded
                              ? (isLight ? "#f8fafc" : "rgba(255,255,255,0.03)")
                              : "transparent",
                          }}
                          className={isLight ? "hover:bg-slate-50/80" : "hover:bg-white/[0.02]"}
                        >
                          {/* File Index */}
                          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: "var(--font-mono, monospace)",
                                color: isLight ? "#64748b" : "#94a3b8",
                                background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)",
                                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                                borderRadius: 6,
                                padding: "2px 6px",
                                minWidth: 26,
                                textAlign: "center",
                              }}
                            >
                              {(sourceFilePage - 1) * SOURCE_FILES_PER_PAGE + idx + 1}
                            </span>
                          </div>

                          {/* File path + status icon */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              overflow: "hidden",
                            }}
                          >
                            <span
                              onClick={() => toggleExpandFile(file.filePath)}
                              style={{
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 700,
                                color: isFull ? (isLight ? "#16a34a" : "#22c55e") : (isLight ? "#d97706" : "#eab308"),
                                flexShrink: 0,
                              }}
                            >
                              {isFull ? "✓" : "⚑"}
                            </span>

                            <span
                              onClick={() => toggleExpandFile(file.filePath)}
                              style={{
                                cursor: "pointer",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: isExpanded
                                  ? (isLight ? "#0f172a" : "#ffffff")
                                  : (isLight ? "#1e293b" : "#c9d1d9"),
                                fontSize: 13,
                                fontWeight: isExpanded ? 700 : 500,
                                fontFamily: "var(--font-mono)",
                              }}
                              title="Click to view execution flow analysis"
                            >
                              {cleanDisplayPath(file.filePath)}
                            </span>
                          </div>

                          {/* Coverage percentages */}
                          {[
                            { val: file.linesPct, col: "lines" },
                            { val: file.branchesPct, col: "branches" },
                            { val: file.funcsPct, col: "funcs" },
                            { val: file.stmtsPct, col: "stmts" },
                          ].map(({ val, col }, i) => {
                            const isHighlightedCol =
                              (col === "stmts" &&
                                activeMetricView === "statements") ||
                              (col === "branches" &&
                                activeMetricView === "branches") ||
                              (col === "funcs" &&
                                activeMetricView === "functions");

                            return (
                              <span
                                key={i}
                                style={{
                                  color: getCoverageColor(val, isLight),
                                  textAlign: "right",
                                  fontSize: 12,
                                  fontFamily: "var(--font-mono)",
                                  fontWeight: isHighlightedCol ? 750 : 600,
                                  background: isHighlightedCol
                                    ? isLight
                                      ? col === "stmts"
                                        ? "#ede9fe"
                                        : col === "branches"
                                          ? "#fef3c7"
                                          : "#e0f2fe"
                                      : col === "stmts"
                                        ? "rgba(167, 139, 250, 0.1)"
                                        : col === "branches"
                                          ? "rgba(251, 191, 36, 0.1)"
                                          : "rgba(56, 189, 248, 0.1)"
                                    : "transparent",
                                  padding: isHighlightedCol ? "2px 4px" : "0",
                                  borderRadius: isHighlightedCol ? 4 : 0,
                                }}
                              >
                                {pct(val)}
                              </span>
                            );
                          })}

                          {/* Action: Open Code & Expand Toggle */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                            }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandFile(file.filePath);
                              }}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: isExpanded
                                  ? (isLight ? "#eff6ff" : "rgba(56, 189, 248, 0.18)")
                                  : (isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)"),
                                border: isExpanded
                                  ? (isLight ? "1px solid #93c5fd" : "1px solid rgba(56, 189, 248, 0.4)")
                                  : (isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)"),
                                color: isExpanded
                                  ? (isLight ? "#1d4ed8" : "#38bdf8")
                                  : (isLight ? "#334155" : "#c9d1d9"),
                                fontSize: 11,
                                fontWeight: isLight ? 600 : 400,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                              className={isLight ? "hover:bg-slate-100" : "hover:bg-white/10 hover:text-white"}
                              title={isExpanded ? "Close view & edit" : "View coverage & edit code directly"}
                            >
                              {isExpanded ? "Close" : "View & Edit"}
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandFile(file.filePath);
                              }}
                              style={{
                                padding: "4px 6px",
                                borderRadius: 4,
                                background: isExpanded
                                  ? (isLight ? "#f1f5f9" : "rgba(255,255,255,0.14)")
                                  : (isLight ? "#ffffff" : "rgba(255,255,255,0.04)"),
                                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                                color: isExpanded
                                  ? (isLight ? "#0f172a" : "#ffffff")
                                  : (isLight ? "#64748b" : "#8b949e"),
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transition: "all 0.15s ease",
                                flexShrink: 0,
                              }}
                              className={isLight ? "hover:bg-slate-100" : "hover:bg-white/10 hover:text-white"}
                              title={
                                isExpanded
                                  ? "Collapse flow analysis"
                                  : "View execution flow analysis & suggestions"
                              }
                            >
                              {isExpanded ? (
                                <ChevronDown size={13} />
                              ) : (
                                <ChevronRight size={13} />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Expanded Dropdown Accordion Panel */}
                        {isExpanded && (
                          <div
                            style={{
                              padding: "14px 18px",
                              background: isLight ? "#f8fafc" : "rgba(0, 0, 0, 0.4)",
                              borderBottom: isLight
                                ? "1px solid #e2e8f0"
                                : "1px solid rgba(255, 255, 255, 0.08)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 16,
                            }}
                          >
                            {/* Inline Suggestions Section (only for unit test, when not in FileCodeExecutionView) */}
                            {type === "unit" && (fileSuggestions.length > 0 || isSuggesting) && activeMetricView !== "statements" && (
                              <InlineTestSuggestions
                                filePath={file.filePath}
                                suggestions={fileSuggestions}
                                isLoading={isSuggesting}
                                onApply={(sug) => handleApplySuggestionInline(file.filePath, sug)}
                                onApplyAll={(sugs) => handleApplyAllInline(file.filePath, sugs)}
                                onReject={(sugId) => handleRejectInline(file.filePath, sugId)}
                                onUpdateSuggestionCode={(sugId, newCode) =>
                                  handleUpdateSuggestionCode(file.filePath, sugId, newCode)
                                }
                                applyingIds={applyingSuggestionIds}
                                lastApplyResult={lastApply}
                                progressStep={progressStep}
                              />
                            )}

                            {isLoadingDetails || (!fileDetails && !cacheEntry?.error) ? (
                              <div
                                style={{
                                  padding: "24px",
                                  textAlign: "center",
                                  color: isLight ? "#64748b" : "#8b949e",
                                  fontSize: 12,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 8,
                                }}
                              >
                                <Loader2 size={16} className={`animate-spin ${isLight ? "text-indigo-600" : "text-purple-400"}`} />
                                <span>Analyzing execution flow for {cleanDisplayPath(file.filePath)}...</span>
                              </div>
                            ) : fileDetails ? (
                              activeMetricView === "branches" ? (
                                <FileBranchCFGView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  onOpenFile={onOpenFile}
                                  onSuggestTestcase={type === "unit" ? () => handleSuggestTestcaseInline(file.filePath) : undefined}
                                />
                              ) : activeMetricView === "functions" ? (
                                <FileFunctionCallGraphView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  testSuites={testSuites}
                                  onOpenFile={onOpenFile}
                                  onSuggestTestcase={type === "unit" ? () => handleSuggestTestcaseInline(file.filePath) : undefined}
                                />
                              ) : (
                                <FileCodeExecutionView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  projectId={projectId}
                                  snapshotId={snapshotId}
                                  onOpenFile={onOpenFile}
                                  onFileSaved={async (savedPath) => {
                                    await ensureFileCoverage(savedPath, true);
                                    invalidateCoverageQueries(snapshotId);
                                    await refetchCoverage();
                                  }}
                                  onSuggestTestcase={type === "unit" ? () => handleSuggestTestcaseInline(file.filePath) : undefined}
                                  suggestions={type === "unit" ? fileSuggestions : []}
                                  isLoadingSuggestions={type === "unit" ? isSuggesting : false}
                                  applyingSuggestionIds={type === "unit" ? applyingSuggestionIds : new Set()}
                                  onApplySuggestion={type === "unit" ? (sug) => handleApplySuggestionInline(file.filePath, sug) : undefined}
                                  onApplyAllSuggestions={type === "unit" ? (sugs) => handleApplyAllInline(file.filePath, sugs) : undefined}
                                  onRejectSuggestion={type === "unit" ? (sugId) => handleRejectInline(file.filePath, sugId) : undefined}
                                  onUpdateSuggestionCode={(sugId, newCode) =>
                                    handleUpdateSuggestionCode(file.filePath, sugId, newCode)
                                  }
                                  lastApplyResult={lastApply}
                                  progressStep={progressStep}
                                  isLight={isLight}
                                />
                              )
                            ) : (
                              <div
                                style={{
                                  padding: "20px",
                                  textAlign: "center",
                                  color: isLight ? "#dc2626" : "#f87171",
                                  fontSize: 12,
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <span>{cacheEntry?.error ? `Error: ${cacheEntry.error}` : "Failed to load flow analysis data for this file."}</span>
                                <button
                                  onClick={() => ensureFileCoverage(file.filePath, true)}
                                  style={{
                                    padding: "4px 10px",
                                    background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.15)",
                                    border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.3)",
                                    borderRadius: 4,
                                    color: isLight ? "#b91c1c" : "#f87171",
                                    fontSize: 11,
                                    cursor: "pointer",
                                  }}
                                >
                                  Retry
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <PaginationControl
                  currentPage={sourceFilePage}
                  totalItems={filteredSourceFiles.length}
                  pageSize={SOURCE_FILES_PER_PAGE}
                  onPageChange={setSourceFilePage}
                  isLight={isLight}
                  itemLabel="source files"
                />
              </div>
            )}
            </div>
          )}
        </>
      )}
      {showCfgModal && projectId && (
        <CFGCalculator
          project={{ id: projectId }}
          onClose={() => setShowCfgModal(false)}
        />
      )}
    </div>
  );
}
