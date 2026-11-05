import { useProjectAccess } from "../../hooks/useProjectAccess";
import { useAuth } from "../../hooks/useAuth";
/* eslint-disable no-unused-vars */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  History,
  Calendar,
  FileCode2,
  Sparkles,
  AlertCircle,
  Search,
  Filter,
  Users,
  ChevronDown,
  ChevronRight,
  Terminal,
  ExternalLink,
  Info,
  Check,
  ShieldCheck,
  FolderGit2,
  Code2,
  Zap,
} from "lucide-react";
import {
  getUserJobsApi,
  getProjectJobsApi,
  cancelJobApi,
} from "../../services/job.service";
import { getProjectEventsApi } from "../../services/project.service";
import { JobsListSkeleton } from "../common/Skeleton";

/* ── Helpers: map backend enums to UI props ────────────────── */

const JOB_TYPE_CONFIG = {
  SYSTEM_TEST_IMPROVEMENT: {
    label: "AI Test Improvement",
    icon: Sparkles,
    taskLabel: "Generating tests and verifying measured coverage gains",
    category: "ai",
  },
  SYSTEM_TEST_ASSESSMENT: {
    label: "System Test Assessment",
    icon: TestTube2,
    taskLabel: "Running independent tests and measuring coverage",
    category: "test",
  },
  INGEST: {
    label: "Source Ingest",
    icon: PackageOpen,
    taskLabel: "Extracting and indexing source files",
    category: "system",
  },
  INSTALL_DEPS: {
    label: "Install Dependencies",
    icon: Wrench,
    taskLabel: "Installing project dependencies via package manager",
    category: "system",
  },
  RUN_TESTS: {
    label: "Run Tests",
    icon: TestTube2,
    taskLabel: "Running test suite with coverage collection",
    category: "test",
  },
  SUPERTEST_COVERAGE: {
    label: "Supertest Coverage",
    icon: TestTube2,
    taskLabel: "Running Supertest integration coverage analysis",
    category: "test",
  },
  PARSE_COVERAGE: {
    label: "Parse Coverage",
    icon: Activity,
    taskLabel: "Parsing coverage report and AST mapping data",
    category: "test",
  },
  BUILD_CFG: {
    label: "Build CFG",
    icon: Cpu,
    taskLabel: "Generating Control Flow Graphs from source AST",
    category: "code",
  },
  AI_SUGGEST: {
    label: "AI Suggestions",
    icon: BrainCircuit,
    taskLabel: "Generating AI test & improvement suggestions",
    category: "ai",
  },
  AI_EVALUATION: {
    label: "Chatbot Evaluation",
    icon: BrainCircuit,
    taskLabel: "Evaluating project chatbot against benchmark",
    category: "ai",
  },
  AI_EVALUATION_PREPARE: {
    label: "Evaluation Preparation",
    icon: BrainCircuit,
    taskLabel: "Preparing evaluation knowledge or benchmark proposal",
    category: "ai",
  },
  AI_TESTS: {
    label: "AI Test Generator",
    icon: BrainCircuit,
    taskLabel: "Synthesizing AI test scenarios and edge cases",
    category: "ai",
  },
  CODE_HYGIENE: {
    label: "Code Hygiene",
    icon: Activity,
    taskLabel: "Analyzing code hygiene, linter and quality metrics",
    category: "code",
  },
  PERFORMANCE_ANALYSIS: {
    label: "Performance Analysis",
    icon: Activity,
    taskLabel: "Analyzing runtime performance metrics",
    category: "code",
  },
  ANALYSIS: {
    label: "Project Analysis",
    icon: Activity,
    taskLabel: "Analyzing project structure and architecture",
    category: "code",
  },
  QUALITY_ANALYSIS: {
    label: "Quality Analysis",
    icon: Activity,
    taskLabel: "Evaluating AI generated tests and coverage",
    category: "code",
  },
  SECURITY_ANALYSIS: {
    label: "Security Analysis",
    icon: ShieldCheck,
    taskLabel: "Scanning for security vulnerabilities and CVEs",
    category: "code",
  },
  RUN_VITEST_TESTS: {
    label: "Run Vitest",
    icon: TestTube2,
    taskLabel: "Executing Vitest test suite",
    category: "test",
  },
  VITEST_COVERAGE: {
    label: "Vitest Coverage",
    icon: TestTube2,
    taskLabel: "Collecting Vitest execution coverage",
    category: "test",
  },
  SYSTEM_TEST_ANALYSIS: {
    label: "System Test Analysis",
    icon: Cpu,
    taskLabel: "Analyzing End-to-End system test runs",
    category: "test",
  },
  CYPRESS_SYSTEM_TEST: {
    label: "Cypress System Test",
    icon: TestTube2,
    taskLabel: "Running Cypress E2E browser tests",
    category: "test",
  },
  CYPRESS_SYSTEM_COVERAGE: {
    label: "Cypress Coverage",
    icon: TestTube2,
    taskLabel: "Running Cypress E2E coverage instrumentation",
    category: "test",
  },
  PLAYWRIGHT_SYSTEM_TEST: {
    label: "Playwright System Test",
    icon: TestTube2,
    taskLabel: "Running Playwright E2E browser tests",
    category: "test",
  },
  PLAYWRIGHT_SYSTEM_COVERAGE: {
    label: "Playwright Coverage",
    icon: TestTube2,
    taskLabel: "Running Playwright E2E coverage instrumentation",
    category: "test",
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

const EVENT_TYPE_MAP = {
  "workspace.changed": {
    label: "Workspace Mutated",
    icon: FileCode2,
    color: "var(--color-primary)",
    category: "workspace",
    desc: "Files, checkpoints or workspace state updated",
  },
  "job.updated": {
    label: "Task Updated",
    icon: Cpu,
    color: "var(--color-info)",
    category: "tasks",
    desc: "Background runner execution progress or completion",
  },
  "chat.message": {
    label: "Collaboration Chat",
    icon: Users,
    color: "var(--color-text-secondary)",
    category: "team",
    desc: "Message sent in collaboration session",
  },
  "invitation.changed": {
    label: "Project Invitation",
    icon: Users,
    color: "var(--color-warning)",
    category: "team",
    desc: "Team member invitation created or updated",
  },
  "member.changed": {
    label: "Member Access",
    icon: ShieldCheck,
    color: "var(--color-success)",
    category: "team",
    desc: "Project role or member membership modified",
  },
};

function getJobVisual(job) {
  const typeConf = JOB_TYPE_CONFIG[job.type] || {
    label: job.type || "Task",
    icon: Activity,
    taskLabel: "Executing background task",
    category: "system",
  };
  const statusConf = JOB_STATUS_CONFIG[job.status] || JOB_STATUS_CONFIG.QUEUED;

  return {
    color: statusConf.color,
    bg: statusConf.bg,
    border: statusConf.border,
    Icon: typeConf.icon,
    typeLabel: typeConf.label,
    taskLabel: typeConf.taskLabel,
    statusLabel: statusConf.label,
    category: typeConf.category,
  };
}

/* ── Polling intervals (ms) ───────────────────────────── */
const POLL_FAST = 3000;
const POLL_SLOW = 12000;

/* ── Component ─────────────────────────────────────────────── */
export default function JobQueue({ projectId, onSync }) {
  const projectAccess = useProjectAccess(projectId);
  const { userId } = useAuth();

  // Active view: "activity" (Activity Log & Audit Trail) | "tasks" (Task Queue & Runners)
  const [activeTab, setActiveTab] = useState("activity");

  /* ── Activity / Events State ─────────────────────────────── */
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [errorEvents, setErrorEvents] = useState(null);
  const [eventCategoryFilter, setEventCategoryFilter] = useState("ALL"); // ALL | tasks | workspace | team
  const [activitySearch, setActivitySearch] = useState("");
  const [expandedEventId, setExpandedEventId] = useState(null);

  /* ── Job Queue State ─────────────────────────────────────── */
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [errorJobs, setErrorJobs] = useState(null);
  const [filterJobs, setFilterJobs] = useState("ALL"); // ALL | ACTIVE | COMPLETED | FAILED
  const [cancelingJobId, setCancelingJobId] = useState(null);
  const [selectedJobForModal, setSelectedJobForModal] = useState(null);
  const intervalRef = useRef(null);

  /* ── Fetch Handlers ──────────────────────────────────────── */

  const fetchEvents = useCallback(
    async (silent = false) => {
      if (!projectId) return;
      if (!silent) setLoadingEvents(true);
      setErrorEvents(null);
      try {
        const res = await getProjectEventsApi(projectId, { after: 0, limit: 100 });
        if (res?.success && res?.data?.events) {
          // Sort reverse chronological
          const sorted = [...res.data.events].reverse();
          setEvents(sorted);
        } else {
          setEvents([]);
        }
      } catch (err) {
        // If event endpoint is not supported yet or 404, fall back gracefully
        console.warn("Could not load project events:", err.message);
        setErrorEvents(err.message || "Failed to load project activity");
      } finally {
        setLoadingEvents(false);
      }
    },
    [projectId],
  );

  const fetchJobs = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingJobs(true);
      setErrorJobs(null);
      try {
        let jobList = [];
        if (projectId) {
          try {
            const projectJobsRes = await getProjectJobsApi(projectId);
            if (projectJobsRes?.jobs) {
              jobList = projectJobsRes.jobs;
            }
          } catch (_) {
            // fallback to user jobs
            const userJobsRes = await getUserJobsApi();
            jobList = userJobsRes?.jobs || [];
          }
        } else {
          const userJobsRes = await getUserJobsApi();
          jobList = userJobsRes?.jobs || [];
        }

        const visibleJobs = jobList.filter(
          (job) => !["PERFORMANCE_ANALYSIS", "CODE_HYGIENE"].includes(job.type),
        );
        setJobs(visibleJobs);
      } catch (err) {
        setErrorJobs(err.message || "Failed to load jobs");
      } finally {
        setLoadingJobs(false);
      }
    },
    [projectId],
  );

  const handleRefreshAll = async () => {
    await Promise.all([fetchEvents(), fetchJobs()]);
  };

  const handleCancelJob = async (jobId) => {
    const job = jobs.find((row) => row.id === jobId);
    if (
      !projectAccess.can("tests.run") ||
      (projectAccess.role !== "OWNER" && job?.userId !== userId)
    ) {
      return;
    }
    try {
      setCancelingJobId(jobId);
      await cancelJobApi(jobId);
      await fetchJobs(true);
    } catch (err) {
      setErrorJobs(err.message || "Failed to cancel task");
    } finally {
      setCancelingJobId(null);
    }
  };

  /* ── Initial Fetch & Polling ─────────────────────────────── */
  useEffect(() => {
    fetchEvents();
    fetchJobs();

    intervalRef.current = setInterval(() => {
      fetchJobs(true);
      fetchEvents(true);
    }, POLL_FAST);

    return () => clearInterval(intervalRef.current);
  }, [fetchEvents, fetchJobs]);

  // Adjust polling speed according to active jobs
  useEffect(() => {
    const hasActive = jobs.some((j) => ["QUEUED", "RUNNING"].includes(j.status));
    const interval = hasActive ? POLL_FAST : POLL_SLOW;

    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      fetchJobs(true);
      fetchEvents(true);
    }, interval);

    return () => clearInterval(intervalRef.current);
  }, [jobs, fetchJobs, fetchEvents]);

  /* ── Derived Job & Activity Metrics ──────────────────────── */
  const activeJobs = useMemo(
    () => jobs.filter((j) => ["QUEUED", "RUNNING"].includes(j.status)),
    [jobs],
  );
  const completedJobs = useMemo(
    () => jobs.filter((j) => j.status === "SUCCESS"),
    [jobs],
  );
  const failedJobs = useMemo(
    () => jobs.filter((j) => j.status === "FAILED"),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    if (filterJobs === "ALL") return jobs;
    if (filterJobs === "ACTIVE") return activeJobs;
    if (filterJobs === "COMPLETED") return completedJobs;
    if (filterJobs === "FAILED") return failedJobs;
    return jobs;
  }, [jobs, filterJobs, activeJobs, completedJobs, failedJobs]);

  // Combine jobs and events into an unified chronological activity feed
  const unifiedActivities = useMemo(() => {
    const list = [];

    // Add server events
    events.forEach((evt) => {
      const typeInfo = EVENT_TYPE_MAP[evt.type] || {
        label: evt.type || "System Event",
        icon: Activity,
        color: "var(--color-text-secondary)",
        category: "workspace",
        desc: "Project system event",
      };

      list.push({
        id: `evt-${evt.id || evt.sequence}`,
        source: "EVENT",
        sequence: evt.sequence,
        type: evt.type,
        title: typeInfo.label,
        description:
          evt.payload?.message ||
          evt.payload?.description ||
          evt.payload?.action ||
          typeInfo.desc,
        category: typeInfo.category,
        timestamp: evt.createdAt,
        actor: evt.actorId ? `User #${evt.actorId.slice(-4)}` : "System",
        status: "RECORDED",
        Icon: typeInfo.icon,
        color: typeInfo.color,
        raw: evt,
      });
    });

    // Add jobs as activities
    jobs.forEach((job) => {
      const visual = getJobVisual(job);
      list.push({
        id: `job-${job.id}`,
        source: "JOB",
        sequence: job.id,
        type: job.type,
        title: visual.typeLabel,
        description: job.params?.label || job.error || visual.taskLabel,
        category: visual.category === "test" || visual.category === "ai" ? "tasks" : "workspace",
        timestamp: job.createdAt || job.startedAt,
        actor: job.userId ? `User #${job.userId.slice(-4)}` : "Runner",
        status: job.status,
        Icon: visual.Icon,
        color: visual.color,
        raw: job,
      });
    });

    // Sort descending by timestamp
    list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    return list;
  }, [events, jobs]);

  // Filter activities
  const filteredActivities = useMemo(() => {
    return unifiedActivities.filter((act) => {
      if (eventCategoryFilter !== "ALL" && act.category !== eventCategoryFilter) {
        return false;
      }
      if (activitySearch.trim()) {
        const q = activitySearch.toLowerCase();
        const matchTitle = act.title?.toLowerCase().includes(q);
        const matchDesc = act.description?.toLowerCase().includes(q);
        const matchActor = act.actor?.toLowerCase().includes(q);
        const matchType = act.type?.toLowerCase().includes(q);
        return matchTitle || matchDesc || matchActor || matchType;
      }
      return true;
    });
  }, [unifiedActivities, eventCategoryFilter, activitySearch]);

  /* ── Format Helpers ──────────────────────────────────────── */
  const formatDateTime = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const formatRelativeTime = (dateStr) => {
    if (!dateStr) return "—";
    const now = new Date();
    const d = new Date(dateStr);
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 5) return "Just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDays = Math.floor(diffHour / 24);
    return `${diffDays}d ago`;
  };

  const formatDuration = (start, end) => {
    if (!start) return "—";
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    const diffMs = Math.max(0, e - s);
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${mins}m ${secs}s`;
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
              Activity Log & Task Queue
            </h1>
            <span
              className="px-2 py-0.5 rounded-[var(--radius-sm)] text-[11px] font-medium"
              style={{
                background: "var(--color-surface-secondary)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
              }}
            >
              Activity History & Progress
            </span>
            {activeJobs.length > 0 && (
              <span
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] text-[11px] font-semibold"
                style={{
                  background: "rgba(2, 132, 199, 0.12)",
                  color: "var(--color-info)",
                  border: "1px solid rgba(2, 132, 199, 0.25)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-info)] animate-pulse" />
                {activeJobs.length} running
              </span>
            )}
          </div>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
            Track workspace operations, source mutations, and background task queues.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRefreshAll}
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] text-xs font-medium cursor-pointer transition-colors hover:bg-[var(--color-surface-secondary)]"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
              padding: "7px 14px",
            }}
            title="Refresh activity history and task queue"
          >
            <RefreshCw
              size={13}
              className={loadingEvents || loadingJobs ? "animate-spin" : ""}
            />
            <span>Refresh</span>
          </motion.button>
        </div>
      </div>

      {/* ── KPI Stat Cards (Solid design tokens, no gradients) ──── */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3.5"
        style={{ marginBottom: 20 }}
      >
        {/* Total Activities */}
        <div
          className="rounded-[var(--radius-lg)] p-3.5 flex flex-col justify-between"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Total Activities
            </span>
            <History size={15} style={{ color: "var(--color-primary)" }} />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-xl font-bold font-mono"
              style={{ color: "var(--color-text)" }}
            >
              {unifiedActivities.length}
            </span>
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              events recorded
            </span>
          </div>
        </div>

        {/* Active Jobs */}
        <div
          className="rounded-[var(--radius-lg)] p-3.5 flex flex-col justify-between"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Active Tasks
            </span>
            <Cpu size={15} style={{ color: "var(--color-info)" }} />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-xl font-bold font-mono"
              style={{
                color:
                  activeJobs.length > 0
                    ? "var(--color-info)"
                    : "var(--color-text)",
              }}
            >
              {activeJobs.length}
            </span>
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              in runner queue
            </span>
          </div>
        </div>

        {/* Completed Jobs */}
        <div
          className="rounded-[var(--radius-lg)] p-3.5 flex flex-col justify-between"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Completed
            </span>
            <CheckCircle2 size={15} style={{ color: "var(--color-success)" }} />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-xl font-bold font-mono"
              style={{ color: "var(--color-success)" }}
            >
              {completedJobs.length}
            </span>
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              tasks succeeded
            </span>
          </div>
        </div>

        {/* Failed / Issues */}
        <div
          className="rounded-[var(--radius-lg)] p-3.5 flex flex-col justify-between"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Failed / Errors
            </span>
            <XCircle
              size={15}
              style={{
                color:
                  failedJobs.length > 0
                    ? "var(--color-danger)"
                    : "var(--color-text-muted)",
              }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-xl font-bold font-mono"
              style={{
                color:
                  failedJobs.length > 0
                    ? "var(--color-danger)"
                    : "var(--color-text)",
              }}
            >
              {failedJobs.length}
            </span>
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              require inspection
            </span>
          </div>
        </div>
      </div>

      {/* ── Tab Switcher: Activity Log vs Task Queue ────────────── */}
      <div
        className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2.5"
        style={{ marginBottom: 20 }}
      >
        <button
          onClick={() => setActiveTab("activity")}
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-3.5 py-1.5 text-xs font-semibold cursor-pointer transition-colors"
          style={{
            background:
              activeTab === "activity"
                ? "var(--color-surface-secondary)"
                : "transparent",
            color:
              activeTab === "activity"
                ? "var(--color-text)"
                : "var(--color-text-muted)",
            border:
              activeTab === "activity"
                ? "1px solid var(--color-border)"
                : "1px solid transparent",
          }}
        >
          <History
            size={13}
            style={{
              color:
                activeTab === "activity"
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
            }}
          />
          <span>Activity Log</span>
          <span
            className="rounded-full px-1.5 py-0.2 text-[10px] font-mono font-medium"
            style={{
              background:
                activeTab === "activity"
                  ? "rgba(109, 93, 251, 0.12)"
                  : "var(--color-surface-secondary)",
              color:
                activeTab === "activity"
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
            }}
          >
            {unifiedActivities.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("tasks")}
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-3.5 py-1.5 text-xs font-semibold cursor-pointer transition-colors"
          style={{
            background:
              activeTab === "tasks"
                ? "var(--color-surface-secondary)"
                : "transparent",
            color:
              activeTab === "tasks"
                ? "var(--color-text)"
                : "var(--color-text-muted)",
            border:
              activeTab === "tasks"
                ? "1px solid var(--color-border)"
                : "1px solid transparent",
          }}
        >
          <Cpu
            size={13}
            style={{
              color:
                activeTab === "tasks"
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
            }}
          />
          <span>Task Queue</span>
          {activeJobs.length > 0 ? (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-semibold"
              style={{
                background: "rgba(2, 132, 199, 0.12)",
                color: "var(--color-info)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-info)]" />
              {activeJobs.length} running
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

      {/* ── TAB 1: ACTIVITY LOG & AUDIT TRAIL ────────────────────── */}
      {activeTab === "activity" && (
        <div className="flex flex-col gap-4">
          {/* Filters & Search Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Category pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: "ALL", label: "All" },
                { id: "tasks", label: "Tasks & Testing" },
                { id: "workspace", label: "Source & Checkpoints" },
                { id: "team", label: "Members & Access" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setEventCategoryFilter(tab.id)}
                  className="rounded-[var(--radius-md)] text-xs font-medium px-3 py-1.5 cursor-pointer transition-colors whitespace-nowrap"
                  style={{
                    background:
                      eventCategoryFilter === tab.id
                        ? "var(--color-surface-secondary)"
                        : "transparent",
                    color:
                      eventCategoryFilter === tab.id
                        ? "var(--color-text)"
                        : "var(--color-text-muted)",
                    border:
                      eventCategoryFilter === tab.id
                        ? "1px solid var(--color-border)"
                        : "1px solid transparent",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div
              className="flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                width: 260,
              }}
            >
              <Search size={13} style={{ color: "var(--color-text-muted)" }} />
              <input
                type="text"
                placeholder="Search operations, tasks, events..."
                value={activitySearch}
                onChange={(e) => setActivitySearch(e.target.value)}
                className="bg-transparent border-none text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none w-full"
              />
              {activitySearch && (
                <button
                  onClick={() => setActivitySearch("")}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Loading state */}
          {(loadingEvents || loadingJobs) && unifiedActivities.length === 0 && (
            <JobsListSkeleton count={4} />
          )}

          {/* Empty state */}
          {!loadingEvents && !loadingJobs && filteredActivities.length === 0 && (
            <div
              className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] p-12 text-center"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <History
                size={36}
                style={{ color: "var(--color-text-muted)", marginBottom: 10 }}
              />
              <p
                style={{
                  color: "var(--color-text)",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                No activity recorded yet
              </p>
              <p
                style={{
                  color: "var(--color-text-secondary)",
                  fontSize: 12,
                  marginTop: 4,
                  maxWidth: 400,
                }}
              >
                {activitySearch || eventCategoryFilter !== "ALL"
                  ? "No activity matches the current filters."
                  : "File changes, checkpoints, test runs, and background tasks will appear here in chronological order."}
              </p>
            </div>
          )}

          {/* Activities Timeline Feed */}
          <div className="flex flex-col gap-2.5">
            {filteredActivities.map((act) => {
              const isExpanded = expandedEventId === act.id;
              const Icon = act.Icon;

              return (
                <div
                  key={act.id}
                  className="rounded-[var(--radius-md)] border transition-all"
                  style={{
                    background: "var(--color-surface)",
                    borderColor: isExpanded
                      ? "var(--color-primary)"
                      : "var(--color-border)",
                  }}
                >
                  <div
                    onClick={() =>
                      setExpandedEventId(isExpanded ? null : act.id)
                    }
                    className="p-3.5 flex items-start sm:items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Event Icon badge */}
                      <div
                        className="w-8 h-8 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0"
                        style={{
                          background: "var(--color-surface-secondary)",
                          color: act.color,
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <Icon size={15} />
                      </div>

                      {/* Info & Title */}
                      <div className="min-w-0 flex flex-col">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="font-semibold text-xs truncate"
                            style={{ color: "var(--color-text)" }}
                          >
                            {act.title}
                          </span>
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.2 rounded"
                            style={{
                              background: "var(--color-surface-secondary)",
                              color: "var(--color-text-secondary)",
                              border: "1px solid var(--color-border)",
                            }}
                          >
                            {act.type}
                          </span>
                          {act.status && act.status !== "RECORDED" && (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.2 rounded uppercase"
                              style={{
                                color:
                                  act.status === "SUCCESS"
                                    ? "var(--color-success)"
                                    : act.status === "FAILED"
                                      ? "var(--color-danger)"
                                      : "var(--color-info)",
                                background:
                                  act.status === "SUCCESS"
                                    ? "rgba(22, 163, 74, 0.12)"
                                    : act.status === "FAILED"
                                      ? "rgba(220, 38, 38, 0.12)"
                                      : "rgba(2, 132, 199, 0.12)",
                              }}
                            >
                              {act.status}
                            </span>
                          )}
                        </div>
                        <p
                          className="text-xs truncate mt-0.5"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          {act.description}
                        </p>
                      </div>
                    </div>

                    {/* Metadata & Timestamp */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="flex flex-col items-end text-right">
                        <span
                          className="text-xs font-medium"
                          style={{ color: "var(--color-text)" }}
                        >
                          {formatRelativeTime(act.timestamp)}
                        </span>
                        <span
                          className="text-[11px] font-mono"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {act.actor}
                        </span>
                      </div>

                      <button
                        className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        title={isExpanded ? "Collapse details" : "Expand details"}
                      >
                        {isExpanded ? (
                          <ChevronDown size={15} />
                        ) : (
                          <ChevronRight size={15} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Detail Accordion */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="px-4 pb-4 pt-1 border-t border-[var(--color-border)]"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs mb-3 mt-2">
                          <div>
                            <span
                              className="text-[11px] font-medium"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              Execution Time:
                            </span>
                            <div
                              className="font-mono mt-0.5"
                              style={{ color: "var(--color-text)" }}
                            >
                              {formatDateTime(act.timestamp)}
                            </div>
                          </div>
                          <div>
                            <span
                              className="text-[11px] font-medium"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              Source:
                            </span>
                            <div
                              className="font-mono mt-0.5"
                              style={{ color: "var(--color-text)" }}
                            >
                              {act.source === "JOB"
                                ? "Task Queue Runner"
                                : "Project Event Log"}
                            </div>
                          </div>
                          <div>
                            <span
                              className="text-[11px] font-medium"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              Identifier:
                            </span>
                            <div
                              className="font-mono mt-0.5 truncate"
                              style={{ color: "var(--color-text)" }}
                            >
                              {act.sequence || act.raw?.id || act.id}
                            </div>
                          </div>
                        </div>

                        {/* Raw JSON or Parameters payload */}
                        <div className="mt-2">
                          <span
                            className="text-[11px] font-medium mb-1 block"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            Detailed Payload / Context:
                          </span>
                          <pre
                            className="p-2.5 rounded-[var(--radius-sm)] text-[11px] font-mono overflow-x-auto max-h-48"
                            style={{
                              background: "var(--color-surface-secondary)",
                              color: "var(--color-text-secondary)",
                              border: "1px solid var(--color-border)",
                            }}
                          >
                            {JSON.stringify(
                              act.raw?.payload ||
                                act.raw?.params ||
                                act.raw?.error ||
                                act.raw,
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB 2: TASK QUEUE & BACKGROUND RUNNERS ──────────────── */}
      {activeTab === "tasks" && (
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
                  ? `All Tasks (${jobs.length})`
                  : filterJobs === "ACTIVE"
                    ? `Running (${activeJobs.length})`
                    : filterJobs === "COMPLETED"
                      ? `Completed (${completedJobs.length})`
                      : `Failed (${failedJobs.length})`}
              </h2>
              <div className="flex items-center gap-1.5">
                {[
                  { id: "ALL", label: "All" },
                  { id: "ACTIVE", label: "Running" },
                  { id: "COMPLETED", label: "Completed" },
                  { id: "FAILED", label: "Failed" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilterJobs(f.id)}
                    className="rounded-[var(--radius-md)] transition-colors cursor-pointer"
                    style={{
                      background:
                        filterJobs === f.id
                          ? "var(--color-surface-secondary)"
                          : "transparent",
                      border:
                        filterJobs === f.id
                          ? "1px solid var(--color-border)"
                          : "1px solid transparent",
                      color:
                        filterJobs === f.id
                          ? "var(--color-text)"
                          : "var(--color-text-muted)",
                      fontSize: 12,
                      fontWeight: 500,
                      padding: "4px 10px",
                    }}
                  >
                    {f.label}
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
                <span>{errorJobs}</span>
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
                  No tasks found
                </p>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {filterJobs !== "ALL"
                    ? "Try adjusting the filter."
                    : "Background tasks will appear here when running tests or automated analysis."}
                </p>
              </div>
            )}

            {/* Job Cards */}
            <div className="flex flex-col gap-3">
              <AnimatePresence mode="popLayout">
                {filteredJobs.map((job, idx) => {
                  const visual = getJobVisual(job);
                  const isActive = ["QUEUED", "RUNNING"].includes(job.status);
                  const canCancel =
                    isActive &&
                    (projectAccess.can("tests.run") ||
                      projectAccess.role === "OWNER" ||
                      job?.userId === userId);

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
                        duration: 0.2,
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

                      {/* Header Row */}
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0"
                            style={{
                              background: visual.bg,
                              border: `1px solid ${visual.border}`,
                              color: visual.color,
                            }}
                          >
                            <visual.Icon size={16} />
                          </div>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "var(--color-text)",
                                }}
                              >
                                {visual.typeLabel}
                              </span>
                              <span
                                className="font-mono text-[10px] px-1.5 py-0.2 rounded"
                                style={{
                                  background: "var(--color-surface-secondary)",
                                  color: "var(--color-text-secondary)",
                                  border: "1px solid var(--color-border)",
                                }}
                              >
                                #{job.id.slice(0, 8)}
                              </span>
                            </div>
                            <p
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-secondary)",
                                marginTop: 1,
                              }}
                            >
                              {visual.taskLabel}
                            </p>
                          </div>
                        </div>

                        {/* Status Badge & Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span
                            className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
                            style={{
                              background: visual.bg,
                              color: visual.color,
                              border: `1px solid ${visual.border}`,
                            }}
                          >
                            {isActive ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: visual.color }}
                              />
                            )}
                            {visual.statusLabel}
                          </span>

                          {canCancel && (
                            <button
                              onClick={() => handleCancelJob(job.id)}
                              disabled={cancelingJobId === job.id}
                              className="text-xs px-2 py-1 rounded text-[var(--color-danger)] hover:bg-[rgba(220,38,38,0.1)] transition-colors cursor-pointer"
                              title="Cancel task"
                            >
                              {cancelingJobId === job.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                "Cancel"
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar (if running) */}
                      {isActive && (
                        <div className="my-2">
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span style={{ color: "var(--color-text-muted)" }}>
                              {job.status === "QUEUED"
                                ? "Waiting for available worker..."
                                : "Executing runner process..."}
                            </span>
                            <span
                              className="font-mono font-medium"
                              style={{ color: "var(--color-info)" }}
                            >
                              {job.progress ? `${job.progress}%` : "In flight"}
                            </span>
                          </div>
                          <div
                            className="w-full h-1.5 rounded-full overflow-hidden"
                            style={{ background: "var(--color-surface-secondary)" }}
                          >
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: job.progress ? `${job.progress}%` : "50%",
                                background: "var(--color-info)",
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Failure / Error Snippet */}
                      {job.status === "FAILED" && job.error && (
                        <div
                          className="my-2 p-2.5 rounded-[var(--radius-sm)] flex items-start justify-between gap-2 text-xs"
                          style={{
                            background: "rgba(220, 38, 38, 0.08)",
                            border: "1px solid rgba(220, 38, 38, 0.2)",
                            color: "var(--color-danger)",
                          }}
                        >
                          <div className="flex items-start gap-1.5 overflow-hidden">
                            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                            <span className="font-mono text-[11px] truncate">
                              {job.error}
                            </span>
                          </div>
                          <button
                            onClick={() => setSelectedJobForModal(job)}
                            className="underline text-[11px] whitespace-nowrap hover:opacity-80 cursor-pointer"
                          >
                            Details
                          </button>
                        </div>
                      )}

                      {/* Metadata Footer */}
                      <div
                        className="flex items-center justify-between gap-4 pt-2 mt-1 border-t border-[var(--color-border)] text-[11px]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Calendar size={11} />
                            {formatDateTime(job.createdAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {formatDuration(job.startedAt || job.createdAt, job.completedAt)}
                          </span>
                        </div>

                        {job.status === "FAILED" && (
                          <button
                            onClick={() => setSelectedJobForModal(job)}
                            className="text-[var(--color-primary)] hover:underline font-medium cursor-pointer"
                          >
                            View error log
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Column: Runner Health & Metrics */}
          <div className="flex flex-col gap-4">
            <div
              className="rounded-[var(--radius-lg)] p-4 flex flex-col gap-3.5"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border)]">
                <span
                  className="font-semibold text-xs"
                  style={{ color: "var(--color-text)" }}
                >
                  Runner Health & System Load
                </span>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(22, 163, 74, 0.12)",
                    color: "var(--color-success)",
                  }}
                >
                  Online
                </span>
              </div>

              <div className="flex flex-col gap-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Worker Status
                  </span>
                  <span
                    className="font-semibold"
                    style={{
                      color:
                        activeJobs.length > 0
                          ? "var(--color-info)"
                          : "var(--color-success)",
                    }}
                  >
                    {activeJobs.length > 0 ? "Busy (Processing)" : "Idle (Ready)"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Success Rate
                  </span>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: "var(--color-text)" }}
                  >
                    {jobs.length > 0
                      ? `${Math.round((completedJobs.length / jobs.length) * 100)}%`
                      : "100%"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Sync Polling
                  </span>
                  <span
                    className="font-mono text-[11px]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {activeJobs.length > 0 ? `${POLL_FAST / 1000}s` : `${POLL_SLOW / 1000}s`}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick tips */}
            <div
              className="rounded-[var(--radius-lg)] p-4 flex flex-col gap-2"
              style={{
                background: "var(--color-surface-secondary)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Info size={13} style={{ color: "var(--color-primary)" }} />
                <span>Version Control Note</span>
              </div>
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: "var(--color-text-secondary)" }}
              >
                The <strong>Snapshot & Checkpoint</strong> features have been consolidated into the <strong>Version Control</strong> tab on the left navigation bar.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Error Detail Inspection Modal ───────────────────────── */}
      <AnimatePresence>
        {selectedJobForModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0, 0, 0, 0.5)" }}
            onClick={() => setSelectedJobForModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-xl rounded-[var(--radius-lg)] overflow-hidden shadow-xl"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} style={{ color: "var(--color-danger)" }} />
                  <h3
                    className="font-bold text-sm"
                    style={{ color: "var(--color-text)" }}
                  >
                    Task Error Details #{selectedJobForModal.id.slice(0, 8)}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedJobForModal(null)}
                  className="text-xs p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 flex flex-col gap-3">
                <div className="text-xs flex flex-col gap-1">
                  <span
                    className="font-medium text-[11px]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Task Type:
                  </span>
                  <span
                    className="font-semibold"
                    style={{ color: "var(--color-text)" }}
                  >
                    {JOB_TYPE_CONFIG[selectedJobForModal.type]?.label ||
                      selectedJobForModal.type}
                  </span>
                </div>

                <div className="text-xs flex flex-col gap-1">
                  <span
                    className="font-medium text-[11px]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Error Message / Stack Trace:
                  </span>
                  <pre
                    className="p-3 rounded-[var(--radius-sm)] text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-60"
                    style={{
                      background: "rgba(220, 38, 38, 0.08)",
                      border: "1px solid rgba(220, 38, 38, 0.2)",
                      color: "var(--color-danger)",
                    }}
                  >
                    {selectedJobForModal.error || "No detailed stack trace available"}
                  </pre>
                </div>
              </div>

              <div className="p-3.5 border-t border-[var(--color-border)] flex justify-end">
                <button
                  onClick={() => setSelectedJobForModal(null)}
                  className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] cursor-pointer"
                  style={{
                    background: "var(--color-surface-secondary)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                  }}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
