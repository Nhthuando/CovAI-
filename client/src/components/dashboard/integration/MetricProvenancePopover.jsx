import React, { useState, useRef, useEffect } from "react";
import { Info, ExternalLink, HelpCircle } from "lucide-react";

export default function MetricProvenancePopover({ provenance, children }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target) && containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  if (!provenance) return <>{children}</>;

  return (
    <div className="relative inline-flex items-center gap-1" ref={containerRef}>
      {children}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
        title="View provenance and evidence"
      >
        <HelpCircle size={14} />
      </button>

      {isOpen && (
        <div 
          ref={popoverRef}
          className="absolute z-50 p-4 w-80 text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl"
          style={{ top: '100%', left: '50%', transform: 'translate(-50%, 8px)' }}
        >
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--color-border)]">
            <Info size={16} className="text-[var(--color-primary)]" />
            <h4 className="font-semibold text-sm m-0 text-[var(--color-text)]">
              {provenance.metric}
            </h4>
          </div>
          
          <div className="space-y-3 text-xs">
            <div>
              <div className="text-[var(--color-text-muted)] font-semibold uppercase tracking-wider text-[10px] mb-1">Source</div>
              <div className="text-[var(--color-text-secondary)]">{provenance.source}</div>
            </div>

            <div>
              <div className="text-[var(--color-text-muted)] font-semibold uppercase tracking-wider text-[10px] mb-1">Calculation</div>
              <div className="text-[var(--color-text-secondary)] font-mono text-[11px] bg-[var(--color-bg)] p-1 rounded border border-[var(--color-border)]">
                {provenance.formula}
              </div>
            </div>

            <div>
              <div className="text-[var(--color-text-muted)] font-semibold uppercase tracking-wider text-[10px] mb-1">Scope</div>
              <div className="text-[var(--color-text-secondary)]">{provenance.scope}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[var(--color-text-muted)] font-semibold uppercase tracking-wider text-[10px] mb-1">Snapshot</div>
                <div className="text-[var(--color-text-secondary)] font-mono truncate" title={provenance.snapshotId}>
                  {provenance.snapshotId ? provenance.snapshotId.slice(-6) : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-[var(--color-text-muted)] font-semibold uppercase tracking-wider text-[10px] mb-1">Timestamp</div>
                <div className="text-[var(--color-text-secondary)] truncate">
                  {provenance.timestamp ? new Date(provenance.timestamp).toLocaleDateString() : 'N/A'}
                </div>
              </div>
            </div>

            {(provenance.jobId || provenance.testRunId) && (
              <div className="bg-[#3b82f6]/5 p-2 rounded border border-[#3b82f6]/10">
                <div className="text-[#3b82f6] font-semibold uppercase tracking-wider text-[10px] mb-1 flex items-center gap-1">
                  <ExternalLink size={10} /> Evidence Linkage
                </div>
                {provenance.jobId && (
                  <div className="text-[var(--color-text-secondary)] flex justify-between">
                    <span>Job:</span> <span className="font-mono text-[10px]">{provenance.jobId.slice(-8)}</span>
                  </div>
                )}
                {provenance.testRunId && (
                  <div className="text-[var(--color-text-secondary)] flex justify-between mt-1">
                    <span>TestRun:</span> <span className="font-mono text-[10px]">{provenance.testRunId.slice(-8)}</span>
                  </div>
                )}
              </div>
            )}

            {provenance.limitation && (
              <div className="bg-[var(--color-warning)]/10 p-2 rounded border border-[var(--color-warning)]/20 text-[var(--color-warning)]">
                <div className="font-semibold uppercase tracking-wider text-[10px] mb-1">Limitation</div>
                <div>{provenance.limitation}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
