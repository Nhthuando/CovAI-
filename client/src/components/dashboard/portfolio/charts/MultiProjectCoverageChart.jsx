import { AlertTriangle, CheckCircle2 } from "lucide-react";

export function MultiProjectCoverageChart({
  benchmarkItems = [],
  selectedProjectId = null,
  onSelectProject,
  className = "",
}) {
  return (
    <div className={`space-y-4 font-sans ${className}`}>
      {/* Legend & Target Line Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pb-2 border-b border-[var(--ud-border)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--ud-unit)]" />
            <span className="text-[var(--ud-text)]">Unit</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--ud-integration)]" />
            <span className="text-[var(--ud-text)]">Integration API</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[var(--ud-system)]" />
            <span className="text-[var(--ud-text)]">System E2E</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[var(--ud-text-muted)]">
          <span className="w-4 h-0.5 border-t-2 border-dashed border-[var(--ud-pass)]" />
          <span>80% Quality Target</span>
        </div>
      </div>

      {/* Grouped Bars List */}
      <div className="space-y-3.5">
        {benchmarkItems.map((item) => {
          const isSelected = selectedProjectId === item.projectId;
          const { unitPct, intPct, sysPct, hasImbalance, imbalanceReason } = item;

          return (
            <div
              key={item.projectId}
              onClick={() => onSelectProject?.(isSelected ? null : item.projectId)}
              className={`p-2.5 rounded-[var(--radius-md)] border transition-all cursor-pointer ${
                isSelected
                  ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]"
                  : "bg-[var(--ud-surface-2)]/60 border-[var(--ud-border)] hover:border-[var(--ud-border-strong)]"
              }`}
            >
              {/* Row Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-xs text-[var(--ud-text)] truncate max-w-[220px]">
                    {item.name}
                  </span>
                  {hasImbalance && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--ud-warn)]/15 text-[var(--ud-warn)] border border-[var(--ud-warn)]/30"
                      title={imbalanceReason || "Severe layer coverage disparity"}
                    >
                      <AlertTriangle size={10} />
                      Imbalance
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-[var(--ud-text-muted)] text-[11px]">Score:</span>
                  <span className="font-bold text-[var(--ud-text)]">{item.healthScore}</span>
                </div>
              </div>

              {/* Grouped 3-Pillar Progress Bars */}
              <div className="space-y-1.5 relative">
                {/* 80% Target Line */}
                <div
                  style={{ left: "80%" }}
                  className="absolute top-0 bottom-0 w-px border-l border-dashed border-[var(--ud-pass)]/50 pointer-events-none z-10"
                />

                {/* Unit Bar */}
                <div className="flex items-center gap-2">
                  <span className="w-10 text-[10px] font-mono text-[var(--ud-unit)] shrink-0">
                    Unit
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--ud-surface)] overflow-hidden">
                    <div
                      style={{ width: `${Math.min(100, unitPct)}%` }}
                      className="h-full bg-[var(--ud-unit)] transition-all"
                    />
                  </div>
                  <span className="w-10 text-right text-[10px] font-mono font-medium text-[var(--ud-text)] shrink-0">
                    {unitPct}%
                  </span>
                </div>

                {/* Integration API Bar */}
                <div className="flex items-center gap-2">
                  <span className="w-10 text-[10px] font-mono text-[var(--ud-integration)] shrink-0">
                    API
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--ud-surface)] overflow-hidden">
                    <div
                      style={{ width: `${Math.min(100, intPct)}%` }}
                      className="h-full bg-[var(--ud-integration)] transition-all"
                    />
                  </div>
                  <span className="w-10 text-right text-[10px] font-mono font-medium text-[var(--ud-text)] shrink-0">
                    {intPct}%
                  </span>
                </div>

                {/* System E2E Bar */}
                <div className="flex items-center gap-2">
                  <span className="w-10 text-[10px] font-mono text-[var(--ud-system)] shrink-0">
                    Flow
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--ud-surface)] overflow-hidden">
                    <div
                      style={{ width: `${Math.min(100, sysPct)}%` }}
                      className="h-full bg-[var(--ud-system)] transition-all"
                    />
                  </div>
                  <span className="w-10 text-right text-[10px] font-mono font-medium text-[var(--ud-text)] shrink-0">
                    {sysPct}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MultiProjectCoverageChart;

