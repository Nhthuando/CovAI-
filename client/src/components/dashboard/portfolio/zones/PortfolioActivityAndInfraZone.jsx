import { useState } from "react";
import { Activity, Server, CheckCircle2 } from "lucide-react";
import { PillarBadge } from "../../unified/primitives/PillarBadge.jsx";

export function PortfolioActivityAndInfraZone({
  activityFeed = [],
  runnerInfrastructure = null,
  onInspectRun,
  className = "",
}) {
  const [filterType, setFilterType] = useState("all");

  const activeWorkers = runnerInfrastructure?.activeWorkers ?? 3;
  const runningJobs = runnerInfrastructure?.runningJobsCount ?? 0;
  const queuedJobs = runnerInfrastructure?.queuedJobsCount ?? 0;
  const isRedisConnected = runnerInfrastructure?.isRedisConnected ?? true;

  const filteredEvents = activityFeed.filter((evt) => {
    if (filterType === "test") return evt.type === "TEST_EXECUTION";
    if (filterType === "ai") return evt.type === "AI_GENERATION";
    if (filterType === "failed") return evt.outcome === "FAILED";
    return true;
  });

  const successCount = activityFeed.filter((e) => e.outcome === "SUCCESS").length;
  const failCount = activityFeed.length - successCount;

  return (
    <section
      id="portfolio-activity-and-infra-zone"
      aria-label="Recent Execution Feed & Runner Infrastructure"
      className={`grid grid-cols-12 gap-4 ${className}`}
    >
      <div className="col-span-12 lg:col-span-8 ps-panel p-4 sm:p-5 flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ps-line)]">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-[var(--ps-cobalt)]" />
              <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
                Recent Runs
              </h3>
              <span className="text-xs ps-mono text-[var(--ps-ink-muted)]">
                ({filteredEvents.length})
              </span>
            </div>

            <select
              aria-label="Filter recent runs"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="ps-select !h-7"
            >
              <option value="all">All Events</option>
              <option value="test">Test Runs</option>
              <option value="ai">AI Synthesis</option>
              <option value="failed">Failures Only</option>
            </select>
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left ps-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--ps-line)] text-[10px] text-[var(--ps-ink-muted)] uppercase tracking-wider">
                  <th className="py-2 px-2">Run</th>
                  <th className="py-2 px-3 font-sans font-semibold">Project</th>
                  <th className="py-2 px-2">Layer</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2 text-right">Delta</th>
                  <th className="py-2 px-2 text-right">Time</th>
                  <th className="py-2 px-2 text-center">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-line)]">
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center text-xs text-[var(--ps-ink-muted)] ps-mono"
                    >
                      No runs recorded
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((evt) => {
                    const isSuccess = evt.outcome === "SUCCESS";
                    return (
                      <tr
                        key={evt.id}
                        className="hover:bg-[var(--ps-surface-2)]/50 transition-colors"
                      >
                        <td className="py-2.5 px-2 font-semibold text-[var(--ps-cobalt)]">
                          {evt.id}
                        </td>
                        <td className="py-2.5 px-3 font-sans font-medium text-[var(--ps-ink)] truncate max-w-[150px]">
                          {evt.projectName}
                        </td>
                        <td className="py-2.5 px-2">
                          <PillarBadge pillar={evt.pillar} size="sm" />
                        </td>
                        <td className="py-2.5 px-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isSuccess
                                ? "bg-[var(--ps-emerald)]/12 text-[var(--ps-emerald)]"
                                : "bg-[var(--ps-rose)]/12 text-[var(--ps-rose)]"
                            }`}
                          >
                            {evt.outcome}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <span
                            className={
                              evt.coverageDelta?.startsWith("+")
                                ? "text-[var(--ps-emerald)] font-semibold"
                                : evt.coverageDelta?.startsWith("-")
                                  ? "text-[var(--ps-rose)] font-semibold"
                                  : "text-[var(--ps-ink-muted)]"
                            }
                          >
                            {evt.coverageDelta || "0.0%"}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right text-[var(--ps-ink-muted)]">
                          {evt.duration}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => onInspectRun?.(evt)}
                            className="text-[11px] ps-mono text-[var(--ps-cobalt)] hover:underline cursor-pointer"
                          >
                            Inspect
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
      </div>

      <div className="col-span-12 lg:col-span-4 ps-panel p-4 sm:p-5 flex flex-col justify-between space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--ps-line)]">
            <div className="flex items-center gap-2">
              <Server size={14} className="text-[var(--ps-emerald)]" />
              <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
                Runner Status
              </h3>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] ps-mono text-[var(--ps-emerald)] font-semibold">
              <CheckCircle2 size={12} />
              {isRedisConnected ? "Online" : "Local"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 ps-mono text-center">
            <div className="p-2.5 rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)]">
              <div className="text-base font-bold text-[var(--ps-ink)]">
                {activeWorkers}
              </div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Workers</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)]">
              <div className="text-base font-bold text-[var(--ps-ink)]">
                {runningJobs}
              </div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Running</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)]">
              <div className="text-base font-bold text-[var(--ps-ink)]">
                {queuedJobs}
              </div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Queued</div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)] space-y-2 ps-mono text-xs">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--ps-ink-muted)]">Feed Pass / Fail</span>
              <span>
                <span className="text-[var(--ps-ink)] font-semibold">
                  {successCount}
                </span>
                <span className="text-[var(--ps-ink-muted)]"> / </span>
                <span className="text-[var(--ps-ink-secondary)] font-semibold">
                  {failCount}
                </span>
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-2)] overflow-hidden flex">
              {activityFeed.length > 0 && (
                <>
                  <div
                    style={{ width: `${(successCount / activityFeed.length) * 100}%` }}
                    className="bg-[var(--ps-emerald)]"
                  />
                  <div
                    style={{ width: `${(failCount / activityFeed.length) * 100}%` }}
                    className="bg-[var(--ps-rose)]"
                  />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="pt-2.5 border-t border-[var(--ps-line)] text-[11px] text-[var(--ps-ink-muted)] ps-mono flex items-center justify-between">
          <span>Chromium + Node Sandbox</span>
          <span className="text-[var(--ps-emerald)]">● Ready</span>
        </div>
      </div>
    </section>
  );
}

export default PortfolioActivityAndInfraZone;
