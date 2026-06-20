import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ListFilter,
  Loader2,
  RefreshCw,
  PackageOpen,
  TestTube2,
  Wrench,
  BrainCircuit,
  Ban,
} from "lucide-react";
import { getUserJobsApi } from "../../services/job.service";

/* ── Helpers: map backend enums to UI props ────────────────── */

const JOB_TYPE_CONFIG = {
  INGEST:       { label: "Source Ingest",    icon: PackageOpen,  taskLabel: "Extracting and indexing source files" },
  INSTALL_DEPS: { label: "Install Deps",    icon: Wrench,       taskLabel: "Installing project dependencies" },
  RUN_TESTS:    { label: "Run Tests",       icon: TestTube2,    taskLabel: "Running test suite with coverage" },
  PARSE_COVERAGE:{ label: "Parse Coverage", icon: Activity,     taskLabel: "Parsing coverage report data" },
  BUILD_CFG:    { label: "Build CFG",       icon: Cpu,          taskLabel: "Building control flow graphs" },
  AI_SUGGEST:   { label: "AI Suggest",      icon: BrainCircuit, taskLabel: "Generating AI improvement suggestions" },
  AI_TESTS:     { label: "AI Tests",        icon: BrainCircuit, taskLabel: "Generating AI test cases" },
};

const JOB_STATUS_CONFIG = {
  QUEUED:   { label: "QUEUED",   color: "#f59e0b", icon: Clock },
  RUNNING:  { label: "RUNNING",  color: "#38bdf8", icon: Activity },
  SUCCESS:  { label: "COMPLETED", color: "#22c55e", icon: CheckCircle2 },
  FAILED:   { label: "FAILED",   color: "#ef4444", icon: XCircle },
  CANCELED: { label: "CANCELED", color: "#6b7280", icon: Ban },
};

function getJobVisual(job) {
  const typeConf = JOB_TYPE_CONFIG[job.type] || JOB_TYPE_CONFIG.INGEST;
  const statusConf = JOB_STATUS_CONFIG[job.status] || JOB_STATUS_CONFIG.QUEUED;

  const color = statusConf.color;
  const gradient = `linear-gradient(90deg, ${color} 0%, ${color}99 100%)`;
  const Icon = typeConf.icon;

  return { color, gradient, Icon, typeLabel: typeConf.label, taskLabel: typeConf.taskLabel, statusLabel: statusConf.label };
}

/* ── Polling intervals (ms) ───────────────────────────── */
const POLL_FAST = 3000;  // when active jobs exist
const POLL_SLOW = 15000; // when no active jobs

/* ── Component ─────────────────────────────────────────────── */
export default function JobQueue({ projectId }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("ALL"); // ALL | ACTIVE | COMPLETED
  const intervalRef = useRef(null);

  const fetchJobs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getUserJobsApi();
      setJobs(data.jobs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + adaptive polling
  useEffect(() => {
    fetchJobs();

    // Start with fast poll, will be adjusted
    intervalRef.current = setInterval(() => {
      fetchJobs(true);
    }, POLL_FAST);

    return () => clearInterval(intervalRef.current);
  }, [fetchJobs]);

  // Adjust polling speed based on whether there are active jobs
  useEffect(() => {
    const hasActive = jobs.some(j => ["QUEUED", "RUNNING"].includes(j.status));
    const interval = hasActive ? POLL_FAST : POLL_SLOW;

    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      fetchJobs(true);
    }, interval);

    return () => clearInterval(intervalRef.current);
  }, [jobs, fetchJobs]);

  // Derived stats
  const activeJobs = jobs.filter(j => ["QUEUED", "RUNNING"].includes(j.status));
  const completedJobs = jobs.filter(j => j.status === "SUCCESS");
  const failedJobs = jobs.filter(j => j.status === "FAILED");

  const filteredJobs = filter === "ALL"
    ? jobs
    : filter === "ACTIVE"
      ? activeJobs
      : jobs.filter(j => ["SUCCESS", "FAILED", "CANCELED"].includes(j.status));

  const workerLoad = jobs.length > 0
    ? Math.round((activeJobs.length / Math.max(jobs.length, 1)) * 100)
    : 0;

  // Format time
  const formatTime = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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


  return (
    <div
      className="flex flex-col w-full h-full overflow-y-auto"
      style={{
        background: "var(--ide-bg)",
        color: "var(--text-primary)",
        padding: "32px",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6" style={{ marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 36, fontWeight: 700, color: "#f0f6fc", marginBottom: 6, letterSpacing: "-0.02em" }}>
            Job Queue
          </h1>
          <p style={{ color: "#8b949e", fontSize: 15 }}>
            Monitoring active AI analysis tasks and test generation pipelines.
          </p>
        </div>

        {/* Refresh button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => fetchJobs()}
          className="flex items-center gap-2 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#8b949e",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            padding: "8px 16px",
            fontFamily: "var(--font-sans)",
          }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </motion.button>
      </div>

      {/* ── Main Grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">

        {/* Left Column: Jobs List */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          <div className="flex items-center justify-between mb-2">
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "#f0f6fc" }}>
              {filter === "ALL" ? `All Jobs (${jobs.length})` :
               filter === "ACTIVE" ? `Active Jobs (${activeJobs.length})` :
               `Completed (${completedJobs.length + failedJobs.length})`}
            </h2>
            <div className="flex items-center gap-2">
              {["ALL", "ACTIVE", "COMPLETED"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="rounded-lg transition-colors"
                  style={{
                    background: filter === f ? "rgba(124,58,237,0.15)" : "transparent",
                    border: filter === f ? "1px solid rgba(124,58,237,0.3)" : "1px solid transparent",
                    color: filter === f ? "#a78bfa" : "#6e7681",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
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
          {loading && jobs.length === 0 && (
            <div className="flex flex-col items-center justify-center" style={{ padding: "60px 0" }}>
              <Loader2 size={28} className="animate-spin" style={{ color: "#a78bfa", marginBottom: 12 }} />
              <span style={{ color: "#6e7681", fontSize: 14 }}>Loading jobs...</span>
            </div>
          )}

          {/* Error state */}
          {error && (
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
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && filteredJobs.length === 0 && (
            <div
              className="flex flex-col items-center justify-center rounded-xl"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "60px 20px",
              }}
            >
              <Clock size={36} style={{ color: "#484f58", marginBottom: 12 }} />
              <p style={{ color: "#8b949e", fontSize: 15, fontWeight: 500 }}>No jobs found</p>
              <p style={{ color: "#6e7681", fontSize: 13, marginTop: 4 }}>
                {filter !== "ALL" ? "Try changing the filter." : "Jobs will appear here when you import a project or run tests."}
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
                    exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
                    transition={{ delay: idx * 0.05, duration: 0.35, ease: "easeOut" }}
                    className="relative rounded-xl overflow-hidden flex flex-col"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      padding: "20px 24px",
                    }}
                  >
                    {/* Left Colored Accent Bar */}
                    <div
                      className="absolute left-0 top-0 bottom-0"
                      style={{ width: 4, background: visual.color, boxShadow: `0 0 12px ${visual.color}60` }}
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
                          <visual.Icon size={18} style={{ color: visual.color }} />
                        </div>
                        <div>
                          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f6fc", marginBottom: 4 }}>
                            {visual.typeLabel}
                            {job.project?.name && (
                              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: "#a78bfa", background: "rgba(124,58,237,0.15)", padding: "2px 8px", borderRadius: 12 }}>
                                {job.project.name}
                              </span>
                            )}
                          </h3>
                          <p style={{ fontSize: 13, color: "#8b949e" }}>
                            {visual.taskLabel}
                          </p>
                          <p style={{ fontSize: 11, color: "#484f58", marginTop: 4 }}>
                            Started: {formatTime(job.startedAt || job.createdAt)}
                            {job.finishedAt && ` · Duration: ${formatDuration(job.startedAt || job.createdAt, job.finishedAt)}`}
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
                        <span style={{ fontSize: 11, fontWeight: 700, color: visual.color, letterSpacing: "0.06em" }}>
                          {visual.statusLabel}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <span style={{ fontSize: 12, color: "#8b949e", fontWeight: 500, letterSpacing: "0.02em" }}>Progress</span>
                        <span style={{ fontSize: 12, color: "#f0f6fc", fontWeight: 600 }}>{job.progress}%</span>
                      </div>
                      <div
                        className="w-full rounded-full overflow-hidden"
                        style={{ height: 6, background: "rgba(255,255,255,0.06)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${job.progress}%`,
                            background: visual.gradient,
                            boxShadow: `0 0 10px ${visual.color}40`,
                            transition: "width 0.6s ease-out",
                          }}
                        />
                      </div>
                    </div>

                    {/* Error message for failed jobs */}
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
              <span style={{ fontSize: 11, fontWeight: 600, color: "#8b949e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                Completed
              </span>
              <span style={{ fontSize: 26, fontWeight: 600, color: "#2dd4bf", letterSpacing: "-0.02em" }}>
                {completedJobs.length}
              </span>
            </div>
            <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)" }} />
            <div className="flex flex-col flex-1">
              <span style={{ fontSize: 11, fontWeight: 600, color: "#8b949e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                Failed
              </span>
              <span style={{ fontSize: 26, fontWeight: 600, color: failedJobs.length > 0 ? "#ef4444" : "#c084fc", letterSpacing: "-0.02em" }}>
                {failedJobs.length}
              </span>
            </div>
          </div>

          <h2 style={{ fontSize: 17, fontWeight: 600, color: "#f0f6fc", marginBottom: 2 }}>Queue & Resources</h2>

          <div
            className="rounded-xl flex flex-col gap-6"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "24px",
            }}
          >
            {/* Pending Jobs */}
            <div className="flex justify-between items-center">
              <span style={{ fontSize: 14, color: "#8b949e", fontWeight: 500 }}>Pending Jobs</span>
              <span style={{ fontSize: 20, fontWeight: 600, color: "#f0f6fc" }}>
                {jobs.filter(j => j.status === "QUEUED").length}
              </span>
            </div>

            <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

            {/* Running Jobs */}
            <div className="flex justify-between items-center">
              <span style={{ fontSize: 14, color: "#8b949e", fontWeight: 500 }}>Running Jobs</span>
              <span style={{ fontSize: 20, fontWeight: 600, color: "#38bdf8" }}>
                {jobs.filter(j => j.status === "RUNNING").length}
              </span>
            </div>

            <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

            {/* Total Jobs */}
            <div className="flex justify-between items-center">
              <span style={{ fontSize: 14, color: "#8b949e", fontWeight: 500 }}>Total Jobs</span>
              <span style={{ fontSize: 18, fontWeight: 500, color: "#f0f6fc" }}>{jobs.length}</span>
            </div>

            <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

            {/* Worker Load */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <span style={{ fontSize: 12, fontWeight: 600, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Worker Load
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f0f6fc" }}>{workerLoad}%</span>
              </div>
              <div
                className="w-full rounded-full overflow-hidden"
                style={{ height: 8, background: "rgba(255,255,255,0.06)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${workerLoad}%`,
                    background: workerLoad > 80
                      ? "linear-gradient(90deg, #ef4444, #f87171)"
                      : workerLoad > 50
                        ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                        : "linear-gradient(90deg, #22c55e, #4ade80)",
                    boxShadow: "0 0 10px rgba(56,189,248,0.3)",
                    transition: "width 0.6s ease-out",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
