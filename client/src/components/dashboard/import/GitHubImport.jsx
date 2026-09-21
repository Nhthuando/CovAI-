import { useState } from "react";
import { motion } from "framer-motion";
import {
  Link2,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import RepoList from "./RepoList";
import {
  createProjectApi,
  importGithubUrlApi,
  getProjectsApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";

export default function GitHubImport({ onClose, onSuccess }) {
  const [urlValue, setUrlValue] = useState("");
  const [urlFocused, setUrlFocused] = useState(false);
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
            throw new Error("Project already exists but could not be found.");
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
    <div className="flex flex-col h-full gap-6">
      {/* ── Import via URL Section ───────────────────────────── */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            Import via GitHub URL
          </label>
          <span className="text-[11px] text-neutral-500 font-mono">
            Public or Private repos
          </span>
        </div>

        {/* URL Input Row */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center flex-1 rounded-xl px-3.5 py-2.5 bg-neutral-900/60 border transition-all ${
              urlFocused
                ? "border-violet-500/50 shadow-[0_0_20px_rgba(124,58,237,0.15)] bg-neutral-900"
                : "border-white/10 hover:border-white/15"
            }`}
          >
            <Link2
              size={16}
              className={`mr-2.5 transition-colors ${
                urlFocused ? "text-violet-400" : "text-neutral-500"
              }`}
            />
            <input
              type="text"
              placeholder="https://github.com/organization/repository"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onFocus={() => setUrlFocused(true)}
              onBlur={() => setUrlFocused(false)}
              className="w-full bg-transparent outline-none text-xs text-neutral-100 placeholder:text-neutral-600 font-mono"
              id="github-url-input"
            />
            {urlValue && (
              <div className="ml-2 flex items-center">
                {isValidUrl ? (
                  <CheckCircle2
                    size={15}
                    className="text-emerald-400 animate-in fade-in"
                  />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-amber-400/80 animate-pulse" />
                )}
              </div>
            )}
          </div>

          <motion.button
            whileHover={!uploading && isValidUrl ? { scale: 1.02 } : {}}
            whileTap={!uploading && isValidUrl ? { scale: 0.98 } : {}}
            onClick={handleImportUrl}
            disabled={uploading || !isValidUrl}
            className="h-10 px-5 rounded-xl flex items-center gap-2 text-xs font-semibold tracking-wide uppercase text-white shadow-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            style={{
              background: isValidUrl
                ? "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)"
                : "rgba(255, 255, 255, 0.08)",
              boxShadow: isValidUrl
                ? "0 4px 16px rgba(124,58,237,0.3)"
                : "none",
            }}
            id="url-import-btn"
          >
            {uploading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Importing</span>
              </>
            ) : (
              <>
                <span>Import</span>
                <ArrowRight size={14} />
              </>
            )}
          </motion.button>
        </div>

        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-300 flex items-center gap-2"
          >
            <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </motion.div>
        )}
      </div>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-[1px] bg-white/5" />
        <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider font-mono">
          Or Select From Account
        </span>
        <div className="flex-1 h-[1px] bg-white/5" />
      </div>

      {/* ── Repository Browser ─────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <RepoList onClose={onClose} onSuccess={onSuccess} />
      </div>
    </div>
  );
}
