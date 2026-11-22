import { useState, useRef, useEffect, memo } from "react";
import {
  Star,
  GitBranch,
  ArrowRight,
  MoreVertical,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { ProjectSparkline } from "../primitives/ProjectSparkline.jsx";
import { PillarMiniProgressRow } from "../primitives/PillarMiniProgressRow.jsx";
import RadialHealthGauge from "../primitives/RadialHealthGauge.jsx";
import LifecycleStatusSelect from "../primitives/LifecycleStatusSelect.jsx";

function ProjectQualityCardComponent({
  project,
  isPinned = false,
  isHighlighted = false,
  onTogglePin,
  onOpenOverview,
  onNavigateWorkspace,
  onDeleteProject,
  onAskAiAboutProject,
  onLifecycleStatusChange = null,
  onLifecycleStatusCommitted = null,
  className = "",
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const {
    id,
    name,
    branch = "main",
    healthScore = 0,
    grade = "—",
    delta = 0,
    unifiedCoveragePct = 0,
    sparkline = [0, 0, 0, 0, 0],
    lifecycleStatus = "NOT_STARTED",
    pillars = {},
    timeRoi = null,
    activeJob = null,
  } = project;

  const unit = pillars.unit || {};
  const int = pillars.integration || {};
  const sys = pillars.system || {};

  const totalTests =
    (unit.totalTests || 0) + (int.totalTests || 0) + (sys.totalTests || 0);
  const totalFailed =
    (unit.failedTests || 0) + (int.failedTests || 0) + (sys.failedTests || 0);
  const hasRuns = totalTests > 0 || healthScore > 0;

  const sparklineStroke =
    healthScore >= 80
      ? "var(--ps-emerald)"
      : healthScore >= 50
        ? "var(--ps-amber)"
        : healthScore > 0
          ? "var(--ps-rose)"
          : "var(--ps-neutral)";

  const isRunning = Boolean(activeJob && activeJob.status === "RUNNING");
  let statusIcon = (
    <Clock className="w-3.5 h-3.5 text-[var(--ps-ink-muted)] shrink-0" />
  );
  let statusText = "No runs yet";

  if (isRunning) {
    statusIcon = (
      <Loader2 className="w-3.5 h-3.5 text-[var(--ps-cobalt)] animate-spin shrink-0" />
    );
    statusText = `${activeJob.pillar || "Running"} ${activeJob.progress || 0}%`;
  } else if (totalFailed > 0) {
    statusIcon = (
      <AlertCircle className="w-3.5 h-3.5 text-[var(--ps-rose)] shrink-0" />
    );
    statusText = `${totalFailed} failed`;
  } else if (totalTests > 0) {
    statusIcon = (
      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ps-emerald)] shrink-0" />
    );
    statusText = `${totalTests} tests passing`;
  }

  const speedup = timeRoi?.speedupMultiplier || 0;
  const hoursSaved = timeRoi?.totalHoursSaved || 0;

  return (
    <article
      id={`project-card-${id}`}
      className={`ps-panel p-4 flex flex-col justify-between transition-all relative group ${
        isHighlighted
          ? "border-[var(--ps-cobalt)] ring-2 ring-[var(--ps-cobalt)]/20"
          : "hover:border-[var(--ps-line-strong)]"
      } ${className}`}
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3.5">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin?.(id);
              }}
              className={`p-1 rounded-md cursor-pointer transition-colors mt-0.5 shrink-0 ${
                isPinned
                  ? "text-[var(--ps-amber)] bg-[var(--ps-amber)]/10"
                  : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-amber)] hover:bg-[var(--ps-surface-2)]"
              }`}
              aria-label={isPinned ? "Unpin project" : "Pin project"}
            >
              <Star size={13} fill={isPinned ? "currentColor" : "none"} />
            </button>

            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onOpenOverview?.(id, project)}
                className="ps-display text-sm font-bold text-[var(--ps-ink)] hover:text-[var(--ps-cobalt)] transition-colors truncate text-left cursor-pointer block w-full"
                title={name}
              >
                {name}
              </button>

              <div className="flex items-center gap-1.5 mt-0.5 ps-mono text-[11px] text-[var(--ps-ink-muted)]">
                <GitBranch size={10} className="text-[var(--ps-cobalt)] shrink-0" />
                <span className="truncate">{branch}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <LifecycleStatusSelect
              projectId={id}
              currentStatus={lifecycleStatus}
              onStatusChange={(newStatus) =>
                onLifecycleStatusChange?.(id, newStatus)
              }
              onStatusCommitted={(newStatus) =>
                onLifecycleStatusCommitted?.(id, newStatus)
              }
            />

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                className="p-1 rounded-md text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] transition-colors cursor-pointer"
                aria-label="Project actions"
              >
                <MoreVertical size={14} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-[var(--ps-line-strong)] bg-[var(--ps-surface)] text-[var(--ps-ink)] shadow-xl z-30 py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onAskAiAboutProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ps-surface-2)] cursor-pointer text-[var(--ps-cobalt)]"
                  >
                    <Sparkles size={13} />
                    <span>Analyze with AI</span>
                  </button>

                  <div className="my-1 border-t border-[var(--ps-line)]" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ps-surface-2)] text-[var(--ps-rose)] cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete workspace</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Health Gauge + Sparkline Strip */}
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)] mb-3.5">
          <div className="flex items-center gap-3">
            <RadialHealthGauge
              score={healthScore}
              grade={grade}
              isTested={hasRuns}
              size={44}
              strokeWidth={4}
            />
            <div className="ps-mono">
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Health</div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold text-[var(--ps-ink)]">
                  {healthScore}
                </span>
                <span className="text-[11px] text-[var(--ps-ink-muted)]">/100</span>
                {delta !== 0 && (
                  <span
                    className={`text-[10px] font-semibold ${
                      delta > 0 ? "text-[var(--ps-emerald)]" : "text-[var(--ps-rose)]"
                    }`}
                  >
                    {delta > 0 ? `+${delta}%` : `${delta}%`}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right ps-mono">
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Coverage</div>
              <div className="text-xs font-bold text-[var(--ps-ink)]">
                {unifiedCoveragePct}%
              </div>
            </div>
            <ProjectSparkline
              data={sparkline}
              strokeColor={sparklineStroke}
              width={50}
              height={18}
            />
          </div>
        </div>

        {/* 3-Layer Progress Bars */}
        <div className="space-y-2 mb-3.5">
          <PillarMiniProgressRow
            label="Unit"
            accentColor="var(--ps-cobalt)"
            coveragePct={unit.coveragePct ?? 0}
            tooltipText={`${unit.passedTests ?? 0}/${unit.totalTests ?? 0} passed`}
          />
          <PillarMiniProgressRow
            label="API"
            subLabel={`${int.coveredApis ?? 0}/${int.totalApis ?? 0}`}
            accentColor="var(--ps-indigo)"
            coveragePct={int.coveragePct ?? 0}
            tooltipText={`${int.coveredApis ?? 0}/${int.totalApis ?? 0} endpoints`}
          />
          <PillarMiniProgressRow
            label="E2E"
            subLabel={`${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0}`}
            accentColor="var(--ps-teal)"
            coveragePct={sys.coveragePct ?? 0}
            tooltipText={`${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0} flows`}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="pt-2.5 border-t border-[var(--ps-line)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 ps-mono text-[11px] text-[var(--ps-ink-muted)] min-w-0">
          {statusIcon}
          <span className="truncate text-[var(--ps-ink-secondary)]">{statusText}</span>
          {speedup > 1 && (
            <span className="text-[var(--ps-emerald)] font-semibold shrink-0">
              · +{hoursSaved}h
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 ps-mono text-[10px] shrink-0">
          <button
            type="button"
            onClick={() => onOpenOverview?.(id, project)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--ps-surface-2)] hover:bg-[var(--ps-line)] text-[var(--ps-ink)] border border-[var(--ps-line)] transition-colors cursor-pointer"
          >
            <span>Open</span>
            <ArrowRight size={11} />
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "unit")}
            className="px-1.5 py-1 rounded-md hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer"
          >
            Unit
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "integration")}
            className="px-1.5 py-1 rounded-md hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer"
          >
            API
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "system")}
            className="px-1.5 py-1 rounded-md hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer"
          >
            E2E
          </button>
        </div>
      </div>
    </article>
  );
}

export const ProjectQualityCard = memo(
  ProjectQualityCardComponent,
  (prev, next) => {
    if (
      prev.isPinned !== next.isPinned ||
      prev.isHighlighted !== next.isHighlighted ||
      prev.className !== next.className ||
      prev.onLifecycleStatusChange !== next.onLifecycleStatusChange ||
      prev.onLifecycleStatusCommitted !== next.onLifecycleStatusCommitted
    ) {
      return false;
    }
    const a = prev.project;
    const b = next.project;
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      a.id === b.id &&
      a.name === b.name &&
      a.branch === b.branch &&
      a.snapshotId === b.snapshotId &&
      a.activeSnapshotId === b.activeSnapshotId &&
      a.healthScore === b.healthScore &&
      a.grade === b.grade &&
      a.delta === b.delta &&
      a.unifiedCoveragePct === b.unifiedCoveragePct &&
      a.lifecycleStatus === b.lifecycleStatus &&
      a.activeJob?.id === b.activeJob?.id &&
      a.activeJob?.status === b.activeJob?.status &&
      a.activeJob?.progress === b.activeJob?.progress &&
      a.activeJob?.pillar === b.activeJob?.pillar &&
      a.timeRoi?.speedupMultiplier === b.timeRoi?.speedupMultiplier &&
      a.timeRoi?.totalHoursSaved === b.timeRoi?.totalHoursSaved &&
      a.pillars?.unit?.coveragePct === b.pillars?.unit?.coveragePct &&
      a.pillars?.unit?.passedTests === b.pillars?.unit?.passedTests &&
      a.pillars?.unit?.failedTests === b.pillars?.unit?.failedTests &&
      a.pillars?.unit?.totalTests === b.pillars?.unit?.totalTests &&
      a.pillars?.integration?.coveragePct === b.pillars?.integration?.coveragePct &&
      a.pillars?.integration?.coveredApis === b.pillars?.integration?.coveredApis &&
      a.pillars?.integration?.totalApis === b.pillars?.integration?.totalApis &&
      a.pillars?.integration?.passedTests === b.pillars?.integration?.passedTests &&
      a.pillars?.integration?.failedTests === b.pillars?.integration?.failedTests &&
      a.pillars?.integration?.totalTests === b.pillars?.integration?.totalTests &&
      a.pillars?.system?.coveragePct === b.pillars?.system?.coveragePct &&
      a.pillars?.system?.coveredJourneys === b.pillars?.system?.coveredJourneys &&
      a.pillars?.system?.totalJourneys === b.pillars?.system?.totalJourneys &&
      a.pillars?.system?.passedTests === b.pillars?.system?.passedTests &&
      a.pillars?.system?.failedTests === b.pillars?.system?.failedTests &&
      a.pillars?.system?.totalTests === b.pillars?.system?.totalTests &&
      (a.sparkline || []).join(",") === (b.sparkline || []).join(",")
    );
  }
);

export default ProjectQualityCard;
