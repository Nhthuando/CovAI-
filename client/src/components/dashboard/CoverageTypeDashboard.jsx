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
  Network
} from "lucide-react";
import {
  getCoverageFiles,
  getCoverageFrameworks,
  getCoverageFunctions,
  getCoverageSummary,
  getCoverageTestSuites,
  getTestExecution,
  runCoverageByType,
  getFileCoverage
} from "../../services/coverage.service.js";
import { getJobDetailApi, cancelJobApi } from "../../services/job.service.js";
import { getProjectCfgApi } from "../../services/project.service.js";
import FunctionExecutionFlow from "./FunctionExecutionFlow.jsx";
import FileCodeExecutionView from "./FileCodeExecutionView.jsx";
import FileBranchCFGView from "./FileBranchCFGView.jsx";
import FileFunctionCallGraphView from "./FileFunctionCallGraphView.jsx";
import CFGCalculator from "./CFGCalculator.jsx";
import WaveProgressBar from "./WaveProgressBar.jsx";

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

export default function CoverageTypeDashboard({
  type,
  snapshotId,
  projectId,
  onOpenFile,
  onGenerate,
  generating,
  onSuggestTestcase,
  onOpenCFG,
}) {
  const config = CONFIG[type];
  const [summary, setSummary] = useState(null);
  const [files, setFiles] = useState([]);
  const [executions, setExecutions] = useState({});
  const [frameworks, setFrameworks] = useState(null);
  const [loading, setLoading] = useState(true);
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

  // Accordion dropdown states for source file flow analysis
  const [expandedFile, setExpandedFile] = useState(null);
  const [fileCoverageCache, setFileCoverageCache] = useState({});

  const toggleExpandFile = useCallback(
    async (filePath) => {
      if (expandedFile === filePath) {
        setExpandedFile(null);
        return;
      }
      setExpandedFile(filePath);

      // Automatically fetch file coverage details if not yet in cache
      if (!fileCoverageCache[filePath]?.data && snapshotId) {
        setFileCoverageCache((prev) => ({
          ...prev,
          [filePath]: { loading: true },
        }));
        try {
          const res = await getFileCoverage(snapshotId, filePath);
          setFileCoverageCache((prev) => ({
            ...prev,
            [filePath]: { loading: false, data: res?.data },
          }));
        } catch (err) {
          console.warn("Error fetching file coverage for", filePath, err);
          setFileCoverageCache((prev) => ({
            ...prev,
            [filePath]: { loading: false, error: err.message },
          }));
        }
      }
    },
    [expandedFile, fileCoverageCache, snapshotId],
  );

  // Test suites state (File Testcase of Jest & Vitest)
  const [testSuites, setTestSuites] = useState([]);
  const [loadingTestSuites, setLoadingTestSuites] = useState(false);
  const [expandedSuite, setExpandedSuite] = useState(null);
  const [testSuiteSearch, setTestSuiteSearch] = useState("");

  // Function coverage state
  const [functionsList, setFunctionsList] = useState([]);
  const [loadingFunctions, setLoadingFunctions] = useState(false);
  const [functionSearch, setFunctionSearch] = useState("");
  const [functionStatusFilter, setFunctionStatusFilter] = useState("all");

  const loadFlowData = useCallback(
    async (filePath) => {
      if (!snapshotId || !filePath) return;
      setLoadingFlow(true);
      try {
        const res = await getFileCoverage(snapshotId, filePath);
        setFlowData(res?.data || null);
      } catch (err) {
        console.warn("Could not load file coverage flow:", err);
        setFlowData(null);
      } finally {
        setLoadingFlow(false);
      }
    },
    [snapshotId],
  );

  const loadTestSuites = useCallback(async () => {
    if (!snapshotId) return;
    setLoadingTestSuites(true);
    try {
      const res = await getCoverageTestSuites(snapshotId, type);
      setTestSuites(res?.data?.testSuites || []);
    } catch (err) {
      console.warn("Could not load test suites:", err);
      setTestSuites([]);
    } finally {
      setLoadingTestSuites(false);
    }
  }, [snapshotId, type]);

  const loadFunctions = useCallback(async () => {
    if (!snapshotId) return;
    setLoadingFunctions(true);
    try {
      const res = await getCoverageFunctions(snapshotId, {
        limit: 500,
        sortBy: "hit",
        order: "asc",
        type,
      });
      setFunctionsList(res?.data?.functions || []);
    } catch (err) {
      console.warn("Could not load coverage functions:", err);
      setFunctionsList([]);
    } finally {
      setLoadingFunctions(false);
    }
  }, [snapshotId, type]);

  const load = useCallback(async () => {
    if (!snapshotId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        getCoverageSummary(snapshotId),
        getCoverageFiles(snapshotId, { sortBy: "linesPct", order: "asc", limit: 200, type }),
        getTestExecution(snapshotId)
      ]);

      let mergedFiles = b.data?.files || [];
      if (type === "integration" && projectId) {
        try {
          const cfgRes = await getProjectCfgApi(projectId, snapshotId);
          const cfgs = cfgRes.data || [];
          const uniquePaths = [...new Set(cfgs.map(c => c.filePath))];
          const existingPaths = new Set(mergedFiles.map(f => f.filePath));
          for (const filePath of uniquePaths) {
            if (!existingPaths.has(filePath)) {
              mergedFiles.push({ filePath, linesPct: 0, branchesPct: 0, funcsPct: 0, stmtsPct: 0 });
            }
          }
        } catch (e) {
          console.error("Failed to fetch CFG for source files", e);
        }
      }

      setSummary(a.data); setFiles(mergedFiles); setExecutions(c.data || {}); setError("");
      // Framework metadata enriches the header, but must never block reports or Run.
      try {
        const detection = await getCoverageFrameworks(snapshotId);
        setFrameworks(detection.data || null);
      } catch {
        setFrameworks(null);
      }

      if (type === "unit") {
        loadFunctions();
        loadTestSuites();
      }
    } catch (loadError) {
      setError(loadError.message || "Unable to load coverage analysis.");
    } finally {
      setLoading(false);
    }
  }, [snapshotId, type, loadFunctions, loadTestSuites]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    if (!snapshotId || running) return;
    setRunning(true);
    setRunProgress(8);
    setRunStep("Khởi động môi trường phân tích kiểm thử...");
    setError("");
    try {
      const response = await runCoverageByType(snapshotId, type);
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
      await load();
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

  const cov = summary?.coverage || {};

  const rawTotals = summary?.rawTotals || null;

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
  // Cross-references with existing Jest & Vitest test files to provide targeted test improvements
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

    let testFiles = unitTestSuites;
    if ((!testFiles || testFiles.length === 0) && snapshotId) {
      try {
        const res = await getCoverageTestSuites(snapshotId, type);
        testFiles = res?.data?.testSuites || [];
        setTestSuites(testFiles);
      } catch (err) {
        console.warn("Could not load test suites:", err);
      }
    }

    const getCleanBase = (p) => {
      if (!p) return "";
      let name = p.replace(/\\/g, "/").split("/").pop() || "";
      name = name.replace(/(\.(test|spec|jest|vitest))+/gi, "");
      name = name.replace(/\.[a-z0-9]+$/i, "");
      return name.toLowerCase();
    };

    const findMatchingTests = (sourcePath) => {
      const clean = getCleanBase(sourcePath);
      return (testFiles || []).filter((t) => {
        const tc = getCleanBase(t.filePath);
        return tc === clean || tc.includes(clean) || clean.includes(tc);
      });
    };

    const passed100Files = [];
    const needImprovementFiles = [];

    for (const sf of sourceFiles) {
      const linesPct = sf.linesPct ?? 100;
      const branchesPct = sf.branchesPct ?? 100;
      const funcsPct = sf.funcsPct ?? 100;
      const stmtsPct = sf.stmtsPct ?? 100;

      const matchingTests = findMatchingTests(sf.filePath);
      const is100 =
        branchesPct >= 100 &&
        stmtsPct >= 100 &&
        linesPct >= 100 &&
        funcsPct >= 100 &&
        (!sf.uncoveredLines || sf.uncoveredLines.length === 0);

      let reason = "";
      if (branchesPct < 100 && stmtsPct < 100) {
        reason = `Branch: ${branchesPct}%, Statements: ${stmtsPct}% (${sf.uncoveredLines?.length || 0} nhánh/dòng chưa test)`;
      } else if (branchesPct < 100) {
        reason = `Branch coverage mới đạt ${branchesPct}% (${sf.uncoveredLines?.length || 0} nhánh chưa test)`;
      } else if (stmtsPct < 100) {
        reason = `Statement coverage mới đạt ${stmtsPct}%`;
      } else if (linesPct < 100) {
        reason = `Line coverage mới đạt ${linesPct}%`;
      }

      const itemData = {
        filePath: sf.filePath,
        fileName: sf.filePath.split("/").pop(),
        linesPct,
        branchesPct,
        funcsPct,
        stmtsPct,
        uncoveredLines: sf.uncoveredLines || [],
        matchingTests: matchingTests.map((t) => ({ filePath: t.filePath, framework: t.framework, status: t.status })),
        primaryTestFile: matchingTests[0]?.filePath || null,
        reason,
      };

      if (is100) {
        passed100Files.push(itemData);
      } else {
        needImprovementFiles.push(itemData);
      }
    }

    const totalCount = passed100Files.length + needImprovementFiles.length;
    const primaryTarget =
      needImprovementFiles[0]?.filePath ||
      (sourceFiles[0]?.filePath || "");

    onSuggestTestcase?.(primaryTarget, {
      isBulk: true,
      snapshotId,
      projectId,
      totalCount,
      totalTestSuitesCount: testFiles?.length || 0,
      allSuitesSummary: {
        total: totalCount,
        passed100Files,
        needImprovementFiles,
        passed100Suites: passed100Files,
        needImprovementSuites: needImprovementFiles,
      },
      uncoveredFiles: needImprovementFiles.map((s) => s.filePath),
      hasUncovered: needImprovementFiles.length > 0,
      uncoveredCount: needImprovementFiles.length,
      overallCoverage: {
        statements: cov.statements,
        branches: cov.branches,
        functions: cov.functions,
        lines: cov.lines,
      },
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

  const values =
    type === "unit"
      ? [cov.statements, cov.branches, cov.functions, cov.lines]
      : type === "integration"
        ? [
          selectedFiles.length,
          selectedFiles.filter((f) => f.linesPct > 0).length,
          pct(avg),
          selectedFiles.filter((f) => f.linesPct < 60).length,
        ]
        : [totals.total, totals.passed, totals.failed, pct(cov.lines)];

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
            disabled={loading || running}
            style={{
              ...buttonStyle("#d8b4fe"),
              background: "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(99,102,241,0.25))",
              border: "1px solid rgba(168,85,247,0.5)",
              color: "#d8b4fe",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 600,
              cursor: "pointer",
            }}
            title="Gợi ý testcase AI cho toàn bộ các file chưa đạt 100% coverage"
          >
            <Sparkles size={14} className="text-purple-400" />
            <span>Suggest test</span>
          </button>
          <button
            onClick={load}
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
                        ? coverageColor(values[i])
                        : config.accent,
                    fontSize: 27,
                    fontWeight: 750,
                    marginTop: 8,
                  }}
                >
                  {type === "unit" ? pct(values[i]) : values[i]}
                </div>
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
                  pctValue: cov.statements,
                  raw: rawTotals?.statements,
                  icon: FileCode,
                  accentColor: "#a78bfa",
                },
                {
                  key: "branches",
                  title: "Branch coverage",
                  description: "Percentage of if/else/switch condition paths executed.",
                  pctValue: cov.branches,
                  raw: rawTotals?.branches,
                  icon: GitBranch,
                  accentColor: "#fbbf24",
                },
                {
                  key: "functions",
                  title: "Function coverage",
                  description: "Percentage of functions or methods executed.",
                  pctValue: cov.functions,
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
                      if (next === "functions" && functionsList.length === 0) {
                        loadFunctions();
                      }
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
                  label: `Statement coverage (${pct(cov.statements)})`,
                  icon: FileCode,
                  accent: "#a78bfa",
                },
                {
                  id: "branches",
                  label: `Branch coverage (${pct(cov.branches)})`,
                  icon: GitBranch,
                  accent: "#fbbf24",
                },
                {
                  id: "functions",
                  label: `Function coverage (${pct(cov.functions)})`,
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
                      if (
                        tab.id === "functions" &&
                        functionsList.length === 0
                      ) {
                        loadFunctions();
                      }
                      if (tab.id === "testcases" && testSuites.length === 0) {
                        loadTestSuites();
                      }
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
                    const isExpanded = expandedFile === file.filePath;
                    const cacheEntry = fileCoverageCache[file.filePath];
                    const isLoadingDetails = cacheEntry?.loading;
                    const fileDetails = cacheEntry?.data;

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

                          {/* Action: Open source file & Dropdown Toggle Button on Far Right */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                            }}
                          >
                            <button
                              onClick={() => onOpenFile?.(file.filePath)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: "#c9d1d9",
                                fontSize: 11,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                              className="hover:bg-white/10 hover:text-white"
                              title="Open source file in editor"
                            >
                              Open code
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
                                  : "View execution flow analysis"
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
                            }}
                          >
                            {isLoadingDetails ? (
                              <div
                                style={{
                                  padding: "24px",
                                  textAlign: "center",
                                  color: "#8b949e",
                                  fontSize: 12,
                                }}
                              >
                                Analyzing execution flow for{" "}
                                {cleanDisplayPath(file.filePath)}...
                              </div>
                            ) : fileDetails ? (
                              activeMetricView === "branches" ? (
                                <FileBranchCFGView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  onOpenFile={onOpenFile}
                                  onSuggestTestcase={onSuggestTestcase}
                                />
                              ) : activeMetricView === "functions" ? (
                                <FileFunctionCallGraphView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  testSuites={testSuites}
                                  onOpenFile={onOpenFile}
                                  onSuggestTestcase={onSuggestTestcase}
                                />
                              ) : (
                                <FileCodeExecutionView
                                  filePath={file.filePath}
                                  fileCoverage={fileDetails}
                                  onOpenFile={onOpenFile}
                                  onSuggestTestcase={onSuggestTestcase}
                                />
                              )
                            ) : (
                              <div
                                style={{
                                  padding: "20px",
                                  textAlign: "center",
                                  color: "#f87171",
                                  fontSize: 12,
                                }}
                              >
                                Failed to load flow analysis data for this file.
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
