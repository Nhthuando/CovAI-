/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import ActivityBar from "./ActivityBar";
import Sidebar from "./Sidebar";
import Editor from "./Editor";
import CoverageDashboard from "./CoverageDashboard";
import AIPanel from "./AIPanel";
import TestModeSelector from "./TestModeSelector";
import ImportLayout from "./import/ImportLayout";
import JobQueue from "./JobQueue";
import ProjectArchitecturePanel from "./ProjectArchitecturePanel";
import CFGCalculator from "./CFGCalculator";
import QualityDashboard from "./QualityDashboard";
import SettingsSidebar from "./settings/SettingsSidebar";
import UserProfile from "./settings/UserProfile";
import Appearance from "./settings/Appearance";
import { ToastProvider, useToast } from "./ToastContext";
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
  Award,
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

const INITIAL_TABS = [];

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
  const { user } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const initialProjectId = searchParams.get("projectId");
  const { isMobile, isTablet } = useBreakpoints();
  const isCompact = isMobile || isTablet;

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const handleSelectActivity = (id) => {
    if (id === "logout") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("userName");
      localStorage.removeItem("userEmail");
      navigate("/");
      return;
    }
    setActiveActivity(id);
  };

  const [activeActivity, setActiveActivity] = useState("explorer");
  const [activeSetting, setActiveSetting] = useState("profile");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [aiPanelWidth, setAiPanelWidth] = useState(340);
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState(null);
  const [activeFileId, setActiveFileId] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showCFG, setShowCFG] = useState(false);
  const [showQualityDashboard, setShowQualityDashboard] = useState(false);
  const [showTestPrompt, setShowTestPrompt] = useState(false);
  const [showTestModeSelector, setShowTestModeSelector] = useState(false);
  const [testPromptSnapshotId, setTestPromptSnapshotId] = useState(null);

  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [latestRunJob, setLatestRunJob] = useState(null);
  const [isSubmittingAnalysis, setIsSubmittingAnalysis] = useState(false);

  useEffect(() => {
    if (!project?.id) {
      setLatestRunJob(null);
      return undefined;
    }
    let cancelled = false;
    const refreshRunJob = async () => {
      try {
        const response = await getProjectJobsApi(project.id);
        const jobs = response.jobs || [];
        const targetSnapshotId =
          project.snapshots?.[0]?.id ||
          project.latestSnapshotId ||
          localStorage.getItem(`latestSnapshot_${project.id}`);
        const latest =
          jobs
            .filter(
              (job) =>
                job.type === "RUN_TESTS" &&
                (!targetSnapshotId || job.snapshotId === targetSnapshotId),
            )
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ||
          null;
        if (!cancelled) setLatestRunJob(latest);
      } catch { }
    };
    refreshRunJob();
    const timer = window.setInterval(refreshRunJob, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [project]);

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
        const { getProjectsApi } = await import("../../services/project.service");
        const { projects: loadedProjects } = await getProjectsApi();
        if (loadedProjects && loadedProjects.length > 0) {
          setProjects(loadedProjects);
          const targetProj = activeProjId
            ? loadedProjects.find((p) => p.id === activeProjId) ||
            loadedProjects[0]
            : loadedProjects[0];
          setProject(targetProj);
          let lastError = null;
          for (let attempt = 1; attempt <= retries; attempt++) {
            try {
              const { data: tree } = await getProjectTreeApi(targetProj.id);
              setFileTree(tree || []);
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
    [showToast],
  );

  const handleAiPanelResize = useCallback(
    (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = aiPanelWidth;
      const onMouseMove = (moveEvent) => {
        const deltaX = startX - moveEvent.clientX;
        const newWidth = Math.max(260, Math.min(800, startWidth + deltaX));
        setAiPanelWidth(newWidth);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [aiPanelWidth],
  );

  useEffect(() => {
    loadData(initialProjectId);
  }, [loadData, initialProjectId]);

  const handleChangeProject = (projectId) => {
    if (project?.id === projectId) return;
    setFileTree([]);
    setTabs([]);
    setActiveFileId(null);
    setActiveTabId(null);
    loadData(projectId);
  };

  const handleDeleteProject = async (projectId) => {
    try {
      const { deleteProjectApi } = await import("../../services/project.service");
      await deleteProjectApi(projectId);
      showToast({ type: "success", title: "Project deleted" });
      if (project?.id === projectId) {
        setFileTree([]);
        setTabs([]);
        setActiveFileId(null);
        setActiveTabId(null);
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
      setTabs((prev) => [...prev, { id: node.id, name: node.name, unsaved: false }]);
    }
    setActiveTabId(node.id);
  };

  const handleOpenFileByPath = (filePath) => {
    setActiveActivity("explorer");
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const findNode = (nodes, path) => {
      for (const node of nodes) {
        if (node.id === path || path.endsWith("/" + node.id) || node.id.endsWith("/" + path)) return node;
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
      handleOpenFile({ id: normalizedPath, name: normalizedPath.split("/").pop(), type: "file" });
    }
  };

  const handleCloseTab = (tabId) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (activeTabId === tabId && next.length > 0) {
      setActiveTabId(next[Math.max(0, idx - 1)].id);
    }
  };

  const refreshProjectFiles = async () => {
    await loadData(project?.id, 1, 0);
  };

  const handleCreateFile = async (filePath) => {
    if (!project) return;
    try {
      await createProjectFileApi(project.id, filePath);
      await refreshProjectFiles();
      handleOpenFile({ id: filePath.replace(/\\/g, "/"), name: filePath.split(/[\\/]/).pop(), type: "file" });
    } catch (err) {
      showToast({ type: "error", title: "Could not create file" });
    }
  };

  const handleCreateFolder = async (folderPath) => {
    if (!project) return;
    try {
      await createProjectFolderApi(project.id, folderPath);
      await refreshProjectFiles();
    } catch (err) {
      showToast({ type: "error", title: "Could not create folder" });
    }
  };

  const handleRenameEntry = async (filePath, newPath) => {
    if (!project) return;
    try {
      await renameProjectEntryApi(project.id, filePath, newPath);
      setTabs((prev) => prev.map((tab) => (tab.id === filePath ? { ...tab, id: newPath, name: newPath.split("/").pop() } : tab)));
      if (activeTabId === filePath) setActiveTabId(newPath);
      if (activeFileId === filePath) setActiveFileId(newPath);
      await refreshProjectFiles();
    } catch (err) {
      showToast({ type: "error", title: "Could not rename" });
    }
  };

  const handleDeleteEntry = async (node) => {
    if (!project) return;
    try {
      await deleteProjectEntryApi(project.id, node.id);
      setTabs((prev) => prev.filter((tab) => tab.id !== node.id && !tab.id.startsWith(`${node.id}/`)));
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
    setShowTestModeSelector(true);
  };

  const handleSelectTestMode = async (mode) => {
    setShowTestModeSelector(false);
    try {
      await generateSkeletonApi(project.id, null, mode);
      showToast({ type: "info", title: "Generation Started", message: `AI Test generation (${mode}) has been queued.` });
    } catch (err) {
      showToast({ type: "error", title: "Generation Error" });
    } finally {
      setIsSubmittingAnalysis(false);
    }
  };

  const runButtonLocked = isSubmittingAnalysis || ["QUEUED", "RUNNING", "SUCCESS"].includes(latestRunJob?.status);
  const runButtonLabel = latestRunJob?.status === "SUCCESS" ? "Tests Completed" : latestRunJob?.status === "RUNNING" ? "Running..." : latestRunJob?.status === "QUEUED" ? "Queued..." : "Run Tests";

  return (
    <div className="ide-root" style={{ background: "var(--ide-bg)", color: "var(--text-primary)" }}>
      <div className="flex items-center justify-between flex-shrink-0" style={{ height: 42, paddingLeft: isMobile ? 8 : 16, paddingRight: isMobile ? 8 : 16, background: "#0d1117", borderBottom: "1px solid var(--ide-border)", zIndex: 20, position: "relative" }}>
        <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
          {!isMobile && (
            <div className="flex items-center gap-2">
              {[{ color: "#ff5f57" }, { color: "#febc2e" }, { color: "#28c840" }].map((dot, i) => (
                <motion.div key={i} whileHover={{ scale: 1.15 }} style={{ width: 12, height: 12, borderRadius: "50%", background: dot.color, cursor: "pointer" }} />
              ))}
            </div>
          )}
          {isMobile ? (
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setMobileNavOpen((o) => !o)} style={{ color: "#8b949e", background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            </motion.button>
          ) : (
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
          )}
          <div className="flex items-center gap-2" style={{ fontSize: 12, minWidth: 0 }}>
            <span style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13, fontFamily: "var(--font-sans)", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>TestCovAI</span>
            {!isMobile && (
              <>
                <span style={{ color: "#30363d" }}>—</span>
                <span style={{ color: "#484f58", fontFamily: "var(--font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: isTablet ? 120 : 240 }}>{project ? project.name : "Main IDE"}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ position: "relative" }}>
          <TestModeSelector isOpen={showTestModeSelector} onClose={() => setShowTestModeSelector(false)} onSelect={handleSelectTestMode} />
          {!isCompact && (
            <div className="flex items-center gap-2 rounded-md" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#484f58", fontSize: 12, fontFamily: "var(--font-sans)", width: 160, padding: "5px 12px" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <span>Search files…</span>
            </div>
          )}
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={handleRunTests} disabled={runButtonLocked} className="flex items-center gap-1.5 rounded-lg text-xs font-medium" style={{ background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)", color: "#fff", border: "none", cursor: runButtonLocked ? "not-allowed" : "pointer", opacity: runButtonLocked ? 0.62 : 1, fontFamily: "var(--font-sans)", boxShadow: "0 0 12px rgba(124,58,237,0.3)", padding: isMobile ? "6px 8px" : "6px 14px", whiteSpace: "nowrap" }}>
            <Play size={11} strokeWidth={3} />
            {!isMobile && runButtonLabel}
          </motion.button>
          {!isMobile && (
            <>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => setShowCFG(true)} className="flex items-center gap-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(34, 211, 238, 0.1)", color: "#22d3ee", border: "1px solid rgba(34, 211, 238, 0.2)", cursor: "pointer", fontFamily: "var(--font-sans)", padding: "6px 14px", whiteSpace: "nowrap" }}>
                <GitBranch size={11} />
                {!isTablet && "Logic Analysis"}
              </motion.button>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => setShowQualityDashboard(true)} className="flex items-center gap-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(168, 85, 247, 0.12)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.25)", cursor: "pointer", fontFamily: "var(--font-sans)", padding: "6px 14px", whiteSpace: "nowrap" }}>
                <Award size={12} />
                {!isTablet && "Quality Dashboard"}
              </motion.button>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => navigate("/projects")} className="flex items-center gap-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(255,255,255,0.04)", color: "#8b949e", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", fontFamily: "var(--font-sans)", padding: "6px 14px", whiteSpace: "nowrap" }}>
                <FolderPlus size={11} />
                {!isTablet && "Projects"}
              </motion.button>
            </>
          )}
          <div className="flex items-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "2px 4px", gap: 2 }}>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSidebarOpen((o) => !o)} style={{ color: sidebarOpen ? "#6e7681" : "#484f58", background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, display: "flex", alignItems: "center" }}>
              {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            </motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setAiPanelOpen((o) => !o)} style={{ color: aiPanelOpen ? "#6e7681" : "#484f58", background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, display: "flex", alignItems: "center" }}>
              {aiPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </motion.button>
            <NotificationCenter userId={user?.id} size={14} theme="dark" />
          </div>
        </div>
      </div>
      <motion.div className="flex flex-1 overflow-hidden" variants={containerVariants} initial="hidden" animate="visible" style={{ gap: 1, position: "relative" }}>
        {!isMobile && (
          <motion.div variants={panelVariants}>
            <ActivityBar active={activeActivity} onSelect={handleSelectActivity} />
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div key="sidebar" initial={isMobile ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }} animate={isMobile ? { x: 0, opacity: 1 } : { width: 260, opacity: 1 }} exit={isMobile ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }} style={isMobile ? { position: "fixed", top: 42, bottom: 26, left: 0, width: 280, maxWidth: "85vw", overflow: "hidden", zIndex: 35, boxShadow: "4px 0 24px rgba(0,0,0,0.4)" } : { overflow: "hidden", flexShrink: 0 }}>
              {activeActivity === "settings" ? (
                <SettingsSidebar activeSetting={activeSetting} onSelectSetting={(s) => { setActiveSetting(s); if (isMobile) setSidebarOpen(false); }} />
              ) : (
                <Sidebar onOpenFile={(node) => { handleOpenFile(node); if (isMobile && node.type !== "folder") setSidebarOpen(false); }} activeFileId={activeFileId} fileTree={fileTree} project={project} projects={projects} onChangeProject={handleChangeProject} onDeleteProject={handleDeleteProject} isLoading={isLoadingTree} onRefresh={() => loadData(project?.id, 3, 2000)} onCreateFile={handleCreateFile} onCreateFolder={handleCreateFolder} onRenameEntry={handleRenameEntry} onDeleteEntry={handleDeleteEntry} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div className="flex flex-1 min-w-0 min-h-0" variants={panelVariants}>
          {activeActivity === "settings" ? (
            <div className="w-full h-full overflow-y-auto">
              {isMobile && <SettingsSidebar activeSetting={activeSetting} onSelectSetting={setActiveSetting} variant="tabs" />}
              {activeSetting === "profile" && <UserProfile />}
              {activeSetting === "appearance" && <Appearance />}
              {activeSetting === "notifications" && <NotificationsSettings />}
            </div>
          ) : activeActivity === "jobs" ? (
            <JobQueue projectId={project?.id} />
          ) : activeActivity === "architecture" ? (
            <ProjectArchitecturePanel projectId={project?.id} />
          ) : activeActivity === "coverage" ? (
            <div className="w-full h-full overflow-y-auto">
              <CoverageDashboard snapshotId={project?.latestSnapshotId || (project?.id ? localStorage.getItem(`latestSnapshot_${project.id}`) : null) || testPromptSnapshotId} projectId={project?.id} onOpenFile={handleOpenFileByPath} />
            </div>
          ) : (
            <Editor tabs={tabs} activeTabId={activeTabId} onSelectTab={setActiveTabId} onCloseTab={handleCloseTab} fileTree={fileTree} isLoadingTree={isLoadingTree} projectId={project?.id} />
          )}
        </motion.div>
        <AnimatePresence initial={false}>
          {aiPanelOpen && (
            <>
              {!isMobile && <div onMouseDown={handleAiPanelResize} style={{ width: 4, cursor: "col-resize", background: "transparent", zIndex: 10, marginLeft: -2, marginRight: -2 }} className="hover:bg-purple-500/20 transition-colors" />}
              <motion.div key="ai-panel" initial={isMobile ? { x: 320, opacity: 0 } : { width: 0, opacity: 0 }} animate={isMobile ? { x: 0, opacity: 1 } : { width: aiPanelWidth, opacity: 1 }} exit={isMobile ? { x: 320, opacity: 0 } : { width: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }} style={isMobile ? { position: "fixed", top: 42, bottom: 26, right: 0, width: "100%", maxWidth: 360, overflow: "hidden", zIndex: 35, boxShadow: "-4px 0 24px rgba(0,0,0,0.4)" } : { overflow: "hidden", flexShrink: 0 }}>
                <AIPanel projectId={project?.id} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>
      <div className="flex items-center justify-between flex-shrink-0" style={{ minHeight: 26, paddingLeft: isMobile ? 8 : 16, paddingRight: isMobile ? 8 : 16, background: "#7c3aed", fontSize: 11, color: "rgba(255,255,255,0.85)", fontFamily: "var(--font-sans)", flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap" }}>
        <div className="flex items-center gap-4" style={{ flexWrap: "nowrap", flexShrink: 0 }}>
          <div className="flex items-center gap-1.5"><GitBranch size={11} />{!isMobile && <span>main</span>}</div>
          {!isMobile && (
            <>
              <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.2)" }} />
              <div className="flex items-center gap-1.5"><CheckCircle2 size={11} style={{ color: "#86efac" }} /><span>0 errors</span></div>
              <div className="flex items-center gap-1.5"><Zap size={11} style={{ color: "#fde68a" }} /><span>TypeScript</span></div>
            </>
          )}
        </div>
        <div className="flex items-center gap-4" style={{ flexWrap: "nowrap", flexShrink: 0 }}>
          <div className="flex items-center gap-1.5"><BarChart3 size={11} /><span>{isMobile ? "84%" : "Coverage: 84%"}</span></div>
          {!isMobile && (
            <>
              <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.2)" }} />
              <span>Ln 29, Col 1</span>
              <span>UTF-8</span>
            </>
          )}
        </div>
      </div>
      <AnimatePresence>
        {showImport && <ImportLayout onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); setActiveActivity("jobs"); setTimeout(() => loadData(null, 3, 2500), 1500); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {showCFG && <CFGCalculator project={project} onClose={() => setShowCFG(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showQualityDashboard && <QualityDashboard projectId={project?.id} onClose={() => setShowQualityDashboard(false)} />}
      </AnimatePresence>
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