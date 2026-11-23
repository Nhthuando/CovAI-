import React, { useMemo, useState } from "react";
import {
  Search,
  ChevronRight,
  ChevronDown,
  FileCode2,
  Play,
  Plus,
  Edit3,
  Code2,
  Trash2,
  Wand2,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronsUpDown,
  Check,
  AlertTriangle,
  RefreshCw,
  Camera,
} from "lucide-react";
import {
  getSystemGroupCaseCoverage,
  summarizeSystemFailure,
} from "./systemCaseCoverage.js";

function systemScenarioAnnotationKey(sc, idx) {
  return String(
    sc?.id || `${sc?.filePath || sc?.testFile || "spec"}::${sc?.title || idx}`,
  );
}

function normalizeStatus(status = "") {
  const s = String(status || "").toUpperCase();
  if (s === "PASS" || s === "PASSED" || s === "SUCCESS") return "PASS";
  if (s === "FAIL" || s === "FAILED" || s === "ERROR" || s === "TIMEDOUT" || s === "INTERRUPTED") {
    return "FAIL";
  }
  if (s === "FLAKY") return "FLAKY";
  return "NOT_RUN";
}

function getGroupStatus(group) {
  if (group.hasDraftOnly && !(group.scenarios || []).length) return "DRAFT";
  const scenarios = group.scenarios || [];
  if (scenarios.some((sc) => normalizeStatus(sc.status) === "FAIL")) return "FAIL";
  if (scenarios.some((sc) => normalizeStatus(sc.status) === "FLAKY")) return "FLAKY";
  const passedCount = scenarios.filter((sc) => normalizeStatus(sc.status) === "PASS").length;
  if (scenarios.length > 0 && passedCount === scenarios.length) return "PASS";
  if (passedCount > 0) return "PARTIAL";
  if (group.hasDraft) return "DRAFT";
  return "UNCOVERED";
}

const STATUS_BADGE = {
  PASS: { label: "Covered", dot: "bg-emerald-400", text: "text-emerald-400" },
  PARTIAL: { label: "Partial", dot: "bg-amber-400", text: "text-amber-400" },
  FAIL: { label: "Failed", dot: "bg-rose-400", text: "text-rose-400" },
  FLAKY: { label: "Flaky", dot: "bg-amber-400", text: "text-amber-400" },
  DRAFT: { label: "Draft Ready", dot: "bg-sky-400", text: "text-sky-400" },
  UNCOVERED: { label: "Uncovered", dot: "bg-[var(--color-text-muted)]", text: "text-[var(--color-text-muted)]" },
};

export default function SystemSpecMatrixTable({
  specGroups = [],
  framework = "playwright",
  latestDraft = null,
  syncingCatalog = false,
  applyingDraft = false,
  runningTarget = null,
  fixingTarget = null,
  deletingTarget = null,
  canRunTests = true,
  canEditTests = true,
  canUseAi = true,
  onSyncCatalog,
  onOpenGenerator,
  onGenerateSelected,
  onApplyDraft,
  onRunSelectedFiles,
  onRunSelectedScenarios,
  onRunSpecFile,
  onRunScenario,
  onOpenAddTest,
  onOpenEditScenario,
  onDeleteScenario,
  onAIFixScenario,
  onInspectScenario,
  onOpenSpecFile,
  pendingOpsCount = 0,
  isApplyingPending = false,
  onApplyPendingChanges = null,
  onDiscardPendingChanges = null,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [selectedFiles, setSelectedFiles] = useState(() => new Set());
  const [selectedScenarioKeys, setSelectedScenarioKeys] = useState(() => new Set());

  const enrichedGroups = useMemo(() => {
    return (specGroups || []).map((group) => {
      const scenarios = group.scenarios || [];
      const caseCov = getSystemGroupCaseCoverage(group, scenarios);
      const coverageRatio =
        caseCov.totalRequired > 0
          ? caseCov.coveredCount / caseCov.totalRequired
          : 0;
      const annotatedScenarios = scenarios.map((sc, idx) => {
        const ann =
          caseCov.scenarioAnnotations?.[systemScenarioAnnotationKey(sc, idx)] || {};
        return {
          ...sc,
          caseLabel: ann.caseLabel || ann.caseKey || "Flow",
          badgeType: ann.badgeType || "OPTIONAL",
          badgeLabel: ann.badgeLabel || ann.caseLabel || "Flow",
          isCoveredForCase: String(ann.badgeType || "").startsWith("PRIMARY_"),
          isDuplicateCase: ann.badgeType === "DUPLICATE",
        };
      });
      const groupStatus = getGroupStatus(group);
      return {
        ...group,
        annotatedScenarios,
        caseCov: { ...caseCov, coverageRatio },
        groupStatus,
      };
    });
  }, [specGroups]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedGroups.filter((group) => {
      if (statusFilter !== "ALL") {
        if (statusFilter === "UNCOVERED" && !["UNCOVERED", "DRAFT"].includes(group.groupStatus)) {
          return false;
        }
        if (statusFilter !== "UNCOVERED" && group.groupStatus !== statusFilter) {
          return false;
        }
      }
      if (!q) return true;
      if (
        String(group.filePath || "").toLowerCase().includes(q) ||
        String(group.featureName || "").toLowerCase().includes(q)
      ) {
        return true;
      }
      return (group.annotatedScenarios || []).some(
        (sc) =>
          String(sc.title || "").toLowerCase().includes(q) ||
          String(sc.caseLabel || "").toLowerCase().includes(q),
      );
    });
  }, [enrichedGroups, statusFilter, searchQuery]);

  const allExpanded =
    filteredGroups.length > 0 && filteredGroups.every((g) => expandedKeys.has(g.key));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedKeys(new Set());
    } else {
      setExpandedKeys(new Set(filteredGroups.map((g) => g.key)));
    }
  };

  const toggleExpand = (key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectFile = (filePath) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const allVisibleSelected =
    filteredGroups.length > 0 &&
    filteredGroups.every((g) => g.filePath && selectedFiles.has(g.filePath));

  const toggleSelectAllFiles = () => {
    if (allVisibleSelected) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(
        new Set(filteredGroups.map((g) => g.filePath).filter(Boolean)),
      );
    }
  };

  const scenarioSelectionKey = (sc, group) =>
    `${sc.testFile || group.filePath}::${sc.title || sc.id}`;

  const toggleSelectScenario = (sc, group) => {
    const key = scenarioSelectionKey(sc, group);
    setSelectedScenarioKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedFileList = useMemo(() => Array.from(selectedFiles), [selectedFiles]);

  const selectedScenarioObjects = useMemo(() => {
    const out = [];
    for (const group of enrichedGroups) {
      for (const sc of group.annotatedScenarios || []) {
        if (selectedScenarioKeys.has(scenarioSelectionKey(sc, group))) {
          out.push({ ...sc, filePath: sc.testFile || group.filePath });
        }
      }
    }
    return out;
  }, [enrichedGroups, selectedScenarioKeys]);

  const hasPendingDraft =
    latestDraft &&
    !latestDraft.applied &&
    !latestDraft.appliedAt &&
    !latestDraft.stale &&
    ["GENERATED", "REVIEWED", "PENDING", "DRAFT"].includes(
      String(latestDraft.state || latestDraft.status || "DRAFT").toUpperCase(),
    );

  const runnerBadge = String(framework || "playwright").toLowerCase() === "cypress" ? "CY" : "PW";

  return (
    <div className="space-y-3">
      {/* Filter & Global Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by spec file, feature, or scenario..."
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <div className="flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5 text-[11px]">
            {[
              { id: "ALL", label: "All" },
              { id: "PASS", label: "Pass" },
              { id: "FAIL", label: "Fail" },
              { id: "FLAKY", label: "Flaky" },
              { id: "UNCOVERED", label: "Uncovered" },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStatusFilter(pill.id)}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  statusFilter === pill.id
                    ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-semibold"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onSyncCatalog && (
            <button
              type="button"
              onClick={onSyncCatalog}
              disabled={syncingCatalog}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
              title="Scan disk for spec files and sync System Test scenario catalog"
            >
              <RefreshCw size={12} className={syncingCatalog ? "animate-spin" : ""} />
              <span>Scan Specs</span>
            </button>
          )}

          {canEditTests && onOpenAddTest && (
            <button
              type="button"
              onClick={() => onOpenAddTest(null)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium cursor-pointer transition-colors"
            >
              <Plus size={12} />
              <span>New Scenario</span>
            </button>
          )}

          {canUseAi && onOpenGenerator && (
            <button
              type="button"
              onClick={onOpenGenerator}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium cursor-pointer transition-colors"
            >
              <Sparkles size={12} className="text-[var(--color-primary)]" />
              <span>Generate All</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleExpandAll}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium cursor-pointer transition-colors"
          >
            <ChevronsUpDown size={12} />
            <span>{allExpanded ? "Collapse all" : "Expand all"}</span>
          </button>
        </div>
      </div>

      {/* Batch Selection / Pending Draft Action Bar */}
      {(selectedFileList.length > 0 || selectedScenarioObjects.length > 0 || hasPendingDraft) && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-xs">
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)] font-mono tabular-nums">
            <span>
              {selectedFileList.length > 0
                ? `${selectedFileList.length} spec(s) selected`
                : selectedScenarioObjects.length > 0
                  ? `${selectedScenarioObjects.length} scenario(s) selected`
                  : "Pending AI Draft available"}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canUseAi && selectedFileList.length > 0 && onGenerateSelected && (
              <button
                type="button"
                onClick={() => onGenerateSelected(selectedFileList)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] font-medium cursor-pointer transition-colors"
              >
                <Sparkles size={12} className="text-[var(--color-primary)]" />
                <span>Generate Selected ({selectedFileList.length})</span>
              </button>
            )}

            {pendingOpsCount > 0 && onApplyPendingChanges && (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onApplyPendingChanges}
                  disabled={isApplyingPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer transition-colors disabled:opacity-50"
                  title="Write temporary UI edits, additions, and deletions to spec files"
                >
                  {isApplyingPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  <span>{isApplyingPending ? "Applying..." : `Apply Changes (${pendingOpsCount})`}</span>
                </button>
                {onDiscardPendingChanges && !isApplyingPending && (
                  <button
                    type="button"
                    onClick={onDiscardPendingChanges}
                    className="px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[11px] font-medium text-[var(--color-text-muted)] cursor-pointer"
                  >
                    Discard
                  </button>
                )}
              </div>
            )}

            {hasPendingDraft && onApplyDraft && (
              <button
                type="button"
                onClick={() => onApplyDraft(latestDraft)}
                disabled={applyingDraft}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-semibold cursor-pointer transition-colors disabled:opacity-50"
              >
                {applyingDraft ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                <span>Apply AI Draft ({latestDraft.files?.length || 1} file)</span>
              </button>
            )}

            {canRunTests && selectedFileList.length > 0 && onRunSelectedFiles && (
              <button
                type="button"
                onClick={() => onRunSelectedFiles(selectedFileList)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-semibold cursor-pointer transition-colors"
              >
                <Play size={11} fill="currentColor" />
                <span>Run Selected Specs ({selectedFileList.length})</span>
              </button>
            )}

            {canRunTests && selectedScenarioObjects.length > 0 && onRunSelectedScenarios && (
              <button
                type="button"
                onClick={() => onRunSelectedScenarios(selectedScenarioObjects)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-semibold cursor-pointer transition-colors"
              >
                <Play size={11} fill="currentColor" />
                <span>Run Scenarios ({selectedScenarioObjects.length})</span>
              </button>
            )}

            {(selectedFileList.length > 0 || selectedScenarioObjects.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedFiles(new Set());
                  setSelectedScenarioKeys(new Set());
                }}
                className="px-2 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Matrix Table Container */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        {/* Table Column Header */}
        <div className="grid grid-cols-12 items-center gap-2 px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 text-[11px] font-medium text-[var(--color-text-muted)]">
          <div className="col-span-6 flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllFiles}
              className="rounded border-[var(--color-border)] bg-[var(--color-bg)] cursor-pointer"
              aria-label="Select all visible spec files"
            />
            <span>Spec File / Feature Flow</span>
          </div>
          <div className="col-span-2 hidden sm:block">Coverage Cases</div>
          <div className="col-span-1 hidden md:block">Status</div>
          <div className="col-span-1 hidden sm:block text-right">Scenarios</div>
          <div className="col-span-6 sm:col-span-2 text-right">Actions</div>
        </div>

        {/* Empty State */}
        {filteredGroups.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              {specGroups.length === 0
                ? "No system test specs found yet."
                : "No spec files match your current search or filter."}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] max-w-md mx-auto">
              {specGroups.length === 0
                ? "Click Generate All to let AI inspect your application routes & UI flows and synthesize Playwright / Cypress E2E specs, or click + New Scenario to write one manually."
                : "Try clearing your filter query or status toggle."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {filteredGroups.map((group) => {
              const isExpanded = expandedKeys.has(group.key);
              const isFileSelected = group.filePath && selectedFiles.has(group.filePath);
              const badge = STATUS_BADGE[group.groupStatus] || STATUS_BADGE.UNCOVERED;
              const isRunningGroup = runningTarget === group.filePath;
              const passedInGroup = (group.annotatedScenarios || []).filter(
                (sc) => normalizeStatus(sc.status) === "PASS",
              ).length;

              return (
                <div key={group.key} className="bg-[var(--color-surface)]">
                  {/* Group Header Row */}
                  <div
                    onClick={() => toggleExpand(group.key)}
                    className="grid grid-cols-12 items-center gap-2 px-3.5 py-2.5 hover:bg-[var(--color-surface-secondary)]/40 transition-colors cursor-pointer"
                  >
                    <div className="col-span-6 flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={Boolean(isFileSelected)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => group.filePath && toggleSelectFile(group.filePath)}
                        className="rounded border-[var(--color-border)] bg-[var(--color-bg)] cursor-pointer shrink-0"
                        aria-label={`Select ${group.filePath}`}
                      />
                      <span className="text-[var(--color-text-muted)] shrink-0">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/25 shrink-0">
                        {runnerBadge}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-[var(--color-text)] truncate">
                          {group.filePath}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-muted)] truncate">
                          {group.featureName || "E2E Spec Flow"}
                          {group.routes?.length ? ` · ${group.routes.slice(0, 2).join(", ")}` : ""}
                        </div>
                      </div>
                    </div>

                    {/* Case coverage ratio */}
                    <div className="col-span-2 hidden sm:flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                      <span
                        className={
                          group.caseCov.coverageRatio >= 1
                            ? "text-emerald-400"
                            : group.caseCov.coveredCount > 0
                              ? "text-amber-400"
                              : "text-[var(--color-text-muted)]"
                        }
                      >
                        {group.caseCov.coveredCount}/{group.caseCov.totalRequired} cases
                      </span>
                    </div>

                    {/* Status */}
                    <div className="col-span-1 hidden md:flex items-center gap-1.5 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                      <span className={`text-[11px] font-medium ${badge.text}`}>{badge.label}</span>
                    </div>

                    {/* Scenarios Count */}
                    <div className="col-span-1 hidden sm:block text-right font-mono tabular-nums text-[11px] text-[var(--color-text-secondary)]">
                      {group.annotatedScenarios.length}
                      {passedInGroup > 0 ? ` (${passedInGroup}✓)` : ""}
                    </div>

                    {/* Group Row Actions (NO Generate button here, matches Integration request #3) */}
                    <div
                      className="col-span-6 sm:col-span-2 flex items-center justify-end gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canEditTests && onOpenAddTest && (
                        <button
                          type="button"
                          onClick={() => onOpenAddTest(group)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                          title="Add new E2E scenario to this spec file"
                        >
                          <Plus size={11} />
                          <span>Add</span>
                        </button>
                      )}

                      {onOpenSpecFile && (
                        <button
                          type="button"
                          onClick={() => onOpenSpecFile(group.filePath)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                          title="Open spec file in IDE editor"
                        >
                          <Code2 size={11} />
                        </button>
                      )}

                      {canRunTests && onRunSpecFile && (
                        <button
                          type="button"
                          onClick={() => onRunSpecFile(group)}
                          disabled={isRunningGroup}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[11px] font-medium text-[var(--color-text)] cursor-pointer transition-colors disabled:opacity-50"
                          title="Run this spec file"
                        >
                          {isRunningGroup ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Play size={10} fill="currentColor" />
                          )}
                          <span>Run</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Spec Body */}
                  {isExpanded && (
                    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)]/60 px-4 py-3 space-y-2.5">
                      {/* Required Cases Strip */}
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[11px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[var(--color-text-muted)]">
                            Cases ({group.caseCov.coveredCount}/{group.caseCov.totalRequired}):
                          </span>
                          {group.caseCov.cases.map((reqCase) => (
                            <span
                              key={reqCase.key}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${
                                reqCase.covered
                                  ? reqCase.failed
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                              }`}
                            >
                              {reqCase.covered ? <Check size={10} /> : <span>○</span>}
                              <span>{reqCase.label}</span>
                            </span>
                          ))}
                        </div>
                        <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                          {group.annotatedScenarios.length} scenario(s)
                        </span>
                      </div>

                      {/* Scenario List */}
                      {group.annotatedScenarios.length === 0 ? (
                        <div className="px-4 py-4 rounded-md border border-dashed border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)]">
                          No scenarios parsed yet for this spec. Click{" "}
                          <button
                            type="button"
                            onClick={() => onOpenAddTest?.(group)}
                            className="text-[var(--color-primary)] underline cursor-pointer"
                          >
                            + Add
                          </button>{" "}
                          or select the checkbox and click Generate Selected.
                        </div>
                      ) : (
                        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)] overflow-hidden">
                          {group.annotatedScenarios.map((sc, idx) => {
                            const st = normalizeStatus(sc.status);
                            const selKey = scenarioSelectionKey(sc, group);
                            const isChecked = selectedScenarioKeys.has(selKey);
                            const isFixingThis =
                              fixingTarget === selKey || fixingTarget === sc.id;
                            const isDeletingThis =
                              deletingTarget === selKey || deletingTarget === sc.id;
                            const cleanFailSummary =
                              sc.failureSummary ||
                              summarizeSystemFailure(sc.failureMessages || "");
                            const rawTechnicalLog = Array.isArray(sc.failureMessages)
                              ? sc.failureMessages.join("\n\n")
                              : String(sc.failureMessages || "");
                            const hasEvidence =
                              sc.evidence?.hasScreenshot ||
                              sc.evidence?.hasDomSnapshot ||
                              Boolean(sc.failureBreakpoint);

                            return (
                              <div
                                key={`${selKey}-${idx}`}
                                className={`px-3.5 py-2.5 transition-colors ${
                                  st === "FAIL"
                                    ? "bg-rose-500/[0.03]"
                                    : st === "FLAKY"
                                      ? "bg-amber-500/[0.03]"
                                      : ""
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => toggleSelectScenario(sc, group)}
                                      className="mt-0.5 rounded border-[var(--color-border)] bg-[var(--color-bg)] cursor-pointer shrink-0"
                                      aria-label={`Select scenario ${sc.title}`}
                                    />

                                    <span className="mt-0.5 shrink-0">
                                      {st === "PASS" ? (
                                        <CheckCircle2 size={14} className="text-emerald-400" />
                                      ) : st === "FAIL" ? (
                                        <XCircle size={14} className="text-rose-400" />
                                      ) : st === "FLAKY" ? (
                                        <AlertTriangle size={14} className="text-amber-400" />
                                      ) : (
                                        <Clock size={14} className="text-[var(--color-text-muted)]" />
                                      )}
                                    </span>

                                    <div className="min-w-0 flex-1 space-y-1">
                                      <div className="text-xs font-medium text-[var(--color-text)] break-words">
                                        {sc.title || sc.testName}
                                      </div>

                                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                                        {sc.isCoveredForCase && (
                                          <span
                                            title={`Assigned to cover required case "${sc.caseLabel}".`}
                                            className={`px-1.5 py-0.5 rounded border font-medium ${
                                              sc.badgeType === "PRIMARY_FAIL"
                                                ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                            }`}
                                          >
                                            {sc.badgeType === "PRIMARY_FAIL"
                                              ? `! Case: ${sc.caseLabel}`
                                              : `✓ Case: ${sc.caseLabel}`}
                                          </span>
                                        )}
                                        {sc.isDuplicateCase && (
                                          <span
                                            className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25"
                                            title={`Another scenario already covers "${sc.caseLabel}" — safe to review or delete if redundant.`}
                                          >
                                            Duplicate · {sc.caseLabel}
                                          </span>
                                        )}
                                        {!sc.isCoveredForCase && !sc.isDuplicateCase && (
                                          <span
                                            title="Supplementary scenario outside this spec's required cases."
                                            className="px-1.5 py-0.5 rounded border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)]"
                                          >
                                            {sc.badgeLabel || `Optional · ${sc.caseLabel}`}
                                          </span>
                                        )}

                                        <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                                          {sc.origin === "AI_DRAFT"
                                            ? "AI_DRAFT"
                                            : sc.origin === "AI_GENERATED"
                                              ? "AI_GENERATED"
                                              : sc.origin || "PROJECT_EXISTING"}
                                        </span>

                                        {sc.durationMs != null && Number(sc.durationMs) > 0 && (
                                          <span className="text-[var(--color-text-muted)] tabular-nums">
                                            {sc.durationMs}ms
                                          </span>
                                        )}

                                        {sc.executionDetails?.apiCalls?.length > 0 && (
                                          <span className="text-[var(--color-text-muted)] tabular-nums">
                                            {sc.executionDetails.apiCalls.length} API calls
                                          </span>
                                        )}
                                      </div>

                                      {/* Clean Concise Failure Summary + Collapsible Technical Details */}
                                      {(st === "FAIL" || st === "FLAKY") && cleanFailSummary && (
                                        <div className="mt-1.5 rounded border border-rose-500/25 bg-rose-500/5 px-2.5 py-1.5 text-xs space-y-1">
                                          <p className="text-rose-300 font-medium leading-snug">
                                            {cleanFailSummary}
                                          </p>
                                          {rawTechnicalLog && (
                                            <details className="text-[11px] text-[var(--color-text-muted)]">
                                              <summary className="cursor-pointer hover:text-[var(--color-text-secondary)] select-none">
                                                Technical details
                                              </summary>
                                              <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-[var(--color-bg)] p-2 font-mono text-[10px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words border border-[var(--color-border)]">
                                                {rawTechnicalLog}
                                              </pre>
                                            </details>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Scenario Row Actions */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {(st === "FAIL" || st === "FLAKY") &&
                                      canUseAi &&
                                      onAIFixScenario && (
                                        <button
                                          type="button"
                                          onClick={() => onAIFixScenario(sc, group)}
                                          disabled={isFixingThis}
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-semibold cursor-pointer transition-colors disabled:opacity-50"
                                          title="Ask AI to diagnose and repair this failing E2E scenario"
                                        >
                                          {isFixingThis ? (
                                            <Loader2 size={11} className="animate-spin" />
                                          ) : (
                                            <Wand2 size={11} />
                                          )}
                                          <span>AI Fix</span>
                                        </button>
                                      )}

                                    {hasEvidence && onInspectScenario && (
                                      <button
                                        type="button"
                                        onClick={() => onInspectScenario(sc)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                                        title="View screenshot, DOM snapshot, or failure breakpoint"
                                      >
                                        <Camera size={11} />
                                        <span>Evidence</span>
                                      </button>
                                    )}

                                    {canEditTests && onOpenEditScenario && (
                                      <button
                                        type="button"
                                        onClick={() => onOpenEditScenario(sc, group)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                                      >
                                        <Edit3 size={11} />
                                        <span>Edit</span>
                                      </button>
                                    )}

                                    {onOpenSpecFile && (
                                      <button
                                        type="button"
                                        onClick={() => onOpenSpecFile(sc.testFile || group.filePath, sc)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                                        title="Open spec file in IDE"
                                      >
                                        <Code2 size={11} />
                                      </button>
                                    )}

                                    {canRunTests && onRunScenario && (
                                      <button
                                        type="button"
                                        onClick={() => onRunScenario(sc, group)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[11px] text-[var(--color-text)] cursor-pointer transition-colors"
                                        title="Run this scenario"
                                      >
                                        <Play size={10} fill="currentColor" />
                                      </button>
                                    )}

                                    {canEditTests && onDeleteScenario && (
                                      <button
                                        type="button"
                                        onClick={() => onDeleteScenario(sc, group)}
                                        disabled={isDeletingThis}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-rose-500/15 hover:border-rose-500/30 text-[11px] text-[var(--color-text-muted)] hover:text-rose-400 cursor-pointer transition-colors disabled:opacity-50"
                                        title="Delete scenario block from spec file"
                                      >
                                        {isDeletingThis ? (
                                          <Loader2 size={11} className="animate-spin" />
                                        ) : (
                                          <Trash2 size={11} />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
