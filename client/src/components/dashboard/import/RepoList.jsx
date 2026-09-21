import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Search,
  FolderGit2,
  Lock,
  User,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import {
  getGithubRepositoriesApi,
  createProjectApi,
  importGithubRepoApi,
  getProjectsApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";

/* ── Helper ─────────────────────────────────── */
function getLangColor(lang) {
  const colors = {
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Python: "#3572A5",
    Vue: "#41b883",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Go: "#00add8",
    Rust: "#dea584",
    Java: "#b07219",
  };
  return colors[lang] || "#8b949e";
}

/* ── Single Repo Row ─────────────────────────────────────── */
function RepoItem({ repo, index, onClose, onSuccess, showToast }) {
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (importing) return;

    if (
      repo.language &&
      repo.language !== "JavaScript" &&
      repo.language !== "TypeScript"
    ) {
      showToast({
        type: "warning",
        title: "Language not fully supported",
        message:
          "This project currently focuses on JavaScript/TypeScript. We will attempt parsing, but coverage generation may vary.",
      });
    }

    setImporting(true);
    try {
      let projectId;

      try {
        const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
        const projRes = await createProjectApi({
          name: repo.name,
          repoUrl,
        });
        projectId = projRes.data.id;
      } catch (createErr) {
        if (
          createErr.message?.includes("already exists") ||
          createErr.message?.includes("Duplicate")
        ) {
          const { projects } = await getProjectsApi();
          const existing = projects?.find((p) => p.name === repo.name);
          if (existing) {
            projectId = existing.id;
          } else {
            throw new Error("Project already exists but could not be found.");
          }
        } else {
          throw createErr;
        }
      }

      importGithubRepoApi(projectId, repo.owner, repo.name).catch((err) => {
        console.error("[RepoList] Background import failed:", err);
      });

      showToast({
        type: "info",
        title: "Processing started",
        message: `"${repo.name}" is being imported. Track progress in Job Queue.`,
      });

      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (err) {
      showToast({
        type: "error",
        title: "Import failed",
        message: err.message || "An unexpected error occurred during import.",
      });
      setImporting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * Math.min(index, 10), duration: 0.2 }}
      className="group flex items-center justify-between p-3 rounded-xl bg-neutral-900/40 hover:bg-neutral-800/60 border border-white/5 hover:border-violet-500/30 transition-all cursor-pointer"
      id={`repo-item-${repo.id}`}
    >
      {/* Left info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-neutral-800/80 border border-white/5 group-hover:border-violet-500/20 flex items-center justify-center flex-shrink-0">
          {repo.isPrivate ? (
            <Lock size={14} className="text-amber-400/80" />
          ) : (
            <FolderGit2
              size={15}
              className="text-neutral-400 group-hover:text-violet-300 transition-colors"
            />
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-200 group-hover:text-white transition-colors truncate font-sans">
              {repo.name}
            </span>
            {repo.isPrivate && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Private
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 mt-0.5 text-[11px] text-neutral-400">
            {repo.language && (
              <span className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full inline-block shadow-sm"
                  style={{ backgroundColor: repo.langColor }}
                />
                {repo.language}
              </span>
            )}
            <span className="text-neutral-600">•</span>
            <span>Updated {repo.updatedAt}</span>
          </div>
        </div>
      </div>

      {/* Right action */}
      <motion.button
        whileHover={!importing ? { scale: 1.04 } : {}}
        whileTap={!importing ? { scale: 0.96 } : {}}
        onClick={(e) => {
          e.stopPropagation();
          handleImport();
        }}
        disabled={importing}
        className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-300 group-hover:text-white bg-white/5 group-hover:bg-violet-600 hover:!bg-violet-500 border border-white/10 group-hover:border-violet-400/40 transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        id={`repo-import-${repo.id}`}
      >
        {importing ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            <span>Importing...</span>
          </>
        ) : (
          <span>Import</span>
        )}
      </motion.button>
    </motion.div>
  );
}

/* ── Repo List ───────────────────────────────────────────── */
export default function RepoList({ onClose, onSuccess }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const reposPerPage = 6;
  const { showToast } = useToast();

  useEffect(() => {
    getGithubRepositoriesApi()
      .then((data) => {
        const mapped = Array.isArray(data)
          ? data.map((r) => ({
              id: r.id,
              name: r.name,
              language: r.language || "Unknown",
              langColor: getLangColor(r.language),
              updatedAt: new Date(
                r.updated_at || new Date(),
              ).toLocaleDateString(),
              isPrivate: r.private,
              owner: r.owner?.login,
            }))
          : [];
        setRepos(mapped);
      })
      .catch((err) => {
        setErrorMsg(err.message || "Failed to load repositories.");
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const totalPages = Math.ceil(filteredRepos.length / reposPerPage) || 1;
  const displayedRepos = filteredRepos.slice(
    (currentPage - 1) * reposPerPage,
    currentPage * reposPerPage,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const ownerName = repos[0]?.owner || "Connected Account";

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Search and account header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-neutral-800 border border-white/10 flex items-center justify-center">
            <User size={12} className="text-neutral-400" />
          </div>
          <span className="text-xs font-semibold text-neutral-200 font-mono">
            {ownerName}
          </span>
          <span className="text-[10px] text-neutral-500 font-mono">
            ({filteredRepos.length} repos)
          </span>
        </div>

        {/* Filter input */}
        <div className="relative w-48">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            type="text"
            placeholder="Search repos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-neutral-900/80 border border-white/10 focus:border-violet-500/40 outline-none text-neutral-200 placeholder:text-neutral-600 transition-all font-sans"
            id="repo-search-input"
          />
        </div>
      </div>

      {/* Repo list container */}
      <div className="flex flex-col gap-2 overflow-y-auto max-h-[290px] pr-1 scrollbar-thin scrollbar-thumb-white/10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-neutral-500">
            <Loader2 className="animate-spin text-violet-400" size={22} />
            <span className="text-xs">Loading repositories...</span>
          </div>
        ) : errorMsg ? (
          <div className="flex flex-col items-center justify-center py-8 text-red-400 text-xs text-center">
            <p className="font-semibold">Unable to fetch repositories</p>
            <p className="text-neutral-500 mt-1">{errorMsg}</p>
          </div>
        ) : displayedRepos.length > 0 ? (
          displayedRepos.map((repo, i) => (
            <RepoItem
              key={repo.id}
              repo={repo}
              index={i}
              onClose={onClose}
              onSuccess={onSuccess}
              showToast={showToast}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-neutral-500">
            <Search size={22} className="text-neutral-600" />
            <span className="text-xs">No repositories match your filter</span>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-neutral-400">
          <span className="text-[11px] font-mono text-neutral-500">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((curr) => Math.max(curr - 1, 1))}
              className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-neutral-300"
              title="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              disabled={currentPage === totalPages}
              onClick={() =>
                setCurrentPage((curr) => Math.min(curr + 1, totalPages))
              }
              className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-neutral-300"
              title="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
