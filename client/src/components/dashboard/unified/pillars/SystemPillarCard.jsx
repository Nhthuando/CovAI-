import React from "react";
import { CheckCircle2, PlayCircle } from "lucide-react";
import { PillarCardShell } from "./PillarCardShell.jsx";
import { HorizontalBarList } from "../primitives/charts/HorizontalBarList.jsx";

const SYSTEM_FAILURE_LABELS = {
  selectorNotFound: "Selector Not Found",
  networkTimeout: "API / Net Timeout",
  assertion: "Visual / Assertion",
  flaky: "Flaky Scenario",
};

export function SystemPillarCard({
  pillarData,
  onNavigateWorkspace,
  activeCrossFilter = null,
  onSelectCrossFilter = null,
}) {
  const p = pillarData || {};
  const totalTests = Number(p.totalTests || 0);
  const passedTests = Number(p.passedTests || 0);
  const failedTests = Number(p.failedTests || 0);
  const flakyTests = Number(p.flakyTests || 0);
  const state = p.state || (totalTests === 0 ? "NOT_RUN" : failedTests > 0 ? "HAS_FAILURES" : "ALL_PASSING");

  const status = failedTests > 0 ? "fail" : totalTests > 0 ? "pass" : "untested";
  const statusLabel = totalTests > 0 ? `${passedTests}/${totalTests} Journeys` : "Not Run";

  const dist = p.failureDistribution || {};
  const activeFailureKinds = Object.entries(dist)
    .filter(([_, count]) => Number(count) > 0)
    .map(([key, count]) => ({
      key,
      label: SYSTEM_FAILURE_LABELS[key] || key,
      value: Number(count),
      valueText: `${count} failed`,
      tone: "fail",
    }));

  return (
    <PillarCardShell
      pillar="system"
      framework={p.framework || "Playwright"}
      status={status}
      statusLabel={statusLabel}
      buttonLabel="Open System Workspace"
      buttonId="ud-pillar-system-open"
      onOpenWorkspace={() => onNavigateWorkspace("system")}
    >
      {/* State 1: NOT RUN -> Empty state with clean action, vertically centered */}
      {state === "NOT_RUN" && (
        <div className="flex-1 flex flex-col justify-center items-center rounded-[var(--radius-md)] border border-dashed border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 p-6 text-center space-y-3 my-auto">
          <p className="text-xs text-[var(--ud-text-muted)] max-w-[210px]">
            No system E2E user flows executed yet for this snapshot.
          </p>
          <button
            type="button"
            onClick={() => onNavigateWorkspace("system")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-system)]/20 border border-[var(--ud-system)]/50 text-xs font-semibold text-[var(--ud-system)] hover:bg-[var(--ud-system)]/30 transition-colors cursor-pointer"
          >
            <PlayCircle size={13} />
            <span>Launch System Test Suite</span>
          </button>
        </div>
      )}

      {/* State 2: ALL PASSING -> Clean green badge */}
      {state === "ALL_PASSING" && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--ud-pass)]/30 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)] text-xs font-semibold">
          <CheckCircle2 size={13} className="shrink-0" />
          <span>All {passedTests} E2E journeys passing — 0 failures</span>
        </div>
      )}

      {/* User Journey Execution Stats (when executed > 0) */}
      {state !== "NOT_RUN" && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block">
            E2E Journey Outcomes
          </span>
          <div className="grid grid-cols-3 gap-1.5 text-xs font-mono text-center">
            <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
              <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Passed</span>
              <span className="text-sm font-bold text-[var(--ud-pass)]">{passedTests}</span>
            </div>
            <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
              <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Failed</span>
              <span className="text-sm font-bold text-[var(--ud-fail)]">{failedTests}</span>
            </div>
            <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
              <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Flaky</span>
              <span className="text-sm font-bold text-[var(--ud-warn)]">{flakyTests}</span>
            </div>
          </div>
        </div>
      )}

      {/* State 3: HAS FAILURES -> HorizontalBarList for active failure categories only */}
      {state === "HAS_FAILURES" && activeFailureKinds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-[var(--ud-fail)] uppercase tracking-wider">
              Failure Classification Breakdown
            </span>
            <span className="text-[10px] font-mono text-[var(--ud-text-muted)]">Click to filter</span>
          </div>
          <HorizontalBarList
            items={activeFailureKinds}
            height={4}
            activeKey={activeCrossFilter?.category}
            onItemClick={(item) =>
              onSelectCrossFilter?.({
                pillar: "system",
                category: item.key,
                label: `System (E2E) • ${item.label}`,
              })
            }
          />
        </div>
      )}
    </PillarCardShell>
  );
}

export default SystemPillarCard;
