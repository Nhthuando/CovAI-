import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  GitCommit,
  GitGraph,
  Layers,
  BookmarkPlus,
  RotateCcw,
  History,
  RefreshCw,
  Check,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  Minus,
  Trash2,
  ExternalLink,
  Search,
  FileText,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Clock,
  HardDrive,
  Copy,
  SlidersHorizontal,
  FolderGit2,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { gitService } from "../../services/git.service";
import {
  getProjectSnapshotsApi,
  createProjectSnapshotApi,
  restoreProjectSnapshotApi,
} from "../../services/project.service";
import { useProjectAccess } from "../../hooks/useProjectAccess";
import ConfirmDialog from "../common/ConfirmDialog";
import { SnapshotsListSkeleton } from "../common/Skeleton";

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

function getStatusBadge(status) {
  switch (status) {
    case "M":
      return {
        label: "M",
        text: "Modified",
        color:
          "text-[var(--color-warning)] bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30",
      };
    case "A":
      return {
        label: "A",
        text: "Added",
        color:
          "text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30",
      };
    case "D":
      return {
        label: "D",
        text: "Deleted",
        color:
          "text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30",
      };
    case "R":
      return {
        label: "R",
        text: "Renamed",
        color:
          "text-[var(--color-secondary)] bg-[var(--color-secondary)]/10 border-[var(--color-secondary)]/30",
      };
    case "U":
    default:
      return {
        label: "U",
        text: "Untracked",
        color:
          "text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30",
      };
  }
}

export default function VersionControlWorkspace({ projectId, onSync }) {
  const projectAccess = useProjectAccess(projectId);
  const [activeTab, setActiveTab] = useState("git"); // "git" | "snapshots"

  /* ───────────────────────────────────────────────────────────
   * 1. Git State
   * ────────────────────────────────────────────────────────── */
  const [gitStatus, setGitStatus] = useState(null);
  const [loadingGit, setLoadingGit] = useState(true);
  const [gitActionLoading, setGitActionLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [gitNotice, setGitNotice] = useState(null);

  // Branches
  const [branches, setBranches] = useState({ current: "main", local: [], remote: [] });
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const branchMenuRef = useRef(null);

  // Diff & History
  const [gitSubTab, setGitSubTab] = useState("diff"); // "diff" | "history"
  const [selectedDiffFile, setSelectedDiffFile] = useState(null);
  const [diffContent, setDiffContent] = useState("");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [commitLog, setCommitLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);

  /* ───────────────────────────────────────────────────────────
   * 2. Snapshot State
   * ────────────────────────────────────────────────────────── */
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [snapshotSearch, setSnapshotSearch] = useState("");
  const [showCreateSnapshotModal, setShowCreateSnapshotModal] = useState(false);
  const [newSnapshotLabel, setNewSnapshotLabel] = useState("");
  const [newSnapshotMessage, setNewSnapshotMessage] = useState("");
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [confirmRestoreSnapshot, setConfirmRestoreSnapshot] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState(null);

  /* ───────────────────────────────────────────────────────────
   * Data Fetching
   * ────────────────────────────────────────────────────────── */
  const fetchGitStatus = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setLoadingGit(true);
    try {
      const res = await gitService.getStatus(projectId);
      setGitStatus(res?.data || null);
    } catch (err) {
      console.warn("Failed to load git status", err);
    } finally {
      setLoadingGit(false);
    }
  }, [projectId]);

  const fetchBranches = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await gitService.getBranches(projectId);
      if (res?.data) {
        setBranches(res.data);
      }
    } catch {
      // Ignored if not a git repo
    }
  }, [projectId]);

  const fetchCommitLog = useCallback(async () => {
    if (!projectId) return;
    setLoadingLog(true);
    try {
      const res = await gitService.getLog(projectId, 30);
      setCommitLog(res?.data || []);
    } catch (err) {
      console.warn("Failed to load commit log", err);
    } finally {
      setLoadingLog(false);
    }
  }, [projectId]);

  const fetchSnapshots = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setLoadingSnapshots(true);
    try {
      const res = await getProjectSnapshotsApi(projectId);
      setSnapshots(res?.data || []);
    } catch (err) {
      console.warn("Failed to load snapshots", err);
    } finally {
      setLoadingSnapshots(false);
    }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    fetchGitStatus();
    fetchBranches();
    fetchSnapshots();
  }, [fetchGitStatus, fetchBranches, fetchSnapshots]);

  // Fetch log when history sub-tab is opened
  useEffect(() => {
    if (activeTab === "git" && gitSubTab === "history") {
      fetchCommitLog();
    }
  }, [activeTab, gitSubTab, fetchCommitLog]);

  const autoInitRef = useRef(false);

  // Auto-connect if project is from GitHub but local repo is temporarily unlinked
  useEffect(() => {
    if (
      activeTab === "git" &&
      gitStatus &&
      !gitStatus.hasGit &&
      (gitStatus.isGitHubProject || gitStatus.repoUrl) &&
      !autoInitRef.current &&
      !gitActionLoading &&
      projectAccess.can("files.write")
    ) {
      autoInitRef.current = true;
      handleInitRepo();
    }
  }, [activeTab, gitStatus, gitActionLoading, projectAccess]);

  // Click outside branch menu
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target)) {
        setShowBranchMenu(false);
        setCreatingBranch(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* ───────────────────────────────────────────────────────────
   * Git Actions
   * ────────────────────────────────────────────────────────── */
  const handleStageFile = async (filePath) => {
    setGitActionLoading(true);
    try {
      await gitService.stageFiles(projectId, [filePath]);
      await fetchGitStatus(true);
      if (selectedDiffFile?.path === filePath) {
        loadDiff(filePath, true);
      }
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const handleUnstageFile = async (filePath) => {
    setGitActionLoading(true);
    try {
      await gitService.unstageFiles(projectId, [filePath]);
      await fetchGitStatus(true);
      if (selectedDiffFile?.path === filePath) {
        loadDiff(filePath, false);
      }
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const handleStageAll = async () => {
    setGitActionLoading(true);
    try {
      await gitService.stageFiles(projectId, "all");
      await fetchGitStatus(true);
      showGitMessage("success", "All changes staged");
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const handleUnstageAll = async () => {
    setGitActionLoading(true);
    try {
      const staged = (gitStatus?.staged || []).map((f) => f.path);
      await gitService.unstageFiles(projectId, staged);
      await fetchGitStatus(true);
      showGitMessage("success", "All changes unstaged");
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const handleDiscard = async (filePath, isUntracked = false) => {
    if (!confirm(`Discard all changes in "${filePath}"? This cannot be undone.`)) return;
    setGitActionLoading(true);
    try {
      await gitService.discardChanges(projectId, filePath, isUntracked);
      await fetchGitStatus(true);
      if (selectedDiffFile?.path === filePath) {
        setSelectedDiffFile(null);
        setDiffContent("");
      }
      onSync?.();
      showGitMessage("success", `Discarded changes in ${filePath}`);
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    const totalChanges = stagedCount + unstagedCount + untrackedCount;
    if (totalChanges === 0) {
      showGitMessage("error", "No changes to commit");
      return;
    }
    setCommitting(true);
    try {
      // Auto-stage all changes if nothing has been staged yet
      if (stagedCount === 0) {
        await gitService.stageFiles(projectId, "all");
      }
      await gitService.commit(projectId, commitMessage.trim());
      setCommitMessage("");
      showGitMessage("success", "Changes committed successfully");
      await fetchGitStatus(true);
      await fetchCommitLog();
      onSync?.();
    } catch (err) {
      showGitMessage("error", err.message || "Failed to commit changes");
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      await gitService.push(projectId);
      showGitMessage("success", "Pushed to remote repository");
      await fetchGitStatus(true);
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      await gitService.pull(projectId);
      showGitMessage("success", "Pulled latest changes from remote");
      await fetchGitStatus(true);
      onSync?.();
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setPulling(false);
    }
  };

  const handleSwitchBranch = async (branchName) => {
    setGitActionLoading(true);
    try {
      await gitService.checkout(projectId, branchName, false);
      setShowBranchMenu(false);
      showGitMessage("success", `Switched to branch "${branchName}"`);
      await fetchGitStatus(true);
      await fetchBranches();
      onSync?.();
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setGitActionLoading(true);
    try {
      await gitService.checkout(projectId, newBranchName.trim(), true);
      setNewBranchName("");
      setCreatingBranch(false);
      setShowBranchMenu(false);
      showGitMessage("success", `Created and switched to branch "${newBranchName.trim()}"`);
      await fetchGitStatus(true);
      await fetchBranches();
      onSync?.();
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const handleInitRepo = async () => {
    setGitActionLoading(true);
    try {
      await gitService.initRepo(projectId);
      showGitMessage("success", "Initialized Git repository successfully");
      await fetchGitStatus(true);
      await fetchBranches();
    } catch (err) {
      showGitMessage("error", err.message);
    } finally {
      setGitActionLoading(false);
    }
  };

  const loadDiff = async (filePath, staged = false) => {
    setSelectedDiffFile({ path: filePath, staged });
    setLoadingDiff(true);
    setGitSubTab("diff");
    try {
      const res = await gitService.getDiff(projectId, filePath, staged);
      setDiffContent(res?.data || "(No textual diff or file is binary)");
    } catch (err) {
      setDiffContent(`Error loading diff: ${err.message}`);
    } finally {
      setLoadingDiff(false);
    }
  };

  const showGitMessage = (type, text) => {
    setGitNotice({ type, text });
    setTimeout(() => setGitNotice(null), 4000);
  };

  /* ───────────────────────────────────────────────────────────
   * Snapshot Actions
   * ────────────────────────────────────────────────────────── */
  const handleCreateSnapshot = async () => {
    if (!projectId || creatingSnapshot) return;
    setCreatingSnapshot(true);
    try {
      const res = await createProjectSnapshotApi(projectId, {
        label: newSnapshotLabel.trim() || undefined,
        message: newSnapshotMessage.trim() || undefined,
      });
      setNewSnapshotLabel("");
      setNewSnapshotMessage("");
      setShowCreateSnapshotModal(false);
      setSnapshotNotice({
        type: "success",
        text: `Snapshot "${res.data?.label || "Checkpoint"}" captured successfully!`,
      });
      setTimeout(() => setSnapshotNotice(null), 4000);
      await fetchSnapshots(true);
      onSync?.();
    } catch (err) {
      setSnapshotNotice({
        type: "error",
        text: err.message || "Failed to create snapshot",
      });
      setTimeout(() => setSnapshotNotice(null), 5000);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!projectAccess.can("snapshot.restore") || !confirmRestoreSnapshot || restoring) return;
    setRestoring(true);
    try {
      const targetLabel = confirmRestoreSnapshot.label || confirmRestoreSnapshot.id.slice(0, 8);
      await restoreProjectSnapshotApi(projectId, confirmRestoreSnapshot.id);
      setConfirmRestoreSnapshot(null);
      setSnapshotNotice({
        type: "success",
        text: `Successfully rolled back code to snapshot "${targetLabel}"!`,
      });
      setTimeout(() => setSnapshotNotice(null), 4000);
      await fetchSnapshots(true);
      await fetchGitStatus(true);
      onSync?.();
    } catch (err) {
      setSnapshotNotice({
        type: "error",
        text: err.message || "Failed to restore snapshot",
      });
      setTimeout(() => setSnapshotNotice(null), 5000);
    } finally {
      setRestoring(false);
    }
  };

  const handleGlobalRefresh = async () => {
    await Promise.all([fetchGitStatus(true), fetchBranches(), fetchSnapshots(true)]);
    if (activeTab === "git" && gitSubTab === "history") fetchCommitLog();
  };

  /* ───────────────────────────────────────────────────────────
   * Derived Totals
   * ────────────────────────────────────────────────────────── */
  const stagedCount = gitStatus?.staged?.length || 0;
  const unstagedCount = gitStatus?.unstaged?.length || 0;
  const untrackedCount = gitStatus?.untracked?.length || 0;
  const totalGitChanges = stagedCount + unstagedCount + untrackedCount;

  const filteredSnapshots = snapshots.filter((snap) => {
    if (!snapshotSearch.trim()) return true;
    const term = snapshotSearch.toLowerCase();
    return (
      (snap.label && snap.label.toLowerCase().includes(term)) ||
      (snap.message && snap.message.toLowerCase().includes(term)) ||
      (snap.id && snap.id.toLowerCase().includes(term))
    );
  });
  const currentSnapshot = snapshots.find((s) => s.isCurrent) || snapshots[0];

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--color-bg)] select-none">
      {/* ── Top Workspace Header ───────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
            <GitBranch size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[var(--color-text)] font-sans">
                Version Control
              </h1>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                Unified
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Source control synchronization, Git branches & commits, and project checkpoints
            </p>
          </div>
        </div>

        {/* Global Toolbar */}
        <div className="flex items-center gap-2">
          {gitStatus?.hasGit && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-text-secondary)]">
              <GitBranch size={12} className="text-[var(--color-primary)]" />
              <span>{branches.current || "main"}</span>
            </div>
          )}

          {currentSnapshot && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
              <Layers size={12} className="text-[var(--color-primary)]" />
              <span className="truncate max-w-[130px] font-medium">
                {currentSnapshot.label || `Snap #${currentSnapshot.id.slice(0, 6)}`}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleGlobalRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)] transition-colors cursor-pointer"
            title="Refresh Version Control status"
          >
            <RefreshCw
              size={13}
              className={loadingGit || loadingSnapshots ? "animate-spin text-[var(--color-primary)]" : ""}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Segmented Main Tabs ─────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 pt-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("git")}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === "git"
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
          }`}
        >
          <GithubIcon size={14} />
          <span>Git & GitHub Repository</span>
          {totalGitChanges > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/30">
              {totalGitChanges}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("snapshots")}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === "snapshots"
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
          }`}
        >
          <Layers size={14} />
          <span>Snapshots & Checkpoints</span>
          {snapshots.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
              {snapshots.length}
            </span>
          )}
        </button>
      </div>

      {/* Notice Banner */}
      <AnimatePresence>
        {(gitNotice || snapshotNotice) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`px-6 py-2 text-xs flex items-center justify-between font-medium border-b ${
              (gitNotice?.type === "error" || snapshotNotice?.type === "error")
                ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/25"
                : "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/25"
            }`}
          >
            <div className="flex items-center gap-2">
              {(gitNotice?.type === "error" || snapshotNotice?.type === "error") ? (
                <AlertCircle size={14} />
              ) : (
                <CheckCircle2 size={14} />
              )}
              <span>{gitNotice?.text || snapshotNotice?.text}</span>
            </div>
            <button
              onClick={() => {
                setGitNotice(null);
                setSnapshotNotice(null);
              }}
              className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Content View Area ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {/* =================================================== */}
        {/* TAB 1: GIT & GITHUB REPOSITORY                      */}
        {/* =================================================== */}
        {activeTab === "git" && (
          <div>
            {!gitStatus?.hasGit ? (
              <div className="flex flex-col items-center justify-center p-12 text-center border border-[var(--color-border)] rounded-[var(--radius-lg)] bg-[var(--color-surface)] max-w-xl mx-auto my-8">
                <div className="w-12 h-12 rounded-full bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] mb-4">
                  <FolderGit2 size={24} />
                </div>
                <h3 className="text-base font-semibold text-[var(--color-text)]">
                  {gitStatus?.isGitHubProject || gitStatus?.repoUrl
                    ? "Reconnecting Git Repository..."
                    : "Git Repository Not Initialized"}
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 max-w-md leading-relaxed">
                  {gitStatus?.isGitHubProject || gitStatus?.repoUrl
                    ? `This project is linked to GitHub repository (${gitStatus?.repoUrl || "remote"}). Reconnecting and syncing local Git state...`
                    : "This project was imported from a file upload without a local Git repository. You can initialize a local Git repo now to track branches, commit history, and connect to GitHub."}
                </p>
                <button
                  type="button"
                  disabled={gitActionLoading || !projectAccess.can("files.write")}
                  onClick={handleInitRepo}
                  className="mt-5 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-semibold cursor-pointer border-0 shadow-sm transition-colors flex items-center gap-2"
                >
                  {gitActionLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span>
                    {gitActionLoading
                      ? "Connecting Git..."
                      : gitStatus?.isGitHubProject || gitStatus?.repoUrl
                      ? "Connect & Sync Git"
                      : "Initialize Git Repository"}
                  </span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {/* Git Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
                  {/* Branch selector */}
                  <div className="relative" ref={branchMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowBranchMenu(!showBranchMenu)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/50 border border-[var(--color-border)] text-xs font-mono font-medium text-[var(--color-text)] transition-colors cursor-pointer"
                    >
                      <GitBranch size={13} className="text-[var(--color-primary)]" />
                      <span>{branches.current || "main"}</span>
                      <ChevronDown size={12} className="text-[var(--color-text-muted)] ml-1" />
                    </button>

                    {showBranchMenu && (
                      <div className="absolute left-0 top-full mt-1.5 z-40 w-64 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-xl p-2 text-xs font-sans">
                        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[var(--color-border)]">
                          <span className="text-[11px] font-bold uppercase text-[var(--color-text-secondary)]">
                            Switch Branch
                          </span>
                          <button
                            type="button"
                            onClick={() => setCreatingBranch(!creatingBranch)}
                            className="text-[11px] text-[var(--color-primary)] hover:underline cursor-pointer flex items-center gap-1"
                          >
                            <Plus size={11} /> New
                          </button>
                        </div>

                        {creatingBranch && (
                          <div className="mb-2 p-1.5 bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                            <input
                              type="text"
                              value={newBranchName}
                              onChange={(e) => setNewBranchName(e.target.value)}
                              placeholder="branch-name"
                              className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text)] outline-none font-mono"
                              onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
                            />
                            <div className="flex items-center justify-end gap-1.5 mt-1.5">
                              <button
                                type="button"
                                onClick={() => setCreatingBranch(false)}
                                className="px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={handleCreateBranch}
                                className="px-2 py-0.5 text-[10px] bg-[var(--color-primary)] text-white rounded cursor-pointer"
                              >
                                Create
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {(branches.local || []).map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => handleSwitchBranch(b)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-sm)] text-left cursor-pointer transition-colors ${
                                b === branches.current
                                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold"
                                  : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                              }`}
                            >
                              <span className="font-mono truncate">{b}</span>
                              {b === branches.current && <Check size={12} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Remote info & sync buttons */}
                  <div className="flex items-center gap-2">
                    {gitStatus?.repoUrl && (
                      <a
                        href={gitStatus.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                      >
                        <GithubIcon size={13} />
                        <span className="truncate max-w-[160px]">
                          {gitStatus.repoUrl.replace("https://github.com/", "")}
                        </span>
                        <ExternalLink size={11} className="opacity-60" />
                      </a>
                    )}

                    <button
                      type="button"
                      disabled={pulling || gitActionLoading}
                      onClick={handlePull}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/50 border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)] transition-colors cursor-pointer"
                      title="Pull latest commits from remote"
                    >
                      <ArrowDown size={13} className={pulling ? "animate-bounce" : ""} />
                      <span>{pulling ? "Pulling..." : "Pull"}</span>
                    </button>

                    <button
                      type="button"
                      disabled={pushing || gitActionLoading}
                      onClick={handlePush}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/50 border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)] transition-colors cursor-pointer"
                      title="Push committed changes to remote"
                    >
                      <ArrowUp size={13} className={pushing ? "animate-bounce" : ""} />
                      <span>{pushing ? "Pushing..." : "Push"}</span>
                    </button>
                  </div>
                </div>

                {/* 2-Column Grid: Left = Changes & Commit; Right = Diff & Log */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left Column (5 cols): Commit & Changes List */}
                  <div className="lg:col-span-5 flex flex-col gap-4">
                    {/* Commit Input Box */}
                    <div className="p-3.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5">
                          <GitCommit size={14} className="text-[var(--color-primary)]" />
                          Commit Changes
                        </span>
                        {stagedCount > 0 && (
                          <span className="text-[10px] font-bold text-[var(--color-success)] bg-[var(--color-success)]/10 px-1.5 py-0.5 rounded border border-[var(--color-success)]/20">
                            {stagedCount} staged
                          </span>
                        )}
                      </div>

                      <textarea
                        rows={3}
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Commit message (e.g. feat: add integration test suite)"
                        className="w-full p-2 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] font-sans resize-none"
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            if (!committing && commitMessage.trim() && totalGitChanges > 0 && projectAccess.can("files.write")) {
                              handleCommit();
                            }
                          }
                        }}
                      />

                      <div className="flex items-center justify-between mt-2.5">
                        <span className="text-[11px] text-[var(--color-text-muted)]">
                          Ctrl+Enter to commit
                        </span>
                        <button
                          type="button"
                          disabled={
                            committing ||
                            !commitMessage.trim() ||
                            totalGitChanges === 0 ||
                            !projectAccess.can("files.write")
                          }
                          onClick={handleCommit}
                          className="px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-40 text-white text-xs font-semibold cursor-pointer border-0 transition-colors flex items-center gap-1.5"
                          title={
                            !projectAccess.can("files.write")
                              ? "You do not have write permissions"
                              : totalGitChanges === 0
                              ? "No changes to commit"
                              : !commitMessage.trim()
                              ? "Enter a commit message"
                              : "Commit changes to repository"
                          }
                        >
                          {committing ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Check size={13} />
                          )}
                          <span>
                            {committing
                              ? "Committing..."
                              : stagedCount > 0
                              ? `Commit to ${branches.current || "main"}`
                              : `Stage All & Commit to ${branches.current || "main"}`}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Staged Changes Group */}
                    <div className="p-3.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border)]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wider">
                            Staged Changes
                          </span>
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[var(--color-success)]/15 text-[var(--color-success)]">
                            {stagedCount}
                          </span>
                        </div>
                        {stagedCount > 0 && (
                          <button
                            type="button"
                            onClick={handleUnstageAll}
                            className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:underline cursor-pointer"
                          >
                            Unstage All
                          </button>
                        )}
                      </div>

                      {stagedCount === 0 ? (
                        <p className="text-xs text-[var(--color-text-muted)] italic py-2">
                          No changes staged for commit
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {gitStatus.staged.map((f) => {
                            const badge = getStatusBadge(f.status);
                            const isSelected = selectedDiffFile?.path === f.path && selectedDiffFile?.staged;
                            return (
                              <div
                                key={f.path}
                                onClick={() => loadDiff(f.path, true)}
                                className={`group flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-sm)] cursor-pointer text-xs transition-colors ${
                                  isSelected
                                    ? "bg-[var(--color-primary)]/10 border-l-2 border-[var(--color-primary)]"
                                    : "hover:bg-[var(--color-surface-secondary)]"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`px-1 py-0.2 text-[9px] font-bold rounded font-mono ${badge.color}`}>
                                    {badge.label}
                                  </span>
                                  <span className="font-mono text-[var(--color-text)] truncate text-[11px]">
                                    {f.path}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  title="Unstage file"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnstageFile(f.path);
                                  }}
                                  className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded cursor-pointer border-0 bg-transparent"
                                >
                                  <Minus size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Unstaged & Untracked Changes Group */}
                    <div className="p-3.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border)]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wider">
                            Changes
                          </span>
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                            {unstagedCount + untrackedCount}
                          </span>
                        </div>
                        {(unstagedCount > 0 || untrackedCount > 0) && (
                          <button
                            type="button"
                            onClick={handleStageAll}
                            className="text-[11px] text-[var(--color-primary)] hover:underline cursor-pointer font-medium"
                          >
                            Stage All
                          </button>
                        )}
                      </div>

                      {unstagedCount === 0 && untrackedCount === 0 ? (
                        <div className="flex items-center gap-2 py-3 text-xs text-[var(--color-success)]">
                          <CheckCircle2 size={15} />
                          <span>Working tree clean. No local modifications.</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {/* Unstaged */}
                          {(gitStatus.unstaged || []).map((f) => {
                            const badge = getStatusBadge(f.status);
                            const isSelected = selectedDiffFile?.path === f.path && !selectedDiffFile?.staged;
                            return (
                              <div
                                key={f.path}
                                onClick={() => loadDiff(f.path, false)}
                                className={`group flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-sm)] cursor-pointer text-xs transition-colors ${
                                  isSelected
                                    ? "bg-[var(--color-primary)]/10 border-l-2 border-[var(--color-primary)]"
                                    : "hover:bg-[var(--color-surface-secondary)]"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`px-1 py-0.2 text-[9px] font-bold rounded font-mono ${badge.color}`}>
                                    {badge.label}
                                  </span>
                                  <span className="font-mono text-[var(--color-text)] truncate text-[11px]">
                                    {f.path}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    title="Discard changes"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDiscard(f.path, false);
                                    }}
                                    className="p-1 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 rounded cursor-pointer border-0 bg-transparent"
                                  >
                                    <RotateCcw size={11} />
                                  </button>
                                  <button
                                    type="button"
                                    title="Stage file"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStageFile(f.path);
                                    }}
                                    className="p-1 text-[var(--color-success)] hover:bg-[var(--color-success)]/15 rounded cursor-pointer border-0 bg-transparent"
                                  >
                                    <Plus size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}

                          {/* Untracked */}
                          {(gitStatus.untracked || []).map((f) => {
                            const badge = getStatusBadge("U");
                            const isSelected = selectedDiffFile?.path === f.path && !selectedDiffFile?.staged;
                            return (
                              <div
                                key={f.path}
                                onClick={() => loadDiff(f.path, false)}
                                className={`group flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-sm)] cursor-pointer text-xs transition-colors ${
                                  isSelected
                                    ? "bg-[var(--color-primary)]/10 border-l-2 border-[var(--color-primary)]"
                                    : "hover:bg-[var(--color-surface-secondary)]"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`px-1 py-0.2 text-[9px] font-bold rounded font-mono ${badge.color}`}>
                                    {badge.label}
                                  </span>
                                  <span className="font-mono text-[var(--color-text)] truncate text-[11px]">
                                    {f.path}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    title="Delete untracked file"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDiscard(f.path, true);
                                    }}
                                    className="p-1 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 rounded cursor-pointer border-0 bg-transparent"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                  <button
                                    type="button"
                                    title="Stage file"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStageFile(f.path);
                                    }}
                                    className="p-1 text-[var(--color-success)] hover:bg-[var(--color-success)]/15 rounded cursor-pointer border-0 bg-transparent"
                                  >
                                    <Plus size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column (7 cols): Diff Viewer & Commit History */}
                  <div className="lg:col-span-7 flex flex-col p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
                    {/* Sub-tabs */}
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--color-border)]">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setGitSubTab("diff")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold cursor-pointer transition-colors ${
                            gitSubTab === "diff"
                              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20"
                              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-transparent"
                          }`}
                        >
                          <FileText size={13} />
                          <span>Diff Viewer</span>
                          {selectedDiffFile && (
                            <span className="font-mono text-[10px] opacity-75">
                              ({selectedDiffFile.path.split("/").pop()})
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setGitSubTab("history")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold cursor-pointer transition-colors ${
                            gitSubTab === "history"
                              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20"
                              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-transparent"
                          }`}
                        >
                          <History size={13} />
                          <span>Commit History</span>
                          {commitLog.length > 0 && (
                            <span className="font-mono text-[10px] opacity-75">
                              ({commitLog.length})
                            </span>
                          )}
                        </button>
                      </div>

                      {gitSubTab === "history" && (
                        <button
                          type="button"
                          onClick={fetchCommitLog}
                          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded cursor-pointer border-0 bg-transparent"
                          title="Refresh commit log"
                        >
                          <RefreshCw size={12} className={loadingLog ? "animate-spin" : ""} />
                        </button>
                      )}
                    </div>

                    {/* Diff View */}
                    {gitSubTab === "diff" && (
                      <div className="flex-1 flex flex-col min-h-[380px]">
                        {!selectedDiffFile ? (
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[var(--color-text-muted)] text-xs">
                            <FileText size={32} className="opacity-40 mb-2" />
                            <p className="font-medium text-[var(--color-text-secondary)]">
                              No file selected
                            </p>
                            <p className="mt-1 max-w-xs">
                              Click on any staged or unstaged file from the changes list to view its line-by-line diff.
                            </p>
                          </div>
                        ) : loadingDiff ? (
                          <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--color-text-muted)]">
                            <RefreshCw size={16} className="animate-spin text-[var(--color-primary)] mr-2" />
                            Loading file diff...
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col">
                            <div className="flex items-center justify-between pb-2 mb-2 font-mono text-xs text-[var(--color-text-secondary)]">
                              <span className="font-semibold text-[var(--color-text)]">
                                {selectedDiffFile.path}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                                {selectedDiffFile.staged ? "Staged" : "Working Tree"}
                              </span>
                            </div>
                            <pre className="flex-1 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px] leading-relaxed overflow-x-auto overflow-y-auto max-h-[500px]">
                              {diffContent.split("\n").map((line, idx) => {
                                let bg = "transparent";
                                let color = "text-[var(--color-text)]";
                                if (line.startsWith("+") && !line.startsWith("+++")) {
                                  bg = "rgba(22, 163, 74, 0.12)";
                                  color = "text-[var(--color-success)]";
                                } else if (line.startsWith("-") && !line.startsWith("---")) {
                                  bg = "rgba(220, 38, 38, 0.12)";
                                  color = "text-[var(--color-danger)]";
                                } else if (line.startsWith("@@")) {
                                  color = "text-[var(--color-primary)] font-bold";
                                  bg = "var(--color-surface-secondary)";
                                }
                                return (
                                  <div key={idx} style={{ backgroundColor: bg }} className={`${color} px-1.5 py-0.2 rounded`}>
                                    {line || " "}
                                  </div>
                                );
                              })}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Commit History View */}
                    {gitSubTab === "history" && (
                      <div className="flex-1 min-h-[380px] overflow-y-auto space-y-2">
                        {loadingLog && commitLog.length === 0 ? (
                          <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
                            <RefreshCw size={16} className="animate-spin text-[var(--color-primary)] mx-auto mb-2" />
                            Loading commit history...
                          </div>
                        ) : commitLog.length === 0 ? (
                          <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
                            No commits found in this repository yet.
                          </div>
                        ) : (
                          commitLog.map((c) => (
                            <div
                              key={c.hash}
                              className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/40 transition-colors text-xs"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-mono text-[11px] font-bold text-[var(--color-primary)]">
                                  {c.hash.slice(0, 7)}
                                </span>
                                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                                  {new Date(c.date).toLocaleDateString()} {new Date(c.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="font-medium text-[var(--color-text)] text-xs leading-snug">
                                {c.message}
                              </p>
                              <div className="flex items-center gap-2 mt-2 text-[11px] text-[var(--color-text-muted)]">
                                <span>{c.author_name}</span>
                                {c.refs && (
                                  <span className="px-1.5 py-0.2 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] font-mono text-[10px]">
                                    {c.refs}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================== */}
        {/* TAB 2: ZIP SNAPSHOTS & CHECKPOINTS                  */}
        {/* =================================================== */}
        {activeTab === "snapshots" && (
          <div className="flex flex-col gap-6">
            {/* Explanatory Banner */}
            <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center shrink-0 mt-0.5">
                  <BookmarkPlus size={18} />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                    Code Snapshots & Checkpoints
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 max-w-2xl leading-relaxed">
                    Snapshots capture frozen, point-in-time checkpoints of your workspace.
                    You can inspect previous versions and restore your workspace back to any checkpoint instantly.
                  </p>
                </div>
              </div>

              {/* Snapshot Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={creatingSnapshot || !projectAccess.can("files.write")}
                  onClick={() => setShowCreateSnapshotModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-semibold cursor-pointer border-0 shadow-sm transition-colors"
                >
                  <Plus size={13} />
                  <span>Capture Checkpoint</span>
                </button>
              </div>
            </div>

            {/* Main Snapshots Layout */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* Left Column (8 cols): Snapshot List & Search */}
              <div className="xl:col-span-8 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <History size={15} className="text-[var(--color-primary)]" />
                    <h2 className="text-sm font-bold text-[var(--color-text)]">
                      Snapshot Timeline ({filteredSnapshots.length})
                    </h2>
                  </div>

                  <div className="flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] w-60">
                    <Search size={13} className="text-[var(--color-text-muted)]" />
                    <input
                      type="text"
                      placeholder="Search checkpoints..."
                      value={snapshotSearch}
                      onChange={(e) => setSnapshotSearch(e.target.value)}
                      className="bg-transparent border-none text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none w-full font-sans"
                    />
                    {snapshotSearch && (
                      <button
                        onClick={() => setSnapshotSearch("")}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs cursor-pointer border-0 bg-transparent"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Loading Skeletons */}
                {loadingSnapshots && snapshots.length === 0 && (
                  <SnapshotsListSkeleton count={3} />
                )}

                {/* Empty State */}
                {!loadingSnapshots && filteredSnapshots.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] p-10 text-center bg-[var(--color-surface)] border border-[var(--color-border)]">
                    <BookmarkPlus size={28} className="text-[var(--color-text-muted)] mb-2" />
                    <p className="text-sm font-semibold text-[var(--color-text)]">
                      No snapshots found
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-sm">
                      Upload a new project ZIP archive or capture your current workspace state as a safe restore point.
                    </p>
                    <button
                      onClick={() => setShowCreateSnapshotModal(true)}
                      className="mt-3.5 px-4 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold cursor-pointer border-0"
                    >
                      Capture First Checkpoint
                    </button>
                  </div>
                )}

                {/* Snapshot Cards */}
                <div className="flex flex-col gap-3">
                  {filteredSnapshots.map((snap, idx) => {
                    const isCurrent = snap.isCurrent;
                    return (
                      <div
                        key={snap.id}
                        className={`relative rounded-[var(--radius-lg)] overflow-hidden flex flex-col p-4 bg-[var(--color-surface)] border transition-all ${
                          isCurrent
                            ? "border-[var(--color-primary)] shadow-sm"
                            : "border-[var(--color-border)] hover:border-[var(--color-border)]/80"
                        }`}
                      >
                        {/* Left Active Stripe */}
                        {isCurrent && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-primary)]" />
                        )}

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2.5">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center shrink-0 border ${
                                isCurrent
                                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30"
                                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                              }`}
                            >
                              <BookmarkPlus size={15} />
                            </div>

                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-xs font-bold text-[var(--color-text)]">
                                  {snap.label || "Workspace Checkpoint"}
                                </h3>
                                {isCurrent && (
                                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-bold bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/25">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                                    ACTIVE VERSION
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                                {snap.message || "Manual code snapshot point"}
                              </p>
                            </div>
                          </div>

                          {/* Rollback Action */}
                          <div>
                            {!isCurrent ? (
                              <button
                                type="button"
                                disabled={restoring || !projectAccess.can("snapshot.restore")}
                                onClick={() => setConfirmRestoreSnapshot(snap)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold bg-[var(--color-surface-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] border border-[var(--color-border)] text-[var(--color-text)] transition-colors cursor-pointer"
                                title="Revert workspace code to this checkpoint"
                              >
                                <RotateCcw size={12} />
                                <span>Rollback to this</span>
                              </button>
                            ) : (
                              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                                Current Active
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Snapshot Metadata Row */}
                        <div className="flex flex-wrap items-center gap-4 text-xs pt-2.5 border-t border-[var(--color-border)] text-[var(--color-text-muted)] font-mono">
                          <div className="flex items-center gap-1.5">
                            <Clock size={12} />
                            <span>{new Date(snap.createdAt).toLocaleString()}</span>
                          </div>
                          {snap.source && (
                            <div className="flex items-center gap-1.5">
                              <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                                {snap.source}
                              </span>
                            </div>
                          )}
                          {snap.filesCount !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <FileText size={12} />
                              <span>{snap.filesCount} files</span>
                            </div>
                          )}
                          {snap.storageSize && (
                            <div className="flex items-center gap-1.5">
                              <HardDrive size={12} />
                              <span>{snap.storageSize}</span>
                            </div>
                          )}
                          <div className="ml-auto text-[10px] opacity-60">
                            #{snap.id.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column (4 cols): Active Snapshot Stats & Info */}
              <div className="xl:col-span-4 flex flex-col gap-4">
                {/* Active Snapshot Card */}
                {currentSnapshot && (
                  <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-primary)]/40 rounded-[var(--radius-lg)]">
                    <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--color-border)]">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]">
                        Current Active Snapshot
                      </span>
                      <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-[var(--color-text-secondary)] text-[11px]">Label</span>
                        <p className="font-semibold text-[var(--color-text)]">
                          {currentSnapshot.label || "Default Snapshot"}
                        </p>
                      </div>

                      <div>
                        <span className="text-[var(--color-text-secondary)] text-[11px]">Snapshot ID</span>
                        <p className="font-mono text-[11px] text-[var(--color-text-secondary)] truncate">
                          {currentSnapshot.id}
                        </p>
                      </div>

                      <div>
                        <span className="text-[var(--color-text-secondary)] text-[11px]">Source & Timestamp</span>
                        <p className="text-[var(--color-text)]">
                          {currentSnapshot.source || "ARCHIVE"} • {new Date(currentSnapshot.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      {currentSnapshot.rootDir && (
                        <div>
                          <span className="text-[var(--color-text-secondary)] text-[11px]">Storage Directory</span>
                          <p className="font-mono text-[11px] text-[var(--color-text-secondary)] truncate">
                            {currentSnapshot.rootDir}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Quick Info Box */}
                <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  <h4 className="font-bold text-[var(--color-text)] uppercase text-[11px] mb-2 flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-[var(--color-warning)]" />
                    Snapshot Safety & Rollback
                  </h4>
                  <p>
                    Rolling back to an earlier snapshot replaces the workspace files with that checkpoint.
                    All test analyses, coverage reports, and AST calculations will recalculate based on the restored snapshot.
                  </p>
                  <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                    Tip: Capture a new checkpoint before rolling back if you wish to preserve your current work.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Create Snapshot Modal ──────────────────────────── */}
      {showCreateSnapshotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md p-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-2xl text-xs font-sans">
            <div className="flex items-center gap-2 mb-3">
              <BookmarkPlus size={18} className="text-[var(--color-primary)]" />
              <h3 className="text-sm font-bold text-[var(--color-text)]">
                Capture Workspace Checkpoint
              </h3>
            </div>
            <p className="text-[var(--color-text-secondary)] mb-4 leading-relaxed">
              Create a frozen restore point of your current workspace files. You can roll back to this state at any time.
            </p>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--color-text)] mb-1">
                  Checkpoint Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. Before refactoring auth service"
                  value={newSnapshotLabel}
                  onChange={(e) => setNewSnapshotLabel(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--color-text)] mb-1">
                  Description / Message (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Brief note about the current changes or reason for this checkpoint"
                  value={newSnapshotMessage}
                  onChange={(e) => setNewSnapshotMessage(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateSnapshotModal(false)}
                className="px-3.5 py-1.5 rounded-[var(--radius-sm)] text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creatingSnapshot}
                onClick={handleCreateSnapshot}
                className="px-4 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-semibold cursor-pointer border-0 transition-colors"
              >
                {creatingSnapshot ? "Capturing..." : "Capture Checkpoint"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Restore Snapshot Confirmation Dialog ─────────────── */}
      <ConfirmDialog
        isOpen={Boolean(confirmRestoreSnapshot)}
        onClose={() => setConfirmRestoreSnapshot(null)}
        onConfirm={handleConfirmRestore}
        title="Rollback Workspace to Snapshot?"
        message={`Are you sure you want to rollback to "${confirmRestoreSnapshot?.label || confirmRestoreSnapshot?.id?.slice(0, 8)}"? Current uncommitted changes in your workspace will be replaced.`}
        confirmText="Rollback Code"
        variant="danger"
        loading={restoring}
      />
    </div>
  );
}

