import { useState, useRef, useEffect } from "react";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, X, ChevronRight, ShieldCheck } from "lucide-react";

export function PortfolioGatePopover({
  gateBreakdown = { passed: 0, atRisk: 0, blocked: 0, untested: 0, passedPct: 0 },
  totalProjects = 0,
  onSelectStatusFilter,
  className = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const { passed = 0, atRisk = 0, blocked = 0, untested = 0 } = gateBreakdown;

  // Determine overall badge variant
  let badgeBorder = "border-[var(--ud-pass)]/40";
  let badgeBg = "bg-[var(--ud-pass)]/10 text-[var(--ud-pass)]";
  let icon = CheckCircle2;

  if (blocked > 0) {
    badgeBorder = "border-[var(--ud-fail)]/40";
    badgeBg = "bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]";
    icon = XCircle;
  } else if (atRisk > 0 || untested > 0) {
    badgeBorder = "border-[var(--ud-warn)]/40";
    badgeBg = "bg-[var(--ud-warn)]/10 text-[var(--ud-warn)]";
    icon = AlertTriangle;
  }
  const IconComponent = icon;

  return (
    <div className={`relative inline-block ${className}`} ref={popoverRef}>
      {/* Interactive Summary Badge */}
      <button
        type="button"
        id="portfolio-gate-summary-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] text-xs font-mono font-semibold border ${badgeBorder} ${badgeBg} hover:opacity-90 transition-all cursor-pointer`}
        title="View Portfolio Quality Gate Breakdown"
        aria-expanded={isOpen}
      >
        <IconComponent size={13} className="shrink-0" />
        <span>PORTFOLIO GATE: {passed}/{totalProjects} PASSED</span>
        <span className="text-[10px] opacity-75">▾</span>
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-xl z-50 p-4 font-sans animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--ud-border)]">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-[var(--color-primary)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ud-text)]">
                Portfolio Gate Evaluation
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {/* Project Distribution Breakdown */}
          <div className="grid grid-cols-2 gap-2 my-3">
            <button
              type="button"
              onClick={() => {
                onSelectStatusFilter?.("PASSED");
                setIsOpen(false);
              }}
              className="p-2 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] hover:border-[var(--ud-pass)] text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-[11px] text-[var(--ud-text-muted)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--ud-pass)]" />
                  Passed
                </span>
                <ChevronRight size={12} />
              </div>
              <div className="mt-1 font-mono text-base font-bold text-[var(--ud-pass)]">
                {passed} <span className="text-xs font-normal text-[var(--ud-text-muted)]">({totalProjects > 0 ? Math.round((passed / totalProjects) * 100) : 0}%)</span>
              </div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">Ready to Release</div>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectStatusFilter?.("AT_RISK");
                setIsOpen(false);
              }}
              className="p-2 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] hover:border-[var(--ud-warn)] text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-[11px] text-[var(--ud-text-muted)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--ud-warn)]" />
                  At Risk
                </span>
                <ChevronRight size={12} />
              </div>
              <div className="mt-1 font-mono text-base font-bold text-[var(--ud-warn)]">
                {atRisk} <span className="text-xs font-normal text-[var(--ud-text-muted)]">({totalProjects > 0 ? Math.round((atRisk / totalProjects) * 100) : 0}%)</span>
              </div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">Low Cov / Warnings</div>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectStatusFilter?.("BLOCKED");
                setIsOpen(false);
              }}
              className="p-2 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] hover:border-[var(--ud-fail)] text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-[11px] text-[var(--ud-text-muted)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--ud-fail)]" />
                  Blocked
                </span>
                <ChevronRight size={12} />
              </div>
              <div className="mt-1 font-mono text-base font-bold text-[var(--ud-fail)]">
                {blocked} <span className="text-xs font-normal text-[var(--ud-text-muted)]">({totalProjects > 0 ? Math.round((blocked / totalProjects) * 100) : 0}%)</span>
              </div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">Critical Failures</div>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectStatusFilter?.("UNTESTED");
                setIsOpen(false);
              }}
              className="p-2 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] hover:border-[var(--ud-neutral)] text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-[11px] text-[var(--ud-text-muted)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--ud-neutral)]" />
                  Untested
                </span>
                <ChevronRight size={12} />
              </div>
              <div className="mt-1 font-mono text-base font-bold text-[var(--ud-text-muted)]">
                {untested} <span className="text-xs font-normal text-[var(--ud-text-muted)]">({totalProjects > 0 ? Math.round((untested / totalProjects) * 100) : 0}%)</span>
              </div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">No Suites Executed</div>
            </button>
          </div>

          {/* Portfolio-Wide Threshold Rules Checklist */}
          <div className="pt-2 border-t border-[var(--ud-border)] space-y-1.5 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ud-text-muted)]">
              Account Release Gate Criteria:
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--ud-text-muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ud-unit)] shrink-0" />
              <span>Project Health Score $\ge$ 80 / 100 with zero critical defects</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--ud-text-muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ud-integration)] shrink-0" />
              <span>Unit Branch $\ge$ 75% • API Endpoint Coverage $\ge$ 80%</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--ud-text-muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ud-system)] shrink-0" />
              <span>Critical E2E User Journeys Passing = 100%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PortfolioGatePopover;

