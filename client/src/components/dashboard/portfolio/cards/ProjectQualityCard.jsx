import { useState, useRef, useEffect } from "react";
import {
  Star,
  GitBranch,
  ArrowRight,
  MoreVertical,
  ArrowLeftRight,
  Play,
  Download,
  Trash2,
  ExternalLink,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { ProjectSparkline } from "../primitives/ProjectSparkline.jsx";
import { PillarMiniProgressRow } from "../primitives/PillarMiniProgressRow.jsx";

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
    bottleneckCallout = "",
    pillars = {},
  } = project;

  const unit = pillars.unit || {};
  const int = pillars.integration || {};
  const sys = pillars.system || {};

  // Gate Badge Variant Styling
  let gateBadgeColor = "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)] border-[var(--ud-pass)]/30";
  if (gateStatus === "BLOCKED") {
    gateBadgeColor = "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)] border-[var(--ud-fail)]/30";
  } else if (gateStatus === "AT_RISK") {
    gateBadgeColor = "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)] border-[var(--ud-warn)]/30";
  } else if (gateStatus === "UNTESTED") {
    gateBadgeColor = "bg-[var(--ud-neutral)]/15 text-[var(--ud-neutral)] border-[var(--ud-neutral)]/30";
  }

  // Sparkline stroke color based on health
  const sparklineStroke =
    healthScore >= 80
      ? "var(--ud-pass)"
      : healthScore >= 60
      ? "var(--ud-warn)"
      : healthScore > 0
      ? "var(--ud-fail)"
      : "var(--ud-neutral)";

  return (
    <article
      id={`project-card-${id}`}
      className={`rounded-[var(--radius-lg)] border bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-all relative group ${
        isHighlighted
          ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20"
          : "border-[var(--ud-border)] hover:border-[var(--ud-border-strong)]"
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
                  ? "text-amber-500 bg-amber-500/10"
                  : "text-[var(--ud-text-muted)] hover:text-amber-500 hover:bg-[var(--ud-surface-2)]"
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
                  className="text-sm font-bold text-[var(--ud-text)] hover:text-[var(--color-primary)] transition-colors truncate text-left cursor-pointer tracking-tight"
                  title={name}
                >
                  {name}
                </button>
              </div>

              {/* Source/Branch & Snapshot Badge */}
              <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-[10px] text-[var(--ud-text-muted)]">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
                  <GitBranch size={10} className="text-[var(--color-primary)]" />
                  {branch}
                </span>
                {snapshotId && (
                  <span className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
                    {snapshotId.slice(0, 7)}
                  </span>
                )}
                {/* Detected Framework Tags */}
                {frameworks.slice(0, 3).map((fw) => (
                  <span
                    key={fw}
                    className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] border border-[var(--ud-border)]"
                  >
                    {fw}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Quality Gate Badge + Grade + Context Menu */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border uppercase tracking-wider ${gateBadgeColor}`}
            >
              {gateLabel}
            </span>
            <span className="w-5 h-5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] font-mono text-[10px] font-bold text-[var(--ud-text)] flex items-center justify-center">
              {grade}
            </span>

            {/* Context Menu Dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev)}
                }
                className="p-1 rounded text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
                title="Project Actions"
                aria-label="Project Actions"
              >
                <MoreVertical size={14} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-lg z-30 py-1 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleCompare?.(id);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] cursor-pointer"
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
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] cursor-pointer text-[var(--color-primary)]"
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
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Export Project Report</span>
                  </button>

                  <div className="my-1 border-t border-[var(--ud-border)]" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] text-[var(--ud-fail)] cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete Workspace</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Layer 2: Core Health & Trend Strip ───────────────────────────── */}
        <div className="flex items-center justify-between p-2.5 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)]/60 border border-[var(--ud-border)] my-3">
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-xl font-bold text-[var(--ud-text)]">
              {healthScore}
            </span>
            <span className="text-[10px] text-[var(--ud-text-muted)]">/100 Health</span>
            {delta !== 0 && (
              <span
                className={`text-[10px] font-bold ml-1 ${
                  delta > 0 ? "text-[var(--ud-pass)]" : "text-[var(--ud-fail)]"
                }`}
              >
                {delta > 0 ? `+${delta}%` : `${delta}%`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right font-mono">
              <div className="text-[10px] text-[var(--ud-text-muted)]">Unified Cov</div>
              <div className="text-xs font-bold text-[var(--ud-text)]">
                {unifiedCoveragePct}%
              </div>
            </div>

            <ProjectSparkline
              data={sparkline}
              strokeColor={sparklineStroke}
              width={56}
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
            accentColor="var(--ud-unit)"
            coveragePct={unit.coveragePct ?? 0}
            tooltipText={`${unit.framework || "Jest"}: ${unit.coveragePct ?? 0}% line coverage • ${unit.passedTests ?? 0}/${unit.totalTests ?? 0} passed`}
          />

          {/* Integration Pillar */}
          <PillarMiniProgressRow
            label="Integration"
            subLabel={`${int.coveredApis ?? 0}/${int.totalApis ?? 0} APIs`}
            accentColor="var(--ud-integration)"
            coveragePct={int.coveragePct ?? 0}
            tooltipText={`Integration APIs: ${int.coveredApis ?? 0}/${int.totalApis ?? 0} covered (${int.coveragePct ?? 0}%) • ${int.passedTests ?? 0} passed, ${int.failedTests ?? 0} failed`}
          />

          {/* System E2E Pillar */}
          <PillarMiniProgressRow
            label="System E2E"
            subLabel={`${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0} Flows`}
            accentColor="var(--ud-system)"
            coveragePct={sys.coveragePct ?? 0}
            tooltipText={`System E2E: ${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0} flows verified (${sys.coveragePct ?? 0}%) • ${sys.passedTests ?? 0} passed, ${sys.failedTests ?? 0} failed`}
          />
        </div>

        {/* ── Layer 4: Quick Diagnostics Callout (2-line clamp) ────────────── */}
        <div
          className={`p-2 rounded-[var(--radius-sm)] border text-xs font-mono my-3 ${
            gateStatus === "BLOCKED"
              ? "bg-[var(--ud-fail)]/10 border-[var(--ud-fail)]/30 text-[var(--ud-fail)]"
              : gateStatus === "AT_RISK"
              ? "bg-[var(--ud-warn)]/10 border-[var(--ud-warn)]/30 text-[var(--ud-warn)]"
              : gateStatus === "UNTESTED"
              ? "bg-[var(--ud-neutral)]/10 border-[var(--ud-neutral)]/30 text-[var(--ud-text-muted)]"
              : "bg-[var(--ud-pass)]/10 border-[var(--ud-pass)]/30 text-[var(--ud-pass)]"
          }`}
        >
          <div
            className="line-clamp-2 min-h-[2.25rem] leading-snug break-words"
            title={bottleneckCallout}
          >
            {bottleneckCallout}
          </div>
        </div>
      </div>

      {/* ── Layer 5: Direct Deep-Links Footer ──────────────────────────────── */}
      <div className="pt-3 border-t border-[var(--ud-border)] flex items-center justify-between gap-2 mt-auto">
        {/* Primary CTA: Open Unified Overview */}
        <button
          type="button"
          onClick={() => onOpenOverview?.(id)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] hover:opacity-85 transition-opacity cursor-pointer group-hover:translate-x-0.5 transition-transform"
        >
          <span>Open Unified Overview</span>
          <ArrowRight size={13} />
        </button>

        {/* 3 Quick Jump Pills into Test Workspaces */}
        <div className="flex items-center gap-1 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "unit")}
            className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] hover:bg-[var(--ud-unit)]/20 text-[var(--ud-unit)] border border-[var(--ud-border)] transition-colors cursor-pointer"
            title="Jump to Unit Test Workspace"
          >
            Unit ↗
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "integration")}
            className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] hover:bg-[var(--ud-integration)]/20 text-[var(--ud-integration)] border border-[var(--ud-border)] transition-colors cursor-pointer"
            title="Jump to Integration Test Workspace"
          >
            Int ↗
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "system")}
            className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] hover:bg-[var(--ud-system)]/20 text-[var(--ud-system)] border border-[var(--ud-border)] transition-colors cursor-pointer"
            title="Jump to System Test Workspace"
          >
            Sys ↗
          </button>
        </div>
      </div>
    </article>
  );
}

export default ProjectQualityCard;

