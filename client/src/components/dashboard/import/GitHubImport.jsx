import { useState } from "react";
import { Link2, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import RepoList from "./RepoList";
import {
  createProjectApi,
  importGithubUrlApi,
  getProjectsApi,
  deleteProjectApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";
import Button from "../../common/Button";

function GithubIcon({ size = 16, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default function GitHubImport({ onClose, onSuccess, hasGithub }) {
  const [urlValue, setUrlValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { showToast } = useToast();

  const isValidUrl =
    urlValue.startsWith("https://github.com/") && urlValue.length > 22;

  const handleImportUrl = async () => {
    if (!isValidUrl || uploading) return;
    setUploading(true);
    setErrorMsg("");
    let projectId = null;
    let createdNewProject = false;

    try {
      const match = urlValue.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!match) throw new Error("Invalid GitHub repository URL.");
      const repoName = match[2].replace(".git", "");

      try {
        const projRes = await createProjectApi({
          name: repoName,
          repoUrl: urlValue,
        });
        projectId = projRes.data.id;
        createdNewProject = true;
      } catch (createErr) {
        if (
          createErr.message?.includes("already exists") ||
          createErr.message?.includes("Duplicate")
        ) {
          const { projects } = await getProjectsApi();
          const existing = projects?.find((p) => p.name === repoName);
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

      await importGithubUrlApi(projectId, urlValue);

      showToast({
        type: "info",
        title: "Processing started",
        message: `"${repoName}" is being imported. Track progress in Job Queue.`,
      });

      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (err) {
      if (createdNewProject && projectId) {
        deleteProjectApi(projectId).catch(() => {});
      }
      setErrorMsg(err.message || "An unexpected error occurred during import.");
      showToast({
        type: "error",
        title: "Import failed",
        message: err.message || "An unexpected error occurred.",
      });
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-5">
      {/* ── Import via URL Section ───────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="github-url-input"
            className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wider flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" />
            Import via GitHub URL
          </label>
          <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
            Public or Private repos
          </span>
        </div>

        {/* URL Input Row */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center flex-1 rounded-[var(--radius-md)] px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)] transition-all">
            <Link2
              size={15}
              className="mr-2 text-[var(--color-text-muted)] shrink-0"
            />
            <input
              type="text"
              id="github-url-input"
              placeholder="https://github.com/organization/repository"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              className="w-full bg-transparent outline-none text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] font-mono"
            />
            {urlValue && (
              <div className="ml-2 flex items-center shrink-0">
                {isValidUrl ? (
                  <CheckCircle2
                    size={15}
                    className="text-[var(--color-success)]"
                  />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                )}
              </div>
            )}
          </div>

          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleImportUrl}
            disabled={uploading || !isValidUrl}
            loading={uploading}
            icon={ArrowRight}
            id="url-import-btn"
          >
            Import
          </Button>
        </div>

        {errorMsg && (
          <div className="rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 p-2.5 text-xs text-[var(--color-danger)] flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-[var(--color-border)]" />
        <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider font-mono">
          Or Select From Account
        </span>
        <div className="flex-1 h-px bg-[var(--color-border)]" />
      </div>

      {/* ── Repository Browser ─────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {hasGithub === false ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] border-dashed gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text)]">
              <GithubIcon size={20} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-[var(--color-text)] tracking-tight">
                Connect GitHub Account
              </h4>
              <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 max-w-xs leading-relaxed">
                Link your GitHub account to import private repositories and
                browse your repository list directly.
              </p>
            </div>
            <a
              href={`https://github.com/login/oauth/authorize?client_id=${
                import.meta.env.VITE_GITHUB_CLIENT_ID || ""
              }&scope=repo,user:email`}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer shadow-xs"
              id="connect-github-import-btn"
            >
              <GithubIcon size={13} />
              <span>Connect with GitHub</span>
            </a>
          </div>
        ) : (
          <RepoList
            onClose={onClose}
            onSuccess={onSuccess}
            hasGithub={hasGithub}
          />
        )}
      </div>
    </div>
  );
}
