import { useState } from "react";
import { Activity, Server, Cpu, CheckCircle2, ShieldCheck, ExternalLink, Zap } from "lucide-react";
import { PillarBadge } from "../../unified/primitives/PillarBadge.jsx";

export function PortfolioActivityAndInfraZone({
  activityFeed = [],
  onInspectRun,
  className = "",
}) {
  const [filterType, setFilterType] = useState("all"); // "all" | "test" | "ai" | "failed"

  const filteredEvents = activityFeed.filter((evt) => {
    if (filterType === "test") return evt.type === "TEST_EXECUTION";
    if (filterType === "ai") return evt.type === "AI_GENERATION";
    if (filterType === "failed") return evt.outcome === "FAILED";
    return true;
  });

  return (
    <section
      id="portfolio-activity-and-infra-zone"
      aria-label="Cross-Project Activity Stream & Runner Infrastructure"
      className={`grid grid-cols-12 gap-4 ${className}`}
    >
      {/* ── Left Panel (8 Columns): Unified Cross-Project Execution Feed ── */}
      <div className="col-span-12 lg:col-span-8 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 shadow-xs transition-colors flex flex-col justify-between">
        <div>
          {/* Header & Filter Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--ud-border)]">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-[var(--color-primary)]" />
              <h2 className="text-sm font-bold text-[var(--ud-text)] tracking-tight">
                Unified Cross-Project Execution Feed
              </h2>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center p-0.5 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] font-mono text-[11px] self-start sm:self-auto">
              {[
                { id: "all", label: "All Events" },
                { id: "test", label: "Executions" },
                { id: "ai", label: "AI Generations" },
                { id: "failed", label: "Failures Only" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterType(tab.id)}
                  className={`px-2 py-0.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                    filterType === tab.id
                      ? "bg-[var(--ud-surface)] text-[var(--ud-text)] font-semibold shadow-xs"
                      : "text-[var(--ud-text-muted)] hover:text-[var(--ud-text)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chronological Execution Feed Table */}
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--ud-border)] text-[10px] text-[var(--ud-text-muted)] uppercase tracking-wider">
                  <th className="py-2 px-2">Run ID</th>
                  <th className="py-2 px-3 font-sans font-semibold">Project</th>
                  <th className="py-2 px-2">Pillar</th>
                  <th className="py-2 px-2">Outcome</th>
                  <th className="py-2 px-2 text-right">Delta</th>
                  <th className="py-2 px-2 text-right">Duration</th>
                  <th className="py-2 px-3 text-right">Time</th>
                  <th className="py-2 px-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ud-border)]">
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-xs text-[var(--ud-text-muted)] font-mono"
                    >
                      No execution events recorded in this category.
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((evt) => {
                    const isSuccess = evt.outcome === "SUCCESS";
                    return (
                      <tr
                        key={evt.id}
                        className="hover:bg-[var(--ud-surface-2)]/60 transition-colors"
                      >
                        <td className="py-2 px-2 font-bold text-[var(--color-primary)]">
                          {evt.id}
                        </td>
                        <td className="py-2 px-3 font-sans font-medium text-[var(--ud-text)] truncate max-w-[140px]">
                          {evt.projectName}
                        </td>
                        <td className="py-2 px-2">
                          <PillarBadge pillar={evt.pillar} size="sm" />
                        </td>
                        <td className="py-2 px-2">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              isSuccess
                                ? "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)]"
                                : "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)]"
                            }`}
                          >
                            {evt.outcome}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right">
                          <span
                            className={
                              evt.coverageDelta?.startsWith("+")
                                ? "text-[var(--ud-pass)] font-semibold"
                                : evt.coverageDelta?.startsWith("-")
                                ? "text-[var(--ud-fail)] font-semibold"
                                : "text-[var(--ud-text-muted)]"
                            }
                          >
                            {evt.coverageDelta || "0.0%"}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--ud-text-muted)]">
                          {evt.duration}
                        </td>
                        <td className="py-2 px-3 text-right text-[11px] text-[var(--ud-text-muted)]">
                          {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now"}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => onInspectRun?.(evt)}
                            className="text-[11px] font-mono text-[var(--color-primary)] hover:underline cursor-pointer"
                          >
                            Inspect ↗
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] font-mono flex items-center justify-between">
          <span>Continuous feed synchronizing live runs & AI synthesis telemetry</span>
          <span className="text-[var(--ud-text)] font-semibold">{filteredEvents.length} Events</span>
        </div>
      </div>

      {/* ── Right Panel (4 Columns): Workspace Sandbox & Engine Readiness ─ */}
      <div className="col-span-12 lg:col-span-4 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 shadow-xs transition-colors flex flex-col justify-between space-y-4">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-[var(--ud-border)]">
            <Server size={15} className="text-[var(--ud-pass)]" />
            <h2 className="text-sm font-bold text-[var(--ud-text)] tracking-tight">
              Runner Infrastructure Status
            </h2>
          </div>

          <div className="space-y-3 mt-3">
            {/* 1. Sandbox Worker Queue */}
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] space-y-1.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ud-text-muted)]">Runner Status:</span>
                <span className="inline-flex items-center gap-1 text-[var(--ud-pass)] font-bold">
                  <CheckCircle2 size={12} />
                  Engine Ready
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ud-text-muted)]">Sandbox Concurrency:</span>
                <span className="text-[var(--ud-text)] font-bold">3 Parallel Workers</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ud-text-muted)]">Queue Depth:</span>
                <span className="text-[var(--ud-text)] font-bold">0 Pending Jobs</span>
              </div>
            </div>

            {/* 2. Supported Frameworks Matrix */}
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] space-y-2 text-xs">
              <div className="text-[10px] font-mono font-bold text-[var(--ud-text-muted)] uppercase tracking-wider">
                Supported Test Frameworks:
              </div>
              <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                <span className="px-2 py-0.5 rounded bg-[var(--ud-unit)]/15 text-[var(--ud-unit)] border border-[var(--ud-unit)]/30">
                  Jest / Vitest (Unit)
                </span>
                <span className="px-2 py-0.5 rounded bg-[var(--ud-integration)]/15 text-[var(--ud-integration)] border border-[var(--ud-integration)]/30">
                  Supertest (HTTP API)
                </span>
                <span className="px-2 py-0.5 rounded bg-[var(--ud-system)]/15 text-[var(--ud-system)] border border-[var(--ud-system)]/30">
                  Playwright (E2E & API)
                </span>
              </div>
            </div>

            {/* 3. Account Telemetry Summary */}
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] space-y-1.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ud-text-muted)]">Telemetry Snapshots:</span>
                <span className="font-bold text-[var(--ud-text)]">Active & Synced</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ud-text-muted)]">Security Isolation:</span>
                <span className="text-[var(--ud-pass)] font-bold">Ephemeral Process</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] font-mono flex items-center justify-between">
          <span>Engine v2.4 (Chromium + Node)</span>
          <span className="text-[var(--ud-pass)]">● 100% Uptime</span>
        </div>
      </div>
    </section>
  );
}

export default PortfolioActivityAndInfraZone;

