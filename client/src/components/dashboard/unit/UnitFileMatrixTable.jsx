import React, { useMemo, useState } from "react";
import {
  Search,
  ChevronRight,
  ChevronDown,
  FileCode,
  GitBranch,
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
} from "lucide-react";
import {
  getFileUnitCaseCoverage,
  isUnitTestFailed,
  isUnitTestPassed,
  summarizeUnitFailure,
} from "./unitTestCaseCoverage.js";

const METHOD_LIKE_FILE_BADGES = {
  service: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  controller: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  middleware: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  util: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  validator: "bg-indigo-500/10 text-indigo-400 border-indigo-500/25",
  component: "bg-cyan-500/10 text-cyan-400 border-cyan-500/25",
  default: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

function inferRoleBadge(filePath = "") {
  const lower = filePath.toLowerCase();
  if (lower.includes("controller")) return { label: "CTRL", style: METHOD_LIKE_FILE_BADGES.controller };
  if (lower.includes("service")) return { label: "SVC", style: METHOD_LIKE_FILE_BADGES.service };
  if (lower.includes("middleware")) return { label: "MW", style: METHOD_LIKE_FILE_BADGES.middleware };
  if (lower.includes("validator") || lower.includes("validation")) return { label: "VAL", style: METHOD_LIKE_FILE_BADGES.validator };
  if (lower.includes("util") || lower.includes("helper") || lower.includes("lib")) return { label: "UTIL", style: METHOD_LIKE_FILE_BADGES.util };
  if (lower.endsWith(".jsx") || lower.endsWith(".tsx")) return { label: "UI", style: METHOD_LIKE_FILE_BADGES.component };
  return { label: "SRC", style: METHOD_LIKE_FILE_BADGES.default };
}

function getFileRowStatus(entry, caseCov) {
  const hasTests = (entry.testCases || []).length > 0;
  const hasFailures = (entry.testCases || []).some(isUnitTestFailed);
  const linesPct = Number(entry.linesPct ?? 0);
  const branchesPct = Number(entry.branchesPct ?? 0);

  if (hasFailures) return "FAIL";
  if (linesPct >= 100 && (branchesPct >= 100 || Number(entry.branchesTotal || 0) === 0)) {
    return "PASS";
  }
  if (linesPct > 0 || (hasTests && caseCov.passedCasesCount > 0)) {
    return "PARTIAL";
  }
  return "UNCOVERED";
}

function pctColorClass(pct) {
  if (pct == null) return "text-[var(--color-text-muted)]";
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-rose-400";
}

export default function UnitFileMatrixTable({
  fileEntries = [],
  hasExecuted = false,
  onSuggestSelected,
  onSuggestAllUncovered,
  onApplySelected,
  onApplySingleDraft,
  onRunSelectedFiles,
  onRunSelectedTests,
  onRunFile,
  onRunTestCase,
  onOpenAddTest,
  onOpenEditTest,
  onDeleteTestCase,
  onAIFixTestCase,
  onOpenFileAnalysis,
  onOpenSourceFile,
  onOpenDiffReview,
  isGenerating = false,
  isApplying = false,
  isRunning = false,
  fixingTestId = null,
  runningTargetKey = null,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [selectedFiles, setSelectedFiles] = useState(() => new Set());
  const [selectedTestIds, setSelectedTestIds] = useState(() => new Set());

  const enrichedEntries = useMemo(() => {
    return (fileEntries || []).map((entry) => {
      const caseCov = getFileUnitCaseCoverage(entry, entry.functions || [], entry.testCases || []);
      const status = getFileRowStatus(entry, caseCov);
      return { ...entry, caseCov, status };
    });
  }, [fileEntries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedEntries.filter((entry) => {
      if (statusFilter !== "ALL" && entry.status !== statusFilter) return false;
      if (!q) return true;
      if (entry.filePath.toLowerCase().includes(q)) return true;
      if ((entry.functions || []).some((fn) => String(fn.functionName || "").toLowerCase().includes(q))) return true;
      if ((entry.testCases || []).some((tc) => String(tc.title || tc.testName || "").toLowerCase().includes(q))) return true;
      return false;
    });
  }, [enrichedEntries, searchQuery, statusFilter]);

  const toggleExpand = (filePath) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedPaths(new Set(filteredEntries.map((e) => e.filePath)));
  };

  const collapseAll = () => {
    setExpandedPaths(new Set());
  };

  const toggleSelectFile = (filePath) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const toggleSelectAllFiles = () => {
    if (filteredEntries.length === 0) return;
    const allSelected = filteredEntries.every((e) => selectedFiles.has(e.filePath));
    if (allSelected) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredEntries.map((e) => e.filePath)));
    }
  };

  const toggleSelectTest = (testId) => {
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const selectedFileList = useMemo(
    () => Array.from(selectedFiles),
    [selectedFiles],
  );

  const selectedDraftSuggestions = useMemo(() => {
    const drafts = [];
    for (const entry of enrichedEntries) {
      if (selectedFiles.size > 0 && !selectedFiles.has(entry.filePath)) continue;
      for (const tc of entry.testCases || []) {
        if (tc.origin === "AI_DRAFT" && tc.suggestionObj && !tc.isApplied) {
          drafts.push(tc.suggestionObj);
        }
      }
    }
    return drafts;
  }, [enrichedEntries, selectedFiles]);

  const totalPendingDrafts = useMemo(() => {
    let count = 0;
    for (const entry of enrichedEntries) {
      for (const tc of entry.testCases || []) {
        if (tc.origin === "AI_DRAFT" && tc.suggestionObj && !tc.isApplied) {
          count++;
        }
      }
    }
    return count;
  }, [enrichedEntries]);

  const selectedTestCasesList = useMemo(() => {
    const list = [];
    for (const entry of enrichedEntries) {
      for (const tc of entry.testCases || []) {
        if (selectedTestIds.has(tc.id)) {
          list.push({ ...tc, sourceFile: entry.filePath });
        }
      }
    }
    return list;
  }, [enrichedEntries, selectedTestIds]);

  const allVisibleSelected =
    filteredEntries.length > 0 &&
    filteredEntries.every((e) => selectedFiles.has(e.filePath));

  return (
    <div className="space-y-3">
      {/* ── Filter & Batch Toolbar ── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Search + Status Pills */}
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by source file, function, or test case..."
                className="w-full pl-8 pr-3 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>

            <div className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5 text-[11px]">
              {[
                { id: "ALL", label: "All" },
                { id: "PASS", label: "Pass" },
                { id: "PARTIAL", label: "Partial" },
                { id: "FAIL", label: "Fail" },
                { id: "UNCOVERED", label: "Uncovered" },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setStatusFilter(pill.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    statusFilter === pill.id
                      ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Global / Batch Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {onSuggestAllUncovered && (
              <button
                type="button"
                onClick={onSuggestAllUncovered}
                disabled={isGenerating || isApplying || isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-50"
                title="Generate AI unit test drafts for uncovered source files"
              >
                {isGenerating ? (
                  <Loader2 size={12} className="animate-spin text-[var(--color-primary)]" />
                ) : (
                  <Sparkles size={12} className="text-[var(--color-primary)]" />
                )}
                <span>{isGenerating ? "Generating..." : "Generate All"}</span>
              </button>
            )}

            {totalPendingDrafts > 0 && onApplySelected && selectedFileList.length === 0 && (
              <button
                type="button"
                onClick={() => onApplySelected(selectedDraftSuggestions)}
                disabled={isApplying || isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                title="Verify & apply all pending AI draft unit tests to disk"
              >
                {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                <span>Apply All Drafts ({totalPendingDrafts})</span>
              </button>
            )}

            <button
              type="button"
              onClick={expandedPaths.size > 0 ? collapseAll : expandAll}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors cursor-pointer"
            >
              <ChevronsUpDown size={12} />
              <span>{expandedPaths.size > 0 ? "Collapse all" : "Expand all"}</span>
            </button>
          </div>
        </div>

        {/* Contextual Batch Action Bar when Checkboxes Selected */}
        {(selectedFileList.length > 0 || selectedTestCasesList.length > 0) && (
          <div className="pt-2 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)] font-mono tabular-nums">
              {selectedFileList.length > 0 && (
                <span>{selectedFileList.length} file(s) selected</span>
              )}
              {selectedTestCasesList.length > 0 && (
                <span>{selectedTestCasesList.length} test(s) selected</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedFileList.length > 0 && onSuggestSelected && (
                <button
                  type="button"
                  onClick={() => onSuggestSelected(selectedFileList)}
                  disabled={isGenerating || isApplying || isRunning}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  <span>Generate Selected ({selectedFileList.length})</span>
                </button>
              )}

              {selectedFileList.length > 0 && selectedDraftSuggestions.length > 0 && onApplySelected && (
                <button
                  type="button"
                  onClick={() => onApplySelected(selectedDraftSuggestions)}
                  disabled={isApplying || isRunning}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Check size={12} />
                  <span>Apply Selected Drafts ({selectedDraftSuggestions.length})</span>
                </button>
              )}

              {selectedFileList.length > 0 && onRunSelectedFiles && (
                <button
                  type="button"
                  onClick={() => onRunSelectedFiles(selectedFileList)}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Play size={11} fill="currentColor" />
                  <span>Run Selected Files ({selectedFileList.length})</span>
                </button>
              )}

              {selectedTestCasesList.length > 0 && onRunSelectedTests && (
                <button
                  type="button"
                  onClick={() => onRunSelectedTests(selectedTestCasesList)}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Play size={11} fill="currentColor" />
                  <span>Run Selected Tests ({selectedTestCasesList.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setSelectedFiles(new Set());
                  setSelectedTestIds(new Set());
                }}
                className="px-2 py-1 rounded text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Unit Files & Scenarios Matrix Table ── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        {filteredEntries.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-2">
            <p className="text-sm font-medium text-[var(--color-text)] m-0">
              {fileEntries.length === 0
                ? "No unit coverage files analyzed yet"
                : "No source files match your current filter"}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] m-0">
              {fileEntries.length === 0
                ? "Click Run Coverage in the header to scan source files, execute Jest/Vitest, and populate metrics."
                : "Try clearing the search query or switching to All status."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]/60 text-[11px] font-medium text-[var(--color-text-muted)]">
                  <th className="py-2.5 pl-4 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllFiles}
                      className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer"
                      aria-label="Select all source files"
                    />
                  </th>
                  <th className="py-2.5 px-3">Source File</th>
                  <th className="py-2.5 px-3 text-right">Stmts · Branch · Funcs · Lines</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Tests</th>
                  <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]/70">
                {filteredEntries.map((entry) => {
                  const isExpanded = expandedPaths.has(entry.filePath);
                  const isSelected = selectedFiles.has(entry.filePath);
                  const role = inferRoleBadge(entry.filePath);
                  const testCount = (entry.testCases || []).length;
                  const fnCount = (entry.functions || []).length || Number(entry.funcsTotal || 0);
                  const uncoveredFns = (entry.functions || []).filter((f) => Number(f.hit || 0) === 0);

                  return (
                    <React.Fragment key={entry.filePath}>
                      <tr
                        onClick={() => toggleExpand(entry.filePath)}
                        className={`group transition-colors cursor-pointer ${
                          isExpanded
                            ? "bg-[var(--color-surface-secondary)]/55"
                            : "hover:bg-[var(--color-surface-secondary)]/35"
                        }`}
                      >
                        <td
                          className="py-3 pl-4 pr-2 align-top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectFile(entry.filePath)}
                              className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer"
                              aria-label={`Select ${entry.filePath}`}
                            />
                            <button
                              type="button"
                              onClick={() => toggleExpand(entry.filePath)}
                              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </div>
                        </td>

                        {/* Source File */}
                        <td className="py-3 px-3 align-top">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center justify-center w-11 py-0.5 rounded text-[10px] font-mono font-semibold border shrink-0 ${role.style}`}
                            >
                              {role.label}
                            </span>
                            <span className="font-mono text-[12.5px] font-medium text-[var(--color-text)] break-all">
                              {entry.filePath}
                            </span>
                          </div>
                          <div className="mt-1 pl-[52px] flex flex-wrap items-center gap-3 text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
                            <span>{fnCount} {fnCount === 1 ? "fn" : "fns"}</span>
                            {uncoveredFns.length > 0 && (
                              <span className="text-amber-400/90">
                                {uncoveredFns.length} uncovered fn
                              </span>
                            )}
                            {entry.associatedTestFile && (
                              <span className="truncate max-w-[260px]" title={entry.associatedTestFile}>
                                → {entry.associatedTestFile}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Unit Metrics (Stmts / Branches / Funcs / Lines) */}
                        <td className="py-3 px-3 align-top text-right">
                          <div className="inline-flex items-center gap-2.5 font-mono tabular-nums text-[11px]">
                            <span title="Statements coverage" className={pctColorClass(entry.stmtsPct)}>
                              S {Number(entry.stmtsPct ?? 0).toFixed(0)}%
                            </span>
                            <span title="Branch coverage" className={pctColorClass(entry.branchesPct)}>
                              B {Number(entry.branchesPct ?? 0).toFixed(0)}%
                            </span>
                            <span title="Function coverage" className={pctColorClass(entry.funcsPct)}>
                              F {Number(entry.funcsPct ?? 0).toFixed(0)}%
                            </span>
                            <span
                              title="Line coverage"
                              className={`font-semibold px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] ${pctColorClass(entry.linesPct)}`}
                            >
                              L {Number(entry.linesPct ?? 0).toFixed(1)}%
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3 align-top">
                          <div className="pt-0.5">
                            {entry.status === "PASS" ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/75" />
                                Covered
                              </span>
                            ) : entry.status === "PARTIAL" ? (
                              <span
                                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-muted)] font-mono tabular-nums"
                                title={`Cases verified: ${entry.caseCov.passedCasesCount}/${entry.caseCov.totalRequired}`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500/75" />
                                Partial ({entry.caseCov.passedCasesCount}/{entry.caseCov.totalRequired})
                              </span>
                            ) : entry.status === "FAIL" ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400/80" />
                                Failed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border-strong)]" />
                                {hasExecuted ? "Uncovered" : "Not run"}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Tests Count */}
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[11px] align-top">
                          <span className="text-[var(--color-text-secondary)]">
                            {testCount} {testCount === 1 ? "test" : "tests"}
                          </span>
                        </td>

                        {/* Quiet Row Actions (No Generate button per row - matches Integration UX) */}
                        <td
                          className="py-3 pl-3 pr-4 text-right align-top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-1 opacity-85 group-hover:opacity-100 transition-opacity">
                            {onOpenFileAnalysis && (
                              <button
                                type="button"
                                onClick={() => onOpenFileAnalysis(entry)}
                                title="Inspect Branch CFG, Call Graph, Complexity & Simulation"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                              >
                                <GitBranch size={12} />
                                <span>CFG</span>
                              </button>
                            )}
                            {onOpenAddTest && (
                              <button
                                type="button"
                                onClick={() => onOpenAddTest(entry)}
                                disabled={isRunning}
                                title="Add unit test case for this source file"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                              >
                                <Plus size={12} />
                                <span>Add</span>
                              </button>
                            )}
                            {onRunFile && (
                              <button
                                type="button"
                                onClick={() => onRunFile(entry)}
                                disabled={isRunning}
                                title="Run unit tests targeting this file"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {runningTargetKey === entry.filePath ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : (
                                  <Play size={11} fill="currentColor" />
                                )}
                                <span>Run</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ── Expanded Unit File Details & Test Cases ── */}
                      {isExpanded && (
                        <tr className="bg-[var(--color-bg)]">
                          <td colSpan={6} className="p-0">
                            <div className="px-6 py-4 border-l-2 border-[var(--color-primary)] space-y-3.5">
                              {/* Metadata & Quick Source Controls */}
                              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[var(--color-text-muted)] pb-2.5 border-b border-[var(--color-border)]/70">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                  <span>
                                    Statements:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {entry.stmtsCovered ?? 0}/{entry.stmtsTotal ?? 0} ({Number(entry.stmtsPct ?? 0).toFixed(1)}%)
                                    </span>
                                  </span>
                                  <span>
                                    Branches:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {entry.branchesCovered ?? 0}/{entry.branchesTotal ?? 0} ({Number(entry.branchesPct ?? 0).toFixed(1)}%)
                                    </span>
                                  </span>
                                  <span>
                                    Functions:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {entry.funcsCovered ?? 0}/{entry.funcsTotal ?? fnCount} ({Number(entry.funcsPct ?? 0).toFixed(1)}%)
                                    </span>
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  {onOpenSourceFile && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenSourceFile(entry.filePath, 1)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] cursor-pointer"
                                    >
                                      <FileCode size={11} />
                                      <span>Source Code</span>
                                    </button>
                                  )}
                                  {onOpenFileAnalysis && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenFileAnalysis(entry)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] cursor-pointer"
                                    >
                                      <GitBranch size={11} />
                                      <span>CFG & Simulation</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Required Unit Cases Strip (Business Logic 4 Categories + Redundancy Check) */}
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                  <span className="font-mono text-[var(--color-text-muted)] mr-1">
                                    Cases ({entry.caseCov.coveredCount}/{entry.caseCov.totalRequired}):
                                  </span>
                                  {entry.caseCov.cases.map((c) => (
                                    <span
                                      key={c.key}
                                      title={c.description}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono text-[10px] ${
                                        c.passed
                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                          : c.failed
                                            ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                                            : c.covered
                                              ? "bg-sky-500/10 text-sky-400 border-sky-500/25"
                                              : "bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                                      }`}
                                    >
                                      {c.passed ? "✓" : c.failed ? "✕" : c.covered ? "•" : "○"} {c.label}
                                    </span>
                                  ))}
                                </div>

                                <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--color-text-muted)]">
                                  {entry.caseCov.redundantCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25">
                                      {entry.caseCov.redundantCount} duplicate
                                    </span>
                                  )}
                                  {entry.caseCov.extraCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                                      {entry.caseCov.extraCount} optional
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Uncovered Functions Breakdown */}
                              {uncoveredFns.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                  <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                                    Uncovered functions:
                                  </span>
                                  {uncoveredFns.slice(0, 8).map((fn, idx) => (
                                    <button
                                      key={`${fn.functionName}-${idx}`}
                                      type="button"
                                      onClick={() => onOpenSourceFile && onOpenSourceFile(entry.filePath, fn.startLine || 1)}
                                      className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] font-mono text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                                    >
                                      {fn.functionName}() :{fn.startLine || 1}
                                    </button>
                                  ))}
                                  {uncoveredFns.length > 8 && (
                                    <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                      +{uncoveredFns.length - 8} more
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Test Cases List */}
                              {(entry.testCases || []).length === 0 ? (
                                <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/50 px-4 py-4 flex items-center justify-between gap-3 text-xs text-[var(--color-text-muted)]">
                                  <span>
                                    No unit test cases mapped to this file yet. Select the checkbox to Generate AI Tests or click + Add.
                                  </span>
                                  {onOpenAddTest && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenAddTest(entry)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-xs text-[var(--color-text)] cursor-pointer shrink-0"
                                    >
                                      <Plus size={12} />
                                      <span>Add Test Case</span>
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]/70">
                                  {entry.testCases.map((tc, tcIdx) => {
                                    const ann = entry.caseCov.scenarioAnnotations[tc.id] || null;
                                    const passed = isUnitTestPassed(tc);
                                    const failed = isUnitTestFailed(tc);
                                    const isDraft = tc.origin === "AI_DRAFT" && !tc.isApplied;
                                    const failureSummary = failed
                                      ? tc.failureSummary || summarizeUnitFailure(tc.failureMessages)
                                      : "";
                                    const rawErr = Array.isArray(tc.failureMessages)
                                      ? tc.failureMessages.join("\n").trim()
                                      : "";

                                    return (
                                      <div key={tc.id || tcIdx} className="px-3.5 py-2.5 space-y-1.5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                            <input
                                              type="checkbox"
                                              checked={selectedTestIds.has(tc.id)}
                                              onChange={() => toggleSelectTest(tc.id)}
                                              className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer shrink-0"
                                            />
                                            {passed ? (
                                              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                                            ) : failed ? (
                                              <XCircle size={14} className="text-rose-400 shrink-0" />
                                            ) : isDraft ? (
                                              <Sparkles size={14} className="text-sky-400 shrink-0" />
                                            ) : (
                                              <Clock size={14} className="text-[var(--color-text-muted)] shrink-0" />
                                            )}

                                            <div className="min-w-0 flex-1">
                                              <div className="text-xs font-medium text-[var(--color-text)] truncate">
                                                {tc.title || tc.testName}
                                              </div>
                                              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] font-mono">
                                                {ann && (
                                                  <span
                                                    title={
                                                      ann.badgeType === "DUPLICATE"
                                                        ? `Another test already covers "${ann.caseLabel}" — safe to delete if redundant.`
                                                        : ann.badgeType === "OPTIONAL"
                                                          ? `Supplementary scenario outside this file's required cases.`
                                                          : `Assigned to cover required case "${ann.caseLabel}".`
                                                    }
                                                    className={`px-1.5 py-0.5 rounded border ${
                                                      ann.badgeType === "DUPLICATE"
                                                        ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                                                        : ann.badgeType === "PRIMARY_PASS"
                                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                                          : ann.badgeType === "PRIMARY_FAIL"
                                                            ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                                                            : ann.badgeType === "OPTIONAL"
                                                              ? "border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)]"
                                                              : "bg-sky-500/10 text-sky-400 border-sky-500/25"
                                                    }`}
                                                  >
                                                    {ann.badgeLabel}
                                                  </span>
                                                )}
                                                <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                                                  {isDraft ? "AI_DRAFT" : tc.origin || "PROJECT_EXISTING"}
                                                </span>
                                                {tc.testFile && (
                                                  <span className="text-[var(--color-text-muted)] truncate max-w-[220px]">
                                                    {tc.testFile}
                                                  </span>
                                                )}
                                                {Number(tc.duration) > 0 && (
                                                  <span className="text-[var(--color-text-muted)] tabular-nums">
                                                    {tc.duration}ms
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          </div>

                                          {/* Scenario Action Buttons */}
                                          <div className="flex items-center gap-1 shrink-0">
                                            {isDraft && tc.suggestionObj && onApplySingleDraft && (
                                              <button
                                                type="button"
                                                onClick={() => onApplySingleDraft(tc.suggestionObj)}
                                                disabled={isApplying || isRunning}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                                                title="Apply this AI draft suite onto disk and verify"
                                              >
                                                <Check size={11} />
                                                <span>Apply</span>
                                              </button>
                                            )}

                                            {failed && onAIFixTestCase && !isDraft && (
                                              <button
                                                type="button"
                                                onClick={() => onAIFixTestCase(tc, entry)}
                                                disabled={fixingTestId === tc.id || isRunning}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                                                title="Let AI diagnose & repair this failing unit test case"
                                              >
                                                {fixingTestId === tc.id ? (
                                                  <Loader2 size={11} className="animate-spin" />
                                                ) : (
                                                  <Wand2 size={11} />
                                                )}
                                                <span>AI Fix</span>
                                              </button>
                                            )}

                                            {!isDraft && onRunTestCase && (
                                              <button
                                                type="button"
                                                onClick={() => onRunTestCase(tc, entry)}
                                                disabled={isRunning}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50"
                                                title="Run only this unit test case"
                                              >
                                                <Play size={11} fill="currentColor" />
                                                <span>Run</span>
                                              </button>
                                            )}

                                            {onOpenEditTest && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  isDraft && tc.suggestionObj && onOpenDiffReview
                                                    ? onOpenDiffReview(entry.filePath)
                                                    : onOpenEditTest(tc, entry)
                                                }
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                                                title="Edit test code"
                                              >
                                                <Edit3 size={11} />
                                                <span>Edit</span>
                                              </button>
                                            )}

                                            {tc.testFile && onOpenSourceFile && (
                                              <button
                                                type="button"
                                                onClick={() => onOpenSourceFile(tc.testFile, 1)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                                                title="Open test file in IDE editor"
                                              >
                                                <Code2 size={11} />
                                                <span>Code</span>
                                              </button>
                                            )}

                                            {onDeleteTestCase && (
                                              <button
                                                type="button"
                                                onClick={() => onDeleteTestCase(tc, entry)}
                                                disabled={isRunning}
                                                className="p-1 rounded text-[var(--color-text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-50"
                                                title="Delete this unit test case"
                                              >
                                                <Trash2 size={12} />
                                              </button>
                                            )}
                                          </div>
                                        </div>

                                        {/* Concise Summarized Failure Notice */}
                                        {failed && (
                                          <div className="ml-6 rounded border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-[11px] space-y-1">
                                            <div className="flex items-start gap-2 text-rose-300">
                                              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-rose-400" />
                                              <span className="font-medium leading-snug">{failureSummary}</span>
                                            </div>
                                            {rawErr && (
                                              <details className="text-[10px] text-[var(--color-text-muted)]">
                                                <summary className="cursor-pointer hover:text-[var(--color-text-secondary)] select-none">
                                                  Technical details
                                                </summary>
                                                <pre className="mt-1.5 p-2 rounded bg-[#0B0F14] border border-[var(--color-border)] overflow-x-auto font-mono text-[10px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words max-h-40">
                                                  {rawErr}
                                                </pre>
                                              </details>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
