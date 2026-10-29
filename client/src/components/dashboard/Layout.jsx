/* eslint-disable no-unused-vars */
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import ActivityBar from "./ActivityBar";
import Sidebar from "./Sidebar";
import CoveragePanel from "./CoveragePanel";
import Editor from "./Editor";
import GitPanel from "./GitPanel";
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
import UnifiedDashboard from "./unified/UnifiedDashboard";
import { buildWorkspaceUrl } from "../../services/unifiedDashboard/workspaceNavigation";
import SettingsSidebar from "./settings/SettingsSidebar";
import ProjectMembersSettings from "./settings/ProjectMembersSettings";
import { useProjectAccess } from "../../hooks/useProjectAccess";
import { useProjectEvents } from "../../hooks/useProjectEvents";
import UserProfile from "./settings/UserProfile";
import Appearance from "./settings/Appearance";
import Security from "./settings/Security";
import Billing from "./settings/Billing";
import { ToastProvider, useToast } from "./ToastContext";
import MissingTestFilesModal from "./MissingTestFilesModal";
import PanelResizer from "./PanelResizer";
import ConfirmDialog from "../common/ConfirmDialog";
import ProjectExportDialog from "./ProjectExportDialog";
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
  Terminal,
  LogOut,
  Download,
} from "lucide-react";

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
import { getProjectJobsApi } from "../../services/job.service";
import { queryClient } from "../../lib/queryClient.js";

const INITIAL_TABS = [];
const DEFAULT_SIDEBAR_WIDTH = 260;
const DEFAULT_AI_PANEL_WIDTH = 340;

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
  const { user, logout } = useAuth();
  const searchParams = new URLSearchParams(location.search);
  const initialProjectId = searchParams.get("projectId");
  const initialTab = searchParams.get("tab") || "explorer";
  const { isMobile, isTablet } = useBreakpoints();
  const isCompact = isMobile || isTablet;

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showCFG, setShowCFG] = useState(false);

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/", { replace: true });
  };

  const handleSelectActivity = (id) => {
    if (id === "logout") {
      setShowLogoutConfirm(true);
      return;
    }
    if (id === "logic-analysis") {
      setShowCFG(true);
      return;
    }
    const params = new URLSearchParams(location.search);
    params.set("tab", id);
    navigate(`${location.pathname}?${params.toString()}`);
  };

  const [activeActivity, setActiveActivity] = useState(initialTab);
  const [showGit, setShowGit] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab") || "explorer";
    if (tab === "logic-analysis") {
      setShowCFG(true);
    }
    if (tab === "system") {
      setActiveActivity("coverage");
      setCoverageType("system");
    } else {
      setActiveActivity(tab);
      const type = params.get("coverageType") || params.get("type");
      if (type) setCoverageType(type);
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

  const allowedSettings = ["profile", "appearance", "security", "notifications", "billing", "members"];
  const selectedSetting = searchParams.get("setting");
  const activeSetting = allowedSettings.includes(selectedSetting) ? selectedSetting : "profile";
  const membersTab = searchParams.get("membersTab") === "pending" ? "pending" : "members";
  const setActiveSetting = setting => {
    const params = new URLSearchParams(location.search);
    params.set("tab", "settings");
    params.set("setting", allowedSettings.includes(setting) ? setting : "profile");
    navigate(`${location.pathname}?${params}`);
  };
  const setMembersTabInUrl = tab => {
    const params = new URLSearchParams(location.search);
    params.set("tab", "settings"); params.set("setting", "members");
    params.set("membersTab", tab === "pending" ? "pending" : "members");
    navigate(`${location.pathname}?${params}`);
  };
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [aiPanelWidth, setAiPanelWidth] = useState(DEFAULT_AI_PANEL_WIDTH);
  const [isDraggingAiPanel, setIsDraggingAiPanel] = useState(false);
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState(null);
  const [activeFileId, setActiveFileId] = useState(null);
  const initialCoverageType = searchParams.get("coverageType") || searchParams.get("type") || (searchParams.get("tab") === "system" ? "system" : "unit");
  const [coverageType, setCoverageType] = useState(initialCoverageType);
  const screenContext = useMemo(() => ({ activity: activeActivity, testType: activeActivity === "coverage" ? coverageType : undefined, filePath: activeActivity === "explorer" ? activeTabId || undefined : undefined }), [activeActivity, coverageType, activeTabId]);
  const [showImport, setShowImport] = useState(false);
  const [showQualityDashboard, setShowQualityDashboard] = useState(false);
  const [cfgInitialContext, setCfgInitialContext] = useState(null);
  const [editorJumpTarget, setEditorJumpTarget] = useState(null);
  const [archInitialContext, setArchInitialContext] = useState(null);
  const [integrationInitialContext, setIntegrationInitialContext] = useState(null);

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

  const handleOpenCFG = (filePath = null, functionName = null, initialLine = null) => {
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
  const [showTestPrompt, setShowTestPrompt] = useState(false);
  const [showMissingTestFilesModal, setShowMissingTestFilesModal] =
    useState(false);
  const [currentProjectName, setCurrentProjectName] = useState(null);
  const [testPromptSnapshotId, setTestPromptSnapshotId] = useState(null);
  const [pendingAiSuggestion, setPendingAiSuggestion] = useState(null);

  const handleSuggestTestcase = (filePath, options = {}) => {
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
  }, []);

  useEffect(() => {
    const onPrefillEvent = (e) => {
      const text = e.detail?.promptText;
      if (text) {
        setAiPanelOpen(true);
        setPendingAiSuggestion({ promptText: text, timestamp: Date.now() });
      }
    };
    window.addEventListener("covai:prefill-prompt", onPrefillEvent);
    return () => window.removeEventListener("covai:prefill-prompt", onPrefillEvent);
  }, []);

  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const projectAccess = useProjectAccess(project?.id);
  const [fileTree, setFileTree] = useState([]);
  const [treeVersion, setTreeVersion] = useState(null);
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [latestRunJob, setLatestRunJob] = useState(null);
  const [isSubmittingAnalysis, setIsSubmittingAnalysis] = useState(false);
  const [editorRefreshTrigger, setEditorRefreshTrigger] = useState(0);
  const [coverageRunTrigger, setCoverageRunTrigger] = useState(0);
  useEffect(() => {
    if (![403, 404].includes(projectAccess.error?.status)) return;
    queryClient.cancelQueries({ predicate: query => query.queryKey.includes(project?.id) });
    queryClient.removeQueries({ predicate: query => query.queryKey.includes(project?.id) });
    setFileTree([]);
    setProject(null);
    navigate("/projects", { replace: true, state: { projectAccessLost: true } });
  }, [projectAccess.error, project?.id, navigate]);

  useProjectEvents(project?.id, user?.id, event => {
    if (event.revoked) { setFileTree([]); setProject(null); navigate("/projects", { replace: true, state: { projectAccessLost: true } }); return; }
    if (/file|workspace|snapshot/i.test(event.type || "")) setEditorRefreshTrigger(value => value + 1);
  });

  const handleSelectCoverageType = (type) => {
    setCoverageType(type);
    const params = new URLSearchParams(location.search);
    if (params.get("coverageType") !== type) {
      params.set("coverageType", type);
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
  };

  const handleTriggerRunAnalysis = () => {
    setActiveActivity("coverage");
    handleSelectCoverageType("unit");
    setCoverageRunTrigger((prev) => prev + 1);
  };

  const handleGitSync = async () => {
    try {
      await loadData(project?.id, 1, 0);
      setEditorRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to sync after git operation", err);
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
          project.snapshots?.[0]?.id ||
          project.latestSnapshotId ||
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
          const hasActiveJob = jobs.some((j) => ["QUEUED", "RUNNING"].includes(j.status));
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

    refreshRunJob();
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
      setAiPanelOpen(true);
    }
  }, [isMobile, isTablet]);

  const loadData = useCallback(
    async (activeProjId = null, retries = 3, delay = 2000) => {
      setIsLoadingTree(true);
      try {
        const { getProjectsApi, getProjectTreeApi } =
          await import("../../services/project.service");
        const loadedProjects = await queryClient.fetchQuery({
          queryKey: ["projects", user?.id],
          queryFn: async () => {
            const res = await getProjectsApi();
            return res?.projects || [];
          },
          staleTime: 5 * 60 * 1000,
        });
        if (loadedProjects && loadedProjects.length > 0) {
          setProjects(loadedProjects);
          const targetProj = activeProjId
            ? loadedProjects.find((p) => p.id === activeProjId) ||
            loadedProjects[0]
            : loadedProjects[0];
          setProject(targetProj);
          if (targetProj && searchParams.get("projectId") !== targetProj.id) {
            const newParams = new URLSearchParams(location.search);
            newParams.set("projectId", targetProj.id);
            navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
          }
          let lastError = null;
          for (let attempt = 1; attempt <= retries; attempt++) {
            try {
              const tree = await queryClient.fetchQuery({
                queryKey: ["projectTree", user?.id, targetProj.id],
                queryFn: async () => {
                  const res = await getProjectTreeApi(targetProj.id);
                  return { tree: res?.data || [], snapshotId: res.snapshotId, workspaceRevision: res.workspaceRevision };
                },
                staleTime: 10 * 1000,
              });
              const sourceTree = Array.isArray(tree) ? tree : tree.tree;
              setTreeVersion(Array.isArray(tree) ? null : { snapshotId: tree.snapshotId, expectedWorkspaceRevision: tree.workspaceRevision });
              setFileTree(sourceTree || []);
              if (sourceTree && sourceTree.length > 0) {
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
              lastError = null;
              break;
            } catch (treeErr) {
              lastError = treeErr;
              if (attempt < retries) {
                await new Promise((r) => setTimeout(r, delay));
              }
            }
          }
          if (lastError) {
            setFileTree([]);
            showToast({
              type: "warning",
              title: "Project tree not ready",
              message: "Source code is still being extracted.",
            });
          }
        } else {
          setProjects([]);
          setProject(null);
          setFileTree([]);
        }
      } catch (err) {
        showToast({
          type: "error",
          title: "Load failed",
          message: "Could not load project data.",
        });
      } finally {
        setIsLoadingTree(false);
      }
    },
    [showToast, user?.id],
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
    if (!project?.id) return;
    let alive = true;
    let request = 0;
    const refreshTree = async event => {
      if (event.detail?.projectId !== project.id || !/workspace|file|snapshot/i.test(event.detail?.type || "")) return;
      const currentRequest = ++request;
      try {
        const response = await getProjectTreeApi(project.id);
        if (!alive || currentRequest !== request) return;
        const next = { tree: response.data || [], snapshotId: response.snapshotId, workspaceRevision: response.workspaceRevision };
        queryClient.setQueryData(["projectTree", user?.id, project.id], next);
        setFileTree(next.tree);
        setTreeVersion({ snapshotId: next.snapshotId, expectedWorkspaceRevision: next.workspaceRevision });
      } catch { /* A revoked project is handled by the access boundary. */ }
    };
    window.addEventListener("covai:project-event", refreshTree);
    return () => { alive = false; window.removeEventListener("covai:project-event", refreshTree); };
  }, [project?.id, user?.id]);

  const handleChangeProject = (projectId) => {
    if (project?.id === projectId) return;
    setFileTree([]);
    setTabs([]);
    setActiveFileId(null);
    setActiveTabId(null);
    const newParams = new URLSearchParams(location.search);
    newParams.set("projectId", projectId);
    navigate(`${location.pathname}?${newParams.toString()}`);
    loadData(projectId);
  };

  const handleDeleteProject = async (projectId) => {
    if (project?.id === projectId && !projectAccess.can("project.delete")) return;
    try {
      const { deleteProjectApi } =
        await import("../../services/project.service");
      await deleteProjectApi(projectId);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      showToast({ type: "success", title: "Project deleted" });
      if (project?.id === projectId) {
        setFileTree([]);
        setTabs([]);
        setActiveFileId(null);
        setActiveTabId(null);
        const newParams = new URLSearchParams(location.search);
        newParams.delete("projectId");
        navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
        loadData();
      } else {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      }
    } catch (err) {
      showToast({ type: "error", title: "Delete failed" });
    }
  };

  const handleOpenFile = (node) => {
    if (node.type === "folder") return;
    setActiveActivity("explorer");
    setActiveFileId(node.id);
    if (!tabs.find((t) => t.id === node.id)) {
      setTabs((prev) => [
        ...prev,
        { id: node.id, name: node.name, unsaved: false },
      ]);
    }
    setActiveTabId(node.id);
  };

  const handleOpenFileByPath = (filePath, targetLine = null, functionName = null, endLine = null) => {
    setActiveActivity("explorer");
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

  const refreshProjectFiles = async () => {
    await queryClient.invalidateQueries({ queryKey: ["projectTree"] });
    await projectAccess.refetch();
    await loadData(project?.id, 1, 0);
  };

  const handleCreateFile = async (filePath) => {
    if (!project || !projectAccess.can("files.write")) return;
    try {
      await createProjectFileApi(project.id, filePath, "", treeVersion || {});
      await refreshProjectFiles();
      handleOpenFile({
        id: filePath.replace(/\\/g, "/"),
        name: filePath.split(/[\\/]/).pop(),
        type: "file",
      });
    } catch (err) {
      showToast({ type: "error", title: "Could not create file" });
    }
  };

  const handleCreateFolder = async (folderPath) => {
    if (!project || !projectAccess.can("files.write")) return;
    try {
      await createProjectFolderApi(project.id, folderPath, treeVersion || {});
      await refreshProjectFiles();
    } catch (err) {
      showToast({ type: "error", title: "Could not create folder" });
    }
  };

  const handleRenameEntry = async (filePath, newPath) => {
    if (!project || !projectAccess.can("files.write")) return;
    try {
      await renameProjectEntryApi(project.id, filePath, newPath, treeVersion || {});
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === filePath
            ? { ...tab, id: newPath, name: newPath.split("/").pop() }
            : tab,
        ),
      );
      if (activeTabId === filePath) setActiveTabId(newPath);
      if (activeFileId === filePath) setActiveFileId(newPath);
      await refreshProjectFiles();
    } catch (err) {
      showToast({ type: "error", title: "Could not rename" });
    }
  };

  const handleDeleteEntry = async (node) => {
    if (!project || !projectAccess.can("files.write")) return;
    try {
      await deleteProjectEntryApi(project.id, node.id, treeVersion || {});
      setTabs((prev) =>
        prev.filter(
          (tab) => tab.id !== node.id && !tab.id.startsWith(`${node.id}/`),
        ),
      );
      if (activeFileId === node.id || activeFileId?.startsWith(`${node.id}/`)) {
        setActiveFileId(null);
        setActiveTabId(null);
      }
      await refreshProjectFiles();
    } catch (err) {
      showToast({ type: "error", title: "Could not delete" });
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
      className="ide-root"
      style={{ background: "var(--ide-bg)", color: "var(--text-primary)" }}
    >
      <div className="flex items-center justify-between flex-shrink-0 h-11 px-3 sm:px-4 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-[var(--color-text)] font-sans relative z-40 select-none">
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
              <div className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xs shrink-0">
                <Terminal size={13} strokeWidth={2.5} />
              </div>
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
              <span
                className="text-[var(--color-text-secondary)] font-medium truncate max-w-[120px] md:max-w-[180px]"
                title={project.name}
              >
                {project.name}
              </span>
              {filePathSegments.map((segment, idx) => {
                const isLast = idx === filePathSegments.length - 1;
                return (
                  <span
                    key={`${segment}-${idx}`}
                    className="flex items-center gap-1.5 min-w-0"
                  >
                    <span className="flex-shrink-0 select-none">/</span>
                    <span
                      className={`truncate max-w-[100px] md:max-w-[180px] ${isLast
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

        <div
          className="flex items-center gap-2"
          style={{ position: "relative" }}
        >
          <MissingTestFilesModal
            isOpen={showMissingTestFilesModal}
            onClose={() => setShowMissingTestFilesModal(false)}
            projectName={currentProjectName}
            onGenerate={handleGenerateTests}
          />

          {!isMobile && (
            <button
              type="button"
              onClick={() => navigate("/projects")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)] border border-[var(--color-border)] transition-colors cursor-pointer"
              title="Return to Projects Workspace"
            >
              <FolderPlus size={12} />
              {!isTablet && <span>Projects</span>}
            </button>
          )}

          {project?.id && (
            <button
              type="button"
              onClick={() => setShowExport(true)}
              aria-label="Export project and analysis"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)] border border-[var(--color-border)] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
            >
              <Download size={13} />
              {!isMobile && <span>Export</span>}
            </button>
          )}

          <div className="flex items-center rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className={`p-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${sidebarOpen
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
              className={`p-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${aiPanelOpen
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              title={
                aiPanelOpen
                  ? "Collapse Assistant (Right)"
                  : "Expand Assistant (Right)"
              }
            >
              {aiPanelOpen ? (
                <PanelRightClose size={14} />
              ) : (
                <PanelRightOpen size={14} />
              )}
            </button>

            <NotificationCenter userId={user?.id} size={14} />
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
            />
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {sidebarOpen && activeActivity !== "architecture" && activeActivity !== "overview" && (
            <motion.div
              key="sidebar"
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
              ) : activeActivity === "coverage" ? (
                <CoveragePanel
                  sidebarWidth={sidebarWidth}
                  coverageType={coverageType}
                  setCoverageType={handleSelectCoverageType}
                />
              ) : activeActivity === "git" ? (
                <GitPanel projectId={project?.id} onSync={handleGitSync} />
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
                  onRefresh={() => loadData(project?.id, 3, 2000)}
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onRenameEntry={handleRenameEntry}
                  onDeleteEntry={handleDeleteEntry}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {!isMobile && sidebarOpen && activeActivity !== "architecture" && activeActivity !== "overview" && (
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
          className="flex flex-1 min-w-0 min-h-0 relative"
          variants={panelVariants}
        >
          <div className={activeActivity === "settings" ? "w-full h-full overflow-y-auto" : "hidden"}>
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
            {activeSetting === "billing" && <Billing />}
            {activeSetting === "members" && project?.id && <ProjectMembersSettings key={project.id} projectId={project.id} projectName={project.name} access={projectAccess.access} loading={projectAccess.isPending} error={projectAccess.error} onRetry={projectAccess.refetch} tab={membersTab} onTabChange={setMembersTabInUrl} />}
          </div>

          <div className={activeActivity === "jobs" ? "w-full h-full overflow-y-auto" : "hidden"}>
            <JobQueue projectId={project?.id} onSync={handleGitSync} />
          </div>

          <div className={activeActivity === "architecture" ? "w-full h-full overflow-y-auto" : "hidden"}>
            <ProjectArchitecturePanel
              projectId={project?.id}
              initialFile={archInitialContext?.initialFile}
            />
          </div>

          <div className={activeActivity === "overview" ? "w-full h-full overflow-y-auto" : "hidden"}>
            <UnifiedDashboard
              projectId={project?.id}
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
              onNavigateWorkspace={(pillar, focus) => {
                const targetUrl = buildWorkspaceUrl(location, pillar, focus);
                navigate(targetUrl);
              }}
              onAskAi={handleAskAiPrompt}
            />
          </div>

          <div className={activeActivity === "coverage" ? "w-full h-full overflow-hidden" : "hidden"}>
            <div className={coverageType === "unit" ? "h-full overflow-y-auto" : "hidden"}>
              <UnitTestDashboard
                snapshotId={
                  searchParams.get("snapshotId") ||
                  project?.latestSnapshotId ||
                  project?.snapshots?.[0]?.id ||
                  (project?.id
                    ? localStorage.getItem(`latestSnapshot_${project.id}`)
                    : null) ||
                  testPromptSnapshotId
                }
                projectId={project?.id}
                onOpenFile={handleOpenFileByPath}
                onSuggestTestcase={handleSuggestTestcase}
                onOpenCFG={handleOpenCFG}
                runTrigger={coverageRunTrigger}
              />
            </div>
            <div className={coverageType === "integration" ? "h-full overflow-hidden flex flex-col min-h-0" : "hidden"}>
              <IntegrationTestDashboard
                snapshotId={
                  searchParams.get("snapshotId") ||
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
            </div>
            <div className={coverageType === "system" ? "h-full overflow-y-auto" : "hidden"}>
              <SystemTestDashboard
                snapshotId={
                  project?.snapshots?.[0]?.id ||
                  project?.latestSnapshotId ||
                  (project?.id
                    ? localStorage.getItem(`latestSnapshot_${project.id}`)
                    : null) ||
                  testPromptSnapshotId
                }
                projectId={project?.id}
                onOpenFile={handleOpenFileByPath}
              />
            </div>
          </div>

          <div className={activeActivity !== "settings" && activeActivity !== "jobs" && activeActivity !== "architecture" && activeActivity !== "coverage" && activeActivity !== "overview" ? "w-full h-full" : "hidden"}>
                <Editor
                  key={`${user?.id}:${project?.id}:${project?.snapshots?.[0]?.id || project?.latestSnapshotId || ""}`}
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
                    project?.snapshots?.[0]?.id ||
                    project?.latestSnapshotId ||
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
        </motion.div>
        <AnimatePresence initial={false}>
          {aiPanelOpen && (
            <>
              {!isMobile && (
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
                key="ai-panel"
                initial={
                  isMobile ? { x: 320, opacity: 0 } : { width: 0, opacity: 0 }
                }
                animate={
                  isMobile
                    ? { x: 0, opacity: 1 }
                    : { width: aiPanelWidth, opacity: 1 }
                }
                exit={
                  isMobile ? { x: 320, opacity: 0 } : { width: 0, opacity: 0 }
                }
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
                      overflow: "hidden",
                      zIndex: 35,
                      boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
                    }
                    : { overflow: "hidden", flexShrink: 0 }
                }
              >
                <AIPanel
                  key={`${user?.id}:${project?.id}`}
                  screenContext={screenContext}
                  projectId={project?.id}
                  snapshotId={
                    project?.snapshots?.[0]?.id ||
                    project?.latestSnapshotId ||
                    (project?.id
                      ? localStorage.getItem(`latestSnapshot_${project.id}`)
                      : null) ||
                    testPromptSnapshotId
                  }
                  fileTree={fileTree}
                  pendingAiSuggestion={pendingAiSuggestion}
                  onClearPendingSuggestion={() => setPendingAiSuggestion(null)}
                  onOpenFile={handleOpenFileByPath}
                  onRunAnalysis={handleTriggerRunAnalysis}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>
      <div className="flex items-center justify-between flex-shrink-0 h-6 px-3 sm:px-4 bg-[var(--color-surface)] border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] font-mono whitespace-nowrap overflow-x-auto select-none">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <GitBranch size={11} className="text-[var(--color-primary)]" />
            {!isMobile && <span>main</span>}
          </div>
          {!isMobile && (
            <>
              <div className="w-px h-3 bg-[var(--color-border)]" />
              <div className="flex items-center gap-1.5 text-[var(--color-success)]">
                <CheckCircle2 size={11} />
                <span>Engine Ready</span>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] font-sans">
                <span>{project?.name || "Workspace"}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <BarChart3 size={11} className="text-[var(--color-primary)]" />
            <span>Target: 80%+</span>
          </div>
          {!isMobile && (
            <>
              <div className="w-px h-3 bg-[var(--color-border)]" />
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
              setActiveActivity("jobs");
              setTimeout(() => loadData(null, 3, 2500), 1500);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCFG && (
          <CFGCalculator
            project={project}
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
      {showExport && project?.id && (
        <ProjectExportDialog
          key={project.id}
          project={project}
          initialSnapshotId={project.snapshots?.[0]?.id || project.latestSnapshotId || localStorage.getItem(`latestSnapshot_${project.id}`)}
          onClose={() => setShowExport(false)}
        />
      )}
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
