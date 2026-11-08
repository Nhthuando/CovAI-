import { useState, useEffect } from "react";
import { X, ArrowLeftRight, Trophy } from "lucide-react";
import { Button } from "../../../common/Button.jsx";
import ProjectComparisonRadarChart from "../charts/ProjectComparisonRadarChart.jsx";
import { compareProjectsApi } from "../../../../services/portfolio.service.js";

export function CompareProjectsModal({
  isOpen = false,
  onClose,
  projects = [],
  initialSelectedIds = [],
  onOpenOverview,
}) {
  const [selectedIds, setSelectedIds] = useState(() => {
    if (initialSelectedIds.length >= 2) return initialSelectedIds.slice(0, 3);
    const defaults = projects.slice(0, 2).map((p) => p.id);
    return defaults;
  });

  const [prevInitial, setPrevInitial] = useState(initialSelectedIds);
  if (isOpen && initialSelectedIds !== prevInitial) {
    setPrevInitial(initialSelectedIds);
    if (initialSelectedIds.length >= 2) {
      setSelectedIds(initialSelectedIds.slice(0, 3));
    }
  }

  const [compareData, setCompareData] = useState(null);

  // Fetch live comparison telemetry from API
  useEffect(() => {
    if (!isOpen || selectedIds.length === 0) return;
    let ignore = false;

    compareProjectsApi(selectedIds)
      .then((res) => {
        if (!ignore && res?.projects) {
          setCompareData(res.projects);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch compare data:", err);
      });

    return () => {
      ignore = true;
    };
  }, [isOpen, selectedIds]);

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

  // Merge projects from props with live compareData
  const comparedProjects = selectedIds
    .map((id) => {
      const live = (compareData || []).find((p) => p.id === id);
      const local = projects.find((p) => p.id === id);
      return live ? { ...local, ...live } : local;
    })
    .filter(Boolean);

  // Find winner for key metrics
  const highestHealth = Math.max(...comparedProjects.map((p) => p.healthScore || 0));

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm font-sans animate-in fade-in duration-150"
    >
      <div className="w-full max-w-5xl max-h-[92vh] rounded-lg border border-[#30363d] bg-[#161b22] text-[#c9d1d9] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-[#388bfd]/15 text-[#58a6ff] flex items-center justify-center">
              <ArrowLeftRight size={16} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#f0f6fc]">
                Side-by-Side Project Quality Comparison
              </h2>
              <p className="text-xs text-[#8b949e] mt-0.5">
                5-Axis Radar and comparative breakdown of release readiness, testing layers & Time ROI
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.length < 3 && projects.length > selectedIds.length && (
              <Button variant="outline" size="sm" onClick={handleAddThirdSlot}>
                + Compare 3rd Project
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Comparison Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Project Selector Header Cards */}
          <div className={`grid gap-4 ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {comparedProjects.map((p, idx) => (
              <div
                key={p.id}
                className="p-3 rounded-md bg-[#0d1117] border border-[#30363d] space-y-2 relative"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-bold text-[#8b949e] uppercase">
                    Slot {idx + 1}
                  </span>
                  {comparedProjects.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSlot(idx)}
                      className="text-[10px] font-mono text-[#f85149] hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <select
                  value={p.id}
                  onChange={(e) => handleSelectSlot(idx, e.target.value)}
                  className="w-full bg-[#161b22] border border-[#30363d] text-xs font-bold rounded px-2 py-1 outline-none text-[#f0f6fc] cursor-pointer"
                >
                  {projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.name} ({proj.gateStatus})
                    </option>
                  ))}
                </select>

                <div className="flex items-center justify-between pt-1 text-[11px] font-mono">
                  <span className="text-[#8b949e]">Gate Status:</span>
                  <span
                    className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                      p.gateStatus === "PASSED"
                        ? "text-[#3fb950] bg-[#238636]/15"
                        : p.gateStatus === "BLOCKED"
                        ? "text-[#f85149] bg-[#da3633]/15"
                        : "text-[#d29922] bg-[#bb8009]/15"
                    }`}
                  >
                    {p.gateLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* ── 5-Axis Radar Chart Visualizer ───────────────────────────────── */}
          <div className="p-4 rounded-md border border-[#30363d] bg-[#0d1117] flex flex-col items-center">
            <div className="text-xs font-bold font-mono text-[#f0f6fc] mb-2">
              5-Axis Radar: Quality, Coverage & Automation Efficiency
            </div>
            <ProjectComparisonRadarChart projects={comparedProjects} size={300} />
          </div>

          {/* Comparison Sections */}
          <div className="space-y-4">
            {/* 1. Health Score & Release Readiness */}
            <div className="rounded-md border border-[#30363d] overflow-hidden">
              <div className="bg-[#0d1117] px-4 py-2 text-xs font-bold font-mono text-[#f0f6fc] border-b border-[#30363d]">
                1. Executive Quality Health & Grade
              </div>
              <div className={`grid divide-x divide-[#30363d] ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {comparedProjects.map((p) => {
                  const isTopHealth = p.healthScore === highestHealth && highestHealth > 0;
                  return (
                    <div key={p.id} className="p-4 text-center font-mono space-y-1 bg-[#161b22]">
                      <div className="text-2xl font-bold flex items-center justify-center gap-1.5">
                        <span className={isTopHealth ? "text-[#3fb950]" : "text-[#f0f6fc]"}>
                          {p.healthScore}
                        </span>
                        <span className="text-xs text-[#8b949e] font-normal">/100</span>
                        {isTopHealth && <Trophy size={14} className="text-amber-400" />}
                      </div>
                      <div className="text-xs text-[#8b949e]">Grade {p.grade}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Multi-Layer Coverage Breakdown */}
            <div className="rounded-md border border-[#30363d] overflow-hidden">
              <div className="bg-[#0d1117] px-4 py-2 text-xs font-bold font-mono text-[#f0f6fc] border-b border-[#30363d]">
                2. 3-Layer Testing Coverage
              </div>
              <div className={`grid divide-x divide-[#30363d] ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {comparedProjects.map((p) => (
                  <div key={p.id} className="p-4 space-y-2 text-xs font-mono bg-[#161b22]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#58a6ff]">Unit Lines:</span>
                      <span className="font-bold text-[#f0f6fc]">
                        {p.pillars?.unit?.coveragePct ?? 0}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#bc8cff]">Integration APIs:</span>
                      <span className="font-bold text-[#f0f6fc]">
                        {p.pillars?.integration?.coveragePct ?? 0}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#3fb950]">System Flows:</span>
                      <span className="font-bold text-[#f0f6fc]">
                        {p.pillars?.system?.coveragePct ?? 0}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-[#30363d]">
                      <span className="text-[#8b949e] font-semibold">Unified Index:</span>
                      <span className="font-bold text-[#58a6ff]">
                        {p.unifiedCoveragePct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Time Saved & Execution ROI */}
            <div className="rounded-md border border-[#30363d] overflow-hidden">
              <div className="bg-[#0d1117] px-4 py-2 text-xs font-bold font-mono text-[#f0f6fc] border-b border-[#30363d] flex items-center justify-between">
                <span>3. Automation Time ROI & Manual Savings</span>
                <span className="text-[10px] text-[#8b949e] font-normal">Industry Benchmark: 120s/300s/480s</span>
              </div>
              <div className={`grid divide-x divide-[#30363d] ${comparedProjects.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {comparedProjects.map((p) => {
                  const timeRoi = p.timeRoi || {};
                  return (
                    <div key={p.id} className="p-4 space-y-2 text-xs font-mono bg-[#161b22]">
                      <div className="flex items-center justify-between">
                        <span className="text-[#8b949e]">Auto Run Duration:</span>
                        <span className="font-bold text-[#f0f6fc]">
                          {timeRoi.actualAutoDurationFormatted || "0s"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#8b949e]">Manual Testing Est:</span>
                        <span className="font-bold text-[#d29922]">
                          {timeRoi.estimatedManualDurationFormatted || "0s"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#8b949e]">Speedup Velocity:</span>
                        <span className="font-bold text-[#58a6ff]">
                          {timeRoi.speedupMultiplier > 1 ? `⚡ ${timeRoi.speedupMultiplier}x Faster` : "1.0x"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-[#30363d]">
                        <span className="text-[#8b949e] font-semibold">Total QA Saved:</span>
                        <span className="font-bold text-[#3fb950]">
                          +{timeRoi.totalHoursSaved || 0} hrs
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#30363d] bg-[#0d1117]">
          <div className="text-xs text-[#8b949e] font-mono">
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
