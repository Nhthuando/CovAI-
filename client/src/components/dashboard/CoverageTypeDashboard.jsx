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
import { getJobDetailApi } from "../../services/job.service.js";
import { getProjectCfgApi } from "../../services/project.service.js";
import FunctionExecutionFlow from "./FunctionExecutionFlow.jsx";
import FileCodeExecutionView from "./FileCodeExecutionView.jsx";
import FileBranchCFGView from "./FileBranchCFGView.jsx";
import FileFunctionCallGraphView from "./FileFunctionCallGraphView.jsx";
import CFGCalculator from "./CFGCalculator.jsx";

const CONFIG = {
  unit: {
    title: "Unit Test Coverage",
    subtitle: "Kiểm thử độc lập của hàm, nhánh điều kiện và câu lệnh.",
    supported: "Jest · Vitest",
    accent: "#a78bfa",
    focus: ["Statements", "Branches", "Functions", "Lines"],
    explanation: [
      ["Statement coverage", "Bao nhiêu câu lệnh đã được test thực thi."],
      ["Branch coverage", "Bao nhiêu nhánh if/else/switch đã được đi qua."],
      ["Function coverage", "Bao nhiêu hàm hoặc method đã được gọi."],
    ],
  },
  integration: {
    title: "Integration Test Coverage",
    subtitle: "Kiểm tra API và trao đổi dữ liệu giữa frontend, backend và dịch vụ.",
    supported: "Playwright · Supertest",
    accent: "#fbbf24",
    focus: ["API files", "Covered API files", "Average coverage", "Critical APIs"],
    explanation: [
      ["API contracts", "Request, response, status code và dữ liệu trả về."],
      ["Frontend ↔ Backend", "Các lời gọi API từ giao diện đến route/controller."],
      ["Service integration", "Luồng controller, service và database/dependency."],
    ],
  },
  system: {
    title: "System Test Coverage",
    subtitle: "Kiểm tra E2E các tính năng hoàn chỉnh theo góc nhìn người dùng.",
    supported: "Playwright · Cypress",
    accent: "#ec4899",
    focus: ["E2E tests", "Passed", "Failed", "Feature coverage"],
    explanation: [
      ["User journeys", "Các luồng đăng nhập, thao tác và hoàn thành nghiệp vụ."],
      ["Browser behavior", "Giao diện, điều hướng và tương tác trên trình duyệt."],
      ["Full system", "Frontend, backend và dữ liệu hoạt động cùng nhau."],
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

export const cleanDisplayPath = (fullPath = "") => {
  if (!fullPath) return "";
  const normalized = fullPath.replace(/\\/g, "/").replace(/^\.?\//, "");

  // Match inside docker snapshots: uploads/snapshots/<id>/<repo>/<relativePath>
  const uploadMatch = normalized.match(
    /(?:^|\/)uploads\/snapshots\/[^/]+(?:\/[^/]+)*?\/(src\/.*|tests?\/.*|__tests__\/.*|spec\/.*|[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+)$/i,
  );
  if (uploadMatch) return uploadMatch[1];

  // Match standard subdirectories: src/, tests/, __tests__/, spec/
  const subMatch = normalized.match(
    /(?:^|\/)((?:src|tests?|__tests__|spec)\/.*)$/i,
  );
  if (subMatch) return subMatch[1];

  const genericMatch = normalized.match(
    /(?:^|\/)(src\/.*|tests?\/.*|__tests__\/.*|lib\/.*)$/i,
  );
  if (genericMatch) return genericMatch[1];

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length > 3) {
    return parts.slice(-2).join("/");
  }
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

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await getJobDetailApi(jobId);
    const job = response?.job;
    if (job?.status === "SUCCESS") return;
    if (["FAILED", "CANCELED"].includes(job?.status))
      throw new Error(
        job?.errorMessage ||
        job?.error ||
        `${job.status}: coverage analysis failed.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Coverage analysis timed out. Open Job Queue to inspect logs.");
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
      });
      setFunctionsList(res?.data?.functions || []);
    } catch (err) {
      console.warn("Could not load coverage functions:", err);
      setFunctionsList([]);
    } finally {
      setLoadingFunctions(false);
    }
  }, [snapshotId]);

  const load = useCallback(async () => {
    if (!snapshotId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([getCoverageSummary(snapshotId), getCoverageFiles(snapshotId, { sortBy: "linesPct", order: "asc", limit: 200 }), getTestExecution(snapshotId)]);
      
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
    setError("");
    try {
      const response = await runCoverageByType(snapshotId, type);
      setActiveFramework(response.data?.framework || "");
      const jobs = response.data?.jobs || (response.data?.job ? [response.data.job] : []);
      if (jobs.length === 0) throw new Error("Backend did not return a coverage job.");
      for (const j of jobs) {
        if (j?.id) {
          await waitForJob(j.id);
        }
      }
      await load();
    } catch (runError) {
      setError(runError.message || "Coverage analysis failed.");
    } finally {
      setRunning(false);
    }
  };

  const cov = summary?.coverage || {};

  const rawTotals = summary?.rawTotals || null;

  const selectedFiles = useMemo(() => {
    const nonTestFiles = files.filter((f) => !isTestFile(f.filePath));
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
  }, [functionsList, functionStatusFilter, functionSearch]);

  // Filtered unit test suites list (Jest & Vitest test files only)
  const filteredTestSuites = useMemo(() => {
    if (!testSuiteSearch.trim()) return testSuites;
    const q = testSuiteSearch.toLowerCase();
    return testSuites.filter(
      (s) =>
        s.filePath?.toLowerCase().includes(q) ||
        s.fileName?.toLowerCase().includes(q) ||
        s.framework?.toLowerCase().includes(q),
    );
  }, [testSuites, testSuiteSearch]);

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
            Hỗ trợ:{" "}
            <span style={{ color: config.accent }}>{config.supported}</span>
            {frameworks && (
              <span>
                {" "}
                · Phát hiện:{" "}
                <b style={{ color: "#c9d1d9" }}>
                  {frameworks.supported?.[type]?.join(", ") || "không có"}
                </b>
              </span>
            )}
            {activeFramework && (
              <span>
                {" "}
                · Vừa chạy:{" "}
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
            {running ? "Running analysis..." : "Run Analysis"}
          </button>
        </div>
      </div>

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
                  description: "Bao nhiêu câu lệnh đã được test thực thi.",
                  pctValue: cov.statements,
                  raw: rawTotals?.statements,
                  icon: FileCode,
                  accentColor: "#a78bfa",
                },
                {
                  key: "branches",
                  title: "Branch coverage",
                  description: "Bao nhiêu nhánh if/else/switch đã được đi qua.",
                  pctValue: cov.branches,
                  raw: rawTotals?.branches,
                  icon: GitBranch,
                  accentColor: "#fbbf24",
                },
                {
                  key: "functions",
                  title: "Function coverage",
                  description: "Bao nhiêu hàm hoặc method đã được gọi.",
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
                    title={`Nhấn để xem chi tiết ${item.title}`}
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
                        {isActive ? "Đang chọn" : "Chi tiết →"}
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
                  label: `File Testcase (Jest / Vitest) (${testSuites.length})`,
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
                  title="Quay lại danh sách file testcase"
                >
                  <FlaskConical size={12} />
                  <span>Xem file testcase</span>
                </button>
              )}
            </div>
          )}

          {/* Active View Explanatory Banner */}
          {type === "unit" && (
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
                      <b>File Testcase Unit Test:</b> Danh sách các file kịch bản kiểm thử của <b>Jest</b> và <b>Vitest</b>. Các file Playwright, Cypress và Supertest tự động được lọc bỏ khỏi phạm vi Unit Test.
                    </span>
                  </>
                ) : activeMetricView === "statements" ? (
                  <>
                    <FileCode size={15} style={{ flexShrink: 0, color: "#a78bfa" }} />
                    <span>
                      <b>Statement Coverage:</b> Bảng thống kê tỷ lệ phần trăm các câu lệnh (statements) trong mã nguồn đã được thực thi khi chạy unit test.
                    </span>
                  </>
                ) : activeMetricView === "branches" ? (
                  <>
                    <GitBranch size={15} style={{ flexShrink: 0, color: "#fbbf24" }} />
                    <span>
                      <b>Branch Coverage:</b> Bảng thống kê tỷ lệ phần trăm các nhánh rẽ điều kiện (if/else, switch, ternary) đã được kiểm thử đầy đủ các hướng.
                    </span>
                  </>
                ) : activeMetricView === "functions" ? (
                  <>
                    <Cpu size={15} style={{ flexShrink: 0, color: "#38bdf8" }} />
                    <span>
                      <b>Function Coverage:</b> Danh sách phương thức và hàm với tên thật đã được nhận diện, đo lường số lần gọi và tích hợp CFG.
                    </span>
                  </>
                ) : (
                  <>
                    <ListChecks size={15} style={{ flexShrink: 0 }} />
                    <span>
                      <b>Source File Coverage:</b> Bảng tổng hợp độ bao phủ của các file mã nguồn (Source code under test: Lines, Branches, Functions, Statements).
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
                    <span>🕸️ Sơ đồ luồng hàm (Method Map)</span>
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
                    <span>📋 Bảng chi tiết</span>
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
                    ({filteredTestSuites.length} file test)
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
                      placeholder="Tìm file testcase..."
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
                  Đang tải danh sách file testcase...
                </div>
              ) : filteredTestSuites.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>
                  Chưa tìm thấy file testcase nào của Jest hoặc Vitest. Hãy bấm "Run Analysis" để chạy và phân tích.
                </div>
              ) : (
                <div>
                  {/* Table Header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(220px, 1.4fr) 100px 120px 90px 105px 190px",
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
                    <span style={{ textAlign: "right" }}>Thời gian</span>
                    <span style={{ textAlign: "center" }}>Trạng thái</span>
                    <span style={{ textAlign: "center" }}>Hành động</span>
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
                              "minmax(220px, 1.4fr) 100px 120px 90px 105px 190px",
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
                            title={`Mở file test ${suite.filePath}`}
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
                              {cleanDisplayPath(suite.filePath)}
                            </span>
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
                                  : "rgba(239, 68, 68, 0.15)",
                                color: isPassed ? "#4ade80" : "#fca5a5",
                                border: isPassed
                                  ? "1px solid rgba(34, 197, 94, 0.3)"
                                  : "1px solid rgba(239, 68, 68, 0.3)",
                              }}
                            >
                              {isPassed ? "✓ PASSED" : "× FAILED"}
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
                              title="Mở file test trong editor"
                            >
                              Mở test
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSuggestTestcase?.(suite.filePath);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "4px 8px",
                                borderRadius: 5,
                                background: "rgba(168, 85, 247, 0.15)",
                                border: "1px solid rgba(168, 85, 247, 0.35)",
                                color: "#c084fc",
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                whiteSpace: "nowrap",
                              }}
                              className="hover:bg-purple-500/25 hover:border-purple-400"
                              title={`Yêu cầu AI Agent gợi ý test case bổ sung cho ${suite.fileName}`}
                            >
                              <Sparkles size={11} />
                              <span>Suggest test</span>
                            </button>

                            {suite.assertions && suite.assertions.length > 0 && (
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
                                title="Xem danh sách test case con"
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
                        {isExpanded && suite.assertions && (
                          <div
                            style={{
                              background: "rgba(0,0,0,0.25)",
                              padding: "10px 24px",
                              borderBottom: "1px solid rgba(255,255,255,.05)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: "#8b949e",
                                marginBottom: 6,
                                textTransform: "uppercase",
                              }}
                            >
                              Danh sách test case trong {suite.fileName}:
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              {suite.assertions.map((testCase, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    fontSize: 12,
                                    fontFamily: "var(--font-mono)",
                                  }}
                                >
                                  {testCase.status === "passed" ? (
                                    <Check size={12} style={{ color: "#4ade80" }} />
                                  ) : (
                                    <X size={12} style={{ color: "#f87171" }} />
                                  )}
                                  <span
                                    style={{
                                      color:
                                        testCase.status === "passed"
                                          ? "#c9d1d9"
                                          : "#fca5a5",
                                    }}
                                  >
                                    {testCase.title}
                                  </span>
                                  {testCase.duration ? (
                                    <span
                                      style={{
                                        color: "#6e7681",
                                        fontSize: 11,
                                        marginLeft: "auto",
                                      }}
                                    >
                                      {testCase.duration}ms
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
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
                      ({filteredFunctions.length} hàm)
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
                        placeholder="Tìm hàm hoặc file..."
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
                        { id: "all", label: "Tất cả" },
                        { id: "uncovered", label: "⚑ Chưa gọi (0 hits)" },
                        { id: "covered", label: "✓ Đã gọi" },
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
                    Đang tải danh sách hàm...
                  </div>
                ) : filteredFunctions.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>
                    {functionsList.length === 0
                      ? "Chưa có dữ liệu hàm. Hãy bấm 'Run Analysis' để phân tích Jest/Vitest."
                      : "Không tìm thấy hàm phù hợp với bộ lọc."}
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
                      <span>Tên Hàm</span>
                      <span>File Mã Nguồn</span>
                      <span>Vị trí</span>
                      <span style={{ textAlign: "right" }}>Số lần gọi</span>
                      <span style={{ textAlign: "center" }}>Trạng thái</span>
                      <span style={{ textAlign: "center" }}>Hành động</span>
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
                            title={`Mở file ${fn.filePath} tại hàm ${fn.functionName}`}
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
                              title="Xem mã nguồn hàm"
                            >
                              Mở code
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
                        ? "Source files (Sắp xếp theo câu lệnh)"
                        : activeMetricView === "branches"
                          ? "Source files (Sắp xếp theo nhánh rẽ)"
                          : "Source file coverage"}
                </span>
                <span
                  style={{ fontSize: 11, color: "#8b949e", fontWeight: 400 }}
                >
                  {displayFiles.length} file được phân tích
                </span>
              </div>

              {displayFiles.length === 0 ? (
                <div
                  style={{ padding: 30, textAlign: "center", color: "#6e7681" }}
                >
                  Chưa có dữ liệu. Nhấn Run Analysis để bắt đầu.
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
                    <span>File Mã Nguồn</span>
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
                    <span style={{ textAlign: "center" }}>Hành động</span>
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
                              title="Bấm để mở phân tích luồng hoạt động"
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
                              title="Mở file mã nguồn trong editor"
                            >
                              Mở code
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
                                  ? "Thu gọn phân tích luồng"
                                  : "Xem phân tích luồng hoạt động"
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
                                Đang tự động phân tích luồng hoạt động cho{" "}
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
                                Không thể tải dữ liệu phân tích luồng cho file này.
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
