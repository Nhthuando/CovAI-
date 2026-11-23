import {
  applyBatchResultToSuggestionsMap,
  buildUnitTestReviewFiles,
  collectUnappliedReviewSuggestions,
  normalizeReviewTestFile,
  summarizeApplyBatchResult,
} from '../../services/unitTestReview.js';
import { resolveTargetTestFile } from '../../services/unitTestResolution.js';
import { attachSocketAuthRecovery, socketAuth } from "../../lib/authSession.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatTestContext } from '../../hooks/useChatTestContext';
import SystemTestEvidence from './SystemTestEvidence.jsx';
import { io } from "socket.io-client";
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
  ListOrdered,
  Terminal,
  FileCode2,
  RefreshCw,
  Target,
  Play,
  FileCheck,
  History,
  Download,
  SlidersHorizontal,
  FileDiff,
  FlaskConical,
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
  installMissingDependency,
  installMissingDependencies,
  suggestUnitTestcase,
  suggestAllUnitTestcases,
  applyUnitTestSuggestion,
  getUnitTestVersions,
  switchUnitTestVersion,
  saveUnitTestVersions,
  getSystemCoverageSummary,
  saveAiSystemTest,
} from "../../services/coverage.service.js";
import {
  useCoverageDashboard,
  invalidateCoverageQueries,
  updateCoverageFilesData,
  invalidateProjectTree,
} from "../../hooks/useCoverageQuery.js";
import {
  getJobDetailApi,
  cancelJobApi,
  getProjectJobsApi,
} from "../../services/job.service.js";
import { queryClient } from "../../lib/queryClient.js";
import {
  deleteProjectEntryApi,
  getFileContentApi,
  getProjectCfgApi,
  generateSystemTestApi,
  updateFileContentApi,
} from "../../services/project.service.js";
import FunctionExecutionFlow from "./FunctionExecutionFlow.jsx";
import FileCodeExecutionView from "./FileCodeExecutionView.jsx";
import FileBranchCFGView from "./FileBranchCFGView.jsx";
import FileFunctionCallGraphView from "./FileFunctionCallGraphView.jsx";
import CFGCalculator from "./CFGCalculator.jsx";
import InlineTestSuggestions from "./InlineTestSuggestions.jsx";
import { CoverageDashboardSkeleton } from "../common/Skeleton.jsx";
import { useRunningProcess } from "../../contexts/RunningProcessContext.jsx";
import UnitTestGuidedWorkflow from "./UnitTestGuidedWorkflow.jsx";
import UnitTestPackageInstaller from "./UnitTestPackageInstaller.jsx";
import UnitTestTraceabilityMatrix, { extractMissingPackageFromError } from "./UnitTestTraceabilityMatrix.jsx";
import { loadSuggestionSourceFiles, needsUnitTestSuggestion } from '../../services/unitTestSuggestionQueue.js';
import { refreshPublishedUnitTests } from '../../services/unitTestRefresh.js';
import DiffReviewModal, { countDiffLines } from "./DiffReviewModal.jsx";
import UnitTestVersionPopover from "./UnitTestVersionPopover.jsx";
import UnitTestVersionHistoryView from "./UnitTestVersionHistoryView.jsx";
import InPlaceCoverageFileModal from "./InPlaceCoverageFileModal.jsx";
import SuggestTestcaseModal from "./SuggestTestcaseModal.jsx";
import UnitTestSimulationStudioModal from "./simulation/UnitTestSimulationStudioModal.jsx";
import { ExportUnitTestReportModal } from "./modals/ExportUnitTestReportModal.jsx";

const CONFIG = {
  unit: {
    title: "Unit Test Coverage",
    subtitle: "",
    supported: "Jest · Vitest",
    accent: "#a78bfa",
    focus: ["Statements", "Branches", "Functions", "Lines"],
    explanation: [
      ["Statement coverage", "Percentage of statements executed by tests."],
      [
        "Branch coverage",
        "Percentage of if/else/switch condition paths executed.",
      ],
      ["Function coverage", "Percentage of functions or methods called."],
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
      [
        "API contracts",
        "Requests, responses, status codes, and payload contracts.",
      ],
      ["Frontend ↔ Backend", "API calls from UI to routes/controllers."],
      [
        "Service integration",
        "Controller flows, services, and database/dependencies.",
      ],
    ],
  },
  system: {
    title: "System Test Coverage",
    subtitle:
      "Verify user journeys across the frontend, real API and database.",
    supported: "Playwright",
    accent: "#ec4899",
    focus: ["E2E tests", "Passed", "Failed", "Flaky / Stability", "Coverage"],
    explanation: [
      [
        "User journeys",
        "Authentication, user actions, and full business workflows.",
      ],
      [
        "Browser behavior",
        "UI rendering, routing navigation, and browser interactions.",
      ],
      ["Full system", "Frontend, backend, and database working together."],
    ],
  },
};

const pct = (value) => `${Number(value || 0).toFixed(1)}%`;
const coverageColor = (value) =>
  value >= 80
    ? "var(--color-coverage-good)"
    : value >= 60
      ? "var(--color-coverage-warning)"
      : "var(--color-coverage-low)";
const apiFile = (file) =>
  /(^|\/)(api|routes?|controllers?|services?|endpoints?)(\/|\.|$)/i.test(
    file.filePath,
  );
export const isTestFile = (filePath) => {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const rawBase = filePath.split(/[/\\]/).pop();

  // 1. Test directory pattern
  if (
    /(^|\/)(?:tests?|__tests__|specs?|__specs__|e2e|cypress|playwright|step-definitions?|step_definitions|fixtures?|mocks?|__mocks__|test[-_]data|test[-_]utils?|testing|test[-_]helpers?|(?:[a-z0-9_-]+[-_])?tests?)(?:\/|$)/i.test(
      normalized,
    )
  )
    return true;

  // 2. Token-separated test file name (e.g. test-api.ts, api-test.ts, test.ts, auth.test.js, test_runner.js)
  if (
    /(?:^|[._-])(?:tests?|specs?|testcase|steps?)(?:[._-]|$)/i.test(rawBase)
  ) {
    return true;
  }

  // 3. CamelCase / PascalCase test file names (e.g. testApi.ts, apiTest.ts, calculationServiceTest.ts)
  if (
    /^tests?[A-Z]/.test(rawBase) ||
    /[a-z0-9](?:Tests?|Specs?)\.[a-z0-9]+$/.test(rawBase)
  ) {
    return true;
  }

  return false;
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
  let normalized = fullPath
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();

  // Match inside docker or repo storage: storage/projects/<id>/.../repo/<relativePath>
  const repoMatch = normalized.match(/(?:^|\/)repo\/(.+)$/i);
  if (repoMatch) return repoMatch[1].replace(/^\/+/, "");

  // If path ends with /repo or is just /app/storage/..., don't show full internal path
  if (
    /(?:^|\/)(?:repo|storage\/projects\/[^/]+(?:\/[^/]+)*)\/?$/i.test(
      normalized,
    )
  ) {
    return "";
  }

  const storageMatch = normalized.match(
    /(?:^|\/)storage\/projects\/[^/]+(?:\/[^/]+)*?\/(.+)$/i,
  );
  if (storageMatch) return storageMatch[1].replace(/^\/+/, "");

  const uploadProjMatch = normalized.match(
    /(?:^|\/)uploads\/snapshots\/[^/]+\/[^/]+\/(.+)$/i,
  );
  if (uploadProjMatch) return uploadProjMatch[1].replace(/^\/+/, "");

  const uploadMatch = normalized.match(
    /(?:^|\/)uploads\/snapshots\/[^/]+\/(.+)$/i,
  );
  if (uploadMatch) return uploadMatch[1].replace(/^\/+/, "");

  // Strip leading project name prefix if it wraps standard package directories (e.g. "Online-Food-Ordering-System/server/...")
  // Do NOT strip if the first segment is already a valid package root (server, client, backend, frontend, services, packages, apps)
  const projPrefixMatch = normalized.match(/^(?!(?:server|client|backend|frontend|services|packages|apps)\/)[^/]+(?:\/)(server|client|backend|frontend|services|src|tests?|__tests__|packages|apps|lib|dist)\/(.+)$/i);
  if (projPrefixMatch) {
    return `${projPrefixMatch[1]}/${projPrefixMatch[2]}`;
  }

  normalized = normalized.replace(/^[a-zA-Z]:\//, "");
  normalized = normalized.replace(/^\/app\/(?:storage|uploads)\/?/i, "");
  return normalized.replace(/^\/+/, "");
};

const isBusinessLogicClientFile = (filePath) => {
  if (!filePath) return false;
  const cleanP = cleanDisplayPath(filePath);
  if (!cleanP) return false;
  const normalized = cleanP.toLowerCase();
  const rawBase = cleanP.split("/").pop();
  const base = rawBase.toLowerCase();

  // 1. Must be .js, .ts, .mjs, .cjs
  if (!/\.[cm]?[jt]s$/i.test(normalized)) return false;

  if (isTestFile(normalized)) return false;
  if (
    /(^|\/)(node_modules|coverage|dist|build|out|\.next|\.nuxt|\.turbo|\.git|\.cache|\.covai-temp|\.covai_journal)\//i.test(
      normalized,
    )
  )
    return false;
  if (
    /(?:^|\/)storage\/projects\//i.test(normalized) ||
    /(?:^|\/)server\/storage\//i.test(normalized)
  )
    return false;
  if (/(^|\/)(examples?|demos?|samples?)\//i.test(normalized)) return false;
  if (normalized.includes(".config.") || base.includes("config")) return false;
  if (
    /\.d\.ts$/i.test(normalized) ||
    /(^|\/)(types?|interfaces?)\.[cm]?[jt]s$/i.test(normalized) ||
    /\.types\.[cm]?[jt]s$/i.test(normalized) ||
    /(^|\/)types\//i.test(normalized)
  )
    return false;
  if (
    /(^|\/)presets\/tier[0-9]+[a-z0-9_-]*\.[cm]?[jt]s$/i.test(normalized) ||
    /(^|\/)presets\/(data|catalogs?|fixtures?|definitions?)\//i.test(normalized)
  )
    return false;
  if (
    /(^|\/)(client|frontend|components|views|pages|hooks|context|contexts|i18n|locales?|translations?)\//i.test(
      normalized,
    )
  )
    return false;
  if (/\.[jt]sx$/i.test(normalized) || /^use[A-Z]/.test(rawBase)) return false;
  if (
    /(^|\/)(routes?|endpoints?)(\/|\.|$)/i.test(normalized) ||
    /\.(route|routes)\.[cm]?[jt]sx?$/i.test(normalized) ||
    /(^|\/)(app|server)\.[cm]?[jt]sx?$/i.test(normalized) ||
    /^(?:[a-z0-9_-]+\/)?(?:src\/)?(index|main)\.[cm]?[jt]sx?$/i.test(
      normalized.replace(/^\.?\//, ""),
    )
  )
    return false;

  return true;
};

export const sanitizeErrorText = (text = "") => {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(
      /(?:\/app|[a-zA-Z]:[\\/][^ \t\r\n'\"()]*)?[\\/]storage[\\/]projects[\\/][^ \t\r\n'\"()]+(?:[\\/][^ \t\r\n'\"()]+)*?[\\/]repo[\\/]/gi,
      "",
    )
    .replace(/(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/repo\//gi, "")
    .replace(
      /(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/snapshots\/[^\s'\"()]+\/coverage\//gi,
      "",
    )
    .replace(
      /(?:\/app)?\/storage\/projects\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?/gi,
      "",
    )
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
  borderRadius: 8,
  padding: 17,
};
const buttonStyle = (color) => ({
  background: `${color}18`,
  color,
  border: `1px solid ${color}55`,
  borderRadius: 6,
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
        borderTop: isLight
          ? "1px solid #e2e8f0"
          : "1px solid rgba(255, 255, 255, 0.06)",
        background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        fontSize: 12,
      }}
    >
      <div
        style={{
          color: isLight ? "#64748b" : "#94a3b8",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span>Showing</span>
        <b style={{ color: isLight ? "#0f172a" : "#f1f5f9" }}>
          {startItem} – {endItem}
        </b>
        <span>of</span>
        <b style={{ color: isLight ? "#0f172a" : "#f1f5f9" }}>{totalItems}</b>
        <span>
          {itemLabel} (Page {currentPage} / {totalPages})
        </span>
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
              border: isLight
                ? "1px solid #cbd5e1"
                : "1px solid rgba(255, 255, 255, 0.1)",
              color:
                currentPage === 1
                  ? isLight
                    ? "#cbd5e1"
                    : "#475569"
                  : isLight
                    ? "#334155"
                    : "#e2e8f0",
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
              border: isLight
                ? "1px solid #cbd5e1"
                : "1px solid rgba(255, 255, 255, 0.1)",
              color:
                currentPage === 1
                  ? isLight
                    ? "#cbd5e1"
                    : "#475569"
                  : isLight
                    ? "#334155"
                    : "#e2e8f0",
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
                <span
                  key={`dots-${idx}`}
                  style={{
                    color: isLight ? "#94a3b8" : "#64748b",
                    padding: "0 2px",
                  }}
                >
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
                    ? isLight
                      ? "#7c3aed"
                      : "rgba(124, 58, 237, 0.3)"
                    : isLight
                      ? "#ffffff"
                      : "rgba(255, 255, 255, 0.05)",
                  border: isCurrent
                    ? isLight
                      ? "1px solid #7c3aed"
                      : "1px solid rgba(192, 132, 252, 0.5)"
                    : isLight
                      ? "1px solid #cbd5e1"
                      : "1px solid rgba(255, 255, 255, 0.1)",
                  color: isCurrent
                    ? isLight
                      ? "#ffffff"
                      : "#c084fc"
                    : isLight
                      ? "#334155"
                      : "#e2e8f0",
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
              border: isLight
                ? "1px solid #cbd5e1"
                : "1px solid rgba(255, 255, 255, 0.1)",
              color:
                currentPage === totalPages
                  ? isLight
                    ? "#cbd5e1"
                    : "#475569"
                  : isLight
                    ? "#334155"
                    : "#e2e8f0",
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
              border: isLight
                ? "1px solid #cbd5e1"
                : "1px solid rgba(255, 255, 255, 0.1)",
              color:
                currentPage === totalPages
                  ? isLight
                    ? "#cbd5e1"
                    : "#475569"
                  : isLight
                    ? "#334155"
                    : "#e2e8f0",
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

const activeJobSubscriptions = new Map();

async function waitForJob(jobId, onProgress) {
  return new Promise((resolve, reject) => {
    const jId = String(jobId);
    let pollTimer = null;
    let isSettled = false;

    const cleanup = () => {
      isSettled = true;
      if (pollTimer) clearInterval(pollTimer);
      activeJobSubscriptions.delete(jId);
    };

    const handleSuccess = (val) => {
      if (isSettled) return;
      cleanup();
      if (onProgress) onProgress(100, "SUCCESS");
      resolve(val);
    };

    const handleFailure = (err) => {
      if (isSettled) return;
      cleanup();
      reject(err instanceof Error ? err : new Error(err || "Job failed"));
    };

    // Register listener for instantaneous Socket.IO resolution
    activeJobSubscriptions.set(jId, {
      onProgress: (prog, status) => {
        if (!isSettled && onProgress) onProgress(prog, status);
      },
      resolve: handleSuccess,
      reject: handleFailure,
    });

    // Low-frequency safety heartbeat (every 10s instead of 1.5s spam)
    // Guarantees termination if WebSocket disconnects, reducing HTTP queries by >85%
    pollTimer = setInterval(async () => {
      if (isSettled) return;
      try {
        const response = await getJobDetailApi(jobId, { summary: true });
        const job = response?.job;
        if (!job) return;

        if (job.status === "SUCCESS") {
          handleSuccess(job);
        } else if (["FAILED", "CANCELED"].includes(job.status)) {
          handleFailure(job.errorMessage || job.error || `${job.status}: job failed`);
        } else if (typeof job.progress === "number" && onProgress) {
          onProgress(job.progress, job.status);
        }
      } catch {
        // Network hiccup; retry on next heartbeat
      }
    }, 10000);
  });
}

async function waitForQueueJobResult(jobId, onProgress) {
  await waitForJob(jobId, onProgress);
  const detail = await getJobDetailApi(jobId);
  const raw = detail?.job?.result ?? detail?.job?.resultJson;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

export const invalidateDashboardCache = (snapshotId) => {
  invalidateCoverageQueries(snapshotId);
};

export default function CoverageTypeDashboard({
  onChatContextChange,
  type,
  snapshotId,
  projectId,
  treeVersion = null,
  onOpenFile,
  onGenerate,
  generating,
  onSuggestTestcase,
  onOpenCFG,
  runTrigger,
  focusFile = null,
}) {
  const config = CONFIG[type];
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  const [systemSummary, setSystemSummary] = useState(null);
  const executionMode = "full";
  const [runningStatus, setRunningStatus] = useState("");

  const getExpectedWorkspaceRevision = () => {
    if (
      typeof treeVersion !== "undefined" &&
      treeVersion?.expectedWorkspaceRevision != null
    ) {
      return Number(treeVersion.expectedWorkspaceRevision) || 0;
    }
    return 0;
  };

  // React Query cached dashboard data - instant render on tab switch without loading lag
  const {
    data: coverageData,
    isLoading: isCoverageQueryLoading,
    isFetching: isCoverageQueryFetching,
    refetch: refetchCoverage,
  } = useCoverageDashboard(snapshotId, type, projectId);

  const summary =
    type === "system" && systemSummary
      ? {
          coverage: {
            statements: 0,
            branches: 0,
            functions: 0,
            lines: systemSummary.featureCoverage || 0,
          },
          rawTotals: null,
          ...systemSummary,
        }
      : coverageData?.summary || null;
  const files =
    type === "system" && systemSummary?.files?.length
      ? systemSummary.files
      : coverageData?.files || [];
  const executions =
    type === "system" && systemSummary?.latestRun
      ? {
          playwright:
            systemSummary.latestRun.type === "PLAYWRIGHT"
              ? systemSummary.latestRun
              : null,
          cypress:
            systemSummary.latestRun.type === "CYPRESS"
              ? systemSummary.latestRun
              : null,
        }
      : coverageData?.executions || {};
  const frameworks = coverageData?.frameworks || null;
  const functionsList = coverageData?.functionsList || [];
  const testSuites = coverageData?.testSuites || [];

  // Instant render: non-blocking loading only if cold fetch has zero cached data
  const loading =
    (type === "system" ? !systemSummary : !coverageData) &&
    isCoverageQueryLoading &&
    Boolean(snapshotId);
  const loadingFunctions =
    !coverageData?.functionsList?.length &&
    isCoverageQueryLoading &&
    type === "unit";
  const loadingTestSuites =
    !coverageData?.testSuites?.length &&
    isCoverageQueryLoading &&
    type === "unit";

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
    removeFileSuggestions,
  } = useRunningProcess();

  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runStep, setRunStep] = useState("");
  const [error, setError] = useState("");
  const [activeFramework, setActiveFramework] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [internalGenerating, setInternalGenerating] = useState(false);
  const [expandedScenario, setExpandedScenario] = useState(null);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const isGenerating = generating || internalGenerating;
  const activeJobIdRef = useRef(null);
  const pendingRunOptionsRef = useRef(null);

  const applyWithEnvironment = useCallback(async (payload) => {
    const requestId = payload.requestId || crypto.randomUUID();
    const response = await applyUnitTestSuggestion(snapshotId, { ...payload, requestId });
    return response;
  }, [snapshotId]);

  // Suggest TestCase Modal configuration
  const [suggestModalConfig, setSuggestModalConfig] = useState({
    isOpen: false,
    filePath: null,
    functionName: null,
    isBulk: false,
  });

  const handleOpenSuggestModal = useCallback(
    (filePath = null, functionName = null, isBulk = false) => {
      setSuggestModalConfig({
        isOpen: true,
        filePath,
        functionName,
        isBulk: Boolean(isBulk),
      });
    },
    [],
  );

  // Socket.IO realtime progress listener (F7)
  useEffect(() => {
    let userId = null;
    let socketToken = localStorage.getItem("token");
    try {
      const userStr = localStorage.getItem("user");
      if (userStr) {
        const user = JSON.parse(userStr);
        userId = user?.id;
        socketToken ||= user?.token;
      }
    } catch {
      /* Polling continues when stored user data is unavailable. */
    }

    const SOCKET_URL =
      import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";
    const socket = io(SOCKET_URL, {
      auth: socketAuth,
      withCredentials: true,
      autoConnect: true,
      reconnectionAttempts: 5,
    });
    attachSocketAuthRecovery(socket);

    socket.on("connect", () => {
      if (userId) socket.emit("subscribe_notifications", userId);
      if (projectId) socket.emit("project:subscribe", { projectId });
    });

    if (socket.connected && projectId) {
      socket.emit("project:subscribe", { projectId });
    }

    // Listen to real-time job progress emitted by dashboardEvents.service.js
    const onDashboardJobProgress = (data) => {
      if (!data) return;
      const jId = String(data.jobId || "");
      if (data.stage) {
        setRunningStatus(data.stage);
      }
      if (typeof data.progress === "number") {
        setRunProgress(data.progress);
        if (typeof updateAnalysisProgress === "function") {
          try {
            updateAnalysisProgress(data.progress, data.stage || "Running analysis...");
          } catch (_) {}
        }
      }

      // Dispatch to active job promise listener
      const sub = activeJobSubscriptions.get(jId);
      if (sub?.onProgress && typeof data.progress === "number") {
        sub.onProgress(data.progress, data.stage || data.status);
      }
      if (sub?.onStage && data.stage) {
        sub.onStage(data.stage);
      }
    };

    // Listen to real-time run status emitted by dashboardEvents.service.js
    const onDashboardRunStatus = (data) => {
      if (!data) return;
      const jId = String(data.jobId || "");
      const status = data.status;
      const sub = activeJobSubscriptions.get(jId);

      if (status === "RUNNING") {
        if (data.stage) setRunningStatus(data.stage);
      } else if (status === "SUCCESS") {
        setRunningStatus("");
        setRunProgress(100);
        if (activeJobIdRef.current && String(activeJobIdRef.current) === jId) {
          activeJobIdRef.current = null;
        }
        sub?.resolve?.(data);
      } else if (status === "FAILED" || status === "CANCELED") {
        setRunningStatus("");
        if (activeJobIdRef.current && String(activeJobIdRef.current) === jId) {
          activeJobIdRef.current = null;
        }
        sub?.reject?.(new Error(data.errorMessage || data.error || `${status}: test run failed`));
      }
    };

    // Listen to dashboard metrics update notifications
    const onDashboardMetricsUpdated = (data) => {
      if (data && (!data.snapshotId || data.snapshotId === snapshotId)) {
        invalidateCoverageQueries(snapshotId);
      }
    };

    const onUnitTestApplyProgress = (data) => {
      if (data && (!data.snapshotId || data.snapshotId === snapshotId)) {
        if (data.step) {
          setBulkApplyStep(data.step);
        }
        if (data.progressPct !== undefined && data.progressPct !== null) {
          setBulkApplyProgress(data.progressPct);
        }
        if (data.phase) {
          setBulkApplyPhase(data.phase);
        }
        updateBulkApplyStep({
          step: data.step,
          stats: data.stats || (data.totalCount ? `${data.completedCount || 0}/${data.totalCount}` : undefined),
          progressPct: data.progressPct,
          phase: data.phase,
          completedCount: data.completedCount,
          totalCount: data.totalCount,
          currentFile: data.currentFile || "",
        });
      }
    };

    const onUnitTestSuggestProgress = (data) => {
      if (data && (data.snapshotId === snapshotId || data.projectId === projectId)) {
        if (data.step) {
          setBulkSuggestMessage(data.step);
        }
        updateSuggestionProgress({
          snapshotId,
          completedFiles: data.completedCount || 0,
          totalFiles: data.totalCount || 0,
          currentFile: data.currentFile || "",
          filePath: data.currentFile || "",
          message: data.step || `Processed ${data.completedCount || 0}/${data.totalCount || 0} source files.`
        });
      }
    };

    socket.on("dashboard:job-progress", onDashboardJobProgress);
    socket.on("dashboard:run-status", onDashboardRunStatus);
    socket.on("dashboard:metrics-updated", onDashboardMetricsUpdated);
    socket.on("job:progress", onDashboardJobProgress);
    socket.on("unit_test:apply_progress", onUnitTestApplyProgress);
    socket.on("unit_test:suggest_progress", onUnitTestSuggestProgress);

    return () => {
      if (projectId && socket.connected) {
        socket.emit("project:unsubscribe", { projectId });
      }
      socket.off("dashboard:job-progress", onDashboardJobProgress);
      socket.off("dashboard:run-status", onDashboardRunStatus);
      socket.off("dashboard:metrics-updated", onDashboardMetricsUpdated);
      socket.off("job:progress", onDashboardJobProgress);
      socket.off("unit_test:apply_progress", onUnitTestApplyProgress);
      socket.off("unit_test:suggest_progress", onUnitTestSuggestProgress);
      socket.disconnect();
    };
  }, [snapshotId, projectId, updateBulkApplyStep, updateAnalysisProgress]);

  const waitForJobWithProgress = useCallback(async (jobId, defaultInitial = "Starting AUT server...") => {
    activeJobIdRef.current = jobId;
    setRunningStatus(defaultInitial);
    try {
      await waitForJob(jobId, (prog, stage) => {
        if (stage && typeof stage === "string") {
          setRunningStatus(stage);
        }
        if (typeof prog === "number") {
          setRunProgress(prog);
        }
      });
    } finally {
      setRunningStatus("");
      activeJobIdRef.current = null;
    }
  }, []);

  const handleGenerateAiSystemTest = async () => {
    if (onGenerate && !projectId) {
      return onGenerate("system");
    }
    if (!projectId || !snapshotId) return;
    setGenerateError("");
    setInternalGenerating(true);
    setRunningStatus("Generating Playwright E2E tests with AI...");
    try {
      const response = await generateSystemTestApi(
        projectId,
        snapshotId,
        executionMode,
      );
      const jobId = response?.data?.job?.id || response?.job?.id;
      if (jobId) {
        await waitForJobWithProgress(
          jobId,
          "Generating Playwright E2E tests with AI...",
        );
      }
      const updatedSys = await load();
      if (updatedSys?.latestAiTest?.status === "VERIFIED") {
        await run();
      }
    } catch (err) {
      setGenerateError(err.message || "Failed to generate AI system tests.");
      await load();
    } finally {
      setInternalGenerating(false);
      setRunningStatus("");
    }
  };

  const [isSavingAiTest, setIsSavingAiTest] = useState(false);

  const handleSaveAiSystemTest = async () => {
    if (!snapshotId || isSavingAiTest) return;
    setIsSavingAiTest(true);
    setGenerateError("");
    try {
      await saveAiSystemTest(snapshotId);
      const updatedSys = await load();
      if (updatedSys?.latestAiTest?.status === "VERIFIED") {
        await run();
      }
    } catch (err) {
      setGenerateError(err.message || "Failed to save AI test to project.");
    } finally {
      setIsSavingAiTest(false);
    }
  };

  const [dependencyInstallError, setDependencyInstallError] = useState("");
  const [dependencyInstallLogs, setDependencyInstallLogs] = useState([]);

  // Mode view for Unit test: "traceability" (default for unit) | "testcases" | "versions" | "all" | "statements" | "branches" | "functions"
  const [activeMetricView, setActiveMetricView] = useState(
    type === "unit" ? "traceability" : "all",
  );

  // View mode for Function coverage
  const [functionViewMode, setFunctionViewMode] = useState("map"); // "map" | "table"
  const [selectedSourceFile, setSelectedSourceFile] = useState("");
  const [flowData, setFlowData] = useState(null);
  const [loadingFlow, setLoadingFlow] = useState(false);
  const [showCfgModal, setShowCfgModal] = useState(false);
  const [cfgModalContext, setCfgModalContext] = useState(null);

  // In-place file viewer state to view source and test files directly inside Unit Test without redirecting
  const [inPlaceOpenFileTarget, setInPlaceOpenFileTarget] = useState(null);

  // Interactive Unit Test Execution Simulation Studio target state
  const [simulationTarget, setSimulationTarget] = useState(null);

  // Unit Test Export Report Modal state
  const [isUnitTestExportOpen, setIsUnitTestExportOpen] = useState(false);

  const handleOpenFileInPlace = useCallback(
    (
      filePath,
      targetLine = null,
      functionName = null,
      endLine = null,
      testInfo = null,
    ) => {
      if (!filePath) return;
      setInPlaceOpenFileTarget({
        filePath,
        targetLine: targetLine ? Number(targetLine) : null,
        functionName: functionName || null,
        endLine: endLine ? Number(endLine) : null,
        testInfo: testInfo || null,
      });
    },
    [],
  );

  // Multi-accordion state: Set of expanded filePaths (supports opening File A, File B, File C simultaneously)
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [fileCoverageCache, setFileCoverageCache] = useState({});

  // Inline suggestions state by filePath: { [filePath]: [suggestion1, ...] }
  // Initialized from persistent cache so switching pages or reloading never loses generated tests
  const [inlineSuggestions, setInlineSuggestions] = useState(() => {
    return (snapshotId ? getSuggestions(snapshotId) : {}) || {};
  });
  const [hasSuggestJobCompleted, setHasSuggestJobCompleted] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState({});
  const [suggestionErrors, setSuggestionErrors] = useState({});
  const [applyingSuggestionIds, setApplyingSuggestionIds] = useState(new Set());
  const [applyResultsByFile, setApplyResultsByFile] = useState({});
  const [applyProgressSteps, setApplyProgressSteps] = useState({});

  useEffect(() => {
    if (!focusFile) return;
    setActiveMetricView("branches");
    setSelectedSourceFile(focusFile);
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      next.add(focusFile);
      return next;
    });
  }, [focusFile]);

  // Restore cached suggestions if snapshotId changes
  const lastRestoredSnapshotRef = useRef(snapshotId);
  useEffect(() => {
    if (snapshotId && snapshotId !== lastRestoredSnapshotRef.current) {
      lastRestoredSnapshotRef.current = snapshotId;
      setSuggestionErrors({});
      const cached = getSuggestions(snapshotId);
      if (cached && Object.keys(cached).length > 0) {
        setInlineSuggestions(cached);
      } else {
        setInlineSuggestions({});
      }
    }
  }, [snapshotId, getSuggestions]);

  // Synchronize cached suggestions whenever inlineSuggestions changes (guarded by serialized hash)
  const lastSavedJsonRef = useRef("");
  useEffect(() => {
    if (snapshotId && inlineSuggestions) {
      const serialized = JSON.stringify(inlineSuggestions);
      if (serialized !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = serialized;
        saveSuggestions(snapshotId, inlineSuggestions);
      }
    }
  }, [snapshotId, inlineSuggestions, saveSuggestions]);

  // Sync cached suggestions when RunningProcessContext finishes a background UNIT_TEST_SUGGEST job
  useEffect(() => {
    if (
      type === "unit" &&
      snapshotId &&
      processes.suggestion.snapshotId === snapshotId &&
      !processes.suggestion.isGenerating &&
      processes.suggestion.completedAt
    ) {
      const cached = getSuggestions(snapshotId);
      if (cached && Object.keys(cached).length > 0) {
        setInlineSuggestions((prev) => ({ ...prev, ...cached }));
      }
      setHasSuggestJobCompleted(true);
      setIsBulkSuggesting(false);
    }
  }, [
    type,
    snapshotId,
    processes.suggestion.snapshotId,
    processes.suggestion.isGenerating,
    processes.suggestion.completedAt,
    getSuggestions,
  ]);

  // Hydrate or resume UNIT_TEST_SUGGEST / UNIT_TEST_APPLY jobs from server queue when switching projects
  useEffect(() => {
    if (type !== "unit" || !projectId || !snapshotId) return;
    setHasSuggestJobCompleted(false);
    let cancelled = false;

    const hydrateSuggestionsFromResult = (data) => {
      if (!data || !Array.isArray(data.suggestions)) return;
      const grouped = {};
      for (let idx = 0; idx < data.suggestions.length; idx++) {
        const sug = data.suggestions[idx];
        const key = sug.sourceFile || sug.filePath || (Array.isArray(sug.sourceFiles) ? sug.sourceFiles[0] : null);
        if (!key) continue;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          ...sug,
          suggestionId: sug.suggestionId || sug.id || `${key}-sug-${grouped[key].length + 1}`,
        });
      }
      if (Object.keys(grouped).length > 0) {
        setInlineSuggestions((prev) => ({ ...prev, ...grouped }));
      }
      if (Array.isArray(data.failedFiles) && data.failedFiles.length > 0) {
        const failMap = {};
        for (const f of data.failedFiles) {
          if (f?.filePath) failMap[f.filePath] = f.message || "Suggestion failed";
        }
        setSuggestionErrors((prev) => ({ ...prev, ...failMap }));
      }
    };

    const syncFromProjectJobs = async () => {
      try {
        const res = await getProjectJobsApi(projectId);
        if (cancelled) return;
        const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
        const snapshotJobs = jobs.filter((j) => j.snapshotId === snapshotId);

        const activeRunJob = snapshotJobs.find(
          (j) =>
            ["RUN_TESTS", "ANALYSIS", "RUN_VITEST_TESTS", "VITEST_COVERAGE"].includes(j.type) &&
            ["QUEUED", "RUNNING"].includes(j.status)
        );
        if (activeRunJob && !activeJobIdRef.current) {
          activeJobIdRef.current = activeRunJob.id;
          setRunning(true);
          setRunProgress(typeof activeRunJob.progress === "number" ? activeRunJob.progress : 10);
          setRunStep("Running unit test suite & collecting coverage...");
          setRunningStatus("Running analysis...");
          startAnalysis({
            snapshotId,
            projectId,
            type: "unit",
            jobId: activeRunJob.id,
            progress: activeRunJob.progress,
          });
          void (async () => {
            try {
              await waitForJob(activeRunJob.id, (prog) => {
                if (cancelled) return;
                setRunProgress(prog);
                updateAnalysisProgress(prog, "Running unit test suite & collecting coverage...");
              });
              if (!cancelled) {
                completeAnalysis(true);
                invalidateCoverageQueries(snapshotId);
                await refetchCoverage();
              }
            } catch (runErr) {
              if (!cancelled) {
                completeAnalysis(false, runErr?.message || "Test run failed.");
              }
            } finally {
              if (activeJobIdRef.current === activeRunJob.id) {
                activeJobIdRef.current = null;
              }
              if (!cancelled) {
                setRunning(false);
                setRunningStatus("");
                setRunProgress(0);
                setRunStep("");
              }
            }
          })();
        }

        const latestSuggest = snapshotJobs.find((j) => j.type === "UNIT_TEST_SUGGEST");
        if (latestSuggest) {
          if (["QUEUED", "RUNNING"].includes(latestSuggest.status)) {
            let payload = {};
            try { payload = latestSuggest.payloadJson ? JSON.parse(latestSuggest.payloadJson) : {}; } catch (_) {}
            const totalFiles = Array.isArray(payload.filePaths) ? payload.filePaths.length : 1;
            setIsBulkSuggesting(true);
            setBulkSuggestMessage("Resuming queued test suggestion session...");
            startSuggestion({
              snapshotId,
              projectId,
              jobId: latestSuggest.id,
              totalFiles,
              initialMessage: "Resuming queued test suggestion session...",
            });
            try {
              const result = await waitForQueueJobResult(latestSuggest.id);
              if (!cancelled) {
                hydrateSuggestionsFromResult(result);
                setHasSuggestJobCompleted(true);
                completeSuggestion("Generated inline test suggestions.");
              }
            } catch (err) {
              if (!cancelled) {
                setBulkSuggestMessage(`Error generating testcases: ${err.message}`);
                completeSuggestion(`Error: ${err.message}`);
              }
            } finally {
              if (!cancelled) setIsBulkSuggesting(false);
            }
          } else if (latestSuggest.status === "SUCCESS") {
            setHasSuggestJobCompleted(true);
            const cachedLocal = getSuggestions(snapshotId);
            if (cachedLocal && Object.keys(cachedLocal).length > 0) {
              setInlineSuggestions((prev) => ({ ...prev, ...cachedLocal }));
            } else if (latestSuggest.resultJson) {
              try {
                const parsed = JSON.parse(latestSuggest.resultJson);
                hydrateSuggestionsFromResult(parsed);
              } catch (_) {}
            } else {
              try {
                const detail = await getJobDetailApi(latestSuggest.id);
                const raw = detail?.job?.result ?? detail?.job?.resultJson;
                const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
                if (!cancelled && parsed) {
                  hydrateSuggestionsFromResult(parsed);
                }
              } catch (_) {}
            }
          }
        }

        const latestApply = snapshotJobs.find((j) => j.type === "UNIT_TEST_APPLY");
        if (latestApply && !cancelled) {
          let applyPayload = {};
          try { applyPayload = latestApply.payloadJson ? JSON.parse(latestApply.payloadJson) : {}; } catch (_) {}
          const sugsList = Array.isArray(applyPayload.suggestions)
            ? applyPayload.suggestions
            : applyPayload.suggestion
            ? [applyPayload.suggestion]
            : [];
          const ids = new Set(sugsList.map((s) => s?.suggestionId || s?.id).filter(Boolean));

          if (["QUEUED", "RUNNING"].includes(latestApply.status)) {
            setIsBulkApplying(true);
            setBulkApplyStep("Resuming queued apply & verification job...");
            setApplyingSuggestionIds((prev) => new Set([...prev, ...ids]));
            startBulkApply({
              snapshotId,
              projectId,
              jobId: latestApply.id,
              totalFiles: sugsList.length,
              totalCount: sugsList.length,
              totalSugs: sugsList.length,
              step: "Resuming queued apply & verification job...",
              phase: "verify",
            });
            try {
              const result = await waitForQueueJobResult(latestApply.id);
              if (!cancelled) {
                setInlineSuggestions((prev) => applyBatchResultToSuggestionsMap(prev, ids, result));
                const summary = summarizeApplyBatchResult(result, sugsList.length);
                setBulkIsolatedDefects(summary.isolatedDefects);
                completeBulkApply({ ...result, message: summary.message });
                invalidateCoverageQueries(snapshotId);
                await refetchCoverage();
              }
            } catch (err) {
              if (!cancelled) {
                completeBulkApply({ success: false, error: err.message });
              }
            } finally {
              if (!cancelled) {
                setIsBulkApplying(false);
                setApplyingSuggestionIds((prev) => {
                  const next = new Set(prev);
                  ids.forEach((id) => next.delete(id));
                  return next;
                });
              }
            }
          } else if (latestApply.status === "SUCCESS" && latestApply.resultJson && ids.size > 0) {
            try {
              const parsed = JSON.parse(latestApply.resultJson);
              setInlineSuggestions((prev) => {
                const hasPending = Object.values(prev || {})
                  .flat()
                  .some((s) => ids.has(s?.suggestionId || s?.id) && ["GENERATED", "APPLYING"].includes(s?.status));
                return hasPending ? applyBatchResultToSuggestionsMap(prev, ids, parsed) : prev;
              });
            } catch (_) {}
          }
        }
      } catch (err) {
        console.warn("[CoverageTypeDashboard] Failed to hydrate unit test jobs:", err?.message || err);
      }
    };

    void syncFromProjectJobs();
    return () => {
      cancelled = true;
    };
  }, [type, projectId, snapshotId]);

  // Sync analysis running state with runningProcessContext
  useEffect(() => {
    if (
      processes.analysis.isRunning &&
      processes.analysis.snapshotId === snapshotId
    ) {
      setRunning(true);
      if (typeof processes.analysis.progress === "number") {
        setRunProgress(processes.analysis.progress);
      }
      if (processes.analysis.step) {
        setRunStep(processes.analysis.step);
      }
    } else if (!processes.analysis.isRunning && !activeJobIdRef.current) {
      setRunning(false);
      setRunningStatus("");
    }
  }, [processes.analysis, snapshotId]);

  // Ensure file coverage data is always available in cache when a file is viewed/expanded
  const fileCoverageCacheRef = useRef({});
  useEffect(() => {
    fileCoverageCacheRef.current = fileCoverageCache;
  }, [fileCoverageCache]);

  const ensureFileCoverage = useCallback(
    async (filePath, force = false) => {
      if (!snapshotId || !filePath) return null;
      if (!force && fileCoverageCacheRef.current[filePath]?.data) {
        return fileCoverageCacheRef.current[filePath].data;
      }

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
    [snapshotId],
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

  // Trigger inline suggestion generation directly below the source file
  const handleSuggestTestcaseInline = useCallback(
    async (filePath, autoExpand = true, frameworkOverride = null, throwOnError = false) => {
      if (!snapshotId || !filePath) return;
      if (autoExpand) {
        // Auto-expand this file so the suggestion displays immediately inline
        setExpandedFiles((prev) => new Set(prev).add(filePath));
        // Pre-load coverage data so execution view displays smoothly without error
        ensureFileCoverage(filePath);
      }

      setLoadingSuggestions((prev) => ({ ...prev, [filePath]: true }));
      setSuggestionErrors((prev) => ({ ...prev, [filePath]: null }));
      try {
        const res = await suggestUnitTestcase(
          snapshotId,
          filePath,
          projectId,
          frameworkOverride || activeFramework,
        );
        const data = res?.data || res;
        const sugs = Array.isArray(data?.suggestions)
          ? data.suggestions
          : (data?.suggestion ? [data.suggestion] : (Array.isArray(data) ? data : []));
        const finalSugs = sugs.length > 0 ? sugs : (data ? [data] : []);
        if (!finalSugs.some(s => s.isFullyCovered || s.status === 'FULLY_COVERED' ||
          [s.fullUpdatedContent, s.suggestedTestCode, s.generatedCode, s.testCode].some(code => typeof code === 'string' && code.trim()))) {
          throw new Error(data?.message || data?.validation?.message || 'No test draft was returned for this file. Retry Suggest Tests.');
        }

        const telemetry = data?.telemetry || finalSugs[0]?.telemetry || null;
        const mappedSugs = finalSugs.map((s, idx) => ({
          ...s,
          originalGeneratedCode:
            s.originalGeneratedCode ??
            s.suggestedTestCode ??
            s.generatedCode ??
            "",
          suggestionId: s.suggestionId || `${filePath}-sug-${idx + 1}`,
          status: s.status || "GENERATED",
          telemetry: s.telemetry || telemetry,
        }));

        setInlineSuggestions((prev) => ({
          ...prev,
          [filePath]: mappedSugs,
        }));

        // Notify global quota pill
        window.dispatchEvent(new CustomEvent("covai:ai-usage-updated"));
        return mappedSugs;
      } catch (err) {
        console.error("Failed to generate test suggestions inline:", err);
        setSuggestionErrors((prev) => ({ ...prev, [filePath]: err.message || 'Test suggestion failed. Retry this file.' }));
        if (throwOnError) throw err;
        return [];
      } finally {
        setLoadingSuggestions((prev) => ({ ...prev, [filePath]: false }));
      }
    },
    [snapshotId, projectId, activeFramework, ensureFileCoverage],
  );

  // Auto-fetch file coverage details ONLY for expanded files (lazy loaded on user click)
  useEffect(() => {
    expandedFiles.forEach((fPath) => {
      if (
        !fileCoverageCacheRef.current[fPath]?.data &&
        !fileCoverageCacheRef.current[fPath]?.loading
      ) {
        ensureFileCoverage(fPath);
      }
    });
  }, [expandedFiles, ensureFileCoverage]);

  // Apply single suggestion inline, execute runner, update real coverage
  const handleApplySuggestionInline = useCallback(
    async (filePath, suggestion) => {
      if (!snapshotId || !suggestion) return;
      const cleanFile = cleanDisplayPath(filePath);
      const sugId = suggestion.suggestionId || suggestion.id;
      setApplyingSuggestionIds((prev) => new Set(prev).add(sugId));

      const initialStep = `[1/1] Merging test for ${cleanFile}...`;
      setApplyProgressSteps((prev) => ({
        ...prev,
        [filePath]: initialStep,
      }));

      startBulkApply({
        snapshotId,
        projectId,
        totalCount: 1,
        totalFiles: 1,
        totalSugs: 1,
        step: initialStep,
        stats: "1/1",
        progressPct: 50,
        phase: "merge",
      });

      // Status transition: GENERATED/EDITED -> APPLYING
      setInlineSuggestions((prev) => {
        const fileSugs = prev[filePath] || [];
        return {
          ...prev,
          [filePath]: fileSugs.map((s) =>
            s.suggestionId === sugId || s.id === sugId
              ? { ...s, status: "APPLYING" }
              : s,
          ),
        };
      });

      try {
        const verifyStep = `[1/1] Running tests & measuring coverage for ${cleanFile}...`;
        setApplyProgressSteps((prev) => ({
          ...prev,
          [filePath]: verifyStep,
        }));
        updateBulkApplyStep({
          step: verifyStep,
          stats: "1/1",
          progressPct: 80,
          phase: "verify",
          currentFile: filePath,
        });

        const res = await applyWithEnvironment({
          suggestion: {
            ...suggestion,
            proposalBase: suggestion.proposalBase || {
              snapshotId,
              workspaceRevision: getExpectedWorkspaceRevision(),
            },
          },
          projectId,
        });

        const resultData = res?.data || res;
        const testStatus = resultData?.testStatus || resultData?.status;
        const isPassed =
          testStatus !== "FAILED" &&
          resultData?.isPassed !== false &&
          (testStatus === "PASSED" ||
            resultData?.isPassed === true ||
            resultData?.success === true);

        const appliedMap = new Map();
        if (Array.isArray(resultData?.appliedSuggestions)) {
          for (const item of resultData.appliedSuggestions) {
            appliedMap.set(item.suggestionId || item.id, item);
          }
        }

        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) => {
              const matchedItem = appliedMap.get(s.suggestionId || s.id);
              if (matchedItem) {
                const itemPassed = matchedItem.status === "PASSED";
                return {
                  ...s,
                  status: matchedItem.status || (isPassed ? "PASSED" : "FAILED"),
                  qualityGate: resultData?.qualityGate || s.qualityGate,
                  testRunError: matchedItem.error || (itemPassed ? null : (resultData?.testRunError || resultData?.errorDetail || resultData?.message || null)),
                  missingDependency: matchedItem.missingDependency || resultData?.missingDependency || resultData?.moduleResolutionError?.missingDependency || null,
                  missingDependencies: resultData?.missingDependencies,
                };
              }
              if (s.suggestionId === sugId || s.id === sugId) {
                return {
                  ...s,
                  status: isPassed ? "PASSED" : "FAILED",
                  qualityGate: resultData?.qualityGate || s.qualityGate,
                  testRunError: isPassed ? null : (resultData?.testRunError || resultData?.errorDetail || resultData?.message || null),
                  missingDependency: isPassed ? null : (resultData?.missingDependency || resultData?.moduleResolutionError?.missingDependency || null),
                  missingDependencies: resultData?.missingDependencies,
                };
              }
              return s;
            }),
          };
        });

        const fileResult = resultData?.perFileResults?.[filePath];

        const oldCov =
          fileResult?.oldCoverage ??
          resultData?.oldCoverage ??
          resultData?.previousCoverage ??
          null;
        const newCov =
          fileResult?.newCoverage ?? resultData?.newCoverage ?? null;

        if (oldCov || newCov || !isPassed) {
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
          updateCoverageFilesData(
            snapshotId,
            type,
            projectId,
            resultData.perFileResults,
          );
        }

        // Invalidate cached query data and refetch new verified coverage from test runner
        invalidateCoverageQueries(snapshotId);
        const refreshErrors = await refreshPublishedUnitTests([() => refetchCoverage(), () => loadUnitTestVersions()]);
        invalidateProjectTree(projectId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("covai:project-event", {
              detail: { projectId, type: "file" },
            })
          );
        }

        // If backend returned a background analysis job, track it and auto-sync when it completes
        if (resultData?.backgroundJob?.id) {
          const bgJobId = resultData.backgroundJob.id;
          startAnalysis({
            snapshotId,
            projectId,
            type: "unit",
            jobId: bgJobId,
          });
          (async () => {
            try {
              await waitForJob(bgJobId, (prog) => {
                updateAnalysisProgress(
                  prog,
                  "Refreshing full project coverage analysis...",
                );
              });
              completeAnalysis(
                "✓ Full project unit test analysis completed! All metrics updated.",
              );
              invalidateCoverageQueries(snapshotId);
              await refreshPublishedUnitTests([() => refetchCoverage(), () => ensureFileCoverage(filePath, true)]);
            } catch (error) {
              completeAnalysis(`Coverage refresh failed: ${error.message}`);
              setBulkSuggestMessage(`Coverage refresh failed: ${error.message}`);
            }
          })();
        }

        // Refresh file coverage in-place so FileCodeExecutionView immediately updates with fresh hits & lines
        refreshErrors.push(...await refreshPublishedUnitTests([() => ensureFileCoverage(filePath, true)]));

        const inlineDoneMsg = resultData.status === "NO_CHANGES" ? resultData.postApplyAnalysisError || resultData.message
          : refreshErrors.length ? `Tests saved for ${cleanFile}. Some views could not refresh. Reload to see the committed results.` : isPassed
          ? `✓ Successfully applied test for ${cleanFile}! Coverage updated.`
          : `Applied test for ${cleanFile} (test runner reported some failures).`;
        completeBulkApply({
          ...resultData,
          message: inlineDoneMsg,
        });
      } catch (err) {
        console.error("Failed to apply suggestion:", err);
        completeBulkApply({ error: err.message });
        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) =>
              s.suggestionId === sugId || s.id === sugId
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

  const [reviewUndo, setReviewUndo] = useState({});
  useEffect(() => {
    setReviewUndo({});
  }, [snapshotId]);

  // Apply all suggestions inline safely without overwriting
  const handleApplyAllInline = useCallback(
    async (filePath, suggestions, reviewFile = null, customCode = null) => {
      if (!snapshotId || !suggestions?.length) return;
      const cleanFile = cleanDisplayPath(filePath);
      const totalSugs = suggestions.length;
      const sugIds = suggestions.map((s) => s.suggestionId || s.id);
      setApplyingSuggestionIds((prev) => {
        const next = new Set(prev);
        sugIds.forEach((id) => next.add(id));
        return next;
      });

      const initialInlineStep = `[1/1] Merging ${totalSugs} tests for ${cleanFile}...`;
      setApplyProgressSteps((prev) => ({
        ...prev,
        [filePath]: initialInlineStep,
      }));

      startBulkApply({
        snapshotId,
        projectId,
        totalCount: totalSugs,
        totalFiles: 1,
        totalSugs,
        step: initialInlineStep,
        stats: "1/1",
        progressPct: 50,
        phase: "merge",
      });

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
        const verifyInlineStep = `[1/1] Running tests & measuring coverage for ${cleanFile}...`;
        setApplyProgressSteps((prev) => ({
          ...prev,
          [filePath]: verifyInlineStep,
        }));
        updateBulkApplyStep({
          step: verifyInlineStep,
          stats: "1/1",
          progressPct: 80,
          phase: "verify",
          currentFile: filePath,
        });

        let previousFile;
        if (reviewFile) {
          try {
            previousFile = (
              await getFileContentApi(projectId, reviewFile, {
                snapshotId,
                forceFresh: true,
              })
            ).data;
          } catch (error) {
            if (error.status !== 404) throw error;
            previousFile = null;
          }
        }
        const res = await applyWithEnvironment({
          suggestions: suggestions.map((s, idx) => ({
            ...s,
            ...(customCode && idx === 0
              ? {
                  generatedCode: customCode,
                  suggestedTestCode: customCode,
                  fullUpdatedContent: customCode,
                }
              : {}),
            proposalBase: s.proposalBase || {
              snapshotId,
              workspaceRevision: getExpectedWorkspaceRevision(),
            },
          })),
          projectId,
        });

        const resultData = res?.data || res;
        const testStatus = resultData?.testStatus || resultData?.status;
        const isPassed =
          testStatus !== "FAILED" &&
          resultData?.isPassed !== false &&
          (testStatus === "PASSED" ||
            resultData?.isPassed === true ||
            resultData?.success === true);

        const fileWritten = Boolean(
          isPassed &&
          (resultData?.fileUpdated ||
            resultData?.changedPaths?.some(
              (path) =>
                cleanDisplayPath(path) === cleanDisplayPath(reviewFile || ""),
            )),
        );
        if (reviewFile && fileWritten) {
          try {
            const current = (
              await getFileContentApi(projectId, reviewFile, {
                snapshotId,
                forceFresh: true,
              })
            ).data;
            if (current.content !== previousFile?.content) {
              setReviewUndo((previous) => ({
                ...previous,
                [cleanDisplayPath(reviewFile)]: {
                  previous: previousFile,
                  appliedContent: current.content,
                  version: current.version,
                },
              }));
            }
          } catch (error) {
            console.warn("Unable to capture applied file for undo:", error);
          }
        }

        const appliedMap = new Map();
        if (Array.isArray(resultData?.appliedSuggestions)) {
          for (const item of resultData.appliedSuggestions) {
            appliedMap.set(item.suggestionId || item.id, item);
          }
        }

        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) => {
              const matchedItem = appliedMap.get(s.suggestionId || s.id);
              if (matchedItem) {
                const itemPassed = matchedItem.status === "PASSED";
                return {
                  ...s,
                  applied: (fileWritten && itemPassed) || s.applied,
                  status: matchedItem.status || (isPassed ? "PASSED" : "FAILED"),
                  qualityGate: resultData?.qualityGate || s.qualityGate,
                  testRunError: matchedItem.error || (itemPassed ? null : (resultData?.testRunError || resultData?.errorDetail || resultData?.message || null)),
                  missingDependency: matchedItem.missingDependency || resultData?.missingDependency || resultData?.moduleResolutionError?.missingDependency || null,
                  missingDependencies: resultData?.missingDependencies,
                };
              }
              if (sugIds.includes(s.suggestionId || s.id)) {
                return {
                  ...s,
                  applied: (fileWritten && isPassed) || s.applied,
                  status: isPassed ? "PASSED" : "FAILED",
                  qualityGate: resultData?.qualityGate || s.qualityGate,
                  testRunError: isPassed ? null : (resultData?.testRunError || resultData?.errorDetail || resultData?.message || null),
                  missingDependency: isPassed ? null : (resultData?.missingDependency || resultData?.moduleResolutionError?.missingDependency || null),
                  missingDependencies: resultData?.missingDependencies,
                };
              }
              return s;
            }),
          };
        });

        const cleanTarget = cleanDisplayPath(filePath);
        const fileResult =
          resultData?.perFileResults?.[filePath] ||
          resultData?.perFileResults?.[cleanTarget];

        const oldCov =
          fileResult?.oldCoverage ??
          resultData?.oldCoverage ??
          resultData?.previousCoverage ??
          null;
        const newCov =
          fileResult?.newCoverage ?? resultData?.newCoverage ?? null;

        if (oldCov || newCov || !isPassed) {
          setApplyResultsByFile((prev) => ({
            ...prev,
            [filePath]: {
              ...resultData,
              oldCoverage: oldCov,
              newCoverage: newCov,
              isPassed,
              isDryRun: false,
            },
          }));
        }

        if (resultData?.perFileResults) {
          updateCoverageFilesData(
            snapshotId,
            type,
            projectId,
            resultData.perFileResults,
          );
        }

        invalidateCoverageQueries(snapshotId);
        const refreshErrors = await refreshPublishedUnitTests([() => refetchCoverage(), () => loadUnitTestVersions()]);
        invalidateProjectTree(projectId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("covai:project-event", {
              detail: { projectId, type: "file" },
            })
          );
        }

        // If backend returned a background analysis job, track it and auto-sync when it completes
        if (resultData?.backgroundJob?.id) {
          const bgJobId = resultData.backgroundJob.id;
          startAnalysis({
            snapshotId,
            projectId,
            type: "unit",
            jobId: bgJobId,
          });
          (async () => {
            try {
              await waitForJob(bgJobId, (prog) => {
                updateAnalysisProgress(
                  prog,
                  "Refreshing full project coverage analysis...",
                );
              });
              completeAnalysis(
                "✓ Full project unit test analysis completed! All metrics updated.",
              );
              invalidateCoverageQueries(snapshotId);
              await refreshPublishedUnitTests([() => refetchCoverage(), () => ensureFileCoverage(filePath, true)]);
            } catch (error) {
              completeAnalysis(`Coverage refresh failed: ${error.message}`);
              setBulkSuggestMessage(`Coverage refresh failed: ${error.message}`);
            }
          })();
        }

        // Refresh file coverage in-place so FileCodeExecutionView immediately updates with fresh hits & lines
        refreshErrors.push(...await refreshPublishedUnitTests([() => ensureFileCoverage(filePath, true)]));

        const inlineDoneMsg = resultData.status === "NO_CHANGES" ? resultData.postApplyAnalysisError || resultData.message
          : refreshErrors.length ? `Tests saved for ${cleanFile}. Some views could not refresh. Reload to see the committed results.` : isPassed
          ? `✓ Successfully applied ${totalSugs} tests for ${cleanFile}! Coverage updated.`
          : `Applied tests for ${cleanFile} (test runner reported some failures).`;
        completeBulkApply({
          ...resultData,
          message: inlineDoneMsg,
        });
      } catch (err) {
        console.error("Failed to apply all suggestions:", err);
        completeBulkApply({ error: err.message });
        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) =>
              sugIds.includes(s.suggestionId || s.id)
                ? {
                    ...s,
                    status: "FAILED",
                    testRunError: err.message || "Failed to apply suggestions",
                  }
                : s,
            ),
          };
        });
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

  // Dry-run candidate unit test suggestions in isolated sandbox BEFORE applying to disk
  const handleDryRunInline = useCallback(
    async (filePath, suggestions, customCode = null) => {
      if (!snapshotId || !suggestions?.length) return null;
      const sugIds = suggestions.map((s) => s.suggestionId || s.id);
      setApplyingSuggestionIds((prev) => {
        const next = new Set(prev);
        sugIds.forEach((id) => next.add(id));
        return next;
      });
      setApplyProgressSteps((prev) => ({
        ...prev,
        [filePath]: "Testing candidate test cases in isolated sandbox...",
      }));

      try {
        const res = await applyUnitTestSuggestion(snapshotId, {
          suggestions: suggestions.map((s, idx) => ({
            ...s,
            ...(customCode && idx === 0
              ? {
                  generatedCode: customCode,
                  suggestedTestCode: customCode,
                  fullUpdatedContent: customCode,
                }
              : {}),
            proposalBase: s.proposalBase || {
              snapshotId,
              workspaceRevision: getExpectedWorkspaceRevision(),
            },
          })),
          projectId,
          skipBackgroundJob: true,
          dryRun: true,
        });

        const resultData = res?.data || res;
        const testStatus = resultData?.testStatus || resultData?.status;
        const isPassed =
          testStatus !== "FAILED" &&
          resultData?.isPassed !== false &&
          (testStatus === "PASSED" ||
            resultData?.isPassed === true ||
            resultData?.success === true);

        const cleanTarget = cleanDisplayPath(filePath);
        const fileResult =
          resultData?.perFileResults?.[filePath] ||
          resultData?.perFileResults?.[cleanTarget];

        const oldCov =
          fileResult?.oldCoverage ??
          resultData?.oldCoverage ??
          resultData?.previousCoverage ??
          null;
        const newCov =
          fileResult?.newCoverage ?? resultData?.newCoverage ?? null;

        setApplyResultsByFile((prev) => ({
          ...prev,
          [filePath]: {
            ...resultData,
            oldCoverage: oldCov,
            newCoverage: newCov,
            isPassed,
            isDryRun: true,
          },
        }));

        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) =>
              sugIds.includes(s.suggestionId || s.id)
                ? {
                    ...s,
                    dryRunStatus: isPassed ? "VERIFIED" : "FAILED",
                    testRunError: isPassed
                      ? null
                      : resultData?.testRunError ||
                        resultData?.errorDetail ||
                        resultData?.message ||
                        null,
                    missingDependency: isPassed
                      ? null
                      : resultData?.missingDependency ||
                        resultData?.moduleResolutionError?.missingDependency ||
                        null,
                  }
                : s,
            ),
          };
        });

        return resultData;
      } catch (err) {
        console.error("Dry-run test suggestions failed:", err);
        setApplyResultsByFile((prev) => ({
          ...prev,
          [filePath]: {
            isPassed: false,
            isDryRun: true,
            errorDetail: err.message || "Dry-run failed",
          },
        }));
        setInlineSuggestions((prev) => {
          const fileSugs = prev[filePath] || [];
          return {
            ...prev,
            [filePath]: fileSugs.map((s) =>
              sugIds.includes(s.suggestionId || s.id)
                ? {
                    ...s,
                    dryRunStatus: "FAILED",
                    testRunError: err.message || "Dry-run failed",
                  }
                : s,
            ),
          };
        });
        return null;
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
    [snapshotId, projectId],
  );

  // Reject a suggestion and remove it from inline suggestions list
  const handleRejectInline = useCallback(
    (filePath, sugId) => {
      setInlineSuggestions((prev) => {
        const fileSugs = prev[filePath] || [];
        const remaining = fileSugs.filter(
          (s) => (s.suggestionId || s.id) !== sugId,
        );
        const next = { ...prev };
        if (remaining.length > 0) {
          next[filePath] = remaining;
        } else {
          delete next[filePath];
          Object.keys(next).forEach((k) => {
            if (k.endsWith(filePath) || filePath.endsWith(k)) {
              delete next[k];
            }
          });
          if (snapshotId) {
            removeFileSuggestions(snapshotId, filePath);
          }
        }
        return next;
      });
    },
    [snapshotId, removeFileSuggestions],
  );

  // Dismiss / clear all suggestions for a specific file and keep test file intact
  const handleDismissFileSuggestions = useCallback(
    (filePath) => {
      setInlineSuggestions((prev) => {
        const next = { ...prev };
        delete next[filePath];
        Object.keys(next).forEach((k) => {
          if (k.endsWith(filePath) || filePath.endsWith(k)) {
            delete next[k];
          }
        });
        return next;
      });
      setApplyResultsByFile((prev) => {
        const next = { ...prev };
        delete next[filePath];
        return next;
      });
      if (snapshotId) {
        removeFileSuggestions(snapshotId, filePath);
      }
    },
    [snapshotId, removeFileSuggestions],
  );

  // Update code for a specific suggestion in a file (from direct line editing)
  const handleUpdateSuggestionCode = useCallback((filePath, sugId, newCode) => {
    setInlineSuggestions((prev) => {
      const fileSugs = prev[filePath] || [];
      return {
        ...prev,
        [filePath]: fileSugs.map((s) =>
          (s.suggestionId === sugId || s.id === sugId)
            ? { ...s, originalGeneratedCode: s.originalGeneratedCode ?? s.suggestedTestCode ?? s.generatedCode,
                generatedCode: newCode, suggestedTestCode: newCode, fullUpdatedContent:newCode,testCode:newCode,changeSet:undefined,
                validation:{status:'UNVERIFIED',message:'The edited candidate must be verified again before publication.'},status: "EDITED" }
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
        if (
          !reviewUndo[cleanDisplayPath(s.testFile || s.targetTestFile || "")] &&
          s.status !== "REJECTED" &&
          s.status !== "PASSED" &&
          s.status !== "APPLIED" &&
          s.status !== "ISOLATED" &&
          s.status !== "NO_CHANGES" &&
          s.status !== "FULLY_COVERED" &&
          !s.isFullyCovered &&
          Boolean(s.suggestedTestCode || s.generatedCode || s.fullUpdatedContent || s.testCode || s.code)
        ) {
          list.push({ ...s, sourceFile: s.sourceFile || fPath });
        }
      });
    });
    return list;
  }, [inlineSuggestions, reviewUndo, type]);

  const filesWithPendingSuggestions = useMemo(() => {
    const set = new Set();
    allPendingSuggestions.forEach((s) => {
      const src = s.sourceFile || s.filePath;
      if (src) set.add(src);
    });
    return Array.from(set);
  }, [allPendingSuggestions]);

  // All suggestions with diff content (both pending and applied/passed) for persistent diff review
  const allReviewSuggestions = useMemo(() => {
    if (type !== "unit") return [];
    const list = [];
    Object.entries(inlineSuggestions).forEach(([fPath, sugs]) => {
      (sugs || []).forEach((s) => {
        if (
          s.status !== "REJECTED" &&
          Boolean(s.suggestedTestCode || s.generatedCode || s.fullUpdatedContent || s.testCode || s.code)
        ) {
          list.push({ ...s, sourceFile: s.sourceFile || fPath });
        }
      });
    });
    return list;
  }, [inlineSuggestions, type]);

  // Diff Review Modal state & data mapping for Unit Test Workflow (Step 3)
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewInitialFileIndex, setReviewInitialFileIndex] = useState(0);

  const reviewFiles = useMemo(() => {
    if (type !== "unit") return [];
    const targetList = allReviewSuggestions.length > 0 ? allReviewSuggestions : allPendingSuggestions;
    return buildUnitTestReviewFiles(targetList);
  }, [allPendingSuggestions, allReviewSuggestions, type]);

  const openReviewForFile = useCallback(
    (fPath) => {
      if (!fPath) {
        setReviewInitialFileIndex(0);
        setReviewModalOpen(true);
        return;
      }
      const idx = reviewFiles.findIndex(
        (rf) =>
          rf.filePath === fPath ||
          rf.testFilePath === fPath ||
          rf.suggestions?.some((s) => (s.sourceFile || s.filePath || s.sourceFilePath) === fPath),
      );
      setReviewInitialFileIndex(idx >= 0 ? idx : 0);
      setReviewModalOpen(true);
    },
    [reviewFiles],
  );

  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [bulkApplyStep, setBulkApplyStep] = useState("");
  const [bulkApplyProgress, setBulkApplyProgress] = useState(null);
  const [bulkApplyPhase, setBulkApplyPhase] = useState("");

  // A single request stages and verifies the entire batch before publishing any version.
  const handleApplyAllGlobal = useCallback(async (suggestionsOverride = null) => {
    const batch = Array.isArray(suggestionsOverride) ? suggestionsOverride : allPendingSuggestions;
    if (!snapshotId || !batch.length || isBulkApplying) return;
    const revision = getExpectedWorkspaceRevision();
    const requestId = crypto.randomUUID();
    const cleanedSuggestions = batch.map((s) => ({
      ...s,
      suggestionId: s.suggestionId || s.id,
      sourceFile: s.sourceFile || s.filePath,
      framework: s.framework || "jest",
      originalCode: s.originalCode ?? s.originalContent ?? s.baseContent ?? "",
      testFile:
        s.testFile ||
        s.targetTestFile ||
        resolveTargetTestFile(s.sourceFile || s.filePath, unitTestSuites, {
          framework: s.framework || activeFramework,
        }),
      generatedCode: s.generatedCode || s.fullUpdatedContent || s.suggestedTestCode || s.testCode || s.code || "",
      suggestedTestCode: s.fullUpdatedContent || s.generatedCode || s.suggestedTestCode || s.testCode || s.code || "",
      proposalBase: s.proposalBase || { snapshotId, workspaceRevision: revision },
    }));
    const batchSourceFiles = [...new Set(cleanedSuggestions.map((s) => s.sourceFile).filter(Boolean))];
    const ids = new Set(cleanedSuggestions.map((s) => s?.suggestionId || s?.id).filter(Boolean));
    const totalFiles = new Set(cleanedSuggestions.map((s) => s.testFile || s.sourceFile)).size;
    setIsBulkApplying(true);
    setError("");
    setBulkIsolatedDefects([]);
    setBulkApplyStep('Verifying the entire batch; the active version is unchanged…');
    setBulkApplyProgress(null);
    setBulkApplyPhase('verify');
    startBulkApply({
      snapshotId,
      projectId,
      totalFiles,
      totalCount: totalFiles,
      totalSugs: batch.length,
      completedCount: 0,
      step: 'Verifying the entire batch before creating a version',
      phase: 'verify',
    });
    setApplyingSuggestionIds((prev) => new Set([...prev, ...ids]));
    setInlineSuggestions((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([filePath, list]) => [
          filePath,
          (list || []).map((s) =>
            ids.has(s.suggestionId || s.id)
              ? { ...s, status: 'APPLYING', testRunError: null }
              : s,
          ),
        ]),
      ),
    );

    try {
      const response = await applyUnitTestSuggestion(snapshotId, {
        suggestions: cleanedSuggestions,
        projectId,
        skipBackgroundJob: false,
        requestId,
        async: true,
      });
      const payload = response && typeof response === "object" && "data" in response ? (response.data ?? {}) : response;
      let result = payload;
      if (payload?.queued && payload?.job?.id) {
        const queuedJobId = payload.job.id;
        startBulkApply({
          snapshotId,
          projectId,
          jobId: queuedJobId,
          totalFiles,
          totalCount: totalFiles,
          totalSugs: batch.length,
          completedCount: 0,
          step: 'Queued unit test apply & verification job...',
          phase: 'verify',
        });
        result = await waitForQueueJobResult(queuedJobId);
      }
      setInlineSuggestions((prev) => applyBatchResultToSuggestionsMap(prev, ids, result));
      const batchSummary = summarizeApplyBatchResult(result, cleanedSuggestions.length);
      setBulkIsolatedDefects(batchSummary.isolatedDefects);

      if (result?.perFileResults) {
        updateCoverageFilesData(snapshotId, type, projectId, result.perFileResults);
      }

      if (result?.perFileResults || !batchSummary.isOverallSuccess || batchSummary.hasIsolatedDefects) {
        setApplyResultsByFile((prev) => {
          const next = { ...prev };
          for (const fPath of batchSourceFiles) {
            const fileResult = result?.perFileResults?.[fPath];
            const oldCov = fileResult?.oldCoverage ?? result?.oldCoverage ?? result?.previousCoverage ?? null;
            const newCov = fileResult?.newCoverage ?? result?.newCoverage ?? null;
            const fileSuggestions = cleanedSuggestions.filter((s) => s.sourceFile === fPath);
            const fileSuggestionIds = new Set(fileSuggestions.map((s) => s.suggestionId || s.id).filter(Boolean));
            const fileTestKeys = new Set(
              fileSuggestions
                .map((s) => normalizeReviewTestFile(s.testFile || s.targetTestFile || "").groupKey)
                .filter(Boolean),
            );
            const itemList = Array.isArray(result?.appliedSuggestions)
              ? result.appliedSuggestions.filter((item) => {
                  const itemId = item?.suggestionId || item?.id;
                  const itemTfKey = normalizeReviewTestFile(item?.testFile || item?.targetTestFile || "").groupKey;
                  if (itemId && fileSuggestionIds.has(itemId)) {
                    return !itemTfKey || fileTestKeys.size === 0 || fileTestKeys.has(itemTfKey);
                  }
                  if (!itemId) {
                    return Boolean(itemTfKey && fileTestKeys.has(itemTfKey));
                  }
                  return false;
                })
              : [];
            const fileHasFailure = itemList.some((item) => item.status === 'FAILED');
            const filePassed = itemList.length > 0
              ? itemList.some((item) => item.status === 'PASSED' || item.status === 'APPLIED') && !fileHasFailure
              : batchSummary.isOverallSuccess;
            if (oldCov || newCov || !filePassed || batchSummary.hasIsolatedDefects) {
              next[fPath] = {
                ...result,
                ...(fileResult || {}),
                oldCoverage: oldCov,
                newCoverage: newCov,
                isPassed: filePassed,
              };
            }
          }
          return next;
        });
      }

      if (!batchSummary.isOverallSuccess && batchSummary.passedCount === 0) {
        setError(batchSummary.errorMessage);
        setBulkSuggestMessage(batchSummary.errorMessage);
        completeBulkApply({ ...result, success: false, error: batchSummary.errorMessage });
        if (result?.fileUpdated) {
          invalidateCoverageQueries(snapshotId);
          invalidateProjectTree(projectId);
          await refreshPublishedUnitTests([
            () => refetchCoverage(),
            () => loadUnitTestVersions(),
            ...batchSourceFiles.map((filePath) => () => ensureFileCoverage(filePath, true)),
          ]);
        }
        return;
      }

      if (batchSummary.errorMessage) {
        setError(batchSummary.errorMessage);
      } else {
        setError("");
      }

      setBulkApplyProgress(100);
      setBulkApplyPhase('done');
      setBulkSuggestMessage(batchSummary.message);
      completeBulkApply({
        ...result,
        message: batchSummary.message,
        ...(batchSummary.errorMessage ? { error: batchSummary.errorMessage } : {}),
      });

      if (result?.backgroundJob?.id) {
        const jobId = result.backgroundJob.id;
        startAnalysis({ snapshotId, projectId, type: 'unit', jobId });
        void (async () => {
          try {
            await waitForJob(jobId, (progress) =>
              updateAnalysisProgress({ progress, message: 'Running full Unit Test analysis after Apply...' }),
            );
            completeAnalysis('Full Unit Test analysis after Apply completed.');
            invalidateCoverageQueries(snapshotId);
            await refreshPublishedUnitTests([
              () => refetchCoverage(),
              () => loadUnitTestVersions(),
              ...batchSourceFiles.map((filePath) => () => ensureFileCoverage(filePath, true)),
            ]);
          } catch (error) {
            completeAnalysis(`Post-Apply analysis failed: ${error.message}`);
            setBulkSuggestMessage(`Coverage refresh failed: ${error.message}`);
          }
        })();
      } else if (result?.postApplyAnalysisError) {
        setBulkSuggestMessage(result.postApplyAnalysisError);
      }

      if (!batchSummary.isNoChanges || result?.fileUpdated) {
        invalidateCoverageQueries(snapshotId);
        invalidateProjectTree(projectId);
        const refreshErrors = await refreshPublishedUnitTests([
          () => refetchCoverage(),
          () => loadUnitTestVersions(),
          ...batchSourceFiles.map((filePath) => () => ensureFileCoverage(filePath, true)),
        ]);
        if (refreshErrors.length) {
          setBulkSuggestMessage(`${batchSummary.message} Some views could not refresh. Reload to see the latest results.`);
        }
      }
    } catch (err) {
      const errMsg = err?.message || 'Batch verification failed. The active version is unchanged.';
      setInlineSuggestions((prev) =>
        applyBatchResultToSuggestionsMap(prev, ids, {
          success: false,
          status: 'FAILED',
          errorDetail: errMsg,
        }),
      );
      setError(errMsg);
      setBulkSuggestMessage(errMsg);
      completeBulkApply({ success: false, error: errMsg });
    } finally {
      setIsBulkApplying(false);
      setBulkApplyStep('');
      setBulkApplyProgress(null);
      setBulkApplyPhase('');
      setApplyingSuggestionIds((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    }
  }, [snapshotId, allPendingSuggestions, isBulkApplying, projectId, refetchCoverage,
    ensureFileCoverage, startBulkApply, completeBulkApply, startAnalysis, updateAnalysisProgress, completeAnalysis, type]);

  const [isDryRunningGlobal, setIsDryRunningGlobal] = useState(false);

  const handleDryRunAllGlobal = useCallback(async () => {
    if (
      !snapshotId ||
      allPendingSuggestions.length === 0 ||
      isDryRunningGlobal ||
      isBulkApplying
    )
      return;
    setIsDryRunningGlobal(true);
    const totalFiles = filesWithPendingSuggestions.length;
    setBulkSuggestMessage(
      `Testing ${allPendingSuggestions.length} candidate suggestions across ${totalFiles} file(s) in isolated sandbox...`,
    );
    try {
      let passedFiles = 0;
      for (const fPath of filesWithPendingSuggestions) {
        const cleanTarget = cleanDisplayPath(fPath);
        const fileSugs = allPendingSuggestions.filter((s) => {
          const sPath = s.sourceFile || s.filePath;
          return sPath === fPath || cleanDisplayPath(sPath) === cleanTarget;
        });
        if (!fileSugs.length) continue;
        const res = await handleDryRunInline(fPath, fileSugs);
        const status = res?.testStatus || res?.status;
        if (
          status === "PASSED" ||
          res?.isPassed === true ||
          res?.success === true
        ) {
          passedFiles++;
        }
      }
      setBulkSuggestMessage(
        passedFiles === totalFiles
          ? `Dry-Run Passed: ${passedFiles}/${totalFiles} candidate file(s) verified in sandbox and ready to apply.`
          : `Dry-Run Completed: ${passedFiles}/${totalFiles} file(s) passed. Open Review & Test to inspect individual test cases.`,
      );
    } finally {
      setIsDryRunningGlobal(false);
    }
  }, [
    snapshotId,
    allPendingSuggestions,
    filesWithPendingSuggestions,
    isDryRunningGlobal,
    isBulkApplying,
    handleDryRunInline,
  ]);

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

  const loadSystemSummary = useCallback(async () => {
    if (!snapshotId || type !== "system") return;
    try {
      const sysRes = await getSystemCoverageSummary(snapshotId);
      const sysData = sysRes?.data || {
        hasRun: false,
        e2eTests: 0,
        passed: 0,
        failed: 0,
        flaky: 0,
        coverageAvailable: false,
        featureCoverage: null,
        files: [],
        testRuns: [],
        scenarios: [],
      };
      setSystemSummary(sysData);
      return sysData;
    } catch (err) {
      console.warn("Could not load system summary:", err);
      return null;
    }
  }, [snapshotId, type]);

  useEffect(() => {
    if (type === "system") {
      loadSystemSummary();
    }
  }, [loadSystemSummary, type]);

  const load = useCallback(async () => {
    if (type === "system") {
      const sysData = await loadSystemSummary();
      await refetchCoverage();
      return sysData;
    } else {
      invalidateCoverageQueries(snapshotId);
      const res = await refetchCoverage();
      return res?.data;
    }
  }, [snapshotId, type, loadSystemSummary, refetchCoverage]);
  const [installingDependencyName, setInstallingDependencyName] = useState(null);
  const [unitTestVersions, setUnitTestVersions] = useState({});

  const uniqueVersionsCount = useMemo(() => {
    const vers = new Set();
    Object.values(unitTestVersions || {}).forEach((f) => {
      (f.versions || []).forEach((v) => vers.add(v.version));
    });
    return vers.size > 0 ? vers.size : 1;
  }, [unitTestVersions]);
  const [isSwitchingVersion, setIsSwitchingVersion] = useState(false);
  const [switchingVersionFile, setSwitchingVersionFile] = useState(null);

  const loadUnitTestVersions = useCallback(async () => {
    if (!snapshotId || type !== "unit") return;
    try {
      const res = await getUnitTestVersions(snapshotId);
      if (res?.success && res.data) {
        setUnitTestVersions(res.data);
      }
    } catch (err) {
      console.warn("Failed to load unit test versions:", err);
    }
  }, [snapshotId, type]);

  useEffect(() => {
    loadUnitTestVersions();
  }, [loadUnitTestVersions]);

  const handleSwitchVersion = useCallback(async ({ filePath = null, targetVersion = 1, allFiles = false }) => {
    if (isSwitchingVersion || !snapshotId) return;
    setIsSwitchingVersion(true);
    setSwitchingVersionFile(allFiles ? "all" : filePath);
    try {
      const res = await switchUnitTestVersion(snapshotId, {
        projectId,
        filePath,
        targetVersion,
        allFiles,
        runTests: true
      });
      const result = res?.data || res;
      if (result?.success || res?.success) {
        await loadUnitTestVersions();
        invalidateCoverageQueries(snapshotId);
        await refetchCoverage();
        invalidateProjectTree(projectId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("covai:project-event", {
              detail: { projectId, type: "file" },
            })
          );
        }
      } else {
        setError(result?.message || "Failed to switch unit test version.");
      }
      return res;
    } catch (err) {
      console.error("[handleSwitchVersion] Error:", err);
      setError(err.message || "Error switching unit test version.");
    } finally {
      setIsSwitchingVersion(false);
      setSwitchingVersionFile(null);
    }
  }, [snapshotId, projectId, isSwitchingVersion, loadUnitTestVersions, refetchCoverage]);

  const activeMissingDependencies = useMemo(() => {
    const fromReport = (report, error) => report?.missingDependencies ??
      [report?.missingDependency || extractMissingPackageFromError(error)];
    const dependencies = [
      ...fromReport(summary, summary?.latestRunError || coverageData?.latestRunError),
      ...Object.entries(inlineSuggestions || {}).flatMap(([sourceFile, suggestions]) =>
        suggestions.filter(suggestion => suggestion.status === "FAILED").flatMap(suggestion =>
          fromReport(suggestion, suggestion.testRunError).filter(Boolean).map(dependency => ({
            ...dependency, importedFrom: dependency.importedFrom || sourceFile,
          })))),
    ];
    const unique = new Map();
    for (const dependency of dependencies.filter(item => item?.packageName)) {
      const key = JSON.stringify([dependency.packageName, dependency.targetPackage || dependency.importedFrom]);
      if (!unique.has(key)) unique.set(key, dependency);
    }
    return [...unique.values()];
  }, [summary, coverageData, inlineSuggestions]);

  const handleInstallDependencies = async (dependencies) => {
    if (!snapshotId || !dependencies.length || installingDependencyName) throw new Error("The package installer is busy or unavailable.");
    setInstallingDependencyName(dependencies[0].packageName);
    try {
      const result = await installMissingDependencies(snapshotId, dependencies);
      if (result.installed.length) {
        invalidateCoverageQueries(snapshotId);
        await refetchCoverage();
      }
      return result;
    } finally {
      setInstallingDependencyName(null);
    }
  };

  const handleInstallDependency = async (
    packageName,
    isDev = false,
    importedFrom = null,
    onAfterInstall = null,
  ) => {
    if (!snapshotId || !packageName || installingDependencyName) return;
    setInstallingDependencyName(packageName);
    setDependencyInstallError("");
    setError("");
    try {
      const shouldRerunFull = !onAfterInstall;
      const res = await installMissingDependency(
        snapshotId,
        packageName,
        isDev,
        shouldRerunFull,
        importedFrom
      );
      if (res?.success) {
        setDependencyInstallLogs((previous) => [
          ...previous,
          `[SUCCESS] ${res.message || `Installed ${packageName}`}`,
        ]);
        invalidateCoverageQueries(snapshotId);
        await refetchCoverage();
        if (typeof onAfterInstall === "function") {
          await onAfterInstall();
        }
      } else {
        throw new Error(res?.message || `Failed to install ${packageName}`);
      }
      return res;
    } catch (err) {
      console.error("[handleInstallDependency] Error:", err);
      const message = err.message || `Error installing ${packageName}`;
      setError(message);
      setDependencyInstallError(message);
      setDependencyInstallLogs(previous => [...previous, `[ERROR] ${message}`]);
      throw err;
    } finally {
      setInstallingDependencyName(null);
    }
  };

  const run = async (options = {}) => {
    if (!snapshotId) return;

    activeJobIdRef.current = null;
    setRunning(true);
    setRunProgress(8);
    const initialStep =
      type === "system"
        ? "Initializing E2E system testing environment..."
        : type === "integration"
          ? "Initializing API integration test environment..."
          : "Initializing unit test analysis environment...";
    setRunStep(initialStep);
    setError("");
    setRunningStatus(
      type === "system" ? "Starting AUT server..." : "Running analysis...",
    );
    startAnalysis({ snapshotId, projectId, type });
    try {
      let response;
      try {
        response = await runCoverageByType(
          snapshotId,
          type,
          undefined,
          type === "system" ? executionMode : undefined,
          options,
        );
      } catch (err) {
        if (
          err.message &&
          (err.message.includes("already queued") ||
            err.message.includes("running") ||
            err.message.includes("409"))
        ) {
          const projJobs = await getProjectJobsApi(projectId).catch(() => ({
            jobs: [],
          }));
          const active = (projJobs.jobs || []).find((j) =>
            ["QUEUED", "RUNNING"].includes(j.status),
          );
          if (active) {
            response = { data: { jobs: [active] } };
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      const fw =
        response.data?.framework ||
        (type === "unit"
          ? "jest & vitest"
          : type === "system"
            ? "playwright · cypress"
            : "supertest");
      setActiveFramework(fw);
      const jobs =
        response.data?.jobs || (response.data?.job ? [response.data.job] : []);
      if (jobs.length === 0)
        throw new Error("Backend did not return test run jobs.");
      for (const j of jobs) {
        if (j?.id) {
          activeJobIdRef.current = j.id;
          startAnalysis({ snapshotId, projectId, type, jobId: j.id, progress: j.progress });
          if (type === "system") {
            await waitForJobWithProgress(j.id, "Starting AUT server...");
          } else {
            await waitForJob(j.id, (prog) => {
              setRunProgress(prog);
              let s = "Preparing execution environment...";
              if (type === "integration") {
                if (prog <= 25) {
                  s = "Preparing Supertest integration test suite...";
                } else if (prog <= 70) {
                  s = "Executing HTTP route endpoints & assertions...";
                } else if (prog <= 95) {
                  s = "Calculating API integration coverage metrics...";
                } else {
                  s = "Integration test execution completed!";
                }
              } else {
                if (prog <= 20) {
                  s = "Preparing dependencies & isolated mock environment...";
                } else if (prog <= 45) {
                  s = "Running Jest unit test suites & generating coverage...";
                } else if (prog <= 65) {
                  s =
                    "Running Vitest unit test suites & generating coverage...";
                } else if (prog <= 85) {
                  s =
                    "Merging multi-framework coverage & analyzing AST functions...";
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
      }
      setRunProgress(100);
      setRunStep(
        type === "system"
          ? "System test completed successfully!"
          : "Analysis completed successfully!",
      );
      completeAnalysis(true);
      setApplyResultsByFile({});
      invalidateCoverageQueries(snapshotId);
      await refetchCoverage();
      if (type === "system") {
        await loadSystemSummary();
      }
    } catch (runError) {
      setError(runError.message || "Analysis process failed.");
      completeAnalysis(false, runError.message);
    } finally {
      activeJobIdRef.current = null;
      setTimeout(() => {
        setRunning(false);
        setRunningStatus("");
        setRunProgress(0);
        setRunStep("");
      }, 1200);
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
      if (rawMetric.pct != null && !isNaN(Number(rawMetric.pct))) {
        const parsedPct = Number(rawMetric.pct);
        if (parsedPct > 0 || (total > 0 && covered === 0)) {
          return parsedPct;
        }
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

  // If 0% statements AND lines are covered, branch coverage cannot be 100%
  const branchesCovered = Number(rawTotals?.branches?.covered || 0);
  const stmtsCovered = Number(rawTotals?.statements?.covered || 0);
  const linesCovered = Number(rawTotals?.lines?.covered || 0);
  if (
    branchesCovered === 0 &&
    (statPct === 0 ||
      linePct === 0 ||
      (stmtsCovered === 0 && linesCovered === 0))
  ) {
    branchPct = 0;
  }

  const selectedFiles = useMemo(() => {
    let nonTestFiles = files.filter((f) => !isTestFile(f.filePath));
    if (type === "unit") {
      nonTestFiles = nonTestFiles.filter((f) =>
        isBusinessLogicClientFile(f.filePath),
      );
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
      list = list.filter(
        (s) => !isFrontendFile(s.filePath) && !isFrontendFile(s.fileName),
      );
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
  const [bulkIsolatedDefects, setBulkIsolatedDefects] = useState([]);

  const handleBulkSuggestTest = async (frameworkOverride = null) => {
    let sourceFiles = selectedFiles;
    if (snapshotId && (type === 'unit' || !sourceFiles?.length)) {
      try {
        sourceFiles = (await loadSuggestionSourceFiles(page => getCoverageFiles(snapshotId,
          { page, sortBy: 'linesPct', order: 'asc', limit: 200, type }), sourceFiles))
          .filter(f => type === 'unit' ? isBusinessLogicClientFile(f.filePath) : !isTestFile(f.filePath) && !isFrontendFile(f.filePath));
      } catch (err) {
        console.warn("Could not load source files:", err);
        setBulkSuggestMessage(`Could not load the complete source list: ${err.message}. Retry Suggest Tests.`);
        return;
      }
    }

    if (type === "unit") {
      if (!sourceFiles || sourceFiles.length === 0) {
        setBulkSuggestMessage(
          "No source files found to generate suggestions. Please run analysis first.",
        );
        setTimeout(() => setBulkSuggestMessage(""), 5000);
        return;
      }

      const needImprovementFiles = (sourceFiles || []).filter(needsUnitTestSuggestion);

      if (needImprovementFiles.length === 0) {
        setBulkSuggestMessage(
          "All analyzed source files have reached 100% test coverage!",
        );
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

      // Expand only the first file to give an immediate preview without lagging the DOM with 200 editors
      if (needImprovementFiles.length > 0) {
        setExpandedFiles(new Set([needImprovementFiles[0].filePath]));
        ensureFileCoverage(needImprovementFiles[0].filePath);
      }

      try {
        const paths = needImprovementFiles.map(file => file.filePath);
        setLoadingSuggestions(prev => ({...prev,...Object.fromEntries(paths.map(file => [file,true]))}));
        setBulkSuggestMessage(`Generating ${paths.length} source drafts and verifying one combined batch...`);
        const response = await suggestAllUnitTestcases(snapshotId,{projectId,filePaths:paths,
          framework:frameworkOverride || activeFramework,validationMode:'fast',async:true});
        const payload = response?.data || response;
        let data = payload;
        if (payload?.queued && payload?.job?.id) {
          const suggestJobId = payload.job.id;
          startSuggestion({
            snapshotId,
            projectId,
            jobId: suggestJobId,
            totalFiles: paths.length,
            initialMessage: startMsg,
          });
          data = await waitForQueueJobResult(suggestJobId);
        }
        const failures = new Map((data.failedFiles || []).map(file => [file.filePath,file.message]));
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setReviewUndo((prev) => {
            const next = { ...prev };
            for (const s of data.suggestions) {
              const tf = cleanDisplayPath(s.testFile || s.targetTestFile || "");
              if (tf) delete next[tf];
            }
            return next;
          });
        }
        let completed = 0;
        for (const filePath of paths) {
          const suggestions = (data.suggestions || [])
            .filter(suggestion => suggestion.sourceFile === filePath || suggestion.sourceFiles?.includes(filePath))
            .map((suggestion, idx) => ({
              ...suggestion,
              suggestionId: suggestion.suggestionId || suggestion.id || `${filePath}-sug-${idx + 1}`,
            }));
          setSuggestionErrors(prev => ({...prev,[filePath]:failures.get(filePath) || null}));
          if (suggestions.length) setInlineSuggestions(prev => ({...prev,[filePath]:suggestions}));
          completed++;
          updateSuggestionProgress({snapshotId,completedFiles:completed,totalFiles:paths.length,
            currentFile:filePath,filePath,fileSuggestions:suggestions,message:`Processed ${completed}/${paths.length} source files.`});
        }
        const verification = data.validation?.status === 'VERIFIED_DRAFT' ? 'The combined batch passed verification.' : data.validation?.message || 'Review draft diagnostics before applying.';
        const doneMsg = failures.size
          ? `Generated drafts for ${paths.length - failures.size}/${paths.length} source files. Failed: ${[...failures.keys()].join(', ')}. ${verification}`
          : `Generated drafts for ${paths.length} source files. ${verification}`;
        setBulkSuggestMessage(doneMsg);
        completeSuggestion(doneMsg);
      } catch (err) {
        console.error("Bulk inline suggest failed:", err);
        const errMsg = `Error generating testcases: ${err.message}`;
        setBulkSuggestMessage(errMsg);
        completeSuggestion(errMsg);
      } finally {
        setLoadingSuggestions(prev => ({...prev,...Object.fromEntries(needImprovementFiles.map(file => [file.filePath,false]))}));
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

  const handleConfirmAiSuggest = useCallback(
    async ({ framework, filePath }) => {
      if (framework) {
        setActiveFramework(framework);
      }
      if (suggestModalConfig.isBulk || !filePath) {
        await handleBulkSuggestTest(framework);
      } else {
        await handleSuggestTestcaseInline(filePath, true, framework);
      }
    },
    [
      suggestModalConfig.isBulk,
      handleBulkSuggestTest,
      handleSuggestTestcaseInline,
    ],
  );

  const handleConfirmManualApply = useCallback(
    async ({ framework, filePath, generatedCode, targetTestFile: explicitTestFile }) => {
      if (!snapshotId || !filePath || !generatedCode) return;
      setIsBulkApplying(true);
      setBulkApplyStep("Applying manual unit test case...");
      try {
        const cleanPath = cleanDisplayPath(filePath);
        const targetTestFile = explicitTestFile
          ? cleanDisplayPath(explicitTestFile)
          : resolveTargetTestFile(filePath, unitTestSuites, { framework: framework || activeFramework });
        const res = await applyWithEnvironment({
          projectId,
          suggestion: {
            sourceFile: filePath,
            testFile: targetTestFile,
            generatedCode,
            framework: framework || activeFramework || "vitest",
            proposalBase: {
              snapshotId,
              workspaceRevision: getExpectedWorkspaceRevision(),
            },
          },
        });
        const result = res?.data || res;
        if (result?.fileUpdated) {
          invalidateCoverageQueries(snapshotId);
          await load();
        }
        const status = result?.testStatus || result?.status;
        const passed =
          status !== "FAILED" &&
          result?.isPassed !== false &&
          (status === "PASSED" ||
            status === "SUCCESS" ||
            result?.isPassed === true);
        const coverage = result?.newCoverage ?? result?.coverage;
        const coverageMessage =
          coverage == null
            ? ""
            : ` Coverage: ${
                typeof coverage === "object"
                  ? Object.entries(coverage)
                      .map(
                        ([metric, value]) =>
                          `${metric}: ${value?.pct ?? value}%`,
                      )
                      .join(", ")
                  : `${coverage}%`
              }.`;
        return {
          error: !passed,
          message: passed
            ? `Test run: ${status || "PASSED"}.${coverageMessage}`
            : result?.errorDetail ||
              result?.testRunError ||
              result?.message ||
              res?.message ||
              "The test run failed.",
        };
      } catch (err) {
        console.error("Failed to apply manual unit test:", err);
        return {
          error: true,
          message:
            err.response?.data?.message ||
            err.message ||
            "Unable to save and run the test.",
        };
      } finally {
        setIsBulkApplying(false);
        setBulkApplyStep("");
      }
    },
    [snapshotId, projectId, activeFramework, unitTestSuites, load],
  );

  const functionsForTargetFile = useMemo(() => {
    if (!suggestModalConfig.filePath || !functionsList) return [];
    const cleanTarget = cleanDisplayPath(suggestModalConfig.filePath);
    return functionsList.filter((fn) => {
      const fPath = fn.filePath || "";
      return (
        fPath === suggestModalConfig.filePath ||
        cleanDisplayPath(fPath) === cleanTarget
      );
    });
  }, [suggestModalConfig.filePath, functionsList]);

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
  const chatRun = [...relevantRuns].sort((a, b) => new Date(b.createdAt || b.finishedAt || 0) - new Date(a.createdAt || a.finishedAt || 0))[0];

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

  const hasSystemTests = useMemo(() => {
    if (type !== "system") return false;
    return Boolean(
      (systemSummary?.hasRun && systemSummary?.e2eTests > 0) ||
      (systemSummary?.scenarios && systemSummary.scenarios.length > 0) ||
      (frameworks?.supported?.system && frameworks.supported.system.length > 0),
    );
  }, [type, systemSummary, frameworks]);

  const isLatestRunFailed = Boolean(
    (summary?.latestRunStatus === "failed" ||
      coverageData?.latestRunStatus === "failed") &&
    (type === "unit"
      ? true
      : summary?.latestRunError ||
        relevantRuns.some((r) => r?.status === "FAILED")),
  );
  const hasPartialFailures =
    type === "unit"
      ? summary?.latestRunStatus === "passed_with_failures" ||
        coverageData?.latestRunStatus === "passed_with_failures" ||
        summary?.hasTestFailures
      : totals.failed > 0;
  const lastSuccessfulCov =
    type === "unit"
      ? summary?.lastSuccessfulCoverage || coverageData?.lastSuccessfulCoverage
      : summary?.lastSuccessfulCoverage?.statements > 0
        ? summary.lastSuccessfulCoverage
        : null;
  const latestRunErr = summary?.latestRunError || coverageData?.latestRunError;
  const failedSuiteName = cleanDisplayPath(
    summary?.failedSuite || coverageData?.failedSuite,
  );
  const failedSuiteNames = (
    summary?.failedSuites?.length
      ? summary.failedSuites
      : coverageData?.failedSuites?.length
        ? coverageData.failedSuites
        : [failedSuiteName]
  )
    .filter(Boolean)
    .map((name) => cleanDisplayPath(name));

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
      ? isLatestRunFailed && lastSuccessfulCov
        ? lastSuccessfulValues
        : [statPct, branchPct, funcPct, linePct]
      : type === "integration"
        ? [
            selectedFiles.length,
            selectedFiles.filter((f) => f.linesPct > 0).length,
            pct(avg),
            selectedFiles.filter((f) => f.linesPct < 60).length,
          ]
        : type === "system"
          ? [
              systemSummary?.hasRun ? systemSummary.e2eTests : 0,
              systemSummary?.hasRun ? systemSummary.passed : 0,
              systemSummary?.hasRun ? systemSummary.failed : 0,
              systemSummary?.hasRun ? systemSummary.flaky || 0 : 0,
              systemSummary?.hasRun &&
              systemSummary.coverageAvailable &&
              systemSummary.featureCoverage != null
                ? pct(systemSummary.featureCoverage)
                : systemSummary?.hasRun
                  ? "N/A (Black-box E2E)"
                  : "N/A",
            ]
          : [
              totals.total,
              totals.passed,
              totals.failed,
              pct(linePct || cov.lines),
            ];

  const unitCards = ["statements", "branches", "functions", "lines"].map((key, index) => {
    const total = rawTotals?.[key]?.total == null ? null : Number(rawTotals[key].total);
    const covered = total == null ? null : Number(rawTotals[key]?.covered || 0);
    const value = key === "branches" && !covered && (!statPct || !linePct) ? 0 : values[index];
    return {
      metric: key,
      value,
      percent: isLatestRunFailed ? null : Number(pct(value).slice(0, -1)),
      covered,
      total,
      status: isLatestRunFailed ? "Unavailable" : value >= 80 ? "PASSING" : value >= 60 ? "FAIR" : "LOW",
    };
  });
  const unitRunStatus = summary?.latestRunStatus || coverageData?.latestRunStatus || chatRun?.status;
  const hasUnitRun = unitRunStatus ? unitRunStatus.toLowerCase() !== "not_run" : Boolean(summary?.hasRun || chatRun);
  useChatTestContext(onChatContextChange, {
    projectId, snapshotId, testType: type, testRunId: chatRun?.id || chatRun?.testRunId,
    displayedMetrics: type === "unit" ? {
      kind: "unit", tab: activeMetricView, framework: activeFramework || chatRun?.type,
      state: loading ? "loading" : isLatestRunFailed || !summary ? "unavailable" : hasUnitRun ? "ready" : "not-run",
      runStatus: unitRunStatus,
      cards: loading ? undefined : unitCards.map(({ value, ...card }) => card),
    } : undefined,
  });

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
          flexWrap: "wrap",
          marginBottom: 22,
        }}
      >
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          {type === "unit" ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="m-0 text-base font-semibold tracking-tight text-[var(--color-text)]">
                  {config.title}
                </h1>
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-text-muted)]">
                  <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                    Jest
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                    Vitest
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)] font-mono">
                {frameworks && (
                  <span>
                    Detected:{" "}
                    <strong className="font-medium text-[var(--color-text-secondary)]">
                      {frameworks.supported?.[type]?.join(", ") || "none"}
                    </strong>
                  </span>
                )}
                {activeFramework && (
                  <span>
                    Last execution:{" "}
                    <strong className="font-medium text-[var(--color-text-secondary)]">
                      {activeFramework}
                    </strong>
                  </span>
                )}
              </div>
            </div>
          ) : (
            <>
              <h1
                style={{
                  margin: 0,
                  fontSize: 27,
                  color: isLight ? "#0f172a" : "#f8fafc",
                }}
              >
                {config.title}
              </h1>
              <p
                style={{
                  color: isLight ? "#475569" : "#8b949e",
                  fontSize: 13,
                  margin: "7px 0 0",
                }}
              >
                {config.subtitle}
              </p>
              <div
                style={{
                  color: isLight ? "#64748b" : "#6e7681",
                  fontSize: 12,
                  marginTop: 7,
                }}
              >
                {type === "system" ? "Runner: " : "Supported: "}
                <span style={{ color: config.accent }}>{config.supported}</span>
                {frameworks && type !== "system" && (
                  <span>
                    {" "}
                    · Detected:{" "}
                    <b style={{ color: isLight ? "#1e293b" : "#c9d1d9" }}>
                      {frameworks.supported?.[type]?.join(", ") || "None"}
                    </b>
                  </span>
                )}
                {activeFramework && type !== "system" && (
                  <span>
                    {" "}
                    · Last run:{" "}
                    <b style={{ color: config.accent }}>{activeFramework}</b>
                  </span>
                )}
              </div>
              {type === "system" && systemSummary?.hasRun && (
                <div
                  style={{
                    color: isLight ? "#475569" : "#8b949e",
                    fontSize: 12,
                    marginTop: 7,
                  }}
                >
                  Last result:{" "}
                  {systemSummary.executionMode === "full"
                    ? "Full system"
                    : "Legacy frontend-only run"}
                </div>
              )}
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 9,
            alignItems: "center",
            flexWrap: "wrap",
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: "100%",
          }}
        >
          {type === "system" && (
            <span
              style={{
                color: "#8b949e",
                fontSize: 12,
                padding: "7px 10px",
                border: "1px solid #30363d",
                borderRadius: 6,
              }}
            >
              Full system · Real API & database
            </span>
          )}
          {type === "system" ? (
            <>
              <button
                onClick={handleGenerateAiSystemTest}
                disabled={loading || running || isGenerating}
                style={{
                  ...buttonStyle("#67e8f9"),
                  background: isLight ? "#f0f9ff" : "rgba(56, 189, 248, 0.15)",
                  border: isLight
                    ? "1px solid #7dd3fc"
                    : "1px solid rgba(103,232,249,0.45)",
                  color: isLight ? "#0284c7" : "#67e8f9",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                title={
                  !hasSystemTests
                    ? "Automatically generate Playwright E2E test scenarios using AI"
                    : "Use AI Agent to generate additional E2E test scenarios"
                }
              >
                {isGenerating && (
                  <span
                    style={{
                      display: "inline-block",
                      animation: "spin 1s linear infinite",
                    }}
                  >
                    ⟳
                  </span>
                )}
                <span>{isGenerating ? "Generating..." : "Generate tests"}</span>
              </button>
              <button
                onClick={load}
                disabled={
                  isCoverageQueryFetching ||
                  (running && Boolean(activeJobIdRef.current)) ||
                  isGenerating
                }
                style={{
                  ...buttonStyle(isLight ? "#64748b" : "#8b949e"),
                  background: isLight
                    ? "#ffffff"
                    : "var(--color-surface, #11161d)",
                  border: isLight
                    ? "1px solid #cbd5e1"
                    : "1px solid var(--color-border, #29313d)",
                  color: isLight
                    ? "#475569"
                    : "var(--color-text-secondary, #cbd5e1)",
                  borderRadius: 6,
                  opacity:
                    isCoverageQueryFetching ||
                    (running && Boolean(activeJobIdRef.current)) ||
                    isGenerating
                      ? 0.6
                      : 1,
                  cursor:
                    isCoverageQueryFetching ||
                    (running && Boolean(activeJobIdRef.current)) ||
                    isGenerating
                      ? "wait"
                      : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCw
                  size={13}
                  className={isCoverageQueryFetching ? "animate-spin" : ""}
                />
                <span>
                  {isCoverageQueryFetching ? "Refreshing..." : "Refresh"}
                </span>
              </button>
              <button
                onClick={run}
                disabled={
                  !snapshotId ||
                  (running && Boolean(activeJobIdRef.current)) ||
                  isGenerating
                }
                style={{
                  background:
                    running && Boolean(activeJobIdRef.current)
                      ? isLight
                        ? "#fce7f3"
                        : "rgba(236, 72, 153, 0.2)"
                      : isLight
                        ? "#db2777"
                        : "#ec4899",
                  border:
                    running && Boolean(activeJobIdRef.current)
                      ? isLight
                        ? "1px solid #fbcfe8"
                        : "1px solid rgba(236, 72, 153, 0.4)"
                      : isLight
                        ? "1px solid #be185d"
                        : "1px solid #db2777",
                  color:
                    running && Boolean(activeJobIdRef.current)
                      ? isLight
                        ? "#9d174d"
                        : "#fbcfe8"
                      : "#ffffff",
                  boxShadow: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontWeight: 650,
                  fontSize: 12.5,
                  cursor:
                    running && Boolean(activeJobIdRef.current)
                      ? "wait"
                      : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.15s ease",
                }}
                title="Run System Test Analysis (Playwright / Cypress)"
              >
                {running && Boolean(activeJobIdRef.current)
                  ? `Running (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)...`
                  : "Run System Test"}
              </button>
            </>
          ) : type === "unit" ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsUnitTestExportOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] text-[var(--color-text,#F8FAFC)] hover:bg-[var(--color-surface-secondary,#171D25)] transition-colors cursor-pointer"
                title="Export Unit Test Report (Markdown, JSON, Standalone HTML)"
              >
                <Download size={13} className="text-[#8B7CFD]" />
                <span>Export Report</span>
              </button>
              <button
                type="button"
                onClick={load}
                disabled={
                  isCoverageQueryFetching ||
                  (running && Boolean(activeJobIdRef.current))
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer disabled:opacity-55 disabled:cursor-wait"
                title="Refresh Coverage Analysis"
              >
                <RefreshCw
                  size={13}
                  className={isCoverageQueryFetching ? "animate-spin" : ""}
                />
                <span>
                  {isCoverageQueryFetching ? "Refreshing..." : "Refresh"}
                </span>
              </button>
            </div>
          ) : (
            <>
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
                  disabled={
                    loading ||
                    (running && Boolean(activeJobIdRef.current)) ||
                    generating
                  }
                  style={buttonStyle("#67e8f9")}
                >
                  {generating ? "Generating..." : "Generate AI Tests"}
                </button>
              )}
              <button
                onClick={load}
                disabled={
                  isCoverageQueryFetching ||
                  (running && Boolean(activeJobIdRef.current))
                }
                style={{
                  ...buttonStyle(isLight ? "#64748b" : "#8b949e"),
                  opacity:
                    isCoverageQueryFetching ||
                    (running && Boolean(activeJobIdRef.current))
                      ? 0.6
                      : 1,
                  cursor:
                    isCoverageQueryFetching ||
                    (running && Boolean(activeJobIdRef.current))
                      ? "wait"
                      : "pointer",
                }}
              >
                {isCoverageQueryFetching ? "Refreshing..." : "Refresh"}
              </button>
              <button
                onClick={run}
                disabled={
                  !snapshotId || (running && Boolean(activeJobIdRef.current))
                }
                style={{
                  background:
                    running && Boolean(activeJobIdRef.current)
                      ? isLight
                        ? "#e0f2fe"
                        : "rgba(14, 165, 233, 0.2)"
                      : isLight
                        ? "#0284c7"
                        : "#0ea5e9",
                  border:
                    running && Boolean(activeJobIdRef.current)
                      ? isLight
                        ? "1px solid #bae6fd"
                        : "1px solid rgba(14, 165, 233, 0.4)"
                      : isLight
                        ? "1px solid #0369a1"
                        : "1px solid #0284c7",
                  color:
                    running && Boolean(activeJobIdRef.current)
                      ? isLight
                        ? "#0369a1"
                        : "#bae6fd"
                      : "#ffffff",
                  boxShadow:
                    running && Boolean(activeJobIdRef.current)
                      ? "none"
                      : isLight
                        ? "0 2px 6px rgba(14, 165, 233, 0.25)"
                        : "0 2px 10px rgba(14, 165, 233, 0.35)",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor:
                    running && Boolean(activeJobIdRef.current)
                      ? "wait"
                      : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.15s ease",
                }}
                title="Run Integration Test Analysis (Supertest)"
              >
                {running && Boolean(activeJobIdRef.current)
                  ? `Running (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)...`
                  : "Run Integration Test"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Unit Test Candidate & Live Progress Bar (Integration-Style Control Strip) ── */}
      {type === "unit" && (
        <>
          <UnitTestGuidedWorkflow
            snapshotId={snapshotId}
            running={running}
            runProgress={runProgress}
            runningStatus={runningStatus}
            runStep={runStep}
            activeJobId={activeJobIdRef.current}
            onRun={run}
            onBulkSuggest={handleBulkSuggestTest}
            onOpenSuggestModal={(opts) =>
              handleOpenSuggestModal(
                opts?.filePath,
                opts?.functionName,
                opts?.isBulk ?? true,
              )
            }
            isBulkSuggesting={isBulkSuggesting}
            hasCompletedSuggest={hasSuggestJobCompleted}
            pendingSuggestionsCount={allPendingSuggestions.length}
            pendingFilesCount={filesWithPendingSuggestions.length}
            onApplyAll={handleApplyAllGlobal}
            isBulkApplying={isBulkApplying}
            bulkApplyStep={bulkApplyStep}
            bulkApplyProgress={bulkApplyProgress}
            bulkApplyPhase={bulkApplyPhase}
            summary={summary}
            rawTotals={rawTotals}
            executions={executions}
            testTotals={totals}
            scenarios={summary?.scenarios || summary?.data?.scenarios || []}
            hasExecuted={!running && (relevantRuns.some(r => ["COMPLETED", "PASSED", "SUCCESS", "FAILED"].includes(r?.status)) || totals.total > 0)}
            isLatestRunFailed={isLatestRunFailed}
            hasPartialFailures={hasPartialFailures}
            onRefresh={load}
            isRefreshing={isCoverageQueryFetching}
            onOpenReviewModal={() => openReviewForFile(null)}
            hasReviewableDiffs={reviewFiles.length > 0}
            activeTab={activeMetricView}
            onChangeTab={(tabId) => setActiveMetricView(tabId)}
            isLight={isLight}
            unitTestVersions={unitTestVersions}
            onSwitchVersion={handleSwitchVersion}
            isSwitchingVersion={isSwitchingVersion}
            switchingVersionFile={switchingVersionFile}
          />

          <UnitTestPackageInstaller
            key={snapshotId}
            missingDependencies={activeMissingDependencies}
            onInstallDependencies={handleInstallDependencies}
            isInstalling={Boolean(installingDependencyName)}
            isLight={isLight}
          />
        </>
      )}

      {/* Live Job Progress Banner */}
      {type !== "unit" && (running || isGenerating) && (
        <div
          style={{
            marginBottom: 20,
            padding: "12px 18px",
            background: isLight
              ? "var(--color-surface, #f8fafc)"
              : "var(--color-surface, #11161d)",
            border: isLight
              ? "1px solid #e2e8f0"
              : "1px solid var(--color-border, #29313d)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: isLight
              ? "0 2px 8px rgba(0,0,0,0.06)"
              : "0 4px 14px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "rgba(56, 189, 248, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#38bdf8",
                fontSize: 16,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  animation: "spin 1.5s linear infinite",
                }}
              >
                ⟳
              </span>
            </div>
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: isLight ? "#0f172a" : "#f0f6fc",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>Job in progress</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    background: "rgba(56, 189, 248, 0.25)",
                    color: "#0284c7",
                    padding: "1px 6px",
                    borderRadius: 4,
                    letterSpacing: "0.5px",
                  }}
                >
                  RUNNING
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: isLight ? "#64748b" : "#94a3b8",
                  marginTop: 2,
                }}
              >
                {runningStatus || runStep || "Processing task..."}
              </div>
            </div>
          </div>
        </div>
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

      {type === "unit" && (bulkSuggestMessage || bulkIsolatedDefects.length > 0) && (
        <div
          role={bulkIsolatedDefects.length > 0 ? "alert" : "status"}
          className={`mb-4 rounded-md px-4 py-3 border text-xs flex items-start justify-between gap-3 ${
            bulkIsolatedDefects.length > 0
              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
              : error && bulkSuggestMessage === error
                ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
          }`}
        >
          <div className="flex-1 min-w-0 space-y-2">
            {bulkSuggestMessage && (
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{bulkSuggestMessage}</span>
              </div>
            )}
            {bulkIsolatedDefects.length > 0 && (
              <div className="space-y-1 pl-6 font-mono tabular-nums text-[11px]">
                {bulkIsolatedDefects.map((defect, idx) => (
                  <div key={`${defect.symbol || "defect"}-${defect.file || ""}-${defect.line || idx}`}>
                    <span className="font-semibold text-amber-300">
                      {defect.symbol || "Source defect"}
                    </span>
                    {defect.file && (
                      <span className="text-amber-400/80">
                        {" "}({defect.file}{defect.line ? `:${defect.line}` : ""})
                      </span>
                    )}
                    {": "}
                    <span>{defect.diagnostic || defect.reason || defect.message || "Isolated during verification"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (error && error === bulkSuggestMessage) {
                setError("");
              }
              setBulkSuggestMessage("");
              setBulkIsolatedDefects([]);
            }}
            className="p-1 rounded-md hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer shrink-0"
            aria-label="Dismiss status notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (type !== "unit" || error !== bulkSuggestMessage) && (
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
        <div className="mb-4 rounded-lg border border-[var(--color-border)] border-l-2 border-l-rose-400/65 bg-[var(--color-surface)] p-4 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle
              size={16}
              className="text-rose-400/80 shrink-0 mt-0.5"
            />
            <div>
              <div className="text-xs font-semibold text-[var(--color-text)]">
                Test execution failed for current run
              </div>
              <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                Coverage:{" "}
                <span className="text-rose-300/85 font-medium">
                  Unavailable for current run
                </span>{" "}
                (results of failed runs excluded)
              </div>
            </div>
          </div>

          {failedSuiteNames.length > 0 && (
            <div className="text-xs text-[var(--color-text-secondary)] pl-6">
              <span className="text-[var(--color-text-muted)]">
                Failed suite:{" "}
              </span>
              <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-rose-300/85">
                {failedSuiteNames.join(", ")}
              </code>
            </div>
          )}

          {latestRunErr && (
            <div className="ml-6 font-mono text-[11px] bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2.5 rounded-md text-rose-300/85 whitespace-pre-wrap max-h-36 overflow-y-auto custom-scrollbar">
              {sanitizeErrorText(latestRunErr)}
            </div>
          )}

          {lastSuccessfulCov && (
            <div className="ml-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs px-3 py-2 rounded-md bg-[var(--color-bg)] border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)]">
              <span className="font-medium text-[var(--color-text-secondary)]">
                Previous successful run (cached):
              </span>
              <span className="font-mono tabular-nums">
                Statements:{" "}
                <strong className="text-[var(--color-text)]">
                  {lastSuccessfulValues[0]}%
                </strong>
              </span>
              <span className="font-mono tabular-nums">
                Branches:{" "}
                <strong className="text-[var(--color-text)]">
                  {lastSuccessfulValues[1]}%
                </strong>
              </span>
              <span className="font-mono tabular-nums">
                Functions:{" "}
                <strong className="text-[var(--color-text)]">
                  {lastSuccessfulValues[2]}%
                </strong>
              </span>
              <span className="font-mono tabular-nums">
                Lines:{" "}
                <strong className="text-[var(--color-text)]">
                  {lastSuccessfulValues[3]}%
                </strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Partial Test Assertions Notice (Coverage is valid, but some assertions failed) */}
      {!isLatestRunFailed && hasPartialFailures && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] border-l-2 border-l-amber-500/60 bg-[var(--color-surface)] px-4 py-3 space-y-1.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle
              size={15}
              className="text-amber-500/75 shrink-0 mt-0.5"
            />
            <div>
              <div className="text-xs font-semibold text-[var(--color-text)]">
                Coverage measured from current run (some assertions failed)
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                The files below display measured code coverage from the executed
                tests.
              </div>
            </div>
          </div>
          {failedSuiteNames.length > 0 && (
            <div className="text-xs text-[var(--color-text-secondary)] pl-6">
              <span className="text-[var(--color-text-muted)]">
                Suites with failures:{" "}
              </span>
              <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                {failedSuiteNames.join(", ")}
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
            className={
              type === "unit"
                ? "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--color-border)] overflow-hidden"
                : undefined
            }
            style={
              type === "unit"
                ? undefined
                : {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 12,
                  }
            }
          >
            {config.focus.map((label, i) => {
              const unitCard = type === "unit" ? unitCards[i] : null;
              let metricVal = Number(unitCard?.value ?? values[i] ?? 0);
              const rawInfo = unitCard || (i === 0 ? rawTotals?.statements : i === 1 ? rawTotals?.branches : i === 2 ? rawTotals?.functions : rawTotals?.lines);
              if (!unitCard && i === 1 && (Number(rawInfo?.covered || 0) === 0) && (Number(values[0] || 0) === 0 || Number(values[3] || 0) === 0)) {
                metricVal = 0;
              }
              const MetricIcon =
                i === 0
                  ? FileCode
                  : i === 1
                    ? GitBranch
                    : i === 2
                      ? Cpu
                      : Layers;

              if (type === "unit") {
                const statusDot =
                  metricVal >= 80
                    ? "bg-emerald-500/65"
                    : metricVal >= 60
                      ? "bg-amber-500/60"
                      : "bg-rose-400/75";
                const statusLabel =
                  metricVal >= 80
                    ? "Passing"
                    : metricVal >= 60
                      ? "Fair"
                      : "Low";
                return (
                  <div
                    key={label}
                    className="px-4 py-3.5 flex flex-col justify-between gap-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
                        <MetricIcon
                          size={13}
                          className="text-[var(--color-text-muted)] shrink-0"
                        />
                        <span>{label}</span>
                      </div>

                      {!isLatestRunFailed && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] font-mono">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${statusDot}`}
                          />
                          <span>{statusLabel}</span>
                        </span>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
                        <span
                          className={`text-2xl font-bold tracking-tight ${
                            isLatestRunFailed
                              ? "text-rose-300/85 text-lg"
                              : "text-[var(--color-text)]"
                          }`}
                        >
                          {isLatestRunFailed ? "Unavailable" : pct(metricVal)}
                        </span>

                        <span className="text-[11px] text-[var(--color-text-muted)] whitespace-nowrap">
                          {rawInfo?.total != null && rawInfo.total > 0 ? (
                            <span>
                              {Number(rawInfo.covered || 0).toLocaleString()} /{" "}
                              {Number(rawInfo.total).toLocaleString()}
                            </span>
                          ) : rawInfo?.total === 0 ? (
                            <span>0 / 0</span>
                          ) : (
                            <span>—</span>
                          )}
                        </span>
                      </div>

                      <div className="w-full h-1 rounded-sm bg-[var(--color-surface-secondary)] overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            metricVal >= 80
                              ? "bg-emerald-500/60"
                              : "bg-[var(--color-primary)]/70"
                          }`}
                          style={{
                            width: `${Math.min(100, Math.max(0, metricVal))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              }

              const isFeatureCoverage = type === "system" && i === 4;
              const isFlakyCard = type === "system" && i === 3;
              const hasRun = systemSummary?.hasRun;
              const tooltip = isFeatureCoverage
                ? hasRun && !systemSummary?.coverageAvailable
                  ? "Black-box E2E user scenario testing. Project has not enabled Istanbul instrumentation."
                  : "Source code coverage of E2E test scenarios."
                : undefined;

              const metricColor =
                type === "unit"
                  ? coverageColor(values[i])
                  : type === "system"
                    ? i === 1 // Passed
                      ? "#22c55e"
                      : i === 2 // Failed
                        ? Number(values[i]) > 0
                          ? "#f87171"
                          : "#8b949e"
                        : i === 3 // Flaky
                          ? Number(values[i]) > 0
                            ? "#fbbf24"
                            : "#8b949e"
                          : config.accent
                    : config.accent;

              return (
                <div key={label} style={cardStyle} title={tooltip}>
                  <div
                    style={{
                      color: "#8b949e",
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{label}</span>
                    {isFeatureCoverage && (
                      <span style={{ fontSize: 10, color: "#6e7681" }}>ℹ</span>
                    )}
                  </div>
                  <div
                    style={{
                      color: metricColor,
                      fontSize:
                        typeof values[i] === "string" && values[i].length > 6
                          ? 17
                          : 27,
                      fontWeight: 750,
                      marginTop: 8,
                      lineHeight: "1.2",
                    }}
                  >
                    {isFlakyCard ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 7,
                          flexWrap: "wrap",
                        }}
                      >
                        <span>{values[i]}</span>
                        {hasRun && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background:
                                Number(values[i]) > 0
                                  ? "rgba(251, 191, 36, 0.15)"
                                  : "rgba(34, 197, 94, 0.12)",
                              color:
                                Number(values[i]) > 0 ? "#fbbf24" : "#4ade80",
                              border:
                                Number(values[i]) > 0
                                  ? "1px solid rgba(251, 191, 36, 0.35)"
                                  : "1px solid rgba(34, 197, 94, 0.25)",
                            }}
                          >
                            {Number(values[i]) > 0
                              ? "⚠ Needs Attention"
                              : "✓ Stable"}
                          </span>
                        )}
                      </div>
                    ) : type === "unit" ? (
                      pct(values[i])
                    ) : (
                      values[i]
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Feature explanations for non-unit test types */}
          {type !== "unit" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 13,
                marginTop: 18,
              }}
            >
              {config.explanation.map(([title, text]) => (
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
          )}

          {/* Mode Navigation Tabs (Unit Test Coverage) */}
          {type === "unit" && (
            <div className="mt-5 border-b border-[var(--color-border)] flex items-center gap-5 overflow-x-auto custom-scrollbar">
              {[
                {
                  id: "traceability",
                  label: "Logic & Test Traceability",
                  count: `${functionsList.length} fns`,
                  icon: Target,
                },
                {
                  id: "simulation",
                  label: "Test Execution Simulation",
                  count: "Interactive Studio",
                  icon: Zap,
                },
                {
                  id: "testcases",
                  label: "Test Suites & Specs",
                  count: `${unitTestSuites.length} files`,
                  icon: FileCheck,
                },
                {
                  id: "versions",
                  label: "Version History",
                  count: `${uniqueVersionsCount} versions`,
                  icon: History,
                },
              ].map((tab) => {
                const isCurrent = activeMetricView === tab.id;
                const TabIcon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveMetricView(tab.id)}
                    className={`relative flex items-center gap-1.5 py-2.5 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 -mb-px ${
                      isCurrent
                        ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium"
                    }`}
                  >
                    {TabIcon && (
                      <TabIcon
                        size={13}
                        className={
                          isCurrent
                            ? "text-[var(--color-primary)]"
                            : "text-[var(--color-text-muted)]"
                        }
                      />
                    )}
                    <span>{tab.label}</span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Active View Explanatory Banner */}
          {activeMetricView !== "testcases" &&
            activeMetricView !== "traceability" &&
            activeMetricView !== "versions" &&
            activeMetricView !== "simulation" && (
              <div className="mt-3 px-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
                <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                  {activeMetricView === "visualization" ? (
                    <>
                      <Terminal
                        size={14}
                        className="shrink-0 text-[var(--color-text-muted)]"
                      />
                      <span>
                        <strong className="font-medium text-[var(--color-text)]">
                          Execution Terminal &amp; Logs:
                        </strong>{" "}
                        Real-time runner output, BullMQ pipeline stages, and
                        coverage synchronization.
                      </span>
                    </>
                  ) : activeMetricView === "statements" ? (
                    <>
                      <FileCode
                        size={14}
                        className="shrink-0 text-[var(--color-text-muted)]"
                      />
                      <span>
                        <strong className="font-medium text-[var(--color-text)]">
                          Statement Coverage:
                        </strong>{" "}
                        Percentage of source code statements executed during
                        unit testing.
                      </span>
                    </>
                  ) : activeMetricView === "branches" ? (
                    <>
                      <GitBranch
                        size={14}
                        className="shrink-0 text-[var(--color-text-muted)]"
                      />
                      <span>
                        <strong className="font-medium text-[var(--color-text)]">
                          Branch Coverage:
                        </strong>{" "}
                        Percentage of conditional branches evaluated across all
                        paths.
                      </span>
                    </>
                  ) : activeMetricView === "functions" ? (
                    <>
                      <Cpu
                        size={14}
                        className="shrink-0 text-[var(--color-text-muted)]"
                      />
                      <span>
                        <strong className="font-medium text-[var(--color-text)]">
                          Function Coverage:
                        </strong>{" "}
                        Identified methods and functions with invocation metrics
                        and CFG analysis.
                      </span>
                    </>
                  ) : (
                    <>
                      <ListChecks
                        size={14}
                        className="shrink-0 text-[var(--color-text-muted)]"
                      />
                      <span>
                        <strong className="font-medium text-[var(--color-text)]">
                          Source File Coverage:
                        </strong>{" "}
                        Aggregated coverage summary across source files.
                      </span>
                    </>
                  )}
                </div>

                {activeMetricView === "functions" && (
                  <div className="inline-flex items-center rounded-md bg-[var(--color-bg)] p-0.5 border border-[var(--color-border)] shrink-0">
                    <button
                      type="button"
                      onClick={() => setFunctionViewMode("map")}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        functionViewMode === "map"
                          ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
                      }`}
                    >
                      <Cpu size={11} />
                      <span>Method Call Map</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFunctionViewMode("table")}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        functionViewMode === "table"
                          ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
                      }`}
                    >
                      <ListChecks size={11} />
                      <span>Details Table</span>
                    </button>
                  </div>
                )}
              </div>
            )}

          {/* ── TABLE VIEW SWITCHER ─────────────────────────────────── */}
          {type === "unit" && activeMetricView === "traceability" ? (
            <div style={{ marginTop: 14 }}>
              <UnitTestTraceabilityMatrix
                snapshotId={snapshotId}
                projectId={projectId}
                running={running}
                runProgress={runProgress}
                sourceFiles={selectedFiles}
                testSuites={unitTestSuites}
                functionsList={functionsList}
                summary={summary}
                rawTotals={rawTotals}
                onOpenFile={handleOpenFileInPlace}
                onOpenCFG={(filePath, funcName, line) => {
                  if (onOpenCFG) {
                    onOpenCFG(filePath, funcName, line);
                  } else {
                    setCfgModalContext({
                      file: filePath,
                      func: funcName,
                      line,
                    });
                    setShowCfgModal(true);
                  }
                }}
                onSuggestTestcase={(filePath, fnName) =>
                  handleOpenSuggestModal(filePath, fnName, false)
                }
                inlineSuggestions={inlineSuggestions}
                loadingSuggestions={loadingSuggestions}
                suggestionErrors={suggestionErrors}
                applyingSuggestionIds={applyingSuggestionIds}
                applyResultsByFile={applyResultsByFile}
                onApplySuggestion={handleApplySuggestionInline}
                onApplyAllFileSuggestions={handleApplyAllInline}
                onDryRunFileSuggestions={handleDryRunInline}
                onReviewDiff={openReviewForFile}
                onInstallDependency={handleInstallDependency}
                installingDependencyName={installingDependencyName}
                isLight={isLight}
                unitTestVersions={unitTestVersions}
                onSwitchVersion={handleSwitchVersion}
                isSwitchingVersion={isSwitchingVersion}
                switchingVersionFile={switchingVersionFile}
                isBulkApplying={isBulkApplying}
                bulkApplyStep={bulkApplyStep}
                bulkApplyPhase={bulkApplyPhase}
                bulkApplyProgress={bulkApplyProgress}
                applyProgressSteps={applyProgressSteps}
                onOpenSimulation={(simTarget) => {
                  if (simTarget?.filePath) setSelectedSourceFile(simTarget.filePath);
                  setActiveMetricView("simulation");
                }}
              />
            </div>
          ) : type === "unit" && activeMetricView === "simulation" ? (
            <div style={{ marginTop: 14 }}>
              <UnitTestSimulationStudioModal
                isOpen={true}
                isEmbedded={true}
                snapshotId={snapshotId}
                projectId={projectId}
                isLight={isLight}
                availableSourceFiles={selectedFiles}
                availableFunctionsList={functionsList}
                availableTestSuites={unitTestSuites}
                initialSourceFile={selectedSourceFile || selectedFiles?.[0]?.filePath || selectedFiles?.[0]?.path}
              />
            </div>
          ) : type === "unit" && activeMetricView === "versions" ? (
            <div style={{ marginTop: 14 }}>
              <UnitTestVersionHistoryView
                unitTestVersions={unitTestVersions}
                onSwitchVersion={handleSwitchVersion}
                isSwitchingVersion={isSwitchingVersion}
                switchingVersionFile={switchingVersionFile}
                onReviewDiff={openReviewForFile}
                isLight={isLight}
                snapshotId={snapshotId}
                projectId={projectId}
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
                boxShadow: isLight
                  ? "0 1px 3px rgba(15, 23, 42, 0.05)"
                  : "none",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  fontWeight: 700,
                  borderBottom: isLight
                    ? "1px solid #f1f5f9"
                    : "1px solid rgba(255,255,255,.07)",
                  background: isLight ? "#ffffff" : "transparent",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: isLight ? "#0f172a" : undefined }}>
                    File Testcase (Jest & Vitest)
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: isLight ? "#64748b" : "#8b949e",
                      fontWeight: 400,
                    }}
                  >
                    ({filteredTestSuites.length} test files)
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Search input */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: isLight
                        ? "#ffffff"
                        : "rgba(255,255,255,0.04)",
                      border: isLight
                        ? "1px solid #cbd5e1"
                        : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                    }}
                  >
                    <Search
                      size={13}
                      style={{ color: isLight ? "#64748b" : "#8b949e" }}
                    />
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
                  style={{
                    padding: 30,
                    textAlign: "center",
                    color: isLight ? "#64748b" : "#6e7681",
                  }}
                >
                  Loading test case files...
                </div>
              ) : filteredTestSuites.length === 0 ? (
                <div
                  style={{
                    padding: 30,
                    textAlign: "center",
                    color: isLight ? "#64748b" : "#6e7681",
                  }}
                >
                  No Jest or Vitest test case files found. Click "Run Analysis
                  Unit" to run and analyze.
                </div>
              ) : (
                <div>
                  <div style={{ overflowX: "auto" }}>
                    {/* Table Header */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "48px minmax(280px, 3.5fr) 100px 100px 85px 105px 105px",
                        gap: 10,
                        minWidth: 840,
                        padding: "10px 18px",
                        background: isLight
                          ? "#f8fafc"
                          : "rgba(255,255,255,0.02)",
                        borderBottom: isLight
                          ? "1px solid #e2e8f0"
                          : "1px solid rgba(255,255,255,0.05)",
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
                        <div
                          key={
                            suite.id || `${suite.filePath || "suite"}-${idx}`
                          }
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "48px minmax(280px, 3.5fr) 100px 100px 85px 105px 105px",
                              gap: 10,
                              minWidth: 840,
                              padding: "12px 18px",
                              alignItems: "center",
                              borderBottom: isLight
                                ? "1px solid #f1f5f9"
                                : "1px solid rgba(255,255,255,.04)",
                              transition: "background 0.15s ease",
                              background: isExpanded
                                ? isLight
                                  ? "#f8fafc"
                                  : "rgba(255, 255, 255, 0.03)"
                                : "transparent",
                            }}
                            className={
                              isLight
                                ? "hover:bg-slate-50/80"
                                : "hover:bg-white/[0.02]"
                            }
                          >
                            {/* File Index */}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  fontFamily: "var(--font-mono, monospace)",
                                  color: isLight ? "#64748b" : "#94a3b8",
                                  background: isLight
                                    ? "#f1f5f9"
                                    : "rgba(255, 255, 255, 0.05)",
                                  border: isLight
                                    ? "1px solid #e2e8f0"
                                    : "1px solid rgba(255, 255, 255, 0.08)",
                                  borderRadius: 6,
                                  padding: "2px 6px",
                                  minWidth: 26,
                                  textAlign: "center",
                                }}
                              >
                                {(testSuitePage - 1) * TEST_SUITES_PER_PAGE +
                                  idx +
                                  1}
                              </span>
                            </div>

                            {/* File path */}
                            <div
                              onClick={() =>
                                handleOpenFileInPlace(suite.filePath)
                              }
                              style={{
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                overflow: "hidden",
                              }}
                              title={`Open test file ${suite.filePath}`}
                            >
                              {(() => {
                                const cleaned = cleanDisplayPath(
                                  suite.filePath,
                                );
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
                                    <span
                                      style={{
                                        color: isLight ? "#64748b" : "#8b949e",
                                        marginRight: 5,
                                      }}
                                    >
                                      {dir} /
                                    </span>
                                    <span
                                      style={{
                                        color: isLight ? "#0f172a" : "#e6edf3",
                                        fontWeight: 600,
                                      }}
                                    >
                                      {file}
                                    </span>
                                  </span>
                                );
                              })()}
                            </div>

                            {/* Framework Badge */}
                            <div className="flex justify-center">
                              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-[var(--color-bg)] text-[var(--color-text-secondary)] border border-[var(--color-border)] uppercase">
                                {suite.framework}
                              </span>
                            </div>

                            {/* Test Cases Count */}
                            <div className="text-right text-xs font-mono tabular-nums">
                              <span className="text-[var(--color-text-secondary)] font-medium">
                                ✓ {suite.passedTests || 0}
                              </span>
                              {suite.failedTests > 0 && (
                                <span className="text-rose-300/85 font-medium ml-1.5">
                                  × {suite.failedTests}
                                </span>
                              )}
                            </div>

                            {/* Duration */}
                            <div className="text-right text-xs font-mono tabular-nums text-[var(--color-text-muted)]">
                              {suite.durationMs ? `${suite.durationMs}ms` : "—"}
                            </div>

                            {/* Status */}
                            <div className="flex justify-center">
                              <span
                                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded border ${
                                  isPassed
                                    ? "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                                    : suite.status === "pending"
                                      ? "bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                                      : "bg-rose-500/[0.06] text-rose-300/85 border-rose-500/20"
                                }`}
                                title={
                                  suite.status === "pending"
                                    ? suite.pendingReason ||
                                      suite.message ||
                                      "Pending: Test file not executed during test run"
                                    : isPassed
                                      ? "Test suite passed"
                                      : suite.message || "Test suite failed"
                                }
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isPassed
                                      ? "bg-emerald-500/65"
                                      : suite.status === "pending"
                                        ? "bg-amber-500/60"
                                        : "bg-rose-400/75"
                                  }`}
                                />
                                {isPassed
                                  ? "Passed"
                                  : suite.status === "pending"
                                    ? "Pending"
                                    : "Failed"}
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
                                onClick={() =>
                                  handleOpenFileInPlace(suite.filePath)
                                }
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 5,
                                  background: isLight
                                    ? "#ffffff"
                                    : "rgba(255,255,255,0.05)",
                                  border: isLight
                                    ? "1px solid #cbd5e1"
                                    : "1px solid rgba(255,255,255,0.1)",
                                  color: isLight ? "#334155" : "#c9d1d9",
                                  fontSize: 11,
                                  fontWeight: isLight ? 600 : 400,
                                  cursor: "pointer",
                                }}
                                title="Open test file in editor"
                              >
                                Open test
                              </button>

                              {((suite.assertions &&
                                suite.assertions.length > 0) ||
                                suite.message ||
                                suite.pendingReason ||
                                suite.status === "pending") && (
                                <button
                                  onClick={() =>
                                    setExpandedSuite(
                                      isExpanded ? null : suite.filePath,
                                    )
                                  }
                                  style={{
                                    padding: "4px 6px",
                                    borderRadius: 5,
                                    background: isLight
                                      ? "#ffffff"
                                      : "rgba(255,255,255,0.03)",
                                    border: isLight
                                      ? "1px solid #cbd5e1"
                                      : "1px solid rgba(255,255,255,0.08)",
                                    color: isLight ? "#64748b" : "#8b949e",
                                    fontSize: 11,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  title={
                                    suite.status === "pending"
                                      ? "View pending reason"
                                      : suite.message
                                        ? "View error details"
                                        : "View child test cases"
                                  }
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
                          {isExpanded &&
                            (suite.assertions?.length > 0 ||
                              suite.message ||
                              suite.pendingReason ||
                              suite.status === "pending") && (
                              <div
                                style={{
                                  background: isLight
                                    ? "#f8fafc"
                                    : "rgba(0,0,0,0.25)",
                                  padding: "12px 24px",
                                  borderBottom: isLight
                                    ? "1px solid #e2e8f0"
                                    : "1px solid rgba(255,255,255,.05)",
                                }}
                              >
                                {/* Pending reason banner */}
                                {suite.status === "pending" && (
                                  <div
                                    style={{
                                      background: isLight
                                        ? "#fefce8"
                                        : "rgba(234,179,8,0.08)",
                                      border: isLight
                                        ? "1px solid #fef08a"
                                        : "1px solid rgba(234,179,8,0.25)",
                                      borderRadius: 6,
                                      padding: "8px 12px",
                                      marginBottom:
                                        suite.assertions?.length > 0 ? 10 : 0,
                                      fontSize: 11,
                                      fontFamily: "var(--font-mono)",
                                      color: isLight ? "#854d0e" : "#fef08a",
                                      whiteSpace: "pre-wrap",
                                      wordBreak: "break-all",
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontWeight: 700,
                                        display: "block",
                                        marginBottom: 4,
                                        color: isLight ? "#a16207" : "#fde047",
                                      }}
                                    >
                                      ⏳ Pending Reason:
                                    </span>
                                    {suite.pendingReason ||
                                      suite.message ||
                                      "File was discovered on disk but was not executed during the test run."}
                                  </div>
                                )}

                                {/* Error message banner */}
                                {suite.status !== "pending" &&
                                  suite.message && (
                                    <div
                                      style={{
                                        background: isLight
                                          ? "#fef2f2"
                                          : "rgba(239,68,68,0.08)",
                                        border: isLight
                                          ? "1px solid #fecaca"
                                          : "1px solid rgba(239,68,68,0.25)",
                                        borderRadius: 6,
                                        padding: "8px 12px",
                                        marginBottom:
                                          suite.assertions?.length > 0 ? 10 : 0,
                                        fontSize: 11,
                                        fontFamily: "var(--font-mono)",
                                        color: isLight ? "#991b1b" : "#fca5a5",
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-all",
                                        maxHeight: 200,
                                        overflowY: "auto",
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontWeight: 700,
                                          display: "block",
                                          marginBottom: 4,
                                          color: isLight
                                            ? "#dc2626"
                                            : "#f87171",
                                        }}
                                      >
                                        ⚠ Error Details:
                                      </span>
                                      {suite.message}
                                    </div>
                                  )}
                                {suite.assertions &&
                                  suite.assertions.length > 0 && (
                                    <>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          color: isLight
                                            ? "#475569"
                                            : "#8b949e",
                                          marginBottom: 6,
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        Test cases in {suite.fileName}:
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 5,
                                        }}
                                      >
                                        {suite.assertions.map(
                                          (testCase, idx) => {
                                            const targetFn =
                                              testCase.targetFunction ||
                                              (Array.isArray(
                                                testCase.ancestorTitles,
                                              ) &&
                                              testCase.ancestorTitles.length > 1
                                                ? testCase.ancestorTitles[
                                                    testCase.ancestorTitles
                                                      .length - 1
                                                  ]
                                                : null);

                                            return (
                                              <div
                                                key={idx}
                                                onClick={() =>
                                                  handleOpenFileInPlace(
                                                    suite.filePath,
                                                    testCase.line ||
                                                      testCase.location?.line ||
                                                      null,
                                                    testCase.title,
                                                  )
                                                }
                                                style={{
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: 9,
                                                  fontSize: 12,
                                                  fontFamily:
                                                    "var(--font-mono)",
                                                  padding: "4px 6px",
                                                  borderRadius: 4,
                                                  cursor: "pointer",
                                                  borderBottom: isLight
                                                    ? "1px dashed #e2e8f0"
                                                    : "1px dashed rgba(255,255,255,0.03)",
                                                  transition: "all 0.12s ease",
                                                }}
                                                className="hover:bg-indigo-500/10"
                                                title={`Click to view test case source code: ${testCase.title}`}
                                              >
                                                <span
                                                  style={{
                                                    fontSize: 10.5,
                                                    fontWeight: 700,
                                                    fontFamily:
                                                      "var(--font-mono)",
                                                    color: isLight
                                                      ? "#94a3b8"
                                                      : "#64748b",
                                                    minWidth: 22,
                                                  }}
                                                >
                                                  #{idx + 1}
                                                </span>
                                                {testCase.status ===
                                                "passed" ? (
                                                  <Check
                                                    size={13}
                                                    className="text-emerald-500/75 shrink-0"
                                                  />
                                                ) : (
                                                  <X
                                                    size={13}
                                                    className="text-rose-400/80 shrink-0"
                                                  />
                                                )}
                                                {targetFn && (
                                                  <span
                                                    className="inline-flex items-center gap-1 text-[10.5px] font-mono px-1.5 py-0.2 rounded bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)] whitespace-nowrap shrink-0"
                                                    title={`Target function: ${targetFn}`}
                                                  >
                                                    <span className="text-[var(--color-text-muted)]">
                                                      ƒ
                                                    </span>
                                                    {targetFn}
                                                  </span>
                                                )}
                                                <span
                                                  style={{
                                                    color:
                                                      testCase.status ===
                                                      "passed"
                                                        ? isLight
                                                          ? "#1e293b"
                                                          : "#c9d1d9"
                                                        : isLight
                                                          ? "#991b1b"
                                                          : "#fca5a5",
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
                                                      color: isLight
                                                        ? "#64748b"
                                                        : "#6e7681",
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
                                          },
                                        )}
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
                  onOpenFile={handleOpenFileInPlace}
                  onSuggestTestcase={onSuggestTestcase}
                  onOpenCfg={(filePath, funcName, line) => {
                    if (onOpenCFG) {
                      onOpenCFG(filePath, funcName, line);
                    } else {
                      setCfgModalContext({
                        file: filePath,
                        func: funcName,
                        line,
                      });
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
                  boxShadow: isLight
                    ? "0 1px 3px rgba(15, 23, 42, 0.05)"
                    : "none",
                }}
              >
                <div
                  style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    borderBottom: isLight
                      ? "1px solid #f1f5f9"
                      : "1px solid rgba(255,255,255,.07)",
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
                    <Cpu
                      size={16}
                      style={{ color: isLight ? "#0284c7" : "#38bdf8" }}
                    />
                    <span style={{ color: isLight ? "#0f172a" : undefined }}>
                      Function Coverage Breakdown
                    </span>
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
                        background: isLight
                          ? "#ffffff"
                          : "rgba(255,255,255,0.04)",
                        border: isLight
                          ? "1px solid #cbd5e1"
                          : "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 12,
                      }}
                    >
                      <Search
                        size={13}
                        style={{ color: isLight ? "#64748b" : "#8b949e" }}
                      />
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
                            fontWeight:
                              functionStatusFilter === st.id ? 650 : 500,
                            padding: "4px 10px",
                            borderRadius: 5,
                            cursor: "pointer",
                            background:
                              functionStatusFilter === st.id
                                ? isLight
                                  ? "#e0f2fe"
                                  : "rgba(56, 189, 248, 0.2)"
                                : isLight
                                  ? "#ffffff"
                                  : "rgba(255,255,255,0.03)",
                            color:
                              functionStatusFilter === st.id
                                ? isLight
                                  ? "#0369a1"
                                  : "#38bdf8"
                                : isLight
                                  ? "#64748b"
                                  : "#8b949e",
                            border:
                              functionStatusFilter === st.id
                                ? isLight
                                  ? "1px solid #7dd3fc"
                                  : "1px solid rgba(56, 189, 248, 0.4)"
                                : isLight
                                  ? "1px solid #cbd5e1"
                                  : "1px solid rgba(255,255,255,0.05)",
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
                          background: isLight
                            ? "#f8fafc"
                            : "rgba(255,255,255,0.02)",
                          borderBottom: isLight
                            ? "1px solid #e2e8f0"
                            : "1px solid rgba(255,255,255,0.05)",
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
                              borderBottom: isLight
                                ? "1px solid #f1f5f9"
                                : "1px solid rgba(255,255,255,.04)",
                              transition: "background 0.15s ease",
                            }}
                            className={
                              isLight
                                ? "hover:bg-slate-50/80"
                                : "hover:bg-white/[0.02]"
                            }
                          >
                            {/* Function Index */}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  fontFamily: "var(--font-mono, monospace)",
                                  color: isLight ? "#64748b" : "#94a3b8",
                                  background: isLight
                                    ? "#f1f5f9"
                                    : "rgba(255, 255, 255, 0.05)",
                                  border: isLight
                                    ? "1px solid #e2e8f0"
                                    : "1px solid rgba(255, 255, 255, 0.08)",
                                  borderRadius: 6,
                                  padding: "2px 6px",
                                  minWidth: 26,
                                  textAlign: "center",
                                }}
                              >
                                {(functionPage - 1) * FUNCTIONS_PER_PAGE +
                                  idx +
                                  1}
                              </span>
                            </div>

                            <div
                              onClick={() =>
                                handleOpenFileInPlace(
                                  fn.filePath,
                                  fn.startLine || fn.line || 1,
                                  fn.functionName,
                                  fn.endLine,
                                )
                              }
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
                                    ? isLight
                                      ? "#0284c7"
                                      : "#38bdf8"
                                    : isLight
                                      ? "#d97706"
                                      : "#fbbf24",
                                  flexShrink: 0,
                                }}
                              />
                              <span
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 13,
                                  color: isCovered
                                    ? isLight
                                      ? "#0f172a"
                                      : "#e6edf3"
                                    : isLight
                                      ? "#b45309"
                                      : "#fde68a",
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
                              onClick={() =>
                                handleOpenFileInPlace(
                                  fn.filePath,
                                  fn.startLine || fn.line || 1,
                                  fn.functionName,
                                  fn.endLine,
                                )
                              }
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
                                  ? isLight
                                    ? "#16a34a"
                                    : "#22c55e"
                                  : isLight
                                    ? "#d97706"
                                    : "#fbbf24",
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
                                    ? isLight
                                      ? "#f0fdf4"
                                      : "rgba(34, 197, 94, 0.15)"
                                    : isLight
                                      ? "#fefce8"
                                      : "rgba(251, 191, 36, 0.15)",
                                  color: isCovered
                                    ? isLight
                                      ? "#15803d"
                                      : "#4ade80"
                                    : isLight
                                      ? "#a16207"
                                      : "#fde047",
                                  border: isCovered
                                    ? isLight
                                      ? "1px solid #bbf7d0"
                                      : "1px solid rgba(34, 197, 94, 0.3)"
                                    : isLight
                                      ? "1px solid #fef08a"
                                      : "1px solid rgba(251, 191, 36, 0.3)",
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
                                onClick={() =>
                                  handleOpenFileInPlace(
                                    fn.filePath,
                                    fn.startLine || fn.line || 1,
                                    fn.functionName,
                                    fn.endLine,
                                  )
                                }
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "4px 8px",
                                  borderRadius: 5,
                                  background: isLight
                                    ? "#ffffff"
                                    : "rgba(255,255,255,0.05)",
                                  border: isLight
                                    ? "1px solid #cbd5e1"
                                    : "1px solid rgba(255,255,255,0.1)",
                                  color: isLight ? "#334155" : "#c9d1d9",
                                  fontSize: 11,
                                  fontWeight: isLight ? 600 : 400,
                                  cursor: "pointer",
                                }}
                                title="View function source code"
                              >
                                <Code2 size={12} />
                                <span>Open code</span>
                              </button>

                              <button
                                onClick={() => {
                                  const targetLine =
                                    fn.startLine || fn.line || 1;
                                  const targetFunc =
                                    fn.displayName || fn.functionName;
                                  if (onOpenCFG) {
                                    onOpenCFG(
                                      fn.filePath,
                                      targetFunc,
                                      targetLine,
                                    );
                                  } else {
                                    setCfgModalContext({
                                      file: fn.filePath,
                                      func: targetFunc,
                                      line: targetLine,
                                    });
                                    setShowCfgModal(true);
                                  }
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "4px 8px",
                                  borderRadius: 5,
                                  background: isLight
                                    ? "#e0f2fe"
                                    : "rgba(56, 189, 248, 0.12)",
                                  border: isLight
                                    ? "1px solid #7dd3fc"
                                    : "1px solid rgba(56, 189, 248, 0.3)",
                                  color: isLight ? "#0284c7" : "#38bdf8",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                                title="View Control Flow Graph (CFG) for this function"
                              >
                                <Network size={12} />
                                <span>View CFG</span>
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
                boxShadow: isLight
                  ? "0 1px 3px rgba(15, 23, 42, 0.05)"
                  : "none",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  fontWeight: 700,
                  borderBottom: isLight
                    ? "1px solid #f1f5f9"
                    : "1px solid rgba(255,255,255,.07)",
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
                      ? systemSummary?.hasRun &&
                        !systemSummary?.coverageAvailable
                        ? "E2E Test Scenarios"
                        : "Files exercised by E2E tests"
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
                      background: isLight
                        ? "#ffffff"
                        : "rgba(255,255,255,0.04)",
                      border: isLight
                        ? "1px solid #cbd5e1"
                        : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                    }}
                  >
                    <Search
                      size={13}
                      style={{ color: isLight ? "#64748b" : "#8b949e" }}
                    />
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
                    style={{
                      fontSize: 11,
                      color: isLight ? "#64748b" : "#8b949e",
                      fontWeight: 400,
                    }}
                  >
                    {type === "system" &&
                    systemSummary?.hasRun &&
                    !systemSummary?.coverageAvailable
                      ? `${systemSummary.scenarios?.length || 0} scenarios executed`
                      : filteredSourceFiles.length !== displayFiles.length
                        ? `${filteredSourceFiles.length} of ${displayFiles.length} files`
                        : `${displayFiles.length} files analyzed`}
                  </span>
                </div>
              </div>

              {type === "system" && !systemSummary?.hasRun ? (
                <div style={{ padding: "44px 24px", textAlign: "center" }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: "rgba(236, 72, 153, 0.12)",
                      border: "1px solid rgba(236, 72, 153, 0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 16px",
                      color: "#ec4899",
                    }}
                  >
                    <Zap size={22} />
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#f0f6fc",
                      marginBottom: 6,
                    }}
                  >
                    No E2E scenarios executed on this snapshot yet
                  </div>
                  <p
                    style={{
                      color: "#8b949e",
                      fontSize: 13,
                      maxWidth: 500,
                      margin: "0 auto 20px",
                      lineHeight: 1.55,
                    }}
                  >
                    No System / E2E test runs (Playwright or Cypress) recorded
                    yet. Run tests or generate AI E2E scenarios to get started.
                  </p>

                  {systemSummary?.latestAiTest && (
                    <div
                      style={{
                        margin: "0 auto 24px",
                        maxWidth: 620,
                        textAlign: "left",
                        padding: 16,
                        borderRadius: 10,
                        border:
                          systemSummary.latestAiTest.status === "VERIFIED"
                            ? "1px solid rgba(34, 197, 94, 0.35)"
                            : "1px solid rgba(251, 191, 36, 0.35)",
                        background:
                          systemSummary.latestAiTest.status === "VERIFIED"
                            ? "rgba(34, 197, 94, 0.08)"
                            : "rgba(251, 191, 36, 0.08)",
                      }}
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
                          }}
                        >
                          <span style={{ fontSize: 16 }}>
                            {systemSummary.latestAiTest.status === "VERIFIED"
                              ? "✓"
                              : "⚠️"}
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              color:
                                systemSummary.latestAiTest.status === "VERIFIED"
                                  ? "#22c55e"
                                  : "#fbbf24",
                            }}
                          >
                            {systemSummary.latestAiTest.status === "VERIFIED"
                              ? "AI generated E2E scenario and passed dry-run"
                              : "Dry-run sandbox verification failed"}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontWeight: 600,
                            background:
                              systemSummary.latestAiTest.status === "VERIFIED"
                                ? "rgba(34, 197, 94, 0.2)"
                                : "rgba(251, 191, 36, 0.2)",
                            color:
                              systemSummary.latestAiTest.status === "VERIFIED"
                                ? "#4ade80"
                                : "#fde047",
                          }}
                        >
                          {systemSummary.latestAiTest.status === "VERIFIED"
                            ? "VERIFIED"
                            : "DRY-RUN FAILED"}
                        </span>
                      </div>

                      <p
                        style={{
                          margin: "0 0 10px",
                          fontSize: 13,
                          color: "#c9d1d9",
                          lineHeight: 1.55,
                        }}
                      >
                        {systemSummary.latestAiTest.status === "VERIFIED"
                          ? `Test scenario saved to: ${systemSummary.latestAiTest.filePath}. Click "Run System Test" to execute!`
                          : `The generated test scenario failed dry-run verification in the sandbox. The file was not saved automatically to prevent test suite regressions.`}
                      </p>

                      {systemSummary.latestAiTest.status === "FAILED" && (
                        <div
                          style={{
                            marginBottom: 12,
                            padding: "10px 12px",
                            background: "rgba(0,0,0,0.25)",
                            borderRadius: 6,
                            fontSize: 12,
                            color: "#e6edf3",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              color: "#fbbf24",
                              marginBottom: 4,
                            }}
                          >
                            Verification did not pass
                          </div>
                          <div style={{ color: "#8b949e", lineHeight: 1.5 }}>
                            Tests were checked against the real application and
                            a fresh test database. Review the startup or
                            assertion error below. Regenerate to retry automatic
                            repair; an unverified candidate cannot be saved as a
                            passing test.
                          </div>
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          onClick={() => setShowAiDetails(!showAiDetails)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#67e8f9",
                            fontSize: 12,
                            cursor: "pointer",
                            padding: 0,
                            textDecoration: "underline",
                          }}
                        >
                          {showAiDetails
                            ? "▲ Hide failure details & AI code"
                            : "▼ View failure details & AI code"}
                        </button>

                        {systemSummary.latestAiTest.status === "VERIFIED" && (
                          <button
                            onClick={handleSaveAiSystemTest}
                            disabled={isSavingAiTest || loading || running}
                            title="Save this AI-generated test to your project test suite"
                            style={{
                              background: "rgba(34, 197, 94, 0.2)",
                              border: "1px solid rgba(34, 197, 94, 0.5)",
                              color: "#4ade80",
                              borderRadius: 6,
                              padding: "4px 12px",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: isSavingAiTest
                                ? "not-allowed"
                                : "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              transition: "all 0.2s ease",
                            }}
                          >
                            <Zap size={13} />
                            {isSavingAiTest
                              ? "Saving..."
                              : "⚡ Save Test to Project"}
                          </button>
                        )}
                      </div>

                      {showAiDetails && (
                        <div
                          style={{
                            marginTop: 12,
                            borderTop: "1px solid rgba(255,255,255,0.1)",
                            paddingTop: 10,
                          }}
                        >
                          {systemSummary.latestAiTest.meta?.error && (
                            <div style={{ marginBottom: 10 }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: "#f87171",
                                  marginBottom: 4,
                                }}
                              >
                                Dry-run failure details:
                              </div>
                              <pre
                                style={{
                                  margin: 0,
                                  padding: 8,
                                  background: "#0d1117",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  color: "#ff7b72",
                                  maxHeight: 150,
                                  overflowY: "auto",
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {systemSummary.latestAiTest.meta.error}
                              </pre>
                            </div>
                          )}
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#8b949e",
                                marginBottom: 4,
                              }}
                            >
                              AI-generated test code (
                              {systemSummary.latestAiTest.filePath}):
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                padding: 8,
                                background: "#0d1117",
                                borderRadius: 6,
                                fontSize: 11,
                                color: "#c9d1d9",
                                maxHeight: 180,
                                overflowY: "auto",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {systemSummary.latestAiTest.content}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 12,
                    }}
                  >
                    <button
                      onClick={handleGenerateAiSystemTest}
                      disabled={loading || running || isGenerating}
                      style={{
                        ...buttonStyle("#67e8f9"),
                        background: "rgba(103, 232, 249, 0.15)",
                        border: "1px solid rgba(103,232,249,0.45)",
                        padding: "10px 18px",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      {isGenerating && (
                        <span
                          style={{
                            display: "inline-block",
                            animation: "spin 1s linear infinite",
                          }}
                        >
                          ⟳
                        </span>
                      )}
                      <span>
                        {isGenerating
                          ? runningStatus || "Generating AI tests..."
                          : "⚡ Generate AI System Tests"}
                      </span>
                    </button>
                    <button
                      onClick={run}
                      disabled={!snapshotId || running || isGenerating}
                      style={{
                        ...buttonStyle(config.accent),
                        padding: "10px 18px",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      {running && (
                        <span
                          style={{
                            display: "inline-block",
                            animation: "spin 1s linear infinite",
                          }}
                        >
                          ⟳
                        </span>
                      )}
                      <span>
                        {running
                          ? runningStatus || "Running analysis..."
                          : "Run System Test"}
                      </span>
                    </button>
                  </div>
                  {generateError && (
                    <div
                      style={{
                        margin: "14px auto 0",
                        padding: "10px 14px",
                        background: "rgba(248,113,113,0.1)",
                        border: "1px solid rgba(248,113,113,0.3)",
                        borderRadius: 8,
                        color: "#f87171",
                        fontSize: 12,
                        maxWidth: 500,
                      }}
                    >
                      ⚠ {generateError}
                    </div>
                  )}
                </div>
              ) : type === "system" &&
                systemSummary?.hasRun &&
                !systemSummary?.coverageAvailable ? (
                /* E2E Test Scenarios Table */
                <div style={{ overflowX: "auto" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(240px, 1.5fr) minmax(160px, 1fr) 112px 80px 80px",
                      minWidth: 760,
                      gap: 10,
                      padding: "10px 18px",
                      background: "rgba(255,255,255,0.02)",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#8b949e",
                      textTransform: "uppercase",
                    }}
                  >
                    <span>Test Scenario</span>
                    <span>Test File / Suite</span>
                    <span>Evidence</span>
                    <span style={{ textAlign: "right" }}>Duration</span>
                    <span style={{ textAlign: "center" }}>Status</span>
                  </div>

                  {systemSummary.scenarios &&
                  systemSummary.scenarios.length > 0 ? (
                    systemSummary.scenarios.map((sc, idx) => {
                      const isFlaky = sc.status === "flaky";
                      const isPassed = sc.status === "passed";
                      const scKey = sc.id || idx;
                      const isExpanded = expandedScenario === scKey;
                      const hasFailures =
                        sc.failureMessages && sc.failureMessages.length > 0;

                      return (
                        <div key={scKey}>
                          <div
                            onClick={() => {
                              if (hasFailures) {
                                setExpandedScenario(isExpanded ? null : scKey);
                              }
                            }}
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "minmax(240px, 1.5fr) minmax(160px, 1fr) 112px 80px 80px",
                              minWidth: 760,
                              gap: 10,
                              padding: "12px 18px",
                              alignItems: "center",
                              borderBottom: "1px solid rgba(255,255,255,.04)",
                              cursor: hasFailures ? "pointer" : "default",
                              background: isExpanded
                                ? "rgba(255,255,255,0.03)"
                                : "transparent",
                              transition: "background 0.15s ease",
                            }}
                            className="hover:bg-white/[0.02]"
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 9,
                              }}
                            >
                              <span
                                style={{
                                  color: isPassed
                                    ? "#22c55e"
                                    : isFlaky
                                      ? "#fbbf24"
                                      : "#f87171",
                                  fontWeight: 700,
                                }}
                              >
                                {isPassed ? "✓" : isFlaky ? "⚠" : "✗"}
                              </span>
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#f0f6fc",
                                }}
                              >
                                {sc.title}
                              </span>
                              {hasFailures && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    color: "#8b949e",
                                    background: "rgba(255,255,255,0.06)",
                                    padding: "1px 5px",
                                    borderRadius: 4,
                                  }}
                                >
                                  {isExpanded ? "▲ Hide error" : "▼ View error"}
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#8b949e",
                                fontFamily: "var(--font-mono)",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {sc.file || "E2E Spec"}
                            </div>
                            <div>
                              {sc.hasEvidence ? (
                                <SystemTestEvidence
                                  snapshotId={snapshotId}
                                  scenarioId={sc.id}
                                  title={sc.title}
                                />
                              ) : (
                                <span
                                  style={{ color: "#6e7681", fontSize: 12 }}
                                >
                                  Not captured
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                textAlign: "right",
                                fontSize: 12,
                                color: "#c9d1d9",
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              {sc.durationMs
                                ? `${Number(sc.durationMs).toFixed(0)}ms`
                                : "—"}
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
                                  padding: "2px 8px",
                                  borderRadius: 10,
                                  background: isPassed
                                    ? "rgba(34, 197, 94, 0.15)"
                                    : isFlaky
                                      ? "rgba(251, 191, 36, 0.15)"
                                      : "rgba(248, 113, 113, 0.15)",
                                  color: isPassed
                                    ? "#4ade80"
                                    : isFlaky
                                      ? "#fbbf24"
                                      : "#f87171",
                                  border: isPassed
                                    ? "1px solid rgba(34, 197, 94, 0.3)"
                                    : isFlaky
                                      ? "1px solid rgba(251, 191, 36, 0.3)"
                                      : "1px solid rgba(248, 113, 113, 0.3)",
                                }}
                              >
                                {isPassed
                                  ? "✓ PASS"
                                  : isFlaky
                                    ? "⚠ FLAKY"
                                    : "✗ FAIL"}
                              </span>
                            </div>
                          </div>
                          {isExpanded && hasFailures && (
                            <div
                              style={{
                                padding: "12px 18px",
                                background: "rgba(0,0,0,0.35)",
                                borderBottom:
                                  "1px solid rgba(255,255,255,0.06)",
                                fontFamily: "var(--font-mono)",
                                fontSize: 11,
                                color: "#fca5a5",
                                whiteSpace: "pre-wrap",
                                lineHeight: 1.5,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  marginBottom: 4,
                                  color: "#f87171",
                                }}
                              >
                                Failure details:
                              </div>
                              {sc.failureMessages.join("\n\n")}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(240px, 1.5fr) minmax(160px, 1fr) 112px 80px 80px",
                        minWidth: 760,
                        gap: 10,
                        padding: "14px 18px",
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#f0f6fc",
                        }}
                      >
                        {systemSummary.runner
                          ? `${systemSummary.runner.toUpperCase()} E2E Suite`
                          : "Playwright E2E Suite"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#8b949e",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {systemSummary.latestRun?.type || "PLAYWRIGHT"}
                      </div>
                      <div style={{ color: "#6e7681" }}>Not captured</div>
                      <div
                        style={{
                          textAlign: "right",
                          fontSize: 12,
                          color: "#c9d1d9",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {systemSummary.latestRun?.durationMs
                          ? `${Number(systemSummary.latestRun.durationMs).toFixed(0)}ms`
                          : "—"}
                      </div>
                      <div
                        style={{ display: "flex", justifyContent: "center" }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 10,
                            background:
                              systemSummary.failed === 0
                                ? "rgba(34, 197, 94, 0.15)"
                                : "rgba(248, 113, 113, 0.15)",
                            color:
                              systemSummary.failed === 0
                                ? "#4ade80"
                                : "#f87171",
                            border:
                              systemSummary.failed === 0
                                ? "1px solid rgba(34, 197, 94, 0.3)"
                                : "1px solid rgba(248, 113, 113, 0.3)",
                          }}
                        >
                          {systemSummary.failed === 0 ? "✓ PASS" : "✗ FAIL"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : displayFiles.length === 0 ? (
                <div
                  style={{
                    padding: 30,
                    textAlign: "center",
                    color: isLight ? "#64748b" : "#6e7681",
                  }}
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
                        background: isLight
                          ? "#f8fafc"
                          : "rgba(255,255,255,0.02)",
                        borderBottom: isLight
                          ? "1px solid #e2e8f0"
                          : "1px solid rgba(255,255,255,0.05)",
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
                              ? isLight
                                ? "#d97706"
                                : "#fbbf24"
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
                              ? isLight
                                ? "#6366f1"
                                : "#a78bfa"
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
                      const fileSuggestions =
                        inlineSuggestions[file.filePath] || [];
                      const isSuggesting =
                        loadingSuggestions[file.filePath] || false;
                      const lastApply =
                        applyResultsByFile[file.filePath] || null;
                      const progressStep =
                        applyProgressSteps[file.filePath] || "";

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
                              borderBottom: isLight
                                ? "1px solid #f1f5f9"
                                : "1px solid rgba(255,255,255,.04)",
                              transition: "background 0.15s ease",
                              background: isExpanded
                                ? isLight
                                  ? "#f8fafc"
                                  : "rgba(255,255,255,0.03)"
                                : "transparent",
                            }}
                            className={
                              isLight
                                ? "hover:bg-slate-50/80"
                                : "hover:bg-white/[0.02]"
                            }
                          >
                            {/* File Index */}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  fontFamily: "var(--font-mono, monospace)",
                                  color: isLight ? "#64748b" : "#94a3b8",
                                  background: isLight
                                    ? "#f1f5f9"
                                    : "rgba(255, 255, 255, 0.05)",
                                  border: isLight
                                    ? "1px solid #e2e8f0"
                                    : "1px solid rgba(255, 255, 255, 0.08)",
                                  borderRadius: 6,
                                  padding: "2px 6px",
                                  minWidth: 26,
                                  textAlign: "center",
                                }}
                              >
                                {(sourceFilePage - 1) * SOURCE_FILES_PER_PAGE +
                                  idx +
                                  1}
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
                                  color: isFull
                                    ? isLight
                                      ? "#16a34a"
                                      : "#22c55e"
                                    : isLight
                                      ? "#d97706"
                                      : "#eab308",
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
                                    ? isLight
                                      ? "#0f172a"
                                      : "#ffffff"
                                    : isLight
                                      ? "#1e293b"
                                      : "#c9d1d9",
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
                                    color: coverageColor(val),
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
                              {fileSuggestions.length > 0 && !isExpanded && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpandFile(file.filePath);
                                  }}
                                  style={{
                                    padding: "3px 6px",
                                    borderRadius: 5,
                                    background: isLight
                                      ? "#f5f3ff"
                                      : "rgba(168, 85, 247, 0.18)",
                                    border: isLight
                                      ? "1px solid #ddd6fe"
                                      : "1px solid rgba(168, 85, 247, 0.35)",
                                    color: isLight ? "#6d28d9" : "#d8b4fe",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 3,
                                  }}
                                  title="Click to view generated test suggestions"
                                >
                                  <Sparkles size={10} />
                                  <span>{fileSuggestions.length}</span>
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpandFile(file.filePath);
                                }}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 5,
                                  background: isExpanded
                                    ? isLight
                                      ? "#eff6ff"
                                      : "rgba(56, 189, 248, 0.18)"
                                    : isLight
                                      ? "#ffffff"
                                      : "rgba(255, 255, 255, 0.05)",
                                  border: isExpanded
                                    ? isLight
                                      ? "1px solid #93c5fd"
                                      : "1px solid rgba(56, 189, 248, 0.4)"
                                    : isLight
                                      ? "1px solid #cbd5e1"
                                      : "1px solid rgba(255, 255, 255, 0.1)",
                                  color: isExpanded
                                    ? isLight
                                      ? "#1d4ed8"
                                      : "#38bdf8"
                                    : isLight
                                      ? "#334155"
                                      : "#c9d1d9",
                                  fontSize: 11,
                                  fontWeight: isLight ? 600 : 400,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                                className={
                                  isLight
                                    ? "hover:bg-slate-100"
                                    : "hover:bg-white/10 hover:text-white"
                                }
                                title={
                                  isExpanded
                                    ? "Close view & edit"
                                    : "View coverage & edit code directly"
                                }
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
                                    ? isLight
                                      ? "#f1f5f9"
                                      : "rgba(255,255,255,0.14)"
                                    : isLight
                                      ? "#ffffff"
                                      : "rgba(255,255,255,0.04)",
                                  border: isLight
                                    ? "1px solid #cbd5e1"
                                    : "1px solid rgba(255,255,255,0.1)",
                                  color: isExpanded
                                    ? isLight
                                      ? "#0f172a"
                                      : "#ffffff"
                                    : isLight
                                      ? "#64748b"
                                      : "#8b949e",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "all 0.15s ease",
                                  flexShrink: 0,
                                }}
                                className={
                                  isLight
                                    ? "hover:bg-slate-100"
                                    : "hover:bg-white/10 hover:text-white"
                                }
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
                                background: isLight
                                  ? "#f8fafc"
                                  : "rgba(0, 0, 0, 0.4)",
                                borderBottom: isLight
                                  ? "1px solid #e2e8f0"
                                  : "1px solid rgba(255, 255, 255, 0.08)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 16,
                              }}
                            >
                              {/* Inline Suggestions Section (only for unit test, when not in FileCodeExecutionView) */}
                              {type === "unit" &&
                                (fileSuggestions.length > 0 || isSuggesting) &&
                                activeMetricView !== "statements" && (
                                  <InlineTestSuggestions
                                    filePath={file.filePath}
                                    suggestions={fileSuggestions}
                                    isLoading={isSuggesting}
                                    onApply={(sug) =>
                                      handleApplySuggestionInline(
                                        file.filePath,
                                        sug,
                                      )
                                    }
                                    onApplyAll={(sugs) =>
                                      handleApplyAllInline(file.filePath, sugs)
                                    }
                                    onReject={(sugId) =>
                                      handleRejectInline(file.filePath, sugId)
                                    }
                                    onDismiss={(fPath) =>
                                      handleDismissFileSuggestions(fPath)
                                    }
                                    onUpdateSuggestionCode={(sugId, newCode) =>
                                      handleUpdateSuggestionCode(
                                        file.filePath,
                                        sugId,
                                        newCode,
                                      )
                                    }
                                    applyingIds={applyingSuggestionIds}
                                    lastApplyResult={lastApply}
                                    progressStep={progressStep}
                                  />
                                )}

                              {isLoadingDetails ||
                              (!fileDetails && !cacheEntry?.error) ? (
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
                                  <Loader2
                                    size={16}
                                    className={`animate-spin ${isLight ? "text-indigo-600" : "text-purple-400"}`}
                                  />
                                  <span>
                                    Analyzing execution flow for{" "}
                                    {cleanDisplayPath(file.filePath)}...
                                  </span>
                                </div>
                              ) : fileDetails ? (
                                <>
                                  {Array.isArray(fileDetails.uncoverageDiagnostics?.items) &&
                                    fileDetails.uncoverageDiagnostics.items.length > 0 && (
                                      <div
                                        style={{
                                          padding: "10px 14px",
                                          borderRadius: 8,
                                          background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.08)",
                                          border: isLight
                                            ? "1px solid #fde68a"
                                            : "1px solid rgba(245, 158, 11, 0.25)",
                                          fontSize: 11.5,
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 6,
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontWeight: 750,
                                            color: isLight ? "#92400e" : "#fde68a",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                          }}
                                        >
                                          <AlertCircle size={13} />
                                          <span>
                                            Uncoverage Diagnostics ({fileDetails.uncoverageDiagnostics.items.length} unreached code elements)
                                          </span>
                                        </div>
                                        <div
                                          style={{
                                            maxHeight: 140,
                                            overflowY: "auto",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 4,
                                          }}
                                        >
                                          {fileDetails.uncoverageDiagnostics.items.slice(0, 8).map((diag, idx) => (
                                            <div
                                              key={idx}
                                              style={{
                                                fontSize: 11,
                                                color: isLight ? "#78350f" : "#fef3c7",
                                                display: "flex",
                                                alignItems: "baseline",
                                                gap: 6,
                                              }}
                                            >
                                              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                                                L{diag.line} [{diag.reasonCategory || "UNCOVERED"}]:
                                              </span>
                                              <span>{diag.reason}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  {activeMetricView === "branches" ? (
                                  <FileBranchCFGView
                                    filePath={file.filePath}
                                    fileCoverage={fileDetails}
                                    onOpenFile={handleOpenFileInPlace}
                                    onSuggestTestcase={(target) => {
                                      if (type === "unit") {
                                        handleSuggestTestcaseInline(
                                          target || file.filePath,
                                        );
                                      } else {
                                        onSuggestTestcase?.(
                                          target || file.filePath,
                                        );
                                      }
                                    }}
                                  />
                                ) : activeMetricView === "functions" ? (
                                  <FileFunctionCallGraphView
                                    filePath={file.filePath}
                                    fileCoverage={fileDetails}
                                    testSuites={testSuites}
                                    onOpenFile={handleOpenFileInPlace}
                                    onSuggestTestcase={(target) => {
                                      if (type === "unit") {
                                        handleSuggestTestcaseInline(
                                          target || file.filePath,
                                        );
                                      } else {
                                        onSuggestTestcase?.(
                                          target || file.filePath,
                                        );
                                      }
                                    }}
                                  />
                                ) : (
                                  <FileCodeExecutionView
                                    filePath={file.filePath}
                                    fileCoverage={fileDetails}
                                    projectId={projectId}
                                    snapshotId={snapshotId}
                                    onOpenFile={handleOpenFileInPlace}
                                    onFileSaved={async (savedPath) => {
                                      await ensureFileCoverage(savedPath, true);
                                      invalidateCoverageQueries(snapshotId);
                                      await refetchCoverage();
                                    }}
                                    onSuggestTestcase={(target) => {
                                      if (type === "unit") {
                                        handleSuggestTestcaseInline(
                                          target || file.filePath,
                                        );
                                      } else {
                                        onSuggestTestcase?.(
                                          target || file.filePath,
                                        );
                                      }
                                    }}
                                    suggestions={
                                      type === "unit" ? fileSuggestions : []
                                    }
                                    isLoadingSuggestions={
                                      type === "unit" ? isSuggesting : false
                                    }
                                    applyingSuggestionIds={
                                      type === "unit"
                                        ? applyingSuggestionIds
                                        : new Set()
                                    }
                                    onApplySuggestion={
                                      type === "unit"
                                        ? (sug) =>
                                            handleApplySuggestionInline(
                                              file.filePath,
                                              sug,
                                            )
                                        : undefined
                                    }
                                    onApplyAllSuggestions={
                                      type === "unit"
                                        ? (sugs) =>
                                            handleApplyAllInline(
                                              file.filePath,
                                              sugs,
                                            )
                                        : undefined
                                    }
                                    onRejectSuggestion={
                                      type === "unit"
                                        ? (sugId) =>
                                            handleRejectInline(
                                              file.filePath,
                                              sugId,
                                            )
                                        : undefined
                                    }
                                    onUpdateSuggestionCode={(sugId, newCode) =>
                                      handleUpdateSuggestionCode(
                                        file.filePath,
                                        sugId,
                                        newCode,
                                      )
                                    }
                                    lastApplyResult={lastApply}
                                    progressStep={progressStep}
                                    isLight={isLight}
                                  />
                                )}
                                </>
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
                                  <span>
                                    {cacheEntry?.error
                                      ? `Error: ${cacheEntry.error}`
                                      : "Failed to load flow analysis data for this file."}
                                  </span>
                                  <button
                                    onClick={() =>
                                      ensureFileCoverage(file.filePath, true)
                                    }
                                    style={{
                                      padding: "4px 10px",
                                      background: isLight
                                        ? "#fef2f2"
                                        : "rgba(239, 68, 68, 0.15)",
                                      border: isLight
                                        ? "1px solid #fecaca"
                                        : "1px solid rgba(239, 68, 68, 0.3)",
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
          snapshotId={snapshotId}
          onClose={() => {
            setShowCfgModal(false);
            setCfgModalContext(null);
          }}
          initialFile={cfgModalContext?.file}
          initialFunc={cfgModalContext?.func}
          initialLine={cfgModalContext?.line}
          onOpenFile={handleOpenFileInPlace}
        />
      )}

      {/* Unit Test Diff Review Modal (Monaco Side-by-Side Diff) */}
      {reviewModalOpen && (
        <DiffReviewModal
          isOpen={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          files={reviewFiles}
          error={error}
          initialFileIndex={reviewInitialFileIndex}
          applyResultsByFile={applyResultsByFile}
          isDryRunning={isDryRunningGlobal}
          onDryRunFile={async (file, currentSuggestion, customCode) => {
            if (file.reviewError) return;
            const fileSugs = file.suggestions?.length
              ? file.suggestions
              : currentSuggestion
                ? [currentSuggestion]
                : [];
            if (fileSugs.length > 0) {
              await handleDryRunInline(file.filePath, fileSugs, customCode);
            }
          }}
          onDryRunAll={handleDryRunAllGlobal}
          onApplyFile={async (file, currentSuggestion, customCode) => {
            if (file.reviewError) return;
            const fileSugs = file.suggestions?.length
              ? file.suggestions
              : currentSuggestion
                ? [currentSuggestion]
                : [];
            if (fileSugs.length > 0) {
              await handleApplyAllInline(
                file.filePath,
                fileSugs,
                file.testFilePath,
                customCode,
              );
            }
          }}
          onUndoFile={async (file) => {
            const path = cleanDisplayPath(file.testFilePath);
            const undo = reviewUndo[path];
            if (!undo) {
              setError("Undo is not available for this file yet.");
              return;
            }
            setError(null);
            try {
              const current = (
                await getFileContentApi(projectId, path, {
                  snapshotId,
                  forceFresh: true,
                })
              ).data;
              if (
                current.content !== undo.appliedContent ||
                current.version?.revision !== undo.version?.revision
              ) {
                throw new Error(
                  "The file changed after applying these suggestions. Review it before undoing.",
                );
              }
              const options = {
                snapshotId,
                expectedVersion: current.version,
                expectedWorkspaceRevision: current.workspaceRevision,
              };
              if (undo.previous)
                await updateFileContentApi(
                  projectId,
                  path,
                  undo.previous.content,
                  options,
                );
              else await deleteProjectEntryApi(projectId, path, options);
              setReviewUndo((previous) => {
                const next = { ...previous };
                delete next[path];
                return next;
              });
              setInlineSuggestions((previous) => ({
                ...previous,
                [file.filePath]: (previous[file.filePath] || []).map(
                  (suggestion) =>
                    file.suggestions.some(
                      (item) =>
                        (item.id || item.suggestionId) ===
                        (suggestion.id || suggestion.suggestionId),
                    )
                      ? {
                          ...suggestion,
                          status: "GENERATED",
                          applied: false,
                          testRunError: null,
                          proposalBase: undefined,
                        }
                      : suggestion,
                ),
              }));
              invalidateCoverageQueries(snapshotId);
            } catch (error) {
              console.error("Undo test suggestions failed:", error);
              setError(error.message || "Unable to undo the changes.");
            }
          }}
          onApplyAll={async () => {
            const unapplied = collectUnappliedReviewSuggestions(reviewFiles);
            if (unapplied.length > 0) {
              await handleApplyAllGlobal(unapplied);
            }
          }}
          onRunAnalysis={run}
          isApplying={isBulkApplying}
          applyingStep={bulkApplyStep}
        />
      )}

      {/* In-Place File & Code Viewer Modal (keeps user in Unit Test without redirect) */}
      {inPlaceOpenFileTarget && (
        <InPlaceCoverageFileModal
          isOpen={Boolean(inPlaceOpenFileTarget)}
          onClose={() => setInPlaceOpenFileTarget(null)}
          filePath={inPlaceOpenFileTarget.filePath}
          targetLine={inPlaceOpenFileTarget.targetLine}
          functionName={inPlaceOpenFileTarget.functionName}
          endLine={inPlaceOpenFileTarget.endLine}
          testInfo={inPlaceOpenFileTarget.testInfo}
          projectId={projectId}
          snapshotId={snapshotId}
          onOpenInExternalEditor={(fPath, line) => {
            setInPlaceOpenFileTarget(null);
            onOpenFile?.(fPath, line);
          }}
          isLight={isLight}
          testSuites={unitTestSuites}
          onOpenSimulation={(simTarget) => setSimulationTarget(simTarget)}
        />
      )}

      {/* Suggest TestCase Modal (Mode selection: AI vs Manual + Vitest vs Jest) */}
      {suggestModalConfig.isOpen && (
        <SuggestTestcaseModal
          isOpen={suggestModalConfig.isOpen}
          onClose={() =>
            setSuggestModalConfig((prev) => ({ ...prev, isOpen: false }))
          }
          targetFilePath={suggestModalConfig.filePath}
          targetFunction={suggestModalConfig.functionName}
          targetFunctionsList={functionsForTargetFile}
          allBusinessFiles={selectedFiles}
          allFunctions={functionsList}
          testSuites={unitTestSuites}
          defaultFramework={activeFramework || frameworks?.supported?.unit?.[0] || "jest"}
          onConfirmAi={handleConfirmAiSuggest}
          onApplyManualTest={handleConfirmManualApply}
          isApplying={isBulkApplying}
          isLight={isLight}
        />
      )}

      {/* Interactive Unit Test Execution Simulation Studio Modal */}
      {simulationTarget && (
        <UnitTestSimulationStudioModal
          isOpen={Boolean(simulationTarget)}
          onClose={() => setSimulationTarget(null)}
          snapshotId={snapshotId}
          projectId={projectId}
          availableSourceFiles={selectedFiles}
          availableFunctionsList={functionsList}
          availableTestSuites={unitTestSuites}
          initialSourceFile={simulationTarget.filePath || simulationTarget.sourceFilePath}
          initialTestFile={simulationTarget.testFilePath || simulationTarget.testFile}
          initialTestCaseId={simulationTarget.testCaseId || simulationTarget.testTitle}
          initialFunctionName={simulationTarget.functionName}
          initialTestCode={simulationTarget.testCode || simulationTarget.initialTestCode}
          initialCategory={simulationTarget.category || "HAPPY_PATH"}
          isLight={isLight}
        />
      )}

      {/* Unit Test Export Report Modal */}
      <ExportUnitTestReportModal
        isOpen={isUnitTestExportOpen}
        onClose={() => setIsUnitTestExportOpen(false)}
        data={{
          snapshotId,
          projectId,
          summary,
          rawTotals,
          executions,
          testTotals: totals,
          scenarios: summary?.scenarios || summary?.data?.scenarios || [],
        }}
      />
    </div>
  );
}
