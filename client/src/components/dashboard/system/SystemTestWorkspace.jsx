import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { History, Loader2, Monitor, Play, RefreshCw, Settings2, FilePlus2 } from "lucide-react";
import { Badge } from "../../ui/badge.jsx";
import { Button } from "../../ui/button.jsx";
import { Hint } from "../../ui/tooltip.jsx";
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
  getSystemTestPlans,
  runSystemTest,
  systemEvidenceRequest,
  getSystemGenerationStatus,
  fillMissingSystemTests,
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
import SystemKpiCards from "./SystemKpiCards.jsx";
import SystemNoticeSlot, { SystemNoticeToast } from "./SystemNoticeSlot.jsx";
import SystemTestBreakpointModal from "./SystemTestBreakpointModal.jsx";
import SystemTestSetupDialog from "./SystemTestSetupDialog.jsx";
import SystemTestReportView from "./SystemTestReportView.jsx";
import SystemTestVersionHistory from "./SystemTestVersionHistory.jsx";
import { systemTestEntryState } from "./systemTestEntryModel.js";
import { getSystemGroupCaseCoverage } from "./systemCaseCoverage.js";
import ConfirmDialog from "../../common/ConfirmDialog.jsx";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";
const NO_FULL_STACK_TESTS = "No Full Stack tests yet — your existing specs mock the API.";

function getFrameworkSpecFiles(discovery, framework) {
  return (discovery?.frameworks || [])
    .filter((entry) => !framework || !entry.name || entry.name.toLowerCase().includes(framework))
    .flatMap((entry) => entry.testFiles || entry.files || []);
}

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
  const [pendingConfirmAction, setPendingConfirmAction] = useState(null);

  const [summaryData, setSummaryData] = useState(null);
  const [executedTestFiles, setExecutedTestFiles] = useState([]);
  const [catalogData, setCatalogData] = useState(null);
  const [featuresData, setFeaturesData] = useState(null);
  const [latestDraft, setLatestDraft] = useState(null);
  const [testPlans, setTestPlans] = useState([]);
  const [setupReport, setSetupReport] = useState(null);

  const [activeJobId, setActiveJobId] = useState(null);
  const [activeAssessmentId, setActiveAssessmentId] = useState(null);
  const [completedJob, setCompletedJob] = useState(null);
  const [runningTests, setRunningTests] = useState(false);
  const [runningTarget, setRunningTarget] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);

  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [applyingDraft, setApplyingDraft] = useState(false);
  const [fillingDraft, setFillingDraft] = useState(false);
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
        const [sumRes, catRes, featRes, draftRes, plansRes, setupRes] = await Promise.all([
          getSystemTestSummary(snapshotId, filters).catch(() => null),
          systemEvidenceRequest(snapshotId, "catalog").catch(() => null),
          systemEvidenceRequest(snapshotId, "catalog/features").catch(() => null),
          systemEvidenceRequest(snapshotId, "generation-drafts/latest").catch(() => null),
          getSystemTestPlans(snapshotId).catch(() => []),
          systemEvidenceRequest(snapshotId, "setup").catch(() => null),
        ]);
        if (ignore) return;

        const sum = sumRes?.data || null;
        setSummaryData(sum);
        setCatalogData(catRes || null);
        setFeaturesData(featRes || null);
        setLatestDraft(draftRes || null);
        setTestPlans(plansRes || []);
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
        setCompletedJob({ jobId: payload.jobId, snapshotId, status, testStatus: payload.result?.testRun?.status });
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
        executing: prev?.executing || /\bexecuting\b/i.test(payload.stage || "") ||
          (payload.stage === "Measuring system tests" && /\bexecuting\b/i.test(payload.message || "")),
      }));
    },
    [activeAssessmentId, selectAssessment, refreshData, snapshotId],
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
    const plansByFile = new Map();
    for (const { filePath, testPlan } of testPlans) {
      const normalizedPath = normalizeSpecPath(filePath);
      if (!plansByFile.has(normalizedPath)) plansByFile.set(normalizedPath, testPlan);
    }

    const ensureGroup = (rawPath, meta = {}) => {
      const filePath = normalizeSpecPath(rawPath);
      if (!filePath) return null;
      if (!byFile.has(filePath)) {
        byFile.set(filePath, {
          key: filePath,
          filePath,
          testPlan: plansByFile.get(filePath),
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
      if (g.fullStackCompatible === undefined && typeof meta.fullStackCompatible === "boolean") {
        g.fullStackCompatible = meta.fullStackCompatible;
      }
      for (const r of meta.routes || []) g.routes.add(r);
      return g;
    };

    // 1. Seed discovered files from frameworks endpoint
    for (const f of getFrameworkSpecFiles(frameworksData, activeFramework)) {
      if (typeof f === "string") ensureGroup(f);
      else ensureGroup(f.filePath || f.path, f);
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
        fullStackCompatible: cs.fullStackCompatible,
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
      const draftScenarios =
        Array.isArray(df.scenarios) && df.scenarios.length > 0
          ? df.scenarios
          : extractDraftTitlesFromCode(df.content || "").map((title) => ({ title }));
      for (const scenario of draftScenarios) {
        const t = scenario.title || scenario.name;
        if (!t) continue;
        const kt = t.trim().toLowerCase();
        if (!g.seenTitles.has(kt)) {
          g.seenTitles.add(kt);
          g.scenarios.push({
            id: `draft::${g.filePath}::${t}`,
            title: t,
            testFile: g.filePath,
            status: "NOT_RUN",
            origin: "AI_DRAFT",
            ...(scenario.caseKey !== undefined && { caseKey: scenario.caseKey }),
            ...(scenario.planItemId !== undefined && { planItemId: scenario.planItemId }),
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
        testPlan: plansByFile.get(nf),
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
  }, [frameworksData, activeFramework, executedTestFiles, catalogData, featuresData, latestDraft, testPlans, pendingSystemOps]);

  const specCompatibility = useMemo(() => new Map(
    specGroups.map(({ filePath, fullStackCompatible }) => [filePath, fullStackCompatible]),
  ), [specGroups]);

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
    async ({ selectedFiles = null, selectedTitles = null, onlyFile = null, targetLabel = null, watch } = {}) => {
      if (!projectAccess.can("tests.run") || !snapshotId) return;
      if (runRequestRef.current || activeJobRef.current) return;

      runRequestRef.current = true;
      setError(null);
      setNotice(null);

      try {
        let compatibility = specCompatibility;
        if (pendingOpsCount > 0) {
          const ok = await flushPendingSystemOps({ reload: false });
          if (!ok) {
            runRequestRef.current = false;
            return;
          }
          const { data: discovery } = await getSystemTestFrameworks(projectId, snapshotId);
          setFrameworksData(discovery);
          compatibility = new Map(getFrameworkSpecFiles(discovery, activeFramework).map((file) => [
            normalizeSpecPath(typeof file === "string" ? file : file.filePath || file.path),
            file.fullStackCompatible,
          ]));
        }
        const requestedFiles = selectedFiles?.length ? selectedFiles : onlyFile ? [onlyFile] : null;
        const effectiveSelectedFiles = requestedFiles
          ? requestedFiles.filter((file) => {
            const compatible = compatibility.get(normalizeSpecPath(file));
            return pendingOpsCount > 0 ? compatible === true : compatible !== false;
          })
          : Array.from(compatibility).filter(([, compatible]) => compatible === true).map(([file]) => file);
        if (effectiveSelectedFiles.length === 0) {
          setError(NO_FULL_STACK_TESTS);
          return;
        }

        // Preflight environment check (reuses setup dialog when app runtime/DB config missing)
        const setup = await systemEvidenceRequest(snapshotId, "setup").catch(() => null);
        if (setup) {
          setSetupReport(setup);
          if (!setup.ready) {
            runRequestRef.current = false;
            if (setup.issues?.some((issue) => issue.code === "ENVIRONMENT_REQUIRED")) {
              pendingRunRef.current = { selectedFiles, selectedTitles, onlyFile, targetLabel, watch };
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
              ? `Queuing ${effectiveSelectedFiles.length} selected spec file(s)...`
              : "Queuing full-stack system test execution...",
        });

        let responseData = null;
        // Runs started outside Live Run (e.g. Run Full Suite) follow the Live Run speed choice.
        let runWatch = watch;
        if (runWatch === undefined) {
          try {
            runWatch = localStorage.getItem("covai.liveRun.speed") !== "fast";
          } catch (storageError) {
            console.error("[SystemTestWorkspace] Live Run speed unavailable:", storageError);
            runWatch = true;
          }
        }

        // Prefer /assessments for Playwright (full suite, selected specs, or individual live test case)
        // so live screenshots, Chromium frames, step logs, and Istanbul code coverage stream cleanly.
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
                  watch: runWatch,
                  selectedFiles: effectiveSelectedFiles,
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
          const runRes = await runSystemTest(snapshotId, {
            framework: activeFramework,
            executionMode,
            testFile: effectiveSelectedFiles.includes(onlyFile) ? onlyFile : undefined,
            selectedFiles: effectiveSelectedFiles,
            selectedTitles: selectedTitles?.length ? selectedTitles : undefined,
            headed: headedMode,
            watch: runWatch,
          });
          responseData = runRes?.data || runRes;
        }

        const jid = responseData?.jobId;
        if (!jid) {
          throw new Error("Server did not return a system test job ID.");
        }

        activeJobRef.current = jid;
        setActiveJobId(jid);
        setCompletedJob(null);
        setActiveAssessmentId(responseData.assessmentId || responseData.id || null);
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
    [projectAccess, projectId, snapshotId, activeFramework, executionMode, headedMode, specCompatibility, pendingOpsCount],
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

  const handleFillMissing = async (draft) => {
    setFillingDraft(true);
    setError(null);
    try {
      setGenerationTask(await fillMissingSystemTests(snapshotId, draft.aiTestId));
    } catch (err) {
      const response = err.response?.data;
      if (response?.code === "GENERATION_IN_PROGRESS" && response.data) {
        setGenerationTask(response.data);
      } else {
        setError(response?.message || err.message || "Failed to generate missing tests.");
      }
    } finally {
      setFillingDraft(false);
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
  const draftScenarioCount = useMemo(() => {
    if (!latestDraft) return 0;
    const files = Array.isArray(latestDraft.files) && latestDraft.files.length ? latestDraft.files : [latestDraft];
    return latestDraft.scenarioCount ?? latestDraft.scenariosCount ?? files.reduce((count, file) => (
      count + (file.scenarios?.length || extractDraftTitlesFromCode(file.content || file.code || "").length)
    ), 0);
  }, [latestDraft]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (showPrintableReport && workspace.assessment) {
    return (
      <SystemTestReportView
        assessment={workspace.assessment}
        snapshotId={snapshotId}
        onBack={() => setShowPrintableReport(false)}
      />
    );
  }

  const workspaceLoading = loading || snapshotPreparing || entryState === "loading";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-bg)] font-sans text-[var(--color-text)] select-text">
      <header className="z-20 min-w-0 shrink-0 bg-[var(--color-bg)] px-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-lg font-semibold tracking-tight">System Tests</h1>
            <div data-guide="sys-framework" className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-xs">
              {["playwright", "cypress"].map((fw) => (
                <button
                  key={fw}
                  type="button"
                  onClick={() => setActiveFramework(fw)}
                  aria-pressed={activeFramework === fw}
                  className="cursor-pointer rounded px-2 py-1 capitalize text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] aria-pressed:bg-[var(--color-surface-secondary)] aria-pressed:font-semibold aria-pressed:text-[var(--color-text)]"
                >
                  {fw === "playwright" ? "Playwright" : "Cypress"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" data-guide="sys-run" onClick={() => handleRunTests()} disabled={!projectAccess.can("tests.run") || runningTests || (!frameworksData && workspaceLoading)}>
              {runningTests ? <Loader2 className="animate-spin" /> : <Play />}
              {runningTests ? "Running…" : "Run tests"}
            </Button>
            {projectAccess.can("ai.use") && (
              <Button size="sm" variant="outline" onClick={openGenerator}>
                <FilePlus2 />
                Generate tests
              </Button>
            )}
            <Hint text="Refresh">
              <span className="inline-flex">
                <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={refreshData} disabled={loading || runningTests}>
                  <RefreshCw className={loading ? "animate-spin" : ""} />
                </Button>
              </span>
            </Hint>
            <Hint text="Headed browser">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Headed browser"
                aria-pressed={headedMode}
                className="aria-pressed:bg-[var(--color-primary)]/10 aria-pressed:text-[var(--color-primary)]"
                onClick={() => setHeadedMode((v) => !v)}
              >
                <Monitor />
              </Button>
            </Hint>
            <Hint text="History">
              <Button size="icon-sm" variant="ghost" data-guide="sys-history" aria-label="History" onClick={() => setHistoryOpen(true)}>
                <History />
              </Button>
            </Hint>
            <Hint text="Test setup">
              <Button size="icon-sm" variant="ghost" className="relative" data-guide="sys-setup" aria-label="Test setup" onClick={() => setSetupOpen(true)}>
                <Settings2 />
                {setupReport?.issues?.length > 0 && (
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[var(--color-danger)]" aria-hidden="true" />
                )}
              </Button>
            </Hint>
          </div>
        </div>

      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="space-y-4 px-4 py-4">
        <div data-guide="sys-telemetry">
          <SystemKpiCards telemetry={telemetry} summary={summaryData} executionMode={executionMode} loading={workspaceLoading} />
        </div>

        <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center justify-between gap-x-3 bg-[var(--color-bg)]">
          <nav data-guide="sys-tabs" aria-label="System test views" className="flex flex-wrap items-center gap-1">
            {[
              { id: "matrix", label: "Matrix", badge: <Badge>{specGroups.length}</Badge> },
              {
                id: "live",
                label: "Live Run",
                badge: runningTests && <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-label="Tests running" />,
              },
              {
                id: "report",
                label: "Report",
                badge: telemetry.failedScenarios > 0 && (
                  <Badge variant="danger" className="text-[var(--color-danger)]">{telemetry.failedScenarios} failed</Badge>
                ),
              },
            ].map(({ id, label, badge }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-pressed={activeTab === id}
                className="flex cursor-pointer items-center gap-2 border-b-2 border-transparent px-2.5 py-1.5 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] aria-pressed:border-[var(--color-primary)] aria-pressed:text-[var(--color-text)]"
              >
                {label}
                {badge}
              </button>
            ))}
          </nav>
          {jobProgress && (
            <div className="flex min-w-0 max-w-full items-center gap-2 py-1 text-xs text-[var(--color-text-secondary)]">
              <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-primary)]" />
              <span className="max-w-[320px] truncate">
                {jobProgress.stage}: {jobProgress.message} ({jobProgress.progress ?? 0}%)
              </span>
            </div>
          )}
        </div>
        {snapshotPreparing && <span role="status" className="sr-only">Preparing imported snapshot…</span>}
        <SystemNoticeSlot
          generation={{
            task: activeTab === "matrix" || generationTask?.state !== "SUCCEEDED" ? generationTask : null,
            dismissedId: dismissedGenerationId,
            onCancel: () => cancelGenerationRef.current?.(),
            onReview: () => setGeneratorView("review"),
            onRetry: () => setGeneratorView("generate"),
            onDismiss: () => setDismissedGenerationId(generationTask.id),
          }}
          error={{
            message: error || discoveryError,
            messageOnly: error === NO_FULL_STACK_TESTS,
            primaryAction: error === NO_FULL_STACK_TESTS && projectAccess.can("ai.use")
              ? <Button size="sm" onClick={openGenerator}>Generate tests</Button>
              : null,
            onDismiss: () => {
              setError(null);
              setDiscoveryError(null);
            },
            onOpenLogs: error === NO_FULL_STACK_TESTS ? undefined : () => openFloatingJobQueue({ domain: "system" }),
            onOpenSetup: () => setSetupOpen(true),
          }}
          draft={{
            latest: activeTab === "matrix" ? latestDraft : null,
            count: draftScenarioCount,
            applying: applyingDraft,
            onApply: handleApplyDraft,
            canUseAi: projectAccess.can("ai.use") && projectAccess.can("evidence.approve"),
            filling: fillingDraft,
            onFillMissing: handleFillMissing,
          }}
          external={{
            setup: setupReport,
            summary: summaryData,
            onOpenSetup: openExternalSetup,
            onRunTests: () => handleRunTests(),
            running: runningTests,
          }}
        />
        <SystemNoticeToast message={notice} onDismiss={() => setNotice(null)} />

        {activeTab === "matrix" && (
          <div data-guide="sys-matrix">
          <SystemSpecMatrixTable
            key={snapshotId || "system"}
            snapshotId={snapshotId}
            specGroups={specGroups}
            loading={workspaceLoading}
            syncingCatalog={syncingCatalog}
            runningTarget={runningTarget}
            fixingTarget={fixingTarget}
            deletingTarget={deletingTarget}
            canRunTests={projectAccess.can("tests.run")}
            canEditTests={projectAccess.can("tests.edit") || projectAccess.can("tests.run")}
            canUseAi={projectAccess.can("ai.use")}
            onSyncCatalog={handleSyncCatalog}
            onGenerateSelected={openGenerator}
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
            onDeleteScenario={(sc, group) =>
              setPendingConfirmAction({ kind: "delete", sc, group })
            }
            onAIFixScenario={handleAIFixScenario}
            onInspectScenario={(sc) => setInspectedScenario(sc)}
            onOpenSpecFile={(filePath) => onOpenFile?.(filePath)}
            pendingOpsCount={pendingOpsCount}
            isApplyingPending={isApplyingPending}
            onApplyPendingChanges={() => flushPendingSystemOps({ reload: true })}
            onDiscardPendingChanges={() =>
              setPendingConfirmAction({ kind: "discard" })
            }
          />
          </div>
        )}

        {activeTab === "live" && (
          <SystemTestLiveRun
            projectId={projectId}
            snapshotId={snapshotId}
            activeJobId={activeJobId}
            initialAssessmentId={runningTests && !activeJobId ? null : activeAssessmentId ||
              (!activeJobId && completedJob?.snapshotId !== snapshotId ? workspace.assessment?.id : null)}
            completedJob={completedJob?.snapshotId === snapshotId && !runningTests ? completedJob : null}
            jobExecuting={jobProgress?.executing}
            specGroups={specGroups}
            runningTests={runningTests}
            onRunScenario={(sc, group, watch) =>
              handleRunTests({
                onlyFile: sc.testFile || group?.filePath,
                selectedTitles: [sc.title || sc.testName],
                targetLabel: sc.title || sc.testName,
                watch,
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
      </div>
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
            if (!pending) return; // opened manually (e.g. Add key / Test setup): keep the dialog open
            pendingRunRef.current = null;
            setFocusServiceId(undefined);
            setSetupOpen(false);
            void handleRunTests(pending);
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
      <ConfirmDialog
        isOpen={Boolean(pendingConfirmAction)}
        onClose={() => setPendingConfirmAction(null)}
        onConfirm={() => {
          if (!pendingConfirmAction) return;
          if (pendingConfirmAction.kind === "delete") {
            handleDeleteScenario(pendingConfirmAction.sc, pendingConfirmAction.group);
          } else if (pendingConfirmAction.kind === "discard") {
            const cleared = { deletes: [], updates: [], adds: [] };
            setPendingSystemOps(cleared);
            saveStagedOps("system", snapshotId, cleared);
            setNotice("Discarded temporary system test edits.");
          }
          setPendingConfirmAction(null);
        }}
        title={
          pendingConfirmAction?.kind === "discard"
            ? "Discard Pending System Test Changes"
            : "Delete System Test Scenario"
        }
        message={
          pendingConfirmAction?.kind === "discard"
            ? `Discard ${pendingOpsCount} staged system test ${pendingOpsCount === 1 ? "change" : "changes"}? This cannot be undone.`
            : "Remove this system test scenario? Changes will be staged until you click Apply Changes."
        }
        confirmText={
          pendingConfirmAction?.kind === "discard" ? "Discard Changes" : "Delete"
        }
        variant="danger"
      >
        {pendingConfirmAction?.kind === "delete" && pendingConfirmAction.sc && (
          <div className="px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text-secondary)] break-all">
            {pendingConfirmAction.sc.title || pendingConfirmAction.sc.testName}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
