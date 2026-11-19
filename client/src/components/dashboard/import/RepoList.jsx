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

function getLangColor(lang) {
  const colors = {
    TypeScript: "#7ba3c9",
    JavaScript: "#b89b6a",
    Python: "#8d93b8",
    Vue: "#6fa38b",
    HTML: "#ba7279",
    CSS: "#8d93b8",
    Go: "#739c99",
    Rust: "#b89b6a",
    Java: "#ba7279",
  };
  return colors[lang] || "#71717a";
}

function RepoItem({ repo, onClose, onSuccess, showToast }) {
  const [importing, setImporting] = useState(false);
  const isSupported = Boolean(
    repo.hasJsOrTs ??
    (!repo.language ||
      repo.language === "JavaScript" ||
      repo.language === "TypeScript" ||
      (Array.isArray(repo.languages) &&
        repo.languages.some(
          (l) =>
            l.toLowerCase() === "javascript" ||
            l.toLowerCase() === "typescript",
        )) ||
      ["HTML", "CSS", "Vue", "Unknown"].includes(repo.language)),
  );

  const handleImport = async () => {
    if (importing) return;

    if (!isSupported) {
      showToast({
        type: "error",
        title: "Unsupported language",
        message: "CovAI requires JavaScript or TypeScript in the repository.",
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
      className="group flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--ps-inset)] hover:bg-[var(--ps-surface-2)] border border-[var(--ps-line)] hover:border-[var(--ps-line-strong)] transition-colors duration-150"
      id={`repo-item-${repo.id}`}
    >
      <div className="flex items-center gap-3 min-w-0 pr-3">
        <div className="w-8 h-8 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-line)] flex items-center justify-center shrink-0">
          {repo.isPrivate ? (
            <Lock size={13} style={{ color: "var(--ps-amber)" }} />
          ) : (
            <FolderGit2
              size={14}
              className="text-[var(--ps-ink-secondary)] group-hover:text-[var(--ps-ink)] transition-colors"
            />
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--ps-ink)] truncate">
              {repo.name}
            </span>
            {repo.isPrivate && (
              <span className="text-[10px] ps-mono px-1.5 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-line)] text-[var(--ps-ink-muted)]">
                Private
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--ps-ink-muted)]">
            {repo.language && (
              <span className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: repo.langColor }}
                />
                <span>{repo.language}</span>
                {isSupported &&
                  repo.language !== "JavaScript" &&
                  repo.language !== "TypeScript" && (
                    <span
                      className="text-[10px] ps-mono px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--ps-emerald) 10%, transparent)",
                        color: "var(--ps-emerald)",
                      }}
                    >
                      JS/TS
                    </span>
                  )}
                {!isSupported && (
                  <span
                    className="text-[10px] ps-mono px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--ps-rose) 10%, transparent)",
                      color: "var(--ps-rose)",
                    }}
                  >
                    Unsupported
                  </span>
                )}
              </span>
            )}
            <span>·</span>
            <span className="ps-mono text-[10.5px]">
              Updated {repo.updatedAt}
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleImport}
        disabled={importing || !isSupported}
        title={
          !isSupported
            ? `Only JavaScript/TypeScript supported (Language: ${repo.language})`
            : "Import repository"
        }
        id={`repo-import-${repo.id}`}
        className={`h-7 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors shrink-0 ${
          !isSupported
            ? "text-[var(--ps-ink-muted)] bg-transparent cursor-not-allowed opacity-50"
            : "border border-[var(--ps-line-strong)] bg-[var(--ps-surface)] hover:bg-[var(--ps-ink)] hover:text-[var(--ps-bg)] hover:border-transparent text-[var(--ps-ink)] cursor-pointer"
        }`}
      >
        {importing && <Loader2 size={12} className="animate-spin" />}
        <span>{!isSupported ? "Unsupported" : "Import"}</span>
      </button>
    </div>
  );
}

export default function RepoList({ onClose, onSuccess, hasGithub }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(hasGithub !== false);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const reposPerPage = 10;
  const { showToast } = useToast();

  useEffect(() => {
    if (hasGithub !== true) {
      return;
    }
    let cancelled = false;
    getGithubRepositoriesApi()
      .then((data) => {
        if (cancelled) return;
        const mapped = Array.isArray(data)
          ? data.map((r) => {
              const hasJsOrTs =
                r.hasJsOrTs ??
                (!r.language ||
                  r.language === "JavaScript" ||
                  r.language === "TypeScript" ||
                  (Array.isArray(r.languages) &&
                    r.languages.some(
                      (l) =>
                        l.toLowerCase() === "javascript" ||
                        l.toLowerCase() === "typescript",
                    )) ||
                  ["HTML", "CSS", "Vue", "Unknown"].includes(r.language));

              return {
                id: r.id,
                name: r.name,
                language: r.language || "Unknown",
                langColor: getLangColor(r.language),
                updatedAt: new Date(
                  r.updated_at || new Date(),
                ).toLocaleDateString(),
                isPrivate: r.private,
                owner: r.owner?.login,
                languages: r.languages || [],
                hasJsOrTs,
              };
            })
          : [];
        setRepos(mapped);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err.message || "Failed to load repositories.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasGithub]);

  const isLoading = hasGithub !== false && loading;

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const totalPages = Math.ceil(filteredRepos.length / reposPerPage) || 1;
  const displayedRepos = filteredRepos.slice(
    (currentPage - 1) * reposPerPage,
    currentPage * reposPerPage,
  );

  const ownerName =
    repos[0]?.owner || (isLoading ? "Checking GitHub..." : "GitHub Account");

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header & Search */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-[var(--ps-surface-2)] border border-[var(--ps-line)] flex items-center justify-center shrink-0">
            <User size={12} className="text-[var(--ps-ink-secondary)]" />
          </div>
          <span className="text-xs font-medium text-[var(--ps-ink)] truncate">
            {ownerName}
          </span>
          {!isLoading && (
            <span className="text-[11px] text-[var(--ps-ink-muted)] ps-mono shrink-0">
              {filteredRepos.length} repos
            </span>
          )}
        </div>

        <div className="relative w-44 sm:w-52">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ps-ink-muted)] pointer-events-none"
          />
          <input
            type="text"
            placeholder="Filter repositories..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full h-8 pl-8 pr-2.5 text-xs rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)] focus:border-[var(--ps-cobalt)] outline-none text-[var(--ps-ink)] placeholder:text-[var(--ps-ink-muted)] transition-colors"
            id="repo-search-input"
          />
        </div>
      </div>

      {/* Repo List */}
      <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-[245px] max-h-[320px] pr-0.5">
        {isLoading ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-[52px] rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)] px-3 flex items-center justify-between animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-[var(--ps-surface-2)]" />
                  <div className="space-y-1.5">
                    <div className="w-32 h-2.5 rounded bg-[var(--ps-surface-2)]" />
                    <div className="w-24 h-2 rounded bg-[var(--ps-surface-2)]" />
                  </div>
                </div>
                <div className="w-14 h-6 rounded-md bg-[var(--ps-surface-2)]" />
              </div>
            ))}
          </div>
        ) : errorMsg ? (
          <div
            className="flex flex-col items-center justify-center flex-1 py-8 text-xs text-center rounded-lg border border-dashed border-[var(--ps-line)]"
            style={{ color: "var(--ps-rose)" }}
          >
            <p className="font-semibold">Unable to load repositories</p>
            <p className="text-[var(--ps-ink-muted)] mt-1">{errorMsg}</p>
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
          <div className="flex flex-col items-center justify-center flex-1 py-8 gap-2 text-[var(--ps-ink-muted)] rounded-lg border border-dashed border-[var(--ps-line)]">
            <Search size={18} />
            <span className="text-xs">No matching repositories</span>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-[var(--ps-line)] text-xs text-[var(--ps-ink-secondary)]">
          <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)]">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((curr) => Math.max(curr - 1, 1))}
              className="p-1.5 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface-2)]/60 hover:bg-[var(--ps-surface-2)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--ps-ink)] cursor-pointer"
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() =>
                setCurrentPage((curr) => Math.min(curr + 1, totalPages))
              }
              className="p-1.5 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface-2)]/60 hover:bg-[var(--ps-surface-2)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[var(--ps-ink)] cursor-pointer"
              title="Next page"
              aria-label="Next page"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
