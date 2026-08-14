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
import CFGCalculator from "./CFGCalculator";
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
  Bell,
  Play,
  CheckCircle2,
  FolderPlus,
  Menu,
  X,
  MoreHorizontal
} from "lucide-react";

import { useAuth } from "../../hooks/useAuth";
import { NotificationCenter } from "../NotificationCenter";
import NotificationsSettings from "./settings/NotificationsSettings";
import { useBreakpoints } from "../../hooks/useMediaQuery";

import {
  getProjectsApi,
  getProjectTreeApi,
  runAnalysisApi,
  generateSkeletonApi,
  generateFullTestsApi,
  createProjectFileApi,
  createProjectFolderApi,
  renameProjectEntryApi,
  deleteProjectEntryApi,
} from "../../services/project.service";

const INITIAL_TABS = [];

/* ── Container animation ─────────────────────────────────── */
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

/* ── Inner Layout (needs useToast) ───────────────────────── */
function LayoutInner() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
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
  const [showTestPrompt, setShowTestPrompt] = useState(false);
  const [showTestModeSelector, setShowTestModeSelector] = useState(false);
  const [testPromptSnapshotId, setTestPromptSnapshotId] = useState(null);

  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [isLoadingTree, setIsLoadingTree] = useState(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, isTablet]);

  const loadData = useCallback(
    async (activeProjId = null, retries = 3, delay = 2000) => {
      setIsLoadingTree(true);
      try {
        const { projects: loadedProjects } = await getProjectsApi();
        if (loadedProjects && loadedProjects.length > 0) {
          setProjects(loadedProjects);
          const targetProj = activeProjId
            ? loadedProjects.find((p) => p.id === activeProjId) ||
            loadedProjects[0]
            : loadedProjects[0];

          setProject(targetProj);

          // Try loading tree with retries
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
            console.error(
              "Failed to load project tree after retries:",
              lastError,
            );
            setFileTree([]);
            showToast({
              type: "warning",
              title: "Project tree not ready",
              message:
                "Source code is still being extracted. Please wait a moment and click Refresh in the Explorer panel.",
            });
          }
        } else {
          setProjects([]);
          setProject(null);
          setFileTree([]);
        }
      } catch (err) {
        console.error("Failed to load projects:", err);
        showToast({
          type: "error",
          title: "Load failed",
          message: "Could not load project data. Please refresh the page.",
        });
      } finally {
        setIsLoadingTree(false);
      }
    },
    [showToast],
  );

  const handleAiPanelResize = useCallback((e) => {
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
  }, [aiPanelWidth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
      const { deleteProjectApi } =
        await import("../../services/project.service");
      await deleteProjectApi(projectId);
      showToast({
        type: "success",
        title: "Project deleted",
        message: "The project has been removed.",
      });
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
      showToast({
        type: "error",
        title: "Delete failed",
        message: err.message || "Failed to delete project.",
      });
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

  const handleOpenFileByPath = (filePath) => {
    setActiveActivity("explorer");
    // Normalize path to match tree format if needed
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const findNode = (nodes, path) => {
      for (const node of nodes) {
        if (node.id === path || path.endsWith('/' + node.id) || node.id.endsWith('/' + path)) return node;
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
      handleOpenFile({ id: normalizedPath, name: normalizedPath.split('/').pop(), type: "file" });
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
      showToast({ type: "success", title: "File created", message: `${filePath} has been created.` });
    } catch (err) {
      showToast({ type: "error", title: "Could not create file", message: err.message });
    }
  };

  const handleCreateFolder = async (folderPath) => {
    if (!project) return;
    try {
      await createProjectFolderApi(project.id, folderPath);
      await refreshProjectFiles();
      showToast({ type: "success", title: "Folder created", message: `${folderPath} has been created.` });
    } catch (err) {
      showToast({ type: "error", title: "Could not create folder", message: err.message });
    }
  };

  const handleRenameEntry = async (filePath, newPath) => {
    if (!project) return;
    try {
      await renameProjectEntryApi(project.id, filePath, newPath);
      setTabs((prev) => prev.map((tab) => tab.id === filePath ? { ...tab, id: newPath, name: newPath.split("/").pop() } : tab));
      if (activeTabId === filePath) setActiveTabId(newPath);
      if (activeFileId === filePath) setActiveFileId(newPath);
      await refreshProjectFiles();
      showToast({ type: "success", title: "Renamed", message: `${filePath} is now ${newPath}.` });
    } catch (err) {
      showToast({ type: "error", title: "Could not rename", message: err.message });
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
      showToast({ type: "success", title: "Deleted", message: `${node.name} has been deleted.` });
    } catch (err) {
      showToast({ type: "error", title: "Could not delete", message: err.message });
    }
  };

  const handleRunTests = async () => {
    if (!project) {
      showToast({
        type: "warning",
        title: "No Project Selected",
        message: "Please select a project first to run tests.",
      });
      return;
    }
    setShowTestModeSelector(true);
  };

  const handleSelectTestMode = async (mode) => {
    setShowTestModeSelector(false);
    try {
      const res = await runAnalysisApi(project.id, { mode });
      if (res && res.needsTests) {
        setTestPromptSnapshotId(res.snapshotId);
        setShowTestPrompt(true);
      } else {
        if (res?.data?.job?.snapshotId) {
          localStorage.setItem(`latestSnapshot_${project.id}`, res.data.job.snapshotId);
        }
        showToast({
          type: "info",
          title: "Analysis Started",
          message: `Your project analysis (${mode}) has been queued.`,
        });
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Analysis Error",
        message: err.message || "Failed to start project analysis.",
      });
    }
  };

  return (
    <div
      className="ide-root"
      style={{ background: "var(--ide-bg)", color: "var(--text-primary)" }}
    >
      {/* ── Title Bar ──────────────────────────────────────── */}
      {/* ── Title Bar ──────────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 42,
          paddingLeft: isMobile ? 8 : 16,
          paddingRight: isMobile ? 8 : 16,
          background: "#0d1117",
          borderBottom: "1px solid var(--ide-border)",
          zIndex: 20,
          position: "relative",
        }}
      >
        {/* Left: macOS dots + app label */}
        <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
          {!isMobile && (
            <div className="flex items-center gap-2">
              {[
                { color: "#ff5f57" },
                { color: "#febc2e" },
                { color: "#28c840" },
              ].map((dot, i) => (
                <motion.div
                  key={i}
                  whileHover={{ scale: 1.15 }}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: dot.color,
                    cursor: "pointer",
                    boxShadow: `0 0 4px ${dot.color}60`,
                  }}
                />
              ))}
            </div>
          )}

          {isMobile ? (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setMobileNavOpen((o) => !o)}
              style={{
                color: "#8b949e",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            </motion.button>
          ) : (
            <div
              style={{
                width: 1,
                height: 16,
                background: "rgba(255,255,255,0.07)",
                flexShrink: 0,
              }}
            />
          )}

          <div className="flex items-center gap-2" style={{ fontSize: 12, minWidth: 0 }}>
            <span
              style={{
                color: "#a78bfa",
                fontWeight: 700,
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
              }}
            >
              TestCovAI
            </span>
            {!isMobile && (
              <>
                <span style={{ color: "#30363d" }}>—</span>
                <span
                  style={{
                    color: "#484f58",
                    fontFamily: "var(--font-sans)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: isTablet ? 120 : 240,
                  }}
                >
                  {project ? project.name : "Main IDE"}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Center: menu bar items — desktop/tablet only */}
        {!isMobile && (
          <div className="flex items-center gap-0.5">
            {["Explorer", "Coverage", "Settings"].map((item) => (
              <motion.button
                key={item}
                onClick={() => {
                  if (item === "Settings") setActiveActivity("settings");
                  else if (item === "Explorer") setActiveActivity("explorer");
                  else if (item === "Coverage") setActiveActivity("coverage");
                }}
                whileHover={{ color: "#e6edf3" }}
                whileTap={{ scale: 0.97 }}
                className="rounded-md text-xs"
                style={{
                  color:
                    activeActivity === item.toLowerCase() ? "#e6edf3" : "#484f58",
                  fontFamily: "var(--font-sans)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  transition: "color 0.15s ease",
                  padding: "4px 12px",
                }}
              >
                {item}
              </motion.button>
            ))}
          </div>
        )}

        {/* Right: search + actions */}
        <div className="flex items-center gap-2" style={{ position: "relative" }}>
          <TestModeSelector
            isOpen={showTestModeSelector}
            onClose={() => setShowTestModeSelector(false)}
            onSelect={handleSelectTestMode}
          />
          {/* Search bar — hidden on mobile/tablet */}
          {!isCompact && (
            <div
              className="flex items-center gap-2 rounded-md"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "#484f58",
                fontSize: 12,
                fontFamily: "var(--font-sans)",
                width: 160,
                padding: "5px 12px",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <span>Search files…</span>
            </div>
          )}

          {/* Run Tests button — icon-only on mobile */}
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleRunTests}
            className="flex items-center gap-1.5 rounded-lg text-xs font-medium"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              boxShadow: "0 0 12px rgba(124,58,237,0.3)",
              padding: isMobile ? "6px 8px" : "6px 14px",
              whiteSpace: "nowrap",
            }}
            id="run-tests-btn"
            title="Run Tests"
          >
            <Play size={11} strokeWidth={3} />
            {!isMobile && "Run Tests"}
          </motion.button>

          {/* Logic Analysis & New Project — desktop/tablet inline, mobile via "more" menu */}
          {!isMobile && (
            <>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowCFG(true)}
                className="flex items-center gap-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: "rgba(34, 211, 238, 0.1)",
                  color: "#22d3ee",
                  border: "1px solid rgba(34, 211, 238, 0.2)",
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  padding: "6px 14px",
                  whiteSpace: "nowrap",
                }}
              >
                <GitBranch size={11} />
                {!isTablet && "Logic Analysis"}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: showImport ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.04)",
                  color: showImport ? "#a78bfa" : "#8b949e",
                  border: showImport ? "1px solid rgba(124,58,237,0.25)" : "1px solid rgba(255,255,255,0.07)",
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  padding: "6px 14px",
                  whiteSpace: "nowrap",
                  transition: "all 0.2s ease",
                }}
                id="new-project-btn"
              >
                <FolderPlus size={11} />
                {!isTablet && "New Project"}
              </motion.button>
            </>
          )}

          {isMobile && (
            <div style={{ position: "relative" }}>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setMobileMoreOpen((o) => !o)}
                style={{
                  color: "#8b949e",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 6,
                  cursor: "pointer",
                  padding: "6px 8px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <MoreHorizontal size={14} />
              </motion.button>

              <AnimatePresence>
                {mobileMoreOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 6,
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: 8,
                      overflow: "hidden",
                      zIndex: 50,
                      minWidth: 160,
                    }}
                  >
                    <button
                      onClick={() => { setShowCFG(true); setMobileMoreOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "10px 14px", background: "transparent", border: "none",
                        color: "#22d3ee", fontSize: 13, cursor: "pointer",
                      }}
                    >
                      <GitBranch size={13} /> Logic Analysis
                    </button>
                    <button
                      onClick={() => { setShowImport(true); setMobileMoreOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "10px 14px", background: "transparent", border: "none",
                        color: "#8b949e", fontSize: 13, cursor: "pointer",
                        borderTop: "1px solid #21262d",
                      }}
                    >
                      <FolderPlus size={13} /> New Project
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Toggle buttons */}
          <div
            className="flex items-center"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 8,
              padding: "2px 4px",
              gap: 2,
            }}
          >
            <motion.button
              whileTap={{ scale: 0.9 }}
              title={sidebarOpen ? "Hide Explorer" : "Show Explorer"}
              onClick={() => setSidebarOpen((o) => !o)}
              style={{
                color: sidebarOpen ? "#6e7681" : "#484f58",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px 6px",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
              }}
              id="toggle-sidebar-btn"
            >
              {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              title={aiPanelOpen ? "Hide AI Panel" : "Show AI Panel"}
              onClick={() => setAiPanelOpen((o) => !o)}
              style={{
                color: aiPanelOpen ? "#6e7681" : "#484f58",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px 6px",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
              }}
              id="toggle-ai-panel-btn"
            >
              {aiPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </motion.button>
            <NotificationCenter userId={user?.id} size={14} theme="dark" />
          </div>
        </div>

        {/* Mobile nav dropdown (Explorer/Tests/Metrics/Coverage/Settings) */}
        <AnimatePresence>
          {isMobile && mobileNavOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "#0d1117",
                borderBottom: "1px solid #30363d",
                zIndex: 40,
                overflow: "hidden",
              }}
            >
              {["Explorer", "Coverage", "Settings"].map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    if (item === "Settings") setActiveActivity("settings");
                    else if (item === "Explorer") setActiveActivity("explorer");
                    else if (item === "Coverage") setActiveActivity("coverage");
                    setMobileNavOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 16px",
                    background:
                      activeActivity === item.toLowerCase() ? "rgba(124,58,237,0.1)" : "transparent",
                    color: activeActivity === item.toLowerCase() ? "#e6edf3" : "#8b949e",
                    border: "none",
                    borderBottom: "1px solid #161b22",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {item}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Main Row ───────────────────────────────────────── */}
      <motion.div
        className="flex flex-1 overflow-hidden"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{ gap: 1, position: "relative" }}
      >
        {/* Activity Bar — ẩn trên mobile (đã có hamburger thay thế) */}
        {!isMobile && (
          <motion.div variants={panelVariants}>
            <ActivityBar active={activeActivity} onSelect={handleSelectActivity} />
          </motion.div>
        )}

        {/* Backdrop dùng chung cho sidebar/AI panel khi ở mobile */}
        <AnimatePresence>
          {isMobile && (sidebarOpen || aiPanelOpen) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setSidebarOpen(false); setAiPanelOpen(false); }}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                zIndex: 30,
              }}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              key="sidebar"
              initial={isMobile ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }}
              animate={isMobile ? { x: 0, opacity: 1 } : { width: 260, opacity: 1 }}
              exit={isMobile ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }}
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
                    boxShadow: "4px 0 24px rgba(0,0,0,0.4)",
                  }
                  : { overflow: "hidden", flexShrink: 0 }
              }
            >
              {activeActivity === "settings" ? (
                <SettingsSidebar
                  activeSetting={activeSetting}
                  onSelectSetting={(s) => {
                    setActiveSetting(s);
                    if (isMobile) setSidebarOpen(false);
                  }}
                />
              ) : (
                <Sidebar
                  onOpenFile={(node) => {
                    handleOpenFile(node);
                    if (isMobile && node.type !== "folder") setSidebarOpen(false);
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

        {/* Editor / Settings Panel — always rendered */}
        <motion.div className="flex flex-1 min-w-0" variants={panelVariants}>
          {activeActivity === "settings" ? (
            <div className="w-full h-full overflow-y-auto">
              {/* Trên mobile: tab ngang ở đầu thay cho sidebar trái */}
              {isMobile && (
                <SettingsSidebar
                  activeSetting={activeSetting}
                  onSelectSetting={setActiveSetting}
                  variant="tabs"
                />
              )}
              {activeSetting === "profile" && <UserProfile />}
              {activeSetting === "appearance" && <Appearance />}
              {activeSetting === "notifications" && <NotificationsSettings />}
            </div>
          ) : activeActivity === "jobs" ? (
            <JobQueue projectId={project?.id} />

          ) : activeActivity === "coverage" ? (
            <CoverageDashboard snapshotId={project?.latestSnapshotId || (project?.id ? localStorage.getItem(`latestSnapshot_${project.id}`) : null) || testPromptSnapshotId} projectId={project?.id} onOpenFile={handleOpenFileByPath} />
          ) : (
            <Editor
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onCloseTab={handleCloseTab}
              fileTree={fileTree}
              isLoadingTree={isLoadingTree}
              projectId={project?.id}
            />
          )}
        </motion.div>

        {/* AI Panel */}
        <AnimatePresence initial={false}>
          {aiPanelOpen && (
            <>
              {!isMobile && (
                <div
                  onMouseDown={handleAiPanelResize}
                  style={{
                    width: 4,
                    cursor: "col-resize",
                    background: "transparent",
                    zIndex: 10,
                    marginLeft: -2,
                    marginRight: -2,
                  }}
                  className="hover:bg-purple-500/20 transition-colors"
                />
              )}
              <motion.div
                key="ai-panel"
                initial={isMobile ? { x: 320, opacity: 0 } : { width: 0, opacity: 0 }}
                animate={isMobile ? { x: 0, opacity: 1 } : { width: aiPanelWidth, opacity: 1 }}
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
                      overflow: "hidden",
                      zIndex: 35,
                      boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
                    }
                    : { overflow: "hidden", flexShrink: 0 }
                }
              >
                <AIPanel projectId={project?.id} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Status Bar ─────────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          minHeight: 26,
          paddingLeft: isMobile ? 8 : 16,
          paddingRight: isMobile ? 8 : 16,
          background: "#7c3aed",
          fontSize: 11,
          color: "rgba(255,255,255,0.85)",
          fontFamily: "var(--font-sans)",
          flexWrap: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <div className="flex items-center gap-4" style={{ flexWrap: "nowrap", flexShrink: 0 }}>
          <div className="flex items-center gap-1.5">
            <GitBranch size={11} />
            {!isMobile && <span>main</span>}
          </div>
          {!isMobile && (
            <>
              <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.2)" }} />
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={11} style={{ color: "#86efac" }} />
                <span>0 errors</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap size={11} style={{ color: "#fde68a" }} />
                <span>TypeScript</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-4" style={{ flexWrap: "nowrap", flexShrink: 0 }}>
          <div className="flex items-center gap-1.5">
            <BarChart3 size={11} />
            <span>{isMobile ? "84%" : "Coverage: 84%"}</span>
          </div>
          {!isMobile && (
            <>
              <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.2)" }} />
              <span>Ln 29, Col 1</span>
              <span>UTF-8</span>
            </>
          )}
          <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.2)" }} />
          <div className="flex items-center gap-1.5">
            <span
              style={{
                width: 6, height: 6, borderRadius: "50%", background: "#86efac",
                display: "inline-block", boxShadow: "0 0 6px rgba(134,239,172,0.7)",
              }}
            />
            {!isMobile && <span>Gemini AI ✓</span>}
          </div>
        </div>
      </div>

      {/* ── Import Project Fullscreen Overlay ──────────────── */}
      <AnimatePresence>
        {showImport && (
          <ImportLayout
            onClose={() => setShowImport(false)}
            onSuccess={() => {
              setShowImport(false);
              showToast({
                type: "info",
                title: "Job is being processed",
                message: "You can track the progress in the Job Queue.",
              });
              // Switch to Job Queue view so user can track progress
              setActiveActivity("jobs");
              // Still reload data in background
              setTimeout(() => loadData(null, 3, 2500), 1500);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── CFG Calculator Fullscreen Overlay ──────────────── */}
      <AnimatePresence>
        {showCFG && <CFGCalculator project={project} onClose={() => setShowCFG(false)} />}
      </AnimatePresence>

      {/* ── Missing Test Prompt Modal ──────────────────────── */}
      <AnimatePresence>
        {showTestPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[9999]"
            onClick={() => setShowTestPrompt(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-[#0d1117] border border-[#30363d] rounded-2xl shadow-2xl relative overflow-hidden"
              style={{ width: "500px", padding: "32px", maxWidth: "90vw" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Subtle background glow */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#7c3aed] to-transparent opacity-50"></div>

              <div className="flex items-center text-[#f0f6fc]" style={{ gap: "16px", marginBottom: "20px" }}>
                <div className="flex items-center justify-center rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/20" style={{ width: "40px", height: "40px", minWidth: "40px" }}>
                  <Zap className="text-[#a78bfa]" size={20} />
                </div>
                <h2 className="text-2xl font-bold tracking-tight m-0">Missing Test Files</h2>
              </div>

              <p className="text-[#8b949e] text-[15px] leading-relaxed m-0" style={{ marginBottom: "32px" }}>
                Dự án <strong>{project?.name || "này"}</strong> chưa có file test (Jest). Quá trình phân tích Code Coverage cần có test files để chạy thành công. Bạn có muốn AI tự động sinh Test Code cho dự án <strong>{project?.name || "này"}</strong> không?
              </p>

              <div className="flex flex-col" style={{ gap: "14px" }}>
                <button
                  onClick={async () => {
                    setShowTestPrompt(false);
                    try {
                      showToast({ type: "info", title: "Generating", message: "Đã đưa vào hàng chờ AI tạo Skeleton Tests." });
                      await generateSkeletonApi(project.id, testPromptSnapshotId);
                    } catch (err) {
                      showToast({ type: "error", title: "Error", message: err.message });
                    }
                  }}
                  className="w-full rounded-lg font-semibold text-[14px] transition-all duration-200 hover:bg-[#7c3aed]/20 active:scale-[0.98] flex items-center justify-center"
                  style={{ padding: "12px", background: "rgba(124, 58, 237, 0.15)", color: "#c4b5fd", border: "1px solid rgba(124,58,237,0.3)", gap: "8px" }}
                >
                  <Zap size={16} className="text-[#a78bfa]" />
                  Generate Skeleton Tests
                </button>
                <button
                  onClick={async () => {
                    setShowTestPrompt(false);
                    try {
                      showToast({ type: "info", title: "Generating", message: "Đã đưa vào hàng chờ AI tạo Full Tests." });
                      await generateFullTestsApi(project.id, testPromptSnapshotId);
                    } catch (err) {
                      showToast({ type: "error", title: "Error", message: err.message });
                    }
                  }}
                  className="w-full rounded-lg font-semibold text-[14px] transition-all duration-200 hover:bg-[#21262d] active:scale-[0.98] flex items-center justify-center"
                  style={{ padding: "12px", background: "#161b22", color: "#f0f6fc", border: "1px solid #30363d", gap: "8px" }}
                >
                  Generate Full Tests
                </button>
                <button
                  onClick={() => setShowTestPrompt(false)}
                  className="w-full rounded-lg font-medium text-[14px] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22] transition-colors"
                  style={{ padding: "12px", marginTop: "8px" }}
                >
                  Bỏ qua
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Exported Layout with ToastProvider wrapper ────────────── */
export default function Layout() {
  return (
    <ToastProvider>
      <LayoutInner />
    </ToastProvider>
  );
}
