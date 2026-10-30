import { ShieldCheck, Layers, Gauge, Sparkles, ArrowDownRight, AlertTriangle } from "lucide-react";

export function PortfolioExecutiveKpiRow({
  kpis = {},
  onSelectStatusFilter,
  onFocusAttentionQueue,
  className = "",
}) {
  const card1 = kpis.card1Health || {};
  const card2 = kpis.card2Coverage || {};
  const card3 = kpis.card3Scale || {};
  const card4 = kpis.card4AiImpact || {};

  const total = card1.totalProjects || 1;
  const passed = card1.passedProjects || 0;
  const atRisk = card1.atRiskProjects || 0;
  const blocked = card1.blockedProjects || 0;
  const untested = card1.untestedProjects || 0;

  const passedPct = Math.round((passed / total) * 100);
  const atRiskPct = Math.round((atRisk / total) * 100);
  const blockedPct = Math.round((blocked / total) * 100);
  const untestedPct = Math.max(0, 100 - passedPct - atRiskPct - blockedPct);

  return (
    <section
      id="portfolio-executive-kpi-row"
      aria-label="Portfolio Executive KPIs"
      className={`grid grid-cols-12 gap-4 ${className}`}
    >
      {/* ── Card 1: Portfolio Release Readiness & Health ─────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs text-[var(--ud-text-muted)] font-mono">
            <span className="font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              Release Readiness
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                card1.grade === "A"
                  ? "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)]"
                  : card1.grade === "B"
                  ? "bg-[var(--ud-unit)]/15 text-[var(--ud-unit)]"
                  : card1.grade === "C"
                  ? "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)]"
                  : "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)]"
              }`}
            >
              Grade {card1.grade || "—"}
            </span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-text)]">
              {card1.avgHealthScore}
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">
              / 100 Health
            </span>
            <span className="ml-auto text-xs font-mono font-medium text-[var(--ud-text-muted)]">
              {card1.totalProjects} Proj{card1.totalProjects !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Segmented Breakdown Bar */}
          <div className="h-2 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden flex gap-0.5 mt-3 select-none">
            {passedPct > 0 && (
              <div
                style={{ width: `${passedPct}%` }}
                className="bg-[var(--ud-pass)] transition-all"
                title={`Passed: ${passed} (${passedPct}%)`}
              />
            )}
            {atRiskPct > 0 && (
              <div
                style={{ width: `${atRiskPct}%` }}
                className="bg-[var(--ud-warn)] transition-all"
                title={`At Risk: ${atRisk} (${atRiskPct}%)`}
              />
            )}
            {blockedPct > 0 && (
              <div
                style={{ width: `${blockedPct}%` }}
                className="bg-[var(--ud-fail)] transition-all"
                title={`Blocked: ${blocked} (${blockedPct}%)`}
              />
            )}
            {untestedPct > 0 && (
              <div
                style={{ width: `${untestedPct}%` }}
                className="bg-[var(--ud-neutral)] transition-all"
                title={`Untested: ${untested} (${untestedPct}%)`}
              />
            )}
          </div>
        </div>

        {/* Legend counts (Clickable filters) */}
        <div className="grid grid-cols-4 gap-1 pt-3 mt-3 border-t border-[var(--ud-border)] text-center font-mono text-[11px]">
          <button
            type="button"
            onClick={() => onSelectStatusFilter?.("PASSED")}
            className="hover:opacity-80 transition-opacity cursor-pointer"
            title="Filter by Passed"
          >
            <div className="text-[var(--ud-pass)] font-bold">{passed}</div>
            <div className="text-[10px] text-[var(--ud-text-muted)]">Passed</div>
          </button>
          <button
            type="button"
            onClick={() => onSelectStatusFilter?.("AT_RISK")}
            className="hover:opacity-80 transition-opacity cursor-pointer"
            title="Filter by At Risk"
          >
            <div className="text-[var(--ud-warn)] font-bold">{atRisk}</div>
            <div className="text-[10px] text-[var(--ud-text-muted)]">At Risk</div>
          </button>
          <button
            type="button"
            onClick={() => onSelectStatusFilter?.("BLOCKED")}
            className="hover:opacity-80 transition-opacity cursor-pointer"
            title="Filter by Blocked"
          >
            <div className="text-[var(--ud-fail)] font-bold">{blocked}</div>
            <div className="text-[10px] text-[var(--ud-text-muted)]">Blocked</div>
          </button>
          <button
            type="button"
            onClick={() => onSelectStatusFilter?.("UNTESTED")}
            className="hover:opacity-80 transition-opacity cursor-pointer"
            title="Filter by Untested"
          >
            <div className="text-[var(--ud-neutral)] font-bold">{untested}</div>
            <div className="text-[10px] text-[var(--ud-text-muted)]">Untested</div>
          </button>
        </div>
      </div>

      {/* ── Card 2: Global Unified Coverage Index ─────────────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs text-[var(--ud-text-muted)] font-mono">
            <span className="font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              Unified Coverage Index
            </span>
            <span className="text-[10px] text-[var(--ud-pass)] font-bold">
              Target 80%+
            </span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-text)]">
              {card2.unifiedCoveragePct ?? 0}%
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">
              Weighted Avg
            </span>
          </div>
        </div>

        {/* 3 Horizontal Mini Progress Bars */}
        <div className="space-y-2 pt-3 mt-3 border-t border-[var(--ud-border)]">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--ud-unit)] font-medium">Unit Line Cov</span>
              <span className="text-[var(--ud-text)] font-semibold">
                {card2.avgUnitCoveragePct ?? 0}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden">
              <div
                style={{ width: `${Math.min(100, card2.avgUnitCoveragePct ?? 0)}%` }}
                className="h-full bg-[var(--ud-unit)] transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--ud-integration)] font-medium">API Endpoint Cov</span>
              <span className="text-[var(--ud-text)] font-semibold">
                {card2.avgIntegrationCoveragePct ?? 0}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden">
              <div
                style={{ width: `${Math.min(100, card2.avgIntegrationCoveragePct ?? 0)}%` }}
                className="h-full bg-[var(--ud-integration)] transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--ud-system)] font-medium">System Flow Cov</span>
              <span className="text-[var(--ud-text)] font-semibold">
                {card2.avgSystemCoveragePct ?? 0}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden">
              <div
                style={{ width: `${Math.min(100, card2.avgSystemCoveragePct ?? 0)}%` }}
                className="h-full bg-[var(--ud-system)] transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Card 3: Total Testing Scale & Pass Rate ───────────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs text-[var(--ud-text-muted)] font-mono">
            <span className="font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              Execution & Scale
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                (card3.overallPassRatePct ?? 0) >= 95
                  ? "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)]"
                  : (card3.overallPassRatePct ?? 0) >= 80
                  ? "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)]"
                  : "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)]"
              }`}
            >
              {card3.overallPassRatePct ?? 0}% Pass
            </span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-text)]">
              {card3.totalExecutedTests ?? 0}
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">
              Executed Tests
            </span>
          </div>
        </div>

        {/* 2x2 Sub-metrics Grid */}
        <div className="grid grid-cols-2 gap-2 pt-3 mt-3 border-t border-[var(--ud-border)] font-mono text-xs">
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">Unit Passed</div>
            <div className="font-bold text-[var(--ud-text)]">{card3.unitPassedStr || "0/0"}</div>
          </div>
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">APIs Covered</div>
            <div className="font-bold text-[var(--ud-text)]">{card3.apiCoveredStr || "0/0"}</div>
          </div>
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">E2E Verified</div>
            <div className="font-bold text-[var(--ud-text)]">{card3.systemVerifiedStr || "0/0"}</div>
          </div>
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">Total Runtime</div>
            <div className="font-bold text-[var(--ud-text)]">{card3.cumulativeDurationStr || "0s"}</div>
          </div>
        </div>
      </div>

      {/* ── Card 4: Global AI Impact & Coverage Gaps ──────────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs text-[var(--ud-text-muted)] font-mono">
            <span className="font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              AI Impact & Gaps
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--color-primary)]">
              <Sparkles size={11} />
              COV AI
            </span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-text)]">
              {card4.totalAiTests ?? 0}
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">
              AI Synthesized
            </span>
          </div>
        </div>

        {/* Sub-metrics & Focus Link */}
        <div className="pt-3 mt-3 border-t border-[var(--ud-border)] space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="text-[var(--ud-text-muted)]">AI Repaired Tests:</span>
            <span className="font-bold text-[var(--ud-pass)]">
              {card4.aiRepairedCount ?? 0} healed
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--ud-text-muted)]">Remaining Gaps:</span>
            <span className="font-bold text-[var(--ud-warn)]">
              {card4.uncoveredGapsCount ?? 0} uncovered
            </span>
          </div>
          <button
            type="button"
            onClick={() => onFocusAttentionQueue?.()}
            className="w-full mt-1 pt-1 text-center text-[11px] font-sans text-[var(--color-primary)] hover:underline flex items-center justify-center gap-1 cursor-pointer"
          >
            <span>View in Attention Queue</span>
            <ArrowDownRight size={12} />
          </button>
        </div>
      </div>
    </section>
  );
}

export default PortfolioExecutiveKpiRow;

