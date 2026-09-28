import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  GitCommit,
  RefreshCw,
  Plus,
  Minus,
  RotateCcw,
  FileText,
  Check,
  ArrowUp,
  ArrowDown,
  History,
  Terminal,
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FolderGit2,
  Copy,
  Folder,
  SlidersHorizontal,
  ExternalLink,
  Link2,
  Globe,
} from "lucide-react";
import { gitService } from "../../services/git.service";

function GithubIcon({ size = 14, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

/* ── Status Color Helper ─────────────────────────────────── */
function getStatusBadge(status) {
  switch (status) {
    case "M":
      return {
        label: "M",
        color:
          "text-[var(--color-warning)] bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30",
      };
    case "A":
      return {
        label: "A",
        color:
          "text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30",
      };
    case "D":
      return {
        label: "D",
        color:
          "text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30",
      };
    case "R":
      return {
        label: "R",
        color:
          "text-[var(--color-secondary)] bg-[var(--color-secondary)]/10 border-[var(--color-secondary)]/30",
      };
    case "U":
    default:
      return {
        label: "U",
        color:
          "text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30",
      };
  }
}

export const GitPanel = ({ projectId, onSync }) => {
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  // Branch switcher state
  const [branches, setBranches] = useState({
    current: "main",
    local: [],
    remote: [],
  });
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchSearch, setBranchSearch] = useState("");

  // Remote repository state
  const [showLinkRemote, setShowLinkRemote] = useState(false);
  const [remoteInput, setRemoteInput] = useState("");
  const [savingRemote, setSavingRemote] = useState(false);

  // Collapsible sections
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);

  // Active view: 'changes' | 'history'
  const [activeTab, setActiveTab] = useState("changes");
  const [commitLog, setCommitLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);

  // Diff Modal
  const [diffModal, setDiffModal] = useState({
    open: false,
    file: "",
    staged: false,
    content: "",
  });
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Output terminal drawer
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState([]);

  const branchMenuRef = useRef(null);

  const addLog = useCallback((cmd, text, isErr = false) => {
    setTerminalLogs((prev) => [
      ...prev.slice(-30),
      { time: new Date().toLocaleTimeString(), cmd, text, isErr },
    ]);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await gitService.getStatus(projectId);
      setStatusData(res.data);
      if (res.data?.hasGit) {
        gitService
          .getBranches(projectId)
          .then((b) =>
            setBranches(b.data || { current: "main", local: [], remote: [] }),
          )
          .catch(() => {});
      }
    } catch (err) {
      setErrorMsg(err.message || "Failed to load git status");
      addLog("git status", err.message, true);
    } finally {
      setLoading(false);
    }
  }, [projectId, addLog]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Close branch menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target)) {
        setShowBranchMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch log when switching to history tab
  useEffect(() => {
    if (activeTab === "history" && projectId && statusData?.hasGit) {
      setLoadingLog(true);
      gitService
        .getLog(projectId, 30)
        .then((res) => setCommitLog(res.data || []))
        .catch((err) => setErrorMsg(err.message))
        .finally(() => setLoadingLog(false));
    }
  }, [activeTab, projectId, statusData?.hasGit]);

  /* ── Actions ────────────────────────────────────────────── */
  const handleInitRepo = async () => {
    setInitializing(true);
    setErrorMsg("");
    try {
      await gitService.initRepo(projectId);
      addLog("git init", "Initialized empty Git repository");
      setInfoMsg("Git repository initialized successfully!");
      setTimeout(() => setInfoMsg(""), 4000);
      await fetchStatus();
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git init", err.message, true);
    } finally {
      setInitializing(false);
    }
  };

  const handleSetRemote = async () => {
    if (!remoteInput.trim()) return;
    setSavingRemote(true);
    setErrorMsg("");
    try {
      const res = await gitService.setRemoteUrl(projectId, remoteInput.trim());
      setStatusData(res.data);
      setShowLinkRemote(false);
      setRemoteInput("");
      setInfoMsg("Remote repository linked successfully!");
      setTimeout(() => setInfoMsg(""), 4000);
      await fetchStatus();
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git remote set-url", err.message, true);
    } finally {
      setSavingRemote(false);
    }
  };

  const handleStage = async (files) => {
    setActionLoading(true);
    try {
      const res = await gitService.stageFiles(projectId, files);
      setStatusData(res.data);
      addLog(
        `git add ${Array.isArray(files) ? files.join(" ") : files}`,
        "Staged files",
      );
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git add", err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnstage = async (files) => {
    setActionLoading(true);
    try {
      const res = await gitService.unstageFiles(projectId, files);
      setStatusData(res.data);
      addLog(
        `git restore --staged ${Array.isArray(files) ? files.join(" ") : files}`,
        "Unstaged files",
      );
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git restore --staged", err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDiscard = async (filePath, isUntracked = false) => {
    setActionLoading(true);
    try {
      const res = await gitService.discardChanges(
        projectId,
        filePath,
        isUntracked,
      );
      setStatusData(res.data);
      addLog(`git discard ${filePath}`, "Changes discarded");
      if (onSync) {
        await onSync();
      }
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git discard", err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCommit = async (e) => {
    e?.preventDefault();
    if (!commitMessage.trim()) return;

    // If nothing is staged but there are changes (unstaged OR untracked), automatically stage all
    const stagedCount = statusData?.staged?.length || 0;
    const unstagedCount = statusData?.unstaged?.length || 0;
    const untrackedCount = statusData?.untracked?.length || 0;

    if (stagedCount === 0 && (unstagedCount > 0 || untrackedCount > 0)) {
      await handleStage("all");
    }

    setCommitting(true);
    setErrorMsg("");
    try {
      const res = await gitService.commit(projectId, commitMessage.trim());
      setCommitMessage("");
      setStatusData(res.data?.status || null);
      addLog(
        `git commit -m "${commitMessage.trim()}"`,
        res.data?.message || "Committed",
      );
      setInfoMsg("Committed changes successfully!");
      setTimeout(() => setInfoMsg(""), 3000);
      await fetchStatus();
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git commit", err.message, true);
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setErrorMsg("");
    try {
      const res = await gitService.push(projectId, statusData?.branch);
      addLog(
        `git push origin ${statusData?.branch || "main"}`,
        res.data?.output || "Pushed",
      );
      setInfoMsg("Pushed to remote successfully!");
      setTimeout(() => setInfoMsg(""), 3000);
      await fetchStatus();
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git push", err.message, true);
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setErrorMsg("");
    try {
      const res = await gitService.pull(projectId, statusData?.branch);
      addLog(
        `git pull origin ${statusData?.branch || "main"}`,
        res.data?.output || "Pulled",
      );
      setInfoMsg("Pulled from remote successfully!");
      setTimeout(() => setInfoMsg(""), 3000);
      await fetchStatus();
      if (onSync) {
        await onSync();
      }
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git pull", err.message, true);
    } finally {
      setPulling(false);
    }
  };

  const handleCheckout = async (branchName, createNew = false) => {
    setActionLoading(true);
    setErrorMsg("");
    try {
      await gitService.checkout(projectId, branchName, createNew);
      setShowBranchMenu(false);
      setNewBranchName("");
      addLog(
        `git checkout ${createNew ? "-b " : ""}${branchName}`,
        "Switched branch",
      );
      await fetchStatus();
      if (onSync) {
        await onSync();
      }
    } catch (err) {
      setErrorMsg(err.message);
      addLog("git checkout", err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const openDiff = async (filePath, staged = false) => {
    setLoadingDiff(true);
    setDiffModal({ open: true, file: filePath, staged, content: "" });
    try {
      const res = await gitService.getDiff(projectId, filePath, staged);
      setDiffModal({
        open: true,
        file: filePath,
        staged,
        content: res.data?.diff || "No changes",
      });
    } catch (err) {
      setDiffModal({
        open: true,
        file: filePath,
        staged,
        content: `Failed to load diff: ${err.message}`,
      });
    } finally {
      setLoadingDiff(false);
    }
  };

  const totalChanges =
    (statusData?.staged?.length || 0) +
    (statusData?.unstaged?.length || 0) +
    (statusData?.untracked?.length || 0);

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] text-[var(--color-text)] text-xs select-none border-r border-[var(--color-border)] relative overflow-hidden font-sans">
      {/* ── Top Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] flex items-center gap-1.5">
            <FolderGit2 size={13} className="text-[var(--color-primary)]" />
            Source Control
          </span>
          {totalChanges > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30">
              {totalChanges}
            </span>
          )}
        </div>

        {/* Toolbar Icons */}
        <div className="flex items-center gap-1 text-[var(--color-text-secondary)]">
          <button
            onClick={() =>
              setActiveTab(activeTab === "changes" ? "history" : "changes")
            }
            disabled={statusData?.isGitHubProject === false}
            className={`p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
              activeTab === "history"
                ? "text-[var(--color-primary)] bg-[var(--color-surface-secondary)]"
                : ""
            }`}
            title={activeTab === "history" ? "View Changes" : "Commit History"}
          >
            <History size={14} />
          </button>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh Status"
          >
            <RefreshCw
              size={14}
              className={
                loading ? "animate-spin text-[var(--color-primary)]" : ""
              }
            />
          </button>
          <button
            onClick={handlePull}
            disabled={
              pulling ||
              !statusData?.hasGit ||
              statusData?.isGitHubProject === false
            }
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed relative"
            title="Pull from Remote"
          >
            <ArrowDown
              size={14}
              className={
                pulling ? "animate-bounce text-[var(--color-secondary)]" : ""
              }
            />
            {statusData?.behind > 0 && (
              <span className="absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-[var(--color-warning)] text-[9px] font-mono font-bold text-white flex items-center justify-center leading-none">
                {statusData.behind}
              </span>
            )}
          </button>
          <button
            onClick={handlePush}
            disabled={
              pushing ||
              !statusData?.hasGit ||
              statusData?.isGitHubProject === false
            }
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed relative"
            title="Push to Remote"
          >
            <ArrowUp
              size={14}
              className={
                pushing ? "animate-bounce text-[var(--color-primary)]" : ""
              }
            />
            {statusData?.ahead > 0 && (
              <span className="absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-[var(--color-success)] text-[9px] font-mono font-bold text-white flex items-center justify-center leading-none">
                {statusData.ahead}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer ${
              showTerminal
                ? "text-[var(--color-primary)] bg-[var(--color-surface-secondary)]"
                : ""
            }`}
            title="Toggle Git Console Output"
          >
            <Terminal size={14} />
          </button>
        </div>
      </div>

      {/* ── Connected Remote Repository Bar ─────────────────────── */}
      {statusData?.repoUrl && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-bg)] border-b border-[var(--color-border)] text-[11px] flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <GithubIcon
              size={13}
              className="text-[var(--color-text-secondary)] flex-shrink-0"
            />
            <a
              href={statusData.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-primary)] hover:underline truncate font-mono text-[11px] flex items-center gap-1"
              title={statusData.repoUrl}
            >
              <span className="truncate">
                {statusData.repoUrl.replace("https://github.com/", "")}
              </span>
              <ExternalLink size={10} className="flex-shrink-0 opacity-70" />
            </a>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {statusData.ahead > 0 && (
              <span
                className="px-1.5 py-0.2 rounded-[var(--radius-sm)] text-[10px] font-mono font-bold bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30 flex items-center gap-0.5"
                title={`${statusData.ahead} commit(s) ahead of remote`}
              >
                <ArrowUp size={10} />
                {statusData.ahead}
              </span>
            )}
            {statusData.behind > 0 && (
              <span
                className="px-1.5 py-0.2 rounded-[var(--radius-sm)] text-[10px] font-mono font-bold bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/30 flex items-center gap-0.5"
                title={`${statusData.behind} commit(s) behind remote`}
              >
                <ArrowDown size={10} />
                {statusData.behind}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Status / Info / Error Alerts ─────────────────────── */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 px-3 py-2 text-[11px] text-[var(--color-danger)] flex items-start gap-2 flex-shrink-0"
          >
            <AlertCircle
              size={13}
              className="text-[var(--color-danger)] flex-shrink-0 mt-0.5"
            />
            <div className="flex-1 leading-snug">{errorMsg}</div>
            <button
              onClick={() => setErrorMsg("")}
              className="text-[var(--color-danger)] hover:opacity-80 cursor-pointer"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
        {infoMsg && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-[var(--color-success)]/10 border-b border-[var(--color-success)]/20 px-3 py-1.5 text-[11px] text-[var(--color-success)] flex items-center gap-2 flex-shrink-0"
          >
            <CheckCircle2
              size={13}
              className="text-[var(--color-success)] flex-shrink-0"
            />
            <span className="flex-1">{infoMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Content Area ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col scrollbar-thin scrollbar-thumb-[var(--color-border)]">
        {loading && !statusData ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-[var(--color-text-muted)]">
            <Loader2
              size={20}
              className="animate-spin text-[var(--color-primary)]"
            />
            <span className="text-xs">Inspecting Git status...</span>
          </div>
        ) : statusData?.isGitHubProject === false ? (
          /* ── Non-GitHub Project State ── */
          <div className="p-6 flex flex-col items-center justify-center text-center my-auto gap-4">
            <div className="w-12 h-12 rounded-[var(--radius-lg)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] shadow-sm">
              <FolderGit2
                size={24}
                className="text-[var(--color-text-muted)]"
              />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--color-text)] text-xs">
                GitHub Source Control Unavailable
              </h3>
              <p className="text-[11px] text-[var(--color-text-secondary)] mt-2 leading-relaxed max-w-[240px]">
                Git operations (push, pull, checkout, commit) are only enabled
                for repositories imported directly from GitHub.
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed max-w-[240px]">
                This project was uploaded from a compressed archive (ZIP/RAR).
              </p>
            </div>
          </div>
        ) : !statusData?.hasGit ? (
          /* ── Uninitialized Repo State ── */
          <div className="p-5 flex flex-col items-center justify-center text-center my-auto gap-4">
            <div className="w-12 h-12 rounded-[var(--radius-lg)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] shadow-sm">
              <FolderGit2 size={24} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--color-text)] text-xs">
                {statusData?.repoUrl
                  ? "Repository Not Initialized"
                  : "No Git Repository"}
              </h3>
              <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-relaxed max-w-[240px]">
                {statusData?.repoUrl ? (
                  <span>
                    Linked to{" "}
                    <span className="text-[var(--color-primary)] font-mono font-medium">
                      {statusData.repoUrl.replace("https://github.com/", "")}
                    </span>
                    . Initialize to track changes and sync with GitHub.
                  </span>
                ) : (
                  "Initialize a Git repository to track file modifications, stage commits, and sync with GitHub."
                )}
              </p>
            </div>
            <button
              onClick={handleInitRepo}
              disabled={initializing}
              className="px-4 py-2 rounded-[var(--radius-md)] text-xs font-semibold text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] shadow-none border-none transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {initializing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              <span>
                {statusData?.repoUrl
                  ? "Initialize & Sync with GitHub"
                  : "Initialize Repository"}
              </span>
            </button>

            {/* Link Remote Section */}
            {!statusData?.repoUrl && (
              <div className="w-full max-w-[240px] pt-2 border-t border-[var(--color-border)] flex flex-col gap-2">
                {!showLinkRemote ? (
                  <button
                    onClick={() => setShowLinkRemote(true)}
                    className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Link2 size={12} />
                    <span>Link GitHub repository</span>
                  </button>
                ) : (
                  <div className="flex flex-col gap-1.5 text-left">
                    <label className="text-[10px] text-[var(--color-text-muted)] font-semibold uppercase tracking-wider font-mono">
                      GitHub Repository URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://github.com/owner/repo"
                      value={remoteInput}
                      onChange={(e) => setRemoteInput(e.target.value)}
                      className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-primary)] rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none font-mono"
                    />
                    <div className="flex items-center gap-1.5 mt-1">
                      <button
                        onClick={handleSetRemote}
                        disabled={savingRemote || !remoteInput.trim()}
                        className="flex-1 py-1 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50 cursor-pointer"
                      >
                        {savingRemote ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          "Link & Init"
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setShowLinkRemote(false);
                          setRemoteInput("");
                        }}
                        className="px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === "history" ? (
          /* ── Commit History View ── */
          <div className="flex flex-col p-2 gap-1.5">
            <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[var(--color-text-muted)] font-semibold uppercase tracking-wider font-mono">
              <span>Recent Commits</span>
              <span className="font-mono text-[10px]">
                ({commitLog.length})
              </span>
            </div>

            {loadingLog ? (
              <div className="flex justify-center py-10">
                <Loader2
                  size={18}
                  className="animate-spin text-[var(--color-primary)]"
                />
              </div>
            ) : commitLog.length === 0 ? (
              <div className="text-center py-8 text-[var(--color-text-muted)] text-xs">
                No commits recorded yet
              </div>
            ) : (
              commitLog.map((c) => (
                <div
                  key={c.hash}
                  className="p-2 rounded-[var(--radius-md)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)] transition-colors flex flex-col gap-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-[var(--color-text)] leading-snug line-clamp-2">
                      {c.message}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-primary)]/20 flex-shrink-0">
                      {c.shortHash}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    <span>{c.author}</span>
                    <span>{c.date}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* ── Changes View ── */
          <div className="flex flex-col p-3 gap-3.5">
            {/* Branch Selector Bar */}
            <div className="relative" ref={branchMenuRef}>
              <div
                onClick={() => setShowBranchMenu(!showBranchMenu)}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/40 transition-all cursor-pointer text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranch
                    size={13}
                    className="text-[var(--color-primary)] flex-shrink-0"
                  />
                  <span className="font-mono font-semibold text-[var(--color-text)] truncate">
                    {statusData.branch || "main"}
                  </span>
                  {(statusData.ahead > 0 || statusData.behind > 0) && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg)] px-1.5 py-0.2 rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                      {statusData.ahead > 0 && <span>↑{statusData.ahead}</span>}
                      {statusData.behind > 0 && (
                        <span>↓{statusData.behind}</span>
                      )}
                    </span>
                  )}
                </div>
                <ChevronDown
                  size={13}
                  className="text-[var(--color-text-muted)] flex-shrink-0"
                />
              </div>

              {/* Branch Menu Dropdown */}
              <AnimatePresence>
                {showBranchMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute top-full left-0 right-0 mt-1 z-30 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-xl p-2.5 flex flex-col gap-2"
                  >
                    <div className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider px-1 font-mono">
                      Switch or Create Branch
                    </div>

                    {/* Filter & Create Input */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="Search or new branch..."
                        value={branchSearch}
                        onChange={(e) => setBranchSearch(e.target.value)}
                        className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] font-mono"
                      />
                      {branchSearch &&
                        !branches.local.includes(branchSearch) && (
                          <button
                            onClick={() => handleCheckout(branchSearch, true)}
                            className="px-2 py-1 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-[11px] font-medium flex items-center gap-1 flex-shrink-0 cursor-pointer"
                            title="Create and checkout"
                          >
                            <Plus size={11} /> Create
                          </button>
                        )}
                    </div>

                    {/* Local branches */}
                    <div className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider px-1 mt-1 font-mono">
                      Local Branches
                    </div>
                    <div className="flex flex-col max-h-32 overflow-y-auto gap-0.5 pr-0.5">
                      {branches.local
                        .filter((b) =>
                          b.toLowerCase().includes(branchSearch.toLowerCase()),
                        )
                        .map((b) => (
                          <button
                            key={b}
                            onClick={() => handleCheckout(b, false)}
                            className={`w-full text-left px-2 py-1.5 rounded-[var(--radius-sm)] flex items-center justify-between text-xs transition-colors cursor-pointer ${
                              b === statusData.branch
                                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold border border-[var(--color-primary)]/30"
                                : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-transparent"
                            }`}
                          >
                            <span className="font-mono truncate">{b}</span>
                            {b === statusData.branch && <Check size={12} />}
                          </button>
                        ))}
                    </div>

                    {/* Remote branches (origin) */}
                    {branches.remote?.filter((r) => !branches.local.includes(r))
                      .length > 0 && (
                      <>
                        <div className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider px-1 mt-1.5 pt-1.5 border-t border-[var(--color-border)] font-mono">
                          Remote Branches (origin)
                        </div>
                        <div className="flex flex-col max-h-32 overflow-y-auto gap-0.5 pr-0.5">
                          {branches.remote
                            .filter(
                              (b) =>
                                !branches.local.includes(b) &&
                                b
                                  .toLowerCase()
                                  .includes(branchSearch.toLowerCase()),
                            )
                            .map((b) => (
                              <button
                                key={b}
                                onClick={() => handleCheckout(b, false)}
                                className="w-full text-left px-2 py-1.5 rounded-[var(--radius-sm)] flex items-center justify-between text-xs hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                                title={`Checkout and track remote branch ${b}`}
                              >
                                <span className="font-mono truncate text-[11px]">
                                  origin/{b}
                                </span>
                                <ArrowDown size={11} className="opacity-50" />
                              </button>
                            ))}
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Commit Message Box */}
            <form onSubmit={handleCommit} className="flex flex-col gap-2">
              <div className="relative">
                <textarea
                  rows={2}
                  placeholder="Commit message (Ctrl+Enter)..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      handleCommit(e);
                    }
                  }}
                  className="w-full rounded-[var(--radius-md)] bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-primary)] p-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-all resize-none font-sans"
                />
              </div>

              <button
                type="submit"
                disabled={
                  committing || (!commitMessage.trim() && totalChanges === 0)
                }
                className="w-full h-8 rounded-[var(--radius-md)] flex items-center justify-center gap-2 font-semibold text-xs text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] shadow-none border-none transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {committing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Committing...</span>
                  </>
                ) : (
                  <>
                    <Check size={13} strokeWidth={2.5} />
                    <span>Commit</span>
                  </>
                )}
              </button>
            </form>

            {/* Clean State */}
            {statusData.clean && totalChanges === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center text-[var(--color-text-muted)] gap-2">
                <CheckCircle2
                  size={24}
                  className="text-[var(--color-success)] opacity-80"
                />
                <span className="text-xs text-[var(--color-text-secondary)]">
                  Working tree clean
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  No modifications detected
                </span>
              </div>
            )}

            {/* ── Staged Changes Section ── */}
            {statusData.staged.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[var(--color-text-secondary)] px-1">
                  <button
                    onClick={() => setStagedOpen(!stagedOpen)}
                    className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider hover:text-[var(--color-text)] font-mono cursor-pointer"
                  >
                    {stagedOpen ? (
                      <ChevronDown size={11} />
                    ) : (
                      <ChevronRight size={11} />
                    )}
                    <span>Staged Changes ({statusData.staged.length})</span>
                  </button>
                  <button
                    onClick={() => handleUnstage("all")}
                    disabled={actionLoading}
                    className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                    title="Unstage All Changes"
                  >
                    <Minus size={12} />
                  </button>
                </div>

                {stagedOpen && (
                  <div className="flex flex-col gap-0.5">
                    {statusData.staged.map((f) => {
                      const badge = getStatusBadge(f.status);
                      return (
                        <div
                          key={`staged-${f.path}`}
                          className="group flex items-center justify-between px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                          onClick={() => openDiff(f.path, true)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-[10px] font-bold font-mono px-1 rounded-[var(--radius-sm)] border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-mono text-[var(--color-text)] truncate text-[11px]">
                              {f.path}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDiff(f.path, true);
                              }}
                              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                              title="Open Diff"
                            >
                              <FileText size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnstage([f.path]);
                              }}
                              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                              title="Unstage File"
                            >
                              <Minus size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Unstaged / Untracked Changes Section ── */}
            {(statusData.unstaged.length > 0 ||
              statusData.untracked.length > 0) && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[var(--color-text-secondary)] px-1">
                  <button
                    onClick={() => setChangesOpen(!changesOpen)}
                    className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider hover:text-[var(--color-text)] font-mono cursor-pointer"
                  >
                    {changesOpen ? (
                      <ChevronDown size={11} />
                    ) : (
                      <ChevronRight size={11} />
                    )}
                    <span>
                      Changes (
                      {statusData.unstaged.length + statusData.untracked.length}
                      )
                    </span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStage("all")}
                      disabled={actionLoading}
                      className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                      title="Stage All Changes"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>

                {changesOpen && (
                  <div className="flex flex-col gap-0.5">
                    {/* Unstaged modified / deleted */}
                    {statusData.unstaged.map((f) => {
                      const badge = getStatusBadge(f.status);
                      return (
                        <div
                          key={`unstaged-${f.path}`}
                          className="group flex items-center justify-between px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                          onClick={() => openDiff(f.path, false)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-[10px] font-bold font-mono px-1 rounded-[var(--radius-sm)] border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-mono text-[var(--color-text)] truncate text-[11px]">
                              {f.path}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDiff(f.path, false);
                              }}
                              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                              title="Open Diff"
                            >
                              <FileText size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDiscard(f.path, false);
                              }}
                              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-warning)]/15 text-[var(--color-text-secondary)] hover:text-[var(--color-warning)] cursor-pointer"
                              title="Discard Changes"
                            >
                              <RotateCcw size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStage([f.path]);
                              }}
                              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-success)]/15 text-[var(--color-text-secondary)] hover:text-[var(--color-success)] cursor-pointer"
                              title="Stage File"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Untracked */}
                    {statusData.untracked.map((f) => {
                      const badge = getStatusBadge(f.status);
                      return (
                        <div
                          key={`untracked-${f.path}`}
                          className="group flex items-center justify-between px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                          onClick={() => handleStage([f.path])}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-[10px] font-bold font-mono px-1 rounded-[var(--radius-sm)] border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-mono text-[var(--color-text)] truncate text-[11px]">
                              {f.path}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDiscard(f.path, true);
                              }}
                              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-danger)]/15 text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] cursor-pointer"
                              title="Delete Untracked File"
                            >
                              <RotateCcw size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStage([f.path]);
                              }}
                              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-success)]/15 text-[var(--color-text-secondary)] hover:text-[var(--color-success)] cursor-pointer"
                              title="Track / Stage File"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Console / Terminal Output Drawer ──────────────────── */}
      <AnimatePresence>
        {showTerminal && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 160 }}
            exit={{ height: 0 }}
            className="border-t border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col flex-shrink-0 overflow-hidden font-mono text-[10px]"
          >
            <div className="flex items-center justify-between px-3 py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
              <span className="flex items-center gap-1.5 font-bold uppercase text-[var(--color-primary)]">
                <Terminal size={11} /> Git Output Console
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTerminalLogs([])}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-[10px] cursor-pointer"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowTerminal(false)}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                >
                  <X size={11} />
                </button>
              </div>
            </div>

            <div className="flex-1 p-2 overflow-y-auto space-y-1 text-[var(--color-text)] select-text">
              {terminalLogs.length === 0 ? (
                <div className="text-[var(--color-text-muted)]">
                  // No Git operations logged yet
                </div>
              ) : (
                terminalLogs.map((log, i) => (
                  <div key={i} className="leading-relaxed">
                    <span className="text-[var(--color-text-muted)]">
                      [{log.time}]
                    </span>{" "}
                    <span className="text-[var(--color-primary)] font-semibold">
                      $ {log.cmd}
                    </span>
                    <pre
                      className={`whitespace-pre-wrap mt-0.5 pl-3 border-l ${
                        log.isErr
                          ? "border-[var(--color-danger)]/40 text-[var(--color-danger)]"
                          : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {log.text}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Diff Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {diffModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-2xl max-h-[80vh] rounded-[var(--radius-xl)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Diff Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText
                    size={15}
                    className="text-[var(--color-primary)] flex-shrink-0"
                  />
                  <span className="font-mono text-xs font-semibold text-[var(--color-text)] truncate">
                    {diffModal.file}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-[var(--radius-sm)] font-mono bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                    {diffModal.staged ? "Staged" : "Working Tree"}
                  </span>
                </div>
                <button
                  onClick={() =>
                    setDiffModal({
                      open: false,
                      file: "",
                      staged: false,
                      content: "",
                    })
                  }
                  className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Diff Content */}
              <div className="flex-1 p-4 overflow-y-auto font-mono text-xs select-text bg-[var(--color-bg)] text-[var(--color-text)]">
                {loadingDiff ? (
                  <div className="flex justify-center py-12">
                    <Loader2
                      size={20}
                      className="animate-spin text-[var(--color-primary)]"
                    />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap leading-relaxed">
                    {diffModal.content.split("\n").map((line, idx) => {
                      let color = "text-[var(--color-text-secondary)]";
                      let bg = "transparent";
                      if (line.startsWith("+")) {
                        color = "text-[var(--color-success)]";
                        bg = "rgba(16, 185, 129, 0.12)";
                      } else if (line.startsWith("-")) {
                        color = "text-[var(--color-danger)]";
                        bg = "rgba(239, 68, 68, 0.12)";
                      } else if (line.startsWith("@@")) {
                        color = "text-[var(--color-secondary)] font-bold";
                        bg = "rgba(59, 130, 246, 0.1)";
                      }
                      return (
                        <div
                          key={idx}
                          style={{ backgroundColor: bg }}
                          className={`${color} px-1.5 py-0.2 rounded-[var(--radius-sm)]`}
                        >
                          {line || " "}
                        </div>
                      );
                    })}
                  </pre>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GitPanel;
