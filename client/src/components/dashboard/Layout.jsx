/* eslint-disable no-unused-vars */
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import ActivityBar from "./ActivityBar";
import Sidebar from "./Sidebar";
import Editor from "./Editor";
import RetainedPanel from "../common/RetainedPanel";
import VcsStatusBar from "./vcs/shared/VcsStatusBar";
import CoverageDashboard from "./CoverageDashboard";
import UnitTestDashboard from "./UnitTestDashboard";
import IntegrationTestDashboard from "./IntegrationTestDashboard";
import SystemTestDashboard from "./SystemTestDashboard";
import AIPanel from "./AIPanel";
import ImportLayout from "./import/ImportLayout";
import JobQueue from "./JobQueue";
import ProjectArchitecturePanel from "./ProjectArchitecturePanel";
import CFGCalculator from "./CFGCalculator";
import QualityDashboard from "./QualityDashboard";
import TrustworthinessWorkspace from "./trustworthiness/TrustworthinessWorkspace";
import UnifiedDashboard from "./unified/UnifiedDashboard";
import VersionControlWorkspace from "./VersionControlWorkspace";
import LifecycleStatusSelect from "./portfolio/primitives/LifecycleStatusSelect";
import { buildWorkspaceUrl } from "../../services/unifiedDashboard/workspaceNavigation";
import SettingsSidebar from "./settings/SettingsSidebar";
import ProjectMembersSettings from "./settings/ProjectMembersSettings";
import { useProjectAccess } from "../../hooks/useProjectAccess";
import { useProjectEvents } from "../../hooks/useProjectEvents";
import { useVcsSync } from "../../hooks/useVcsSync";
import { VC_MODES } from "../../../../shared/versionControlMode.js";
import UserProfile from "./settings/UserProfile";
import Appearance from "./settings/Appearance";
import Security from "./settings/Security";
import Billing from "./settings/Billing";
import Usage from "./settings/Usage";
import { ToastProvider, useToast } from "./ToastContext";
import MissingTestFilesModal from "./MissingTestFilesModal";
import GlobalAiTokenPill from "./GlobalAiTokenPill";
import PanelResizer from "./PanelResizer";
import ConfirmDialog from "../common/ConfirmDialog";
import SpotlightTourOverlay from "./guidance/SpotlightTourOverlay";
import { resolveTourKey } from "./guidance/platformGuidanceData";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  GitBranch,
  Zap,
  BarChart3,
  Play,
  CheckCircle2,
  FolderPlus,
  Menu,
  X,
  MoreHorizontal,
  LogOut,
  FlaskConical,
  Network,
  Layers,
  FileText,
} from "lucide-react";
import CovaiLogo from "../common/CovaiLogo";
import "./portfolio/portfolio.css";

import { useAuth } from "../../hooks/useAuth";
import { NotificationCenter } from "../NotificationCenter";
import NotificationsSettings from "./settings/NotificationsSettings";
import { useBreakpoints } from "../../hooks/useMediaQuery";

import {
  getProjectsApi,
  getProjectTreeApi,
  generateSkeletonApi,
  createProjectFileApi,
  createProjectFolderApi,
  renameProjectEntryApi,
  deleteProjectEntryApi,
} from "../../services/project.service";
import {
  insertNodeIntoTree,
  renameNodeInTree,
  deleteNodeFromTree,
} from "../../utils/fileTreeUtils";
import { getProjectJobsApi } from "../../services/job.service";
import { queryClient } from "../../lib/queryClient.js";
import { openFloatingJobQueue } from "../../lib/floatingJobQueuePrefs.js";
import {
  resolveCachedProjectsList as resolveCachedProjectsListFromCache,
  readCachedProjectTree,
  loadWorkspaceProjectAndTree,
  shouldFetchExplorerTreeOnSwitch,
} from "../../services/workspaceTreeLoader.js";

const INITIAL_TABS = [];
const DEFAULT_SIDEBAR_WIDTH = 260;
const DEFAULT_AI_PANEL_WIDTH = 340;

const COVERAGE_TEST_TABS = [
  { key: "unit", label: "Unit Test", shortLabel: "Unit", icon: FlaskConical },
  {
    key: "integration",
    label: "Integration Test",
    shortLabel: "Integration",
    icon: Network,
  },
  { key: "system", label: "System Test", shortLabel: "System", icon: Layers },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const panelVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

function LayoutInner() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, vcMode, logout } = useAuth();
  const searchParams = new URLSearchParams(location.search);
  const initialProjectId = searchParams.get("projectId");
  const initialTab = searchParams.get("tab") || "explorer";
  const { isMobile, isTablet } = useBreakpoints();
  const isCompact = isMobile || isTablet;

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showCFG, setShowCFG] = useState(false);
  const [activeActivity, setActiveActivity] = useState(initialTab);
  const [visitedPanels, setVisitedPanels] = useState(
    () => new Set([initialTab]),
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(DEFAULT_AI_PANEL_WIDTH);
  const [isDraggingAiPanel, setIsDraggingAiPanel] = useState(false);
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState(null);
  const [activeFileId, setActiveFileId] = useState(null);
  const initialCoverageType =
    searchParams.get("coverageType") ||
    searchParams.get("type") ||
    (searchParams.get("tab") === "system" ? "system" : "unit");
  const [coverageType, setCoverageType] = useState(initialCoverageType);
  const [unifiedSummary, setUnifiedSummary] = useState(null);
  const [testPromptSnapshotId, setTestPromptSnapshotId] = useState(null);
  const [aiPanelOwner, setAiPanelOwner] = useState(null);
  const [chatTestContext, setChatTestContext] = useState({});
  const [showImport, setShowImport] = useState(false);
  const [showQualityDashboard, setShowQualityDashboard] = useState(false);
  const [cfgInitialContext, setCfgInitialContext] = useState(null);
  const [editorJumpTarget, setEditorJumpTarget] = useState(null);
  const [archInitialContext, setArchInitialContext] = useState(null);
  const [integrationInitialContext, setIntegrationInitialContext] =
    useState(null);
  const [showTestPrompt, setShowTestPrompt] = useState(false);
  const [showMissingTestFilesModal, setShowMissingTestFilesModal] =
    useState(false);
  const [currentProjectName, setCurrentProjectName] = useState(null);
  const [pendingAiSuggestion, setPendingAiSuggestion] = useState(null);

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/", { replace: true });
  };

  const handleSelectActivity = (id) => {
    if (id === "portfolio") {
      navigate("/projects");
      return;
    }
    if (id === "logout") {
      setShowLogoutConfirm(true);
      return;
    }
    if (id === "logic-analysis") {
      setShowCFG(true);
      return;
    }
    setShowCFG(false);
    if (id === "explorer") {
      if (activeActivity === "explorer" && !showCFG) {
        setSidebarOpen((prev) => !prev);
        return;
      }
      setSidebarOpen(true);
    }
    if (id === "system") {
      setActiveActivity("coverage");
      setCoverageType("system");
    } else {
      setActiveActivity(id);
    }
    const params = new URLSearchParams(location.search);
    params.set("tab", id);
    params.delete("focusFile");
    params.delete("focusEndpoint");
    params.delete("focusScenario");
    navigate(`${location.pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab") || "explorer";
    if (tab === "logic-analysis") {
      setShowCFG(true);
    }
    if (tab === "system") {
      setActiveActivity("coverage");
      setCoverageType("system");
      setVisitedPanels(
        (prev) => new Set([...prev, "coverage", "coverage:system"]),
      );
    } else {
      setActiveActivity(tab);
      const type = params.get("coverageType") || params.get("type");
      if (type) {
        setCoverageType(type);
        setVisitedPanels((prev) => new Set([...prev, tab, `${tab}:${type}`]));
      } else {
        setVisitedPanels((prev) => new Set([...prev, tab]));
      }
    }
    const focusFile = params.get("focusFile");
    const focusEndpoint = params.get("focusEndpoint");
    const focusScenario = params.get("focusScenario");
    if (focusFile) {
      showToast({
        type: "info",
        title: "Navigated to Unit Tests",
        message: `Focus target: ${focusFile}`,
      });
    } else if (focusEndpoint) {
      setIntegrationInitialContext((prev) => ({ ...prev, focusEndpoint }));
      showToast({
        type: "info",
        title: "Navigated to Integration Tests",
        message: `Focus target: ${focusEndpoint}`,
      });
    } else if (focusScenario) {
      showToast({
        type: "info",
        title: "Navigated to System Tests",
        message: `Focus target: ${focusScenario}`,
      });
    }
  }, [location.search, showToast]);

  const allowedSettings = [
    "profile",
    "appearance",
    "security",
    "notifications",
    "usage",
    "billing",
    "members",
  ];
  const selectedSetting = searchParams.get("setting");
  const activeSetting = allowedSettings.includes(selectedSetting)
    ? selectedSetting
    : "profile";
  const membersTab =
    searchParams.get("membersTab") === "pending" ? "pending" : "members";
  const setActiveSetting = (setting) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", "settings");
    params.set(
      "setting",
      allowedSettings.includes(setting) ? setting : "profile",
    );
    navigate(`${location.pathname}?${params}`);
  };
  const setMembersTabInUrl = (tab) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", "settings");
    params.set("setting", "members");
    params.set("membersTab", tab === "pending" ? "pending" : "members");
    navigate(`${location.pathname}?${params}`);
  };
  const updateChatTestContext = useCallback((detail) => {
    setChatTestContext((previous) =>
      JSON.stringify(previous[detail.testType]) === JSON.stringify(detail)
        ? previous
        : { ...previous, [detail.testType]: detail },
    );
  }, []);
  const isFullWidthWorkspace = [
    "architecture",
    "overview",
    "trustworthiness",
    "version-control",
    "git",
    "jobs",
    "activity",
    "coverage",
  ].includes(activeActivity);

  useEffect(() => {
    if (activeActivity !== "architecture") {
      setArchInitialContext(null);
    }
  }, [activeActivity]);

  const handleOpenArchitecture = (filePath) => {
    setArchInitialContext({ initialFile: filePath });
    setActiveActivity("architecture");
    const params = new URLSearchParams(location.search);
    params.set("tab", "architecture");
    navigate(`${location.pathname}?${params.toString()}`);
  };

  const handleOpenCFG = (
    filePath = null,
    functionName = null,
    initialLine = null,
  ) => {
    if (filePath) {
      setCfgInitialContext({
        initialFile: filePath,
        initialFunc: functionName,
        initialLine: initialLine ? Number(initialLine) : null,
      });
    } else {
      setCfgInitialContext(null);
    }
    setShowCFG(true);
  };

  const handleCloseCFG = () => {
    setShowCFG(false);
    setCfgInitialContext(null);
    if (activeActivity === "logic-analysis") {
      const params = new URLSearchParams(location.search);
      params.set("tab", "explorer");
      navigate(`${location.pathname}?${params.toString()}`);
    }
  };

  const handleSuggestTestcase = (filePath, options = {}) => {
    // Never open AIPanel for bulk test suggestions; they belong to the guided dashboard workflow
    if (
      options?.isBulk ||
      (typeof filePath === "object" && filePath?.isBulk) ||
      options?.skipAiPanel
    ) {
      return;
    }
    setAiPanelOpen(true);
    if (typeof filePath === "object" && filePath !== null) {
      setPendingAiSuggestion({ ...filePath, timestamp: Date.now() });
    } else {
      setPendingAiSuggestion({ filePath, ...options, timestamp: Date.now() });
    }
  };

  const handleAskAiPrompt = useCallback((promptText) => {
    if (!promptText) return;
    setAiPanelOpen(true);
    setPendingAiSuggestion({ promptText, timestamp: Date.now() });
  }, [setAiPanelOpen, setPendingAiSuggestion]);

  useEffect(() => {
    const onPrefillEvent = (e) => {
      const text = e.detail?.promptText;
      if (text) {
        setAiPanelOpen(true);
        setPendingAiSuggestion({
          promptText: text,
          attachments: e.detail?.attachments || [],
          fixContext: e.detail?.fixContext || null,
          timestamp: Date.now(),
        });
      }
    };
    window.addEventListener("covai:prefill-prompt", onPrefillEvent);
    return () =>
      window.removeEventListener("covai:prefill-prompt", onPrefillEvent);
  }, []);

  const resolveCachedProjectsList = useCallback(
    () => resolveCachedProjectsListFromCache(queryClient, user?.id),
    [user?.id],
  );

  const [projects, setProjects] = useState(() => resolveCachedProjectsList());
  const [project, setProject] = useState(() => {
    const cached = resolveCachedProjectsList();
    if (Array.isArray(cached) && cached.length > 0) {
      if (initialProjectId) {
        return cached.find((p) => p.id === initialProjectId) || null;
      }
      return cached[0] || null;
    }
    return null;
  });
  const projectAccess = useProjectAccess(project?.id);
  const vcsSummary = useVcsSync(project?.id);
  const chatSnapshotId =
    searchParams.get("snapshotId") ||
    project?.activeSnapshotId ||
    project?.latestSnapshotId ||
    project?.snapshots?.[0]?.id ||
    (project?.id
      ? localStorage.getItem(`latestSnapshot_${project.id}`)
      : null) ||
    testPromptSnapshotId;
  const aiPanelScope = `${user?.id}:${project?.id}`;
  const isAiPanelVisible = aiPanelOpen && aiPanelOwner === aiPanelScope;
  const selectedChatTest = chatTestContext[coverageType];
  const activeChatTest =
    project?.id &&
    chatSnapshotId &&
    activeActivity === "coverage" &&
    selectedChatTest?.projectId === project.id &&
    selectedChatTest?.snapshotId === chatSnapshotId
      ? selectedChatTest
      : null;
  const activeOverviewSummary =
    activeActivity === "overview" &&
    unifiedSummary?.projectId === project?.id &&
    unifiedSummary?.snapshotId === chatSnapshotId
      ? unifiedSummary
      : null;
  const currentProjectId = project?.id;
  const screenContext = useMemo(
    () => ({
      activity: activeActivity,
      testType:
        activeActivity === "coverage"
          ? coverageType
          : activeActivity === "overview"
            ? "overview"
            : undefined,
      filePath:
        activeActivity === "explorer" ? activeTabId || undefined : undefined,
      unifiedSummary: activeOverviewSummary || undefined,
      testRunId: activeChatTest?.testRunId,
      scenarioId: activeChatTest?.scenarioId,
      displayedMetrics:
        activeOverviewSummary && currentProjectId && chatSnapshotId
          ? {
              kind: "overview",
              projectId: currentProjectId,
              snapshotId: chatSnapshotId,
              state: activeOverviewSummary.state || "ready",
              healthScore: activeOverviewSummary.healthScore,
              healthGrade: activeOverviewSummary.healthGrade,
              qualityGate: activeOverviewSummary.qualityGateLabel,
              totalTests: activeOverviewSummary.totalExecutedTests,
              passedTests: activeOverviewSummary.passedTests,
              failedTests: activeOverviewSummary.failedTests,
              overallCoveragePct: activeOverviewSummary.overallCoveragePct,
              unitLinesPct: activeOverviewSummary.unitLinesPct,
              unitBranchesPct: activeOverviewSummary.unitBranchesPct,
              apiCoveragePct: activeOverviewSummary.apiCoveragePct,
              systemFlowPct: activeOverviewSummary.systemFlowPct,
            }
          : activeChatTest?.displayedMetrics,
    }),
    [
      activeActivity,
      coverageType,
      activeTabId,
      activeOverviewSummary,
      activeChatTest,
      currentProjectId,
      chatSnapshotId,
    ],
  );
  useEffect(() => {
    setAiPanelOpen(false);
    setAiPanelOwner(`${user?.id}:${project?.id}`);
    setPendingAiSuggestion(null);
  }, [project?.id, user?.id]);
  useEffect(() => {
    if (!isAiPanelVisible) return;
    const frame = requestAnimationFrame(() =>
      document.querySelector("#covai-chatbot textarea")?.focus(),
    );
    const onKey = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setAiPanelOpen(false);
        document.getElementById("covai-chatbot-toggle")?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
    };
  }, [isAiPanelVisible]);
  const closeChatbot = () => {
    setAiPanelOpen(false);
    document.getElementById("covai-chatbot-toggle")?.focus();
  };
  const [initialTreeCache] = useState(() =>
    readCachedProjectTree(queryClient, user?.id, project?.id),
  );
  const [fileTree, setFileTree] = useState(() => initialTreeCache?.tree || []);
  const [treeVersion, setTreeVersion] = useState(() =>
    initialTreeCache
      ? {
          snapshotId: initialTreeCache.snapshotId,
          expectedWorkspaceRevision: initialTreeCache.workspaceRevision,
        }
      : null,
  );
  const [isLoadingTree, setIsLoadingTree] = useState(
    () => !initialTreeCache || initialTreeCache.isInvalidated,
  );
  const isMountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const loadedTreeProjectIdRef = useRef(
    initialTreeCache && !initialTreeCache.isInvalidated
      ? project?.id || null
      : null,
  );
  const isLoadingTreeRef = useRef(isLoadingTree);
  const locationRef = useRef(location);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isLoadingTreeRef.current = isLoadingTree;
  }, [isLoadingTree]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);
  const [latestRunJob, setLatestRunJob] = useState(null);
  const [isSubmittingAnalysis, setIsSubmittingAnalysis] = useState(false);
  const [editorRefreshTrigger, setEditorRefreshTrigger] = useState(0);
  const [coverageRunTrigger, setCoverageRunTrigger] = useState(0);
  useEffect(() => {
    if (![403, 404].includes(projectAccess.error?.status)) return;
    queryClient.cancelQueries({
      predicate: (query) => query.queryKey.includes(project?.id),
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey.includes(project?.id),
    });
    setFileTree([]);
    setProject(null);
    navigate("/projects", {
      replace: true,
      state: { projectAccessLost: true },
    });
  }, [projectAccess.error, project?.id, navigate]);

  useProjectEvents(project?.id, user?.id, (event) => {
    if (event.revoked) {
      setFileTree([]);
      setProject(null);
      navigate("/projects", {
        replace: true,
        state: { projectAccessLost: true },
      });
      return;
    }
    if (/file|workspace|snapshot/i.test(event.type || ""))
      setEditorRefreshTrigger((value) => value + 1);
  });

  const handleSelectCoverageType = (type) => {
    setShowCFG(false);
    setActiveActivity("coverage");
    setCoverageType(type);
    const params = new URLSearchParams(location.search);
    params.set("tab", "coverage");
    params.set("coverageType", type);
    params.set("type", type);
    for (const key of ["focusFile", "focusEndpoint", "focusScenario"])
      params.delete(key);
    if (params.toString() !== location.search.slice(1)) {
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
  };

  const handleTriggerRunAnalysis = () => {
    handleSelectCoverageType("unit");
    setCoverageRunTrigger((prev) => prev + 1);
  };

  const handleVcsSync = async (options = {}) => {
    const activeProjId = project?.id;
    if (!activeProjId) return;
    try {
      const { invalidateFileContentCache } = await import(
        "../../services/project.service"
      );
      invalidateFileContentCache(activeProjId);

      if (options?.snapshotId) {
        const nextSnapId = options.snapshotId;
        localStorage.setItem(`latestSnapshot_${activeProjId}`, nextSnapId);
        setProject((prev) =>
          prev && prev.id === activeProjId
            ? {
                ...prev,
                activeSnapshotId: nextSnapId,
                latestSnapshotId: nextSnapId,
              }
            : prev,
        );
        const params = new URLSearchParams(location.search);
        if (params.get("snapshotId") !== nextSnapId) {
          params.set("snapshotId", nextSnapId);
          navigate(`${location.pathname}?${params.toString()}`, {
            replace: true,
          });
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projectTree", user?.id, activeProjId],
        }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["unifiedDashboard"] }),
      ]);
      if (!options?.skipVcsRefetch) {
        vcsSummary.invalidateAll();
      }
      await loadData(activeProjId, 1, 0, { forceRefresh: true });
      setEditorRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to sync after VCS operation", err);
    }
  };

  useEffect(() => {
    const projectId = project?.id;
    if (!projectId) {
      setLatestRunJob(null);
      return undefined;
    }
    let cancelled = false;
    let timerId = null;

    const refreshRunJob = async () => {
      try {
        const response = await getProjectJobsApi(projectId);
        const jobs = response.jobs || [];
        const targetSnapshotId =
          searchParams.get("snapshotId") ||
          project.activeSnapshotId ||
          project.latestSnapshotId ||
          project.snapshots?.[0]?.id ||
          localStorage.getItem(`latestSnapshot_${projectId}`);
        const latest =
          jobs
            .filter(
              (job) =>
                job.type === "RUN_TESTS" &&
                (!targetSnapshotId || job.snapshotId === targetSnapshotId),
            )
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ||
          null;
        if (!cancelled) {
          setLatestRunJob(latest);
          // If a job is active, poll faster (4s); if idle, poll slowly (20s) to keep app responsive without hammering DB
          const hasActiveJob = jobs.some((j) =>
            ["QUEUED", "RUNNING"].includes(j.status),
          );
          const nextInterval = hasActiveJob ? 4000 : 20000;
          if (!cancelled) {
            timerId = window.setTimeout(refreshRunJob, nextInterval);
          }
        }
      } catch (err) {
        if (!cancelled) {
          // On transient error, back off gracefully
          timerId = window.setTimeout(refreshRunJob, 10000);
        }
      }
    };

    // When opening Unified Overview directly, defer background job polling slightly so unified-dashboard gets 100% priority
    const initialDelay = activeActivity === "overview" ? 1200 : 0;
    if (initialDelay > 0) {
      timerId = window.setTimeout(refreshRunJob, initialDelay);
    } else {
      refreshRunJob();
    }
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [project?.id]);

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setAiPanelOpen(false);
    } else if (isTablet) {
      setSidebarOpen(true);
      setAiPanelOpen(false);
    } else {
      setSidebarOpen(true);
    }
  }, [isMobile, isTablet]);

  const loadData = useCallback(
    async (
      activeProjId = null,
      retries = 3,
      delay = 2000,
      { forceRefresh = false } = {},
    ) => {
      const requestId = ++loadRequestIdRef.current;
      const isStaleRequest = () =>
        !isMountedRef.current || requestId !== loadRequestIdRef.current;

      await loadWorkspaceProjectAndTree({
        queryClient,
        userId: user?.id,
        activeProjId,
        retries,
        delay,
        forceRefresh,
        getProjectsApi,
        getProjectTreeApi,
        isStaleRequest,
        onLoadingChange: (loading) => {
          setIsLoadingTree(loading);
        },
        onSeedProjects: (seededProjects) => {
          setProjects((prev) => (prev.length > 0 ? prev : seededProjects));
        },
        onSeedProject: (seededTarget) => {
          setProject((prev) =>
            prev?.id === seededTarget.id ? prev : seededTarget,
          );
        },
        onProjectsLoaded: (loadedProjects) => {
          setProjects(loadedProjects);
        },
        onProjectSelected: (targetProj) => {
          setProject(targetProj);
          const currLocation = locationRef.current;
          const currParams = new URLSearchParams(currLocation.search);
          if (targetProj && currParams.get("projectId") !== targetProj.id) {
            currParams.set("projectId", targetProj.id);
            navigate(`${currLocation.pathname}?${currParams.toString()}`, {
              replace: true,
            });
          }
        },
        onNoProjects: () => {
          loadedTreeProjectIdRef.current = null;
          setProjects([]);
          setProject(null);
          setFileTree([]);
        },
        onTreeLoaded: ({ projectId: loadedProjectId, tree, snapshotId, workspaceRevision }) => {
          loadedTreeProjectIdRef.current = loadedProjectId;
          setTreeVersion(
            snapshotId !== null || workspaceRevision !== null
              ? {
                  snapshotId,
                  expectedWorkspaceRevision: workspaceRevision,
                }
              : null,
          );
          const sourceTree = tree || [];
          setFileTree(sourceTree);
          if (sourceTree.length > 0) {
            const fileExistsInTree = (nodes, path) => {
              for (const node of nodes) {
                if (node.id === path) return true;
                if (node.children && fileExistsInTree(node.children, path))
                  return true;
              }
              return false;
            };
            setTabs((prev) => {
              const remaining = prev.filter((t) =>
                fileExistsInTree(sourceTree, t.id),
              );
              if (remaining.length !== prev.length) {
                setActiveTabId((currActive) => {
                  if (remaining.some((t) => t.id === currActive))
                    return currActive;
                  const nextId = remaining[0]?.id || null;
                  setActiveFileId(nextId);
                  return nextId;
                });
              }
              return remaining;
            });
          }
        },
        onTreeNotReady: () => {
          loadedTreeProjectIdRef.current = null;
          setFileTree([]);
          showToast({
            type: "warning",
            title: "Project tree not ready",
            message: "Source code is still being extracted.",
          });
        },
        onLoadFailed: () => {
          showToast({
            type: "error",
            title: "Load failed",
            message: "Could not load project data.",
          });
        },
      });
    },
    [navigate, showToast, user?.id],
  );

  const handleSidebarResize = useCallback(
    (e) => {
      e.preventDefault();
      setIsDraggingSidebar(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
        setSidebarWidth(newWidth);
      };
      const onMouseUp = () => {
        setIsDraggingSidebar(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  const handleAiPanelResize = useCallback(
    (e) => {
      e.preventDefault();
      setIsDraggingAiPanel(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const startX = e.clientX;
      const startWidth = aiPanelWidth;
      const onMouseMove = (moveEvent) => {
        const deltaX = startX - moveEvent.clientX;
        const newWidth = Math.max(260, Math.min(800, startWidth + deltaX));
        setAiPanelWidth(newWidth);
      };
      const onMouseUp = () => {
        setIsDraggingAiPanel(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [aiPanelWidth],
  );

  const handleResetSidebarWidth = () => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  };

  const handleResetAiPanelWidth = () => {
    setAiPanelWidth(DEFAULT_AI_PANEL_WIDTH);
  };

  useEffect(() => {
    loadData(initialProjectId);
  }, [loadData, initialProjectId]);

  useEffect(() => {
    if (
      shouldFetchExplorerTreeOnSwitch({
        activeActivity,
        projectId: project?.id,
        userId: user?.id,
        queryClient,
        isLoadingTree: isLoadingTreeRef.current,
        loadedTreeProjectId: loadedTreeProjectIdRef.current,
      })
    ) {
      loadData(project.id);
    }
  }, [activeActivity, project?.id, user?.id, loadData]);

  useEffect(() => {
    if (!project?.id) return;
    let alive = true;
    let request = 0;
    const refreshTree = async (event) => {
      if (
        event.detail?.projectId !== project.id ||
        !/workspace|file|snapshot/i.test(event.detail?.type || "")
      )
        return;
      const currentRequest = ++request;
      try {
        const response = await getProjectTreeApi(project.id);
        if (!alive || currentRequest !== request) return;
        if (!response || response.success === false) return;
        const next = {
          tree: response.data || [],
          snapshotId: response.snapshotId,
          workspaceRevision: response.workspaceRevision,
        };
        queryClient.setQueryData(["projectTree", user?.id, project.id], next);
        loadedTreeProjectIdRef.current = project.id;
        setFileTree(next.tree);
        setTreeVersion({
          snapshotId: next.snapshotId,
          expectedWorkspaceRevision: next.workspaceRevision,
        });
        setIsLoadingTree(false);
      } catch {
        /* A revoked project is handled by the access boundary. */
      }
    };
    window.addEventListener("covai:project-event", refreshTree);
    return () => {
      alive = false;
      window.removeEventListener("covai:project-event", refreshTree);
    };
  }, [project?.id, user?.id]);

  useEffect(() => {
    const handleStatusUpdated = (event) => {
      const { projectId, lifecycleStatus, isPinned } = event.detail || {};
      if (!projectId) return;

      if (project?.id === projectId && lifecycleStatus !== undefined) {
        setProject((prev) => (prev ? { ...prev, lifecycleStatus } : prev));
      }

      setProjects((prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((p) => {
          if (p.id === projectId) {
            return {
              ...p,
              ...(lifecycleStatus !== undefined && { lifecycleStatus }),
              ...(isPinned !== undefined && { isPinned }),
            };
          }
          return p;
        });
      });
    };

    window.addEventListener(
      "covai:project-status-updated",
      handleStatusUpdated,
    );
    return () => {
      window.removeEventListener(
        "covai:project-status-updated",
        handleStatusUpdated,
      );
    };
  }, [project?.id]);

  // Read-path synchronization: if Unified Dashboard reports an active/updated lifecycleStatus
  // (e.g. self-healed to "DOING" when tests exist), sync it into Layout's project state & cache.
  useEffect(() => {
    const summaryStatus = unifiedSummary?.lifecycleStatus;
    const summaryProjectId = unifiedSummary?.projectId;
    if (!summaryProjectId || !summaryStatus || project?.id !== summaryProjectId)
      return;

    const currentStatus = project?.lifecycleStatus || "NOT_STARTED";
    if (currentStatus === "NOT_STARTED" && summaryStatus !== "NOT_STARTED") {
      setProject((prev) =>
        prev && prev.id === summaryProjectId
          ? { ...prev, lifecycleStatus: summaryStatus }
          : prev,
      );
      setProjects((prev) =>
        Array.isArray(prev)
          ? prev.map((p) =>
              p.id === summaryProjectId
                ? { ...p, lifecycleStatus: summaryStatus }
                : p,
            )
          : prev,
      );
      queryClient.setQueriesData({ queryKey: ["projects"] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((p) =>
          p.id === summaryProjectId
            ? { ...p, lifecycleStatus: summaryStatus }
            : p,
        );
      });
    }
  }, [
    unifiedSummary?.projectId,
    unifiedSummary?.lifecycleStatus,
    project?.id,
    project?.lifecycleStatus,
  ]);

  const handleChangeProject = (projectId) => {
    if (project?.id === projectId) return;
    loadedTreeProjectIdRef.current = null;
    setFileTree([]);
    setTreeVersion(null);
    setIsLoadingTree(true);
    setTabs([]);
    setActiveFileId(null);
    setActiveTabId(null);
    const newParams = new URLSearchParams(location.search);
    newParams.set("projectId", projectId);
    newParams.delete("snapshotId");
    newParams.delete("focusFile");
    newParams.delete("focusEndpoint");
    newParams.delete("focusScenario");
    navigate(`${location.pathname}?${newParams.toString()}`);
  };

  const handleDeleteProject = async (projectId) => {
    if (project?.id === projectId && !projectAccess.can("project.delete"))
      return false;
    try {
      const { deleteProjectApi, invalidateFileContentCache } =
        await import("../../services/project.service");
      await deleteProjectApi(projectId);
      invalidateFileContentCache(projectId);
      queryClient.removeQueries({
        queryKey: ["projectTree", user?.id, projectId],
      });
      queryClient.setQueriesData({ queryKey: ["projects"] }, (old) =>
        Array.isArray(old) ? old.filter((p) => p.id !== projectId) : old,
      );
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
      showToast({ type: "success", title: "Project deleted" });
      if (project?.id === projectId) {
        loadedTreeProjectIdRef.current = null;
        setProject(null);
        setFileTree([]);
        setTreeVersion(null);
        setIsLoadingTree(true);
        setTabs([]);
        setActiveFileId(null);
        setActiveTabId(null);
        const newParams = new URLSearchParams(location.search);
        const hadProjectIdParam = Boolean(newParams.get("projectId"));
        newParams.delete("projectId");
        newParams.delete("snapshotId");
        newParams.delete("focusFile");
        newParams.delete("focusEndpoint");
        newParams.delete("focusScenario");
        navigate(`${location.pathname}?${newParams.toString()}`, {
          replace: true,
        });
        if (!hadProjectIdParam) {
          loadData();
        }
      } else {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      }
      return true;
    } catch (err) {
      showToast({
        type: "error",
        title: "Delete failed",
        message: err.message || "Could not delete the project. Please retry.",
      });
      return false;
    }
  };

  const handleOpenFile = (node) => {
    if (node.type === "folder") return;
    setShowCFG(false);
    setActiveActivity("explorer");
    const params = new URLSearchParams(location.search);
    if (params.get("tab") !== "explorer") {
      params.set("tab", "explorer");
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
    setActiveFileId(node.id);
    if (!tabs.find((t) => t.id === node.id)) {
      setTabs((prev) => [
        ...prev,
        { id: node.id, name: node.name, unsaved: false },
      ]);
    }
    setActiveTabId(node.id);
  };

  const handleOpenFileByPath = (
    filePath,
    targetLine = null,
    functionName = null,
    endLine = null,
  ) => {
    setShowCFG(false);
    setActiveActivity("explorer");
    const params = new URLSearchParams(location.search);
    if (params.get("tab") !== "explorer") {
      params.set("tab", "explorer");
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const findNode = (nodes, path) => {
      for (const node of nodes) {
        if (
          node.id === path ||
          path.endsWith("/" + node.id) ||
          node.id.endsWith("/" + path)
        )
          return node;
        if (node.children) {
          const found = findNode(node.children, path);
          if (found) return found;
        }
      }
      return null;
    };
    const node = findNode(fileTree, normalizedPath);
    if (node) {
      handleOpenFile(node);
    } else {
      handleOpenFile({
        id: normalizedPath,
        name: normalizedPath.split("/").pop(),
        type: "file",
      });
    }

    if (targetLine && Number(targetLine) > 0) {
      setEditorJumpTarget({
        filePath: normalizedPath,
        line: Number(targetLine),
        endLine: endLine ? Number(endLine) : null,
        functionName: functionName || null,
        timestamp: Date.now(),
      });
    }
  };

  const handleCloseTab = (tabId) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (activeTabId === tabId) {
      if (next.length > 0) {
        const nextActiveId = next[Math.max(0, idx - 1)].id;
        setActiveTabId(nextActiveId);
        setActiveFileId(nextActiveId);
      } else {
        setActiveTabId(null);
        setActiveFileId(null);
      }
    }
  };

  const refreshProjectFiles = async (silent = true) => {
    if (!project?.id) return;
    try {
      if (silent) {
        const { getProjectTreeApi } =
          await import("../../services/project.service");
        const res = await getProjectTreeApi(project.id);
        const sourceTree = Array.isArray(res)
          ? res
          : res?.data || res?.tree || [];
        if (res?.success !== false && Array.isArray(sourceTree)) {
          loadedTreeProjectIdRef.current = project.id;
          setFileTree(sourceTree);
          if (res?.snapshotId !== undefined || res?.workspaceRevision !== undefined) {
            setTreeVersion({
              snapshotId: res.snapshotId ?? null,
              expectedWorkspaceRevision: res.workspaceRevision ?? null,
            });
          }
          queryClient.setQueryData(["projectTree", user?.id, project.id], {
            tree: sourceTree,
            snapshotId: res?.snapshotId ?? null,
            workspaceRevision: res?.workspaceRevision ?? null,
          });
        }
        await projectAccess.refetch();
      } else {
        await queryClient.invalidateQueries({ queryKey: ["projectTree"] });
        await projectAccess.refetch();
        await loadData(project?.id, 1, 0, { forceRefresh: true });
      }
    } catch (err) {
      console.warn("Silent tree refresh failed", err);
    }
  };

  const handleCreateFile = async (filePath) => {
    if (!project || !projectAccess.can("files.write")) return;
    const normalizedPath = filePath.replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop();

    // 1. Optimistically insert into tree immediately (instant 0ms response)
    setFileTree((prev) => insertNodeIntoTree(prev, normalizedPath, false));

    // 2. Open tab right away
    handleOpenFile({
      id: normalizedPath,
      name: fileName,
      type: "file",
    });

    try {
      const snapId =
        treeVersion?.snapshotId ||
        project.latestSnapshotId ||
        searchParams.get("snapshotId");
      const rev = Number.isSafeInteger(treeVersion?.expectedWorkspaceRevision)
        ? treeVersion.expectedWorkspaceRevision
        : 0;
      await createProjectFileApi(project.id, normalizedPath, "", {
        snapshotId: snapId,
        expectedWorkspaceRevision: rev,
      });
      refreshProjectFiles(true);
      window.dispatchEvent(
        new CustomEvent("covai:workspace-saved", {
          detail: { projectId: project.id, path: normalizedPath },
        }),
      );
      showToast({
        type: "success",
        title: "File created",
        message: normalizedPath,
      });
    } catch (err) {
      setFileTree((prev) => deleteNodeFromTree(prev, normalizedPath));
      showToast({
        type: "error",
        title: "Could not create file",
        message: err?.message || "File creation failed",
      });
    }
  };

  const handleCreateFolder = async (folderPath) => {
    if (!project || !projectAccess.can("files.write")) return;
    const normalizedPath = folderPath.replace(/\\/g, "/");

    // 1. Optimistically insert folder into tree immediately
    setFileTree((prev) => insertNodeIntoTree(prev, normalizedPath, true));

    try {
      const snapId =
        treeVersion?.snapshotId ||
        project.latestSnapshotId ||
        searchParams.get("snapshotId");
      const rev = Number.isSafeInteger(treeVersion?.expectedWorkspaceRevision)
        ? treeVersion.expectedWorkspaceRevision
        : 0;
      await createProjectFolderApi(project.id, normalizedPath, {
        snapshotId: snapId,
        expectedWorkspaceRevision: rev,
      });
      refreshProjectFiles(true);
      showToast({
        type: "success",
        title: "Folder created",
        message: normalizedPath,
      });
    } catch (err) {
      setFileTree((prev) => deleteNodeFromTree(prev, normalizedPath));
      showToast({
        type: "error",
        title: "Could not create folder",
        message: err?.message || "Folder creation failed",
      });
    }
  };

  const handleRenameEntry = async (filePath, newPath) => {
    if (!project || !projectAccess.can("files.write")) return;
    const normOld = filePath.replace(/\\/g, "/");
    const normNew = newPath.replace(/\\/g, "/");

    // 1. Optimistically rename in tree immediately
    setFileTree((prev) => renameNodeInTree(prev, normOld, normNew));

    // 2. Optimistically update open tabs
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === normOld
          ? { ...tab, id: normNew, name: normNew.split("/").pop() }
          : tab.id.startsWith(`${normOld}/`)
            ? { ...tab, id: `${normNew}${tab.id.slice(normOld.length)}` }
            : tab,
      ),
    );
    if (activeTabId === normOld) setActiveTabId(normNew);
    else if (activeTabId?.startsWith(`${normOld}/`)) {
      setActiveTabId(`${normNew}${activeTabId.slice(normOld.length)}`);
    }
    if (activeFileId === normOld) setActiveFileId(normNew);
    else if (activeFileId?.startsWith(`${normOld}/`)) {
      setActiveFileId(`${normNew}${activeFileId.slice(normOld.length)}`);
    }

    try {
      const snapId =
        treeVersion?.snapshotId ||
        project.latestSnapshotId ||
        searchParams.get("snapshotId");
      const rev = Number.isSafeInteger(treeVersion?.expectedWorkspaceRevision)
        ? treeVersion.expectedWorkspaceRevision
        : 0;
      await renameProjectEntryApi(project.id, normOld, normNew, {
        snapshotId: snapId,
        expectedWorkspaceRevision: rev,
      });
      refreshProjectFiles(true);
      window.dispatchEvent(
        new CustomEvent("covai:workspace-saved", {
          detail: { projectId: project.id, path: normNew },
        }),
      );
      showToast({
        type: "success",
        title: "Renamed",
        message: `${normOld} → ${normNew}`,
      });
    } catch (err) {
      setFileTree((prev) => renameNodeInTree(prev, normNew, normOld));
      showToast({
        type: "error",
        title: "Could not rename",
        message: err?.message || "Rename failed",
      });
    }
  };

  const handleDeleteEntry = async (node) => {
    if (!project || !projectAccess.can("files.write")) return;
    const targetPath = node.id.replace(/\\/g, "/");

    // 1. Optimistically delete from tree immediately
    setFileTree((prev) => deleteNodeFromTree(prev, targetPath));

    // 2. Optimistically close affected tabs
    setTabs((prev) =>
      prev.filter(
        (tab) => tab.id !== targetPath && !tab.id.startsWith(`${targetPath}/`),
      ),
    );
    if (
      activeFileId === targetPath ||
      activeFileId?.startsWith(`${targetPath}/`)
    ) {
      setActiveFileId(null);
      setActiveTabId(null);
    }

    try {
      const snapId =
        treeVersion?.snapshotId ||
        project.latestSnapshotId ||
        searchParams.get("snapshotId");
      const rev = Number.isSafeInteger(treeVersion?.expectedWorkspaceRevision)
        ? treeVersion.expectedWorkspaceRevision
        : 0;
      await deleteProjectEntryApi(project.id, targetPath, {
        snapshotId: snapId,
        expectedWorkspaceRevision: rev,
      });
      refreshProjectFiles(true);
      window.dispatchEvent(
        new CustomEvent("covai:workspace-saved", {
          detail: { projectId: project.id, path: targetPath },
        }),
      );
      showToast({
        type: "success",
        title: "Deleted",
        message: node.name || targetPath,
      });
    } catch (err) {
      refreshProjectFiles(false);
      showToast({
        type: "error",
        title: "Could not delete",
        message: err?.message || "Delete failed",
      });
    }
  };

  const handleRunTests = async () => {
    if (!project) return;
    setShowMissingTestFilesModal(true);
    setCurrentProjectName(project.name);
  };

  const handleGenerateTests = async (mode) => {
    setShowMissingTestFilesModal(false);
    try {
      await generateSkeletonApi(project.id, null, mode);
      showToast({
        type: "info",
        title: "Generation Started",
        message: `AI Test generation (${mode}) has been queued.`,
      });
    } catch (err) {
      showToast({ type: "error", title: "Generation Error" });
    } finally {
      setIsSubmittingAnalysis(false);
    }
  };

  const runButtonLocked =
    isSubmittingAnalysis ||
    ["QUEUED", "RUNNING", "SUCCESS"].includes(latestRunJob?.status);
  const runButtonLabel =
    latestRunJob?.status === "SUCCESS"
      ? "Tests Completed"
      : latestRunJob?.status === "RUNNING"
        ? "Running..."
        : latestRunJob?.status === "QUEUED"
          ? "Queued..."
          : "Run Tests";

  const rawActivePath = activeTabId || activeFileId;
  const activeFilePath = rawActivePath
    ? String(rawActivePath)
        .replace(/\\/g, "/")
        .replace(/^\.?\//, "")
    : null;
  const cleanFilePath =
    activeFilePath &&
    project?.name &&
    activeFilePath.startsWith(project.name + "/")
      ? activeFilePath.slice(project.name.length + 1)
      : activeFilePath;
  const filePathSegments = cleanFilePath
    ? cleanFilePath.split("/").filter(Boolean)
    : [];

  return (
    <div
      className="portfolio-studio ide-root"
      style={{ background: "var(--ps-bg)", color: "var(--ps-ink)" }}
    >
      <div className="flex items-center justify-between flex-shrink-0 h-11 px-3 sm:px-4 bg-[var(--ps-surface)] border-b border-[var(--ps-line)] text-[var(--ps-ink)] font-sans relative z-40 select-none">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 mr-2 overflow-hidden">
          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] p-1 bg-transparent border-0 cursor-pointer flex-shrink-0"
              aria-label="Toggle mobile menu"
            >
              {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              <CovaiLogo size={24} />
              <span className="font-bold text-xs tracking-tight text-[var(--color-text)]">
                CovAI
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                Studio
              </span>
            </div>
          )}
          {project?.name && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] font-mono min-w-0 overflow-hidden">
              <span className="flex-shrink-0 select-none">/</span>
              <button
                type="button"
                onClick={() => navigate("/projects")}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] font-medium transition-colors cursor-pointer"
                title="Return to Projects Quality Portfolio"
              >
                Projects
              </button>
              <span className="flex-shrink-0 select-none">/</span>
              <span
                className="text-[var(--color-text)] font-semibold truncate max-w-[120px] md:max-w-[180px]"
                title={project.name}
              >
                {project.name}
              </span>
              {project?.id && (
                <LifecycleStatusSelect
                  projectId={project.id}
                  align="left"
                  disabled={!projectAccess.can("files.write")}
                  currentStatus={
                    (project.lifecycleStatus &&
                    project.lifecycleStatus !== "NOT_STARTED"
                      ? project.lifecycleStatus
                      : unifiedSummary?.projectId === project.id &&
                          unifiedSummary?.lifecycleStatus
                        ? unifiedSummary.lifecycleStatus
                        : project.lifecycleStatus) || "NOT_STARTED"
                  }
                  onStatusChange={(newStatus) => {
                    setProject((prev) =>
                      prev ? { ...prev, lifecycleStatus: newStatus } : prev,
                    );
                    setProjects((prev) =>
                      (prev || []).map((p) =>
                        p.id === project.id
                          ? { ...p, lifecycleStatus: newStatus }
                          : p,
                      ),
                    );
                    setUnifiedSummary((prev) =>
                      prev && prev.projectId === project.id
                        ? { ...prev, lifecycleStatus: newStatus }
                        : prev,
                    );
                    queryClient.setQueriesData(
                      { queryKey: ["projects"] },
                      (old) => {
                        if (!Array.isArray(old)) return old;
                        return old.map((p) =>
                          p.id === project.id
                            ? { ...p, lifecycleStatus: newStatus }
                            : p,
                        );
                      },
                    );
                    queryClient.invalidateQueries({
                      queryKey: ["projectsPortfolio"],
                    });
                    queryClient.invalidateQueries({
                      queryKey: ["unifiedDashboard"],
                    });
                  }}
                  className="ml-1 shrink-0"
                />
              )}
              {filePathSegments.map((segment, idx) => {
                const isLast = idx === filePathSegments.length - 1;
                return (
                  <span
                    key={`${segment}-${idx}`}
                    className="flex items-center gap-1.5 min-w-0"
                  >
                    <span className="flex-shrink-0 select-none">/</span>
                    <span
                      className={`truncate max-w-[100px] md:max-w-[180px] ${
                        isLast
                          ? "text-[var(--color-text)] font-semibold"
                          : "text-[var(--color-text-secondary)] font-medium"
                      }`}
                      title={cleanFilePath}
                    >
                      {segment}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Center: Test Suite Levels (Unit, Integration, System) ── */}
        <div className="flex items-center justify-center flex-shrink-0 mx-2">
          <nav
            role="tablist"
            data-guide="top-test-levels"
            aria-label="Coverage Test Levels"
            className="inline-flex items-center p-0.5 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]"
          >
            {COVERAGE_TEST_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive =
                activeActivity === "coverage" && coverageType === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  id={`top-nav-test-${tab.key}`}
                  aria-selected={isActive}
                  aria-current={isActive ? "page" : undefined}
                  type="button"
                  onClick={() => {
                    handleSelectCoverageType(tab.key);
                    if (activeActivity !== "coverage") {
                      setShowCFG(false);
                      setActiveActivity("coverage");
                      const params = new URLSearchParams(location.search);
                      params.set("tab", "coverage");
                      params.set("type", tab.key);
                      params.set("coverageType", tab.key);
                      navigate(`${location.pathname}?${params.toString()}`);
                    }
                  }}
                  className={`relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-[5px] text-xs font-medium transition-colors duration-150 cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--ps-cobalt)] ${
                    isActive
                      ? "text-[var(--ps-ink)] font-semibold"
                      : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)]"
                  }`}
                  title={`${tab.label} Suite`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-test-tab-pill"
                      className="absolute inset-0 rounded-[5px] bg-[var(--ps-surface-2)] border border-[var(--ps-line-strong)]"
                      transition={{
                        type: "spring",
                        stiffness: 450,
                        damping: 32,
                      }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon
                      size={13}
                      strokeWidth={isActive ? 2 : 1.75}
                      className={
                        isActive
                          ? "text-[var(--ps-cobalt)]"
                          : "text-[var(--ps-ink-muted)]"
                      }
                    />
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div
          className="flex items-center gap-2 flex-1 justify-end"
          style={{ position: "relative" }}
        >
          <MissingTestFilesModal
            isOpen={showMissingTestFilesModal}
            onClose={() => setShowMissingTestFilesModal(false)}
            projectName={currentProjectName}
            onGenerate={handleGenerateTests}
          />

          <GlobalAiTokenPill />

          {!isMobile && (
            <button
              type="button"
              onClick={() => navigate("/projects")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] bg-[var(--ps-surface-2)] hover:border-[var(--ps-line-strong)] border border-[var(--ps-line)] transition-colors duration-150 cursor-pointer"
              title="Return to Projects Workspace"
            >
              <FolderPlus size={12} />
              {!isTablet && <span>Projects</span>}
            </button>
          )}

          <div className="flex items-center rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)] p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className={`p-1 rounded-[5px] transition-colors cursor-pointer ${
                sidebarOpen
                  ? "text-[var(--ps-ink)] bg-[var(--ps-surface-2)]"
                  : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)]"
              }`}
              title={
                sidebarOpen
                  ? "Collapse Explorer (Left)"
                  : "Expand Explorer (Left)"
              }
            >
              {sidebarOpen ? (
                <PanelLeftClose size={14} />
              ) : (
                <PanelLeftOpen size={14} />
              )}
            </button>

            <button
              type="button"
              onClick={() => setAiPanelOpen((o) => !o)}
              id="covai-chatbot-toggle"
              aria-label="AI Chatbot"
              aria-expanded={isAiPanelVisible}
              aria-controls="covai-chatbot"
              className={`px-1.5 py-1 rounded-[5px] transition-colors cursor-pointer flex items-center gap-1 ${
                isAiPanelVisible
                  ? "text-[var(--ps-ink)] bg-[var(--ps-surface-2)]"
                  : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)]"
              }`}
              title={isAiPanelVisible ? "Close AI Chatbot" : "Open AI Chatbot"}
            >
              {isAiPanelVisible ? (
                <PanelRightClose size={14} />
              ) : (
                <PanelRightOpen size={14} />
              )}
              <span className="hidden sm:inline text-[11px]">AI Chatbot</span>
            </button>

            <NotificationCenter userId={user?.id} size={14} variant="compact" />
          </div>
        </div>
      </div>
      <motion.div
        className="flex flex-1 overflow-hidden"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{ gap: 1, position: "relative" }}
      >
        {!isMobile && (
          <motion.div
            variants={panelVariants}
            className="h-full flex flex-col shrink-0"
          >
            <ActivityBar
              active={showCFG ? "logic-analysis" : activeActivity}
              onSelect={handleSelectActivity}
              vcsSummary={vcsSummary}
            />
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {sidebarOpen && !isFullWidthWorkspace && (
            <motion.div
              key="sidebar"
              data-guide="sidebar-explorer"
              initial={
                isMobile ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }
              }
              animate={
                isMobile
                  ? { x: 0, opacity: 1 }
                  : { width: sidebarWidth, opacity: 1 }
              }
              exit={
                isMobile ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }
              }
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              style={
                isMobile
                  ? {
                      position: "fixed",
                      top: 42,
                      bottom: 26,
                      left: 0,
                      width: 280,
                      maxWidth: "85vw",
                      overflow: "hidden",
                      zIndex: 35,
                      borderRight: "1px solid var(--color-border-strong)",
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.25)",
                    }
                  : {
                      overflow: "hidden",
                      flexShrink: 0,
                      borderRight: "1px solid var(--ide-border)",
                    }
              }
            >
              {activeActivity === "settings" ? (
                <SettingsSidebar
                  project={project}
                  activeSetting={activeSetting}
                  onSelectSetting={(s) => {
                    setActiveSetting(s);
                    if (isMobile) setSidebarOpen(false);
                  }}
                />
              ) : (
                <Sidebar
                  sidebarWidth={sidebarWidth}
                  onOpenFile={(node) => {
                    handleOpenFile(node);
                    if (isMobile && node.type !== "folder")
                      setSidebarOpen(false);
                  }}
                  activeFileId={activeFileId}
                  fileTree={fileTree}
                  project={project}
                  projects={projects}
                  onChangeProject={handleChangeProject}
                  onDeleteProject={handleDeleteProject}
                  isLoading={isLoadingTree}
                  onRefresh={() =>
                    loadData(project?.id || initialProjectId, 3, 2000, {
                      forceRefresh: true,
                    })
                  }
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onRenameEntry={handleRenameEntry}
                  onDeleteEntry={handleDeleteEntry}
                  vcsSummary={vcsSummary}
                  onOpenVersionControl={() => handleSelectActivity("version-control")}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {!isMobile && sidebarOpen && !isFullWidthWorkspace && (
          <PanelResizer
            onMouseDown={handleSidebarResize}
            isDragging={isDraggingSidebar}
            onDoubleClick={handleResetSidebarWidth}
            currentWidth={sidebarWidth}
            defaultWidth={DEFAULT_SIDEBAR_WIDTH}
            side="left"
            label="Explorer"
          />
        )}
        <motion.div
          data-guide="workspace-main"
          className="flex flex-1 min-w-0 min-h-0 relative"
          variants={panelVariants}
        >
          {(activeActivity === "settings" || visitedPanels.has("settings")) && (
            <div
              className={
                activeActivity === "settings"
                  ? "w-full h-full overflow-y-auto"
                  : "hidden"
              }
            >
              {isMobile && (
                <SettingsSidebar
                  project={project}
                  activeSetting={activeSetting}
                  onSelectSetting={setActiveSetting}
                  variant="tabs"
                />
              )}
              {activeSetting === "profile" && <UserProfile />}
              {activeSetting === "appearance" && <Appearance />}
              {activeSetting === "security" && <Security />}
              {activeSetting === "notifications" && <NotificationsSettings />}
              {activeSetting === "usage" && (
                <Usage isActive={activeActivity === "settings"} />
              )}
              {activeSetting === "billing" && <Billing />}
              {activeSetting === "members" && project?.id && (
                <ProjectMembersSettings
                  key={project.id}
                  projectId={project.id}
                  projectName={project.name}
                  access={projectAccess.access}
                  loading={projectAccess.isPending}
                  error={projectAccess.error}
                  onRetry={projectAccess.refetch}
                  tab={membersTab}
                  onTabChange={setMembersTabInUrl}
                />
              )}
            </div>
          )}

          {(activeActivity === "version-control" ||
            activeActivity === "git" ||
            visitedPanels.has("version-control") ||
            visitedPanels.has("git")) && (
            <div
              className={
                activeActivity === "version-control" || activeActivity === "git"
                  ? "w-full h-full overflow-y-auto"
                  : "hidden"
              }
            >
              <VersionControlWorkspace
                projectId={project?.id}
                project={project}
                onSync={handleVcsSync}
                onOpenFile={handleOpenFileByPath}
              />
            </div>
          )}

          {(activeActivity === "jobs" ||
            activeActivity === "activity" ||
            visitedPanels.has("jobs") ||
            visitedPanels.has("activity")) && (
            <div
              className={
                activeActivity === "jobs" || activeActivity === "activity"
                  ? "w-full h-full overflow-y-auto"
                  : "hidden"
              }
            >
              <JobQueue projectId={project?.id} onSync={handleVcsSync} />
            </div>
          )}

          {activeActivity === "trustworthiness" && (
            <div className="w-full h-full overflow-y-auto">
              <TrustworthinessWorkspace
                key={project?.id}
                projectId={project?.id}
              />
            </div>
          )}

          {(activeActivity === "architecture" ||
            visitedPanels.has("architecture")) && (
            <div
              className={
                activeActivity === "architecture"
                  ? "w-full h-full overflow-y-auto"
                  : "hidden"
              }
            >
              <ProjectArchitecturePanel
                key={project?.id || "none"}
                projectId={project?.id}
                initialFile={archInitialContext?.initialFile}
              />
            </div>
          )}

          {(activeActivity === "overview" || visitedPanels.has("overview")) && (
            <div
              className={
                activeActivity === "overview"
                  ? "w-full h-full overflow-y-auto"
                  : "hidden"
              }
            >
              <UnifiedDashboard
                projectId={project?.id || initialProjectId}
                project={project}
                projects={projects}
                onSelectProject={handleChangeProject}
                snapshotId={
                  searchParams.get("snapshotId") ||
                  project?.activeSnapshotId ||
                  project?.latestSnapshotId ||
                  project?.snapshots?.[0]?.id ||
                  (project?.id || initialProjectId
                    ? localStorage.getItem(
                        `latestSnapshot_${project?.id || initialProjectId}`,
                      )
                    : null) ||
                  testPromptSnapshotId
                }
                onNavigateWorkspace={(pillar, focus) => {
                  const targetUrl = buildWorkspaceUrl(location, pillar, focus);
                  navigate(targetUrl);
                }}
                onAskAi={handleAskAiPrompt}
                onSummaryChange={setUnifiedSummary}
              />
            </div>
          )}

          {(activeActivity === "coverage" || visitedPanels.has("coverage")) && (
            <div
              className={
                activeActivity === "coverage"
                  ? "w-full h-full overflow-hidden"
                  : "hidden"
              }
            >
              {(coverageType === "unit" ||
                visitedPanels.has("coverage:unit")) && (
                <div
                  className={
                    coverageType === "unit"
                      ? "h-full overflow-hidden flex flex-col min-h-0"
                      : "hidden"
                  }
                >
                  <RetainedPanel
                    active={
                      activeActivity === "coverage" && coverageType === "unit"
                    }
                  >
                    <UnitTestDashboard
                      onChatContextChange={updateChatTestContext}
                      snapshotId={
                        searchParams.get("snapshotId") ||
                        project?.activeSnapshotId ||
                        project?.latestSnapshotId ||
                        project?.snapshots?.[0]?.id ||
                        (project?.id
                          ? localStorage.getItem(`latestSnapshot_${project.id}`)
                          : null) ||
                        testPromptSnapshotId
                      }
                      projectId={project?.id}
                      treeVersion={treeVersion}
                      focusFile={searchParams.get("focusFile")}
                      onOpenFile={handleOpenFileByPath}
                      onSuggestTestcase={handleSuggestTestcase}
                      onOpenCFG={handleOpenCFG}
                      runTrigger={coverageRunTrigger}
                    />
                  </RetainedPanel>
                </div>
              )}
              {(coverageType === "integration" ||
                visitedPanels.has("coverage:integration")) && (
                <div
                  className={
                    coverageType === "integration"
                      ? "h-full overflow-hidden flex flex-col min-h-0"
                      : "hidden"
                  }
                >
                  <RetainedPanel
                    active={
                      activeActivity === "coverage" &&
                      coverageType === "integration"
                    }
                  >
                    <IntegrationTestDashboard
                      onChatContextChange={updateChatTestContext}
                      snapshotId={
                        searchParams.get("snapshotId") ||
                        project?.activeSnapshotId ||
                        project?.latestSnapshotId ||
                        project?.snapshots?.[0]?.id ||
                        (project?.id
                          ? localStorage.getItem(`latestSnapshot_${project.id}`)
                          : null) ||
                        testPromptSnapshotId
                      }
                      projectId={project?.id}
                      onOpenFile={handleOpenFileByPath}
                      onOpenCFG={handleOpenCFG}
                      onSuggestTestcase={handleSuggestTestcase}
                      onOpenArchitecture={handleOpenArchitecture}
                      initialContext={integrationInitialContext}
                      onContextChange={setIntegrationInitialContext}
                    />
                  </RetainedPanel>
                </div>
              )}
              {(coverageType === "system" ||
                visitedPanels.has("coverage:system")) && (
                <div
                  className={
                    coverageType === "system"
                      ? "h-full overflow-hidden flex flex-col min-h-0"
                      : "hidden"
                  }
                >
                  <RetainedPanel
                    active={
                      activeActivity === "coverage" && coverageType === "system"
                    }
                  >
                    {project?.id ? (
                      <SystemTestDashboard
                        onChatContextChange={updateChatTestContext}
                        snapshotId={
                          searchParams.get("snapshotId") ||
                          project?.activeSnapshotId ||
                          project?.snapshots?.[0]?.id ||
                          project?.latestSnapshotId ||
                          (project?.id
                            ? localStorage.getItem(
                                `latestSnapshot_${project.id}`,
                              )
                            : null) ||
                          testPromptSnapshotId
                        }
                        projectId={project?.id}
                        focusScenario={searchParams.get("focusScenario")}
                        onOpenFile={handleOpenFileByPath}
                      />
                    ) : (
                      <div
                        className="flex min-h-[400px] items-center justify-center text-sm text-[var(--color-text-secondary)]"
                        aria-busy="true"
                      >
                        Loading project...
                      </div>
                    )}
                  </RetainedPanel>
                </div>
              )}
            </div>
          )}

          {(!isFullWidthWorkspace ||
            visitedPanels.has("editor") ||
            visitedPanels.has("explorer")) && (
            <div
              data-guide="editor-workspace"
              className={
                !isFullWidthWorkspace &&
                activeActivity !== "settings" &&
                activeActivity !== "coverage"
                  ? "w-full h-full"
                  : "hidden"
              }
            >
              <Editor
                key={`${user?.id}:${project?.id}:${searchParams.get("snapshotId") || project?.activeSnapshotId || project?.latestSnapshotId || project?.snapshots?.[0]?.id || ""}`}
                tabs={tabs}
                activeTabId={activeTabId}
                onSelectTab={(tabId) => {
                  setActiveTabId(tabId);
                  setActiveFileId(tabId);
                }}
                onCloseTab={handleCloseTab}
                onReorderTabs={setTabs}
                fileTree={fileTree}
                isLoadingTree={isLoadingTree}
                projectId={project?.id}
                snapshotId={
                  searchParams.get("snapshotId") ||
                  project?.activeSnapshotId ||
                  project?.latestSnapshotId ||
                  project?.snapshots?.[0]?.id ||
                  (project?.id
                    ? localStorage.getItem(`latestSnapshot_${project.id}`)
                    : null) ||
                  testPromptSnapshotId
                }
                coverageType={coverageType}
                onOpenFile={handleOpenFileByPath}
                onRunAnalysis={handleTriggerRunAnalysis}
                onSuggestTestcase={handleSuggestTestcase}
                refreshTrigger={editorRefreshTrigger}
                jumpTarget={editorJumpTarget}
              />
            </div>
          )}
        </motion.div>
        <>
          {isAiPanelVisible && !isMobile && (
            <PanelResizer
              onMouseDown={handleAiPanelResize}
              isDragging={isDraggingAiPanel}
              onDoubleClick={handleResetAiPanelWidth}
              currentWidth={aiPanelWidth}
              defaultWidth={DEFAULT_AI_PANEL_WIDTH}
              side="right"
              label="COV Assistant"
            />
          )}
          <motion.div
            id="covai-chatbot"
            aria-label="AI Chatbot"
            role="complementary"
            key={`ai-panel:${user?.id}:${project?.id}`}
            initial={
              isMobile ? { x: 320, opacity: 0 } : { width: 0, opacity: 0 }
            }
            animate={
              isMobile
                ? { x: 0, opacity: 1 }
                : { width: aiPanelWidth, opacity: 1 }
            }
            exit={isMobile ? { x: 320, opacity: 0 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={
              isMobile
                ? {
                    position: "fixed",
                    top: 42,
                    bottom: 26,
                    right: 0,
                    width: "100%",
                    maxWidth: 360,
                    display: isAiPanelVisible ? undefined : "none",
                    overflow: "hidden",
                    zIndex: 35,
                    boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
                  }
                : {
                    overflow: "hidden",
                    flexShrink: 0,
                    display: isAiPanelVisible ? undefined : "none",
                  }
            }
          >
            <RetainedPanel
              key={`${user?.id}:${project?.id}`}
              active={isAiPanelVisible}
            >
              <AIPanel
                onClose={closeChatbot}
                key={`${user?.id}:${project?.id}`}
                screenContext={screenContext}
                projectId={project?.id}
                snapshotId={chatSnapshotId}
                fileTree={fileTree}
                pendingAiSuggestion={pendingAiSuggestion}
                onClearPendingSuggestion={() => setPendingAiSuggestion(null)}
                onOpenFile={handleOpenFileByPath}
                onRunAnalysis={handleTriggerRunAnalysis}
              />
            </RetainedPanel>
          </motion.div>
        </>
      </motion.div>
      <div className="flex items-center justify-between flex-shrink-0 h-6 px-3 sm:px-4 bg-[var(--ps-surface)] border-t border-[var(--ps-line)] text-[11px] text-[var(--ps-ink-muted)] ps-mono whitespace-nowrap select-none">
        <div className="flex items-center gap-3 shrink-0">
          <VcsStatusBar
            projectId={project?.id}
            vcsSummary={vcsSummary}
            isMobile={isMobile}
            canSwitchBranch={
              vcMode === VC_MODES.GIT_GITHUB
                ? projectAccess.can("integrations.write")
                : projectAccess.can("snapshot.restore")
            }
            disabledReason="Owner role required to switch branches"
            onOpenVersionControl={() => handleSelectActivity("version-control")}
            onSync={handleVcsSync}
          />
          {!isMobile && (
            <>
              <div className="w-px h-3 bg-[var(--ps-line)]" />
              <div className="flex items-center gap-1.5 text-[var(--ps-emerald)]">
                <CheckCircle2 size={11} />
                <span>Engine Ready</span>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--ps-ink-muted)] font-sans">
                <span>{project?.name || "Workspace"}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[var(--ps-ink-secondary)]">
            <BarChart3 size={11} className="text-[var(--ps-ink-muted)]" />
            <span>Target: 80%+</span>
          </div>
          {!isMobile && (
            <>
              <div className="w-px h-3 bg-[var(--ps-line)]" />
              <span>UTF-8</span>
            </>
          )}
        </div>
      </div>
      <AnimatePresence>
        {showImport && (
          <ImportLayout
            onClose={() => setShowImport(false)}
            onSuccess={() => {
              setShowImport(false);
              setShowCFG(false);
              openFloatingJobQueue({ domain: "import" });
              setTimeout(
                () => loadData(null, 3, 2500, { forceRefresh: true }),
                1500,
              );
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCFG && (
          <CFGCalculator
            project={project}
            snapshotId={
              searchParams.get("snapshotId") ||
              project?.latestSnapshotId ||
              project?.snapshots?.[0]?.id ||
              (project?.id
                ? localStorage.getItem(`latestSnapshot_${project.id}`)
                : null) ||
              testPromptSnapshotId
            }
            onClose={handleCloseCFG}
            initialFile={cfgInitialContext?.initialFile}
            initialFunc={cfgInitialContext?.initialFunc}
            initialLine={cfgInitialContext?.initialLine}
            onOpenFile={handleOpenFileByPath}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showQualityDashboard && (
          <QualityDashboard
            projectId={project?.id}
            onClose={() => setShowQualityDashboard(false)}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        title="Sign Out"
        message="Are you sure you want to sign out of your workspace session? You will be redirected to the home landing page."
        confirmText="Sign Out"
        cancelText="Cancel"
        variant="danger"
        icon={LogOut}
      />
      <SpotlightTourOverlay
        tourKey={resolveTourKey({
          page: "workspace",
          activeActivity,
          coverageType,
          showCFG,
        })}
        userId={user?.id}
        suppressed={
          showImport ||
          showLogoutConfirm ||
          showQualityDashboard ||
          showMissingTestFilesModal
        }
      />
    </div>
  );
}

export default function Layout() {
  return (
    <ToastProvider>
      <LayoutInner />
    </ToastProvider>
  );
}
