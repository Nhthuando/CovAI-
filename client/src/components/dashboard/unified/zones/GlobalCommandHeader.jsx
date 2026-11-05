import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Play,
  Sparkles,
  Download,
  GitBranch,
  Clock,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Loader2,
  X,
  ShieldCheck,
  Check
} from "lucide-react";
import { useToast } from "../../ToastContext.jsx";
import { QualityGateBadge } from "../primitives/QualityGateBadge.jsx";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { ExportReportModal } from "../modals/ExportReportModal.jsx";
import { Button } from "../../../common/Button.jsx";
import ConfirmDialog from "../../../common/ConfirmDialog.jsx";
import { fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";
import { activateProjectSnapshotApi, createProjectSnapshotApi } from "../../../../services/project.service.js";

export function GlobalCommandHeader({
  vm,
  projects = [],
  onSelectProject,
  onSelectSnapshot,
  runAllState,
  onNavigateWorkspace,
  isSyncing = false,
  onForceRefresh = null,
  liveRuns = {},
  isSocketConnected = false,
  className = "",
}) {
  const navigate = useNavigate();
  const { addToast } = useToast?.() || {};
  const [showConfirmRun, setShowConfirmRun] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const {
    runAll,
    isRunning,
    activeStep,
    stepStates,
    stepProgress,
    overallPercent = 0,
    readinessGate,
    resolveHitlAction,
    runReadySuitesOnly,
    closeReadinessGate,
    cancelRemaining,
  } = runAllState || {};

  const handleSnapshotChange = async (e) => {
    const newSnapshotId = e.target.value;
    if (!newSnapshotId || newSnapshotId === context.snapshotId) return;

    if (context.projectId) {
      try {
        await activateProjectSnapshotApi(context.projectId, newSnapshotId);
      } catch (err) {
        console.warn("[GlobalCommandHeader] Failed to activate snapshot on backend:", err);
      }
    }
    onSelectSnapshot?.(newSnapshotId);
  };

  const handleCreateSnapshot = async () => {
    if (isCreatingSnapshot || !context.projectId) return;
    setIsCreatingSnapshot(true);
    try {
      const result = await createProjectSnapshotApi(context.projectId);
      const snap = result?.data || result?.snapshot || {};
      addToast?.({
        title: "Snapshot Created",
        message: snap.label || `Created Snapshot #${snap.versionNumber || ""}`,
        type: "success",
      });
      if (snap.id) {
        onSelectSnapshot?.(snap.id);
      }
    } catch (err) {
      if (err?.code === "SNAPSHOT_UNCHANGED" || err?.status === 409 || err?.message?.includes("hasn't changed")) {
        addToast?.({
          title: "Code Unchanged",
          message: err.message || "The code hasn't changed compared to the active snapshot.",
          type: "info",
        });
      } else {
        addToast?.({
          title: "Snapshot Creation Failed",
          message: err.message || "Failed to create snapshot.",
          type: "error",
        });
      }
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleManualRefresh = async () => {
    if (onForceRefresh) {
      await onForceRefresh();
      addToast?.({
        title: "Metrics Synchronized",
        message: "Unified quality dashboard refreshed with latest testing data.",
        type: "success",
      });
    }
  };

  const handleAiOptimize = () => {
    const actions = vm?.actions || [];
    if (actions.length > 0) {
      const highestPriorityAction = actions[0];
      const targetPillar = highestPriorityAction.pillar || "unit";
      if (onNavigateWorkspace) {
        onNavigateWorkspace(targetPillar, {
          actionId: highestPriorityAction.id,
          target: highestPriorityAction.target,
          type: highestPriorityAction.type,
        });
        return;
      }
      navigate(`/project/${context.projectId || ""}?tab=${targetPillar}&focusAction=${highestPriorityAction.id || ""}`);
    } else {
      if (onNavigateWorkspace) {
        onNavigateWorkspace("unit");
        return;
      }
      navigate(`/project/${context.projectId || ""}?tab=unit`);
    }
  };

  const context = vm?.context || {
    projectName: "CovAI Platform",
    snapshotId: "",
    branch: "main",
    updatedAt: new Date().toISOString(),
  };

  const qualityGate = vm?.qualityGate || {
    status: "NOT_RUN",
    label: "Quality Gate Pending",
    reasons: [],
    checklist: [],
  };

  const isGateOpen = Boolean(readinessGate?.isOpen);
  const gateData = readinessGate?.data;
  const suites = gateData?.suites || {};
  const loadingAction = readinessGate?.loadingAction;

  return (
    <header
      id="ud-zone-header"
      className={`relative bg-[var(--ud-surface)] border border-[var(--ud-border)] rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-sm)] transition-colors duration-150 ${className}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Left Column: Context Metadata & Project/Snapshot Switcher */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ud-text-muted)]">
            {/* Project Switcher */}
            {projects.length > 1 ? (
                            <select
                aria-label="Switch Active Project or View Portfolio"
                value={context.projectId || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__portfolio__") {
                    navigate("/projects");
                  } else if (val) {
                    onSelectProject?.(val);
                  }
                }}
                className="font-semibold text-xs rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] hover:border-[var(--color-primary)] py-0.5 px-2 focus:outline-none cursor-pointer transition-colors"
                title="Switch active project or return to Portfolio"
              >
                <option value="__portfolio__" className="bg-[var(--ud-surface)] text-[var(--ud-text-muted)] font-medium">
                  ⇄ View All Projects (Portfolio)
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[var(--ud-surface)] text-[var(--ud-text)]">
                    ● {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-semibold text-[var(--ud-text)] text-sm">
                {context.projectName}
              </span>
            )}

            <span className="text-[var(--ud-border)]">•</span>

            {/* Branch Badge */}
            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranch size={12} className="text-[var(--ud-text-muted)]" />
              <span>{context.branch || "main"}</span>
            </span>

            <span className="text-[var(--ud-border)]">•</span>

            {/* Snapshot Switcher & Version Badge */}
            <div className="inline-flex items-center gap-1.5 font-mono">
              <span className="text-[var(--ud-text-muted)]">Snapshot:</span>
              {Array.isArray(context.snapshots) && context.snapshots.length > 0 ? (
                <select
                  aria-label="Select Snapshot"
                  value={context.snapshotId || ""}
                  onChange={handleSnapshotChange}
                  className="bg-[var(--ud-surface-2)] border border-[var(--ud-border)] text-[var(--ud-text)] rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-mono font-medium hover:border-[var(--color-primary)] transition-colors cursor-pointer focus:outline-none"
                >
                  {context.snapshots.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[var(--ud-surface)] text-[var(--ud-text)]">
                      {s.label || `Snapshot #${s.versionNumber || s.id.slice(0, 7)}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold text-[var(--ud-text)]">
                  {context.snapshotLabel || context.snapshotId?.slice(0, 7) || "None"}
                </span>
              )}

              {/* Create Snapshot Button */}
              {context.projectId && (
                <button
                  type="button"
                  onClick={handleCreateSnapshot}
                  disabled={isCreatingSnapshot}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-sans font-medium rounded border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:border-[var(--color-primary)] transition-colors cursor-pointer disabled:opacity-50"
                  title="Create new snapshot checkpoint from current workspace"
                >
                  <Plus size={11} className={isCreatingSnapshot ? "animate-spin" : ""} />
                  <span className="hidden sm:inline">New</span>
                </button>
              )}
            </div>

            <span className="text-[var(--ud-border)]">•</span>

            {/* Last Synced / Updated At */}
            <span className="inline-flex items-center gap-1 text-[11px]">
              <Clock size={11} />
              <span>Updated {fmtRelativeTime(context.updatedAt)}</span>
            </span>

            {/* Manual Refresh Button */}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isSyncing}
              aria-label="Refresh dashboard metrics"
              className="inline-flex items-center justify-center p-1 rounded-[var(--radius-sm)] border border-[var(--ud-border)] hover:bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh dashboard metrics immediately"
            >
              <RefreshCw size={11} className={isSyncing ? "animate-spin text-[var(--color-primary)]" : ""} />
            </button>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ud-text)]">
            Testing Quality & Reliability Overview
          </h1>
        </div>

        {/* Right Column: Global Command Action Center */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Quality Gate Status */}
          <QualityGateBadge
            id="ud-header-quality-gate"
            status={qualityGate.status}
            label={qualityGate.label}
            reasons={qualityGate.reasons}
            checklist={qualityGate.checklist}
          />

          <div className="h-5 w-px bg-[var(--ud-border)] hidden sm:block" />

          {/* Action 1: Run All Suites */}
          <Button
            id="ud-header-run-all"
            variant="primary"
            size="sm"
            icon={Play}
            loading={isRunning || readinessGate?.isChecking}
            disabled={!context.snapshotId || isRunning}
            onClick={() => {
              if (readinessGate?.isOpen) {
                closeReadinessGate?.();
              } else {
                runAll?.();
              }
            }}
            title={!context.snapshotId ? "Select a snapshot first" : "Execute Unit, Integration, and System tests"}
          >
            {isRunning ? "Running Suites..." : readinessGate?.isChecking ? "Checking..." : "Run All Suites"}
          </Button>

          {/* Action 2: AI Optimize */}
          <Button
            id="ud-header-ai-optimize"
            variant="secondary"
            size="sm"
            icon={Sparkles}
            onClick={handleAiOptimize}
            title="Jump to the highest priority test gap or failure"
          >
            AI Optimize
          </Button>

          {/* Action 3: Export Report Modal Trigger */}
          <Button
            id="ud-header-export"
            variant="outline"
            size="sm"
            icon={Download}
            onClick={() => setShowExportModal(true)}
            className="ud-no-print"
          >
            Export Report
          </Button>
        </div>
      </div>

      {/* Real-time Socket Background Execution Telemetry Banner */}
      {!isRunning && Object.keys(liveRuns).length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--ud-border)] flex flex-wrap items-center justify-between gap-3 bg-[var(--ud-surface-2)]/50 p-2.5 rounded-[var(--radius-md)]">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-[var(--ud-text)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-ping" />
              Live Background Run:
            </span>
            {Object.values(liveRuns).map((run) => (
              <div key={run.jobId} className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--ud-border)] bg-[var(--ud-surface)]">
                <PillarBadge pillar={run.pillar || "unit"} size="sm" />
                <span className="font-mono text-[11px] font-semibold text-[var(--ud-text)]">
                  {run.status} {run.progress !== undefined ? `(${run.progress}%)` : ""}
                </span>
                {run.stage && (
                  <span className="text-[10px] text-[var(--ud-text-muted)] truncate max-w-[140px]">
                    {run.stage}
                  </span>
                )}
              </div>
            ))}
          </div>
          <span className="text-[11px] font-mono text-[var(--ud-text-muted)]">
            Socket.IO live
          </span>
        </div>
      )}

      {/* Real-Time Sequential Run Progress & Telemetry Bar */}
      {isRunning && (
        <div className="mt-4 pt-3 border-t border-[var(--ud-border)] flex flex-col gap-3 bg-[var(--ud-surface-2)]/60 p-3 rounded-[var(--radius-md)] border border-[var(--color-primary)]/20 animate-in fade-in duration-200">
          {/* Top row: Overall progress percentage & Cancel CTA */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-primary)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--color-primary)]" />
              </span>
              <span className="text-xs font-semibold text-[var(--ud-text)]">
                Executing Suites Pipeline — Overall Progress: {overallPercent}%
              </span>
            </div>

            <button
              type="button"
              onClick={cancelRemaining}
              className="text-xs font-mono text-[var(--ud-fail)] hover:underline cursor-pointer flex items-center gap-1 bg-[var(--ud-fail)]/10 px-2 py-0.5 rounded border border-[var(--ud-fail)]/30 hover:bg-[var(--ud-fail)]/20 transition-colors"
            >
              <X size={12} />
              <span>Cancel Remaining</span>
            </button>
          </div>

          {/* Master Progress Bar */}
          <div className="w-full bg-[var(--ud-border)] h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--color-primary)] via-sky-500 to-emerald-500 transition-all duration-300 ease-out"
              style={{ width: `${overallPercent}%` }}
            />
          </div>

          {/* Three Suites Progress Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            {/* Unit */}
            <div className={`p-2 rounded border text-xs flex flex-col gap-1.5 transition-colors ${
              activeStep === "unit"
                ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 shadow-sm"
                : stepStates?.unit === "done"
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : stepStates?.unit === "failed"
                    ? "bg-rose-500/10 border-rose-500/30"
                    : "bg-[var(--ud-surface)] border-[var(--ud-border)] opacity-75"
            }`}>
              <div className="flex items-center justify-between">
                <PillarBadge pillar="unit" size="sm" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px]">
                    {stepStates?.unit === "done" ? "100%" : `${stepProgress?.unit?.progress || 0}%`}
                  </span>
                  <StatusPill status={stepStates?.unit} size="sm" />
                </div>
              </div>
              <div className="w-full bg-[var(--ud-border)]/60 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-primary)] transition-all duration-300"
                  style={{ width: `${stepStates?.unit === "done" ? 100 : stepProgress?.unit?.progress || 0}%` }}
                />
              </div>
              <span className="text-[10px] text-[var(--ud-text-muted)] truncate">
                {stepProgress?.unit?.stage || (activeStep === "unit" ? "Executing Unit tests..." : stepStates?.unit === "done" ? "Completed" : "Queued")}
              </span>
            </div>

            {/* Integration */}
            <div className={`p-2 rounded border text-xs flex flex-col gap-1.5 transition-colors ${
              activeStep === "integration"
                ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 shadow-sm"
                : stepStates?.integration === "done"
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : stepStates?.integration === "skipped"
                    ? "bg-amber-500/10 border-amber-500/30"
                    : stepStates?.integration === "failed"
                      ? "bg-rose-500/10 border-rose-500/30"
                      : "bg-[var(--ud-surface)] border-[var(--ud-border)] opacity-75"
            }`}>
              <div className="flex items-center justify-between">
                <PillarBadge pillar="integration" size="sm" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px]">
                    {stepStates?.integration === "done" ? "100%" : `${stepProgress?.integration?.progress || 0}%`}
                  </span>
                  <StatusPill status={stepStates?.integration} size="sm" />
                </div>
              </div>
              <div className="w-full bg-[var(--ud-border)]/60 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-300"
                  style={{ width: `${stepStates?.integration === "done" ? 100 : stepProgress?.integration?.progress || 0}%` }}
                />
              </div>
              <span className="text-[10px] text-[var(--ud-text-muted)] truncate">
                {stepProgress?.integration?.stage || (activeStep === "integration" ? "Executing Supertest..." : stepStates?.integration === "done" ? "Completed" : stepStates?.integration === "skipped" ? "Skipped (Action Required)" : "Queued")}
              </span>
            </div>

            {/* System */}
            <div className={`p-2 rounded border text-xs flex flex-col gap-1.5 transition-colors ${
              activeStep === "system"
                ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 shadow-sm"
                : stepStates?.system === "done"
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : stepStates?.system === "skipped"
                    ? "bg-amber-500/10 border-amber-500/30"
                    : stepStates?.system === "failed"
                      ? "bg-rose-500/10 border-rose-500/30"
                      : "bg-[var(--ud-surface)] border-[var(--ud-border)] opacity-75"
            }`}>
              <div className="flex items-center justify-between">
                <PillarBadge pillar="system" size="sm" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px]">
                    {stepStates?.system === "done" ? "100%" : `${stepProgress?.system?.progress || 0}%`}
                  </span>
                  <StatusPill status={stepStates?.system} size="sm" />
                </div>
              </div>
              <div className="w-full bg-[var(--ud-border)]/60 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${stepStates?.system === "done" ? 100 : stepProgress?.system?.progress || 0}%` }}
                />
              </div>
              <span className="text-[10px] text-[var(--ud-text-muted)] truncate">
                {stepProgress?.system?.stage || (activeStep === "system" ? "Running E2E tests..." : stepStates?.system === "done" ? "Completed" : stepStates?.system === "skipped" ? "Skipped (Action Required)" : "Queued")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pre-flight Human-in-the-Loop Readiness Gate Panel */}
      {isGateOpen && (
        <div className="mt-4 pt-3 border-t border-[var(--ud-border)] flex flex-col gap-4 bg-[var(--ud-surface-2)]/90 p-4 rounded-[var(--radius-lg)] border border-amber-500/40 shadow-md animate-in slide-in-from-top duration-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--ud-border)] pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-amber-500" size={18} />
              <div>
                <h3 className="text-sm font-bold text-[var(--ud-text)] flex items-center gap-2">
                  Pre-flight Readiness & Human-in-the-Loop Gate
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/30">
                    {gateData?.readyCount || 0}/3 Suites Ready
                  </span>
                </h3>
                <p className="text-xs text-[var(--ud-text-muted)]">
                  Resolve missing dependencies or review pending scenarios before executing all suites.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={closeReadinessGate}
              className="p-1 rounded text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface)] transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* 3 Suites Checklist */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Unit Suite Item */}
            <div className={`p-3 rounded-[var(--radius-md)] border text-xs flex flex-col justify-between gap-2.5 ${
              suites.unit?.readyForExecution
                ? "bg-[var(--ud-surface)] border-emerald-500/30"
                : "bg-[var(--ud-surface)] border-amber-500/30"
            }`}>
              <div className="flex items-center justify-between">
                <PillarBadge pillar="unit" size="sm" />
                {suites.unit?.readyForExecution ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                    <CheckCircle2 size={13} />
                    <span>Ready ({suites.unit.testFilesCount || 0} files)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                    <AlertTriangle size={13} />
                    <span>Action Required</span>
                  </span>
                )}
              </div>

              <div className="text-[11px] text-[var(--ud-text-muted)]">
                {suites.unit?.readyForExecution ? (
                  <span>Discovered {suites.unit.testFilesCount} unit test file(s) with {suites.unit.framework} runner.</span>
                ) : (
                  <span className="text-amber-500/90">
                    {suites.unit?.blockers?.[0]?.message || "No unit test files discovered."}
                  </span>
                )}
              </div>

              {!suites.unit?.readyForExecution && (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs justify-center"
                    icon={ExternalLink}
                    onClick={() => {
                      closeReadinessGate?.();
                      if (onNavigateWorkspace) onNavigateWorkspace("unit");
                      else navigate(`/project/${context.projectId || ""}?tab=unit`);
                    }}
                  >
                    Open Unit Workspace ↗
                  </Button>
                </div>
              )}
            </div>

            {/* Integration Suite Item */}
            <div className={`p-3 rounded-[var(--radius-md)] border text-xs flex flex-col justify-between gap-2.5 ${
              suites.integration?.readyForExecution
                ? "bg-[var(--ud-surface)] border-emerald-500/30"
                : "bg-[var(--ud-surface)] border-amber-500/30"
            }`}>
              <div className="flex items-center justify-between">
                <PillarBadge pillar="integration" size="sm" />
                {suites.integration?.readyForExecution ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                    <CheckCircle2 size={13} />
                    <span>Ready ({suites.integration.approvedScenariosCount || suites.integration.testFilesCount || 0} tests)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                    <AlertTriangle size={13} />
                    <span>{suites.integration?.status === "NEEDS_DEPENDENCY" ? "Missing supertest" : "Review Required"}</span>
                  </span>
                )}
              </div>

              <div className="text-[11px] text-[var(--ud-text-muted)]">
                {suites.integration?.readyForExecution ? (
                  <span>Supertest dependencies verified. {suites.integration.approvedScenariosCount} approved scenario(s) ready.</span>
                ) : (
                  <span className="text-amber-500/90">
                    {suites.integration?.blockers?.[0]?.message || "Missing Supertest in project package.json."}
                  </span>
                )}
              </div>

              {!suites.integration?.readyForExecution && (
                <div className="pt-1 flex flex-col gap-1.5">
                  {suites.integration?.status === "NEEDS_DEPENDENCY" ? (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full text-xs justify-center bg-amber-600 hover:bg-amber-700 text-white"
                      loading={loadingAction === "INSTALL_INTEGRATION_DEPS"}
                      disabled={Boolean(loadingAction)}
                      onClick={() => resolveHitlAction?.({ actionType: "INSTALL_INTEGRATION_DEPS" })}
                    >
                      Install supertest & jest
                    </Button>
                  ) : suites.integration?.status === "NEEDS_SCENARIO_REVIEW" ? (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full text-xs justify-center bg-purple-600 hover:bg-purple-700 text-white"
                      loading={loadingAction === "APPROVE_INTEGRATION_SCENARIOS"}
                      disabled={Boolean(loadingAction)}
                      onClick={() => resolveHitlAction?.({ actionType: "APPROVE_INTEGRATION_SCENARIOS" })}
                    >
                      Approve {suites.integration.draftScenariosCount || 1} Pending Scenario(s)
                    </Button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      closeReadinessGate?.();
                      if (onNavigateWorkspace) onNavigateWorkspace("integration");
                      else navigate(`/project/${context.projectId || ""}?tab=integration`);
                    }}
                    className="text-[11px] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:underline text-center"
                  >
                    Review in Integration Workspace ↗
                  </button>
                </div>
              )}
            </div>

            {/* System Suite Item */}
            <div className={`p-3 rounded-[var(--radius-md)] border text-xs flex flex-col justify-between gap-2.5 ${
              suites.system?.readyForExecution
                ? "bg-[var(--ud-surface)] border-emerald-500/30"
                : "bg-[var(--ud-surface)] border-amber-500/30"
            }`}>
              <div className="flex items-center justify-between">
                <PillarBadge pillar="system" size="sm" />
                {suites.system?.readyForExecution ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                    <CheckCircle2 size={13} />
                    <span>Ready ({suites.system.readyScenarios || suites.system.totalScenarios || 0} scenarios)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                    <AlertTriangle size={13} />
                    <span>{suites.system?.status === "NEEDS_SCENARIO_REVIEW" ? "Outcome Confirmation" : "No Tests"}</span>
                  </span>
                )}
              </div>

              <div className="text-[11px] text-[var(--ud-text-muted)]">
                {suites.system?.readyForExecution ? (
                  <span>All {suites.system.totalScenarios} system scenario(s) have confirmed expected outcomes.</span>
                ) : (
                  <span className="text-amber-500/90">
                    {suites.system?.blockers?.[0]?.message || "System scenarios require expected outcome confirmation."}
                  </span>
                )}
              </div>

              {!suites.system?.readyForExecution && (
                <div className="pt-1 flex flex-col gap-1.5">
                  {suites.system?.status === "NEEDS_SCENARIO_REVIEW" ? (
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full text-xs justify-center bg-purple-600 hover:bg-purple-700 text-white"
                      loading={loadingAction === "CONFIRM_SYSTEM_OUTCOMES"}
                      disabled={Boolean(loadingAction)}
                      onClick={() => resolveHitlAction?.({ actionType: "CONFIRM_SYSTEM_OUTCOMES" })}
                    >
                      Confirm All Expected Outcomes
                    </Button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      closeReadinessGate?.();
                      if (onNavigateWorkspace) onNavigateWorkspace("system");
                      else navigate(`/project/${context.projectId || ""}?tab=system`);
                    }}
                    className="text-[11px] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:underline text-center"
                  >
                    Open System Workspace ↗
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--ud-border)]">
            <span className="text-xs text-[var(--ud-text-muted)]">
              Choose an execution path:
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={closeReadinessGate}
              >
                Cancel
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="text-amber-500 border-amber-500/40 hover:bg-amber-500/10"
                onClick={runReadySuitesOnly}
                disabled={Boolean(gateData?.readyCount === 0)}
              >
                Run Ready Suites Only ({gateData?.readyCount || 0}/3)
              </Button>

              <Button
                variant="primary"
                size="sm"
                icon={Play}
                disabled={!gateData?.allReady}
                onClick={async () => {
                  closeReadinessGate?.();
                  await runAllState?.executePipeline(["unit", "integration", "system"]);
                }}
              >
                Run All 3 Suites
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog before triggering full execution */}
      <ConfirmDialog
        isOpen={showConfirmRun}
        onClose={() => setShowConfirmRun(false)}
        onConfirm={() => {
          setShowConfirmRun(false);
          runAll?.();
        }}
        title="Execute All Testing Suites?"
        message="This will initiate sequential execution across Unit, Integration, and System testing suites. Live results and coverage metrics will be streamed directly to this dashboard."
        confirmText="Run Suites"
        cancelText="Cancel"
      />

      {/* Export Report Modal */}
      {showExportModal && (
        <ExportReportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          vm={vm}
        />
      )}
    </header>
  );
}

export default GlobalCommandHeader;
