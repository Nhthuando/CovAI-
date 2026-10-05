import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { queryClient } from "../lib/queryClient";
import {
  FolderGit2,
  Plus,
  Trash2,
  Search,
  Grid,
  List,
  ArrowRight,
  GitBranch,
  Clock,
  AlertTriangle,
  Loader2,
  Star,
  LogOut,
  SlidersHorizontal,
  X,
  Terminal,
} from "lucide-react";
import { getProjectsApi, deleteProjectApi } from "../services/project.service";
import ImportLayout from "../components/dashboard/import/ImportLayout";
import { useAuth } from "../hooks/useAuth";
import Button from "../components/common/Button";
import Badge from "../components/common/Badge";
import Card from "../components/common/Card";
import ThemeSelector from "../components/common/ThemeSelector";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { ProjectGridSkeleton } from "../components/common/Skeleton";

export default function ProjectSelectionPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("recent"); // "recent" | "name" | "oldest"
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("covai_favorites") || "[]");
    } catch {
      return [];
    }
  });

  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/", { replace: true });
  };

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await queryClient.fetchQuery({
        queryKey: ["projects"],
        queryFn: async () => {
          const res = await getProjectsApi();
          return res?.projects || [];
        },
        staleTime: 5 * 60 * 1000,
      });
      setProjects(data || []);
    } catch (err) {
      console.error("Failed to load projects", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    getProjectsApi()
      .then((res) => {
        if (!ignore) setProjects(res?.projects || []);
      })
      .catch((err) => {
        console.error("Failed to load projects", err);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const toggleFavorite = (e, projectId) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId];
      localStorage.setItem("covai_favorites", JSON.stringify(next));
      return next;
    });
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    const targetProject = projectToDelete;
    try {
      setIsDeleting(true);
      await deleteProjectApi(targetProject.id);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjects((prev) => prev.filter((p) => p.id !== targetProject.id));
      setProjectToDelete(null);
    } catch (err) {
      console.error("Failed to delete project", err);
      alert(err.message || "Failed to delete project");
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter & Sort Projects
  const filteredProjects = useMemo(() => {
    let list = [...projects];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name?.toLowerCase().includes(q));
    }

    if (sortBy === "recent") {
      list.sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0) -
          new Date(a.updatedAt || a.createdAt || 0),
      );
    } else if (sortBy === "name") {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sortBy === "oldest") {
      list.sort(
        (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
      );
    }

    return list;
  }, [projects, searchQuery, sortBy]);

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

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] font-sans flex flex-col transition-colors duration-150">
      {/* ── Top Navigation Bar ──────────────────────────────── */}
      <header className="h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xs shrink-0">
            <Terminal className="w-3.5 h-3.5 stroke-[2.5]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-tight text-[var(--color-text)]">
              CovAI
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">/</span>
            <span className="text-xs text-[var(--color-text-secondary)] font-medium">
              Projects
            </span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2">
          <ThemeSelector compact />

          <div className="h-4 w-px bg-[var(--color-border)] mx-1" />

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
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content Area ──────────────────────────────── */}
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 flex flex-col gap-6">
        {/* Page Header: Title & Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                Projects
              </h1>
              <Badge variant="neutral" size="sm">
                {projects.length}
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] mt-1">
              Select a project to inspect code, run CFG branch diagnostics, and
              synthesize unit tests.
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setShowImport(true)}
            icon={Plus}
          >
            New Project
          </Button>
        </div>

        {/* ── Filter & Search Toolbar ────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]">
          {/* Search Box */}
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="w-full h-8 pl-9 pr-8 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort & View Mode */}
          <div className="flex items-center gap-2.5 justify-between sm:justify-end">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text)] outline-none cursor-pointer focus:border-[var(--color-primary)]"
              >
                <option value="recent">Recently Active</option>
                <option value="name">Name (A-Z)</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            {/* Grid / List View Toggle */}
            <div className="flex items-center p-0.5 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-semibold shadow-xs"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
                title="Grid View"
                aria-label="Grid View"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                  viewMode === "list"
                    ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-semibold shadow-xs"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
                title="List View"
                aria-label="List View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Projects Content Section ───────────────────────── */}
        {loading ? (
          <ProjectGridSkeleton count={6} viewMode={viewMode} />
        ) : filteredProjects.length === 0 ? (
          <div className="py-16 border border-dashed border-[var(--color-border)] rounded-[var(--radius-lg)] text-center bg-[var(--color-surface)] flex flex-col items-center justify-center p-8">
            <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] mb-3">
              <FolderGit2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {searchQuery ? "No matching projects" : "No projects yet"}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-sm">
              {searchQuery
                ? `No projects match "${searchQuery}". Clear your search or try another keyword.`
                : "Import a project from GitHub or upload a local archive to start analyzing coverage."}
            </p>
            {searchQuery ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="mt-4"
              >
                Clear Search
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setShowImport(true)}
                icon={Plus}
                className="mt-4"
              >
                Import First Project
              </Button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          /* ── Grid View ─────────────────────────────────── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => {
              const isFav = favorites.includes(project.id);
              const initials = (project.name || "PR").slice(0, 2).toUpperCase();

              return (
                <Card
                  key={project.id}
                  interactive
                  onClick={() =>
                    navigate(`/main-editor?projectId=${project.id}`)
                  }
                  className="p-4 flex flex-col justify-between group bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-primary)] transition-all"
                >
                  <div>
                    {/* Top Row: Icon + Badges + Favorite/Delete */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] font-bold text-xs shrink-0 font-mono">
                          {initials}
                        </div>
                        <Badge
                          variant={project.repoUrl ? "info" : "neutral"}
                          size="sm"
                        >
                          {project.repoUrl ? "GitHub" : "Local"}
                        </Badge>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => toggleFavorite(e, project.id)}
                          className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                            isFav
                              ? "text-amber-500 bg-amber-500/10"
                              : "text-[var(--color-text-muted)] hover:text-amber-500 hover:bg-[var(--color-surface-secondary)]"
                          }`}
                          title={isFav ? "Remove favorite" : "Add to favorites"}
                          aria-label={
                            isFav ? "Remove favorite" : "Add to favorites"
                          }
                        >
                          <Star
                            className="w-3.5 h-3.5"
                            fill={isFav ? "currentColor" : "none"}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToDelete(project);
                          }}
                          className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
                          title="Delete Project"
                          aria-label="Delete Project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Project Title */}
                    <h3
                      className="text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors truncate mb-1"
                      title={project.name}
                    >
                      {project.name}
                    </h3>

                    {/* Branch & Source */}
                    <div className="flex items-center gap-2 mt-2 text-xs text-[var(--color-text-muted)] font-mono">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[10px]">
                        <GitBranch className="w-3 h-3 text-[var(--color-primary)]" />
                        main
                      </span>
                    </div>
                  </div>

                  {/* Card Footer: Timestamp & Launch Link */}
                  <div className="pt-3 mt-4 border-t border-[var(--color-border)] flex items-center justify-between text-xs">
                    <span className="text-[var(--color-text-muted)] flex items-center gap-1 font-mono text-[11px]">
                      <Clock className="w-3 h-3" />
                      {project.updatedAt
                        ? new Date(project.updatedAt).toLocaleDateString()
                        : "Recent"}
                    </span>
                    <span className="text-[var(--color-primary)] font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform text-xs">
                      Open <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          /* ── List View ─────────────────────────────────── */
          <div className="flex flex-col gap-2">
            {filteredProjects.map((project) => {
              const isFav = favorites.includes(project.id);
              const initials = (project.name || "PR").slice(0, 2).toUpperCase();

              return (
                <div
                  key={project.id}
                  onClick={() =>
                    navigate(`/main-editor?projectId=${project.id}`)
                  }
                  className="group flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] font-bold text-xs shrink-0 font-mono">
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors truncate">
                          {project.name}
                        </h3>
                        {isFav && (
                          <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                        )}
                        <Badge
                          variant={project.repoUrl ? "info" : "neutral"}
                          size="sm"
                        >
                          {project.repoUrl ? "GitHub" : "Local"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mt-0.5">
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <GitBranch className="w-3 h-3 text-[var(--color-primary)]" />
                          main
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[var(--color-text-muted)] text-xs font-mono hidden sm:inline-block">
                      {project.updatedAt
                        ? new Date(project.updatedAt).toLocaleDateString()
                        : "Recent"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(project);
                      }}
                      className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-semibold text-[var(--color-primary)] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                      Open <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Logout Confirmation Dialog (Rule 24) ───────────── */}
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

      {/* ── Project Delete Confirmation Dialog (Rule 24) ─────── */}
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

      {/* ── Import Modal ────────────────────────────────────── */}
      {showImport && (
        <ImportLayout
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
            fetchProjects();
          }}
        />
      )}
    </div>
  );
}
