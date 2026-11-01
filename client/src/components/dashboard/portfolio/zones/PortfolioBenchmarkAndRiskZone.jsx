import { useState } from "react";
import {
  BarChart3,
  ScatterChart,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { MultiProjectCoverageChart } from "../charts/MultiProjectCoverageChart.jsx";
import { RiskQuadrantScatterPlot } from "../charts/RiskQuadrantScatterPlot.jsx";
import { PillarBadge } from "../../unified/primitives/PillarBadge.jsx";

const VISIBLE_ATTENTION_LIMIT = 3;

export function PortfolioBenchmarkAndRiskZone({
  analytics = {},
  attentionQueue = [],
  selectedProjectId = null,
  onSelectProject,
  onNavigateProjectWorkspace,
  onAskAiDiagnose,
  className = "",
}) {
  const [activeTab, setActiveTab] = useState("quadrant"); // "quadrant" | "benchmark"
  const [attentionCategory, setAttentionCategory] = useState("all");
  const [isAttentionExpanded, setIsAttentionExpanded] = useState(false);

  const benchmarkItems = analytics.benchmarkItems || [];
  const quadrantNodes = analytics.quadrantNodes || [];

  const filteredAttention =
    attentionCategory === "all"
      ? attentionQueue
      : attentionQueue.filter((item) => item.category === attentionCategory);

  const displayedAttention = isAttentionExpanded
    ? filteredAttention
    : filteredAttention.slice(0, VISIBLE_ATTENTION_LIMIT);

  const hasMoreAttention = filteredAttention.length > VISIBLE_ATTENTION_LIMIT;

  const selectedProjectObj = benchmarkItems.find(
    (b) => b.projectId === selectedProjectId
  );

  return (
    <section
      id="portfolio-benchmark-and-risk-zone"
      aria-label="Portfolio Analytics Benchmark & Cross-Project Risk Radar"
      className={`grid grid-cols-12 gap-4 items-start ${className}`}
    >
      {/* ── Left Panel (7 Columns): Multi-Project Benchmark Visualizer ── */}
      <div className="col-span-12 lg:col-span-7 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 shadow-xs transition-colors flex flex-col justify-between">
        <div>
          {/* Header & Switchable Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--ud-border)]">
            <div>
              <h2 className="text-sm font-bold text-[var(--ud-text)] tracking-tight">
                Cross-Project Quality Benchmark
              </h2>
              <p className="text-xs text-[var(--ud-text-muted)] mt-0.5">
                Analyze release risk distribution and 3-layer balance across the portfolio
              </p>
            </div>

            {/* Tab Switcher (Default: Risk Quadrant) */}
            <div className="flex items-center p-0.5 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] self-start sm:self-auto shrink-0 font-mono text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("quadrant")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                  activeTab === "quadrant"
                    ? "bg-[var(--ud-surface)] text-[var(--ud-text)] font-semibold shadow-xs"
                    : "text-[var(--ud-text-muted)] hover:text-[var(--ud-text)]"
                }`}
              >
                <ScatterChart size={12} />
                <span>Risk Quadrant</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("benchmark")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                  activeTab === "benchmark"
                    ? "bg-[var(--ud-surface)] text-[var(--ud-text)] font-semibold shadow-xs"
                    : "text-[var(--ud-text-muted)] hover:text-[var(--ud-text)]"
                }`}
              >
                <BarChart3 size={12} />
                <span>3-Layer Bars</span>
              </button>
            </div>
          </div>

          {/* Active Cross-Filter Banner if a project is selected */}
          {selectedProjectId && (
            <div className="mt-3 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--color-primary)] font-medium truncate">
                Focused:{" "}
                <span className="font-bold">
                  {selectedProjectObj?.name || selectedProjectId}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onSelectProject?.(null)}
                className="flex items-center gap-1 text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] cursor-pointer"
              >
                <X size={12} />
                <span>Clear Focus</span>
              </button>
            </div>
          )}

          {/* Tab Content */}
          <div className="mt-4">
            {activeTab === "quadrant" ? (
              <RiskQuadrantScatterPlot
                quadrantNodes={quadrantNodes}
                coverageCutoff={analytics.coverageCutoff}
                passRateCutoff={analytics.passRateCutoff}
                selectedProjectId={selectedProjectId}
                onSelectProject={onSelectProject}
              />
            ) : (
              <MultiProjectCoverageChart
                benchmarkItems={benchmarkItems}
                selectedProjectId={selectedProjectId}
                onSelectProject={onSelectProject}
              />
            )}
          </div>
        </div>

        {/* Footer Hint */}
        <div className="mt-4 pt-2.5 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] font-mono flex items-center justify-between">
          <span>
            Click any quadrant node or bar to highlight the project card above ↑
          </span>
          <span className="text-[var(--ud-text)] font-medium tabular-nums">
            {benchmarkItems.length} Projects Plotted
          </span>
        </div>
      </div>

      {/* ── Right Panel (5 Columns): Cross-Project Attention Queue ──── */}
      <div
        id="portfolio-attention-queue"
        className="col-span-12 lg:col-span-5 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 shadow-xs transition-colors flex flex-col justify-between"
      >
        <div>
          {/* Header & Filter Pills */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--ud-border)]">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="text-[var(--ud-warn)]" />
              <h2 className="text-sm font-bold text-[var(--ud-text)] tracking-tight">
                Cross-Project Attention Queue
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-[var(--ud-text-muted)]">
              {filteredAttention.length} Action Item
              {filteredAttention.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 my-3 font-mono text-[11px]">
            {[
              { id: "all", label: "All Issues" },
              { id: "failures", label: "Severe Failures" },
              { id: "missing-deps", label: "Missing Deps" },
              { id: "zero-test", label: "Zero-Test Gaps" },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setAttentionCategory(cat.id);
                  setIsAttentionExpanded(false);
                }}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  attentionCategory === cat.id
                    ? "bg-[var(--ud-text)] text-[var(--ud-bg)] font-semibold"
                    : "bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] border border-[var(--ud-border)]"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Attention Items Feed (Top 3 by default, zero vertical clipping) */}
          <div className="space-y-2.5">
            {displayedAttention.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--ud-text-muted)] font-mono border border-dashed border-[var(--ud-border)] rounded-[var(--radius-md)]">
                ✓ No active high-severity bottlenecks found in this category.
              </div>
            ) : (
              displayedAttention.map((item) => {
                const isCrit = item.severity === "CRITICAL";
                const isHigh = item.severity === "HIGH";

                const sevColor = isCrit
                  ? "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)] border-[var(--ud-fail)]/30"
                  : isHigh
                  ? "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)] border-[var(--ud-warn)]/30"
                  : "bg-[var(--ud-surface)] text-[var(--ud-text-muted)] border-[var(--ud-border)]";

                return (
                  <div
                    key={item.id}
                    className="p-3 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)]/60 border border-[var(--ud-border)] hover:border-[var(--ud-border-strong)] transition-all space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border uppercase shrink-0 ${sevColor}`}
                        >
                          {item.severity}
                        </span>
                        <span
                          className="text-xs font-mono font-semibold text-[var(--ud-text)] truncate max-w-[170px]"
                          title={item.projectName}
                        >
                          {item.projectName}
                        </span>
                      </div>

                      {item.pillar && (
                        <PillarBadge pillar={item.pillar} size="sm" />
                      )}
                    </div>

                    <div className="text-xs font-medium text-[var(--ud-text)] leading-snug">
                      {item.title}
                    </div>

                    <div className="text-[11px] text-[var(--ud-text-muted)] leading-relaxed">
                      {item.description}
                    </div>

                    {/* Action Deep Link CTA */}
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => onAskAiDiagnose?.(item)}
                        className="text-[11px] font-mono text-[var(--ud-text-muted)] hover:text-[var(--color-primary)] cursor-pointer underline"
                      >
                        Ask COV AI
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onNavigateProjectWorkspace?.(
                            item.projectId,
                            item.targetPillar,
                            item.targetFocus
                          )
                        }
                        className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-[var(--color-primary)] hover:opacity-80 transition-opacity cursor-pointer"
                      >
                        <span>{item.ctaLabel || "Open & Fix ↗"}</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            {/* Expand / Collapse Footer Button */}
            {hasMoreAttention && (
              <button
                type="button"
                onClick={() => setIsAttentionExpanded((prev) => !prev)}
                className="w-full py-2 px-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 hover:bg-[var(--ud-surface-2)] text-xs font-mono font-semibold text-[var(--ud-text)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {isAttentionExpanded ? (
                  <>
                    <span>Show less</span>
                    <ChevronUp size={13} />
                  </>
                ) : (
                  <>
                    <span>
                      Show all ({filteredAttention.length} action items)
                    </span>
                    <ChevronDown size={13} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 pt-2.5 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] font-mono">
          Ranked by severity: Critical blockers trigger immediate release gate blocks.
        </div>
      </div>
    </section>
  );
}

export default PortfolioBenchmarkAndRiskZone;

