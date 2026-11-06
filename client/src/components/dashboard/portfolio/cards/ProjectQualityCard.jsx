import { useState, useRef, useEffect, memo } from "react";
import {
  Star,
  GitBranch,
  ArrowRight,
  MoreVertical,
  ArrowLeftRight,
  Download,
  Trash2,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react";
import { ProjectSparkline } from "../primitives/ProjectSparkline.jsx";
import { PillarMiniProgressRow } from "../primitives/PillarMiniProgressRow.jsx";
import RadialHealthGauge from "../primitives/RadialHealthGauge.jsx";
import LifecycleStatusSelect from "../primitives/LifecycleStatusSelect.jsx";
import ContextualMetricTooltip from "../primitives/ContextualMetricTooltip.jsx";

export function ProjectQualityCard({
  project,
  isPinned = false,
  isSelectedForCompare = false,
  isHighlighted = false,
  onTogglePin,
  onToggleCompare,
  onOpenOverview,
  onNavigateWorkspace,
  onDeleteProject,
  onExportProject,
  onAskAiAboutProject,
  onStatusChange,
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
    snapshotId = "",
    frameworks = [],
    healthScore = 0,
    grade = "—",
    delta = 0,
    gateStatus = "UNTESTED",
    gateLabel = "UNTESTED",
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

  // Gate Badge Variant Styling
  let gateBadgeColor = "bg-[#238636]/15 text-[#3fb950] border-[#238636]/30";
  if (gateStatus === "BLOCKED") {
    gateBadgeColor = "bg-[#da3633]/15 text-[#f85149] border-[#da3633]/30";
  } else if (gateStatus === "AT_RISK") {
    gateBadgeColor = "bg-[#bb8009]/15 text-[#d29922] border-[#bb8009]/30";
  } else if (gateStatus === "UNTESTED") {
    gateBadgeColor = "bg-[#21262d] text-[#8b949e] border-[#30363d]";
  }

  // Sparkline stroke color based on health
  const sparklineStroke =
    healthScore >= 80
      ? "#3fb950"
      : healthScore >= 60
      ? "#d29922"
      : healthScore > 0
      ? "#f85149"
      : "#484f58";

  // Compute compact status label (max 4-5 words)
  const isRunning = Boolean(activeJob && activeJob.status === "RUNNING");
  let statusIcon = <CheckCircle2 className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />;
  let statusText = "All Suites Passing";

  if (isRunning) {
    statusIcon = <Loader2 className="w-3.5 h-3.5 text-[#58a6ff] animate-spin shrink-0" />;
    statusText = `Running ${activeJob.pillar || "Suites"} (${activeJob.progress || 0}%)`;
  } else if (gateStatus === "BLOCKED") {
    const totalFailed = (unit.failedTests || 0) + (int.failedTests || 0) + (sys.failedTests || 0);
    statusIcon = <AlertOctagon className="w-3.5 h-3.5 text-[#f85149] shrink-0" />;
    statusText = totalFailed > 0 ? `${totalFailed} Failures Detected` : "Release Blocked";
  } else if (gateStatus === "AT_RISK") {
    const uncovered = int.uncoveredApis || 0;
    statusIcon = <AlertTriangle className="w-3.5 h-3.5 text-[#d29922] shrink-0" />;
    statusText = uncovered > 0 ? `${uncovered} Uncovered APIs` : "Risk Detected";
  } else if (gateStatus === "UNTESTED") {
    statusIcon = <Clock className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />;
    statusText = "Ready for First Run";
  }

  // Time & ROI summary numbers
  const speedup = timeRoi?.speedupMultiplier || 0;
  const hoursSaved = timeRoi?.totalHoursSaved || 0;
  const autoDurationFormatted = timeRoi?.actualAutoDurationFormatted || "0s";
  const manualDurationFormatted = timeRoi?.estimatedManualDurationFormatted || "0s";

  return (
    <article
      id={`project-card-${id}`}
      className={`rounded-lg border bg-[#161b22] p-4 flex flex-col justify-between shadow-sm transition-all relative group ${
        isHighlighted
          ? "border-[#58a6ff] ring-2 ring-[#58a6ff]/20"
          : "border-[#30363d] hover:border-[#8b949e]/40"
      } ${className}`}
    >
      <div>
        {/* ── Layer 1: Card Header ────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2 mb-2">
          {/* Left: Star + Title + Branch */}
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin?.(id);
              }}
              className={`p-1 rounded cursor-pointer transition-colors mt-0.5 shrink-0 ${
                isPinned
                  ? "text-amber-400 bg-amber-400/10"
                  : "text-[#8b949e] hover:text-amber-400 hover:bg-[#21262d]"
              }`}
              title={isPinned ? "Unpin project" : "Pin project"}
              aria-label={isPinned ? "Unpin project" : "Pin project"}
            >
              <Star size={13} fill={isPinned ? "currentColor" : "none"} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenOverview?.(id)}
                  className="text-sm font-bold text-[#f0f6fc] hover:text-[#58a6ff] transition-colors truncate text-left cursor-pointer tracking-tight"
                  title={name}
                >
                  {name}
                </button>
              </div>

              {/* Source/Branch & Snapshot Badge */}
              <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-[10px] text-[#8b949e]">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d]">
                  <GitBranch size={10} className="text-[#58a6ff]" />
                  {branch}
                </span>
                {snapshotId && (
                  <span className="px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d]">
                    {snapshotId.slice(0, 7)}
                  </span>
                )}
                {/* Detected Framework Tags */}
                {frameworks.slice(0, 2).map((fw) => (
                  <span
                    key={fw}
                    className="px-1.5 py-0.5 rounded bg-[#0d1117] text-[#8b949e] border border-[#30363d]"
                  >
                    {fw}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Lifecycle Switcher + Gate Badge + Context Menu */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Lifecycle Selector Dropdown */}
            <LifecycleStatusSelect
              projectId={id}
              currentStatus={lifecycleStatus}
              onStatusChange={onStatusChange}
            />

            {/* Quality Gate Badge */}
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border uppercase tracking-wider ${gateBadgeColor}`}
            >
              {gateLabel}
            </span>

            {/* Context Menu Dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                className="p-1 rounded text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors cursor-pointer"
                title="Project Actions"
                aria-label="Project Actions"
              >
                <MoreVertical size={14} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-[#30363d] bg-[#161b22] text-[#c9d1d9] shadow-xl z-30 py-1 text-xs font-sans">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleCompare?.(id);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#21262d] cursor-pointer"
                  >
                    <ArrowLeftRight size={13} />
                    <span>{isSelectedForCompare ? "Deselect Comparison" : "Select for Comparison"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onAskAiAboutProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#21262d] cursor-pointer text-[#58a6ff]"
                  >
                    <Sparkles size={13} />
                    <span>Ask COV AI Diagnostics</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#21262d] cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Export Project Report</span>
                  </button>

                  <div className="my-1 border-t border-[#30363d]" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#21262d] text-[#f85149] cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete Workspace</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Layer 2: Core Health Gauge & Trend Strip ─────────────────────── */}
        <div className="flex items-center justify-between p-2.5 rounded-md bg-[#0d1117] border border-[#21262d] my-3">
          {/* Radial Health Gauge */}
          <div className="flex items-center gap-3">
            <RadialHealthGauge
              score={healthScore}
              grade={grade}
              isTested={gateStatus !== "UNTESTED"}
              size={50}
              strokeWidth={4.5}
            />
            <div className="flex flex-col">
              <span className="text-[10px] text-[#8b949e] uppercase font-mono tracking-wider">Health</span>
              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-sm font-bold text-[#f0f6fc] tabular-nums">{healthScore}/100</span>
                {delta !== 0 && (
                  <span
                    className={`text-[10px] font-bold ${
                      delta > 0 ? "text-[#3fb950]" : "text-[#f85149]"
                    }`}
                  >
                    {delta > 0 ? `+${delta}%` : `${delta}%`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Unified Coverage & Sparkline */}
          <div className="flex items-center gap-3">
            <div className="text-right font-mono">
              <div className="text-[10px] text-[#8b949e]">Unified Cov</div>
              <div className="text-xs font-bold text-[#f0f6fc] tabular-nums">
                {unifiedCoveragePct}%
              </div>
            </div>

            <ProjectSparkline
              data={sparkline}
              strokeColor={sparklineStroke}
              width={54}
              height={18}
            />
          </div>
        </div>

        {/* ── Layer 3: 3-Pillar Mini Progress Bars ─────────────────────────── */}
        <div className="space-y-2 my-3">
          {/* Unit Pillar */}
          <PillarMiniProgressRow
            label="Unit"
            subLabel=""
            accentColor="#58a6ff"
            coveragePct={unit.coveragePct ?? 0}
            tooltipText={`${unit.framework || "Jest"}: ${unit.coveragePct ?? 0}% line coverage • ${unit.passedTests ?? 0}/${unit.totalTests ?? 0} passed`}
          />

          {/* Integration Pillar */}
          <PillarMiniProgressRow
            label="Integration"
            subLabel={`${int.coveredApis ?? 0}/${int.totalApis ?? 0} APIs`}
            accentColor="#bc8cff"
            coveragePct={int.coveragePct ?? 0}
            tooltipText={`Integration APIs: ${int.coveredApis ?? 0}/${int.totalApis ?? 0} covered (${int.coveragePct ?? 0}%) • ${int.passedTests ?? 0} passed, ${int.failedTests ?? 0} failed`}
          />

          {/* System E2E Pillar */}
          <PillarMiniProgressRow
            label="System E2E"
            subLabel={`${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0} Flows`}
            accentColor="#3fb950"
            coveragePct={sys.coveragePct ?? 0}
            tooltipText={`System E2E: ${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0} flows verified (${sys.coveragePct ?? 0}%) • ${sys.passedTests ?? 0} passed, ${sys.failedTests ?? 0} failed`}
          />
        </div>

        {/* ── Layer 4: Compact Status Strip (Minimal Text, Zero Redundancy) ── */}
        <div className="flex items-center justify-between p-2 rounded border border-[#21262d] bg-[#0d1117] text-xs font-mono my-3 min-h-[34px]">
          {/* Left: 4-5 words status */}
          <div className="flex items-center gap-1.5 min-w-0 pr-2">
            {statusIcon}
            <span className="text-[#c9d1d9] text-[11px] truncate">{statusText}</span>
          </div>

          {/* Right: Time Saved ROI Badge */}
          {speedup > 1 ? (
            <ContextualMetricTooltip
              title="Execution Time & QA ROI"
              meaning="Automated execution speed vs. industry manual benchmark (120s/Unit, 300s/API, 480s/E2E)."
              formula={`Speedup: ${speedup}x • Auto: ${autoDurationFormatted} • Manual Est: ${manualDurationFormatted}`}
              provenance={`Snapshots: ${snapshotId ? snapshotId.slice(0, 8) : 'Live DB'}`}
              tip="Higher speedup means faster release feedback loops for your engineering team."
              placement="top-right"
            >
              <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#388bfd]/10 border border-[#1f6feb]/30 text-[10px] text-[#58a6ff] cursor-help font-bold shrink-0">
                <Zap className="w-3 h-3 text-[#58a6ff]" />
                <span>{speedup}x ({hoursSaved}h saved)</span>
              </div>
            </ContextualMetricTooltip>
          ) : (
            <span className="text-[10px] text-[#8b949e] shrink-0 font-mono">
              {gateStatus === "UNTESTED" ? "No run data" : "Standard Speed"}
            </span>
          )}
        </div>
      </div>

      {/* ── Layer 5: Direct Deep-Links Footer ──────────────────────────────── */}
      <div className="pt-3 border-t border-[#30363d] flex items-center justify-between gap-2 mt-auto">
        {/* Primary CTA: Open Unified Overview */}
        <button
          type="button"
          onClick={() => onOpenOverview?.(id)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#58a6ff] hover:opacity-85 transition-opacity cursor-pointer group-hover:translate-x-0.5 transition-transform"
        >
          <span>Open Unified Overview</span>
          <ArrowRight size={13} />
        </button>

        {/* 3 Quick Jump Pills into Test Workspaces */}
        <div className="flex items-center gap-1 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "unit")}
            className="px-1.5 py-0.5 rounded bg-[#21262d] hover:bg-[#58a6ff]/20 text-[#58a6ff] border border-[#30363d] transition-colors cursor-pointer"
            title="Jump to Unit Test Workspace"
          >
            Unit ↗
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "integration")}
            className="px-1.5 py-0.5 rounded bg-[#21262d] hover:bg-[#bc8cff]/20 text-[#bc8cff] border border-[#30363d] transition-colors cursor-pointer"
            title="Jump to Integration Test Workspace"
          >
            Int ↗
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "system")}
            className="px-1.5 py-0.5 rounded bg-[#21262d] hover:bg-[#3fb950]/20 text-[#3fb950] border border-[#30363d] transition-colors cursor-pointer"
            title="Jump to System Test Workspace"
          >
            Sys ↗
          </button>
        </div>
      </div>
    </article>
  );
}

export default memo(ProjectQualityCard, (prev, next) => {
  return (
    prev.isPinned === next.isPinned &&
    prev.isSelectedForCompare === next.isSelectedForCompare &&
    prev.isHighlighted === next.isHighlighted &&
    prev.project?.id === next.project?.id &&
    prev.project?.healthScore === next.project?.healthScore &&
    prev.project?.unifiedCoveragePct === next.project?.unifiedCoveragePct &&
    prev.project?.gateStatus === next.project?.gateStatus &&
    prev.project?.lifecycleStatus === next.project?.lifecycleStatus &&
    prev.project?.activeJob?.progress === next.project?.activeJob?.progress &&
    prev.project?.activeJob?.status === next.project?.activeJob?.status &&
    prev.project?.timeRoi?.speedupMultiplier === next.project?.timeRoi?.speedupMultiplier
  );
});
