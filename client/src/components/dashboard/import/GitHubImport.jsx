import { useState } from "react";
import {
  Link2,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import RepoList from "./RepoList";
import {
  createProjectApi,
  importGithubUrlApi,
  getProjectsApi,
  deleteProjectApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";
import { fetchGithubAuthorizeUrlApi } from "../../../services/auth.service";

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

export default function GitHubImport({
  onClose,
  onSuccess,
  hasGithub,
  profileError = "",
  onRetryProfile,
}) {
  const [urlValue, setUrlValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [connectingGithub, setConnectingGithub] = useState(false);
  const [forceConnectView, setForceConnectView] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { showToast } = useToast();

  const handleConnectGithub = async () => {
    if (connectingGithub) return;
    setConnectingGithub(true);
    try {
      const oauthUrl = await fetchGithubAuthorizeUrlApi("connect");
      sessionStorage.setItem("covai.githubOAuthMode", "connect");
      sessionStorage.setItem(
        "covai.githubConnectReturn",
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.assign(oauthUrl);
    } catch (err) {
      setConnectingGithub(false);
      showToast({
        type: "error",
        title: "GitHub OAuth Unavailable",
        message: err?.message || "GitHub OAuth is not configured.",
      });
    }
  };

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
    <div className="flex flex-col h-full gap-4">
      {/* ── URL Bar Section ────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="github-url-input"
            className="text-xs font-semibold text-[var(--ps-ink)]"
          >
            GitHub repository URL
          </label>
          <span className="text-[11px] text-[var(--ps-ink-muted)] ps-mono">
            Public or connected private
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center flex-1 h-9 rounded-lg px-3 bg-[var(--ps-inset)] border border-[var(--ps-line)] focus-within:border-[var(--ps-cobalt)] transition-colors">
            <Link2
              size={14}
              className="mr-2 text-[var(--ps-ink-muted)] shrink-0"
            />
            <input
              type="text"
              id="github-url-input"
              placeholder="https://github.com/organization/repository"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              className="w-full bg-transparent outline-none text-xs text-[var(--ps-ink)] placeholder:text-[var(--ps-ink-muted)] ps-mono"
            />
            {urlValue && (
              <div className="ml-2 flex items-center shrink-0">
                {isValidUrl ? (
                  <CheckCircle2
                    size={14}
                    style={{ color: "var(--ps-emerald)" }}
                  />
                ) : (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: "var(--ps-amber)" }}
                  />
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleImportUrl}
            disabled={uploading || !isValidUrl}
            id="url-import-btn"
            className="h-9 px-3.5 rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold ps-btn-contrast cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {uploading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ArrowRight size={13} />
            )}
            <span>Import</span>
          </button>
        </div>

        {errorMsg && (
          <div
            className="rounded-lg p-2.5 text-xs flex items-center gap-2 border"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--ps-rose) 8%, transparent)",
              borderColor:
                "color-mix(in srgb, var(--ps-rose) 25%, transparent)",
              color: "var(--ps-rose)",
            }}
          >
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* ── Hairline Divider ──────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-[var(--ps-line)]" />
        <span className="text-[11px] text-[var(--ps-ink-muted)]">
          or select from GitHub
        </span>
        <div className="flex-1 h-px bg-[var(--ps-line)]" />
      </div>

      {/* ── Repository Browser ────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {profileError ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center rounded-[10px] bg-[var(--ps-inset)] border border-[var(--ps-line)] border-dashed gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-line)] flex items-center justify-center text-[var(--ps-rose)]">
              <AlertCircle size={18} />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[var(--ps-ink)]">
                Unable to check GitHub connection
              </h4>
              <p className="text-[11.5px] text-[var(--ps-ink-secondary)] mt-1 max-w-xs leading-relaxed">
                {profileError}
              </p>
            </div>
            {onRetryProfile && (
              <button
                type="button"
                onClick={onRetryProfile}
                className="h-8 px-3.5 rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold ps-btn-contrast cursor-pointer"
                id="retry-github-profile-btn"
              >
                <span>Retry</span>
              </button>
            )}
          </div>
        ) : hasGithub === false || forceConnectView ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center rounded-[10px] bg-[var(--ps-inset)] border border-[var(--ps-line)] border-dashed gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-line)] flex items-center justify-center text-[var(--ps-ink)]">
              <GithubIcon size={18} />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[var(--ps-ink)]">
                Connect your GitHub account
              </h4>
              <p className="text-[11.5px] text-[var(--ps-ink-secondary)] mt-1 max-w-xs leading-relaxed">
                Authorize read access to browse and import your public or
                private repositories in one click.
              </p>
            </div>
            <button
              type="button"
              onClick={handleConnectGithub}
              disabled={connectingGithub}
              className="h-8 px-3.5 rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold ps-btn-contrast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              id="connect-github-import-btn"
            >
              {connectingGithub ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <GithubIcon size={13} />
              )}
              <span>
                {connectingGithub
                  ? "Redirecting to GitHub..."
                  : "Connect GitHub"}
              </span>
            </button>
          </div>
        ) : (
          <RepoList
            onClose={onClose}
            onSuccess={onSuccess}
            hasGithub={hasGithub}
            onReconnectGithub={() => setForceConnectView(true)}
          />
        )}
      </div>
    </div>
  );
}
