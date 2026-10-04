import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ListOrdered,
  Terminal,
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
  getSystemCoverageSummary,
  saveAiSystemTest,
} from "../../services/coverage.service.js";
import { getJobDetailApi } from "../../services/job.service.js";
import { getProjectCfgApi, generateSystemTestApi } from "../../services/project.service.js";
import FunctionExecutionFlow from "./FunctionExecutionFlow.jsx";
import FileCodeExecutionView from "./FileCodeExecutionView.jsx";
import FileBranchCFGView from "./FileBranchCFGView.jsx";
import FileFunctionCallGraphView from "./FileFunctionCallGraphView.jsx";
import CFGCalculator from "./CFGCalculator.jsx";
import JobQueue from "./JobQueue.jsx";
import { CoverageDashboardSkeleton } from "../common/Skeleton.jsx";

const CONFIG = {
  unit: {
    title: "Unit Test Coverage",
    subtitle: "Independent testing of functions, condition branches, and statements.",
    supported: "Jest · Vitest",
    accent: "#a78bfa",
    focus: ["Statements", "Branches", "Functions", "Lines"],
    explanation: [
      ["Statement coverage", "Percentage of statements executed by tests."],
      ["Branch coverage", "Percentage of if/else/switch branches traversed."],
      ["Function coverage", "Percentage of functions or methods called."],
    ],
  },
  integration: {
    title: "Integration Test Coverage",
    subtitle: "Test APIs and data flow between frontend, backend, and external services.",
    supported: "Playwright · Supertest",
    accent: "#fbbf24",
    focus: [
      "API files",
      "Covered API files",
      "Average coverage",
      "Critical APIs",
    ],
    explanation: [
      ["API contracts", "Requests, responses, status codes, and payload contracts."],
      ["Frontend ↔ Backend", "API invocations from client UI to routes/controllers."],
      ["Service integration", "Controller, service, and database/dependency flows."],
    ],
  },
  system: {
    title: "System Tests",
    subtitle: "Verify user journeys across the frontend, real API and database.",
    supported: "Playwright",
    accent: "#ec4899",
    focus: ["E2E tests", "Passed", "Failed", "Flaky / Stability", "Coverage"],
    explanation: [
      ["User journeys", "Authentication, user actions, and full business workflows."],
      ["Browser behavior", "UI rendering, routing navigation, and browser interactions."],
      ["Full system", "Frontend, backend, and database working together."],
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
  const [systemSummary, setSystemSummary] = useState(null);
  const executionMode = "full";
  const [files, setFiles] = useState([]);
  const [executions, setExecutions] = useState({});
  const [frameworks, setFrameworks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runningStatus, setRunningStatus] = useState("");
  const [error, setError] = useState("");
  const [activeFramework, setActiveFramework] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [internalGenerating, setInternalGenerating] = useState(false);
  const [expandedScenario, setExpandedScenario] = useState(null);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const isGenerating = generating || internalGenerating;
  const activeJobIdRef = useRef(null);

  // Socket.IO realtime progress listener
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
    } catch { /* Polling continues when stored user data is unavailable. */ }

    const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";
    const socket = io(SOCKET_URL, {
      auth: { token: socketToken },
      withCredentials: true,
      autoConnect: true,
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      if (userId) socket.emit("subscribe_notifications", userId);
    });

    const onJobProgress = (data) => {
      if (data && activeJobIdRef.current && data.jobId === activeJobIdRef.current) {
        if (data.stage) {
          setRunningStatus(data.stage);
        }
      }
    };

    socket.on("job:progress", onJobProgress);

    return () => {
      socket.off("job:progress", onJobProgress);
      socket.disconnect();
    };
  }, []);

  const waitForJobWithProgress = useCallback(async (jobId, defaultInitial = "Starting AUT server...") => {
    activeJobIdRef.current = jobId;
    setRunningStatus(defaultInitial);
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const response = await getJobDetailApi(jobId);
      const job = response?.job;
      if (job?.status === "SUCCESS") {
        setRunningStatus("");
        activeJobIdRef.current = null;
        return;
      }
      if (["FAILED", "CANCELED"].includes(job?.status)) {
        setRunningStatus("");
        activeJobIdRef.current = null;
        throw new Error(
          job?.errorMessage ||
          job?.error ||
          `${job.status}: task failed.`,
        );
      }

      // Live stage extraction from logs fallback
      if (job?.logs && job.logs.length > 0) {
        const latestLogs = [...job.logs].reverse();
        for (const l of latestLogs) {
          const msg = l.message || "";
          if (/^(Inspecting|Generating system tests|Repairing generated tests|Verifying generated tests|Confirming generated tests)/.test(msg)) {
            setRunningStatus(msg);
            break;
          } else if (msg.includes("Starting AUT server")) {
            setRunningStatus("Starting AUT server...");
            break;
          } else if (msg.includes("Executing Playwright") || msg.includes("Selected playwright") || msg.includes("Run command")) {
            setRunningStatus("Executing Playwright tests...");
            break;
          } else if (msg.includes("Executing Cypress") || msg.includes("Selected cypress")) {
            setRunningStatus("Executing Cypress tests...");
            break;
          } else if (msg.includes("Parsing results") || msg.includes("Track 1") || msg.includes("Track 2")) {
            setRunningStatus("Parsing results...");
            break;
          } else if (msg.includes("Dry-Run")) {
            setRunningStatus("Verifying test syntax in isolated Dry-Run...");
            break;
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    activeJobIdRef.current = null;
    setRunningStatus("");
    throw new Error("Analysis timed out. Open Job Queue to inspect logs.");
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
      const response = await generateSystemTestApi(projectId, snapshotId, executionMode);
      const jobId = response?.data?.job?.id || response?.job?.id;
      if (jobId) {
        await waitForJobWithProgress(jobId, "Generating Playwright E2E tests with AI...");
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

  const [showJobQueueModal, setShowJobQueueModal] = useState(false);

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
      if (type === "system") {
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
        setSummary({
          coverage: {
            statements: 0,
            branches: 0,
            functions: 0,
            lines: sysData.featureCoverage || 0,
          },
          rawTotals: null,
        });
        setFiles(sysData.files || []);
        if (sysData.latestRun) {
          setExecutions({
            playwright: sysData.latestRun.type === "PLAYWRIGHT" ? sysData.latestRun : null,
            cypress: sysData.latestRun.type === "CYPRESS" ? sysData.latestRun : null,
          });
        } else {
          setExecutions({});
        }
        setError("");
        try {
          const detection = await getCoverageFrameworks(snapshotId);
          setFrameworks(detection.data || null);
        } catch {
          setFrameworks(null);
        }
        setLoading(false);
        return sysData;
      }

      const [a, b, c] = await Promise.all([getCoverageSummary(snapshotId), getCoverageFiles(snapshotId, { sortBy: "linesPct", order: "asc", limit: 200 }), getTestExecution(snapshotId)]);
      let mergedFiles = b.data?.files || [];
      if (type === "integration" && projectId) {
        try {
          const cfgRes = await getProjectCfgApi(projectId, snapshotId);
          const cfgs = cfgRes.data || [];
          const uniquePaths = [...new Set(cfgs.map((c) => c.filePath))];
          const existingPaths = new Set(mergedFiles.map((f) => f.filePath));
          for (const filePath of uniquePaths) {
            if (!existingPaths.has(filePath)) {
              mergedFiles.push({
                filePath,
                linesPct: 0,
                branchesPct: 0,
                funcsPct: 0,
                stmtsPct: 0,
              });
            }
          }
        } catch (e) {
          console.error("Failed to fetch CFG for source files", e);
        }
      }

      setSummary(a.data);
      setFiles(mergedFiles);
      setExecutions(c.data || {});
      setError("");
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
  }, [snapshotId, type, projectId, loadFunctions, loadTestSuites]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    if (!snapshotId || running) return;
    setRunning(true);
    setError("");
    setRunningStatus(type === "system" ? "Starting AUT server..." : "Running analysis...");
    try {
      const response = await runCoverageByType(snapshotId, type, undefined, type === "system" ? executionMode : undefined);
      setActiveFramework(response.data?.framework || "");
      const jobs =
        response.data?.jobs || (response.data?.job ? [response.data.job] : []);
      if (jobs.length === 0)
        throw new Error("Backend did not return a coverage job.");
      for (const j of jobs) {
        if (j?.id) {
          await waitForJobWithProgress(j.id, type === "system" ? "Starting AUT server..." : "Running analysis...");
        }
      }
      await load();
    } catch (runError) {
      setError(runError.message || "Coverage analysis failed.");
    } finally {
      setRunning(false);
      setRunningStatus("");
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

  const hasSystemTests = useMemo(() => {
    if (type !== "system") return false;
    return Boolean(
      (systemSummary?.hasRun && systemSummary?.e2eTests > 0) ||
      (systemSummary?.scenarios && systemSummary.scenarios.length > 0) ||
      (frameworks?.supported?.system && frameworks.supported.system.length > 0)
    );
  }, [type, systemSummary, frameworks]);

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
        : type === "system"
          ? [
            systemSummary?.hasRun ? systemSummary.e2eTests : 0,
            systemSummary?.hasRun ? systemSummary.passed : 0,
            systemSummary?.hasRun ? systemSummary.failed : 0,
            systemSummary?.hasRun ? (systemSummary.flaky || 0) : 0,
            systemSummary?.hasRun && systemSummary.coverageAvailable && systemSummary.featureCoverage != null
              ? pct(systemSummary.featureCoverage)
              : systemSummary?.hasRun
                ? "N/A (Black-box E2E)"
                : "N/A",
          ]
          : [totals.total, totals.passed, totals.failed, pct(cov.lines)];

  return (
    <div
      style={{
        minHeight: "100%",
        padding: "28px 34px",
        color: "var(--color-text)",
        background: "var(--color-bg)",
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
        <div style={{flex:'1 1 300px',minWidth:0}}>
          <h1 style={{ margin: 0, fontSize: 27 }}>{config.title}</h1>
          <p style={{ color: "#8b949e", fontSize: 13, margin: "7px 0 0" }}>
            {config.subtitle}
          </p>
          <div style={{ color: "#6e7681", fontSize: 12, marginTop: 7 }}>
            {type === 'system' ? 'Runner: ' : 'Supported: '}
            <span style={{ color: config.accent }}>{config.supported}</span>
            {frameworks && type !== 'system' && (
              <span>
                {" "}
                · Detected:{" "}
                <b style={{ color: "#c9d1d9" }}>
                  {frameworks.supported?.[type]?.join(", ") || "None"}
                </b>
              </span>
            )}
            {activeFramework && type !== 'system' && (
              <span>
                {" "}
                · Last Run:{" "}
                <b style={{ color: config.accent }}>{activeFramework}</b>
              </span>
            )}
          </div>
          {type === 'system' && systemSummary?.hasRun && <div style={{color:'#8b949e',fontSize:12,marginTop:7}}>Last result: {systemSummary.executionMode === 'full' ? 'Full system' : 'Legacy frontend-only run'}</div>}
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center",flexWrap:'wrap',flex:'0 1 auto',minWidth:0,maxWidth:'100%' }}>
          {type === "system" && <span style={{color:'#8b949e',fontSize:12,padding:'7px 10px',border:'1px solid #30363d',borderRadius:6}}>Full system · Real API & database</span>}
          {projectId && (
            <button
              onClick={() => setShowJobQueueModal(true)}
              style={{
                ...buttonStyle(running || isGenerating ? "#38bdf8" : "#8b949e"),
                background: running || isGenerating
                  ? "linear-gradient(135deg, rgba(56,189,248,0.2) 0%, rgba(99,102,241,0.2) 100%)"
                  : "rgba(255, 255, 255, 0.05)",
                border: running || isGenerating ? "1px solid rgba(56,189,248,0.5)" : "1px solid rgba(255, 255, 255, 0.12)",
                color: running || isGenerating ? "#38bdf8" : "#c9d1d9",
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
              title="View Job Queue and real-time execution logs"
            >
              <ListOrdered size={14} />
              <span>Job Queue</span>
              {(running || isGenerating) && (
                <span
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    backgroundColor: "#38bdf8",
                    boxShadow: "0 0 6px #38bdf8",
                  }}
                />
              )}
            </button>
          )}
          {type === "system" ? (
            !hasSystemTests ? (
              <>
                <button
                  onClick={handleGenerateAiSystemTest}
                  disabled={loading || running || isGenerating}
                  style={{
                    ...buttonStyle("#67e8f9"),
                    background: "linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(103,232,249,0.2) 100%)",
                    border: "1px solid rgba(103,232,249,0.45)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  title="Automatically generate Playwright E2E test scenarios using AI"
                >
                  {isGenerating && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>}
                  <span>
                    {isGenerating
                      ? "Generating..."
                      : "Generate tests"}
                  </span>
                </button>
                <button
                  onClick={load}
                  disabled={loading || running || isGenerating}
                  style={buttonStyle("#8b949e")}
                >
                  Refresh
                </button>
                <button
                  onClick={run}
                  disabled={!snapshotId || running || isGenerating}
                  style={{
                    ...buttonStyle(config.accent),
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {running && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>}
                  <span>{running ? "Running..." : "Run tests"}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleGenerateAiSystemTest}
                  disabled={loading || running || isGenerating}
                  style={{
                    ...buttonStyle("#67e8f9"),
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  title="Use AI Agent to generate additional E2E test scenarios"
                >
                  {isGenerating && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>}
                  <span>
                    {isGenerating
                      ? "Generating..."
                      : "Generate tests"}
                  </span>
                </button>
                <button
                  onClick={load}
                  disabled={loading || running || isGenerating}
                  style={buttonStyle("#8b949e")}
                >
                  Refresh
                </button>
                <button
                  onClick={run}
                  disabled={!snapshotId || running || isGenerating}
                  style={{
                    ...buttonStyle(config.accent),
                    background: running ? "rgba(236, 72, 153, 0.25)" : undefined,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {running && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>}
                  <span>{running ? "Running..." : "Run tests"}</span>
                </button>
              </>
            )
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Live Job Progress Banner */}
      {(running || isGenerating) && (
        <div
          style={{
            marginBottom: 20,
            padding: "12px 18px",
            background: "linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
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
              <span style={{ display: "inline-block", animation: "spin 1.5s linear infinite" }}>⟳</span>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f6fc", display: "flex", alignItems: "center", gap: 8 }}>
                <span>Job in progress</span>
                <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(56, 189, 248, 0.25)", color: "#38bdf8", padding: "1px 6px", borderRadius: 4, letterSpacing: "0.5px" }}>RUNNING</span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                {runningStatus || "Processing task..."}
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowJobQueueModal(true)}
            style={{
              background: "rgba(56, 189, 248, 0.15)",
              border: "1px solid rgba(56, 189, 248, 0.45)",
              color: "#38bdf8",
              padding: "7px 14px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              transition: "all 0.2s",
            }}
            title="Inspect logs and progress in real-time Job Queue"
          >
            <Terminal size={14} />
            <span>Open Job Queue & Logs</span>
          </button>
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
                      fontSize: typeof values[i] === "string" && values[i].length > 6 ? 17 : 27,
                      fontWeight: 750,
                      marginTop: 8,
                      lineHeight: "1.2",
                    }}
                  >
                    {isFlakyCard ? (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                        <span>{values[i]}</span>
                        {hasRun && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: Number(values[i]) > 0 ? "rgba(251, 191, 36, 0.15)" : "rgba(34, 197, 94, 0.12)",
                              color: Number(values[i]) > 0 ? "#fbbf24" : "#4ade80",
                              border: Number(values[i]) > 0 ? "1px solid rgba(251, 191, 36, 0.35)" : "1px solid rgba(34, 197, 94, 0.25)",
                            }}
                          >
                            {Number(values[i]) > 0 ? "⚠ Needs Attention" : "✓ Stable"}
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
                    description: "Percentage of statements executed by tests.",
                    pctValue: cov.statements,
                    raw: rawTotals?.statements,
                    icon: FileCode,
                    accentColor: "#a78bfa",
                  },
                  {
                    key: "branches",
                    title: "Branch coverage",
                    description: "Percentage of if/else/switch branches traversed.",
                    pctValue: cov.branches,
                    raw: rawTotals?.branches,
                    icon: GitBranch,
                    accentColor: "#fbbf24",
                  },
                  {
                    key: "functions",
                    title: "Function coverage",
                    description: "Percentage of functions or methods called.",
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
                        if (
                          next === "functions" &&
                          functionsList.length === 0
                        ) {
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
                      title={`Click to view ${item.title} details`}
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
                      color: isCurrent ? tab.accent || "#ffffff" : "#8b949e",
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
                  title="Back to test files list"
                >
                  <FlaskConical size={12} />
                  <span>View Test Files</span>
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 260,
                }}
              >
                {activeMetricView === "testcases" ? (
                  <>
                    <FlaskConical
                      size={15}
                      style={{ flexShrink: 0, color: "#c084fc" }}
                    />
                    <span>
                      <b>Unit Test Files:</b> Test suite files executed by <b>Jest</b> and <b>Vitest</b>. Playwright, Cypress, and Supertest files are automatically excluded from the Unit Test scope.
                    </span>
                  </>
                ) : activeMetricView === "statements" ? (
                  <>
                    <FileCode
                      size={15}
                      style={{ flexShrink: 0, color: "#a78bfa" }}
                    />
                    <span>
                      <b>Statement Coverage:</b> Percentage of source code statements executed during unit testing.
                    </span>
                  </>
                ) : activeMetricView === "branches" ? (
                  <>
                    <GitBranch
                      size={15}
                      style={{ flexShrink: 0, color: "#fbbf24" }}
                    />
                    <span>
                      <b>Branch Coverage:</b> Percentage of conditional branches (if/else, switch, ternary) exercised during testing.
                    </span>
                  </>
                ) : activeMetricView === "functions" ? (
                  <>
                    <Cpu
                      size={15}
                      style={{ flexShrink: 0, color: "#38bdf8" }}
                    />
                    <span>
                      <b>Function Coverage:</b> Identified methods and functions with invocation metrics and integrated CFG analysis.
                    </span>
                  </>
                ) : (
                  <>
                    <ListChecks size={15} style={{ flexShrink: 0 }} />
                    <span>
                      <b>Source File Coverage:</b> Aggregated coverage summary across source files (Lines, Branches, Functions, Statements).
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
                      background:
                        functionViewMode === "map"
                          ? "var(--color-primary)"
                          : "var(--color-surface)",
                      color:
                        functionViewMode === "map"
                          ? "#ffffff"
                          : "var(--color-text-secondary)",
                      border:
                        functionViewMode === "map"
                          ? "1px solid var(--color-primary)"
                          : "1px solid var(--color-border)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Cpu size={12} />
                    <span>🕸️ Function Map</span>
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
                          ? "var(--color-primary)"
                          : "var(--color-surface)",
                      color:
                        functionViewMode === "table"
                          ? "#ffffff"
                          : "var(--color-text-secondary)",
                      border:
                        functionViewMode === "table"
                          ? "1px solid var(--color-primary)"
                          : "1px solid var(--color-border)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <ListChecks size={12} />
                    <span>📋 Details Table</span>
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
                      placeholder="Search test files..."
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
                  Loading test files...
                </div>
              ) : filteredTestSuites.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>
                  No Jest or Vitest test files found yet. Click "Run Analysis" to run tests and analyze coverage.
                </div>
              ) : (
                <div style={{overflowX:'auto'}}>
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
                    <span>Test File</span>
                    <span style={{ textAlign: "center" }}>Framework</span>
                    <span style={{ textAlign: "right" }}>Test Cases</span>
                    <span style={{ textAlign: "right" }}>Duration</span>
                    <span style={{ textAlign: "center" }}>Status</span>
                    <span style={{ textAlign: "center" }}>Actions</span>
                  </div>

                  {/* Rows */}
                  {filteredTestSuites.map((suite) => {
                    const isPassed =
                      suite.status === "passed" && suite.failedTests === 0;
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
                              title="Open test file in editor"
                            >
                              Open test
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
                                fontWeight: 650,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                whiteSpace: "nowrap",
                              }}
                              className="hover:bg-purple-500/25 hover:border-purple-400"
                              title={`Ask AI Agent to suggest additional test cases for ${suite.fileName}`}
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
                                title="View test case list"
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
                              Test cases in {suite.fileName}:
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 5,
                              }}
                            >
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
                                    <Check
                                      size={12}
                                      style={{ color: "#4ade80" }}
                                    />
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
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <Cpu size={16} style={{ color: "#38bdf8" }} />
                    <span>Function Coverage Breakdown</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#8b949e",
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
                        placeholder="Search functions or files..."
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
                        { id: "uncovered", label: "⚑ Uncovered (0 hits)" },
                        { id: "covered", label: "✓ Covered" },
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
                    Loading functions...
                  </div>
                ) : filteredFunctions.length === 0 ? (
                  <div
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#6e7681",
                    }}
                  >
                    {functionsList.length === 0
                      ? "No function data available. Click 'Run Analysis' to analyze Jest/Vitest."
                      : "No functions matching the filter."}
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
                      <span style={{ textAlign: "right" }}>Calls</span>
                      <span style={{ textAlign: "center" }}>Status</span>
                      <span style={{ textAlign: "center" }}>Actions</span>
                    </div>

                    {filteredFunctions.slice(0, 100).map((fn) => {
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
                            title={`Open ${fn.filePath} at function ${fn.functionName}`}
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
                      ? systemSummary?.hasRun && !systemSummary?.coverageAvailable
                        ? "E2E Test Scenarios"
                        : "Files exercised by E2E tests"
                      : activeMetricView === "statements"
                        ? "Source files (Sorted by statements)"
                        : activeMetricView === "branches"
                          ? "Source files (Sorted by branches)"
                          : "Source file coverage"}
                </span>
                <span
                  style={{ fontSize: 11, color: "#8b949e", fontWeight: 400 }}
                >
                  {type === "system" && systemSummary?.hasRun && !systemSummary?.coverageAvailable
                    ? `${systemSummary.scenarios?.length || 0} scenarios executed`
                    : `${displayFiles.length} files analyzed`}
                </span>
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
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#f0f6fc", marginBottom: 6 }}>
                    No E2E scenarios executed on this snapshot yet
                  </div>
                  <p style={{ color: "#8b949e", fontSize: 13, maxWidth: 500, margin: "0 auto 20px", lineHeight: 1.55 }}>
                    No System / E2E test runs (Playwright or Cypress) recorded yet. Run tests or generate AI E2E scenarios to get started.
                  </p>

                  {systemSummary?.latestAiTest && (
                    <div
                      style={{
                        margin: "0 auto 24px",
                        maxWidth: 620,
                        textAlign: "left",
                        padding: 16,
                        borderRadius: 10,
                        border: systemSummary.latestAiTest.status === "VERIFIED"
                          ? "1px solid rgba(34, 197, 94, 0.35)"
                          : "1px solid rgba(251, 191, 36, 0.35)",
                        background: systemSummary.latestAiTest.status === "VERIFIED"
                          ? "rgba(34, 197, 94, 0.08)"
                          : "rgba(251, 191, 36, 0.08)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 16 }}>
                            {systemSummary.latestAiTest.status === "VERIFIED" ? "✓" : "⚠️"}
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              color: systemSummary.latestAiTest.status === "VERIFIED" ? "#22c55e" : "#fbbf24",
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
                            background: systemSummary.latestAiTest.status === "VERIFIED"
                              ? "rgba(34, 197, 94, 0.2)"
                              : "rgba(251, 191, 36, 0.2)",
                            color: systemSummary.latestAiTest.status === "VERIFIED" ? "#4ade80" : "#fde047",
                          }}
                        >
                          {systemSummary.latestAiTest.status === "VERIFIED" ? "VERIFIED" : "DRY-RUN FAILED"}
                        </span>
                      </div>

                      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#c9d1d9", lineHeight: 1.55 }}>
                        {systemSummary.latestAiTest.status === "VERIFIED"
                          ? `Test scenario saved to: ${systemSummary.latestAiTest.filePath}. Click "Run System Test" to execute!`
                          : `The generated test scenario failed dry-run verification in the sandbox. The file was not saved automatically to prevent test suite regressions.`}
                      </p>

                      {systemSummary.latestAiTest.status === "FAILED" && (
                        <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(0,0,0,0.25)", borderRadius: 6, fontSize: 12, color: "#e6edf3" }}>
                          <div style={{ fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}>Verification did not pass</div>
                          <div style={{ color: "#8b949e", lineHeight: 1.5 }}>
                            Tests were checked against the real application and a fresh test database. Review the startup or assertion error below. Regenerate to retry automatic repair; an unverified candidate cannot be saved as a passing test.
                          </div>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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
                          {showAiDetails ? "▲ Hide failure details & AI code" : "▼ View failure details & AI code"}
                        </button>

                        {systemSummary.latestAiTest.status === "VERIFIED" && (
                          <button
                            onClick={handleSaveAiSystemTest}
                            disabled={isSavingAiTest || loading || running}
                            title="Save this AI-generated test to your project test suite"
                            style={{
                              background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(16, 185, 129, 0.3) 100%)",
                              border: "1px solid rgba(34, 197, 94, 0.5)",
                              color: "#4ade80",
                              borderRadius: 6,
                              padding: "4px 12px",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: isSavingAiTest ? "not-allowed" : "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              transition: "all 0.2s ease",
                            }}
                          >
                            <Zap size={13} />
                            {isSavingAiTest ? "Saving..." : "⚡ Save Test to Project"}
                          </button>
                        )}
                      </div>

                      {showAiDetails && (
                        <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10 }}>
                          {systemSummary.latestAiTest.meta?.error && (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "#f87171", marginBottom: 4 }}>Dry-run failure details:</div>
                              <pre style={{ margin: 0, padding: 8, background: "#0d1117", borderRadius: 6, fontSize: 11, color: "#ff7b72", maxHeight: 150, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                                {systemSummary.latestAiTest.meta.error}
                              </pre>
                            </div>
                          )}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#8b949e", marginBottom: 4 }}>AI-generated test code ({systemSummary.latestAiTest.filePath}):</div>
                            <pre style={{ margin: 0, padding: 8, background: "#0d1117", borderRadius: 6, fontSize: 11, color: "#c9d1d9", maxHeight: 180, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                              {systemSummary.latestAiTest.content}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
                    <button
                      onClick={handleGenerateAiSystemTest}
                      disabled={loading || running || isGenerating}
                      style={{
                        ...buttonStyle("#67e8f9"),
                        background: "linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(103,232,249,0.2) 100%)",
                        border: "1px solid rgba(103,232,249,0.45)",
                        padding: "10px 18px",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      {isGenerating && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>}
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
                      {running && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>}
                      <span>{running ? runningStatus || "Running analysis..." : "Run System Test"}</span>
                    </button>
                  </div>
                  {generateError && (
                    <div style={{ margin: "14px auto 0", padding: "10px 14px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, color: "#f87171", fontSize: 12, maxWidth: 500 }}>
                      ⚠ {generateError}
                    </div>
                  )}
                </div>
              ) : type === "system" && systemSummary?.hasRun && !systemSummary?.coverageAvailable ? (
                /* E2E Test Scenarios Table */
                <div style={{overflowX:'auto'}}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(240px, 1.5fr) minmax(160px, 1fr) 112px 80px 80px",
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

                  {(systemSummary.scenarios && systemSummary.scenarios.length > 0) ? (
                    systemSummary.scenarios.map((sc, idx) => {
                      const isFlaky = sc.status === "flaky";
                      const isPassed = sc.status === "passed";
                      const scKey = sc.id || idx;
                      const isExpanded = expandedScenario === scKey;
                      const hasFailures = sc.failureMessages && sc.failureMessages.length > 0;

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
                              gridTemplateColumns: "minmax(240px, 1.5fr) minmax(160px, 1fr) 112px 80px 80px",
                              minWidth: 760,
                              gap: 10,
                              padding: "12px 18px",
                              alignItems: "center",
                              borderBottom: "1px solid rgba(255,255,255,.04)",
                              cursor: hasFailures ? "pointer" : "default",
                              background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent",
                              transition: "background 0.15s ease",
                            }}
                            className="hover:bg-white/[0.02]"
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                              <span style={{ color: isPassed ? "#22c55e" : isFlaky ? "#fbbf24" : "#f87171", fontWeight: 700 }}>
                                {isPassed ? "✓" : isFlaky ? "⚠" : "✗"}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#f0f6fc" }}>
                                {sc.title}
                              </span>
                              {hasFailures && (
                                <span style={{ fontSize: 10, color: "#8b949e", background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4 }}>
                                  {isExpanded ? "▲ Hide error" : "▼ View error"}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "#8b949e", fontFamily: "var(--font-mono)",overflowWrap:'anywhere' }}>
                              {sc.file || "E2E Spec"}
                            </div>
                            <div>{sc.hasEvidence ? <SystemTestEvidence snapshotId={snapshotId} scenarioId={sc.id} title={sc.title} /> : <span style={{color:'#6e7681',fontSize:12}}>Not captured</span>}</div>
                            <div style={{ textAlign: "right", fontSize: 12, color: "#c9d1d9", fontFamily: "var(--font-mono)" }}>
                              {sc.durationMs ? `${Number(sc.durationMs).toFixed(0)}ms` : "—"}
                            </div>
                            <div style={{ display: "flex", justifyContent: "center" }}>
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
                                  color: isPassed ? "#4ade80" : isFlaky ? "#fbbf24" : "#f87171",
                                  border: isPassed
                                    ? "1px solid rgba(34, 197, 94, 0.3)"
                                    : isFlaky
                                      ? "1px solid rgba(251, 191, 36, 0.3)"
                                      : "1px solid rgba(248, 113, 113, 0.3)",
                                }}
                              >
                                {isPassed ? "✓ PASS" : isFlaky ? "⚠ FLAKY" : "✗ FAIL"}
                              </span>
                            </div>
                          </div>
                          {isExpanded && hasFailures && (
                            <div
                              style={{
                                padding: "12px 18px",
                                background: "rgba(0,0,0,0.35)",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                fontFamily: "var(--font-mono)",
                                fontSize: 11,
                                color: "#fca5a5",
                                whiteSpace: "pre-wrap",
                                lineHeight: 1.5,
                              }}
                            >
                              <div style={{ fontWeight: 700, marginBottom: 4, color: "#f87171" }}>Failure details:</div>
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
                        gridTemplateColumns: "minmax(240px, 1.5fr) minmax(160px, 1fr) 112px 80px 80px",
                        minWidth: 760,
                        gap: 10,
                        padding: "14px 18px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f6fc" }}>
                        {systemSummary.runner ? `${systemSummary.runner.toUpperCase()} E2E Suite` : "Playwright E2E Suite"}
                      </div>
                      <div style={{ fontSize: 12, color: "#8b949e", fontFamily: "var(--font-mono)" }}>
                        {systemSummary.latestRun?.type || "PLAYWRIGHT"}
                      </div>
                      <div style={{color:'#6e7681'}}>Not captured</div>
                      <div style={{ textAlign: "right", fontSize: 12, color: "#c9d1d9", fontFamily: "var(--font-mono)" }}>
                        {systemSummary.latestRun?.durationMs ? `${Number(systemSummary.latestRun.durationMs).toFixed(0)}ms` : "—"}
                      </div>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 10,
                            background: systemSummary.failed === 0
                              ? "rgba(34, 197, 94, 0.15)"
                              : "rgba(248, 113, 113, 0.15)",
                            color: systemSummary.failed === 0 ? "#4ade80" : "#f87171",
                            border: systemSummary.failed === 0
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
                              title="Click to view flow analysis"
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
                                  : "Expand flow analysis"
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
                              borderBottom:
                                "1px solid rgba(255, 255, 255, 0.08)",
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
                                Unable to load execution flow data for this file.
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
      {showJobQueueModal && projectId && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(5px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowJobQueueModal(false);
          }}
        >
          <div
            style={{
              backgroundColor: "#0d1117",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: 14,
              width: "92vw",
              maxWidth: 1100,
              height: "85vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 20px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(22, 27, 34, 0.95)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <ListOrdered size={20} color="#38bdf8" />
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#f0f6fc" }}>
                  System Test Job Queue & Live Execution Logs
                </h2>
              </div>
              <button
                onClick={() => setShowJobQueueModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8b949e",
                  cursor: "pointer",
                  fontSize: 18,
                  padding: "4px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                }}
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 0 }}>
              <JobQueue projectId={projectId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
