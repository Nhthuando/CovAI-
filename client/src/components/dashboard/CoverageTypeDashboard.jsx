import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
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
} from "../../hooks/useCoverageQuery.js";
import { getJobDetailApi, cancelJobApi, getProjectJobsApi } from "../../services/job.service.js";
import { queryClient } from "../../lib/queryClient.js";
import { getProjectCfgApi } from "../../services/project.service.js";
import FunctionExecutionFlow from "./FunctionExecutionFlow.jsx";
import FileCodeExecutionView from "./FileCodeExecutionView.jsx";
import FileBranchCFGView from "./FileBranchCFGView.jsx";
import FileFunctionCallGraphView from "./FileFunctionCallGraphView.jsx";
import CFGCalculator from "./CFGCalculator.jsx";
import WaveProgressBar from "./WaveProgressBar.jsx";
import InlineTestSuggestions from "./InlineTestSuggestions.jsx";

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
    subtitle: "Testing APIs and data exchange between frontend, backend, and services.",
    supported: "Playwright · Supertest",
    accent: "#fbbf24",
    focus: ["API files", "Covered API files", "Average coverage", "Critical APIs"],
    explanation: [
      ["API contracts", "Requests, responses, status codes, and returned payload."],
      ["Frontend ↔ Backend", "API calls from interface to route/controller."],
      ["Service integration", "Controller, service, and database/dependency flow."],
    ],
  },
  system: {
    title: "System Test Coverage",
    subtitle: "E2E testing of complete features from a user perspective.",
    supported: "Playwright · Cypress",
    accent: "#ec4899",
    focus: ["E2E tests", "Passed", "Failed", "Feature coverage"],
    explanation: [
      ["User journeys", "Login, operation, and task completion user flows."],
      ["Browser behavior", "Interface, navigation, and browser interactions."],
      ["Full system", "Frontend, backend, and data operating together."],
    ],
  },
};

const pct = (value) => `${Number(value || 0).toFixed(1)}%`;
const coverageColor = (value) =>
  value >= 80 ? "#22c55e" : value >= 60 ? "#fbbf24" : "#f87171";
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
  let normalized = fullPath.replace(/\\/g, "/").replace(/^\.?\//, "");

  // Match inside docker or repo storage: storage/projects/<id>/.../repo/<relativePath>
  const repoMatch = normalized.match(/(?:^|\/)repo\/(.+)$/i);
  if (repoMatch) return repoMatch[1];

  const storageMatch = normalized.match(/(?:^|\/)storage\/projects\/[^/]+(?:\/[^/]+)*?\/(.+)$/i);
  if (storageMatch) return storageMatch[1];

  const uploadMatch = normalized.match(/(?:^|\/)uploads\/snapshots\/[^/]+(?:\/[^/]+)*?\/(.+)$/i);
  if (uploadMatch) return uploadMatch[1];

  return normalized;
};

export const resolveFunctionName = (fn, flowFunctions = []) => {
  if (fn?.realName && !fn.realName.startsWith("(") && !fn.realName.startsWith("anonymous")) {
    return fn.realName;
  }
  const raw = fn?.functionName || "";
  if (raw && !raw.startsWith("(") && !raw.startsWith("anonymous")) {
    return raw;
  }
  if (Array.isArray(flowFunctions)) {
    const matched = flowFunctions.find(
      (f) => f.startLine === fn.startLine || f.line === fn.startLine
    );
    if (matched?.realName && !matched.realName.startsWith("(") && !matched.realName.startsWith("anonymous")) {
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

  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runStep, setRunStep] = useState("");
  const [error, setError] = useState("");
  const [activeFramework, setActiveFramework] = useState("");
  const [generateError, setGenerateError] = useState("");

  // Mode view for Unit test: "testcases" (default for unit) | "all" | "statements" | "branches" | "functions"
  const [activeMetricView, setActiveMetricView] = useState(
    type === "unit" ? "testcases" : "all",
  );

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
  const [inlineSuggestions, setInlineSuggestions] = useState({});
  const [loadingSuggestions, setLoadingSuggestions] = useState({});
  const [applyingSuggestionIds, setApplyingSuggestionIds] = useState(new Set());
  const [applyResultsByFile, setApplyResultsByFile] = useState({});
  const [applyProgressSteps, setApplyProgressSteps] = useState({});

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

        setInlineSuggestions((prev) => ({
          ...prev,
          [filePath]: finalSugs.map((s, idx) => ({
            ...s,
            suggestionId: s.suggestionId || `${filePath}-sug-${idx + 1}`,
            status: s.status || "GENERATED",
          })),
        }));
      } catch (err) {
        console.error("Failed to generate test suggestions inline:", err);
      } finally {
        setLoadingSuggestions((prev) => ({ ...prev, [filePath]: false }));
      }
    },
    [snapshotId, projectId, activeFramework, ensureFileCoverage],
  );

  // Auto-fetch file coverage details for any expanded file if missing from cache
  useEffect(() => {
    expandedFiles.forEach((fPath) => {
      if (!fileCoverageCache[fPath]) {
        ensureFileCoverage(fPath);
      }
    });
  }, [expandedFiles, fileCoverageCache, ensureFileCoverage]);

  // Edit test code inline directly in dropdown
  const handleUpdateSuggestionCode = useCallback((filePath, sugId, newCode) => {
    setInlineSuggestions((prev) => {
      const fileSugs = prev[filePath] || [];
      return {
        ...prev,
        [filePath]: fileSugs.map((s) =>
          (s.suggestionId === sugId || s.id === sugId)
            ? { ...s, generatedCode: newCode, status: "EDITED" }
            : s,
        ),
      };
    });
  }, []);

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

        const oldCov = resultData?.previousCoverage || resultData?.oldCoverage;
        if (oldCov && resultData?.newCoverage) {
          setApplyResultsByFile((prev) => ({
            ...prev,
            [filePath]: {
              ...resultData,
              oldCoverage: oldCov,
              newCoverage: resultData.newCoverage,
            },
          }));
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

        const oldCov = resultData?.previousCoverage || resultData?.oldCoverage;
        if (oldCov && resultData?.newCoverage) {
          setApplyResultsByFile((prev) => ({
            ...prev,
            [filePath]: {
              ...resultData,
              oldCoverage: oldCov,
              newCoverage: resultData.newCoverage,
            },
          }));
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

  // Test suites & functions search and filter state
  const [expandedSuite, setExpandedSuite] = useState(null);
  const [testSuiteSearch, setTestSuiteSearch] = useState("");
  const [functionSearch, setFunctionSearch] = useState("");
  const [functionStatusFilter, setFunctionStatusFilter] = useState("all");

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
    setRunStep("Khởi động môi trường phân tích kiểm thử...");
    setError("");
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
      const fw = response.data?.framework || (type === "unit" ? "jest & vitest" : "");
      setActiveFramework(fw);
      const jobs = response.data?.jobs || (response.data?.job ? [response.data.job] : []);
      if (jobs.length === 0) throw new Error("Backend không trả về job chạy kiểm thử.");
      for (const j of jobs) {
        if (j?.id) {
          await waitForJob(j.id, (prog) => {
            setRunProgress(prog);
            if (prog <= 20) {
              setRunStep("Đang chuẩn bị dependencies & môi trường Docker...");
            } else if (prog <= 45) {
              setRunStep("Đang chạy Jest unit test suites & sinh coverage...");
            } else if (prog <= 65) {
              setRunStep("Đang chạy Vitest unit test suites & sinh coverage...");
            } else if (prog <= 85) {
              setRunStep("Hợp nhất báo cáo coverage đa khung & phân tích AST functions...");
            } else if (prog < 100) {
              setRunStep("Lưu trữ kết quả phân tích & đồng bộ dữ liệu...");
            } else {
              setRunStep("Hoàn thành phân tích kiểm thử!");
            }
          });
        }
      }
      setRunProgress(100);
      setRunStep("Hoàn thành phân tích thành công!");
      invalidateCoverageQueries(snapshotId);
      await refetchCoverage();
    } catch (runError) {
      setError(runError.message || "Quá trình phân tích thất bại.");
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
    const parsedCov = covVal != null && covVal !== "" ? Number(covVal) : null;
    if (parsedCov !== null && !isNaN(parsedCov) && parsedCov > 0) {
      return parsedCov;
    }
    if (rawMetric) {
      if (rawMetric.pct != null && !isNaN(Number(rawMetric.pct))) {
        return Number(rawMetric.pct);
      }
      if (rawMetric.total && rawMetric.total > 0) {
        return (Number(rawMetric.covered || 0) / Number(rawMetric.total)) * 100;
      }
    }
    return parsedCov || 0;
  };

  const statPct = getPctVal(cov.statements, rawTotals?.statements);
  const branchPct = getPctVal(cov.branches, rawTotals?.branches);
  const funcPct = getPctVal(cov.functions, rawTotals?.functions);
  const linePct = getPctVal(cov.lines, rawTotals?.lines);

  const selectedFiles = useMemo(() => {
    let nonTestFiles = files.filter((f) => !isTestFile(f.filePath));
    if (type === "unit") {
      nonTestFiles = nonTestFiles.filter((f) => !isFrontendFile(f.filePath));
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
        setBulkSuggestMessage("Tất cả các file mã nguồn đã đạt 100% độ bao phủ kiểm thử!");
        setTimeout(() => setBulkSuggestMessage(""), 5000);
        return;
      }

      setIsBulkSuggesting(true);
      setBulkSuggestMessage(`Đang tạo gợi ý test inline cho ${needImprovementFiles.length} file...`);

      // Expand all files that need improvement simultaneously so user can review all at once
      setExpandedFiles(new Set(needImprovementFiles.map((f) => f.filePath)));
      needImprovementFiles.forEach((f) => ensureFileCoverage(f.filePath));

      try {
        // Sequentially / concurrently fetch inline suggestions for each file
        await Promise.all(
          needImprovementFiles.map((f) => handleSuggestTestcaseInline(f.filePath))
        );
        setBulkSuggestMessage(`✓ Đã sinh gợi ý test trực tiếp bên dưới ${needImprovementFiles.length} file. Bạn có thể sửa code và bấm Apply ngay trong dropdown.`);
      } catch (err) {
        console.error("Bulk inline suggest failed:", err);
        setBulkSuggestMessage(`Lỗi sinh testcase: ${err.message}`);
      } finally {
        setIsBulkSuggesting(false);
        setTimeout(() => setBulkSuggestMessage(""), 8000);
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

  const isLatestRunFailed = summary?.latestRunStatus === "failed" || coverageData?.latestRunStatus === "failed";
  const hasPartialFailures = summary?.latestRunStatus === "passed_with_failures" || coverageData?.latestRunStatus === "passed_with_failures" || summary?.hasTestFailures;
  const lastSuccessfulCov = summary?.lastSuccessfulCoverage || coverageData?.lastSuccessfulCoverage;
  const latestRunErr = summary?.latestRunError || coverageData?.latestRunError;
  const failedSuiteName = summary?.failedSuite || coverageData?.failedSuite;

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
        color: "#e6edf3",
        background: "#0d1117",
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
          <h1 style={{ margin: 0, fontSize: 27 }}>{config.title}</h1>
          <p style={{ color: "#8b949e", fontSize: 13, margin: "7px 0 0" }}>
            {config.subtitle}
          </p>
          <div style={{ color: "#6e7681", fontSize: 12, marginTop: 7 }}>
            Supported:{" "}
            <span style={{ color: config.accent }}>{config.supported}</span>
            {frameworks && (
              <span>
                {" "}
                · Detected:{" "}
                <b style={{ color: "#c9d1d9" }}>
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
        </div>
        <div style={{ display: "flex", gap: 9 }}>
          {onGenerate && (
            <button
              onClick={async () => {
                setGenerateError("");
                try { await onGenerate(type); }
                catch (err) { setGenerateError(err.message || "Generation failed."); }
              }}
              disabled={loading || running || generating}
              style={buttonStyle("#67e8f9")}
            >
              {generating ? "Generating..." : "Generate AI Tests"}
            </button>
          )}
          <button
            onClick={handleBulkSuggestTest}
            disabled={loading || running || isBulkSuggesting}
            style={{
              ...buttonStyle("#d8b4fe"),
              background: "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(99,102,241,0.25))",
              border: "1px solid rgba(168,85,247,0.5)",
              color: "#d8b4fe",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 600,
              cursor: isBulkSuggesting ? "wait" : "pointer",
            }}
            title="Gợi ý testcase AI cho toàn bộ các file chưa đạt 100% coverage trực tiếp dưới các file"
          >
            <Sparkles size={14} className="text-purple-400" />
            <span>{isBulkSuggesting ? "Generating inline tests..." : "Suggest test"}</span>
          </button>
          <button
            onClick={async () => {
              invalidateCoverageQueries(snapshotId);
              await refetchCoverage();
            }}
            disabled={loading || running}
            style={buttonStyle("#8b949e")}
          >
            Refresh
          </button>
          <button
            onClick={run}
            disabled={!snapshotId || running}
            style={buttonStyle(config.accent)}
          >
            {running ? `Running (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)...` : "Run Analysis"}
          </button>
        </div>
      </div>

      {bulkSuggestMessage && (
        <div
          style={{
            padding: "10px 16px",
            marginBottom: 16,
            borderRadius: 8,
            background: "rgba(168, 85, 247, 0.12)",
            border: "1px solid rgba(168, 85, 247, 0.35)",
            color: "#d8b4fe",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Sparkles size={16} />
          <span>{bulkSuggestMessage}</span>
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
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>❌</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fca5a5" }}>
                Test execution failed for current run
              </div>
              <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>
                Coverage: <span style={{ color: "#ef4444", fontWeight: 600 }}>Unavailable for current run</span> (Không tính kết quả của run bị fail)
              </div>
            </div>
          </div>

          {failedSuiteName && (
            <div style={{ fontSize: 12, color: "#e2e8f0" }}>
              <span style={{ color: "#94a3b8" }}>Failed Suite: </span>
              <code style={{ background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: 4, color: "#f87171" }}>
                {failedSuiteName}
              </code>
            </div>
          )}

          {latestRunErr && (
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                background: "rgba(0, 0, 0, 0.5)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                padding: "10px 14px",
                borderRadius: 6,
                color: "#fca5a5",
                whiteSpace: "pre-wrap",
                maxHeight: 140,
                overflowY: "auto",
              }}
            >
              {latestRunErr}
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
                background: "rgba(255, 255, 255, 0.04)",
                borderRadius: 6,
                border: "1px dashed rgba(255, 255, 255, 0.2)",
                color: "#94a3b8",
              }}
            >
              <span style={{ fontWeight: 600, color: "#e2e8f0" }}>
                ℹ️ Hiển thị kết quả lần chạy thành công trước đó (kết quả cũ):
              </span>
              <span>
                Statements: <b style={{ color: "#cbd5e1" }}>{lastSuccessfulCov.statements || lastSuccessfulCov.lines || 0}%</b>
              </span>
              <span>
                Branches: <b style={{ color: "#cbd5e1" }}>{lastSuccessfulCov.branches || 0}%</b>
              </span>
              <span>
                Functions: <b style={{ color: "#cbd5e1" }}>{lastSuccessfulCov.functions || 0}%</b>
              </span>
              <span>
                Lines: <b style={{ color: "#cbd5e1" }}>{lastSuccessfulCov.lines || 0}%</b>
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
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fcd34d" }}>
                Coverage được đo lường thực tế từ lần chạy hiện tại (có một số test assertion không đạt)
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                Các file dưới đây hiển thị % code coverage chính xác dựa trên các test case đã chạy thực tế.
              </div>
            </div>
          </div>
          {failedSuiteName && (
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>
              <span style={{ color: "#94a3b8" }}>Suite có test không đạt: </span>
              <code style={{ background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: 4, color: "#fcd34d" }}>
                {failedSuiteName}
              </code>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8b949e", padding: 40, textAlign: "center" }}>
          Loading coverage analysis...
        </div>
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
            {config.focus.map((label, i) => (
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
                    Last successful: <b style={{ color: "#cbd5e1" }}>{pct(lastSuccessfulValues[i])}</b> (cũ)
                  </div>
                )}
              </div>
            ))}
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
            {type === "unit" ? (
              [
                {
                  key: "statements",
                  title: "Statement coverage",
                  description: "Percentage of statements executed by tests.",
                  pctValue: statPct,
                  raw: rawTotals?.statements,
                  icon: FileCode,
                  accentColor: "#a78bfa",
                },
                {
                  key: "branches",
                  title: "Branch coverage",
                  description: "Percentage of if/else/switch condition paths executed.",
                  pctValue: branchPct,
                  raw: rawTotals?.branches,
                  icon: GitBranch,
                  accentColor: "#fbbf24",
                },
                {
                  key: "functions",
                  title: "Function coverage",
                  description: "Percentage of functions or methods executed.",
                  pctValue: funcPct,
                  raw: rawTotals?.functions,
                  icon: Cpu,
                  accentColor: "#38bdf8",
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
                      ...cardStyle,
                      cursor: "pointer",
                      borderColor: isActive
                        ? item.accentColor
                        : "rgba(255,255,255,0.08)",
                      background: isActive
                        ? `${item.accentColor}12`
                        : "rgba(255,255,255,0.025)",
                      boxShadow: isActive
                        ? `0 0 16px ${item.accentColor}25`
                        : "none",
                      transition: "all 0.2s ease",
                    }}
                    className="hover:border-white/20 transition-all"
                    title={`Click to view details for ${item.title}`}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          color: item.accentColor,
                          fontWeight: 650,
                          fontSize: 14,
                        }}
                      >
                        <Icon size={16} />
                        <span>{item.title}</span>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 12,
                          background: isActive
                            ? `${item.accentColor}30`
                            : "rgba(255,255,255,0.06)",
                          color: isActive ? item.accentColor : "#8b949e",
                        }}
                      >
                        {isActive ? "Selected" : "Details →"}
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
                          fontSize: 24,
                          fontWeight: 750,
                          color: coverageColor(pctNum),
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {pct(pctNum)}
                      </span>
                      {item.raw?.total ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: "#8b949e",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          ({item.raw.covered}/{item.raw.total})
                        </span>
                      ) : null}
                    </div>

                    {/* Progress Bar */}
                    <div
                      style={{
                        width: "100%",
                        height: 4,
                        background: "rgba(255,255,255,0.08)",
                        borderRadius: 2,
                        marginTop: 8,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, pctNum))}%`,
                          height: "100%",
                          background: coverageColor(pctNum),
                          borderRadius: 2,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>

                    <div
                      style={{
                        color: "#8b949e",
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
            ) : (
              config.explanation.map(([title, text]) => (
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
              ))
            )}
          </div>

          {/* Mode Navigation Tabs (Unit Test Coverage) */}
          {type === "unit" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 20,
                overflowX: "auto",
                paddingBottom: 4,
              }}
            >
              {[
                {
                  id: "testcases",
                  label: `File Testcase (Jest / Vitest) (${unitTestSuites.length})`,
                  icon: FlaskConical,
                  accent: "#c084fc",
                },
                {
                  id: "all",
                  label: `Source file coverage (${selectedFiles.length})`,
                  icon: ListChecks,
                },
                {
                  id: "statements",
                  label: `Statement coverage (${pct(statPct)})`,
                  icon: FileCode,
                  accent: "#a78bfa",
                },
                {
                  id: "branches",
                  label: `Branch coverage (${pct(branchPct)})`,
                  icon: GitBranch,
                  accent: "#fbbf24",
                },
                {
                  id: "functions",
                  label: `Function coverage (${pct(funcPct)})`,
                  icon: Cpu,
                  accent: "#38bdf8",
                },
              ].map((tab) => {
                const isCurrent = activeMetricView === tab.id;
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveMetricView(tab.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 15px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: isCurrent
                        ? tab.accent
                          ? `${tab.accent}25`
                          : "rgba(255,255,255,0.15)"
                        : "rgba(255,255,255,0.03)",
                      color: isCurrent
                        ? tab.accent || "#ffffff"
                        : "#8b949e",
                      border: isCurrent
                        ? `1px solid ${tab.accent || "rgba(255,255,255,0.3)"}`
                        : "1px solid rgba(255,255,255,0.06)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {TabIcon && <TabIcon size={14} />}
                    <span>{tab.label}</span>
                  </button>
                );
              })}

              {activeMetricView !== "testcases" && (
                <button
                  onClick={() => setActiveMetricView("testcases")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 10px",
                    borderRadius: 20,
                    fontSize: 11,
                    color: "#c084fc",
                    background: "rgba(192, 132, 252, 0.1)",
                    border: "1px solid rgba(192, 132, 252, 0.2)",
                    cursor: "pointer",
                    marginLeft: "auto",
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
                background:
                  activeMetricView === "testcases"
                    ? "rgba(192, 132, 252, 0.08)"
                    : activeMetricView === "statements"
                      ? "rgba(167, 139, 250, 0.08)"
                      : activeMetricView === "branches"
                        ? "rgba(251, 191, 36, 0.08)"
                        : activeMetricView === "functions"
                          ? "rgba(56, 189, 248, 0.08)"
                          : "rgba(255, 255, 255, 0.04)",
                border:
                  activeMetricView === "testcases"
                    ? "1px solid rgba(192, 132, 252, 0.25)"
                    : activeMetricView === "statements"
                      ? "1px solid rgba(167, 139, 250, 0.25)"
                      : activeMetricView === "branches"
                        ? "1px solid rgba(251, 191, 36, 0.25)"
                        : activeMetricView === "functions"
                          ? "1px solid rgba(56, 189, 248, 0.25)"
                          : "1px solid rgba(255, 255, 255, 0.08)",
                color:
                  activeMetricView === "testcases"
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
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
                {activeMetricView === "testcases" ? (
                  <>
                    <FlaskConical size={15} style={{ flexShrink: 0, color: "#c084fc" }} />
                    <span>
                      <b>Unit Testcase Files:</b> List of test suite files from <b>Jest</b> and <b>Vitest</b>. Playwright, Cypress, and Supertest files are automatically filtered out from Unit Test scope.
                    </span>
                  </>
                ) : activeMetricView === "statements" ? (
                  <>
                    <FileCode size={15} style={{ flexShrink: 0, color: "#a78bfa" }} />
                    <span>
                      <b>Statement Coverage:</b> Percentage breakdown of source code statements executed during unit tests.
                    </span>
                  </>
                ) : activeMetricView === "branches" ? (
                  <>
                    <GitBranch size={15} style={{ flexShrink: 0, color: "#fbbf24" }} />
                    <span>
                      <b>Branch Coverage:</b> Percentage breakdown of conditional branch paths (if/else, switch, ternary) tested across all directions.
                    </span>
                  </>
                ) : activeMetricView === "functions" ? (
                  <>
                    <Cpu size={15} style={{ flexShrink: 0, color: "#38bdf8" }} />
                    <span>
                      <b>Function Coverage:</b> Identified functions and methods with actual names, execution hit counts, and CFG integration.
                    </span>
                  </>
                ) : (
                  <>
                    <ListChecks size={15} style={{ flexShrink: 0 }} />
                    <span>
                      <b>Source File Coverage:</b> Comprehensive coverage summary of source code files under test (Lines, Branches, Functions, Statements).
                    </span>
                  </>
                )}
              </div>

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
                      background: functionViewMode === "map" ? "#38bdf8" : "rgba(255,255,255,0.06)",
                      color: functionViewMode === "map" ? "#0d1117" : "#bae6fd",
                      border: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
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
                      background: functionViewMode === "table" ? "#38bdf8" : "rgba(255,255,255,0.06)",
                      color: functionViewMode === "table" ? "#0d1117" : "#bae6fd",
                      border: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
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
          {type === "unit" && activeMetricView === "testcases" ? (
            /* ── A. Unit Testcase Files Table (Jest / Vitest only) ───── */
            <div
              style={{
                ...cardStyle,
                marginTop: 14,
                padding: 0,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  fontWeight: 700,
                  borderBottom: "1px solid rgba(255,255,255,.07)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FlaskConical size={16} style={{ color: "#c084fc" }} />
                  <span>File Testcase (Jest & Vitest)</span>
                  <span
                    style={{ fontSize: 11, color: "#8b949e", fontWeight: 400 }}
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
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                    }}
                  >
                    <Search size={13} style={{ color: "#8b949e" }} />
                    <input
                      type="text"
                      placeholder="Search testcase files..."
                      value={testSuiteSearch}
                      onChange={(e) => setTestSuiteSearch(e.target.value)}
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: "#e6edf3",
                        fontSize: 12,
                        width: 150,
                      }}
                    />
                  </div>
                </div>
              </div>

              {loadingTestSuites ? (
                <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>
                  Loading test case files list...
                </div>
              ) : filteredTestSuites.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>
                  No Jest or Vitest test case files found. Click "Run Analysis" to run and analyze.
                </div>
              ) : (
                <div>
                  {/* Table Header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(220px, 1.4fr) 100px 120px 90px 105px 110px",
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
                    <span>File Testcase</span>
                    <span style={{ textAlign: "center" }}>Framework</span>
                    <span style={{ textAlign: "right" }}>Test Cases</span>
                    <span style={{ textAlign: "right" }}>Duration</span>
                    <span style={{ textAlign: "center" }}>Status</span>
                    <span style={{ textAlign: "center" }}>Actions</span>
                  </div>

                  {/* Rows */}
                  {filteredTestSuites.map((suite) => {
                    const isPassed = suite.status === "passed" && suite.failedTests === 0;
                    const isExpanded = expandedSuite === suite.filePath;

                    return (
                      <div key={suite.filePath}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "minmax(220px, 1.4fr) 100px 120px 90px 105px 110px",
                            gap: 10,
                            padding: "12px 18px",
                            alignItems: "center",
                            borderBottom: "1px solid rgba(255,255,255,.04)",
                            transition: "background 0.15s ease",
                            background: isExpanded
                              ? "rgba(192, 132, 252, 0.04)"
                              : "transparent",
                          }}
                          className="hover:bg-white/[0.02]"
                        >
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
                                    ? "#38bdf8"
                                    : "#c084fc",
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
                                      color: "#e6edf3",
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
                                  <span style={{ color: "#8b949e", marginRight: 5 }}>{dir} /</span>
                                  <span style={{ color: "#e6edf3", fontWeight: 600 }}>{file}</span>
                                </span>
                              );
                            })()}
                          </div>

                          {/* Framework Badge */}
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 6,
                                background:
                                  suite.framework === "vitest"
                                    ? "rgba(56, 189, 248, 0.15)"
                                    : "rgba(192, 132, 252, 0.15)",
                                color:
                                  suite.framework === "vitest"
                                    ? "#38bdf8"
                                    : "#c084fc",
                                border:
                                  suite.framework === "vitest"
                                    ? "1px solid rgba(56, 189, 248, 0.35)"
                                    : "1px solid rgba(192, 132, 252, 0.35)",
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
                            <span style={{ color: "#4ade80", fontWeight: 600 }}>
                              ✓ {suite.passedTests || 0}
                            </span>
                            {suite.failedTests > 0 && (
                              <span
                                style={{
                                  color: "#f87171",
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
                              color: "#8b949e",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {suite.durationMs ? `${suite.durationMs}ms` : "—"}
                          </div>

                          {/* Status */}
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 10,
                                background: isPassed
                                  ? "rgba(34, 197, 94, 0.15)"
                                  : suite.status === "pending"
                                    ? "rgba(234, 179, 8, 0.15)"
                                    : "rgba(239, 68, 68, 0.15)",
                                color: isPassed ? "#4ade80" : suite.status === "pending" ? "#fde047" : "#fca5a5",
                                border: isPassed
                                  ? "1px solid rgba(34, 197, 94, 0.3)"
                                  : suite.status === "pending"
                                    ? "1px solid rgba(234, 179, 8, 0.3)"
                                    : "1px solid rgba(239, 68, 68, 0.3)",
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
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: "#c9d1d9",
                                fontSize: 11,
                                cursor: "pointer",
                              }}
                              title="Open test file in editor"
                            >
                              Open test
                            </button>

                            {(suite.assertions && suite.assertions.length > 0 || suite.message) && (
                              <button
                                onClick={() =>
                                  setExpandedSuite(
                                    isExpanded ? null : suite.filePath,
                                  )
                                }
                                style={{
                                  padding: "4px 6px",
                                  borderRadius: 5,
                                  background: "rgba(255,255,255,0.03)",
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  color: "#8b949e",
                                  fontSize: 11,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                }}
                                title={suite.message ? "View error details" : "View inner test cases list"}
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
                              background: "rgba(0,0,0,0.25)",
                              padding: "10px 24px",
                              borderBottom: "1px solid rgba(255,255,255,.05)",
                            }}
                          >
                            {/* Error message banner */}
                            {suite.message && (
                              <div style={{
                                background: "rgba(239,68,68,0.08)",
                                border: "1px solid rgba(239,68,68,0.25)",
                                borderRadius: 6,
                                padding: "8px 12px",
                                marginBottom: suite.assertions?.length > 0 ? 10 : 0,
                                fontSize: 11,
                                fontFamily: "var(--font-mono)",
                                color: "#fca5a5",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                maxHeight: 200,
                                overflowY: "auto",
                              }}>
                                <span style={{ fontWeight: 700, display: "block", marginBottom: 4, color: "#f87171" }}>
                                  ⚠ Error Detail:
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
                                    color: "#8b949e",
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
                                          padding: "3px 0",
                                          borderBottom: "1px dashed rgba(255,255,255,0.03)",
                                        }}
                                      >
                                        {testCase.status === "passed" ? (
                                          <Check size={13} style={{ color: "#4ade80", flexShrink: 0 }} />
                                        ) : (
                                          <X size={13} style={{ color: "#f87171", flexShrink: 0 }} />
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
                                              background: "rgba(59, 130, 246, 0.16)",
                                              color: "#60a5fa",
                                              border: "1px solid rgba(59, 130, 246, 0.35)",
                                              whiteSpace: "nowrap",
                                              flexShrink: 0,
                                              letterSpacing: "0.2px",
                                            }}
                                            title={`Target function: ${targetFn}`}
                                          >
                                            <span style={{ color: "#93c5fd", opacity: 0.8 }}>ƒ</span>
                                            {targetFn}
                                          </span>
                                        )}
                                        <span
                                          style={{
                                            color:
                                              testCase.status === "passed"
                                                ? "#c9d1d9"
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
                                              color: "#6e7681",
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
                }}
              >
                <div
                  style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    borderBottom: "1px solid rgba(255,255,255,.07)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Cpu size={16} style={{ color: "#38bdf8" }} />
                    <span>Function Coverage Breakdown</span>
                    <span
                      style={{ fontSize: 11, color: "#8b949e", fontWeight: 400 }}
                    >
                      ({filteredFunctions.length} functions)
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 12,
                      }}
                    >
                      <Search size={13} style={{ color: "#8b949e" }} />
                      <input
                        type="text"
                        placeholder="Search function or file..."
                        value={functionSearch}
                        onChange={(e) => setFunctionSearch(e.target.value)}
                        style={{
                          background: "transparent",
                          border: "none",
                          outline: "none",
                          color: "#e6edf3",
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
                            padding: "3px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                            background:
                              functionStatusFilter === st.id
                                ? "rgba(56, 189, 248, 0.2)"
                                : "rgba(255,255,255,0.03)",
                            color:
                              functionStatusFilter === st.id
                                ? "#38bdf8"
                                : "#8b949e",
                            border:
                              functionStatusFilter === st.id
                                ? "1px solid rgba(56, 189, 248, 0.4)"
                                : "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {loadingFunctions ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>
                    Loading functions list...
                  </div>
                ) : filteredFunctions.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>
                    {functionsList.length === 0
                      ? "No function data available. Click 'Run Analysis' to analyze Jest/Vitest."
                      : "No matching functions found for the filter."}
                  </div>
                ) : (
                  <div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(200px, 1.2fr) minmax(220px, 1.5fr) 90px 110px 100px 160px",
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
                      <span>Function Name</span>
                      <span>Source File</span>
                      <span>Location</span>
                      <span style={{ textAlign: "right" }}>Call Count</span>
                      <span style={{ textAlign: "center" }}>Status</span>
                      <span style={{ textAlign: "center" }}>Actions</span>
                    </div>

                    {filteredFunctions.slice(0, 100).map((fn) => {
                      const isCovered = fn.hit > 0;
                      return (
                        <div
                          key={fn.id || `${fn.filePath}:${fn.functionName}:${fn.startLine}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "minmax(200px, 1.2fr) minmax(220px, 1.5fr) 90px 110px 100px 160px",
                            gap: 10,
                            padding: "10px 18px",
                            alignItems: "center",
                            borderBottom: "1px solid rgba(255,255,255,.04)",
                            transition: "background 0.15s ease",
                          }}
                          className="hover:bg-white/[0.02]"
                        >
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
                                color: isCovered ? "#38bdf8" : "#fbbf24",
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 13,
                                color: isCovered ? "#e6edf3" : "#fde68a",
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
                              color: "#8b949e",
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
                              color: "#8b949e",
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
                              color: isCovered ? "#22c55e" : "#fbbf24",
                            }}
                          >
                            {isCovered ? `${fn.hit} hits` : "0 hits"}
                          </div>

                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 10,
                                background: isCovered
                                  ? "rgba(34, 197, 94, 0.15)"
                                  : "rgba(251, 191, 36, 0.15)",
                                color: isCovered ? "#4ade80" : "#fde047",
                                border: isCovered
                                  ? "1px solid rgba(34, 197, 94, 0.3)"
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
                              onClick={() => onOpenFile?.(fn.filePath)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: "#c9d1d9",
                                fontSize: 11,
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
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  fontWeight: 700,
                  borderBottom: "1px solid rgba(255,255,255,.07)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
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
                  <span
                    style={{ fontSize: 11, color: "#8b949e", fontWeight: 400 }}
                  >
                    {displayFiles.length} files analyzed
                  </span>
                </div>
              </div>

              {displayFiles.length === 0 ? (
                <div
                  style={{ padding: 30, textAlign: "center", color: "#6e7681" }}
                >
                  No data available. Click Run Analysis to start.
                </div>
              ) : (
                <div>
                  {/* Table Header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(240px, 1fr) repeat(4, 75px) 115px",
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
                    <span>Source File</span>
                    <span style={{ textAlign: "right" }}>Lines</span>
                    <span
                      style={{
                        textAlign: "right",
                        color:
                          activeMetricView === "branches"
                            ? "#fbbf24"
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
                            ? "#a78bfa"
                            : undefined,
                      }}
                    >
                      Stmts
                    </span>
                    <span style={{ textAlign: "center" }}>Actions</span>
                  </div>

                  {/* Table Rows */}
                  {displayFiles.slice(0, 50).map((file) => {
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
                              "minmax(240px, 1fr) repeat(4, 75px) 115px",
                            gap: 10,
                            padding: "10px 18px",
                            alignItems: "center",
                            borderBottom: "1px solid rgba(255,255,255,.04)",
                            transition: "background 0.15s ease",
                            background: isExpanded
                              ? "rgba(255,255,255,0.03)"
                              : "transparent",
                          }}
                          className="hover:bg-white/[0.02]"
                        >
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
                                color: isFull ? "#22c55e" : "#eab308",
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
                                color: isExpanded ? "#ffffff" : "#c9d1d9",
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
                                    ? col === "stmts"
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

                          {/* Action: Inline Suggest Test, Open Code & Expand Toggle */}
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
                                handleSuggestTestcaseInline(file.filePath);
                              }}
                              disabled={isSuggesting}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: "rgba(168, 85, 247, 0.15)",
                                border: "1px solid rgba(168, 85, 247, 0.35)",
                                color: "#d8b4fe",
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: isSuggesting ? "wait" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                transition: "all 0.15s ease",
                              }}
                              className="hover:bg-purple-500/25 hover:text-white"
                              title="Tạo gợi ý test case AI inline cho file này"
                            >
                              <Sparkles size={11} />
                              Suggest
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandFile(file.filePath);
                              }}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: isExpanded
                                  ? "rgba(56, 189, 248, 0.18)"
                                  : "rgba(255, 255, 255, 0.05)",
                                border: isExpanded
                                  ? "1px solid rgba(56, 189, 248, 0.4)"
                                  : "1px solid rgba(255, 255, 255, 0.1)",
                                color: isExpanded ? "#38bdf8" : "#c9d1d9",
                                fontSize: 11,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                              className="hover:bg-white/10 hover:text-white"
                              title={isExpanded ? "Đóng xem & sửa code" : "Xem độ bao phủ & sửa code trực tiếp"}
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
                                  ? "rgba(255,255,255,0.14)"
                                  : "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: isExpanded ? "#ffffff" : "#8b949e",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transition: "all 0.15s ease",
                                flexShrink: 0,
                              }}
                              className="hover:bg-white/10 hover:text-white"
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
                              background: "rgba(0, 0, 0, 0.4)",
                              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 16,
                            }}
                          >
                            {/* Inline Suggestions Section */}
                            {(fileSuggestions.length > 0 || isSuggesting) && (
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
                                  color: "#8b949e",
                                  fontSize: 12,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 8,
                                }}
                              >
                                <Loader2 size={16} className="animate-spin text-purple-400" />
                                <span>Analyzing execution flow for {cleanDisplayPath(file.filePath)}...</span>
                              </div>
                            ) : fileDetails ? (
                              activeMetricView === "branches" ? (
                                <FileBranchCFGView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  onOpenFile={onOpenFile}
                                  onSuggestTestcase={() => handleSuggestTestcaseInline(file.filePath)}
                                />
                              ) : activeMetricView === "functions" ? (
                                <FileFunctionCallGraphView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  testSuites={testSuites}
                                  onOpenFile={onOpenFile}
                                  onSuggestTestcase={() => handleSuggestTestcaseInline(file.filePath)}
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
                                  onSuggestTestcase={() => handleSuggestTestcaseInline(file.filePath)}
                                />
                              )
                            ) : (
                              <div
                                style={{
                                  padding: "20px",
                                  textAlign: "center",
                                  color: "#f87171",
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
                                    background: "rgba(239, 68, 68, 0.15)",
                                    border: "1px solid rgba(239, 68, 68, 0.3)",
                                    borderRadius: 4,
                                    color: "#f87171",
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
