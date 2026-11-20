import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, X } from "lucide-react";
import { MultiProjectCoverageChart } from "../charts/MultiProjectCoverageChart.jsx";
import { RiskQuadrantScatterPlot } from "../charts/RiskQuadrantScatterPlot.jsx";
import TimeSavedRoiChart from "../charts/TimeSavedRoiChart.jsx";
import { PortfolioRadarChart } from "../charts/PortfolioRadarChart.jsx";
import { GateDistributionDonut } from "../charts/GateDistributionDonut.jsx";
import { PillarBadge } from "../../unified/primitives/PillarBadge.jsx";

const VISIBLE_ATTENTION_LIMIT = 4;

export function PortfolioBenchmarkAndRiskZone({
  kpis = {},
  lifecycleCounts = null,
  lifecycleScopeLabel = "Projects",
  analytics = {},
  attentionQueue = [],
  projects = [],
  timeRoiAnalytics = null,
  selectedProjectId = null,
  onSelectProject,
  onNavigateProjectWorkspace,
  onAskAiDiagnose,
  className = "",
}) {
  const [barChartView, setBarChartView] = useState("coverage");
  const [attentionCategory, setAttentionCategory] = useState("all");
  const [isAttentionExpanded, setIsAttentionExpanded] = useState(false);

  const benchmarkItems = analytics.benchmarkItems || [];
  const quadrantNodes = analytics.quadrantNodes || [];
  const selectedProjectObj = (projects || []).find(
    (p) => p.id === selectedProjectId
  );

  const filteredAttention =
    attentionCategory === "all"
      ? attentionQueue
      : attentionQueue.filter((item) => item.category === attentionCategory);

  const displayedAttention = isAttentionExpanded
    ? filteredAttention
    : filteredAttention.slice(0, VISIBLE_ATTENTION_LIMIT);

  const hasMoreAttention = filteredAttention.length > VISIBLE_ATTENTION_LIMIT;

  return (
    <section
      id="portfolio-benchmark-and-risk-zone"
      aria-label="Portfolio Visual Analytics"
      className={`space-y-4 ${className}`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="ps-display text-base font-bold text-[var(--ps-ink)]">
          Analytics
        </h2>
        {selectedProjectId && (
          <button
            type="button"
            onClick={() => onSelectProject?.(null)}
            className="px-2.5 py-1 rounded-md bg-[var(--ps-cobalt)]/12 border border-[var(--ps-cobalt)]/35 text-xs ps-mono text-[var(--ps-cobalt)] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>Focused: {selectedProjectObj?.name || selectedProjectId}</span>
            <X size={12} />
          </button>
        )}
      </div>

      {/* ── Row 1: 3 Core Diagrams Side-by-Side ──────────────────────── */}
      <div className="grid grid-cols-12 gap-4 items-stretch">
        <div className="col-span-12 lg:col-span-6 ps-panel p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-[var(--ps-line)]">
            <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
              Risk Quadrant
            </h3>
            <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)]">
              Coverage vs Pass Rate
            </span>
          </div>
          <RiskQuadrantScatterPlot
            quadrantNodes={quadrantNodes}
            coverageCutoff={analytics.coverageCutoff}
            passRateCutoff={analytics.passRateCutoff}
            selectedProjectId={selectedProjectId}
            onSelectProject={onSelectProject}
          />
        </div>

        <div className="col-span-12 sm:col-span-6 lg:col-span-3 ps-panel p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-[var(--ps-line)]">
            <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
              Quality Radar
            </h3>
            <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)]">
              5 Axes
            </span>
          </div>
          <PortfolioRadarChart
            kpis={kpis}
            selectedProject={selectedProjectObj}
            className="my-auto"
          />
        </div>

        <div className="col-span-12 sm:col-span-6 lg:col-span-3 ps-panel p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-[var(--ps-line)]">
            <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
              Lifecycle Split
            </h3>
            <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)]">
              {lifecycleScopeLabel}
            </span>
          </div>
          <GateDistributionDonut
            lifecycleCounts={lifecycleCounts}
            projects={projects}
            className="my-auto"
          />
        </div>
      </div>

      {/* ── Row 2: Project Coverage/ROI Bars (7 cols) + Attention Queue (5 cols) ── */}
      <div className="grid grid-cols-12 gap-4 items-start">
        <div className="col-span-12 lg:col-span-7 ps-panel p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-[var(--ps-line)]">
            <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
              Project Comparison
            </h3>

            <select
              aria-label="Select comparison bar chart"
              value={barChartView}
              onChange={(e) => setBarChartView(e.target.value)}
              className="ps-select !h-7"
            >
              <option value="coverage">3-Layer Coverage Bars</option>
              <option value="roi">QA Time &amp; Speedup ROI</option>
            </select>
          </div>

          {barChartView === "coverage" ? (
            <MultiProjectCoverageChart
              benchmarkItems={benchmarkItems}
              selectedProjectId={selectedProjectId}
              onSelectProject={onSelectProject}
            />
          ) : (
            <TimeSavedRoiChart
              projects={projects}
              timeRoiAnalytics={timeRoiAnalytics}
              onHighlightProject={onSelectProject}
            />
          )}
        </div>

        <div
          id="portfolio-attention-queue"
          className="col-span-12 lg:col-span-5 ps-panel p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-[var(--ps-line)]">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-[var(--ps-amber)]" />
              <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
                Attention Queue
              </h3>
              <span className="text-xs ps-mono text-[var(--ps-ink-muted)]">
                ({filteredAttention.length})
              </span>
            </div>

            <select
              aria-label="Filter attention queue"
              value={attentionCategory}
              onChange={(e) => {
                setAttentionCategory(e.target.value);
                setIsAttentionExpanded(false);
              }}
              className="ps-select !h-7"
            >
              <option value="all">All Issues</option>
              <option value="failures">Severe Failures</option>
              <option value="missing-deps">Missing Deps</option>
              <option value="zero-test">Zero-Test Gaps</option>
            </select>
          </div>

          <div className="space-y-2">
            {displayedAttention.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--ps-ink-muted)] ps-mono border border-dashed border-[var(--ps-line)] rounded-lg">
                No active blockers
              </div>
            ) : (
              displayedAttention.map((item) => {
                const isCrit = item.severity === "CRITICAL";
                const isHigh = item.severity === "HIGH";

                const sevColor = isCrit
                  ? "bg-[var(--ps-rose)]/12 text-[var(--ps-rose)] border-[var(--ps-rose)]/30"
                  : isHigh
                    ? "bg-[var(--ps-amber)]/12 text-[var(--ps-amber)] border-[var(--ps-amber)]/30"
                    : "bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] border-[var(--ps-line)]";

                return (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] ps-mono font-bold border uppercase shrink-0 ${sevColor}`}
                        >
                          {item.severity}
                        </span>
                        <span className="text-xs ps-mono font-semibold text-[var(--ps-ink)] truncate">
                          {item.projectName}
                        </span>
                      </div>

                      {item.pillar && <PillarBadge pillar={item.pillar} size="sm" />}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--ps-ink-secondary)] truncate">
                        {item.title}
                      </span>

                      <div className="flex items-center gap-2.5 shrink-0 ps-mono text-[11px]">
                        <button
                          type="button"
                          onClick={() => onAskAiDiagnose?.(item)}
                          className="text-[var(--ps-ink-muted)] hover:text-[var(--ps-cobalt)] cursor-pointer"
                        >
                          AI
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
                          className="font-semibold text-[var(--ps-cobalt)] hover:underline cursor-pointer"
                        >
                          Fix →
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {hasMoreAttention && (
              <button
                type="button"
                onClick={() => setIsAttentionExpanded((prev) => !prev)}
                className="w-full py-1.5 px-3 rounded-lg border border-[var(--ps-line)] bg-[var(--ps-inset)] hover:bg-[var(--ps-surface-2)] text-xs ps-mono text-[var(--ps-ink)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {isAttentionExpanded ? (
                  <>
                    <span>Collapse</span>
                    <ChevronUp size={13} />
                  </>
                ) : (
                  <>
                    <span>Show all ({filteredAttention.length})</span>
                    <ChevronDown size={13} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default PortfolioBenchmarkAndRiskZone;
