import { useEffect, useState } from "react";
import {
  Clock,
  History,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

export default function IntegrationHistoryPane({ snapshotId }) {
  const [history, setHistory] = useState({ jobs: [], testRuns: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!snapshotId) return;
    setLoading(true);
    fetch(`${BASE_URL}/coverage/${snapshotId}/integration/history`, {
      headers: getAuthHeaders(),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setHistory(data.data);
        } else {
          setError(data.message || "Failed to load history.");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [snapshotId]);

  if (loading) {
    return (
      <div className="p-8 text-center text-xs text-[var(--color-text-secondary)] font-sans">
        Loading history...
      </div>
    );
  }

  if (error) {
    <div className="p-8 text-center text-xs text-[var(--color-danger)] font-sans">
      {error}
    </div>;
  }

  const { jobs, testRuns } = history;
  const hasData = jobs.length > 0 || testRuns.length > 0;

  if (!hasData) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center gap-3 text-[var(--color-text-secondary)] font-sans">
        <History
          size={32}
          className="text-[var(--color-text-muted)] opacity-60"
        />
        <div className="text-xs">
          <p className="font-semibold text-[var(--color-text)] mb-1">
            No historical data found.
          </p>
          <p>Execution snapshots and test runs will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
        <h3 className="text-sm font-bold text-[var(--color-text)]">
          Integration History
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {testRuns.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
              Recent Executions
            </h4>
            <div className="flex flex-col gap-2.5">
              {testRuns.map((tr, i) => (
                <div
                  key={i}
                  className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3.5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-xs text-[var(--color-text)]">
                      Test Run
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        tr.status === "PASSED"
                          ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/25"
                          : "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/25"
                      }`}
                    >
                      {tr.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                    <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                      {new Date(tr.createdAt).toLocaleString()}
                    </span>
                    <span>
                      {tr.totalTests} tests ({tr.passedTests} passed)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {jobs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
              Pipeline Jobs
            </h4>
            <div className="flex flex-col gap-2.5">
              {jobs.map((job, i) => (
                <div
                  key={i}
                  className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3.5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-xs text-[var(--color-text)]">
                      {job.type}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        job.status === "SUCCESS"
                          ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/25"
                          : job.status === "FAILED"
                            ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/25"
                            : "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/25"
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                    <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                      {new Date(job.createdAt).toLocaleString()}
                    </span>
                    {job.computeTimeMs && (
                      <span className="font-mono text-[11px]">
                        {Math.round(job.computeTimeMs / 1000)}s
                      </span>
                    )}
                  </div>
                  {job.errorMessage && (
                    <div className="mt-2 text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 p-2.5 rounded-[var(--radius-sm)] font-mono">
                      {job.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
