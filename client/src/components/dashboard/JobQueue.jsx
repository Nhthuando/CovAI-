/* eslint-disable no-unused-vars */
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  PackageOpen,
  TestTube2,
  Wrench,
  BrainCircuit,
  Ban,
  Layers,
  RotateCcw,
  History,
  BookmarkPlus,
  Calendar,
  FileCode2,
  HardDrive,
  Sparkles,
  AlertCircle,
  Search,
  Check,
  Tag,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { getUserJobsApi, cancelJobApi } from "../../services/job.service";
import {
  getProjectSnapshotsApi,
  createProjectSnapshotApi,
  restoreProjectSnapshotApi,
} from "../../services/project.service";
import { SnapshotsListSkeleton, JobsListSkeleton } from "../common/Skeleton";

/* ── Helpers: map backend enums to UI props ────────────────── */

const JOB_TYPE_CONFIG = {
  INGEST: {
    label: "Source Ingest",
    icon: PackageOpen,
    taskLabel: "Extracting and indexing source files",
  },
  INSTALL_DEPS: {
    label: "Install Deps",
    icon: Wrench,
    taskLabel: "Installing project dependencies",
  },
  RUN_TESTS: {
    label: "Run Tests",
    icon: TestTube2,
    taskLabel: "Running test suite with coverage",
  },
  SUPERTEST_COVERAGE: {
    label: "Supertest Coverage",
    icon: TestTube2,
    taskLabel: "Running Supertest integration coverage",
  },
  PARSE_COVERAGE: {
    label: "Parse Coverage",
    icon: Activity,
    taskLabel: "Parsing coverage report data",
  },
  BUILD_CFG: {
    label: "Build CFG",
    icon: Cpu,
    taskLabel: "Building control flow graphs",
  },
  AI_SUGGEST: {
    label: "AI Suggest",
    icon: BrainCircuit,
    taskLabel: "Generating AI improvement suggestions",
  },
  AI_TESTS: {
    label: "AI Tests",
    icon: BrainCircuit,
    taskLabel: "Generating AI test cases",
  },
  CODE_HYGIENE: {
    label: "Code Hygiene",
    icon: Activity,
    taskLabel: "Analyzing code hygiene and quality",
  },
  PERFORMANCE_ANALYSIS: {
    label: "Performance",
    icon: Activity,
    taskLabel: "Analyzing performance metrics",
  },
  ANALYSIS: {
    label: "Project Analysis",
    icon: Activity,
    taskLabel: "Analyzing project structure",
  },
  QUALITY_ANALYSIS: {
    label: "Quality Analysis",
    icon: Activity,
    taskLabel: "Evaluating AI generated tests",
  },
  SECURITY_ANALYSIS: {
    label: "Security Analysis",
    icon: Activity,
    taskLabel: "Scanning for security vulnerabilities",
  },
  RUN_VITEST_TESTS: {
    label: "Run Vitest",
    icon: TestTube2,
    taskLabel: "Running Vitest test suite",
  },
  VITEST_COVERAGE: {
    label: "Vitest Coverage",
    icon: TestTube2,
    taskLabel: "Running Vitest coverage",
  },
  SYSTEM_TEST_ANALYSIS: {
    label: "System Test Analysis",
    icon: Cpu,
    taskLabel: "Analyzing E2E tests",
  },
  CYPRESS_SYSTEM_TEST: {
    label: "Cypress System Test",
    icon: TestTube2,
    taskLabel: "Running Cypress E2E tests",
  },
  CYPRESS_SYSTEM_COVERAGE: {
    label: "Cypress Coverage",
    icon: TestTube2,
    taskLabel: "Running Cypress E2E coverage",
  },
  PLAYWRIGHT_SYSTEM_TEST: {
    label: "Playwright System Test",
    icon: TestTube2,
    taskLabel: "Running Playwright E2E tests",
  },
  PLAYWRIGHT_SYSTEM_COVERAGE: {
    label: "Playwright Coverage",
    icon: TestTube2,
    taskLabel: "Running Playwright E2E coverage",
  },
};

const JOB_STATUS_CONFIG = {
  QUEUED: {
    label: "QUEUED",
    color: "var(--color-warning)",
    bg: "rgba(217, 119, 6, 0.12)",
    border: "rgba(217, 119, 6, 0.25)",
    icon: Clock,
  },
  RUNNING: {
    label: "RUNNING",
    color: "var(--color-info)",
    bg: "rgba(2, 132, 199, 0.12)",
    border: "rgba(2, 132, 199, 0.25)",
    icon: Activity,
  },
  SUCCESS: {
    label: "COMPLETED",
    color: "var(--color-success)",
    bg: "rgba(22, 163, 74, 0.12)",
    border: "rgba(22, 163, 74, 0.25)",
    icon: CheckCircle2,
  },
  FAILED: {
    label: "FAILED",
    color: "var(--color-danger)",
    bg: "rgba(220, 38, 38, 0.12)",
    border: "rgba(220, 38, 38, 0.25)",
    icon: XCircle,
  },
  CANCELED: {
    label: "CANCELED",
    color: "var(--color-text-muted)",
    bg: "rgba(100, 116, 139, 0.12)",
    border: "rgba(100, 116, 139, 0.25)",
    icon: Ban,
  },
};

function getJobVisual(job) {
  const typeConf = JOB_TYPE_CONFIG[job.type] || JOB_TYPE_CONFIG.INGEST;
  const statusConf = JOB_STATUS_CONFIG[job.status] || JOB_STATUS_CONFIG.QUEUED;

  return {
    color: statusConf.color,
    bg: statusConf.bg,
    border: statusConf.border,
    Icon: typeConf.icon,
    typeLabel: typeConf.label,
    taskLabel: typeConf.taskLabel,
    statusLabel: statusConf.label,
  };
}

/* ── Polling intervals (ms) ───────────────────────────── */
const POLL_FAST = 3000;
const POLL_SLOW = 15000;

/* ── Component ─────────────────────────────────────────────── */
export default function JobQueue({ projectId, onSync }) {
  // Main view mode: "snapshots" | "jobs"
  const [activeTab, setActiveTab] = useState("snapshots");

  /* ── Snapshot State ──────────────────────────────────────── */
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [errorSnapshots, setErrorSnapshots] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [confirmRestoreSnapshot, setConfirmRestoreSnapshot] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [snapshotSearch, setSnapshotSearch] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState(null);

  /* ── Job Queue State ─────────────────────────────────────── */
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [errorJobs, setErrorJobs] = useState(null);
  const [filterJobs, setFilterJobs] = useState("ALL"); // ALL | ACTIVE | COMPLETED
  const [cancelingJobId, setCancelingJobId] = useState(null);
  const intervalRef = useRef(null);

  const handleCancelJob = async (jobId) => {
    try {
      setCancelingJobId(jobId);
      await cancelJobApi(jobId);
      await fetchJobs(true);
    } catch (err) {
      setErrorJobs(err.message || "Failed to cancel job");
    } finally {
      setCancelingJobId(null);
    }
  };

  // Fetch snapshots
  const fetchSnapshots = useCallback(
    async (silent = false) => {
      if (!projectId) return;
      if (!silent) setLoadingSnapshots(true);
      setErrorSnapshots(null);
      try {
        const res = await getProjectSnapshotsApi(projectId);
        setSnapshots(res.data || []);
      } catch (err) {
        setErrorSnapshots(err.message || "Failed to load snapshots");
      } finally {
        setLoadingSnapshots(false);
      }
    },
    [projectId],
  );

  // Fetch jobs
  const fetchJobs = useCallback(async (silent = false) => {
    if (!silent) setLoadingJobs(true);
    setErrorJobs(null);
    try {
      const data = await getUserJobsApi();
      const visibleJobs = (data.jobs || []).filter(
        (job) => !["PERFORMANCE_ANALYSIS", "CODE_HYGIENE"].includes(job.type),
      );
      setJobs(visibleJobs);
    } catch (err) {
      setErrorJobs(err.message);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchSnapshots();
    fetchJobs();

    intervalRef.current = setInterval(() => {
      fetchJobs(true);
    }, POLL_FAST);

    return () => clearInterval(intervalRef.current);
  }, [fetchSnapshots, fetchJobs]);

  // Adjust polling speed
  useEffect(() => {
    const hasActive = jobs.some((j) =>
      ["QUEUED", "RUNNING"].includes(j.status),
    );
    const interval = hasActive ? POLL_FAST : POLL_SLOW;

    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      fetchJobs(true);
    }, interval);

    return () => clearInterval(intervalRef.current);
  }, [jobs, fetchJobs]);

  // Refresh all
  const handleRefreshAll = async () => {
    await Promise.all([fetchSnapshots(), fetchJobs()]);
  };

  // Create snapshot handler
  const handleCreateSnapshot = async (e) => {
    e?.preventDefault();
    if (!projectId || creatingSnapshot) return;
    setCreatingSnapshot(true);
    try {
      const res = await createProjectSnapshotApi(projectId, {
        label: newLabel.trim() || undefined,
        message: newMessage.trim() || undefined,
      });
      setNewLabel("");
      setNewMessage("");
      setShowCreateModal(false);
      setFeedbackNotice({
        type: "success",
        text: `Snapshot "${res.data?.label || "Checkpoint"}" captured successfully!`,
      });
      setTimeout(() => setFeedbackNotice(null), 4000);
      await fetchSnapshots();
      await onSync?.();
    } catch (err) {
      setFeedbackNotice({
        type: "error",
        text: err.message || "Failed to create snapshot",
      });
      setTimeout(() => setFeedbackNotice(null), 5000);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  // Restore snapshot handler
  const handleConfirmRestore = async () => {
    if (!projectId || !confirmRestoreSnapshot || restoring) return;
    setRestoring(true);
    try {
      const targetLabel =
        confirmRestoreSnapshot.label || confirmRestoreSnapshot.id.slice(0, 8);
      const res = await restoreProjectSnapshotApi(
        projectId,
        confirmRestoreSnapshot.id,
      );
      setConfirmRestoreSnapshot(null);
      setFeedbackNotice({
        type: "success",
        text: `Successfully rolled back code to snapshot "${targetLabel}"!`,
      });
      setTimeout(() => setFeedbackNotice(null), 4000);
      await fetchSnapshots();
      await onSync?.();
    } catch (err) {
      setFeedbackNotice({
        type: "error",
        text: err.message || "Failed to restore snapshot",
      });
      setTimeout(() => setFeedbackNotice(null), 5000);
    } finally {
      setRestoring(false);
    }
  };

  // Derived jobs stats
  const activeJobs = jobs.filter((j) =>
    ["QUEUED", "RUNNING"].includes(j.status),
  );
  const completedJobs = jobs.filter((j) => j.status === "SUCCESS");
  const failedJobs = jobs.filter((j) => j.status === "FAILED");

  const filteredJobs =
    filterJobs === "ALL"
      ? jobs
      : filterJobs === "ACTIVE"
        ? activeJobs
        : jobs.filter((j) =>
            ["SUCCESS", "FAILED", "CANCELED"].includes(j.status),
          );

  const workerLoad =
    jobs.length > 0
      ? Math.round((activeJobs.length / Math.max(jobs.length, 1)) * 100)
      : 0;

  // Filtered snapshots
  const filteredSnapshots = snapshots.filter((snap) => {
    if (!snapshotSearch.trim()) return true;
    const term = snapshotSearch.toLowerCase();
    return (
      (snap.label && snap.label.toLowerCase().includes(term)) ||
      (snap.message && snap.message.toLowerCase().includes(term)) ||
      (snap.source && snap.source.toLowerCase().includes(term)) ||
      (snap.commitSha && snap.commitSha.toLowerCase().includes(term))
    );
  });

  const activeSnapshot = snapshots.find((s) => s.isCurrent) || snapshots[0];

  // Format helpers
  const formatDateTime = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDuration = (start, end) => {
    if (!start) return "—";
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    const diffMs = e - s;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${mins}m ${secs}s`;
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div
      className="flex flex-col w-full h-full overflow-y-auto custom-scrollbar"
      style={{
        background: "var(--color-bg)",
        color: "var(--color-text)",
        padding: "24px 32px",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Top Header ─────────────────────────────────────────── */}
      <div
        className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[var(--color-border)]"
        style={{ marginBottom: 20 }}
      >
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--color-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Pipelines & Version Hub
            </h1>
            <span
              className="px-2 py-0.5 rounded-[var(--radius-sm)] text-[11px] font-medium"
              style={{
                background: "var(--color-surface-secondary)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
              }}
            >
              Checkpoints & AI Queues
            </span>
          </div>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
            Capture project checkpoints, restore previous code versions, and
            monitor active test generation pipelines.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] font-medium text-xs cursor-pointer transition-colors"
            style={{
              background: "var(--color-primary)",
              color: "#ffffff",
              padding: "7px 14px",
              border: "1px solid transparent",
            }}
          >
            <BookmarkPlus size={14} />
            Create Snapshot
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRefreshAll}
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] text-xs font-medium cursor-pointer transition-colors hover:bg-[var(--color-surface-secondary)]"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
              padding: "7px 12px",
            }}
            title="Refresh Snapshots and Jobs"
          >
            <RefreshCw
              size={13}
              className={loadingSnapshots || loadingJobs ? "animate-spin" : ""}
            />
            Refresh
          </motion.button>
        </div>
      </div>

      {/* ── Feedback Notification ──────────────────────────────── */}
      <AnimatePresence>
        {feedbackNotice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 rounded-[var(--radius-md)] flex items-center justify-between px-3.5 py-2.5 text-xs font-medium"
            style={{
              background:
                feedbackNotice.type === "success"
                  ? "rgba(22, 163, 74, 0.12)"
                  : "rgba(220, 38, 38, 0.12)",
              border:
                feedbackNotice.type === "success"
                  ? "1px solid rgba(22, 163, 74, 0.25)"
                  : "1px solid rgba(220, 38, 38, 0.25)",
              color:
                feedbackNotice.type === "success"
                  ? "var(--color-success)"
                  : "var(--color-danger)",
            }}
          >
            <div className="flex items-center gap-2">
              {feedbackNotice.type === "success" ? (
                <CheckCircle2
                  size={15}
                  style={{ color: "var(--color-success)" }}
                />
              ) : (
                <AlertCircle
                  size={15}
                  style={{ color: "var(--color-danger)" }}
                />
              )}
              <span>{feedbackNotice.text}</span>
            </div>
            <button
              onClick={() => setFeedbackNotice(null)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer text-xs p-1"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab Switcher ───────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2.5"
        style={{ marginBottom: 20 }}
      >
        <button
          onClick={() => setActiveTab("snapshots")}
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-3.5 py-1.5 text-xs font-semibold cursor-pointer transition-colors"
          style={{
            background:
              activeTab === "snapshots"
                ? "var(--color-surface-secondary)"
                : "transparent",
            color:
              activeTab === "snapshots"
                ? "var(--color-text)"
                : "var(--color-text-muted)",
            border:
              activeTab === "snapshots"
                ? "1px solid var(--color-border)"
                : "1px solid transparent",
          }}
        >
          <Layers
            size={13}
            style={{
              color:
                activeTab === "snapshots"
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
            }}
          />
          <span>Code Snapshots & Checkpoints</span>
          <span
            className="rounded-full px-1.5 py-0.2 text-[10px] font-mono font-medium"
            style={{
              background:
                activeTab === "snapshots"
                  ? "rgba(109, 93, 251, 0.12)"
                  : "var(--color-surface-secondary)",
              color:
                activeTab === "snapshots"
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
            }}
          >
            {snapshots.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("jobs")}
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-3.5 py-1.5 text-xs font-semibold cursor-pointer transition-colors"
          style={{
            background:
              activeTab === "jobs"
                ? "var(--color-surface-secondary)"
                : "transparent",
            color:
              activeTab === "jobs"
                ? "var(--color-text)"
                : "var(--color-text-muted)",
            border:
              activeTab === "jobs"
                ? "1px solid var(--color-border)"
                : "1px solid transparent",
          }}
        >
          <Cpu
            size={13}
            style={{
              color:
                activeTab === "jobs"
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
            }}
          />
          <span>Pipelines & Job Queue</span>
          {activeJobs.length > 0 ? (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-semibold"
              style={{
                background: "rgba(2, 132, 199, 0.12)",
                color: "var(--color-info)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-info)]" />
              {activeJobs.length} active
            </span>
          ) : (
            <span
              className="rounded-full px-1.5 py-0.2 text-[10px] font-mono font-medium"
              style={{
                background: "var(--color-surface-secondary)",
                color: "var(--color-text-muted)",
              }}
            >
              {jobs.length}
            </span>
          )}
        </button>
      </div>

      {/* ── TAB 1: CODE SNAPSHOTS & CHECKPOINTS ────────────────── */}
      {activeTab === "snapshots" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left Column: Timeline & Checkpoint List */}
          <div className="xl:col-span-2 flex flex-col gap-4">
            {/* Search and count header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History size={15} style={{ color: "var(--color-primary)" }} />
                <h2
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  Snapshot History ({filteredSnapshots.length})
                </h2>
              </div>

              <div
                className="flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  width: 240,
                }}
              >
                <Search
                  size={13}
                  style={{ color: "var(--color-text-muted)" }}
                />
                <input
                  type="text"
                  placeholder="Search checkpoints..."
                  value={snapshotSearch}
                  onChange={(e) => setSnapshotSearch(e.target.value)}
                  className="bg-transparent border-none text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none w-full"
                />
                {snapshotSearch && (
                  <button
                    onClick={() => setSnapshotSearch("")}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Loading state */}
            {loadingSnapshots && snapshots.length === 0 && (
              <SnapshotsListSkeleton count={3} />
            )}

            {/* Error state */}
            {errorSnapshots && (
              <div
                className="rounded-[var(--radius-md)] flex items-center gap-2.5 p-3 text-xs"
                style={{
                  background: "rgba(220, 38, 38, 0.1)",
                  border: "1px solid rgba(220, 38, 38, 0.25)",
                  color: "var(--color-danger)",
                }}
              >
                <XCircle size={15} />
                {errorSnapshots}
              </div>
            )}

            {/* Empty state */}
            {!loadingSnapshots &&
              !errorSnapshots &&
              filteredSnapshots.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] p-10 text-center"
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <BookmarkPlus
                    size={28}
                    style={{ color: "var(--color-text-muted)" }}
                    className="mb-2.5"
                  />
                  <p
                    style={{
                      color: "var(--color-text)",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    No snapshots found
                  </p>
                  <p
                    style={{
                      color: "var(--color-text-secondary)",
                      fontSize: 12,
                      marginTop: 4,
                      maxWidth: 320,
                    }}
                  >
                    Click &quot;Create Snapshot&quot; to capture your current
                    code as a safe restore point.
                  </p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="mt-3 px-3.5 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold cursor-pointer"
                    style={{
                      background: "var(--color-primary)",
                      color: "#ffffff",
                      border: "none",
                    }}
                  >
                    Capture First Checkpoint
                  </button>
                </div>
              )}

            {/* Snapshot Cards Timeline */}
            <div className="flex flex-col gap-3">
              <AnimatePresence mode="popLayout">
                {filteredSnapshots.map((snap, idx) => {
                  const isCurrent = snap.isCurrent;

                  return (
                    <motion.div
                      key={snap.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ delay: idx * 0.03, duration: 0.25 }}
                      className="relative rounded-[var(--radius-lg)] overflow-hidden flex flex-col transition-all"
                      style={{
                        background: "var(--color-surface)",
                        border: isCurrent
                          ? "1px solid var(--color-primary)"
                          : "1px solid var(--color-border)",
                        padding: "16px 20px",
                      }}
                    >
                      {/* Left Accent Stripe */}
                      <div
                        className="absolute left-0 top-0 bottom-0"
                        style={{
                          width: 3,
                          background: isCurrent
                            ? "var(--color-primary)"
                            : "transparent",
                        }}
                      />

                      {/* Header Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2.5">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] flex-shrink-0"
                            style={{
                              background: isCurrent
                                ? "rgba(109, 93, 251, 0.12)"
                                : "var(--color-surface-secondary)",
                              border: isCurrent
                                ? "1px solid rgba(109, 93, 251, 0.3)"
                                : "1px solid var(--color-border)",
                              color: isCurrent
                                ? "var(--color-primary)"
                                : "var(--color-text-secondary)",
                            }}
                          >
                            <BookmarkPlus size={15} />
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <h3
                                style={{
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: "var(--color-text)",
                                }}
                              >
                                {snap.label}
                              </h3>
                              {isCurrent && (
                                <span
                                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-bold"
                                  style={{
                                    background: "rgba(22, 163, 74, 0.12)",
                                    color: "var(--color-success)",
                                    border: "1px solid rgba(22, 163, 74, 0.25)",
                                  }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                                  ACTIVE VERSION
                                </span>
                              )}
                            </div>
                            <p
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-secondary)",
                                marginTop: 2,
                              }}
                            >
                              {snap.message || "Manual code checkpoint"}
                            </p>
                          </div>
                        </div>

                        {/* Action: Restore Button */}
                        <div className="flex items-center gap-2 self-start sm:self-center">
                          {!isCurrent ? (
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => setConfirmRestoreSnapshot(snap)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold cursor-pointer transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                              style={{
                                background: "var(--color-surface-secondary)",
                                color: "var(--color-text)",
                                border: "1px solid var(--color-border)",
                              }}
                              title="Revert code to this checkpoint"
                            >
                              <RotateCcw size={12} />
                              <span>Rollback to this</span>
                            </motion.button>
                          ) : (
                            <span
                              className="text-[11px] font-medium"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              Current Workspace
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Metadata Row */}
                      <div
                        className="flex flex-wrap items-center gap-4 text-xs pt-2.5 border-t border-[var(--color-border)]"
                        style={{
                          color: "var(--color-text-muted)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} />
                          <span>{formatDateTime(snap.createdAt)}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Tag size={12} />
                          <span>
                            {snap.source === "GITHUB"
                              ? "GitHub"
                              : snap.source === "ZIP"
                                ? "Archive"
                                : "Checkpoint"}
                          </span>
                        </div>

                        {snap.commitSha && (
                          <div className="flex items-center gap-1.5">
                            <span
                              style={{
                                color: "var(--color-primary)",
                                fontWeight: 600,
                              }}
                            >
                              Commit:
                            </span>
                            <span>{snap.commitSha.slice(0, 7)}</span>
                          </div>
                        )}

                        {snap.fileCount !== null &&
                          snap.fileCount !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <FileCode2 size={12} />
                              <span>{snap.fileCount} files</span>
                            </div>
                          )}

                        {snap.sizeBytes !== null &&
                          snap.sizeBytes !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <HardDrive size={12} />
                              <span>{formatBytes(snap.sizeBytes)}</span>
                            </div>
                          )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Column: Quick Create & Version Insights */}
          <div className="flex flex-col gap-4">
            {/* Quick Create Checkpoint Card */}
            <div
              className="rounded-[var(--radius-lg)] flex flex-col p-5"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <BookmarkPlus
                  size={15}
                  style={{ color: "var(--color-primary)" }}
                />
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  Quick Checkpoint
                </h3>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 14,
                }}
              >
                Save the current code state to easily revert anytime.
              </p>

              <form
                onSubmit={handleCreateSnapshot}
                className="flex flex-col gap-3"
              >
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      marginBottom: 4,
                      display: "block",
                    }}
                  >
                    Checkpoint Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Before refactoring auth..."
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="w-full rounded-[var(--radius-md)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      marginBottom: 4,
                      display: "block",
                    }}
                  >
                    Description / Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Brief description of current changes..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="w-full rounded-[var(--radius-md)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                    }}
                  />
                </div>

                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={creatingSnapshot}
                  className="w-full flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] py-2 text-xs font-semibold cursor-pointer mt-1"
                  style={{
                    background: "var(--color-primary)",
                    color: "#ffffff",
                    border: "none",
                    opacity: creatingSnapshot ? 0.7 : 1,
                  }}
                >
                  {creatingSnapshot ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Capturing Checkpoint...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} />
                      <span>Capture Snapshot Now</span>
                    </>
                  )}
                </motion.button>
              </form>
            </div>

            {/* Version Overview Card */}
            <div
              className="rounded-[var(--radius-lg)] flex flex-col p-5 gap-4"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}
              >
                Version Overview
              </h3>

              <div className="flex justify-between items-center text-xs">
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Total Checkpoints
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: "var(--color-text)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {snapshots.length}
                </span>
              </div>

              <div style={{ height: 1, background: "var(--color-border)" }} />

              <div className="flex justify-between items-center text-xs">
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Active Version
                </span>
                <span
                  className="truncate max-w-[150px] font-semibold"
                  style={{ color: "var(--color-primary)" }}
                  title={activeSnapshot?.label || "None"}
                >
                  {activeSnapshot?.label || "None"}
                </span>
              </div>

              <div style={{ height: 1, background: "var(--color-border)" }} />

              <div className="flex justify-between items-center text-xs">
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Last Captured
                </span>
                <span
                  style={{
                    color: "var(--color-text)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {activeSnapshot?.createdAt
                    ? formatTime(activeSnapshot.createdAt)
                    : "—"}
                </span>
              </div>

              {/* Safety notice */}
              <div
                className="rounded-[var(--radius-md)] p-3 text-[11px] leading-relaxed flex items-start gap-2"
                style={{
                  background: "var(--color-surface-secondary)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <ShieldCheck
                  size={14}
                  className="flex-shrink-0 mt-0.5"
                  style={{ color: "var(--color-primary)" }}
                />
                <span>
                  All checkpoints are immutable. Restoring a previous version
                  automatically creates a new checkpoint of your current code
                  first, ensuring zero data loss.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: PIPELINES & JOB QUEUE ───────────────────────── */}
      {activeTab === "jobs" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left Column: Jobs List */}
          <div className="xl:col-span-2 flex flex-col gap-4">
            <div className="flex items-center justify-between mb-1">
              <h2
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}
              >
                {filterJobs === "ALL"
                  ? `All Jobs (${jobs.length})`
                  : filterJobs === "ACTIVE"
                    ? `Active Jobs (${activeJobs.length})`
                    : `Completed (${completedJobs.length + failedJobs.length})`}
              </h2>
              <div className="flex items-center gap-1.5">
                {["ALL", "ACTIVE", "COMPLETED"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilterJobs(f)}
                    className="rounded-[var(--radius-md)] transition-colors cursor-pointer"
                    style={{
                      background:
                        filterJobs === f
                          ? "var(--color-surface-secondary)"
                          : "transparent",
                      border:
                        filterJobs === f
                          ? "1px solid var(--color-border)"
                          : "1px solid transparent",
                      color:
                        filterJobs === f
                          ? "var(--color-text)"
                          : "var(--color-text-muted)",
                      fontSize: 12,
                      fontWeight: 500,
                      padding: "4px 10px",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : "Done"}
                  </button>
                ))}
              </div>
            </div>

            {/* Loading state */}
            {loadingJobs && jobs.length === 0 && <JobsListSkeleton count={3} />}

            {/* Error state */}
            {errorJobs && (
              <div
                className="rounded-[var(--radius-md)] flex items-center gap-2.5 p-3 text-xs"
                style={{
                  background: "rgba(220, 38, 38, 0.1)",
                  border: "1px solid rgba(220, 38, 38, 0.25)",
                  color: "var(--color-danger)",
                }}
              >
                <XCircle size={15} />
                {errorJobs}
              </div>
            )}

            {/* Empty state */}
            {!loadingJobs && !errorJobs && filteredJobs.length === 0 && (
              <div
                className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] p-12 text-center"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <Clock
                  size={32}
                  style={{ color: "var(--color-text-muted)", marginBottom: 8 }}
                />
                <p
                  style={{
                    color: "var(--color-text)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  No jobs found
                </p>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {filterJobs !== "ALL"
                    ? "Try changing the filter."
                    : "Jobs will appear here when you import a project or run tests."}
                </p>
              </div>
            )}

            {/* Job Cards */}
            <div className="flex flex-col gap-3">
              <AnimatePresence mode="popLayout">
                {filteredJobs.map((job, idx) => {
                  const visual = getJobVisual(job);
                  const isActive = ["QUEUED", "RUNNING"].includes(job.status);

                  return (
                    <motion.div
                      key={job.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{
                        opacity: 0,
                        y: -8,
                        transition: { duration: 0.15 },
                      }}
                      transition={{
                        delay: idx * 0.03,
                        duration: 0.25,
                        ease: "easeOut",
                      }}
                      className="relative rounded-[var(--radius-lg)] overflow-hidden flex flex-col"
                      style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        padding: "16px 20px",
                      }}
                    >
                      {/* Left Accent Bar */}
                      <div
                        className="absolute left-0 top-0 bottom-0"
                        style={{
                          width: 3,
                          background: visual.color,
                        }}
                      />

                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex items-center justify-center rounded-[var(--radius-md)] flex-shrink-0"
                            style={{
                              width: 38,
                              height: 38,
                              background: "var(--color-surface-secondary)",
                              border: "1px solid var(--color-border)",
                            }}
                          >
                            <visual.Icon
                              size={17}
                              style={{ color: visual.color }}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3
                                style={{
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: "var(--color-text)",
                                }}
                              >
                                {visual.typeLabel}
                              </h3>
                              {job.project?.name && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: "var(--color-primary)",
                                    background: "rgba(109, 93, 251, 0.1)",
                                    border:
                                      "1px solid rgba(109, 93, 251, 0.25)",
                                    padding: "1px 7px",
                                    borderRadius: "var(--radius-sm)",
                                  }}
                                >
                                  {job.project.name}
                                </span>
                              )}
                            </div>
                            <p
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-secondary)",
                                marginTop: 2,
                              }}
                            >
                              {visual.taskLabel}
                            </p>
                            <p
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-muted)",
                                marginTop: 3,
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              Started:{" "}
                              {formatTime(job.startedAt || job.createdAt)}
                              {job.finishedAt &&
                                ` · Duration: ${formatDuration(job.startedAt || job.createdAt, job.finishedAt)}`}
                            </p>
                          </div>
                        </div>

                        {isActive && (
                          <button
                            type="button"
                            onClick={() => handleCancelJob(job.id)}
                            disabled={cancelingJobId === job.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "3px 8px",
                              borderRadius: "var(--radius-sm)",
                              fontSize: 11,
                              fontWeight: 600,
                              color: "var(--color-danger)",
                              background: "rgba(239, 68, 68, 0.1)",
                              border: "1px solid rgba(239, 68, 68, 0.3)",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                            title="Tạm dừng / Hủy job đang chạy này"
                            className="hover:bg-red-500/20"
                          >
                            <Ban size={11} />
                            <span>{cancelingJobId === job.id ? "Stopping..." : "Stop Job"}</span>
                          </button>
                        )}

                        {/* Status Badge */}
                        <div
                          className="rounded-full flex items-center gap-1.5 flex-shrink-0"
                          style={{
                            padding: "4px 12px",
                            background: visual.bg,
                            border: `1px solid ${visual.border}`,
                          }}
                        >
                          {isActive && (
                            <motion.div
                              animate={{ opacity: [1, 0.4, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                              className="rounded-full"
                              style={{
                                width: 6,
                                height: 6,
                                background: visual.color,
                              }}
                            />
                          )}
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: visual.color,
                              letterSpacing: "0.04em",
                            }}
                          >
                            {visual.statusLabel}
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--color-text-secondary)",
                              fontWeight: 500,
                            }}
                          >
                            Progress
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--color-text)",
                              fontWeight: 600,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {job.progress}%
                          </span>
                        </div>
                        <div
                          className="w-full rounded-full overflow-hidden"
                          style={{
                            height: 6,
                            background: "var(--color-surface-secondary)",
                            border: "1px solid var(--color-border)",
                          }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${job.progress}%`,
                              background: visual.color,
                              transition: "width 0.4s ease-out",
                            }}
                          />
                        </div>
                      </div>

                      {/* Error message */}
                      {job.status === "FAILED" && job.errorMessage && (
                        <div
                          className="mt-3 rounded-[var(--radius-md)]"
                          style={{
                            background: "rgba(220, 38, 38, 0.08)",
                            border: "1px solid rgba(220, 38, 38, 0.2)",
                            padding: "8px 12px",
                            fontSize: 11,
                            color: "var(--color-danger)",
                            fontFamily: "var(--font-mono)",
                            wordBreak: "break-word",
                          }}
                        >
                          {job.errorMessage}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Column: Stats & Resources */}
          <div className="flex flex-col gap-4">
            {/* Stats Summary */}
            <div
              className="flex items-center gap-4 rounded-[var(--radius-lg)] w-full"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                padding: "14px 20px",
              }}
            >
              <div className="flex flex-col flex-1">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    marginBottom: 2,
                  }}
                >
                  Completed
                </span>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--color-success)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {completedJobs.length}
                </span>
              </div>
              <div
                style={{
                  width: 1,
                  height: 36,
                  background: "var(--color-border)",
                }}
              />
              <div className="flex flex-col flex-1">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    marginBottom: 2,
                  }}
                >
                  Failed
                </span>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color:
                      failedJobs.length > 0
                        ? "var(--color-danger)"
                        : "var(--color-text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {failedJobs.length}
                </span>
              </div>
            </div>

            {/* Queue & Resources Card */}
            <div
              className="rounded-[var(--radius-lg)] flex flex-col gap-4 p-5"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}
              >
                Queue & Resources
              </h3>

              <div className="flex justify-between items-center text-xs">
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Pending Jobs
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--color-warning)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {jobs.filter((j) => j.status === "QUEUED").length}
                </span>
              </div>

              <div style={{ height: 1, background: "var(--color-border)" }} />

              <div className="flex justify-between items-center text-xs">
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Running Jobs
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--color-info)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {jobs.filter((j) => j.status === "RUNNING").length}
                </span>
              </div>

              <div style={{ height: 1, background: "var(--color-border)" }} />

              <div className="flex justify-between items-center text-xs">
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Total Jobs
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--color-text)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {jobs.length}
                </span>
              </div>

              <div style={{ height: 1, background: "var(--color-border)" }} />

              <div>
                <div className="flex justify-between items-center mb-2">
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text-secondary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Worker Load
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {workerLoad}%
                  </span>
                </div>
                <div
                  className="w-full rounded-full overflow-hidden"
                  style={{
                    height: 6,
                    background: "var(--color-surface-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${workerLoad}%`,
                      background:
                        workerLoad > 80
                          ? "var(--color-danger)"
                          : workerLoad > 50
                            ? "var(--color-warning)"
                            : "var(--color-success)",
                      transition: "width 0.4s ease-out",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE SNAPSHOT MODAL ──────────────────────────────── */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md rounded-[var(--radius-lg)] p-5 shadow-2xl flex flex-col gap-4"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <BookmarkPlus
                    size={16}
                    style={{ color: "var(--color-primary)" }}
                  />
                  <h3
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Capture Code Snapshot
                  </h3>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer text-sm"
                >
                  ✕
                </button>
              </div>

              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                Save the current code state across all project files as an
                immutable checkpoint. You can restore this version at any time.
              </p>

              <form
                onSubmit={handleCreateSnapshot}
                className="flex flex-col gap-3"
              >
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      marginBottom: 4,
                      display: "block",
                    }}
                  >
                    Checkpoint Name / Tag
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Before refactoring auth service"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    autoFocus
                    className="w-full rounded-[var(--radius-md)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      marginBottom: 4,
                      display: "block",
                    }}
                  >
                    Description / Notes (Optional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="What changed in this checkpoint?"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="w-full rounded-[var(--radius-md)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                    }}
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 mt-2 pt-3 border-t border-[var(--color-border)]">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-3.5 py-1.5 rounded-[var(--radius-md)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                    style={{
                      background: "var(--color-surface-secondary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={creatingSnapshot}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold cursor-pointer"
                    style={{
                      background: "var(--color-primary)",
                      color: "#ffffff",
                      border: "none",
                    }}
                  >
                    {creatingSnapshot ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Capturing...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        <span>Create Checkpoint</span>
                      </>
                    )}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── CONFIRM RESTORE MODAL ──────────────────────────────── */}
      <AnimatePresence>
        {confirmRestoreSnapshot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md rounded-[var(--radius-lg)] p-5 shadow-2xl flex flex-col gap-4"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
            >
              <div className="flex items-center gap-2.5 pb-2.5 border-b border-[var(--color-border)]">
                <RotateCcw
                  size={16}
                  style={{ color: "var(--color-warning)" }}
                />
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  Rollback to Checkpoint?
                </h3>
              </div>

              <div
                className="rounded-[var(--radius-md)] p-3 flex flex-col gap-2"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div className="flex items-center justify-between text-xs">
                  <span
                    style={{
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Target Checkpoint:
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: "var(--color-primary)",
                    }}
                  >
                    {confirmRestoreSnapshot.label}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span
                    style={{
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Captured at:
                  </span>
                  <span
                    style={{
                      color: "var(--color-text)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {formatDateTime(confirmRestoreSnapshot.createdAt)}
                  </span>
                </div>
                {confirmRestoreSnapshot.message && (
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1 italic border-t border-[var(--color-border)] pt-2">
                    &ldquo;{confirmRestoreSnapshot.message}&rdquo;
                  </p>
                )}
              </div>

              <div
                className="rounded-[var(--radius-md)] p-2.5 text-xs leading-relaxed flex items-start gap-2"
                style={{
                  background: "rgba(217, 119, 6, 0.1)",
                  border: "1px solid rgba(217, 119, 6, 0.25)",
                  color: "var(--color-warning)",
                }}
              >
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                <span>
                  All current workspace files will be reverted to this
                  checkpoint. A new checkpoint will automatically be created
                  first to preserve your current changes.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => setConfirmRestoreSnapshot(null)}
                  className="px-3.5 py-1.5 rounded-[var(--radius-md)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                  style={{
                    background: "var(--color-surface-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  disabled={restoring}
                  onClick={handleConfirmRestore}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold cursor-pointer"
                  style={{
                    background: "var(--color-danger)",
                    color: "#ffffff",
                    border: "none",
                  }}
                >
                  {restoring ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Rolling back...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw size={13} />
                      <span>Confirm & Rollback</span>
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
