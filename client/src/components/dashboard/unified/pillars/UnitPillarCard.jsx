import { PillarCardShell } from "./PillarCardShell.jsx";
import { MeterBar } from "../primitives/MeterBar.jsx";
import { fmtPct, fmtDuration } from "../../../../services/unifiedDashboard/format.js";

export function UnitPillarCard({ pillarData, onNavigateWorkspace }) {
  const p = pillarData || {};
  const cov = p.coverageMetrics || {};
  const status = p.failedTests > 0 ? "fail" : p.totalTests > 0 ? "pass" : "untested";
  const lowBranches = p.lowCoverageItems || [];

  return (
    <PillarCardShell
      pillar="unit"
      framework={p.framework || "Jest"}
      status={status}
      counts={`${p.passedTests || 0}/${p.totalTests || 0}`}
      buttonLabel="Open Unit Workspace"
      buttonId="ud-pillar-unit-open"
      onOpenWorkspace={() => onNavigateWorkspace("unit")}
    >
      {/* 2x2 Coverage Grid */}
      <div>
        <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block mb-2">
          Code Coverage Metrics
        </span>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* Lines */}
          <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[var(--ud-text-muted)] text-[11px]">Lines</span>
              <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
                {fmtPct(cov.lines)}
              </span>
            </div>
            <MeterBar value={cov.lines || 0} tone="unit" height={4} />
          </div>

          {/* Branches */}
          <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[var(--ud-text-muted)] text-[11px]">Branches</span>
              <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
                {fmtPct(cov.branches)}
              </span>
            </div>
            <MeterBar value={cov.branches || 0} tone="unit" height={4} />
          </div>

          {/* Functions */}
          <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[var(--ud-text-muted)] text-[11px]">Functions</span>
              <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
                {fmtPct(cov.functions)}
              </span>
            </div>
            <MeterBar value={cov.functions || 0} tone="unit" height={4} />
          </div>

          {/* Statements */}
          <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[var(--ud-text-muted)] text-[11px]">Statements</span>
              <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
                {fmtPct(cov.statements)}
              </span>
            </div>
            <MeterBar value={cov.statements || 0} tone="unit" height={4} />
          </div>
        </div>
      </div>

      {/* Lowest Branch Coverage Highlights */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider">
            Lowest Branch Coverage
          </span>
          <span className="text-[10px] text-[var(--ud-text-muted)] font-mono">Top {lowBranches.length}</span>
        </div>

        {lowBranches.length > 0 ? (
          <div className="space-y-1 text-xs">
            {lowBranches.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onNavigateWorkspace("unit", { focusFile: item.filePath })}
                className="w-full flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] border border-transparent hover:border-[var(--ud-border)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer text-left"
                title={`Open ${item.filePath} in Unit Workspace`}
              >
                <span className="font-mono text-[11px] text-[var(--ud-text)] truncate max-w-[170px]">
                  {item.name || item.filePath}
                </span>
                <span className="font-mono text-[11px] font-semibold text-[var(--ud-warn)] tabular-nums shrink-0">
                  {fmtPct(item.branchesPct)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-[var(--ud-text-muted)] p-2 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)] text-center">
            No branch coverage bottlenecks found.
          </div>
        )}
      </div>

      {/* Runtime Meta */}
      <div className="pt-2 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] flex items-center justify-between font-mono">
        <span>Average Runtime:</span>
        <span className="text-[var(--ud-text)] font-semibold">{fmtDuration(p.avgDurationMs)} / test</span>
      </div>
    </PillarCardShell>
  );
}

export default UnitPillarCard;
