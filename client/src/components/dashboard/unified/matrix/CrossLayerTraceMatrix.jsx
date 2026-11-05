import { useState, useMemo, Fragment } from "react";
import {
  Search,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Sparkles,
  FileSearch,
  ArrowRight,
  Filter,
  X,
} from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { ZonePanel } from "../primitives/ZonePanel.jsx";

function matchesCrossFilter(row, cf) {
  if (!cf) return true;

  if (cf.file) {
    const fileName = cf.file.toLowerCase();
    const unitFile = (row.layerDetails?.unit?.file || row.unit?.path || "").toLowerCase();
    if (unitFile.includes(fileName)) return true;
  }

  if (cf.category) {
    const cat = cf.category.toLowerCase();
    const rowCats = (row.failureCategories || []).map((c) => c.toLowerCase());
    if (rowCats.some((rc) => rc.includes(cat) || cat.includes(rc))) return true;

    const stuck = (row.layerDetails?.integration?.stuckLayer || row.layerDetails?.integration?.failureLayer || "").toLowerCase();
    const sysKind = (row.layerDetails?.system?.failureKind || "").toLowerCase();
    const diag = (row.rootCause?.diagnosis || "").toLowerCase();
    if (
      (stuck && cat.includes(stuck)) ||
      (sysKind && (cat.includes(sysKind) || sysKind.includes(cat))) ||
      diag.includes(cat)
    ) {
      return true;
    }
    return false;
  }

  if (cf.pillar) {
    const p = cf.pillar;
    if (row.rootCause?.suspectLayer === p) return true;
    if (row[p]?.status === "fail" || row[p]?.status === "warn") return true;
    return true;
  }

  return true;
}

export function CrossLayerTraceMatrix({
  matrixData,
  onNavigateWorkspace,
  onInspectItem,
  onAskAi,
  activeCrossFilter = null,
  onClearCrossFilter,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState("all"); // 'all' | 'failure' | 'low_coverage'
  const [expandedRows, setExpandedRows] = useState(() => new Set());

  const rows = useMemo(() => matrixData?.rows || [], [matrixData?.rows]);

  // Toggle row expansion
  const toggleExpand = (rowId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  // Filter rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // Cross-filter from Zone 3
      if (activeCrossFilter && !matchesCrossFilter(r, activeCrossFilter)) {
        return false;
      }

      // Search text
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (r.moduleName || "").toLowerCase().includes(q);
        const matchDesc = (r.description || "").toLowerCase().includes(q);
        const matchDiagnosis = (r.rootCause?.diagnosis || "").toLowerCase().includes(q);
        const matchEndpoint = (r.integration?.endpoint || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchDiagnosis && !matchEndpoint) return false;
      }

      // Filter state
      if (filterState === "failure") {
        return (
          r.unit.status === "fail" ||
          r.integration.status === "fail" ||
          r.system.status === "fail"
        );
      }
      if (filterState === "low_coverage") {
        return (
          r.unit.status === "untested" ||
          r.unit.status === "warn" ||
          r.integration.status === "warn" ||
          r.integration.status === "untested" ||
          r.system.status === "untested" ||
          r.system.status === "warn"
        );
      }
      return true;
    });
  }, [rows, searchQuery, filterState, activeCrossFilter]);

  const handleAskAiForModule = (row, e) => {
    e.stopPropagation();
    const ld = row.layerDetails || {};
    const promptText =
      row.diagnostics?.aiPrompt ||
      `Analyze the 3-layer test state for module "${row.moduleName}":\n` +
        `- Unit (${ld.unit?.file || row.unit?.path || "N/A"}): ${row.unit?.label}, Branch Coverage ${ld.unit?.branchCoveragePct ?? 0}%, Failing functions: ${(ld.unit?.failingFunctions || []).join(", ") || "None"}\n` +
        `- Integration (${ld.integration?.method || "API"} ${ld.integration?.endpoint || row.integration?.endpoint || "N/A"}): HTTP ${ld.integration?.httpStatus || "N/A"}, Stuck Layer: ${ld.integration?.stuckLayer || "None"}\n` +
        `- System E2E (${ld.system?.flowName || row.system?.scenarioId || "N/A"}): Step "${ld.system?.failedStep || "N/A"}", Classification: ${ld.system?.failureKind || "None"}\n` +
        `- Root Cause Summary: ${row.rootCause?.summary} — ${row.rootCause?.diagnosis}\n` +
        `Please provide root cause analysis and fixes across the affected layers.`;

    if (onAskAi) {
      onAskAi(promptText);
    } else if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("covai:prefill-prompt", { detail: { prompt: promptText } })
      );
    }
  };

  const handleOpenInspector = (row, e) => {
    e.stopPropagation();
    if (!onInspectItem) return;
    onInspectItem({
      id: row.id,
      title: `${row.moduleName} — Cross-Layer Diagnostic`,
      pillar:
        row.rootCause?.suspectLayer && row.rootCause.suspectLayer !== "none"
          ? row.rootCause.suspectLayer
          : "integration",
      status:
        row.unit.status === "fail" ||
        row.integration.status === "fail" ||
        row.system.status === "fail"
          ? "fail"
          : row.integration.status === "warn" || row.unit.status === "untested"
          ? "warn"
          : "pass",
      targetName: row.integration?.endpoint || row.unit?.path || row.moduleName,
      summary: row.rootCause?.diagnosis || row.description,
      failureLayer:
        row.diagnostics?.failureLayer ||
        row.layerDetails?.integration?.stuckLayer ||
        "Cross-Layer Trace",
      httpStatus: row.layerDetails?.integration?.httpStatus,
      durationMs: row.diagnostics?.durationMs || null,
      stackTrace: row.diagnostics?.stackTrace || null,
      testCases: row.diagnostics?.testCases || [],
      focusParams: row.unit?.path
        ? { focusFile: row.unit.path }
        : row.integration?.endpoint
        ? { focusEndpoint: row.integration.endpoint }
        : {},
      aiPrompt: row.diagnostics?.aiPrompt,
    });
  };

  return (
    <ZonePanel
      id="ud-zone-matrix"
      title="Cross-Layer Traceability Matrix"
      description="Click any module row to expand its 3-tier Unit → Integration → System diagnostic flow"
      contentClassName="p-0"
      className="h-full"
      actions={
        <div className="flex flex-wrap items-center gap-2 ud-no-print">
          {/* Search Box */}
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ud-text-muted)] pointer-events-none"
            />
            <input
              id="ud-matrix-search"
              type="text"
              placeholder="Search module, endpoint, cause..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2.5 py-1 text-xs rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] placeholder-[var(--ud-text-muted)] focus:outline-hidden focus:border-[var(--color-focus)] w-48 sm:w-56"
            />
          </div>

          {/* Filter Group */}
          <SegmentedFilter
            idPrefix="ud-matrix-filter"
            options={[
              { label: "All", value: "all", count: rows.length },
              {
                label: "Has Failure",
                value: "failure",
                count: rows.filter(
                  (r) =>
                    r.unit.status === "fail" ||
                    r.integration.status === "fail" ||
                    r.system.status === "fail"
                ).length,
              },
              {
                label: "Coverage Gap",
                value: "low_coverage",
                count: rows.filter(
                  (r) =>
                    r.unit.status === "untested" ||
                    r.integration.status === "warn" ||
                    r.integration.status === "untested" ||
                    r.system.status === "untested"
                ).length,
              },
            ]}
            value={filterState}
            onChange={setFilterState}
            size="sm"
          />
        </div>
      }
    >
      {/* Active Cross-Filter Banner */}
      {activeCrossFilter && (
        <div className="px-4 py-2 bg-[var(--ud-unit)]/10 border-b border-[var(--ud-unit)]/30 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-[var(--ud-text)]">
            <Filter size={13} className="text-[var(--ud-unit)] shrink-0" />
            <span>
              Cross-Filtering by{" "}
              <strong className="font-mono text-[var(--ud-unit)]">
                {activeCrossFilter.label}
              </strong>{" "}
              ({filteredRows.length} matching{" "}
              {filteredRows.length === 1 ? "module" : "modules"})
            </span>
          </div>
          {onClearCrossFilter && (
            <button
              type="button"
              onClick={onClearCrossFilter}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[11px] font-mono text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] cursor-pointer"
            >
              <span>Clear Filter</span>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Table Container */}
      <div className="w-full overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 text-[var(--ud-text-muted)] font-medium select-none sticky top-0 z-10">
              <th className="py-2.5 px-3 w-9 text-center"></th>
              <th className="py-2.5 px-3 min-w-[180px]">Module / Feature</th>
              <th className="py-2.5 px-3 min-w-[135px]">
                <div className="flex items-center gap-1.5">
                  <PillarBadge pillar="unit" size="sm" />
                  <span>Functions</span>
                </div>
              </th>
              <th className="py-2.5 px-3 min-w-[140px]">
                <div className="flex items-center gap-1.5">
                  <PillarBadge pillar="integration" size="sm" />
                  <span>API / DB</span>
                </div>
              </th>
              <th className="py-2.5 px-3 min-w-[135px]">
                <div className="flex items-center gap-1.5">
                  <PillarBadge pillar="system" size="sm" />
                  <span>UI Flow</span>
                </div>
              </th>
              <th className="py-2.5 px-4 min-w-[220px]">Root Cause Diagnosis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ud-border)]">
            {filteredRows.length > 0 ? (
              filteredRows.map((row) => {
                const isExpanded = expandedRows.has(row.id) || Boolean(activeCrossFilter);
                const ld = row.layerDetails || {
                  unit: {
                    file: row.unit?.path || "Unmapped service file",
                    branchCoveragePct: row.unit?.status === "pass" ? 80 : 0,
                    failingFunctions: [],
                  },
                  integration: {
                    method: (row.integration?.endpoint || "GET").split(" ")[0] || "GET",
                    endpoint:
                      (row.integration?.endpoint || "/api").split(" ").slice(1).join(" ") ||
                      row.integration?.endpoint ||
                      "/api",
                    httpStatus:
                      row.integration?.status === "fail"
                        ? 500
                        : row.integration?.status === "pass"
                        ? 200
                        : null,
                    stuckLayer:
                      row.integration?.status === "fail" ? "Controller" : "None",
                  },
                  system: {
                    flowName: row.system?.scenarioId || "E2E User Journey",
                    failedStep:
                      row.system?.status === "fail" ? "Assertion Step" : "None",
                    failureKind:
                      row.system?.status === "fail" ? "UI Assertion" : "None",
                  },
                };

                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => toggleExpand(row.id)}
                      className={`group transition-colors cursor-pointer ${
                        isExpanded
                          ? "bg-[var(--ud-surface-2)]/80"
                          : "hover:bg-[var(--ud-surface-2)]/50"
                      }`}
                    >
                      {/* Expand Toggle */}
                      <td className="py-3 px-3 text-center align-top">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(row.id);
                          }}
                          className="p-1 rounded text-[var(--ud-text-muted)] group-hover:text-[var(--ud-text)] transition-colors cursor-pointer"
                          aria-expanded={isExpanded}
                          title={
                            isExpanded
                              ? "Collapse 3-tier drill-down"
                              : "Expand 3-tier drill-down"
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown size={14} className="text-[var(--ud-unit)]" />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                      </td>

                      {/* Module Name & Summary */}
                      <td className="py-3 px-3 align-top">
                        <div className="font-semibold text-[var(--ud-text)] flex items-center gap-1.5">
                          <span>{row.moduleName}</span>
                        </div>
                        <div className="text-[11px] text-[var(--ud-text-muted)] line-clamp-1 mt-0.5 font-sans">
                          {row.description}
                        </div>
                      </td>

                      {/* Unit Cell */}
                      <td className="py-3 px-3 align-top">
                        <StatusPill
                          status={row.unit.status}
                          label={row.unit.label}
                          size="sm"
                        />
                        {row.unit.path && (
                          <div className="text-[10px] font-mono text-[var(--ud-text-muted)] truncate max-w-[130px] mt-1">
                            {row.unit.path.split("/").pop()}
                          </div>
                        )}
                      </td>

                      {/* Integration Cell */}
                      <td className="py-3 px-3 align-top">
                        <StatusPill
                          status={row.integration.status}
                          label={row.integration.label}
                          size="sm"
                        />
                        {row.integration.endpoint && (
                          <div className="text-[10px] font-mono text-[var(--ud-text-muted)] truncate max-w-[140px] mt-1">
                            {row.integration.endpoint}
                          </div>
                        )}
                      </td>

                      {/* System Cell */}
                      <td className="py-3 px-3 align-top">
                        <StatusPill
                          status={row.system.status}
                          label={row.system.label}
                          size="sm"
                        />
                        {row.system.scenarioId && (
                          <div className="text-[10px] font-mono text-[var(--ud-text-muted)] truncate max-w-[130px] mt-1">
                            {row.system.scenarioId}
                          </div>
                        )}
                      </td>

                      {/* Root Cause Diagnosis */}
                      <td className="py-3 px-4 align-top">
                        <div className="flex items-start gap-1.5">
                          {row.rootCause.suspectLayer !== "none" && (
                            <PillarBadge
                              pillar={row.rootCause.suspectLayer}
                              size="sm"
                              showIcon={false}
                            />
                          )}
                          <span className="font-semibold text-[var(--ud-text)] font-sans">
                            {row.rootCause.summary}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ud-text-muted)] mt-1 font-sans leading-relaxed">
                          {row.rootCause.diagnosis}
                        </p>
                      </td>
                    </tr>

                    {/* Expanded 3-Tier Cross-Layer Traceability Drill-Down Panel */}
                    {isExpanded && (
                      <tr className="bg-[var(--ud-bg)]/70 border-b border-[var(--ud-border)]">
                        <td colSpan={6} className="p-4">
                          <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 space-y-3.5">
                            {/* Top Header & Quick Actions */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--ud-border)]">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--ud-text-muted)]">
                                  3-Tier Cross-Layer Traceability Flow
                                </span>
                                <span className="text-[var(--ud-border)]">•</span>
                                <span className="text-xs font-semibold text-[var(--ud-text)]">
                                  {row.moduleName}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 ud-no-print">
                                {onInspectItem && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleOpenInspector(row, e)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[11px] font-medium text-[var(--ud-text)] hover:border-[var(--ud-text-muted)] transition-colors cursor-pointer"
                                  >
                                    <FileSearch size={12} className="text-[var(--ud-unit)]" />
                                    <span>Inspect Diagnostics</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => handleAskAiForModule(row, e)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--ud-unit)]/40 bg-[var(--ud-unit)]/10 text-[11px] font-semibold text-[var(--ud-unit)] hover:bg-[var(--ud-unit)]/20 transition-colors cursor-pointer"
                                >
                                  <Sparkles size={12} />
                                  <span>Ask COV AI to Diagnose</span>
                                </button>
                              </div>
                            </div>

                            {/* 3-Tier Connected Flow Diagram */}
                            <div className="grid grid-cols-1 lg:grid-cols-11 gap-2.5 items-stretch">
                              {/* TIER 1: UNIT LAYER */}
                              <div className="lg:col-span-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 p-3 flex flex-col justify-between gap-2.5">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <PillarBadge pillar="unit" size="sm" />
                                    <StatusPill
                                      status={row.unit.status}
                                      label={row.unit.label}
                                      size="sm"
                                    />
                                  </div>
                                  <div className="space-y-1 text-[11px]">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[var(--ud-text-muted)]">File:</span>
                                      <span
                                        className="font-mono text-[var(--ud-text)] truncate max-w-[170px]"
                                        title={ld.unit?.file}
                                      >
                                        {ld.unit?.file || "N/A"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[var(--ud-text-muted)]">
                                        Branch Coverage:
                                      </span>
                                      <span
                                        className={`font-mono font-semibold ${
                                          (ld.unit?.branchCoveragePct ?? 0) >= 75
                                            ? "text-[var(--ud-pass)]"
                                            : (ld.unit?.branchCoveragePct ?? 0) > 0
                                            ? "text-[var(--ud-warn)]"
                                            : "text-[var(--ud-text-muted)]"
                                        }`}
                                      >
                                        {ld.unit?.branchCoveragePct ?? 0}%
                                      </span>
                                    </div>
                                    <div className="pt-1 border-t border-[var(--ud-border)]/60">
                                      <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--ud-text-muted)] block mb-1">
                                        Failing Functions:
                                      </span>
                                      {ld.unit?.failingFunctions?.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                          {ld.unit.failingFunctions.map((fn, idx) => (
                                            <span
                                              key={idx}
                                              className="px-1.5 py-0.5 rounded bg-[var(--ud-fail)]/10 border border-[var(--ud-fail)]/30 text-[var(--ud-fail)] font-mono text-[10px]"
                                            >
                                              {fn}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="font-mono text-[10px] text-[var(--ud-text-muted)]">
                                          None (0 failing functions)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigateWorkspace(
                                      "unit",
                                      row.unit?.path ? { focusFile: row.unit.path } : {}
                                    );
                                  }}
                                  className="inline-flex items-center justify-between w-full pt-2 border-t border-[var(--ud-border)]/60 text-[11px] font-mono text-[var(--ud-unit)] hover:underline cursor-pointer"
                                >
                                  <span>Open Unit Workspace</span>
                                  <ExternalLink size={11} />
                                </button>
                              </div>

                              {/* Connector 1 -> 2 */}
                              <div className="hidden lg:flex lg:col-span-1 items-center justify-center text-[var(--ud-text-muted)]">
                                <ArrowRight size={16} />
                              </div>

                              {/* TIER 2: INTEGRATION LAYER */}
                              <div className="lg:col-span-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 p-3 flex flex-col justify-between gap-2.5">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <PillarBadge pillar="integration" size="sm" />
                                    <StatusPill
                                      status={row.integration.status}
                                      label={row.integration.label}
                                      size="sm"
                                    />
                                  </div>
                                  <div className="space-y-1 text-[11px]">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[var(--ud-text-muted)]">Endpoint:</span>
                                      <span className="font-mono font-semibold text-[var(--ud-text)] truncate max-w-[175px]">
                                        {ld.integration?.method || "API"}{" "}
                                        {ld.integration?.endpoint || ""}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[var(--ud-text-muted)]">
                                        HTTP Response:
                                      </span>
                                      <span
                                        className={`font-mono font-semibold px-1.5 py-0.2 rounded ${
                                          ld.integration?.httpStatus >= 400
                                            ? "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)]"
                                            : ld.integration?.httpStatus >= 200
                                            ? "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)]"
                                            : "text-[var(--ud-warn)]"
                                        }`}
                                      >
                                        {ld.integration?.httpStatus
                                          ? `HTTP ${ld.integration.httpStatus}`
                                          : "UNCOVERED"}
                                      </span>
                                    </div>
                                    <div className="pt-1 border-t border-[var(--ud-border)]/60 flex items-center justify-between gap-2">
                                      <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--ud-text-muted)]">
                                        Stuck Layer:
                                      </span>
                                      <span
                                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
                                          ld.integration?.stuckLayer &&
                                          ld.integration.stuckLayer !== "None"
                                            ? "border-[var(--ud-warn)]/40 bg-[var(--ud-warn)]/10 text-[var(--ud-warn)] font-semibold"
                                            : "border-[var(--ud-border)] text-[var(--ud-text-muted)]"
                                        }`}
                                      >
                                        {ld.integration?.stuckLayer || "None"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigateWorkspace(
                                      "integration",
                                      row.integration?.endpoint
                                        ? { focusEndpoint: row.integration.endpoint }
                                        : {}
                                    );
                                  }}
                                  className="inline-flex items-center justify-between w-full pt-2 border-t border-[var(--ud-border)]/60 text-[11px] font-mono text-[var(--ud-integration)] hover:underline cursor-pointer"
                                >
                                  <span>Open Integration Workspace</span>
                                  <ExternalLink size={11} />
                                </button>
                              </div>

                              {/* Connector 2 -> 3 */}
                              <div className="hidden lg:flex lg:col-span-1 items-center justify-center text-[var(--ud-text-muted)]">
                                <ArrowRight size={16} />
                              </div>

                              {/* TIER 3: SYSTEM (E2E) LAYER */}
                              <div className="lg:col-span-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 p-3 flex flex-col justify-between gap-2.5">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <PillarBadge pillar="system" size="sm" />
                                    <StatusPill
                                      status={row.system.status}
                                      label={row.system.label}
                                      size="sm"
                                    />
                                  </div>
                                  <div className="space-y-1 text-[11px]">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[var(--ud-text-muted)]">UI Flow:</span>
                                      <span
                                        className="font-mono text-[var(--ud-text)] truncate max-w-[170px]"
                                        title={ld.system?.flowName}
                                      >
                                        {ld.system?.flowName || "N/A"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[var(--ud-text-muted)]">
                                        Stopped Step:
                                      </span>
                                      <span
                                        className="font-mono text-[var(--ud-text)] truncate max-w-[165px]"
                                        title={ld.system?.failedStep}
                                      >
                                        {ld.system?.failedStep || "None"}
                                      </span>
                                    </div>
                                    <div className="pt-1 border-t border-[var(--ud-border)]/60 flex items-center justify-between gap-2">
                                      <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--ud-text-muted)]">
                                        UI Error Type:
                                      </span>
                                      <span
                                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
                                          ld.system?.failureKind &&
                                          ld.system.failureKind !== "None"
                                            ? "border-[var(--ud-fail)]/40 bg-[var(--ud-fail)]/10 text-[var(--ud-fail)] font-semibold"
                                            : "border-[var(--ud-border)] text-[var(--ud-text-muted)]"
                                        }`}
                                      >
                                        {ld.system?.failureKind || "None"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigateWorkspace(
                                      "system",
                                      row.system?.scenarioId
                                        ? { focusScenario: row.system.scenarioId }
                                        : {}
                                    );
                                  }}
                                  className="inline-flex items-center justify-between w-full pt-2 border-t border-[var(--ud-border)]/60 text-[11px] font-mono text-[var(--ud-system)] hover:underline cursor-pointer"
                                >
                                  <span>Open System E2E Workspace</span>
                                  <ExternalLink size={11} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="py-10 px-4 text-center">
                  <div className="max-w-sm mx-auto space-y-2.5">
                    <p className="text-xs font-semibold text-[var(--ud-text)]">
                      {rows.length === 0
                        ? "No Cross-Layer Domain Modules Discovered Yet"
                        : "No modules match the active filter criteria"}
                    </p>
                    <p className="text-[11px] text-[var(--ud-text-muted)] font-sans leading-relaxed">
                      {rows.length === 0
                        ? "Execute Unit, Integration, or System test suites to populate 3-tier cross-layer traceability and automated root-cause diagnostics."
                        : "Try clearing the search query or removing the active cross-filter."}
                    </p>
                    {activeCrossFilter && onClearCrossFilter && (
                      <div className="flex items-center justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={onClearCrossFilter}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-xs font-mono text-[var(--ud-text)] hover:border-[var(--ud-text-muted)] cursor-pointer"
                        >
                          <X size={12} />
                          <span>Clear Cross-Filter</span>
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ZonePanel>
  );
}

export default CrossLayerTraceMatrix;
