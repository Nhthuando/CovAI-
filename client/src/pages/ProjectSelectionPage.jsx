/* eslint-disable no-unused-vars */
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getProjectsApi, deleteProjectApi } from "../services/project.service";
import ImportLayout from "../components/dashboard/import/ImportLayout";
import { motion, AnimatePresence } from "framer-motion";
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
  Sparkles,
  Layers,
  ShieldCheck,
  Zap,
  ExternalLink,
  UploadCloud,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Star,
  LogOut,
  User,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";

function GithubIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default function ProjectSelectionPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("recent"); // "recent" | "name" | "oldest"
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("covai_favorites") || "[]");
    } catch {
      return [];
    }
  });

  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const { projects } = await getProjectsApi();
      setProjects(projects || []);
    } catch (err) {
      console.error("Failed to load projects", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
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
    try {
      setIsDeleting(true);
      await deleteProjectApi(projectToDelete.id);
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
      setProjectToDelete(null);
    } catch (err) {
      console.error("Failed to delete project", err);
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
    if (!user?.name && !user?.email) return "COV";
    const name = user.name || user.email;
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user]);

  return (
    <div className="min-h-screen bg-[#090d13] text-white font-sans flex flex-col selection:bg-purple-500/30 selection:text-purple-200">
      {/* ── Top Navigation Bar ──────────────────────────────── */}
      <header className="h-16 border-b border-white/10 bg-[#0d1117]/80 backdrop-blur-xl px-6 md:px-12 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 shadow-md shadow-violet-500/20">
            <Sparkles size={16} className="text-white" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-base tracking-tight">
              TestCov<span className="text-violet-400">AI</span>
            </span>
            <div className="h-4 w-px bg-white/10" />
            <span className="text-xs text-neutral-400 font-medium px-2 py-0.5 rounded-md bg-white/5 border border-white/5">
              Project Hub
            </span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-lg shadow-violet-900/30 border border-violet-400/30"
          >
            <Plus size={15} />
            <span>New Project</span>
          </motion.button>

          {/* User Profile / Logout */}
          <div className="h-4 w-px bg-white/10 mx-1 hidden sm:block" />
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-full bg-violet-600/20 border border-violet-500/40 text-violet-300 font-bold text-xs"
              title={user?.email || "User Profile"}
            >
              {userInitials}
            </div>
            <button
              onClick={logout}
              className="p-2 text-neutral-400 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content Area ──────────────────────────────── */}
      <main className="w-full max-w-[1400px] mx-auto px-6 md:px-12 py-8 flex-1 flex flex-col gap-8">
        {/* Hero Banner & KPI Stats */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Workspace Engine Active
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                Your Projects & Workspaces
              </h1>
              <p className="text-neutral-400 text-sm mt-1 max-w-xl">
                Manage, monitor, and launch your AI-powered testing suites with
                automated CFG analysis and coverage insights.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-violet-400 uppercase tracking-wider bg-violet-500/10 px-3 py-1.5 rounded-xl border border-violet-500/20">
                {projects.length}{" "}
                {projects.length === 1
                  ? "Active Workspace"
                  : "Active Workspaces"}
              </span>
            </div>
          </div>

          {/* Quick KPI Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-[#161b22]/70 border border-white/10 backdrop-blur-md">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-medium mb-1.5">
                <span>Total Workspaces</span>
                <FolderGit2 size={15} className="text-violet-400" />
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">
                {projects.length}
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                Ready for AI test generation
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#161b22]/70 border border-white/10 backdrop-blur-md">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-medium mb-1.5">
                <span>Coverage Standard</span>
                <ShieldCheck size={15} className="text-cyan-400" />
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">
                80%+ Target
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                Branch & statement coverage
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#161b22]/70 border border-white/10 backdrop-blur-md">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-medium mb-1.5">
                <span>AI Assistant</span>
                <Sparkles size={15} className="text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>COV 2.0</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ONLINE
                </span>
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                Gemini 1.5 Pro enabled
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#161b22]/70 border border-white/10 backdrop-blur-md">
              <div className="flex items-center justify-between text-neutral-400 text-xs font-medium mb-1.5">
                <span>Supported Frameworks</span>
                <Zap size={15} className="text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">
                Unit & E2E
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                Jest, Vitest, Playwright
              </div>
            </div>
          </div>
        </div>

        {/* ── Filter & Search Toolbar ────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-2 rounded-2xl bg-[#161b22]/40 border border-white/5">
          {/* Search Box */}
          <div className="relative w-full sm:w-80">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-neutral-900/80 border border-white/10 text-xs text-white placeholder-neutral-500 outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Sort & View Mode */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            {/* Sort Select */}
            <div className="flex items-center gap-1.5 text-xs text-neutral-400">
              <SlidersHorizontal size={13} />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-neutral-300 outline-none cursor-pointer focus:border-violet-500/40"
              >
                <option value="recent">Recently Active</option>
                <option value="name">Name (A-Z)</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            {/* Grid / List View Toggle */}
            <div className="flex items-center p-1 rounded-lg bg-neutral-900 border border-white/10">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-violet-600 text-white"
                    : "text-neutral-500 hover:text-white"
                }`}
                title="Grid View"
              >
                <Grid size={14} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === "list"
                    ? "bg-violet-600 text-white"
                    : "text-neutral-500 hover:text-white"
                }`}
                title="List View"
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Project List Section ──────────────────────────── */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-neutral-500 gap-3">
            <Loader2 size={32} className="animate-spin text-violet-500" />
            <span className="text-sm">Loading your workspaces...</span>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="py-20 border border-dashed border-white/10 rounded-2xl text-center bg-neutral-900/20 flex flex-col items-center justify-center p-8">
            <div className="w-14 h-14 rounded-2xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500 mb-3">
              <FolderGit2 size={24} />
            </div>
            <h3 className="text-base font-semibold text-white">
              {searchQuery
                ? "No matching workspaces found"
                : "No projects found"}
            </h3>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm">
              {searchQuery
                ? `No project names match "${searchQuery}". Try a different keyword.`
                : "Import a project from GitHub or upload a ZIP archive to get started."}
            </p>
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery("")}
                className="mt-4 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors"
              >
                Clear search
              </button>
            ) : (
              <button
                onClick={() => setShowImport(true)}
                className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white transition-all shadow-lg shadow-violet-900/30"
              >
                <Plus size={14} />
                Create your first project
              </button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          /* ── Grid View ─────────────────────────────────── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProjects.map((project) => {
              const isFav = favorites.includes(project.id);
              const initials = (project.name || "PR").slice(0, 2).toUpperCase();

              return (
                <motion.div
                  key={project.id}
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="group relative bg-[#161b22]/70 hover:bg-[#1c2128] p-5 rounded-2xl border border-white/10 hover:border-violet-500/40 transition-all duration-300 cursor-pointer flex flex-col justify-between shadow-lg hover:shadow-violet-950/20 backdrop-blur-md"
                  onClick={() =>
                    navigate(`/main-editor?projectId=${project.id}`)
                  }
                >
                  <div>
                    {/* Top Row: Icon & Action Buttons */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600/30 to-cyan-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 font-bold text-sm flex-shrink-0 group-hover:scale-105 transition-transform">
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Active
                          </span>
                        </div>
                      </div>

                      {/* Favorite & Delete Buttons */}
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => toggleFavorite(e, project.id)}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            isFav
                              ? "text-amber-400 bg-amber-400/10"
                              : "text-neutral-500 hover:text-amber-400 hover:bg-white/5"
                          }`}
                          title={isFav ? "Remove favorite" : "Add to favorites"}
                        >
                          <Star
                            size={14}
                            fill={isFav ? "currentColor" : "none"}
                          />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToDelete(project);
                          }}
                          className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Delete Project"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Project Title */}
                    <h3
                      className="text-base font-semibold text-white group-hover:text-violet-300 transition-colors truncate"
                      title={project.name}
                    >
                      {project.name}
                    </h3>

                    {/* Tags / Metadata */}
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400 bg-white/5 px-2 py-0.5 rounded-md font-mono">
                        <GitBranch size={10} className="text-violet-400" />
                        main
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        {project.repoUrl ? "GitHub Repo" : "Local Workspace"}
                      </span>
                    </div>
                  </div>

                  {/* Card Bottom: Timestamp & Launch Button */}
                  <div className="pt-4 mt-4 border-t border-white/5 flex items-center justify-between text-xs">
                    <span className="text-neutral-500 flex items-center gap-1 font-mono text-[11px]">
                      <Clock size={11} />
                      {project.updatedAt
                        ? new Date(project.updatedAt).toLocaleDateString()
                        : "Recent"}
                    </span>
                    <span className="text-violet-400 font-semibold group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                      Launch <ArrowRight size={12} />
                    </span>
                  </div>
                </motion.div>
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
                  className="group flex items-center justify-between p-4 rounded-xl bg-[#161b22]/70 hover:bg-[#1c2128] border border-white/10 hover:border-violet-500/40 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-300 font-bold text-xs flex-shrink-0">
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white group-hover:text-violet-300 transition-colors truncate">
                          {project.name}
                        </h3>
                        {isFav && (
                          <Star
                            size={12}
                            className="text-amber-400 fill-amber-400 flex-shrink-0"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-neutral-500 mt-0.5">
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <GitBranch size={10} className="text-violet-400" />
                          main
                        </span>
                        <span>·</span>
                        <span>
                          {project.repoUrl
                            ? "GitHub Connected"
                            : "Local Workspace"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <span className="text-neutral-500 text-xs font-mono hidden sm:inline-block">
                      {project.updatedAt
                        ? new Date(project.updatedAt).toLocaleDateString()
                        : "Recent"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(project);
                      }}
                      className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                    <span className="text-xs font-semibold text-violet-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      Open <ArrowRight size={13} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Quick-Start & Import Section ───────────────────── */}
        <div className="pt-6 border-t border-white/10 mt-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <Sparkles size={16} className="text-violet-400" />
              Quick Import & Integrations
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Connect your repositories to automatically generate tests and
              measure logic coverage.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              whileHover={{ y: -2 }}
              onClick={() => setShowImport(true)}
              className="p-4 rounded-xl bg-neutral-900/50 hover:bg-neutral-900 border border-white/10 hover:border-violet-500/30 transition-all cursor-pointer flex items-start gap-3.5 group"
            >
              <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center text-white border border-white/10 group-hover:border-violet-500/40">
                <GithubIcon size={18} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white group-hover:text-violet-300 transition-colors flex items-center gap-1">
                  Import from GitHub <ExternalLink size={11} />
                </h4>
                <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
                  Connect public or private repos to extract code and generate
                  suites.
                </p>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -2 }}
              onClick={() => setShowImport(true)}
              className="p-4 rounded-xl bg-neutral-900/50 hover:bg-neutral-900 border border-white/10 hover:border-violet-500/30 transition-all cursor-pointer flex items-start gap-3.5 group"
            >
              <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center text-cyan-400 border border-white/10 group-hover:border-cyan-500/40">
                <UploadCloud size={18} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-1">
                  Upload ZIP Archive <Plus size={11} />
                </h4>
                <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
                  Upload your local project archive for immediate offline
                  analysis.
                </p>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -2 }}
              className="p-4 rounded-xl bg-gradient-to-br from-violet-950/20 to-neutral-900/50 border border-violet-500/20 flex items-start gap-3.5"
            >
              <div className="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-300 border border-violet-500/30">
                <ShieldCheck size={18} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-violet-200">
                  Automated CFG & MC/DC
                </h4>
                <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
                  Measure Cyclomatic Complexity and uncovered decision points
                  automatically.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      {/* ── Sleek Project Delete Confirmation Modal ─────────── */}
      <AnimatePresence>
        {projectToDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{
              background: "rgba(0,0,0,0.75)",
              backdropFilter: "blur(8px)",
            }}
            onClick={() => setProjectToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#161b22] border border-red-500/30 rounded-2xl p-6 shadow-2xl shadow-red-950/30 text-white"
            >
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-400 flex-shrink-0">
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Delete Project Workspace
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    This action is permanent and cannot be undone.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-neutral-900/80 border border-white/5 font-mono text-xs text-red-300 break-all mb-5">
                {projectToDelete.name}
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setProjectToDelete(null)}
                  disabled={isDeleting}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-all cursor-pointer shadow-lg shadow-red-950/40"
                >
                  {isDeleting && <Loader2 size={13} className="animate-spin" />}
                  <span>
                    {isDeleting ? "Deleting..." : "Delete Permanently"}
                  </span>
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Import Modal ────────────────────────────────────── */}
      <AnimatePresence>
        {showImport && (
          <ImportLayout
            onClose={() => setShowImport(false)}
            onSuccess={() => {
              setShowImport(false);
              fetchProjects();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
