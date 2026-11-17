import React from "react";
import { CheckCircle2, AlertCircle, PlayCircle } from "lucide-react";
import { PillarCardShell } from "./PillarCardShell.jsx";
import { HorizontalBarList } from "../primitives/charts/HorizontalBarList.jsx";
import { fmtPct } from "../../../../services/unifiedDashboard/format.js";

export function UnitPillarCard({
  pillarData,
  onNavigateWorkspace,
  activeCrossFilter = null,
  onSelectCrossFilter = null,
}) {
  const p = pillarData || {};
  const cov = p.coverageMetrics || {};
  const totalTests = Number(p.totalTests || 0);
  const passedTests = Number(p.passedTests || 0);
  const failedTests = Number(p.failedTests || 0);
  const state = p.state || (totalTests === 0 ? "NOT_RUN" : failedTests > 0 ? "HAS_FAILURES" : "ALL_PASSING");

  const status = failedTests > 0 ? "fail" : totalTests > 0 ? "pass" : "untested";
  const statusLabel = totalTests > 0 ? `${passedTests}/${totalTests} Passed` : "Not Run";

  const lowBranches = Array.isArray(p.lowCoverageItems) ? p.lowCoverageItems : [];

  // 4 Proportional coverage bars replacing 2x2 boxes
  const coverageBars = [
    { key: "lines", label: "Lines", value: cov.lines, tone: "unit" },
    { key: "branches", label: "Branches", value: cov.branches, tone: "unit" },
    { key: "functions", label: "Functions", value: cov.functions, tone: "unit" },
    { key: "statements", label: "Statements", value: cov.statements, tone: "unit" },
  ];

  return (
    <PillarCardShell
      pillar="unit"
      framework={p.framework || "Jest"}
      status={status}
      statusLabel={statusLabel}
      buttonLabel="Open Unit Workspace"
      buttonId="ud-pillar-unit-open"
      onOpenWorkspace={() => onNavigateWorkspace("unit")}
    >
      {/* State: NOT RUN -> Centered vertically with CTA to fill card height */}
      {state === "NOT_RUN" && (
        <div className="flex-1 flex flex-col justify-center items-center rounded-[var(--radius-md)] border border-dashed border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 p-6 text-center space-y-3 my-auto">
          <AlertCircle size={22} className="text-[var(--ud-text-muted)]" />
          <p className="text-xs text-[var(--ud-text-muted)] max-w-[210px]">
            No unit test suites recorded for this snapshot.
          </p>
          <button
            type="button"
            onClick={() => onNavigateWorkspace("unit")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-unit)]/20 border border-[var(--ud-unit)]/50 text-xs font-semibold text-[var(--ud-unit)] hover:bg-[var(--ud-unit)]/30 transition-colors cursor-pointer"
          >
            <PlayCircle size={13} />
            <span>Launch Unit Test Suite</span>
          </button>
        </div>
      )}

      {/* State: ALL PASSING BANNER */}
      {state === "ALL_PASSING" && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--ud-pass)]/30 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)] text-xs font-semibold">
          <CheckCircle2 size={13} className="shrink-0" />
          <span>All {passedTests} unit tests passing</span>
        </div>
      )}

      {/* Code Coverage Metrics via HorizontalBarList (Only when tests ran) */}
      {state !== "NOT_RUN" && (
        <div>
          <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block mb-1.5">
            Code Coverage Metrics
          </span>
          <HorizontalBarList items={coverageBars} height={5} />
        </div>
      )}

      {/* Lowest Branch Coverage Highlights (Hidden on NOT_RUN to eliminate empty repetition) */}
      {state !== "NOT_RUN" && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider">
              Lowest Branch Coverage
            </span>
            <span className="text-[10px] text-[var(--ud-text-muted)] font-mono">
              {lowBranches.length > 0 ? `Top ${lowBranches.length}` : "0 files"}
            </span>
          </div>

          {lowBranches.length > 0 ? (
            <div className="space-y-1 text-xs">
              {lowBranches.map((item, idx) => {
                const isFiltered =
                  activeCrossFilter?.pillar === "unit" &&
                  activeCrossFilter?.file === item.filePath;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (onSelectCrossFilter) {
                        onSelectCrossFilter({
                          pillar: "unit",
                          category: "low_coverage",
                          file: item.filePath,
                          label: `Unit • ${item.name || item.filePath}`,
                        });
                      } else {
                        onNavigateWorkspace("unit", { focusFile: item.filePath });
                      }
                    }}
                    className={`w-full flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] border transition-colors cursor-pointer text-left ${
                      isFiltered
                        ? "border-[var(--ud-unit)] bg-[var(--ud-unit)]/10"
                        : "border-transparent bg-[var(--ud-surface-2)]/50 hover:border-[var(--ud-border)] hover:bg-[var(--ud-surface-2)]"
                    }`}
                    title={`Filter Traceability Matrix by ${item.name || item.filePath}`}
                  >
                    <span className="font-mono text-[11px] text-[var(--ud-text)] truncate max-w-[170px]">
                      {item.name || item.filePath}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 ${
                        Number(item.branchesPct ?? 0) >= 80
                          ? "text-[var(--ud-pass)]"
                          : Number(item.branchesPct ?? 0) >= 50
                          ? "text-[var(--ud-warn)]"
                          : "text-[var(--ud-fail)]"
                      }`}
                    >
                      {fmtPct(item.branchesPct)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--ud-text-muted)] p-2 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)] text-center">
              No branch coverage bottlenecks found.
            </div>
          )}
        </div>
      )}
    </PillarCardShell>
  );
}

export default UnitPillarCard;
