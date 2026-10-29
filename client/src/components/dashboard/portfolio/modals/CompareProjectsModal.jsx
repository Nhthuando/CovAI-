import { useState } from "react";
import { X, ArrowLeftRight, Check, Trophy, ExternalLink, ShieldAlert } from "lucide-react";
import { Button } from "../../../common/Button.jsx";

export function CompareProjectsModal({
  isOpen = false,
  onClose,
  projects = [],
  initialSelectedIds = [],
  onOpenOverview,
  onNavigateWorkspace,
}) {
  const [selectedIds, setSelectedIds] = useState(() => {
    if (initialSelectedIds.length >= 2) return initialSelectedIds.slice(0, 3);
    const defaults = projects.slice(0, 2).map((p) => p.id);
    return defaults;
  });

  if (!isOpen) return null;

  const handleSelectSlot = (slotIdx, newId) => {
    setSelectedIds((prev) => {
      const next = [...prev];
      next[slotIdx] = newId;
      return next;
    });
  };

  const handleAddThirdSlot = () => {
    const unused = projects.find((p) => !selectedIds.includes(p.id));
    if (unused) {
      setSelectedIds((prev) => [...prev, unused.id]);
    }
  };

  const handleRemoveSlot = (slotIdx) => {
    setSelectedIds((prev) => prev.filter((_, idx) => idx !== slotIdx));
  };

  const comparedProjects = selectedIds
    .map((id) => projects.find((p) => p.id === id))
    .filter(Boolean);

  // Find winner for key metrics
  const highestHealth = Math.max(...comparedProjects.map((p) => p.healthScore || 0));
  const highestCoverage = Math.max(...comparedProjects.map((p) => p.unifiedCoveragePct || 0));
  const highestPassRate = Math.max(...comparedProjects.map((p) => p.passRatePct || 0));

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans animate-in fade-in duration-150"
    >
      <div className="w-full max-w-5xl max-h-[90vh] rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ud-border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center">
              <ArrowLeftRight size={16} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--ud-text)]">
                Side-by-Side Project Quality Comparison
              </h2>
              <p className="text-xs text-[var(--ud-text-muted)] mt-0.5">
                Head-to-head evaluation of release readiness, testing layers & failure bottlenecks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.length < 3 && projects.length > selectedIds.length && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddThirdSlot}
              >
                + Compare 3rd Project
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Comparison Content Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {/* Project Selector Header Cards */}
          <div className={`grid gap-4 ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {comparedProjects.map((p, idx) => (
              <div
                key={p.id}
                className="p-3 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] space-y-2 relative"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-bold text-[var(--ud-text-muted)] uppercase">
                    Slot {idx + 1}
                  </span>
                  {comparedProjects.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSlot(idx)}
                      className="text-[10px] font-mono text-[var(--ud-fail)] hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <select
                  value={p.id}
                  onChange={(e) => handleSelectSlot(idx, e.target.value)}
                  className="w-full bg-[var(--ud-surface)] border border-[var(--ud-border)] text-xs font-bold rounded px-2 py-1 outline-none text-[var(--ud-text)] cursor-pointer"
                >
                  {projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.name} ({proj.gateStatus})
                    </option>
                  ))}
                </select>

                <div className="flex items-center justify-between pt-1 text-[11px] font-mono">
                  <span className="text-[var(--ud-text-muted)]">Gate Status:</span>
                  <span
                    className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                      p.gateStatus === "PASSED"
                        ? "text-[var(--ud-pass)] bg-[var(--ud-pass)]/10"
                        : p.gateStatus === "BLOCKED"
                        ? "text-[var(--ud-fail)] bg-[var(--ud-fail)]/10"
                        : "text-[var(--ud-warn)] bg-[var(--ud-warn)]/10"
                    }`}
                  >
                    {p.gateLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Comparison Sections */}
          <div className="space-y-4">
            {/* 1. Health Score & Release Readiness */}
            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] overflow-hidden">
              <div className="bg-[var(--ud-surface-2)] px-4 py-2 text-xs font-bold font-mono text-[var(--ud-text)] border-b border-[var(--ud-border)]">
                1. Executive Quality Health & Grade
              </div>
              <div className={`grid divide-x divide-[var(--ud-border)] ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {comparedProjects.map((p) => {
                  const isTopHealth = p.healthScore === highestHealth && highestHealth > 0;
                  return (
                    <div key={p.id} className="p-4 text-center font-mono space-y-1">
                      <div className="text-2xl font-bold flex items-center justify-center gap-1.5">
                        <span className={isTopHealth ? "text-[var(--ud-pass)]" : "text-[var(--ud-text)]"}>
                          {p.healthScore}
                        </span>
                        <span className="text-xs text-[var(--ud-text-muted)] font-normal">/100</span>
                        {isTopHealth && <Trophy size={14} className="text-amber-500" />}
                      </div>
                      <div className="text-xs text-[var(--ud-text-muted)]">Grade {p.grade}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Multi-Layer Coverage Breakdown */}
            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] overflow-hidden">
              <div className="bg-[var(--ud-surface-2)] px-4 py-2 text-xs font-bold font-mono text-[var(--ud-text)] border-b border-[var(--ud-border)]">
                2. 3-Layer Testing Coverage
              </div>
              <div className={`grid divide-x divide-[var(--ud-border)] ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {comparedProjects.map((p) => (
                  <div key={p.id} className="p-4 space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ud-unit)]">Unit Lines:</span>
                      <span className="font-bold text-[var(--ud-text)]">
                        {p.pillars?.unit?.coveragePct ?? 0}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ud-integration)]">Integration APIs:</span>
                      <span className="font-bold text-[var(--ud-text)]">
                        {p.pillars?.integration?.coveragePct ?? 0}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ud-system)]">System Flows:</span>
                      <span className="font-bold text-[var(--ud-text)]">
                        {p.pillars?.system?.coveragePct ?? 0}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--ud-border)]">
                      <span className="text-[var(--ud-text-muted)] font-semibold">Unified Index:</span>
                      <span className="font-bold text-[var(--color-primary)]">
                        {p.unifiedCoveragePct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Execution Scale & Defect Layers */}
            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] overflow-hidden">
              <div className="bg-[var(--ud-surface-2)] px-4 py-2 text-xs font-bold font-mono text-[var(--ud-text)] border-b border-[var(--ud-border)]">
                3. Execution Scale & Defect Layers
              </div>
              <div className={`grid divide-x divide-[var(--ud-border)] ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {comparedProjects.map((p) => {
                  const unitTotal = p.pillars?.unit?.totalTests ?? 0;
                  const intTotal = p.pillars?.integration?.totalTests ?? 0;
                  const sysTotal = p.pillars?.system?.totalTests ?? 0;
                  const totalTests = unitTotal + intTotal + sysTotal;

                  const unitFail = p.pillars?.unit?.failedTests ?? 0;
                  const intFail = p.pillars?.integration?.failedTests ?? 0;
                  const sysFail = p.pillars?.system?.failedTests ?? 0;
                  const totalFail = unitFail + intFail + sysFail;

                  return (
                    <div key={p.id} className="p-4 space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--ud-text-muted)]">Total Tests:</span>
                        <span className="font-bold text-[var(--ud-text)]">{totalTests}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--ud-text-muted)]">Pass Rate:</span>
                        <span className="font-bold text-[var(--ud-text)]">{p.passRatePct ?? 0}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--ud-text-muted)]">Failed Tests:</span>
                        <span className={`font-bold ${totalFail > 0 ? "text-[var(--ud-fail)]" : "text-[var(--ud-pass)]"}`}>
                          {totalFail}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--ud-text-muted)]">Uncovered Gaps:</span>
                        <span className="font-bold text-[var(--ud-warn)]">
                          {p.aiMetrics?.uncoveredGaps ?? 0}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer with Direct Open CTAs */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--ud-border)] bg-[var(--ud-surface-2)]">
          <div className="text-xs text-[var(--ud-text-muted)] font-mono">
            Comparing {comparedProjects.length} projects side-by-side
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            {comparedProjects[0] && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenOverview?.(comparedProjects[0].id);
                }}
              >
                Open {comparedProjects[0].name} →
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CompareProjectsModal;

