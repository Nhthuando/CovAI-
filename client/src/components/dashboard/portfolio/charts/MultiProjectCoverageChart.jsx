import { AlertTriangle } from "lucide-react";

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
        {benchmarkItems.length === 0 ? (
          <div className="py-10 text-center text-xs text-[var(--ud-text-muted)] font-mono border border-dashed border-[var(--ud-border)] rounded-lg">
            No active (Doing) projects in KPI scope
          </div>
        ) : (
          benchmarkItems.map((item) => {
            const isSelected = selectedProjectId === item.projectId;
            const { unitPct, intPct, sysPct, hasImbalance, imbalanceReason } = item;

            const layers = [
              { label: "Unit", val: unitPct, color: "var(--ud-unit)" },
              { label: "API", val: intPct, color: "var(--ud-integration)" },
              { label: "Flow", val: sysPct, color: "var(--ud-system)" },
            ];

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

                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                    <span className="text-[var(--ud-text-muted)] text-[11px]">Score:</span>
                    <span className="font-bold text-[var(--ud-text)]">
                      {item.healthScore !== null && item.healthScore !== undefined
                        ? item.healthScore
                        : "—"}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 relative">
                  <div
                    style={{ left: "80%" }}
                    className="absolute top-0 bottom-0 w-px border-l border-dashed border-[var(--ud-pass)]/50 pointer-events-none z-10"
                  />

                  {layers.map((layer) => {
                    const hasVal = layer.val !== null && layer.val !== undefined;
                    const widthPct = hasVal
                      ? Math.min(100, Math.max(0, Number(layer.val)))
                      : 0;
                    return (
                      <div key={layer.label} className="flex items-center gap-2">
                        <span
                          className="w-10 text-[10px] font-mono shrink-0"
                          style={{ color: layer.color }}
                        >
                          {layer.label}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-[var(--ud-surface)] overflow-hidden">
                          <div
                            style={{
                              width: `${widthPct}%`,
                              backgroundColor: layer.color,
                            }}
                            className="h-full transition-all"
                          />
                        </div>
                        <span className="w-10 text-right text-[10px] font-mono font-medium tabular-nums text-[var(--ud-text)] shrink-0">
                          {hasVal ? `${layer.val}%` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default MultiProjectCoverageChart;
