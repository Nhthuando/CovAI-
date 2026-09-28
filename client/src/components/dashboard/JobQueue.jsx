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
import { getUserJobsApi } from "../../services/job.service";
import {
  getProjectSnapshotsApi,
  createProjectSnapshotApi,
  restoreProjectSnapshotApi,
} from "../../services/project.service";

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
  QUEUED: { label: "QUEUED", color: "#f59e0b", icon: Clock },
  RUNNING: { label: "RUNNING", color: "#38bdf8", icon: Activity },
  SUCCESS: { label: "COMPLETED", color: "#22c55e", icon: CheckCircle2 },
  FAILED: { label: "FAILED", color: "#ef4444", icon: XCircle },
  CANCELED: { label: "CANCELED", color: "#6b7280", icon: Ban },
};

function getJobVisual(job) {
  const typeConf = JOB_TYPE_CONFIG[job.type] || JOB_TYPE_CONFIG.INGEST;
  const statusConf = JOB_STATUS_CONFIG[job.status] || JOB_STATUS_CONFIG.QUEUED;

  const color = statusConf.color;
  const gradient = color;
  const Icon = typeConf.icon;

  return {
    color,
    gradient,
    Icon,
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
  const intervalRef = useRef(null);

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
        background: "var(--ide-bg)",
        color: "var(--text-primary)",
        padding: "28px 36px",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Top Header ─────────────────────────────────────────── */}
      <div
        className="flex flex-col lg:flex-row lg:items-center justify-between gap-6"
        style={{ marginBottom: 24 }}
      >
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "#f0f6fc",
                letterSpacing: "-0.02em",
              }}
            >
              Pipelines & Version Hub
            </h1>
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
              style={{
                background: "rgba(124, 58, 237, 0.15)",
                color: "#c084fc",
                border: "1px solid rgba(124, 58, 237, 0.3)",
              }}
            >
              Checkpoints & AI Queues
            </span>
          </div>
          <p style={{ color: "#8b949e", fontSize: 14 }}>
            Capture project checkpoints, restore previous code versions, and
            monitor active test generation pipelines.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg font-medium text-xs shadow-lg cursor-pointer"
            style={{
              background: "var(--color-primary)",
              color: "#ffffff",
              padding: "8px 16px",
              boxShadow: "none",
              border: "none",
            }}
          >
            <BookmarkPlus size={15} />
            Create Snapshot
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleRefreshAll}
            className="flex items-center gap-2 rounded-lg text-xs font-medium cursor-pointer"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#8b949e",
              padding: "8px 14px",
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
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 rounded-xl flex items-center justify-between px-4 py-3 text-xs"
            style={{
              background:
                feedbackNotice.type === "success"
                  ? "rgba(34, 197, 94, 0.12)"
                  : "rgba(239, 68, 68, 0.12)",
              border:
                feedbackNotice.type === "success"
                  ? "1px solid rgba(34, 197, 94, 0.25)"
                  : "1px solid rgba(239, 68, 68, 0.25)",
              color: feedbackNotice.type === "success" ? "#86efac" : "#fca5a5",
            }}
          >
            <div className="flex items-center gap-2">
              {feedbackNotice.type === "success" ? (
                <CheckCircle2 size={16} className="text-emerald-400" />
              ) : (
                <AlertCircle size={16} className="text-red-400" />
              )}
              <span className="font-medium">{feedbackNotice.text}</span>
            </div>
            <button
              onClick={() => setFeedbackNotice(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab Switcher ───────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 border-b border-white/5 pb-3"
        style={{ marginBottom: 24 }}
      >
        <button
          onClick={() => setActiveTab("snapshots")}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer transition-all"
          style={{
            background:
              activeTab === "snapshots"
                ? "rgba(124, 58, 237, 0.18)"
                : "rgba(255, 255, 255, 0.02)",
            color: activeTab === "snapshots" ? "#c084fc" : "#8b949e",
            border:
              activeTab === "snapshots"
                ? "1px solid rgba(124, 58, 237, 0.35)"
                : "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          <Layers size={14} />
          <span>Code Snapshots & Checkpoints</span>
          <span
            className="rounded-full px-2 py-0.2 text-[10px]"
            style={{
              background:
                activeTab === "snapshots"
                  ? "rgba(168, 85, 247, 0.25)"
                  : "rgba(255, 255, 255, 0.06)",
              color: activeTab === "snapshots" ? "#e9d5ff" : "#6e7681",
            }}
          >
            {snapshots.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("jobs")}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer transition-all"
          style={{
            background:
              activeTab === "jobs"
                ? "rgba(56, 189, 248, 0.15)"
                : "rgba(255, 255, 255, 0.02)",
            color: activeTab === "jobs" ? "#38bdf8" : "#8b949e",
            border:
              activeTab === "jobs"
                ? "1px solid rgba(56, 189, 248, 0.35)"
                : "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          <Cpu size={14} />
          <span>Pipelines & Job Queue</span>
          {activeJobs.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] bg-sky-500/20 text-sky-300 font-bold animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              {activeJobs.length} active
            </span>
          ) : (
            <span className="rounded-full px-2 py-0.2 text-[10px] bg-white/5 text-slate-500">
              {jobs.length}
            </span>
          )}
        </button>
      </div>

      {/* ── TAB 1: CODE SNAPSHOTS & CHECKPOINTS ────────────────── */}
      {activeTab === "snapshots" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column: Timeline & Checkpoint List */}
          <div className="xl:col-span-2 flex flex-col gap-5">
            {/* Search and count header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History size={16} className="text-purple-400" />
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>
                  Snapshot History ({filteredSnapshots.length})
                </h2>
              </div>

              <div
                className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  width: 240,
                }}
              >
                <Search size={13} className="text-slate-500" />
                <input
                  type="text"
                  placeholder="Search checkpoints..."
                  value={snapshotSearch}
                  onChange={(e) => setSnapshotSearch(e.target.value)}
                  className="bg-transparent border-none text-xs text-white focus:outline-none w-full"
                />
                {snapshotSearch && (
                  <button
                    onClick={() => setSnapshotSearch("")}
                    className="text-slate-500 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Loading state */}
            {loadingSnapshots && snapshots.length === 0 && (
              <div
                className="flex flex-col items-center justify-center rounded-xl p-12"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <Loader2
                  size={26}
                  className="animate-spin text-purple-400 mb-3"
                />
                <span style={{ color: "#8b949e", fontSize: 13 }}>
                  Loading snapshot checkpoints...
                </span>
              </div>
            )}

            {/* Error state */}
            {errorSnapshots && (
              <div
                className="rounded-xl flex items-center gap-3 p-4 text-xs"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: "#f87171",
                }}
              >
                <XCircle size={16} />
                {errorSnapshots}
              </div>
            )}

            {/* Empty state */}
            {!loadingSnapshots &&
              !errorSnapshots &&
              filteredSnapshots.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center rounded-xl p-12 text-center"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <BookmarkPlus size={32} className="text-slate-600 mb-3" />
                  <p
                    style={{ color: "#f0f6fc", fontSize: 15, fontWeight: 600 }}
                  >
                    No snapshots found
                  </p>
                  <p
                    style={{
                      color: "#8b949e",
                      fontSize: 13,
                      marginTop: 4,
                      maxWidth: 360,
                    }}
                  >
                    Click &quot;Create Snapshot&quot; to capture your current
                    code as a safe restore point.
                  </p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="mt-4 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                    style={{
                      background: "rgba(124, 58, 237, 0.2)",
                      color: "#c084fc",
                      border: "1px solid rgba(124, 58, 237, 0.4)",
                    }}
                  >
                    Capture First Checkpoint
                  </button>
                </div>
              )}

            {/* Snapshot Cards Timeline */}
            <div className="flex flex-col gap-4">
              <AnimatePresence mode="popLayout">
                {filteredSnapshots.map((snap, idx) => {
                  const isCurrent = snap.isCurrent;

                  return (
                    <motion.div
                      key={snap.id}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ delay: idx * 0.04, duration: 0.3 }}
                      className="relative rounded-xl overflow-hidden flex flex-col transition-all"
                      style={{
                        background: isCurrent
                          ? "rgba(109, 93, 251, 0.08)"
                          : "var(--color-surface)",
                        border: isCurrent
                          ? "1px solid var(--color-primary)"
                          : "1px solid var(--color-border)",
                        boxShadow: "none",
                        padding: "18px 22px",
                      }}
                    >
                      {/* Left Accent Stripe */}
                      <div
                        className="absolute left-0 top-0 bottom-0"
                        style={{
                          width: 4,
                          background: isCurrent
                            ? "var(--color-primary)"
                            : "var(--color-border)",
                        }}
                      />

                      {/* Header Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                            style={{
                              background: isCurrent
                                ? "rgba(109, 93, 251, 0.15)"
                                : "var(--color-bg)",
                              border: isCurrent
                                ? "1px solid var(--color-primary)"
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
                                  fontSize: 15,
                                  fontWeight: 600,
                                  color: "#f0f6fc",
                                }}
                              >
                                {snap.label}
                              </h3>
                              {isCurrent && (
                                <span
                                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold"
                                  style={{
                                    background: "rgba(34, 197, 94, 0.15)",
                                    color: "#4ade80",
                                    border: "1px solid rgba(34, 197, 94, 0.3)",
                                  }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  ACTIVE VERSION
                                </span>
                              )}
                            </div>
                            <p
                              style={{
                                fontSize: 12,
                                color: "#8b949e",
                                marginTop: 2,
                              }}
                            >
                              {snap.message}
                            </p>
                          </div>
                        </div>

                        {/* Action: Restore Button */}
                        <div className="flex items-center gap-2 self-start sm:self-center">
                          {!isCurrent ? (
                            <motion.button
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => setConfirmRestoreSnapshot(snap)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                              style={{
                                background: "rgba(124, 58, 237, 0.15)",
                                color: "#c084fc",
                                border: "1px solid rgba(124, 58, 237, 0.35)",
                                transition: "all 0.15s ease",
                              }}
                              title="Revert code to this checkpoint"
                            >
                              <RotateCcw size={12} />
                              <span>Rollback to this</span>
                            </motion.button>
                          ) : (
                            <span
                              className="text-[11px] font-medium"
                              style={{ color: "#6e7681" }}
                            >
                              Current Workspace
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Metadata Row */}
                      <div
                        className="flex flex-wrap items-center gap-4 text-xs pt-3 border-t border-white/5"
                        style={{
                          color: "#6e7681",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} className="text-slate-500" />
                          <span>{formatDateTime(snap.createdAt)}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Tag size={12} className="text-slate-500" />
                          <span className="text-slate-400">
                            {snap.source === "GITHUB"
                              ? "GitHub"
                              : snap.source === "ZIP"
                                ? "Archive"
                                : "Checkpoint"}
                          </span>
                        </div>

                        {snap.commitSha && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-purple-400 font-semibold">
                              Commit:
                            </span>
                            <span>{snap.commitSha.slice(0, 7)}</span>
                          </div>
                        )}

                        {snap.fileCount !== null &&
                          snap.fileCount !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <FileCode2 size={12} className="text-slate-500" />
                              <span>{snap.fileCount} files</span>
                            </div>
                          )}

                        {snap.sizeBytes !== null &&
                          snap.sizeBytes !== undefined && (
                            <div className="flex items-center gap-1.5">
                              <HardDrive size={12} className="text-slate-500" />
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
          <div className="flex flex-col gap-6">
            {/* Quick Create Checkpoint Card */}
            <div
              className="rounded-xl flex flex-col p-6"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <BookmarkPlus size={16} className="text-purple-400" />
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f6fc" }}>
                  Quick Checkpoint
                </h3>
              </div>
              <p style={{ fontSize: 12, color: "#8b949e", marginBottom: 16 }}>
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
                      color: "#8b949e",
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
                    className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#8b949e",
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
                    className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none resize-none"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={creatingSnapshot}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold cursor-pointer mt-1"
                  style={{
                    background: "var(--color-primary)",
                    color: "#ffffff",
                    border: "none",
                    boxShadow: "none",
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
              className="rounded-xl flex flex-col p-6 gap-5"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f6fc" }}>
                Version Overview
              </h3>

              <div className="flex justify-between items-center">
                <span style={{ fontSize: 13, color: "#8b949e" }}>
                  Total Checkpoints
                </span>
                <span
                  style={{ fontSize: 16, fontWeight: 700, color: "#a78bfa" }}
                >
                  {snapshots.length}
                </span>
              </div>

              <div
                style={{ height: 1, background: "rgba(255,255,255,0.06)" }}
              />

              <div className="flex justify-between items-center">
                <span style={{ fontSize: 13, color: "#8b949e" }}>
                  Active Version
                </span>
                <span
                  className="truncate max-w-[150px]"
                  style={{ fontSize: 12, fontWeight: 600, color: "#4ade80" }}
                  title={activeSnapshot?.label || "None"}
                >
                  {activeSnapshot?.label || "None"}
                </span>
              </div>

              <div
                style={{ height: 1, background: "rgba(255,255,255,0.06)" }}
              />

              <div className="flex justify-between items-center">
                <span style={{ fontSize: 13, color: "#8b949e" }}>
                  Last Captured
                </span>
                <span style={{ fontSize: 12, color: "#e2e8f0" }}>
                  {activeSnapshot?.createdAt
                    ? formatTime(activeSnapshot.createdAt)
                    : "—"}
                </span>
              </div>

              {/* Safety notice */}
              <div
                className="rounded-lg p-3 text-[11px] leading-relaxed flex items-start gap-2"
                style={{
                  background: "rgba(124, 58, 237, 0.08)",
                  border: "1px solid rgba(124, 58, 237, 0.2)",
                  color: "#d8b4fe",
                }}
              >
                <ShieldCheck
                  size={14}
                  className="flex-shrink-0 text-purple-400 mt-0.5"
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
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
          {/* Left Column: Jobs List */}
          <div className="xl:col-span-2 flex flex-col gap-4">
            <div className="flex items-center justify-between mb-2">
              <h2 style={{ fontSize: 17, fontWeight: 600, color: "#f0f6fc" }}>
                {filterJobs === "ALL"
                  ? `All Jobs (${jobs.length})`
                  : filterJobs === "ACTIVE"
                    ? `Active Jobs (${activeJobs.length})`
                    : `Completed (${completedJobs.length + failedJobs.length})`}
              </h2>
              <div className="flex items-center gap-2">
                {["ALL", "ACTIVE", "COMPLETED"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilterJobs(f)}
                    className="rounded-lg transition-colors cursor-pointer"
                    style={{
                      background:
                        filterJobs === f
                          ? "rgba(124,58,237,0.15)"
                          : "transparent",
                      border:
                        filterJobs === f
                          ? "1px solid rgba(124,58,237,0.3)"
                          : "1px solid transparent",
                      color: filterJobs === f ? "#a78bfa" : "#6e7681",
                      fontSize: 12,
                      fontWeight: 500,
                      padding: "5px 12px",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : "Done"}
                  </button>
                ))}
              </div>
            </div>

            {/* Loading state */}
            {loadingJobs && jobs.length === 0 && (
              <div
                className="flex flex-col items-center justify-center"
                style={{ padding: "60px 0" }}
              >
                <Loader2
                  size={28}
                  className="animate-spin text-purple-400 mb-3"
                />
                <span style={{ color: "#6e7681", fontSize: 14 }}>
                  Loading jobs...
                </span>
              </div>
            )}

            {/* Error state */}
            {errorJobs && (
              <div
                className="rounded-xl flex items-center gap-3"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  padding: "16px 20px",
                  color: "#f87171",
                  fontSize: 14,
                }}
              >
                <XCircle size={18} />
                {errorJobs}
              </div>
            )}

            {/* Empty state */}
            {!loadingJobs && !errorJobs && filteredJobs.length === 0 && (
              <div
                className="flex flex-col items-center justify-center rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  padding: "60px 20px",
                }}
              >
                <Clock
                  size={36}
                  style={{ color: "#484f58", marginBottom: 12 }}
                />
                <p style={{ color: "#8b949e", fontSize: 15, fontWeight: 500 }}>
                  No jobs found
                </p>
                <p style={{ color: "#6e7681", fontSize: 13, marginTop: 4 }}>
                  {filterJobs !== "ALL"
                    ? "Try changing the filter."
                    : "Jobs will appear here when you import a project or run tests."}
                </p>
              </div>
            )}

            {/* Job Cards */}
            <div className="flex flex-col gap-4">
              <AnimatePresence mode="popLayout">
                {filteredJobs.map((job, idx) => {
                  const visual = getJobVisual(job);
                  const isActive = ["QUEUED", "RUNNING"].includes(job.status);

                  return (
                    <motion.div
                      key={job.id}
                      layout
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{
                        opacity: 0,
                        y: -10,
                        transition: { duration: 0.2 },
                      }}
                      transition={{
                        delay: idx * 0.05,
                        duration: 0.35,
                        ease: "easeOut",
                      }}
                      className="relative rounded-xl overflow-hidden flex flex-col"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        padding: "20px 24px",
                      }}
                    >
                      {/* Left Accent Bar */}
                      <div
                        className="absolute left-0 top-0 bottom-0"
                        style={{
                          width: 4,
                          background: visual.color,
                          boxShadow: `0 0 12px ${visual.color}60`,
                        }}
                      />

                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
                        <div className="flex items-center gap-4">
                          <div
                            className="flex items-center justify-center rounded-lg flex-shrink-0"
                            style={{
                              width: 44,
                              height: 44,
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <visual.Icon
                              size={18}
                              style={{ color: visual.color }}
                            />
                          </div>
                          <div>
                            <h3
                              style={{
                                fontSize: 16,
                                fontWeight: 600,
                                color: "#f0f6fc",
                                marginBottom: 4,
                              }}
                            >
                              {visual.typeLabel}
                              {job.project?.name && (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: "#a78bfa",
                                    background: "rgba(124,58,237,0.15)",
                                    padding: "2px 8px",
                                    borderRadius: 12,
                                  }}
                                >
                                  {job.project.name}
                                </span>
                              )}
                            </h3>
                            <p style={{ fontSize: 13, color: "#8b949e" }}>
                              {visual.taskLabel}
                            </p>
                            <p
                              style={{
                                fontSize: 11,
                                color: "#484f58",
                                marginTop: 4,
                              }}
                            >
                              Started:{" "}
                              {formatTime(job.startedAt || job.createdAt)}
                              {job.finishedAt &&
                                ` · Duration: ${formatDuration(job.startedAt || job.createdAt, job.finishedAt)}`}
                            </p>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div
                          className="rounded-full flex items-center gap-2 flex-shrink-0"
                          style={{
                            padding: "6px 14px",
                            background: `${visual.color}18`,
                            border: `1px solid ${visual.color}40`,
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
                                boxShadow: `0 0 8px ${visual.color}`,
                              }}
                            />
                          )}
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: visual.color,
                              letterSpacing: "0.06em",
                            }}
                          >
                            {visual.statusLabel}
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div>
                        <div className="flex justify-between items-center mb-3">
                          <span
                            style={{
                              fontSize: 12,
                              color: "#8b949e",
                              fontWeight: 500,
                              letterSpacing: "0.02em",
                            }}
                          >
                            Progress
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: "#f0f6fc",
                              fontWeight: 600,
                            }}
                          >
                            {job.progress}%
                          </span>
                        </div>
                        <div
                          className="w-full rounded-full overflow-hidden"
                          style={{
                            height: 6,
                            background: "rgba(255,255,255,0.06)",
                          }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${job.progress}%`,
                              background: visual.color,
                              boxShadow: "none",
                              transition: "width 0.6s ease-out",
                            }}
                          />
                        </div>
                      </div>

                      {/* Error message */}
                      {job.status === "FAILED" && job.errorMessage && (
                        <div
                          className="mt-4 rounded-lg"
                          style={{
                            background: "rgba(239,68,68,0.06)",
                            border: "1px solid rgba(239,68,68,0.15)",
                            padding: "10px 14px",
                            fontSize: 12,
                            color: "#f87171",
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
              className="flex items-center gap-6 rounded-2xl w-full"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.08)",
                padding: "12px 24px",
                marginBottom: 32,
              }}
            >
              <div className="flex flex-col flex-1">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#8b949e",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Completed
                </span>
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    color: "#2dd4bf",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {completedJobs.length}
                </span>
              </div>
              <div
                style={{
                  width: 1,
                  height: 40,
                  background: "rgba(255,255,255,0.08)",
                }}
              />
              <div className="flex flex-col flex-1">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#8b949e",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Failed
                </span>
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    color: failedJobs.length > 0 ? "#ef4444" : "#c084fc",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {failedJobs.length}
                </span>
              </div>
            </div>

            <h2
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: "#f0f6fc",
                marginBottom: 2,
              }}
            >
              Queue & Resources
            </h2>

            <div
              className="rounded-xl flex flex-col gap-6"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "24px",
              }}
            >
              <div className="flex justify-between items-center">
                <span
                  style={{ fontSize: 14, color: "#8b949e", fontWeight: 500 }}
                >
                  Pending Jobs
                </span>
                <span
                  style={{ fontSize: 20, fontWeight: 600, color: "#f0f6fc" }}
                >
                  {jobs.filter((j) => j.status === "QUEUED").length}
                </span>
              </div>

              <div
                style={{ height: 1, background: "rgba(255,255,255,0.06)" }}
              />

              <div className="flex justify-between items-center">
                <span
                  style={{ fontSize: 14, color: "#8b949e", fontWeight: 500 }}
                >
                  Running Jobs
                </span>
                <span
                  style={{ fontSize: 20, fontWeight: 600, color: "#38bdf8" }}
                >
                  {jobs.filter((j) => j.status === "RUNNING").length}
                </span>
              </div>

              <div
                style={{ height: 1, background: "rgba(255,255,255,0.06)" }}
              />

              <div className="flex justify-between items-center">
                <span
                  style={{ fontSize: 14, color: "#8b949e", fontWeight: 500 }}
                >
                  Total Jobs
                </span>
                <span
                  style={{ fontSize: 18, fontWeight: 500, color: "#f0f6fc" }}
                >
                  {jobs.length}
                </span>
              </div>

              <div
                style={{ height: 1, background: "rgba(255,255,255,0.06)" }}
              />

              <div>
                <div className="flex justify-between items-center mb-4">
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#8b949e",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Worker Load
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#f0f6fc",
                    }}
                  >
                    {workerLoad}%
                  </span>
                </div>
                <div
                  className="w-full rounded-full overflow-hidden"
                  style={{ height: 8, background: "rgba(255,255,255,0.06)" }}
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
                      boxShadow: "none",
                      transition: "width 0.6s ease-out",
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <BookmarkPlus size={18} className="text-purple-400" />
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "#f0f6fc",
                    }}
                  >
                    Capture Code Snapshot
                  </h3>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-slate-400 hover:text-white cursor-pointer text-sm"
                >
                  ✕
                </button>
              </div>

              <p style={{ fontSize: 13, color: "#8b949e", lineHeight: 1.5 }}>
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
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#f0f6fc",
                      marginBottom: 6,
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
                    className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#f0f6fc",
                      marginBottom: 6,
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
                    className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none resize-none"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  />
                </div>

                <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={creatingSnapshot}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                    style={{
                      background: "var(--color-primary)",
                      color: "#ffffff",
                      border: "none",
                      boxShadow: "none",
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-center gap-3 text-amber-400 pb-2 border-b border-white/5">
                <RotateCcw size={20} />
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  Rollback to Checkpoint?
                </h3>
              </div>

              <div
                className="rounded-xl p-4 flex flex-col gap-2"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Target Checkpoint:
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--color-primary)",
                    }}
                  >
                    {confirmRestoreSnapshot.label}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Captured at:
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-text)" }}>
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
                className="rounded-lg p-3 text-xs leading-relaxed flex items-start gap-2.5"
                style={{
                  background: "rgba(234, 179, 8, 0.1)",
                  border: "1px solid rgba(234, 179, 8, 0.25)",
                  color: "#fde047",
                }}
              >
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>
                  All current workspace files will be reverted to this
                  checkpoint. A new checkpoint will automatically be created
                  first to preserve your current changes.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => setConfirmRestoreSnapshot(null)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  disabled={restoring}
                  onClick={handleConfirmRestore}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                  style={{
                    background: "var(--color-danger)",
                    color: "#ffffff",
                    border: "none",
                    boxShadow: "none",
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
