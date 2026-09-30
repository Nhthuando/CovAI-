import { useState, useEffect } from "react";
import {
  Search,
  FolderGit2,
  Lock,
  User,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getGithubRepositoriesApi,
  createProjectApi,
  importGithubRepoApi,
  getProjectsApi,
  deleteProjectApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";
import Button from "../../common/Button";
import Badge from "../../common/Badge";

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
function RepoItem({ repo, onClose, onSuccess, showToast }) {
  const [importing, setImporting] = useState(false);
  const isSupported =
    !repo.language ||
    repo.language === "JavaScript" ||
    repo.language === "TypeScript";

  const handleImport = async () => {
    if (importing) return;

    if (!isSupported) {
      showToast({
        type: "error",
        title: "Ngôn ngữ không được hỗ trợ",
        message: `CovAI chỉ hỗ trợ dự án có ngôn ngữ chính là JavaScript hoặc TypeScript. Repository này có ngôn ngữ là: ${repo.language}.`,
      });
      return;
    }

    setImporting(true);
    let projectId = null;
    let createdNewProject = false;

    try {
      try {
        const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
        const projRes = await createProjectApi({
          name: repo.name,
          repoUrl,
        });
        projectId = projRes.data.id;
        createdNewProject = true;
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
            throw new Error("Project already exists but could not be found.", {
              cause: createErr,
            });
          }
        } else {
          throw createErr;
        }
      }

      await importGithubRepoApi(projectId, repo.owner, repo.name);

      showToast({
        type: "info",
        title: "Processing started",
        message: `"${repo.name}" is being imported. Track progress in Job Queue.`,
      });

      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (err) {
      if (createdNewProject && projectId) {
        deleteProjectApi(projectId).catch(() => {});
      }
      showToast({
        type: "error",
        title: "Import failed",
        message: err.message || "An unexpected error occurred during import.",
      });
      setImporting(false);
    }
  };

  return (
    <div
      className="group flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-subtle)] transition-colors"
      id={`repo-item-${repo.id}`}
    >
      {/* Left info */}
      <div className="flex items-center gap-3 min-w-0 pr-3">
        <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
          {repo.isPrivate ? (
            <Lock size={14} className="text-amber-500" />
          ) : (
            <FolderGit2
              size={14}
              className="text-[var(--color-text-secondary)] group-hover:text-[var(--color-primary)] transition-colors"
            />
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-text)] truncate font-sans">
              {repo.name}
            </span>
            {repo.isPrivate && (
              <Badge variant="warning" size="sm">
                Private
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2.5 mt-0.5 text-[11px] text-[var(--color-text-muted)] font-mono">
            {repo.language && (
              <span className="flex items-center gap-1.5 font-sans">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: repo.langColor }}
                />
                {repo.language}
                {!isSupported && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 text-[var(--color-danger)] font-medium">
                    Unsupported
                  </span>
                )}
              </span>
            )}
            <span>•</span>
            <span>Updated {repo.updatedAt}</span>
          </div>
        </div>
      </div>

      {/* Right action */}
      <Button
        type="button"
        variant={!isSupported ? "ghost" : "secondary"}
        size="sm"
        onClick={handleImport}
        disabled={importing || !isSupported}
        loading={importing}
        title={
          !isSupported
            ? `Chỉ hỗ trợ JavaScript/TypeScript (Ngôn ngữ: ${repo.language})`
            : "Import repository"
        }
        id={`repo-import-${repo.id}`}
      >
        {!isSupported ? "Not Supported" : "Import"}
      </Button>
    </div>
  );
}

/* ── Repo List ───────────────────────────────────────────── */
export default function RepoList({ onClose, onSuccess, hasGithub }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(hasGithub !== false);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const reposPerPage = 5;
  const { showToast } = useToast();

  useEffect(() => {
    if (hasGithub === false) {
      setLoading(false);
      return;
    }
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
  }, [hasGithub]);

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const totalPages = Math.ceil(filteredRepos.length / reposPerPage) || 1;
  const displayedRepos = filteredRepos.slice(
    (currentPage - 1) * reposPerPage,
    currentPage * reposPerPage,
  );

  const ownerName = repos[0]?.owner || "Connected Account";

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Search and account header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
            <User size={12} className="text-[var(--color-text-secondary)]" />
          </div>
          <span className="text-xs font-semibold text-[var(--color-text)] font-mono">
            {ownerName}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
            ({filteredRepos.length} repos)
          </span>
        </div>

        {/* Filter input */}
        <div className="relative w-44 sm:w-48">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search repos..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-colors font-sans"
            id="repo-search-input"
          />
        </div>
      </div>

      {/* Repo list container */}
      <div className="flex flex-col gap-2 overflow-y-auto max-h-[280px] pr-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-[var(--color-text-muted)]">
            <Loader2
              className="animate-spin text-[var(--color-primary)]"
              size={20}
            />
            <span className="text-xs">Loading repositories...</span>
          </div>
        ) : errorMsg ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--color-danger)] text-xs text-center">
            <p className="font-semibold">Unable to fetch repositories</p>
            <p className="text-[var(--color-text-muted)] mt-1">{errorMsg}</p>
          </div>
        ) : displayedRepos.length > 0 ? (
          displayedRepos.map((repo) => (
            <RepoItem
              key={repo.id}
              repo={repo}
              onClose={onClose}
              onSuccess={onSuccess}
              showToast={showToast}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-[var(--color-text-muted)]">
            <Search size={20} className="text-[var(--color-text-muted)]" />
            <span className="text-xs">No repositories match your query</span>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
          <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((curr) => Math.max(curr - 1, 1))}
              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--color-text)] cursor-pointer"
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() =>
                setCurrentPage((curr) => Math.min(curr + 1, totalPages))
              }
              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--color-text)] cursor-pointer"
              title="Next page"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
