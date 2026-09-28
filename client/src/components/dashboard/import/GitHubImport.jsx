import { useState } from "react";
import { Link2, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import RepoList from "./RepoList";
import {
  createProjectApi,
  importGithubUrlApi,
  getProjectsApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";
import Button from "../../common/Button";

export default function GitHubImport({ onClose, onSuccess }) {
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
    try {
      const match = urlValue.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!match) throw new Error("Invalid GitHub repository URL.");
      const repoName = match[2].replace(".git", "");

      let projectId;

      try {
        const projRes = await createProjectApi({
          name: repoName,
          repoUrl: urlValue,
        });
        projectId = projRes.data.id;
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

      importGithubUrlApi(projectId, urlValue).catch((err) => {
        console.error("[GitHubImport] Background import failed:", err);
      });

      showToast({
        type: "info",
        title: "Processing started",
        message: `"${repoName}" is being imported. Track progress in Job Queue.`,
      });

      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (err) {
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
        <RepoList onClose={onClose} onSuccess={onSuccess} />
      </div>
    </div>
  );
}
