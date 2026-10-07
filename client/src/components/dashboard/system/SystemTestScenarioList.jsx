import { useState, useMemo } from "react";
import {
  FileCode2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertOctagon,
  Edit3,
  Search,
} from "lucide-react";
import Button from "../../common/Button.jsx";

function formatMs(ms) {
  if (!ms || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function StatusBadge({ status }) {
  const norm = String(status || "").toUpperCase();
  if (norm === "PASSED") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30">
        <CheckCircle2 size={12} />
        <span>PASSED</span>
      </span>
    );
  }
  if (norm === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
        <XCircle size={12} />
        <span>FAILED</span>
      </span>
    );
  }
  if (norm === "FLAKY") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/30">
        <AlertTriangle size={12} />
        <span>FLAKY</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
      <span>{norm || "UNKNOWN"}</span>
    </span>
  );
}

export default function SystemTestScenarioList({
  testFiles = [],
  onInspectBreakpoint,
  onOpenEditor,
}) {
  const [collapsedFiles, setCollapsedFiles] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL"); // ALL, PASSED, FAILED, FLAKY

  const toggleCollapse = (filePath) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  // Filtered files & scenarios
  const filteredFiles = useMemo(() => {
    return testFiles
      .map((file) => {
        const scenarios = (file.scenarios || []).filter((s) => {
          const matchQuery =
            !searchQuery ||
            s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            file.filePath?.toLowerCase().includes(searchQuery.toLowerCase());
          const sStatus = String(s.status || "").toUpperCase();
          const matchStatus =
            statusFilter === "ALL" || sStatus === statusFilter;
          return matchQuery && matchStatus;
        });

        return {
          ...file,
          scenarios,
        };
      })
      .filter((file) => file.scenarios.length > 0 || !searchQuery);
  }, [testFiles, searchQuery, statusFilter]);

  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden font-sans">
      {/* Search and Filters Bar */}
      <div className="p-3.5 border-b border-[var(--color-border)] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[var(--color-surface-secondary)]/30">
        <div className="relative w-full sm:w-64">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search scenarios or files..."
            className="w-full pl-8 pr-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-xs text-[var(--color-text)] focus:outline-hidden focus:border-[var(--color-primary)]"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {["ALL", "PASSED", "FAILED", "FLAKY"].map((filter) => {
            const active = statusFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${
                  active
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
                }`}
              >
                {filter}
              </button>
            );
          })}
        </div>
      </div>

      {/* Files List */}
      <div className="divide-y divide-[var(--color-border)]">
        {filteredFiles.length === 0 ? (
          <div className="p-10 text-center text-xs text-[var(--color-text-muted)] italic">
            {testFiles.length === 0
              ? "No system test files or scenarios loaded."
              : "No scenarios match the current filter criteria."}
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isCollapsed = !!collapsedFiles[file.filePath];
            const scenarios = file.scenarios || [];
            const passedCount = scenarios.filter(
              (s) => String(s.status).toUpperCase() === "PASSED"
            ).length;
            const failedCount = scenarios.filter(
              (s) => String(s.status).toUpperCase() === "FAILED"
            ).length;

            return (
              <div key={file.filePath} className="bg-[var(--color-surface)]">
                {/* File Header */}
                <div
                  className="px-4 py-2.5 flex items-center justify-between bg-[var(--color-surface-secondary)]/40 hover:bg-[var(--color-surface-secondary)]/80 transition-colors cursor-pointer select-none"
                  onClick={() => toggleCollapse(file.filePath)}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <button
                      type="button"
                      className="text-[var(--color-text-muted)] p-0.5"
                    >
                      {isCollapsed ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                    <FileCode2
                      size={15}
                      className="text-[var(--color-primary)] shrink-0"
                    />
                    <span className="text-xs font-mono font-medium text-[var(--color-text)] truncate">
                      {file.filePath}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                      ({scenarios.length} {scenarios.length === 1 ? "scenario" : "scenarios"})
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="text-[var(--color-success)] font-medium">
                        {passedCount} passed
                      </span>
                      {failedCount > 0 && (
                        <span className="text-[var(--color-danger)] font-medium">
                          {failedCount} failed
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Edit3}
                      onClick={() => onOpenEditor({ filePath: file.filePath })}
                      className="text-xs h-7 px-2"
                    >
                      Edit Test
                    </Button>
                  </div>
                </div>

                {/* Scenarios Table / List */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-muted)] bg-[var(--color-surface)] uppercase tracking-wider">
                          <th className="py-2 px-4 font-medium">Scenario Title</th>
                          <th className="py-2 px-4 font-medium w-28">Status</th>
                          <th className="py-2 px-4 font-medium w-24">Duration</th>
                          <th className="py-2 px-4 font-medium w-28 text-right">
                            Coverage Contrib
                          </th>
                          <th className="py-2 px-4 font-medium w-36 text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {scenarios.map((sc) => {
                          const isFailed =
                            String(sc.status).toUpperCase() === "FAILED";
                          const contribPct =
                            sc.coverageContributionPct !== undefined
                              ? `${Math.round(sc.coverageContributionPct)}%`
                              : sc.coveragePoints
                              ? `+${sc.coveragePoints} pts`
                              : "—";

                          return (
                            <tr
                              key={sc.id || sc.title}
                              className={`hover:bg-[var(--color-surface-secondary)]/40 transition-colors ${
                                isFailed ? "bg-[var(--color-danger)]/5" : ""
                              }`}
                            >
                              <td className="py-2.5 px-4 font-medium text-[var(--color-text)] max-w-md truncate">
                                <div>{sc.title}</div>
                                {isFailed && sc.errorMessage && (
                                  <div className="text-[11px] text-[var(--color-danger)] truncate font-mono mt-0.5 max-w-sm">
                                    {sc.errorMessage}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-4">
                                <StatusBadge status={sc.status} />
                              </td>
                              <td className="py-2.5 px-4 text-[var(--color-text-secondary)] font-mono text-[11px]">
                                {formatMs(sc.executionTimeMs || sc.durationMs)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-[11px] text-[var(--color-primary)] font-medium">
                                {contribPct}
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {isFailed && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onInspectBreakpoint({
                                          ...sc,
                                          testFile: file.filePath,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] text-[11px] font-semibold bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20 border border-[var(--color-danger)]/30 transition-colors cursor-pointer"
                                      title="Inspect failure breakpoint, screenshot & DOM"
                                    >
                                      <AlertOctagon size={12} />
                                      <span>Breakpoint</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenEditor({
                                        filePath: file.filePath,
                                        scenarioId: sc.id,
                                      })
                                    }
                                    className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                                    title="Edit scenario in editor"
                                  >
                                    <Edit3 size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

