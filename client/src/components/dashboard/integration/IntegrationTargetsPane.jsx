const methodBadges = {
  GET: "bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/20",
  POST: "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20",
  PUT: "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20",
  DELETE:
    "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20",
  DEFAULT:
    "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

export default function IntegrationTargetsPane({
  endpoints,
  selectedEndpointIndex,
  onSelectEndpoint,
  hasAnalysis,
}) {
  if (!hasAnalysis) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-text-secondary)] font-sans">
        <p className="font-semibold text-[var(--color-text)] mb-1">
          No integration targets available.
        </p>
        <p>
          Run <strong>Analyze Project</strong> to discover API endpoints.
        </p>
      </div>
    );
  }

  if (!endpoints || endpoints.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-text-secondary)] font-sans">
        <p>Analysis complete, but no endpoints were found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          API Endpoints ({endpoints.length})
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div
          onClick={() => onSelectEndpoint(null)}
          className={`px-4 py-2 cursor-pointer transition-colors text-xs ${
            selectedEndpointIndex === null
              ? "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)] font-semibold border-l-2 border-[var(--color-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border-l-2 border-transparent"
          }`}
        >
          View All Targets
        </div>

        {endpoints.map((ep, idx) => {
          const badgeClass = methodBadges[ep.method] || methodBadges.DEFAULT;
          const isSelected = selectedEndpointIndex === idx;

          return (
            <div
              key={idx}
              onClick={() => onSelectEndpoint(idx)}
              className={`px-4 py-2.5 cursor-pointer transition-colors flex flex-col gap-1.5 ${
                isSelected
                  ? "bg-[var(--color-primary-light)]/40 text-[var(--color-text)] border-l-2 border-[var(--color-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] border-l-2 border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-bold min-w-[44px] text-center border font-mono ${badgeClass}`}
                >
                  {ep.method}
                </span>
                <span
                  className={`font-mono text-xs truncate ${
                    isSelected
                      ? "text-[var(--color-text)] font-semibold"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {ep.path}
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)] pl-[54px] font-mono">
                {ep.executedCount > 0 ? (
                  <>
                    <span
                      className={
                        ep.passedCount > 0
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-text-muted)]"
                      }
                    >
                      ✓ {ep.passedCount || 0}
                    </span>
                    <span
                      className={
                        ep.failedCount > 0
                          ? "text-[var(--color-danger)]"
                          : "text-[var(--color-text-muted)]"
                      }
                    >
                      ✕ {ep.failedCount || 0}
                    </span>
                  </>
                ) : (
                  <span>{ep.generatedCount || 0} scenarios</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
