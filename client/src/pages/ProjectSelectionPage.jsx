import { useState, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { queryClient } from "../lib/queryClient";
import {
  Terminal,
  Plus,
  LogOut,
  AlertTriangle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { deleteProjectApi } from "../services/project.service";
import ImportLayout from "../components/dashboard/import/ImportLayout";
import { useAuth } from "../hooks/useAuth";
import Button from "../components/common/Button";
import ThemeSelector from "../components/common/ThemeSelector";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { NotificationCenter } from "../components/NotificationCenter";
import { useBreakpoints } from "../hooks/useMediaQuery";
import PanelResizer from "../components/dashboard/PanelResizer";
import AIPanel from "../components/dashboard/AIPanel";
import ProjectsPortfolioDashboard from "../components/dashboard/portfolio/ProjectsPortfolioDashboard";
import { motion, AnimatePresence } from "framer-motion";

const DEFAULT_AI_PANEL_WIDTH = 340;

export default function ProjectSelectionPage() {
  const { user, logout } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useBreakpoints();

  // URL query parameter for demo vs live data mode
  const [dataMode, setDataMode] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("mode") === "demo" ? "demo" : "live";
  });

  const [showImport, setShowImport] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // AI Assistant Sidebar state
  const [aiPanelOpen, setAiPanelOpen] = useState(() => !isMobile);
  const [aiPanelWidth, setAiPanelWidth] = useState(DEFAULT_AI_PANEL_WIDTH);
  const [isDraggingAiPanel, setIsDraggingAiPanel] = useState(false);
  const [pendingAiSuggestion, setPendingAiSuggestion] = useState(null);

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

  const handleChangeDataMode = useCallback(
    (nextMode) => {
      const normalized = nextMode === "demo" ? "demo" : "live";
      setDataMode(normalized);
      const params = new URLSearchParams(location.search);
      params.set("mode", normalized);
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    },
    [location, navigate]
  );

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/", { replace: true });
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    const targetProject = projectToDelete;
    try {
      setIsDeleting(true);
      await deleteProjectApi(targetProject.id);
      queryClient.invalidateQueries({ queryKey: ["projects", userId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
      setProjectToDelete(null);
    } catch (err) {
      console.error("Failed to delete project", err);
      alert(err.message || "Failed to delete project");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAskAiPrompt = useCallback((promptText) => {
    if (!promptText) return;
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
    [aiPanelWidth]
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
    []
  );

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)] font-sans transition-colors duration-150">
      {/* ── Global Top Navigation Bar (with single +Project button) ────── */}
      <header className="h-11 sm:h-12 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 sm:px-4 flex items-center justify-between sticky top-0 z-40 select-none shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xs shrink-0">
            <Terminal size={13} strokeWidth={2.5} />
          </div>
          <div className="flex items-center gap-1.5 font-mono">
            <span className="font-bold text-xs tracking-tight text-[var(--color-text)]">
              CovAI
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">/</span>
            <span className="text-xs font-semibold text-[var(--color-primary)]">
              Projects
            </span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          {/* THE ONLY + Project Button on the page per UX rules */}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setShowImport(true)}
            icon={Plus}
          >
            Project
          </Button>

          <div className="h-4 w-px bg-[var(--color-border)] mx-0.5 hidden sm:block" />

          <ThemeSelector compact />

          <NotificationCenter userId={user?.id} size={14} />

          {/* Toggle COV AI Assistant Sidebar */}
          <button
            type="button"
            onClick={() => setAiPanelOpen((prev) => !prev)}
            className={`p-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] transition-colors cursor-pointer ${
              aiPanelOpen
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/40"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-surface-secondary)]"
            }`}
            title={aiPanelOpen ? "Collapse AI Assistant" : "Expand AI Assistant"}
            aria-label="Toggle AI Assistant"
          >
            {aiPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
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
                Your access to this project has been removed. Your unsaved editor drafts are kept in this browser.
              </div>
            </div>
          )}
          <ProjectsPortfolioDashboard
            dataMode={dataMode}
            onChangeDataMode={handleChangeDataMode}
            favorites={favorites}
            onTogglePin={toggleFavorite}
            onOpenProjectOverview={(projectId) =>
              navigate(`/main-editor?projectId=${projectId}&tab=overview${dataMode === "demo" ? "&mode=demo" : ""}`)
            }
            onNavigateWorkspace={(projectId, pillar, focus = {}) => {
              const params = new URLSearchParams();
              params.set("projectId", projectId);
              params.set("tab", "coverage");
              params.set("coverageType", pillar);
              if (focus?.focusFile) params.set("focusFile", focus.focusFile);
              if (focus?.focusEndpoint) params.set("focusEndpoint", focus.focusEndpoint);
              if (focus?.focusScenario) params.set("focusScenario", focus.focusScenario);
              navigate(`/main-editor?${params.toString()}`);
            }}
            onDeleteProject={(proj) => setProjectToDelete(proj)}
            onAddProject={() => setShowImport(true)}
            onAskAi={handleAskAiPrompt}
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
                <AIPanel
                  screenContext={screenContext}
                  projectId={null}
                  snapshotId={null}
                  fileTree={[]}
                  pendingAiSuggestion={pendingAiSuggestion}
                  onClearPendingSuggestion={() => setPendingAiSuggestion(null)}
                  onOpenFile={(filePath) =>
                    navigate(`/main-editor?focusFile=${encodeURIComponent(filePath)}`)
                  }
                  onRunAnalysis={() => {}}
                />
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
        onClose={() => setProjectToDelete(null)}
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
          <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-danger)] break-all">
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