import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  BarChart3,
  Clock,
  Globe,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useProjectAccess } from "../../../hooks/useProjectAccess";
import { useChatTestContext } from "../../../hooks/useChatTestContext";
import useSystemTestWorkspace from "../../../hooks/useSystemTestWorkspace.js";
import { invalidateProjectTree } from "../../../hooks/useCoverageQuery.js";
import {
  attachSocketAuthRecovery,
  getAccessToken,
  socketAuth,
} from "../../../lib/authSession.js";
import {
  getSystemTestFrameworks,
  getSystemTestScenarios,
  getSystemTestSummary,
  runSystemTest,
  systemEvidenceRequest,
  getSystemGenerationStatus,
  cancelSystemGeneration,
  addSystemTestCaseApi,
  updateSystemTestCaseApi,
  deleteSystemTestCaseApi,
  aiFixSystemTestCaseApi,
} from "../../../services/systemTest.service.js";
import {
  loadStagedOps,
  saveStagedOps,
  stageAddOp,
  stageUpdateOp,
  stageDeleteOp,
  countStagedOps,
  matchesStagedTarget,
  extractBlockTitle,
} from "../../../lib/stagedScenarioOps.js";
import { getJobDetailApi } from "../../../services/job.service.js";
import { openFloatingJobQueue } from "../../../lib/floatingJobQueuePrefs.js";
import SystemSpecMatrixTable from "./SystemSpecMatrixTable.jsx";
import SystemTestLiveRun from "./SystemTestLiveRun.jsx";
import SystemReportEmbed from "./SystemReportEmbed.jsx";
import SystemTestCaseEditorModal from "./SystemTestCaseEditorModal.jsx";
import SystemTestGeneratorModal from "./SystemTestGeneratorModal.jsx";
import GenerationProgressStrip from "./GenerationProgressStrip.jsx";
import { ExternalServicesBanner } from "./ExternalTestKeyNotices.jsx";
import SystemTestBreakpointModal from "./SystemTestBreakpointModal.jsx";
import SystemTestSetupDialog from "./SystemTestSetupDialog.jsx";
import SystemTestReportView from "./SystemTestReportView.jsx";
import SystemTestVersionHistory from "./SystemTestVersionHistory.jsx";
import SystemTestErrorNotice from "./SystemTestErrorNotice.jsx";
import { systemTestEntryState } from "./systemTestEntryModel.js";
import { getSystemGroupCaseCoverage } from "./systemCaseCoverage.js";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

function normalizeSpecPath(filePath = "") {
  return String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^(?:.*\/)?(?:\.covai-temp|storage)\/[^/]+\//i, "")
    .trim();
}

function extractDraftTitlesFromCode(code = "") {
  const titles = [];
  const regex = /(?:^|\s)(?:test|it)(?:\.(?:only|skip))?\(\s*(['"`])((?:\\.|(?!\1).)+)\1/gm;
  let match;
  while ((match = regex.exec(String(code || ""))) !== null) {
    if (match[2]) titles.push(match[2]);
  }
  return titles;
}

export default function SystemTestWorkspace({
  onChatContextChange,
  snapshotId,
  projectId,
  focusScenario,
  onOpenFile,
}) {
  const projectAccess = useProjectAccess(projectId);

  const [activeFramework, setActiveFramework] = useState("playwright");
  const [executionMode] = useState("full");
  const [headedMode, setHeadedMode] = useState(false);
  const [activeTab, setActiveTab] = useState("matrix"); // 'matrix' | 'live' | 'report'
  const [showPrintableReport, setShowPrintableReport] = useState(false);

  const [frameworksData, setFrameworksData] = useState(null);
  const [discoveryError, setDiscoveryError] = useState(null);
  const [snapshotPreparing, setSnapshotPreparing] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [summaryData, setSummaryData] = useState(null);
  const [executedTestFiles, setExecutedTestFiles] = useState([]);
  const [catalogData, setCatalogData] = useState(null);
  const [featuresData, setFeaturesData] = useState(null);
  const [latestDraft, setLatestDraft] = useState(null);
  const [setupReport, setSetupReport] = useState(null);

  const [activeJobId, setActiveJobId] = useState(null);
  const [activeAssessmentId, setActiveAssessmentId] = useState(null);
  const [runningTests, setRunningTests] = useState(false);
  const [runningTarget, setRunningTarget] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);

  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [applyingDraft, setApplyingDraft] = useState(false);
  const [fixingTarget, setFixingTarget] = useState(null);
  const [deletingTarget, setDeletingTarget] = useState(null);
  const [pendingSystemOps, setPendingSystemOps] = useState(() =>
    loadStagedOps("system", snapshotId),
  );
  const [isApplyingPending, setIsApplyingPending] = useState(false);

  useEffect(() => {
    setPendingSystemOps(loadStagedOps("system", snapshotId));
  }, [snapshotId]);

  useEffect(() => {
    saveStagedOps("system", snapshotId, pendingSystemOps);
  }, [snapshotId, pendingSystemOps]);

  const pendingOpsCount = countStagedOps(pendingSystemOps);

  const [setupOpen, setSetupOpen] = useState(false);
  const [focusServiceId, setFocusServiceId] = useState();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [generatorView, setGeneratorView] = useState(null);
  const [generationTask, setGenerationTask] = useState();
  const [dismissedGenerationId, setDismissedGenerationId] = useState(null);
  const generationRunning = generationTask?.state === "RUNNING";
  const runningGenerationId = generationRunning ? generationTask.id : null;
  const [inspectedScenario, setInspectedScenario] = useState(null);
  const [editorModal, setEditorModal] = useState({
    open: false,
    mode: "edit",
    defaultTestFile: "",
    scenario: null,
  });

  const activeJobRef = useRef(null);
  const frameworkDiscoveryRef = useRef(null);
  const runRequestRef = useRef(false);
  const pendingRunRef = useRef(null);
  const cancelGenerationRef = useRef(null);
  const applyJobUpdateRef = useRef(null);

  const workspace = useSystemTestWorkspace({
    snapshotId,
    runner: activeFramework,
    executionMode,
    refreshKey,
  });

  const refreshData = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  // The parent keys this workspace by snapshot, so generation state starts fresh per snapshot.
  useEffect(() => {
    if (!snapshotId) return;

    const controller = new AbortController();
    getSystemGenerationStatus(snapshotId, controller.signal)
      .then((task) => {
        if (controller.signal.aborted) return;
        setGenerationTask((previous) => previous === undefined ? task : previous);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("[SystemTest] Generation status unavailable:", error.message);
        }
      });
    return () => controller.abort();
  }, [snapshotId]);

  useEffect(() => {
    if (!snapshotId || !runningGenerationId) return;
    let active = true;
    let canceling = false;
    let request = null;

    async function refreshStatus() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const task = await getSystemGenerationStatus(snapshotId, controller.signal);
        if (controller.signal.aborted) return;
        setGenerationTask(task);
        if (task?.id === runningGenerationId && task.state === "SUCCEEDED") {
          if (projectId) invalidateProjectTree(projectId, snapshotId);
          refreshData();
          window.dispatchEvent(new CustomEvent("covai:ai-usage-updated"));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("[SystemTest] Generation status unavailable:", error.message);
        }
      } finally {
        if (request === controller) request = null;
      }
    }

    const timer = setInterval(() => {
      if (!request && !canceling) void refreshStatus();
    }, 2000);

    cancelGenerationRef.current = async () => {
      if (canceling) return;
      canceling = true;
      request?.abort();
      try {
        await cancelSystemGeneration(snapshotId);
        if (active) await refreshStatus();
      } catch (error) {
        if (active) {
          setError(error.response?.data?.message || error.message || "Could not cancel generation.");
        }
      } finally {
        canceling = false;
      }
    };

    return () => {
      active = false;
      request?.abort();
      clearInterval(timer);
      cancelGenerationRef.current = null;
    };
  }, [snapshotId, runningGenerationId, projectId, refreshData]);

  function openGenerator() {
    if (!generationRunning) setGeneratorView("latest");
  }

  function openExternalSetup(serviceId) {
    setFocusServiceId(serviceId);
    setSetupOpen(true);
  }

  // Restore any queued/running assessment job after refresh
  useEffect(() => {
    let ignore = false;
    if (!snapshotId) return;
    systemEvidenceRequest(snapshotId, "assessments")
      .then((record) => {
        if (ignore || !record?.jobId || !["QUEUED", "RUNNING"].includes(record.status)) return;
        activeJobRef.current = record.jobId;
        setActiveJobId(record.jobId);
        if (record.id) setActiveAssessmentId(record.id);
        setRunningTests(true);
        setJobProgress({
          progress: 5,
          stage: "Resuming status",
          message: "Checking the existing system test job...",
        });
      })
      .catch(() => {
        /* Evidence endpoint optional */
      });
    return () => {
      ignore = true;
    };
  }, [snapshotId]);

  // Discover Playwright / Cypress frameworks & spec files
  useEffect(() => {
    let ignore = false;
    let retryTimer;
    if (!projectId || !snapshotId) return;

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
          const recFw = response?.data?.recommendedFramework;
          if (recFw === "cypress" || recFw === "playwright") {
            setActiveFramework(recFw);
          } else if (
            list.some((f) => f.name?.toLowerCase().includes("cypress")) &&
            !list.some((f) => f.name?.toLowerCase().includes("playwright"))
          ) {
            setActiveFramework("cypress");
          }
        }
      })
      .catch((err) => {
        if (ignore) return;
        const message =
          err.response?.data?.message || err.message || "Could not check system test files.";
        if (err.response?.status === 409 && /not ready/i.test(message)) {
          setSnapshotPreparing(true);
          retryTimer = setTimeout(() => setRefreshKey((v) => v + 1), 3000);
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

  // Load Summary + Executed Scenarios + Catalog + Features + Latest Draft + Setup Preflight
  useEffect(() => {
    let ignore = false;
    async function loadAll() {
      if (!snapshotId) {
        if (!ignore) setLoading(false);
        return;
      }
      try {
        const filters = { runner: activeFramework };
        const [sumRes, catRes, featRes, draftRes, setupRes] = await Promise.all([
          getSystemTestSummary(snapshotId, filters).catch(() => null),
          systemEvidenceRequest(snapshotId, "catalog").catch(() => null),
          systemEvidenceRequest(snapshotId, "catalog/features").catch(() => null),
          systemEvidenceRequest(snapshotId, "generation-drafts/latest").catch(() => null),
          systemEvidenceRequest(snapshotId, "setup").catch(() => null),
        ]);
        if (ignore) return;

        const sum = sumRes?.data || null;
        setSummaryData(sum);
        setCatalogData(catRes || null);
        setFeaturesData(featRes || null);
        setLatestDraft(draftRes || null);
        setSetupReport(setupRes || null);

        if (sum?.hasRun && sum?.testRunId) {
          const scRes = await getSystemTestScenarios(snapshotId, {
            ...filters,
            testRunId: sum.testRunId,
          }).catch(() => null);
          if (!ignore) {
            setExecutedTestFiles(scRes?.data?.testFiles || []);
          }
        } else {
          setExecutedTestFiles([]);
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err.response?.data?.message || err.message || "Failed to load system test data.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadAll();
    return () => {
      ignore = true;
    };
  }, [snapshotId, activeFramework, executionMode, refreshKey]);

  // Focus external scenario click (e.g. from AI Chat or Explorer)
  useEffect(() => {
    if (!focusScenario) return;
    setInspectedScenario(focusScenario);
  }, [focusScenario]);

  const { selectAssessment } = workspace;

  const applyJobUpdate = useCallback(
    (payload) => {
      if (!activeJobRef.current || payload.jobId !== activeJobRef.current) return;
      const status = String(payload.status || "").toUpperCase();
      if (["FAILED", "CANCELED", "CANCELLED", "SUCCESS", "COMPLETED"].includes(status)) {
        activeJobRef.current = null;
        setRunningTests(false);
        setRunningTarget(null);
        setJobProgress(null);
        setActiveJobId(null);

        if (status === "FAILED") {
          const msg = payload.errorMessage || payload.message || "Execution error";
          setError(`System test job failed: ${msg}`);
          if (/requires test environment configuration|SYSTEM_TEST_ENVIRONMENT_REQUIRED/i.test(msg)) {
            setSetupOpen(true);
          }
        } else if (status === "CANCELED" || status === "CANCELLED") {
          setNotice("System test job was canceled.");
        } else {
          if (activeAssessmentId) selectAssessment(activeAssessmentId);
          setNotice("System test execution completed. Results synced to matrix & report.");
        }
        refreshData();
        return;
      }

      setJobProgress((prev) => ({
        progress: payload.progress ?? prev?.progress ?? 0,
        stage: payload.stage || prev?.stage || "Running",
        message: payload.message || prev?.message || "Executing E2E tests...",
      }));
    },
    [activeAssessmentId, selectAssessment, refreshData],
  );

  useEffect(() => {
    applyJobUpdateRef.current = applyJobUpdate;
  }, [applyJobUpdate]);

  // Poll active job details for resilience across reconnects
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

          applyJobUpdateRef.current?.({
            ...response.job,
            jobId: response.job.id,
            ...(stageLog
              ? {
                  stage: "Measuring system tests",
                  message: stageLog.message.slice("Assessment stage: ".length),
                }
              : {}),
          });
        }
      } catch {
        // Retry silently on transient poll errors while Socket.IO runs
      }
      if (!ignore && activeJobRef.current === activeJobId) {
        timer = setTimeout(poll, 2500);
      }
    };
    poll();
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [activeJobId]);

  // Socket.IO live job updates
  useEffect(() => {
    if (!snapshotId) return;
    const socket = io(SOCKET_URL, { auth: socketAuth });
    attachSocketAuthRecovery(socket);

    socket.on("connect", () => {
      try {
        const token = getAccessToken();
        if (token) {
          const userId = JSON.parse(atob(token.split(".")[1]))?.userId;
          if (userId) socket.emit("subscribe_notifications", userId);
        }
      } catch {
        // Poll fallback active
      }
    });

    socket.on("job:progress", (payload) => {
      applyJobUpdateRef.current?.(payload);
    });

    return () => {
      socket.disconnect();
    };
  }, [snapshotId]);

  // Build unified Spec File / Feature groups from Executed Run + Disk Frameworks + Catalog + Unapplied Draft
  const specGroups = useMemo(() => {
    const byFile = new Map();

    const ensureGroup = (rawPath, meta = {}) => {
      const filePath = normalizeSpecPath(rawPath);
      if (!filePath) return null;
      if (!byFile.has(filePath)) {
        byFile.set(filePath, {
          key: filePath,
          filePath,
          featureName: meta.featureName || "",
          routes: new Set(meta.routes || []),
          scenarios: [],
          hasDraft: false,
          hasDraftOnly: false,
          seenTitles: new Set(),
        });
      }
      const g = byFile.get(filePath);
      if (meta.featureName && !g.featureName) g.featureName = meta.featureName;
      for (const r of meta.routes || []) g.routes.add(r);
      return g;
    };

    // 1. Seed discovered files from frameworks endpoint
    const fwList = frameworksData?.frameworks || [];
    for (const fw of fwList) {
      if (activeFramework && fw.name && !fw.name.toLowerCase().includes(activeFramework)) continue;
      for (const f of fw.files || []) {
        ensureGroup(typeof f === "string" ? f : f.filePath || f.path || "");
      }
    }

    const inferSpecOrigin = (filePath = "", fallback = "PROJECT_EXISTING") => {
      if (/(?:^|\/)covai-[a-f0-9]+\.(?:spec|cy)\./i.test(String(filePath || ""))) {
        return "AI_GENERATED";
      }
      return fallback;
    };

    // 2. Attach executed scenarios from latest run
    for (const tf of executedTestFiles || []) {
      const g = ensureGroup(tf.filePath);
      if (!g) continue;
      for (const sc of tf.scenarios || []) {
        const title = sc.title || sc.testName || "Unnamed scenario";
        const keyTitle = title.trim().toLowerCase();
        const normTestFile = normalizeSpecPath(sc.testFile || tf.filePath);
        g.seenTitles.add(keyTitle);
        g.scenarios.push({
          ...sc,
          testFile: normTestFile,
          title,
          origin: sc.origin || inferSpecOrigin(normTestFile, "PROJECT_EXISTING"),
        });
      }
    }

    // 3. Merge catalog scenarios not yet executed in the current run
    for (const cs of catalogData?.scenarios || []) {
      const g = ensureGroup(cs.filePath || cs.testFile, {
        featureName: cs.featureName || cs.feature || "",
        routes: cs.route ? [cs.route] : [],
      });
      if (!g) continue;
      const title = cs.title || cs.name || cs.testName;
      if (!title) continue;
      const keyTitle = title.trim().toLowerCase();
      if (!g.seenTitles.has(keyTitle)) {
        g.seenTitles.add(keyTitle);
        g.scenarios.push({
          id: cs.id || `${g.filePath}::${title}`,
          title,
          testFile: g.filePath,
          status: "NOT_RUN",
          origin: cs.origin || inferSpecOrigin(g.filePath, "PROJECT_EXISTING"),
          featureName: cs.featureName || "",
        });
      }
    }

    // 4. Attach feature metadata if available
    for (const feat of featuresData?.features || []) {
      for (const f of feat.files || feat.testFiles || []) {
        ensureGroup(f, {
          featureName: feat.name || feat.title || "",
          routes: feat.routes || [],
        });
      }
    }

    // 5. Merge pending AI Draft scenarios (not yet applied to disk)
    const draftActive =
      latestDraft &&
      !latestDraft.applied &&
      !latestDraft.appliedAt &&
      ["GENERATED", "REVIEWED", "PENDING", "DRAFT"].includes(
        String(latestDraft.state || latestDraft.status || "DRAFT").toUpperCase(),
      );

    const draftFiles = draftActive
      ? Array.isArray(latestDraft.files) && latestDraft.files.length > 0
        ? latestDraft.files
        : latestDraft.filePath
          ? [{ filePath: latestDraft.filePath, content: latestDraft.code || "", scenarios: latestDraft.scenarios || [] }]
          : []
      : [];

    for (const df of draftFiles) {
      const hadExisting = byFile.has(normalizeSpecPath(df.filePath));
      const g = ensureGroup(df.filePath);
      if (!g) continue;
      g.hasDraft = true;
      if (!hadExisting) g.hasDraftOnly = true;
      const draftTitles =
        Array.isArray(df.scenarios) && df.scenarios.length > 0
          ? df.scenarios.map((s) => s.title || s.name).filter(Boolean)
          : extractDraftTitlesFromCode(df.content || "");
      for (const t of draftTitles) {
        const kt = t.trim().toLowerCase();
        if (!g.seenTitles.has(kt)) {
          g.seenTitles.add(kt);
          g.scenarios.push({
            id: `draft::${g.filePath}::${t}`,
            title: t,
            testFile: g.filePath,
            status: "NOT_RUN",
            origin: "AI_DRAFT",
          });
        }
      }
    }

    const resultGroups = Array.from(byFile.values()).map((g) => {
      const stagedBase = (g.scenarios || [])
        .filter((sc) => {
          const t = {
            key: sc.id,
            id: sc.id,
            testFile: sc.testFile || g.filePath,
            testName: sc.title || sc.testName,
          };
          return !(pendingSystemOps.deletes || []).some((d) => matchesStagedTarget(d, t));
        })
        .map((sc) => {
          const t = {
            key: sc.id,
            id: sc.id,
            testFile: sc.testFile || g.filePath,
            testName: sc.title || sc.testName,
          };
          const upd = (pendingSystemOps.updates || []).find((u) => matchesStagedTarget(u, t));
          if (!upd) return sc;
          return {
            ...sc,
            title: upd.testName || sc.title,
            code: upd.code,
            stagedEdit: true,
          };
        });
      const stagedAdds = (pendingSystemOps.adds || [])
        .filter((a) => normalizeSpecPath(a.testFile) === g.filePath)
        .map((a) => ({
          id: a.id,
          title: a.testName || a.title,
          testFile: g.filePath,
          code: a.code,
          status: "NOT_RUN",
          origin: "STAGED_ADD",
          stagedTemp: true,
        }));
      const scenarios = [...stagedBase, ...stagedAdds];
      return {
        ...g,
        scenarios,
        routes: Array.from(g.routes),
        caseCov: getSystemGroupCaseCoverage(g, scenarios),
      };
    });

    // Also include staged adds targeting brand new spec files
    for (const a of pendingSystemOps.adds || []) {
      const nf = normalizeSpecPath(a.testFile);
      if (!nf || resultGroups.some((g) => g.filePath === nf)) continue;
      const scenarios = [
        {
          id: a.id,
          title: a.testName || a.title,
          testFile: nf,
          code: a.code,
          status: "NOT_RUN",
          origin: "STAGED_ADD",
          stagedTemp: true,
        },
      ];
      const stub = {
        key: nf,
        filePath: nf,
        featureName: "",
        routes: [],
        scenarios,
        hasDraft: false,
        hasDraftOnly: false,
      };
      resultGroups.push({
        ...stub,
        caseCov: getSystemGroupCaseCoverage(stub, scenarios),
      });
    }

    return resultGroups;
  }, [frameworksData, activeFramework, executedTestFiles, catalogData, featuresData, latestDraft, pendingSystemOps]);

  // Unified telemetry counters
  const telemetry = useMemo(() => {
    const allScenarios = specGroups.flatMap((g) => g.scenarios || []);
    const totalScenarios = summaryData?.totalTests ?? allScenarios.length;
    const passedScenarios =
      summaryData?.passedTests ??
      allScenarios.filter((s) => ["PASS", "PASSED"].includes(String(s.status || "").toUpperCase())).length;
    const failedScenarios =
      summaryData?.failedTests ??
      allScenarios.filter((s) =>
        ["FAIL", "FAILED", "ERROR", "TIMEDOUT", "INTERRUPTED"].includes(String(s.status || "").toUpperCase()),
      ).length;
    const flakyScenarios =
      summaryData?.flakyTests ??
      allScenarios.filter((s) => String(s.status || "").toUpperCase() === "FLAKY").length;
    const passRate = totalScenarios > 0 ? Math.round((passedScenarios / totalScenarios) * 100) : 0;

    const totalCases = specGroups.reduce((sum, g) => sum + (g.caseCov?.totalRequired || 0), 0);
    const coveredCases = specGroups.reduce((sum, g) => sum + (g.caseCov?.coveredCount || 0), 0);

    // Compute measured Istanbul coverage across frontend/backend tiers if available
    const covObj = summaryData?.coverageSummary || workspace.assessment?.coverage || null;
    const tiers = covObj?.tiers || {};
    let covCoveredLines = 0;
    let covTotalLines = 0;
    let covCoveredStmts = 0;
    let covTotalStmts = 0;
    let covCoveredFuncs = 0;
    let covTotalFuncs = 0;
    let covCoveredBranches = 0;
    let covTotalBranches = 0;
    for (const tier of Object.values(tiers)) {
      if (!tier?.counters) continue;
      covCoveredLines += Number(tier.counters.lines?.covered || 0);
      covTotalLines += Number(tier.counters.lines?.total || 0);
      covCoveredStmts += Number(tier.counters.statements?.covered || 0);
      covTotalStmts += Number(tier.counters.statements?.total || 0);
      covCoveredFuncs += Number(tier.counters.functions?.covered || 0);
      covTotalFuncs += Number(tier.counters.functions?.total || 0);
      covCoveredBranches += Number(tier.counters.branches?.covered || 0);
      covTotalBranches += Number(tier.counters.branches?.total || 0);
    }
    const calcPct = (cov, tot, fallback) =>
      tot > 0 ? Number(((cov * 100) / tot).toFixed(1)) : (fallback ?? null);
    const codeLinesPct = calcPct(covCoveredLines, covTotalLines, covObj?.linesPct);
    const codeStmtsPct = calcPct(covCoveredStmts, covTotalStmts, covObj?.statementsPct);
    const codeFuncsPct = calcPct(covCoveredFuncs, covTotalFuncs, covObj?.functionsPct);
    const codeBranchesPct = calcPct(covCoveredBranches, covTotalBranches, covObj?.branchesPct);
    const hasCodeCoverage = codeLinesPct !== null || covObj?.linesPct != null;

    return {
      totalSpecs: specGroups.length,
      totalScenarios,
      passedScenarios,
      failedScenarios,
      flakyScenarios,
      passRate,
      totalCases,
      coveredCases,
      codeLinesPct: codeLinesPct ?? 0,
      codeStmtsPct: codeStmtsPct ?? 0,
      codeFuncsPct: codeFuncsPct ?? 0,
      codeBranchesPct: codeBranchesPct ?? 0,
      hasCodeCoverage,
      durationMs: summaryData?.durationMs ?? 0,
      hasRun: Boolean(summaryData?.hasRun) || passedScenarios + failedScenarios + flakyScenarios > 0,
    };
  }, [specGroups, summaryData, workspace.assessment]);

  // Sync context to AI Chatbot
  useChatTestContext(onChatContextChange, {
    projectId,
    snapshotId,
    testType: "system",
    testRunId: summaryData?.testRunId,
    scenarioId: inspectedScenario?.id,
    displayedMetrics: {
      kind: "system",
      tab: activeTab,
      framework: summaryData?.runner || activeFramework,
      executionMode,
      assessmentId: workspace.assessment?.id,
      state: telemetry.hasRun ? "ready" : loading ? "loading" : "not-run",
      counts: telemetry.hasRun
        ? {
            scenarios: telemetry.totalScenarios,
            passed: telemetry.passedScenarios,
            failed: telemetry.failedScenarios,
            flaky: telemetry.flakyScenarios,
            durationMs: telemetry.durationMs,
            passRate: telemetry.passRate,
          }
        : undefined,
    },
  });

  // Execute System Tests (Full Suite, Selected Specs, or Specific Scenarios) without Confirm Expected blocker
  const handleRunTests = useCallback(
    async ({ selectedFiles = null, selectedTitles = null, onlyFile = null, targetLabel = null } = {}) => {
      if (!projectAccess.can("tests.run") || !snapshotId) return;
      if (runRequestRef.current || activeJobRef.current) return;

      runRequestRef.current = true;
      setError(null);
      setNotice(null);

      try {
        if (pendingOpsCount > 0) {
          const ok = await flushPendingSystemOps({ reload: false });
          if (!ok) {
            runRequestRef.current = false;
            return;
          }
        }
        // Preflight environment check (reuses setup dialog when app runtime/DB config missing)
        const setup = await systemEvidenceRequest(snapshotId, "setup").catch(() => null);
        if (setup) {
          setSetupReport(setup);
          if (!setup.ready) {
            runRequestRef.current = false;
            if (setup.issues?.some((issue) => issue.code === "ENVIRONMENT_REQUIRED")) {
              pendingRunRef.current = { selectedFiles, selectedTitles, onlyFile, targetLabel };
              setSetupOpen(true);
            } else {
              setError(setup.issues?.map((i) => i.message).join(" ") || "System test setup incomplete.");
            }
            return;
          }
        }

        setActiveTab("live");
        setRunningTests(true);
        setRunningTarget(targetLabel || onlyFile || "suite");
        setJobProgress({
          progress: 5,
          stage: "Starting",
          message: selectedTitles?.length
            ? `Queuing ${selectedTitles.length} selected scenario(s)...`
            : selectedFiles?.length
              ? `Queuing ${selectedFiles.length} selected spec file(s)...`
              : "Queuing full-stack system test execution...",
        });

        let responseData = null;

        // Prefer /assessments for Playwright (full suite, selected specs, or individual live test case)
        // so live screenshots, Chromium frames, step logs, and Istanbul code coverage stream cleanly.
        const effectiveSelectedFiles = selectedFiles?.length
          ? selectedFiles
          : onlyFile
            ? [onlyFile]
            : undefined;
        if (activeFramework === "playwright") {
          try {
            const capabilities = await systemEvidenceRequest(snapshotId, "capabilities").catch(() => null);
            if (capabilities?.enabled && capabilities.coverageEnabled) {
              const assessRes = await systemEvidenceRequest(snapshotId, "assessments", {
                method: "POST",
                data: {
                  autoDiscover: true,
                  runner: "playwright",
                  executionMode,
                  allowGenerate: false,
                  headed: headedMode,
                  ...(effectiveSelectedFiles ? { selectedFiles: effectiveSelectedFiles } : {}),
                  ...(selectedTitles?.length ? { selectedTitles } : {}),
                  ...(selectedTitles?.length || onlyFile ? { repeatRuns: 1 } : {}),
                },
              });
              if (assessRes?.jobId) {
                responseData = assessRes;
              }
            }
          } catch {
            // Fall through cleanly to runSystemTest
          }
        }

        if (!responseData) {
          let runRes;
          try {
            runRes = await runSystemTest(snapshotId, {
              framework: activeFramework,
              executionMode,
              testFile: onlyFile || undefined,
              selectedFiles: selectedFiles?.length ? selectedFiles : undefined,
              selectedTitles: selectedTitles?.length ? selectedTitles : undefined,
              headed: headedMode,
            });
          } catch (runErr) {
            const runMsg = runErr?.response?.data?.message || runErr?.message || "";
            if (
              executionMode === "full" &&
              /real backend|API mocks|Frontend mode/i.test(runMsg)
            ) {
              runRes = await runSystemTest(snapshotId, {
                framework: activeFramework,
                executionMode: "frontend",
                testFile: onlyFile || undefined,
                selectedFiles: selectedFiles?.length ? selectedFiles : undefined,
                selectedTitles: selectedTitles?.length ? selectedTitles : undefined,
                headed: headedMode,
              });
            } else {
              throw runErr;
            }
          }
          responseData = runRes?.data || runRes;
        }

        const jid = responseData?.jobId;
        if (!jid) {
          throw new Error("Server did not return a system test job ID.");
        }

        activeJobRef.current = jid;
        setActiveJobId(jid);
        if (responseData?.assessmentId || responseData?.id) {
          setActiveAssessmentId(responseData.assessmentId || responseData.id);
        }
        setRefreshKey((k) => k + 1);
      } catch (err) {
        setRunningTests(false);
        setRunningTarget(null);
        setJobProgress(null);
        const msg = err.response?.data?.message || err.message || "Failed to start system test run.";
        if (
          err.response?.data?.code === "SYSTEM_TEST_ENVIRONMENT_REQUIRED" ||
          /requires test environment configuration/i.test(msg)
        ) {
          setSetupOpen(true);
        }
        setError(msg);
      } finally {
        runRequestRef.current = false;
      }
    },
    [projectAccess, snapshotId, activeFramework, executionMode, headedMode],
  );

  // Sync spec catalog from disk
  const handleSyncCatalog = async () => {
    if (!snapshotId || syncingCatalog) return;
    setSyncingCatalog(true);
    setError(null);
    try {
      await systemEvidenceRequest(snapshotId, "catalog/sync", { method: "POST" });
      setNotice("Spec files scanned and synced into catalog.");
      refreshData();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to sync spec catalog.");
    } finally {
      setSyncingCatalog(false);
    }
  };

  // Apply pending AI Draft inline from Matrix
  const handleApplyDraft = async (draft) => {
    if (!snapshotId || !draft?.aiTestId && !draft?.id) return;
    const draftId = draft.aiTestId || draft.id;
    setApplyingDraft(true);
    setError(null);
    try {
      await systemEvidenceRequest(snapshotId, `generation-drafts/${draftId}/apply`, {
        method: "POST",
        data: {
          expectedCandidateHash: draft.candidateHash,
          reviewed: true,
          approveSharedSetup: true,
        },
      });
      setNotice("AI generated system tests applied to workspace.");
      if (projectId) invalidateProjectTree(projectId, snapshotId);
      refreshData();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to apply generated draft.");
    } finally {
      setApplyingDraft(false);
    }
  };

  const flushPendingSystemOps = async ({ reload = true } = {}) => {
    if (!snapshotId || countStagedOps(pendingSystemOps) === 0) return true;
    setIsApplyingPending(true);
    setError(null);
    try {
      for (const d of pendingSystemOps.deletes || []) {
        await deleteSystemTestCaseApi(snapshotId, {
          testFile: d.testFile,
          testName: d.testName || d.title,
        });
      }
      for (const u of pendingSystemOps.updates || []) {
        await updateSystemTestCaseApi(snapshotId, {
          testFile: u.testFile,
          testName: u.originalTestName || u.testName,
          code: u.code,
        });
      }
      for (const a of pendingSystemOps.adds || []) {
        await addSystemTestCaseApi(snapshotId, {
          testFile: a.testFile,
          testName: a.testName,
          code: a.code,
          runner: a.framework || activeFramework,
        });
      }
      const cleared = { deletes: [], updates: [], adds: [] };
      setPendingSystemOps(cleared);
      saveStagedOps("system", snapshotId, cleared);
      if (projectId) invalidateProjectTree(projectId, snapshotId);
      if (reload) refreshData();
      setNotice("Applied all temporary system test edits, additions, and deletions to spec files.");
      return true;
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to apply temporary system test changes.");
      return false;
    } finally {
      setIsApplyingPending(false);
    }
  };

  // Delete single test scenario instantaneously in temporary UI state until user clicks Apply
  const handleDeleteScenario = async (sc, group) => {
    const testFile = sc.testFile || group?.filePath;
    const testName = sc.title || sc.testName;
    if (!snapshotId || !testFile || !testName) return;

    setError(null);
    setPendingSystemOps((prev) =>
      stageDeleteOp(prev, {
        key: sc.id || `${testFile}::${testName}`,
        id: sc.id,
        testFile,
        testName,
        title: testName,
      }),
    );
    setNotice(`Removed "${testName}" in UI (Temp). Click Apply Changes to update ${testFile}.`);
  };

  // AI Fix single failing scenario
  const handleAIFixScenario = async (sc, group) => {
    const testFile = sc.testFile || group?.filePath;
    const testName = sc.title || sc.testName;
    if (!snapshotId || !testFile || !testName) return;

    const key = `${testFile}::${testName}`;
    setFixingTarget(key);
    setError(null);
    try {
      const failureMessage = Array.isArray(sc.failureMessages)
        ? sc.failureMessages.join("\n")
        : sc.failureMessages || sc.failureSummary || "System test failed";

      await aiFixSystemTestCaseApi(snapshotId, {
        testFile,
        testName,
        failureMessage,
        failureStep: sc.failureBreakpoint?.action || sc.failureBreakpoint?.url || "",
        runner: activeFramework,
      });

      window.dispatchEvent(new CustomEvent("covai:ai-usage-updated"));
      setNotice(`AI Fix patched "${testName}" in ${testFile}. Click Run to re-verify.`);
      if (projectId) invalidateProjectTree(projectId, snapshotId);
      refreshData();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "AI Fix failed for this scenario.");
    } finally {
      setFixingTarget(null);
    }
  };

  const entryState = systemTestEntryState({
    discovery: frameworksData,
    error: discoveryError,
    activeJob: runningTests || !!activeJobId,
  });

  if (showPrintableReport && workspace.assessment) {
    return (
      <SystemTestReportView
        assessment={workspace.assessment}
        snapshotId={snapshotId}
        onBack={() => setShowPrintableReport(false)}
      />
    );
  }

  if (entryState === "loading" && specGroups.length === 0) {
    return (
      <div className="w-full h-full min-h-[360px] flex flex-col items-center justify-center p-10 text-center space-y-3 bg-[var(--color-bg)] text-[var(--color-text)]">
        <Loader2 size={28} className="animate-spin text-[var(--color-primary)]" />
        <p className="text-sm font-semibold">
          {snapshotPreparing ? "Preparing imported snapshot..." : "Loading System Test Cockpit..."}
        </p>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Inspecting Playwright / Cypress specs and application telemetry.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-text overflow-hidden">
      {/* ── 1. SLEEK INDUSTRIAL COCKPIT HEADER ── */}
      <header className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] z-20 relative">
        {loading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-surface-secondary)] overflow-hidden">
            <div className="h-full bg-[var(--color-primary)] animate-pulse w-full" />
          </div>
        )}

        <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] flex items-center justify-center">
              <Globe size={15} />
            </div>
            <h1 className="text-sm font-semibold text-[var(--color-text)] tracking-tight m-0">
              System Test Coverage
            </h1>

            {/* Runner Switcher */}
            <div className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5 text-[11px] font-mono">
              {["playwright", "cypress"].map((fw) => (
                <button
                  key={fw}
                  type="button"
                  onClick={() => setActiveFramework(fw)}
                  className={`px-2 py-0.5 rounded uppercase transition-colors cursor-pointer ${
                    activeFramework === fw
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-semibold"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {fw}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer"
              title="Inspect runtime server URL, start command and test setup"
            >
              <SlidersHorizontal size={13} className="text-[var(--color-text-muted)]" />
              <span>Test Setup</span>
              {setupReport?.issues?.length > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 font-mono text-[10px]">
                  {setupReport.issues.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={refreshData}
              disabled={loading || runningTests}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setHeadedMode((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                headedMode
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30"
                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border-[var(--color-border)]"
              }`}
              title="Show visible Chromium window while running Playwright on desktop"
            >
              <Monitor size={12} />
              <span className="hidden lg:inline">Headed</span>
            </button>

            <button
              type="button"
              onClick={() => handleRunTests()}
              disabled={!projectAccess.can("tests.run") || runningTests}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors active:scale-[0.98] cursor-pointer disabled:opacity-50"
              title="Run full-stack E2E system test suite"
            >
              {runningTests ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
              <span>{runningTests ? "Running E2E..." : "Run Coverage"}</span>
            </button>

            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer"
              title="System test suite version history (v1 / v2) and restore"
            >
              <Clock size={13} />
              <span className="hidden md:inline">History</span>
            </button>
          </div>
        </div>

        {/* ── 2. UNIFIED TELEMETRY STRIP ── */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]/60">
          <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] overflow-hidden">
            {/* Primary Anchor: Measured Code Coverage & E2E Scenario Verification */}
            <div className="lg:col-span-5 px-4 py-3 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>{telemetry.hasCodeCoverage ? "System code coverage" : "E2E scenario verification"}</span>
                <span className="font-mono tabular-nums text-[var(--color-text-muted)] text-[11px]">
                  {telemetry.hasCodeCoverage
                    ? `S ${telemetry.codeStmtsPct.toFixed(0)}% · B ${telemetry.codeBranchesPct.toFixed(0)}% · F ${telemetry.codeFuncsPct.toFixed(0)}% · ${telemetry.passedScenarios}/${telemetry.totalScenarios} E2E`
                    : `${telemetry.passedScenarios}/${telemetry.totalScenarios} passed · ${(telemetry.durationMs / 1000).toFixed(1)}s`}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                    {telemetry.hasCodeCoverage ? `${telemetry.codeLinesPct.toFixed(1)}%` : `${telemetry.passRate}%`}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {telemetry.hasCodeCoverage ? "lines" : "verified"}
                  </span>
                </div>
                <div className="flex-1 max-w-[160px] bg-[var(--color-surface-secondary)] h-1.5 rounded-sm overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      (telemetry.hasCodeCoverage ? telemetry.codeLinesPct : telemetry.passRate) >= 80
                        ? "bg-emerald-500"
                        : (telemetry.hasCodeCoverage ? telemetry.codeLinesPct : telemetry.passRate) >= 50
                          ? "bg-amber-500"
                          : "bg-[var(--color-primary)]"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, telemetry.hasCodeCoverage ? telemetry.codeLinesPct : telemetry.passRate))}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Specs & Required Cases */}
            <div className="lg:col-span-4 px-4 py-3 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Specs &amp; E2E cases</span>
                <span className="font-mono tabular-nums text-[11px] text-[var(--color-text-muted)]">
                  {telemetry.totalSpecs} spec files
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                <span className="text-xl font-bold text-[var(--color-text)]">
                  {telemetry.coveredCases}/{telemetry.totalCases}
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">cases covered</span>
              </div>
            </div>

            {/* Health */}
            <div className="lg:col-span-3 px-4 py-3 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Suite Health</span>
                <span className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
                  full-stack
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs">
                {!telemetry.hasRun ? (
                  <span className="text-[var(--color-text-muted)]">• Not run yet</span>
                ) : telemetry.failedScenarios > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold tabular-nums">
                    <XCircle size={13} />
                    <span>{telemetry.failedScenarios} failed</span>
                  </span>
                ) : telemetry.flakyScenarios > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold tabular-nums">
                    <AlertTriangle size={13} />
                    <span>{telemetry.flakyScenarios} flaky</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                    <CheckCircle2 size={13} />
                    <span>All Passing</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. NAVIGATION TABS (3 Tabs matching A1) ── */}
        <div className="px-5 border-t border-[var(--color-border)] flex items-center justify-between gap-3">
          <nav className="flex items-center gap-1 -mb-px">
            <button
              type="button"
              onClick={() => setActiveTab("matrix")}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === "matrix"
                  ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              <Sparkles size={13} />
              <span>Flows &amp; Specs Matrix</span>
              <span className="px-1.5 py-0.2 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] font-mono text-[10px] tabular-nums">
                {specGroups.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("live")}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === "live"
                  ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              <Activity size={13} />
              <span>Live Run</span>
              {runningTests && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("report")}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === "report"
                  ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              <BarChart3 size={13} />
              <span>Executive Report</span>
              {telemetry.failedScenarios > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-400 font-mono text-[10px] tabular-nums">
                  {telemetry.failedScenarios} failed
                </span>
              )}
            </button>
          </nav>

          {jobProgress && (
            <div className="text-[11px] font-mono text-[var(--color-text-secondary)] flex items-center gap-2 py-1">
              <Loader2 size={11} className="animate-spin text-[var(--color-primary)]" />
              <span className="truncate max-w-[320px]">
                {jobProgress.stage}: {jobProgress.message} ({jobProgress.progress ?? 0}%)
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="shrink-0 space-y-3 px-5 pt-3 empty:hidden">
        {generationTask && generationTask.state !== "CANCELED" && generationTask.id !== dismissedGenerationId && (
          <GenerationProgressStrip
            key={generationTask.id}
            task={generationTask}
            onCancel={() => cancelGenerationRef.current?.()}
            onReview={() => setGeneratorView("review")}
            onRetry={() => setGeneratorView("generate")}
            onDismiss={() => setDismissedGenerationId(generationTask.id)}
          />
        )}
        <ExternalServicesBanner
          setup={setupReport}
          summary={summaryData}
          onOpenSetup={openExternalSetup}
          onRunTests={() => handleRunTests()}
          running={runningTests}
        />
      </div>

      {/* ── MAIN WORKSPACE CONTENT ── */}
      <main className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        <SystemTestErrorNotice
          message={error || discoveryError}
          onDismiss={() => {
            setError(null);
            setDiscoveryError(null);
          }}
          onOpenLogs={() => openFloatingJobQueue({ domain: "system" })}
          onOpenSetup={() => setSetupOpen(true)}
        />

        {notice && (
          <div className="px-3.5 py-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300 flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-emerald-400 hover:text-emerald-200 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === "matrix" && (
          <SystemSpecMatrixTable
            key={snapshotId || "system"}
            snapshotId={snapshotId}
            specGroups={specGroups}
            framework={activeFramework}
            latestDraft={latestDraft}
            syncingCatalog={syncingCatalog}
            applyingDraft={applyingDraft}
            runningTarget={runningTarget}
            fixingTarget={fixingTarget}
            deletingTarget={deletingTarget}
            canRunTests={projectAccess.can("tests.run")}
            canEditTests={projectAccess.can("tests.edit") || projectAccess.can("tests.run")}
            canUseAi={projectAccess.can("ai.use")}
            onSyncCatalog={handleSyncCatalog}
            onOpenGenerator={openGenerator}
            onGenerateSelected={openGenerator}
            onApplyDraft={handleApplyDraft}
            onRunSelectedFiles={(files) =>
              handleRunTests({ selectedFiles: files, targetLabel: `${files.length} specs` })
            }
            onRunSelectedScenarios={(scenarios) =>
              handleRunTests({
                selectedFiles: [...new Set(scenarios.map((s) => s.filePath).filter(Boolean))],
                selectedTitles: scenarios.map((s) => s.title || s.testName).filter(Boolean),
                targetLabel: `${scenarios.length} scenarios`,
              })
            }
            onRunSpecFile={(group) =>
              handleRunTests({ onlyFile: group.filePath, targetLabel: group.filePath })
            }
            onRunScenario={(sc, group) =>
              handleRunTests({
                onlyFile: sc.testFile || group.filePath,
                selectedTitles: [sc.title || sc.testName],
                targetLabel: sc.title || sc.testName,
              })
            }
            onOpenAddTest={(group) =>
              setEditorModal({
                open: true,
                mode: "add",
                defaultTestFile: group?.filePath || "",
                scenario: null,
              })
            }
            onOpenEditScenario={(sc, group) =>
              setEditorModal({
                open: true,
                mode: "edit",
                defaultTestFile: sc.testFile || group?.filePath || "",
                scenario: sc,
              })
            }
            onDeleteScenario={handleDeleteScenario}
            onAIFixScenario={handleAIFixScenario}
            onInspectScenario={(sc) => setInspectedScenario(sc)}
            onOpenSpecFile={(filePath) => onOpenFile?.(filePath)}
            pendingOpsCount={pendingOpsCount}
            isApplyingPending={isApplyingPending}
            onApplyPendingChanges={() => flushPendingSystemOps({ reload: true })}
            onDiscardPendingChanges={() => {
              const cleared = { deletes: [], updates: [], adds: [] };
              setPendingSystemOps(cleared);
              saveStagedOps("system", snapshotId, cleared);
              setNotice("Discarded temporary system test edits.");
            }}
          />
        )}

        {activeTab === "live" && (
          <SystemTestLiveRun
            projectId={projectId}
            snapshotId={snapshotId}
            activeJobId={activeJobId}
            initialAssessmentId={activeAssessmentId || workspace.assessment?.id || null}
            specGroups={specGroups}
            runningTests={runningTests}
            onRunScenario={(sc, group) =>
              handleRunTests({
                onlyFile: sc.testFile || group?.filePath,
                selectedTitles: [sc.title || sc.testName],
                targetLabel: sc.title || sc.testName,
              })
            }
          />
        )}

        {activeTab === "report" && (
          <SystemReportEmbed
            snapshotId={snapshotId}
            assessment={workspace.assessment}
            specGroups={specGroups}
            summary={summaryData}
            hasRun={telemetry.hasRun}
            canUseAi={projectAccess.can("ai.use")}
            canRunTests={projectAccess.can("tests.run")}
            fixingTarget={fixingTarget}
            isRunning={runningTests}
            onRunCoverage={() => handleRunTests()}
            onOpenFullReport={() => setShowPrintableReport(true)}
            onAIFixScenario={handleAIFixScenario}
            onInspectScenario={(sc) => setInspectedScenario(sc)}
            onRunScenario={(sc, group) =>
              handleRunTests({
                onlyFile: sc.testFile || group.filePath,
                selectedTitles: [sc.title || sc.testName],
                targetLabel: sc.title || sc.testName,
              })
            }
          />
        )}
      </main>

      {/* ── MODALS & DRAWERS ── */}
      <SystemTestCaseEditorModal
        isOpen={editorModal.open}
        onClose={() =>
          setEditorModal({ open: false, mode: "edit", defaultTestFile: "", scenario: null })
        }
        mode={editorModal.mode}
        snapshotId={snapshotId}
        defaultTestFile={editorModal.defaultTestFile}
        scenario={editorModal.scenario}
        framework={activeFramework}
        onSaved={(payload) => {
          const { testFile, testName, runAfterSave, staged, mode, originalTestName, code, framework: fw } = payload || {};
          if (staged) {
            const resolvedTitle = extractBlockTitle(code, testName || "Scenario");
            if (mode === "add") {
              setPendingSystemOps((prev) =>
                stageAddOp(prev, {
                  testFile,
                  testName: resolvedTitle,
                  title: resolvedTitle,
                  code,
                  framework: fw,
                }),
              );
            } else {
              setPendingSystemOps((prev) =>
                stageUpdateOp(prev, {
                  key: editorModal.scenario?.id,
                  id: editorModal.scenario?.id,
                  testFile,
                  originalTestName: originalTestName || editorModal.scenario?.title,
                  testName: resolvedTitle,
                  title: resolvedTitle,
                  code,
                }),
              );
            }
            setNotice(`Saved "${resolvedTitle}" in UI (Temp). Click Apply Changes to write to ${testFile}.`);
            return;
          }
          if (projectId) invalidateProjectTree(projectId, snapshotId);
          refreshData();
          if (runAfterSave && testFile) {
            void handleRunTests({
              onlyFile: testFile,
              selectedTitles: testName ? [testName] : undefined,
              targetLabel: testName || testFile,
            });
          } else {
            setNotice(`Saved "${testName}" in ${testFile}.`);
          }
        }}
      />

      {generatorView && !generationRunning && (
        <SystemTestGeneratorModal
          isOpen
          initialView={generatorView}
          onStarted={setGenerationTask}
          onOpenSetup={openExternalSetup}
          onClose={() => setGeneratorView(null)}
          snapshotId={snapshotId}
          projectId={projectId}
          initialFramework={activeFramework}
          frameworksData={frameworksData}
          executionMode={executionMode}
          onSuccess={() => {
            if (generationTask?.id) setDismissedGenerationId(generationTask.id);
            if (projectId) invalidateProjectTree(projectId, snapshotId);
            refreshData();
          }}
        />
      )}

      {inspectedScenario && (
        <SystemTestBreakpointModal
          isOpen={Boolean(inspectedScenario)}
          onClose={() => setInspectedScenario(null)}
          scenario={inspectedScenario}
          snapshotId={snapshotId}
          onOpenEditor={(filePath) => {
            setInspectedScenario(null);
            onOpenFile?.(filePath);
          }}
        />
      )}

      {setupOpen && (
        <SystemTestSetupDialog
          focusServiceId={focusServiceId}
          projectId={projectId}
          snapshotId={snapshotId}
          onClose={() => {
            pendingRunRef.current = null;
            setFocusServiceId(undefined);
            setSetupOpen(false);
            if (snapshotId) {
              systemEvidenceRequest(snapshotId, "setup")
                .then(setSetupReport)
                .catch((err) => console.warn("[SystemTest] Setup status unavailable:", err?.message || err));
            }
          }}
          onChanged={refreshData}
          onStatus={setSetupReport}
          onReady={() => {
            const pending = pendingRunRef.current;
            setFocusServiceId(undefined);
            setSetupOpen(false);
            if (pending) {
              pendingRunRef.current = null;
              void handleRunTests(pending);
            }
          }}
          runtimeMessage={error}
          onGenerate={() => {
            if (generationRunning) return;
            pendingRunRef.current = null;
            setFocusServiceId(undefined);
            setSetupOpen(false);
            openGenerator();
          }}
        />
      )}

      {historyOpen && (
        <SystemTestVersionHistory
          projectId={projectId}
          snapshotId={snapshotId}
          executionMode={executionMode}
          onClose={() => setHistoryOpen(false)}
          onChanged={() => {
            if (projectId) invalidateProjectTree(projectId, snapshotId);
            refreshData();
          }}
          onCheck={(data) => {
            if (data?.jobId) {
              activeJobRef.current = data.jobId;
              setActiveJobId(data.jobId);
              if (data?.id) setActiveAssessmentId(data.id);
              setRunningTests(true);
              setActiveTab("live");
            }
          }}
        />
      )}
    </div>
  );
}
