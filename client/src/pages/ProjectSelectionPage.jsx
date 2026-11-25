import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { queryClient } from "../lib/queryClient";
import { useToast } from "../components/dashboard/ToastContext";
import {
  Plus,
  LogOut,
  AlertTriangle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import CovaiLogo from "../components/common/CovaiLogo";
import { deleteProjectApi, invalidateFileContentCache } from "../services/project.service";
import {
  removeProjectFromPortfolioCache,
  removeProjectFromProjectsList,
} from "../services/portfolioDashboard/portfolioLifecycleCache";
import ImportLayout from "../components/dashboard/import/ImportLayout";
import { useAuth } from "../hooks/useAuth";
import ThemeSelector from "../components/common/ThemeSelector";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { NotificationCenter } from "../components/NotificationCenter";
import { useBreakpoints } from "../hooks/useMediaQuery";
import PanelResizer from "../components/dashboard/PanelResizer";
import AIPanel from "../components/dashboard/AIPanel";
import ProjectsPortfolioDashboard from "../components/dashboard/portfolio/ProjectsPortfolioDashboard";
import { motion, AnimatePresence } from "framer-motion";
import "../components/dashboard/portfolio/portfolio.css";

const DEFAULT_AI_PANEL_WIDTH = 340;

export default function ProjectSelectionPage() {
  const { user, logout } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { isMobile } = useBreakpoints();

  const [showImport, setShowImport] = useState(() =>
    Boolean(location.state?.openImport),
  );

  useEffect(() => {
    if (location.state?.openImport || location.state?.githubConnected) {
      if (location.state?.githubConnected) {
        showToast({
          type: "success",
          title: "GitHub Connected",
          message: "Your GitHub account is now linked for repository imports.",
        });
      }
      navigate(location.pathname + location.search, {
        replace: true,
        state: {},
      });
    }
  }, [location.state, location.pathname, location.search, navigate, showToast]);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // AI Assistant Sidebar state (collapsed by default across pages)
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(DEFAULT_AI_PANEL_WIDTH);
  const [isDraggingAiPanel, setIsDraggingAiPanel] = useState(false);
  const [pendingAiSuggestion, setPendingAiSuggestion] = useState(null);
  const [portfolioProjects, setPortfolioProjects] = useState([]);
  const [aiTargetProjectId, setAiTargetProjectId] = useState(null);

  const activeAiProject = useMemo(() => {
    if (!portfolioProjects.length) return null;
    if (aiTargetProjectId) {
      const matched = portfolioProjects.find((p) => p.id === aiTargetProjectId);
      if (matched) return matched;
    }
    return (
      portfolioProjects.find((p) => p.lifecycleStatus === "DOING") ||
      portfolioProjects[0] ||
      null
    );
  }, [portfolioProjects, aiTargetProjectId]);

  // Favorites (Pinned projects)
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("covai_favorites") || "[]");
    } catch {
      return [];
    }
  });

  const toggleFavorite = useCallback((projectId) => {
    setFavorites((prev) => {
      const next = prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId];
      localStorage.setItem("covai_favorites", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/", { replace: true });
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete || isDeleting) return;
    const targetProject = projectToDelete;
    try {
      setIsDeleting(true);
      await deleteProjectApi(targetProject.id);
      invalidateFileContentCache(targetProject.id);
      queryClient.setQueryData(["projectsPortfolio", "live"], (old) =>
        removeProjectFromPortfolioCache(old, targetProject.id),
      );
      queryClient.setQueriesData({ queryKey: ["projects"] }, (old) =>
        removeProjectFromProjectsList(old, targetProject.id),
      );
      queryClient.invalidateQueries({ queryKey: ["projects", userId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
      setProjectToDelete(null);
      showToast({
        type: "success",
        title: "Project deleted",
        message: `"${targetProject.name}" has been permanently removed.`,
      });
    } catch (err) {
      console.error("Failed to delete project", err);
      showToast({
        type: "error",
        title: "Delete failed",
        message: err.message || "Could not delete the project. Please retry.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAskAiPrompt = useCallback((promptText, context = {}) => {
    if (!promptText) return;
    if (context?.projectId) {
      setAiTargetProjectId(context.projectId);
    }
    setAiPanelOpen(true);
    setPendingAiSuggestion({ promptText, timestamp: Date.now() });
  }, []);

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

  const userInitials = useMemo(() => {
    if (!user?.name && !user?.email) return "CO";
    const name = user.name || user.email;
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user]);

  const screenContext = useMemo(
    () => ({ activity: "projects-portfolio", testType: "portfolio" }),
    [],
  );

  return (
    <div className="portfolio-studio h-screen w-screen flex flex-col overflow-hidden bg-[var(--ps-bg)] text-[var(--ps-ink)] font-sans transition-colors duration-150">
      {/* ── Global Top Navigation Bar (with single +Project button) ────── */}
      <header className="h-12 border-b border-[var(--ps-line)] bg-[var(--ps-surface)] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40 select-none shrink-0">
        <div className="flex items-center gap-2.5">
          <CovaiLogo size={24} />
          <div className="flex items-center gap-1.5 ps-mono">
            <span className="font-bold text-xs tracking-tight text-[var(--ps-ink)]">
              CovAI
            </span>
            <span className="text-[11px] text-[var(--ps-ink-muted)]">/</span>
            <span className="text-xs font-medium text-[var(--ps-ink-secondary)]">
              Portfolio
            </span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          {/* THE ONLY + Project Button on the page per UX rules */}
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="ps-btn-contrast h-8 px-3 text-xs inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus size={13} strokeWidth={2.5} />
            <span>Project</span>
          </button>

          <div className="h-4 w-px bg-[var(--color-border)] mx-0.5 hidden sm:block" />

          <ThemeSelector compact />

          <NotificationCenter userId={user?.id} size={14} />

          {/* Toggle COV AI Assistant Sidebar */}
          <button
            type="button"
            onClick={() => setAiPanelOpen((prev) => !prev)}
            className={`p-1.5 rounded-[var(--radius-md)] border transition-colors cursor-pointer ${
              aiPanelOpen
                ? "bg-[var(--ps-surface-2)] text-[var(--ps-ink)] border-[var(--ps-line-strong)]"
                : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] bg-[var(--ps-surface-2)]/60 border-[var(--ps-line)]"
            }`}
            title={
              aiPanelOpen ? "Collapse AI Assistant" : "Expand AI Assistant"
            }
            aria-label="Toggle AI Assistant"
          >
            {aiPanelOpen ? (
              <PanelRightClose size={14} />
            ) : (
              <PanelRightOpen size={14} />
            )}
          </button>

          <div className="h-4 w-px bg-[var(--color-border)] mx-0.5" />

          {/* User profile & logout */}
          <div className="flex items-center gap-1.5">
            <div
              className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] font-bold text-[11px] flex items-center justify-center select-none"
              title={user?.email || "User Profile"}
            >
              {userInitials}
            </div>
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content Area + Right AI Sidebar Split ─────────────────── */}
      <div className="flex flex-1 overflow-hidden relative min-h-0">
        {/* Main 5-Zone Projects Portfolio Dashboard */}
        <main className="flex-1 overflow-y-auto custom-scrollbar min-w-0">
          {location.state?.projectAccessLost && (
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-4">
              <div
                role="alert"
                className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4 text-sm text-[var(--color-text)]"
              >
                Your access to this project has been removed. Your unsaved
                editor drafts are kept in this browser.
              </div>
            </div>
          )}
          <ProjectsPortfolioDashboard
            favorites={favorites}
            onTogglePin={toggleFavorite}
            onOpenProjectOverview={(projectId, project) => {
              const snapId = project?.snapshotId || project?.activeSnapshotId;
              const snapQuery = snapId ? `&snapshotId=${snapId}` : "";
              navigate(
                `/main-editor?projectId=${projectId}${snapQuery}&tab=overview`,
              );
            }}
            onNavigateWorkspace={(projectId, pillar, focus = {}) => {
              const params = new URLSearchParams();
              params.set("projectId", projectId);
              params.set("tab", "coverage");
              params.set("coverageType", pillar);
              if (focus?.focusFile) params.set("focusFile", focus.focusFile);
              if (focus?.focusEndpoint)
                params.set("focusEndpoint", focus.focusEndpoint);
              if (focus?.focusScenario)
                params.set("focusScenario", focus.focusScenario);
              navigate(`/main-editor?${params.toString()}`);
            }}
            onDeleteProject={(proj) => setProjectToDelete(proj)}
            onAddProject={() => setShowImport(true)}
            onAskAi={handleAskAiPrompt}
            onProjectsLoaded={setPortfolioProjects}
          />
        </main>

        {/* Collapsible Right-Hand COV AI Assistant Sidebar */}
        <AnimatePresence initial={false}>
          {aiPanelOpen && (
            <>
              {!isMobile && (
                <PanelResizer
                  onMouseDown={handleAiPanelResize}
                  isDragging={isDraggingAiPanel}
                  onDoubleClick={() => setAiPanelWidth(DEFAULT_AI_PANEL_WIDTH)}
                  currentWidth={aiPanelWidth}
                  defaultWidth={DEFAULT_AI_PANEL_WIDTH}
                  side="right"
                  label="COV Assistant"
                />
              )}
              <motion.div
                key="portfolio-ai-panel"
                className="flex flex-col h-full"
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
                        top: 48,
                        bottom: 0,
                        right: 0,
                        width: "100%",
                        maxWidth: 360,
                        overflow: "hidden",
                        zIndex: 45,
                        boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
                      }
                    : { overflow: "hidden", flexShrink: 0 }
                }
              >
                {portfolioProjects.length > 0 && (
                  <div className="px-3 py-2 border-l border-b border-[var(--ps-line)] bg-[var(--ps-surface)] flex items-center justify-between gap-2 shrink-0">
                    <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)] shrink-0">
                      AI Context
                    </span>
                    <select
                      aria-label="Select project for AI Assistant"
                      value={activeAiProject?.id || ""}
                      onChange={(e) => setAiTargetProjectId(e.target.value)}
                      className="ps-select flex-1 min-w-0 h-7 text-[11px]"
                    >
                      {portfolioProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AIPanel
                    key={activeAiProject?.id || "no-project"}
                    screenContext={screenContext}
                    projectId={activeAiProject?.id || null}
                    snapshotId={
                      activeAiProject?.snapshotId ||
                      activeAiProject?.activeSnapshotId ||
                      null
                    }
                    fileTree={[]}
                    pendingAiSuggestion={pendingAiSuggestion}
                    onClearPendingSuggestion={() =>
                      setPendingAiSuggestion(null)
                    }
                    onOpenFile={(filePath) => {
                      const pid = activeAiProject?.id
                        ? `projectId=${encodeURIComponent(activeAiProject.id)}&`
                        : "";
                      navigate(
                        `/main-editor?${pid}focusFile=${encodeURIComponent(filePath)}`,
                      );
                    }}
                    onRunAnalysis={() => {}}
                  />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* ── Dialogs: Logout & Delete & Import ───────────────────────────── */}
      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        title="Sign Out"
        message="Are you sure you want to sign out? You will be redirected to the home landing page."
        confirmText="Sign Out"
        cancelText="Cancel"
        variant="danger"
        icon={LogOut}
      />

      <ConfirmDialog
        isOpen={Boolean(projectToDelete)}
        onClose={() => !isDeleting && setProjectToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Project Workspace"
        message="This action is permanent and cannot be undone. All synthesized tests and coverage snapshots will be permanently removed."
        confirmText="Delete Permanently"
        cancelText="Cancel"
        variant="danger"
        icon={AlertTriangle}
        loading={isDeleting}
      >
        {projectToDelete && (
          <div className="px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-rose-300/90 break-all">
            {projectToDelete.name}
          </div>
        )}
      </ConfirmDialog>

      {showImport && (
        <ImportLayout
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
            queryClient.invalidateQueries({ queryKey: ["projects", userId] });
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
          }}
        />
      )}
    </div>
  );
}
