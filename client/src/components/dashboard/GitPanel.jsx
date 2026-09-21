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
        color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
      };
    case "A":
      return {
        label: "A",
        color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
      };
    case "D":
      return {
        label: "D",
        color: "text-red-400 bg-red-400/10 border-red-400/30",
      };
    case "R":
      return {
        label: "R",
        color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
      };
    case "U":
    default:
      return {
        label: "U",
        color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
      };
  }
}

export const GitPanel = ({ projectId }) => {
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
    <div className="flex flex-col h-full bg-[#0d1117] text-neutral-200 text-xs select-none border-r border-white/5 relative overflow-hidden font-sans">
      {/* ── Top Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/5 bg-[#090d13]/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[11px] uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
            <FolderGit2 size={13} className="text-violet-400" />
            Source Control
          </span>
          {totalChanges > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-violet-500/20 text-violet-300 border border-violet-500/30">
              {totalChanges}
            </span>
          )}
        </div>

        {/* Toolbar Icons */}
        <div className="flex items-center gap-1 text-neutral-400">
          <button
            onClick={() =>
              setActiveTab(activeTab === "changes" ? "history" : "changes")
            }
            disabled={statusData?.isGitHubProject === false}
            className={`p-1 rounded hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              activeTab === "history"
                ? "text-violet-400 bg-white/5"
                : "hover:text-white"
            }`}
            title={activeTab === "history" ? "View Changes" : "Commit History"}
          >
            <History size={14} />
          </button>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh Status"
          >
            <RefreshCw
              size={14}
              className={loading ? "animate-spin text-violet-400" : ""}
            />
          </button>
          <button
            onClick={handlePull}
            disabled={
              pulling ||
              !statusData?.hasGit ||
              statusData?.isGitHubProject === false
            }
            className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed relative"
            title="Pull from Remote"
          >
            <ArrowDown
              size={14}
              className={pulling ? "animate-bounce text-cyan-400" : ""}
            />
            {statusData?.behind > 0 && (
              <span className="absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-amber-500 text-[9px] font-mono font-bold text-black flex items-center justify-center leading-none">
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
            className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed relative"
            title="Push to Remote"
          >
            <ArrowUp
              size={14}
              className={pushing ? "animate-bounce text-violet-400" : ""}
            />
            {statusData?.ahead > 0 && (
              <span className="absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-emerald-500 text-[9px] font-mono font-bold text-black flex items-center justify-center leading-none">
                {statusData.ahead}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`p-1 rounded hover:bg-white/10 transition-colors ${
              showTerminal ? "text-violet-400 bg-white/5" : "hover:text-white"
            }`}
            title="Toggle Git Console Output"
          >
            <Terminal size={14} />
          </button>
        </div>
      </div>

      {/* ── Connected Remote Repository Bar ─────────────────────── */}
      {statusData?.repoUrl && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#090d13]/80 border-b border-white/5 text-[11px] flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <GithubIcon size={13} className="text-white/70 flex-shrink-0" />
            <a
              href={statusData.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-violet-400 hover:text-violet-300 hover:underline truncate font-mono text-[11px] flex items-center gap-1"
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
                className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5"
                title={`${statusData.ahead} commit(s) ahead of remote`}
              >
                <ArrowUp size={10} />
                {statusData.ahead}
              </span>
            )}
            {statusData.behind > 0 && (
              <span
                className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-0.5"
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
            className="bg-red-500/10 border-b border-red-500/20 px-3 py-2 text-[11px] text-red-300 flex items-start gap-2 flex-shrink-0"
          >
            <AlertCircle
              size={13}
              className="text-red-400 flex-shrink-0 mt-0.5"
            />
            <div className="flex-1 leading-snug">{errorMsg}</div>
            <button
              onClick={() => setErrorMsg("")}
              className="text-red-400 hover:text-white"
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
            className="bg-emerald-500/10 border-b border-emerald-500/20 px-3 py-1.5 text-[11px] text-emerald-300 flex items-center gap-2 flex-shrink-0"
          >
            <CheckCircle2
              size={13}
              className="text-emerald-400 flex-shrink-0"
            />
            <span className="flex-1">{infoMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Content Area ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col scrollbar-thin scrollbar-thumb-white/10">
        {loading && !statusData ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-neutral-500">
            <Loader2 size={20} className="animate-spin text-violet-400" />
            <span className="text-xs">Inspecting Git status...</span>
          </div>
        ) : statusData?.isGitHubProject === false ? (
          /* ── Non-GitHub Project State ── */
          <div className="p-6 flex flex-col items-center justify-center text-center my-auto gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-500 shadow-lg">
              <FolderGit2 size={24} className="text-neutral-500" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-xs">
                GitHub Source Control Unavailable
              </h3>
              <p className="text-[11px] text-neutral-400 mt-2 leading-relaxed max-w-[240px]">
                Git operations (push, pull, checkout, commit) are only enabled
                for repositories imported directly from GitHub.
              </p>
              <p className="text-[10px] text-neutral-500 mt-1.5 leading-relaxed max-w-[240px]">
                This project was uploaded from a compressed archive (ZIP/RAR).
              </p>
            </div>
          </div>
        ) : !statusData?.hasGit ? (
          /* ── Uninitialized Repo State ── */
          <div className="p-5 flex flex-col items-center justify-center text-center my-auto gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-400 shadow-lg">
              <FolderGit2 size={24} className="text-violet-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-xs">
                {statusData?.repoUrl
                  ? "Repository Not Initialized"
                  : "No Git Repository"}
              </h3>
              <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed max-w-[240px]">
                {statusData?.repoUrl ? (
                  <span>
                    Linked to{" "}
                    <span className="text-violet-400 font-mono font-medium">
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
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-md shadow-violet-500/20 border border-white/10 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
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
              <div className="w-full max-w-[240px] pt-2 border-t border-white/5 flex flex-col gap-2">
                {!showLinkRemote ? (
                  <button
                    onClick={() => setShowLinkRemote(true)}
                    className="text-[11px] text-neutral-400 hover:text-violet-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Link2 size={12} />
                    <span>Link GitHub repository</span>
                  </button>
                ) : (
                  <div className="flex flex-col gap-1.5 text-left">
                    <label className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">
                      GitHub Repository URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://github.com/owner/repo"
                      value={remoteInput}
                      onChange={(e) => setRemoteInput(e.target.value)}
                      className="w-full bg-neutral-900 border border-white/10 focus:border-violet-500/50 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                    />
                    <div className="flex items-center gap-1.5 mt-1">
                      <button
                        onClick={handleSetRemote}
                        disabled={savingRemote || !remoteInput.trim()}
                        className="flex-1 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50 cursor-pointer"
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
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 text-xs cursor-pointer"
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
            <div className="flex items-center justify-between px-2 py-1 text-[11px] text-neutral-400 font-semibold uppercase tracking-wider">
              <span>Recent Commits</span>
              <span className="font-mono text-[10px]">
                ({commitLog.length})
              </span>
            </div>

            {loadingLog ? (
              <div className="flex justify-center py-10">
                <Loader2 size={18} className="animate-spin text-violet-400" />
              </div>
            ) : commitLog.length === 0 ? (
              <div className="text-center py-8 text-neutral-500 text-xs">
                No commits recorded yet
              </div>
            ) : (
              commitLog.map((c) => (
                <div
                  key={c.hash}
                  className="p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-colors flex flex-col gap-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-white leading-snug line-clamp-2">
                      {c.message}
                    </span>
                    <span className="font-mono text-[10px] text-violet-400 bg-violet-500/10 px-1 py-0.2 rounded border border-violet-500/20 flex-shrink-0">
                      {c.shortHash}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-neutral-500 mt-0.5">
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
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-neutral-900/80 hover:bg-neutral-800/80 border border-white/10 hover:border-violet-500/30 transition-all cursor-pointer text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranch
                    size={13}
                    className="text-violet-400 flex-shrink-0"
                  />
                  <span className="font-mono font-semibold text-neutral-200 truncate">
                    {statusData.branch || "main"}
                  </span>
                  {(statusData.ahead > 0 || statusData.behind > 0) && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-neutral-400 bg-white/5 px-1.5 py-0.2 rounded">
                      {statusData.ahead > 0 && <span>↑{statusData.ahead}</span>}
                      {statusData.behind > 0 && (
                        <span>↓{statusData.behind}</span>
                      )}
                    </span>
                  )}
                </div>
                <ChevronDown
                  size={13}
                  className="text-neutral-500 flex-shrink-0"
                />
              </div>

              {/* Branch Menu Dropdown */}
              <AnimatePresence>
                {showBranchMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className="absolute top-full left-0 right-0 mt-1 z-30 bg-[#161b22] border border-white/10 rounded-xl shadow-2xl p-2 flex flex-col gap-2"
                  >
                    <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-1">
                      Switch or Create Branch
                    </div>

                    {/* Filter & Create Input */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="Search or new branch..."
                        value={branchSearch}
                        onChange={(e) => setBranchSearch(e.target.value)}
                        className="flex-1 bg-neutral-900/80 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-violet-500/40 font-mono"
                      />
                      {branchSearch &&
                        !branches.local.includes(branchSearch) && (
                          <button
                            onClick={() => handleCheckout(branchSearch, true)}
                            className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-medium flex items-center gap-1 flex-shrink-0"
                            title="Create and checkout"
                          >
                            <Plus size={11} /> Create
                          </button>
                        )}
                    </div>

                    {/* Local branches */}
                    <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-1 mt-1">
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
                            className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between text-xs transition-colors ${
                              b === statusData.branch
                                ? "bg-violet-600/20 text-violet-300 font-semibold"
                                : "hover:bg-white/5 text-neutral-300"
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
                        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-1 mt-1.5 pt-1.5 border-t border-white/5">
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
                                className="w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between text-xs hover:bg-white/5 text-neutral-400 hover:text-white transition-colors"
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
                  className="w-full rounded-xl bg-neutral-900/80 border border-white/10 focus:border-violet-500/50 p-2.5 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none transition-all resize-none font-sans"
                />
              </div>

              <button
                type="submit"
                disabled={
                  committing || (!commitMessage.trim() && totalChanges === 0)
                }
                className="w-full h-8 rounded-xl flex items-center justify-center gap-2 font-semibold text-xs text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-md shadow-violet-500/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
              <div className="flex flex-col items-center justify-center py-8 text-center text-neutral-500 gap-2">
                <CheckCircle2 size={24} className="text-emerald-500/60" />
                <span className="text-xs text-neutral-400">
                  Working tree clean
                </span>
                <span className="text-[11px] text-neutral-600">
                  No modifications detected
                </span>
              </div>
            )}

            {/* ── Staged Changes Section ── */}
            {statusData.staged.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-neutral-400 px-1">
                  <button
                    onClick={() => setStagedOpen(!stagedOpen)}
                    className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider hover:text-white"
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
                    className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
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
                          className="group flex items-center justify-between px-2 py-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                          onClick={() => openDiff(f.path, true)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-[10px] font-bold font-mono px-1 rounded border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-mono text-neutral-300 group-hover:text-white truncate text-[11px]">
                              {f.path}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDiff(f.path, true);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
                              title="Open Diff"
                            >
                              <FileText size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnstage([f.path]);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
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
                <div className="flex items-center justify-between text-neutral-400 px-1">
                  <button
                    onClick={() => setChangesOpen(!changesOpen)}
                    className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider hover:text-white"
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
                      className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
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
                          className="group flex items-center justify-between px-2 py-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                          onClick={() => openDiff(f.path, false)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-[10px] font-bold font-mono px-1 rounded border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-mono text-neutral-300 group-hover:text-white truncate text-[11px]">
                              {f.path}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDiff(f.path, false);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
                              title="Open Diff"
                            >
                              <FileText size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDiscard(f.path, false);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-amber-400"
                              title="Discard Changes"
                            >
                              <RotateCcw size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStage([f.path]);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-emerald-400"
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
                          className="group flex items-center justify-between px-2 py-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                          onClick={() => handleStage([f.path])}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-[10px] font-bold font-mono px-1 rounded border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-mono text-neutral-300 group-hover:text-white truncate text-[11px]">
                              {f.path}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDiscard(f.path, true);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-red-400"
                              title="Delete Untracked File"
                            >
                              <RotateCcw size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStage([f.path]);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-emerald-400"
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
            className="border-t border-white/10 bg-[#090d13] flex flex-col flex-shrink-0 overflow-hidden font-mono text-[10px]"
          >
            <div className="flex items-center justify-between px-3 py-1 bg-white/[0.03] border-b border-white/5 text-neutral-400">
              <span className="flex items-center gap-1.5 font-bold uppercase">
                <Terminal size={11} /> Git Output Console
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTerminalLogs([])}
                  className="hover:text-white text-[10px]"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowTerminal(false)}
                  className="hover:text-white"
                >
                  <X size={11} />
                </button>
              </div>
            </div>

            <div className="flex-1 p-2 overflow-y-auto space-y-1 text-neutral-300 select-text">
              {terminalLogs.length === 0 ? (
                <div className="text-neutral-600">
                  // No Git operations logged yet
                </div>
              ) : (
                terminalLogs.map((log, i) => (
                  <div key={i} className="leading-relaxed">
                    <span className="text-neutral-600">[{log.time}]</span>{" "}
                    <span className="text-violet-400">$ {log.cmd}</span>
                    <pre
                      className={`whitespace-pre-wrap mt-0.5 pl-3 border-l ${
                        log.isErr
                          ? "border-red-500/40 text-red-300"
                          : "border-white/10 text-neutral-400"
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
              className="w-full max-w-2xl max-h-[80vh] rounded-2xl bg-[#0d1117] border border-white/10 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Diff Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#161b22]">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText
                    size={15}
                    className="text-violet-400 flex-shrink-0"
                  />
                  <span className="font-mono text-xs font-semibold text-white truncate">
                    {diffModal.file}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-white/5 text-neutral-400 border border-white/10">
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
                  className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Diff Content */}
              <div className="flex-1 p-4 overflow-y-auto font-mono text-xs select-text bg-[#090d13]">
                {loadingDiff ? (
                  <div className="flex justify-center py-12">
                    <Loader2
                      size={20}
                      className="animate-spin text-violet-400"
                    />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap leading-relaxed">
                    {diffModal.content.split("\n").map((line, idx) => {
                      let color = "text-neutral-400";
                      let bg = "transparent";
                      if (line.startsWith("+")) {
                        color = "text-emerald-300";
                        bg = "rgba(16, 185, 129, 0.1)";
                      } else if (line.startsWith("-")) {
                        color = "text-red-300";
                        bg = "rgba(239, 68, 68, 0.1)";
                      } else if (line.startsWith("@@")) {
                        color = "text-cyan-400 font-bold";
                        bg = "rgba(6, 182, 212, 0.05)";
                      }
                      return (
                        <div
                          key={idx}
                          style={{ backgroundColor: bg }}
                          className={`${color} px-1.5 py-0.2 rounded-sm`}
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
