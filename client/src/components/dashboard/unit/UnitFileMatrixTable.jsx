import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import {
  loadMatrixSelection,
  saveMatrixSelection,
  toggleParentSelection,
  toggleAllParentsSelection,
  toggleChildSelection,
} from "../../../lib/matrixSelectionStorage.js";
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
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronsUpDown,
  Check,
  AlertTriangle,
  Copy,
  ExternalLink,
  X,
} from "lucide-react";
import { getFileCoverage, getUnitTestCaseDetail } from "../../../services/coverage.service.js";
import ConfirmDialog from "../../common/ConfirmDialog.jsx";
import {
  diagnoseUnitFailure,
  getFileUnitCaseCoverage,
  isUnitTestFailed,
  isUnitTestPassed,
  summarizeUnitFailure,
} from "./unitTestCaseCoverage.js";
import { TEST_UI, calmPctTextClass } from "../shared/testingUiTokens.js";

const NEUTRAL_ROLE_BADGE =
  "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]";

const METHOD_LIKE_FILE_BADGES = {
  service: NEUTRAL_ROLE_BADGE,
  controller: NEUTRAL_ROLE_BADGE,
  middleware: NEUTRAL_ROLE_BADGE,
  util: NEUTRAL_ROLE_BADGE,
  validator: NEUTRAL_ROLE_BADGE,
  component: NEUTRAL_ROLE_BADGE,
  default: NEUTRAL_ROLE_BADGE,
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

function getFileRowStatus(entry, caseCov = null) {
  const hasFailures = (entry.testCases || []).some(isUnitTestFailed);
  const linesPct = Number(entry.linesPct ?? 0);
  const stmtsPct = Number(entry.stmtsPct ?? 0);
  const funcsPct = Number(entry.funcsPct ?? 0);
  const branchesPct = Number(entry.branchesPct ?? 0);
  const branchesTotal = Number(entry.branchesTotal || 0);
  const funcsTotal = Number(entry.funcsTotal ?? (entry.functions || []).length ?? 0);
  const funcsCovered = Number(
    entry.funcsCovered ??
      (entry.functions || []).filter((f) => Number(f.hit || 0) > 0).length ??
      0,
  );
  const allFuncsCovered = funcsTotal === 0 || funcsCovered >= funcsTotal || funcsPct >= 100;

  if (hasFailures) return "FAIL";
  if (
    linesPct >= 100 &&
    allFuncsCovered &&
    (branchesTotal === 0 || branchesPct >= 100)
  ) {
    return "PASS";
  }
  // If all unit functions are covered cleanly with >= 80% line & branch coverage and passing tests, mark Covered
  if (
    allFuncsCovered &&
    linesPct >= 80 &&
    (branchesTotal === 0 || branchesPct >= 80) &&
    Number(caseCov?.passedCount || 0) > 0
  ) {
    return "PASS";
  }
  if (
    linesPct > 0 ||
    stmtsPct > 0 ||
    funcsCovered > 0 ||
    Number(caseCov?.passedCount || 0) > 0
  ) {
    return "PARTIAL";
  }
  return "UNCOVERED";
}

function pctColorClass(pct) {
  return calmPctTextClass(pct);
}

const UnitFileMatrixTable = forwardRef(function UnitFileMatrixTable(
  {
    snapshotId = null,
    fileEntries = [],
    onSuggestSelected,
    onSuggestAllUncovered,
    onApplySelected,
    onRunSelectedTests,
    onOpenAddTest,
    onOpenEditTest,
    onDeleteTestCase,
    onBulkDeleteTestCases = null,
    onAIFixTestCase,
    onOpenFileAnalysis,
    onOpenSourceFile,
    isGenerating = false,
    isApplying = false,
    isRunning = false,
    fixingTestId = null,
    pendingOpsCount = 0,
    isApplyingPending = false,
    onApplyPendingChanges = null,
    onDiscardPendingChanges = null,
  },
  ref,
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [expandedSourcePaths, setExpandedSourcePaths] = useState(() => new Set());
  const [fetchedSourceByPath, setFetchedSourceByPath] = useState({});
  const [loadingSourcePaths, setLoadingSourcePaths] = useState(() => new Set());
  const [sourceErrorByPath, setSourceErrorByPath] = useState({});
  const [highlightedSourceLine, setHighlightedSourceLine] = useState(null);
  const [expandedCodeIds, setExpandedCodeIds] = useState(() => new Set());
  const [fetchedCodeByKey, setFetchedCodeByKey] = useState({});
  const [loadingCodeKeys, setLoadingCodeKeys] = useState(() => new Set());
  const [copiedCodeKey, setCopiedCodeKey] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(
    () => loadMatrixSelection("unit", snapshotId).parents,
  );
  const [selectedTestIds, setSelectedTestIds] = useState(
    () => loadMatrixSelection("unit", snapshotId).children,
  );

  useEffect(() => {
    saveMatrixSelection("unit", snapshotId, selectedFiles, selectedTestIds);
  }, [snapshotId, selectedFiles, selectedTestIds]);

  const getUnitTestSelectionKey = (tc, entry) => {
    const title = tc?.title || tc?.testName;
    if (title) {
      return `${entry?.filePath || tc?.sourceFile || ""}::${tc?.testFile || ""}::${title}`;
    }
    return String(tc?.id || "");
  };

  useImperativeHandle(
    ref,
    () => ({
      selectAllFiles: () => {
        const parentSet = new Set();
        const childSet = new Set();
        for (const entry of fileEntries || []) {
          if (!entry?.filePath) continue;
          parentSet.add(entry.filePath);
          for (const tc of entry.testCases || []) {
            const k = getUnitTestSelectionKey(tc, entry);
            if (k) childSet.add(k);
          }
        }
        setSelectedFiles(parentSet);
        setSelectedTestIds(childSet);
        saveMatrixSelection("unit", snapshotId, parentSet, childSet);
      },
    }),
    [fileEntries, snapshotId],
  );

  const toggleSourceCodePreview = async (filePath, targetLine = null) => {
    if (!filePath) return;
    const isCurrentlyOpen = expandedSourcePaths.has(filePath);
    if (targetLine != null) {
      setExpandedSourcePaths((prev) => new Set(prev).add(filePath));
      setHighlightedSourceLine({ filePath, line: targetLine });
    } else {
      setExpandedSourcePaths((prev) => {
        const next = new Set(prev);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        return next;
      });
      if (isCurrentlyOpen) return;
    }

    const scrollToTargetLine = () => {
      if (targetLine == null || typeof document === "undefined") return;
      requestAnimationFrame(() => {
        const el = document.getElementById(`covai-src-${filePath}-L${targetLine}`);
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      });
    };

    if (fetchedSourceByPath[filePath] || !snapshotId) {
      scrollToTargetLine();
      return;
    }

    setLoadingSourcePaths((prev) => new Set(prev).add(filePath));
    setSourceErrorByPath((prev) => {
      if (!prev[filePath]) return prev;
      const next = { ...prev };
      delete next[filePath];
      return next;
    });
    try {
      const res = await getFileCoverage(snapshotId, filePath);
      const detail = res?.data || res || {};
      const code = detail?.sourceCode || detail?.code || "";
      const uncoveredSet = new Set(
        Array.isArray(detail?.uncoveredLines)
          ? detail.uncoveredLines.map((n) => Number(n)).filter(Number.isFinite)
          : [],
      );
      setFetchedSourceByPath((prev) => ({
        ...prev,
        [filePath]: { code, uncoveredLines: uncoveredSet },
      }));
      scrollToTargetLine();
    } catch (err) {
      console.warn("[UnitFileMatrixTable] Failed to fetch source code preview:", err?.message);
      setSourceErrorByPath((prev) => ({
        ...prev,
        [filePath]: err?.message || "Unable to load source file content.",
      }));
    } finally {
      setLoadingSourcePaths((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  const toggleCodePreview = async (tcKey, tc) => {
    const isCurrentlyOpen = expandedCodeIds.has(tcKey);
    setExpandedCodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(tcKey)) next.delete(tcKey);
      else next.add(tcKey);
      return next;
    });
    if (isCurrentlyOpen) return;

    const inlineCode =
      tc?.code ||
      tc?.suggestionObj?.fullUpdatedContent ||
      tc?.suggestionObj?.suggestedTestCode ||
      tc?.suggestionObj?.generatedCode ||
      "";
    if (inlineCode || fetchedCodeByKey[tcKey] || !snapshotId || !tc?.testFile) {
      return;
    }

    setLoadingCodeKeys((prev) => new Set(prev).add(tcKey));
    try {
      const res = await getUnitTestCaseDetail(snapshotId, {
        testFile: tc.testFile,
        testName: tc.title || tc.testName,
      });
      const detail = res?.data || res;
      const resolvedCode =
        detail?.code || detail?.testCode || detail?.fullContent || "";
      if (resolvedCode) {
        setFetchedCodeByKey((prev) => ({ ...prev, [tcKey]: resolvedCode }));
      }
    } catch (err) {
      console.warn("[UnitFileMatrixTable] Failed to fetch unit test code preview:", err?.message);
    } finally {
      setLoadingCodeKeys((prev) => {
        const next = new Set(prev);
        next.delete(tcKey);
        return next;
      });
    }
  };

  const handleCopyCode = (tcKey, text) => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedCodeKey(tcKey);
        setTimeout(() => {
          setCopiedCodeKey((cur) => (cur === tcKey ? null : cur));
        }, 1600);
      })
      .catch(() => {});
  };

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
    setConfirmBulkDelete(false);
    const targetEntry = enrichedEntries.find((e) => e.filePath === filePath);
    const next = toggleParentSelection({
      parentKey: filePath,
      childKeys: (targetEntry?.testCases || [])
        .map((tc) => getUnitTestSelectionKey(tc, targetEntry))
        .filter(Boolean),
      legacyChildKeys: (targetEntry?.testCases || [])
        .map((tc) => String(tc?.id || ""))
        .filter(Boolean),
      parents: selectedFiles,
      children: selectedTestIds,
    });
    setSelectedFiles(next.parents);
    setSelectedTestIds(next.children);
  };

  const toggleSelectAllFiles = () => {
    setConfirmBulkDelete(false);
    if (filteredEntries.length === 0) return;
    const allSelected = filteredEntries.every((e) => selectedFiles.has(e.filePath));
    const next = toggleAllParentsSelection({
      items: filteredEntries.map((entry) => ({
        parentKey: entry.filePath,
        childKeys: (entry.testCases || [])
          .map((tc) => getUnitTestSelectionKey(tc, entry))
          .filter(Boolean),
        legacyChildKeys: (entry.testCases || [])
          .map((tc) => String(tc?.id || ""))
          .filter(Boolean),
      })),
      allSelected,
      parents: selectedFiles,
      children: selectedTestIds,
    });
    setSelectedFiles(next.parents);
    setSelectedTestIds(next.children);
  };

  const toggleSelectTest = (testKey, entry = null, legacyId = null) => {
    setConfirmBulkDelete(false);
    const next = toggleChildSelection({
      childKey: testKey,
      legacyChildKey: legacyId ? String(legacyId) : null,
      parentKey: entry?.filePath || null,
      siblingKeys: (entry?.testCases || [])
        .map((tc) => getUnitTestSelectionKey(tc, entry))
        .filter(Boolean),
      parents: selectedFiles,
      children: selectedTestIds,
    });
    setSelectedFiles(next.parents);
    setSelectedTestIds(next.children);
  };

  const selectedFileList = useMemo(
    () => Array.from(selectedFiles),
    [selectedFiles],
  );

  const selectedDraftSuggestions = useMemo(() => {
    const byId = new Map();
    const hasFilter = selectedFiles.size > 0 || selectedTestIds.size > 0;
    for (const entry of enrichedEntries) {
      const fileSelected = selectedFiles.has(entry.filePath);
      for (const tc of entry.testCases || []) {
        if (hasFilter && !fileSelected && !selectedTestIds.has(tc.id)) continue;
        if (tc.origin === "AI_DRAFT" && tc.suggestionObj && !tc.isApplied) {
          const key =
            tc.suggestionObj.suggestionId ||
            tc.suggestionObj.id ||
            `${entry.filePath}::${tc.suggestionObj.framework || "jest"}`;
          if (!byId.has(key)) {
            byId.set(key, tc.suggestionObj);
          }
        }
      }
    }
    return Array.from(byId.values());
  }, [enrichedEntries, selectedFiles, selectedTestIds]);

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
      const parentSelected = selectedFiles.has(entry.filePath);
      for (const tc of entry.testCases || []) {
        const selKey = getUnitTestSelectionKey(tc, entry);
        if (parentSelected || selectedTestIds.has(selKey) || selectedTestIds.has(tc.id)) {
          list.push({ ...tc, sourceFile: entry.filePath });
        }
      }
    }
    return list;
  }, [enrichedEntries, selectedFiles, selectedTestIds]);

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
            {onSuggestAllUncovered &&
              selectedFileList.length === 0 &&
              selectedTestCasesList.length === 0 && (
              <button
                type="button"
                onClick={onSuggestAllUncovered}
                disabled={isGenerating || isApplying || isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-50"
                title="Generate AI unit test drafts for uncovered source files"
              >
                {isGenerating ? (
                  <Loader2 size={12} className="animate-spin text-[var(--color-text-secondary)]" />
                ) : (
                  <Plus size={12} className="text-[var(--color-text-muted)]" />
                )}
                <span>{isGenerating ? "Generating..." : "Generate All"}</span>
              </button>
            )}

            {pendingOpsCount > 0 && onApplyPendingChanges && (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onApplyPendingChanges}
                  disabled={isApplyingPending || isApplying || isRunning}
                  className={TEST_UI.btnPrimary}
                  title="Write temporary unit test additions, edits, and deletions to source files"
                >
                  {isApplyingPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  <span>{isApplyingPending ? "Applying..." : `Apply Changes (${pendingOpsCount})`}</span>
                </button>
                {onDiscardPendingChanges && !isApplyingPending && (
                  <button
                    type="button"
                    onClick={onDiscardPendingChanges}
                    className={TEST_UI.btnSecondary}
                  >
                    Discard
                  </button>
                )}
              </div>
            )}

            {totalPendingDrafts > 0 &&
              onApplySelected &&
              selectedFileList.length === 0 &&
              selectedTestCasesList.length === 0 && (
              <button
                type="button"
                onClick={() => onApplySelected(selectedDraftSuggestions)}
                disabled={isApplying || isRunning}
                className={TEST_UI.btnPrimary}
                title="Verify & apply all pending AI draft unit tests to disk"
              >
                {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                <span>Apply All Drafts ({totalPendingDrafts})</span>
              </button>
            )}

            <button
              type="button"
              onClick={expandedPaths.size > 0 ? collapseAll : expandAll}
              className={TEST_UI.btnSecondary}
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
                  className={TEST_UI.btnSecondary}
                >
                  <Plus size={12} className="text-[var(--color-text-muted)]" />
                  <span>Generate Selected ({selectedFileList.length})</span>
                </button>
              )}

              {(selectedFileList.length > 0 || selectedTestCasesList.length > 0) &&
                selectedDraftSuggestions.length > 0 &&
                onApplySelected && (
                <button
                  type="button"
                  onClick={() => onApplySelected(selectedDraftSuggestions)}
                  disabled={isApplying || isRunning}
                  className={TEST_UI.btnSecondary}
                >
                  <Check size={12} className="text-[var(--color-text-muted)]" />
                  <span>Apply Selected Drafts ({selectedDraftSuggestions.length})</span>
                </button>
              )}

              {selectedTestCasesList.length > 0 && onRunSelectedTests && (
                <button
                  type="button"
                  onClick={() => onRunSelectedTests(selectedTestCasesList)}
                  disabled={isRunning}
                  className={TEST_UI.btnPrimary}
                >
                  <Play size={11} fill="currentColor" />
                  <span>Run Selected Tests ({selectedTestCasesList.length})</span>
                </button>
              )}

              {selectedTestCasesList.length > 0 && onBulkDeleteTestCases && (
                <button
                  type="button"
                  onClick={() =>
                    setPendingDelete({
                      kind: "bulk",
                      items: selectedTestCasesList,
                    })
                  }
                  disabled={isRunning || isApplying}
                  className={TEST_UI.btnDangerSubtle}
                  title="Delete all selected unit test cases"
                >
                  <Trash2 size={11} />
                  <span>Delete ({selectedTestCasesList.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null);
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
                      className="rounded border-[var(--color-border)] accent-[var(--color-text)] cursor-pointer"
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
                  const fnCov = entry.caseCov?.functionCoverage;
                  const fnList = fnCov?.functions?.length ? fnCov.functions : (entry.functions || []);
                  const fnCount = fnCov?.functions?.length
                    ? fnCov.totalFunctions
                    : fnList.length || Number(entry.funcsTotal || 0);
                  const coveredFnCount = fnCov?.functions?.length
                    ? fnCov.coveredFunctions
                    : fnList.filter((f) => Boolean(f.covered) || Number(f.hit || 0) > 0).length;
                  const uncoveredFns = fnCov?.uncoveredFunctions ?? fnList.filter((f) => Number(f.hit || 0) === 0);
                  const displayFuncsPct =
                    fnCov?.functions?.length && fnCount > 0
                      ? (coveredFnCount / fnCount) * 100
                      : Number(entry.funcsPct ?? 0);

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
                              className="rounded border-[var(--color-border)] accent-[var(--color-text)] cursor-pointer"
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
                              <span className="text-[var(--color-text-muted)]">
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
                            <span title="Function coverage" className={pctColorClass(displayFuncsPct)}>
                              F {Number(displayFuncsPct ?? 0).toFixed(0)}%
                            </span>
                            <span
                              title="Line coverage"
                              className={`font-semibold px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] ${pctColorClass(entry.linesPct)}`}
                            >
                              L {Number(entry.linesPct ?? 0).toFixed(1)}%
                            </span>
                          </div>
                        </td>

                        {/* Status (aligned with Integration Test: Covered / Partial (X/Y) / Failed / Uncovered) */}
                        <td className="py-3 px-3 align-top">
                          <div className="pt-0.5">
                            {entry.status === "PASS" ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/65" />
                                Covered
                              </span>
                            ) : entry.status === "PARTIAL" ? (
                              <span
                                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-muted)] font-mono tabular-nums"
                                title={`Unit Functions verified: ${coveredFnCount}/${fnCount} · Lines: ${Number(entry.linesPct ?? 0).toFixed(1)}%`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                                {fnCount > 0
                                  ? `Partial (${coveredFnCount}/${fnCount})`
                                  : `Partial (${Number(entry.linesPct ?? 0).toFixed(0)}%)`}
                              </span>
                            ) : entry.status === "FAIL" ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-300/85">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400/75" />
                                Failed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border-strong)]" />
                                Uncovered
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Tests Count */}
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[11px] align-top">
                          {testCount === 0 ? (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          ) : (
                            <span className="text-[var(--color-text-secondary)]">
                              {testCount} {testCount === 1 ? "test" : "tests"}
                            </span>
                          )}
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
                                      {Number(entry.stmtsTotal || 0) > 0
                                        ? `${entry.stmtsCovered ?? 0}/${entry.stmtsTotal} (${Number(entry.stmtsPct ?? 0).toFixed(1)}%)`
                                        : `${Number(entry.stmtsPct ?? 0).toFixed(1)}%`}
                                    </span>
                                  </span>
                                  <span>
                                    Branches:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {Number(entry.branchesTotal || 0) > 0
                                        ? `${entry.branchesCovered ?? 0}/${entry.branchesTotal} (${Number(entry.branchesPct ?? 0).toFixed(1)}%)`
                                        : `${Number(entry.branchesPct ?? 0).toFixed(1)}%`}
                                    </span>
                                  </span>
                                  <span>
                                    Functions:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {coveredFnCount}/{fnCount} ({Number(displayFuncsPct ?? 0).toFixed(1)}%)
                                    </span>
                                  </span>
                                  <span>
                                    Lines:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {Number(entry.linesTotal || 0) > 0
                                        ? `${entry.linesCovered ?? 0}/${entry.linesTotal} (${Number(entry.linesPct ?? 0).toFixed(1)}%)`
                                        : `${Number(entry.linesPct ?? 0).toFixed(1)}%`}
                                    </span>
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleSourceCodePreview(entry.filePath)}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors cursor-pointer ${
                                      expandedSourcePaths.has(entry.filePath)
                                        ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-medium"
                                        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"
                                    }`}
                                    title="View source code inline without leaving Unit Test"
                                  >
                                    <FileCode size={11} />
                                    <span>{expandedSourcePaths.has(entry.filePath) ? "Hide Source Code" : "Source Code"}</span>
                                  </button>
                                </div>
                              </div>

                              {/* Inline Source Code Viewer */}
                              {expandedSourcePaths.has(entry.filePath) && (() => {
                                const srcData = fetchedSourceByPath[entry.filePath];
                                const srcCode = srcData?.code || "";
                                const uncoveredSet = srcData?.uncoveredLines;
                                const isSrcLoading = loadingSourcePaths.has(entry.filePath);
                                const srcError = sourceErrorByPath[entry.filePath];
                                const srcLines = srcCode ? srcCode.split(/\r?\n/) : [];
                                const srcCopyKey = `src::${entry.filePath}`;
                                return (
                                  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                                    <div className="px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/70 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[var(--color-text-muted)]">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <FileCode size={11} className="text-[var(--color-primary)] shrink-0" />
                                        <span className="truncate text-[var(--color-text-secondary)]">
                                          {entry.filePath}
                                        </span>
                                        {srcLines.length > 0 && (
                                          <span className="px-1.5 py-0.2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[9px] tabular-nums">
                                            {srcLines.length} lines
                                          </span>
                                        )}
                                        {uncoveredSet && uncoveredSet.size > 0 && (
                                          <span className="px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[9px] tabular-nums">
                                            {uncoveredSet.size} uncovered lines
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {srcCode && (
                                          <button
                                            type="button"
                                            onClick={() => handleCopyCode(srcCopyKey, srcCode)}
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                                          >
                                            <Copy size={10} />
                                            <span>{copiedCodeKey === srcCopyKey ? "Copied" : "Copy"}</span>
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => toggleSourceCodePreview(entry.filePath)}
                                          className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] cursor-pointer"
                                          title="Close inline source viewer"
                                        >
                                          <X size={12} />
                                        </button>
                                      </div>
                                    </div>
                                    {isSrcLoading ? (
                                      <div className="p-3 flex items-center gap-2 text-[11px] font-mono text-[var(--color-text-muted)]">
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>Loading source file...</span>
                                      </div>
                                    ) : srcError ? (
                                      <div className="p-3 text-[11px] font-mono text-rose-400">
                                        {srcError}
                                      </div>
                                    ) : srcLines.length > 0 ? (
                                      <div className="overflow-auto max-h-96 font-mono text-[11px] leading-5">
                                        {srcLines.map((lineText, idx) => {
                                          const lineNo = idx + 1;
                                          const isJumped =
                                            highlightedSourceLine?.filePath === entry.filePath &&
                                            highlightedSourceLine?.line === lineNo;
                                          const isUncovered = uncoveredSet?.has(lineNo);
                                          return (
                                            <div
                                              key={lineNo}
                                              id={`covai-src-${entry.filePath}-L${lineNo}`}
                                              className={`flex items-start px-3 ${
                                                isJumped
                                                  ? "bg-[var(--color-primary)]/20 text-[var(--color-text)]"
                                                  : isUncovered
                                                    ? "bg-rose-500/10 text-[var(--color-text-secondary)]"
                                                    : "hover:bg-[var(--color-surface-secondary)]/40 text-[var(--color-text-secondary)]"
                                              }`}
                                            >
                                              <span className="w-10 shrink-0 select-none text-right pr-3 text-[10px] text-[var(--color-text-muted)] tabular-nums">
                                                {lineNo}
                                              </span>
                                              <span className="whitespace-pre">{lineText || " "}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="p-3 text-[11px] font-mono text-[var(--color-text-muted)]">
                                        Source file content is empty or unavailable.
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Business Logic Functions Coverage Strip */}
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                  <span className="font-mono text-[var(--color-text-muted)] mr-1">
                                    Unit Functions ({coveredFnCount}/{fnCount}):
                                  </span>
                                  {(entry.caseCov.functionCoverage?.functions || []).length > 0 ? (
                                    entry.caseCov.functionCoverage.functions.map((fn) => (
                                      <button
                                        key={fn.key}
                                        type="button"
                                        onClick={() =>
                                          toggleSourceCodePreview(
                                            entry.filePath,
                                            fn.startLine || 1,
                                          )
                                        }
                                        title={`Inspect ${fn.name}() inline at line ${fn.startLine || 1} (${fn.hit || 0} hits)`}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono text-[10px] cursor-pointer transition-colors ${
                                          fn.failed
                                            ? "bg-rose-500/[0.07] text-rose-400/90 border-rose-500/20 hover:bg-rose-500/15"
                                            : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
                                        }`}
                                      >
                                        <span
                                          className={
                                            fn.passed
                                              ? "text-emerald-400/80"
                                              : fn.failed
                                                ? "text-rose-400/85"
                                                : "text-[var(--color-text-muted)]"
                                          }
                                        >
                                          {fn.passed
                                            ? "✓"
                                            : fn.failed
                                              ? "✕"
                                              : fn.hasDraftTest
                                                ? "•"
                                                : "○"}
                                        </span>
                                        <span>
                                          {fn.name}() :{fn.startLine || 1}
                                        </span>
                                      </button>
                                    ))
                                  ) : (
                                    <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
                                      {Number(entry.linesPct ?? 0) >= 100
                                        ? "✓ Module top-level logic covered (100%)"
                                        : "Module top-level logic"}
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono tabular-nums text-[var(--color-text-muted)]">
                                  {entry.caseCov.passedCount > 0 && (
                                    <span className="text-emerald-400">
                                      {entry.caseCov.passedCount} passed
                                    </span>
                                  )}
                                  {entry.caseCov.failedCount > 0 && (
                                    <span className="text-rose-400">
                                      {entry.caseCov.failedCount} failed
                                    </span>
                                  )}
                                  {entry.caseCov.notRunCount > 0 && (
                                    <span>{entry.caseCov.notRunCount} pending</span>
                                  )}
                                  {entry.caseCov.redundantCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25">
                                      {entry.caseCov.redundantCount} duplicate
                                    </span>
                                  )}
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                                    {testCount} {testCount === 1 ? "scenario" : "scenarios"}
                                  </span>
                                </div>
                              </div>

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
                                    const diag = failed ? diagnoseUnitFailure(tc) : null;
                                    const failureSummary = failed
                                      ? diag?.explanation ||
                                        tc.failureSummary ||
                                        summarizeUnitFailure(tc.failureMessages)
                                      : "";
                                    const tcSelKey = getUnitTestSelectionKey(tc, entry);
                                    const tcCodeKey = `${tcSelKey}::${tcIdx}`;
                                    const isCodeOpen = expandedCodeIds.has(tcCodeKey);
                                    const isCodeLoading = loadingCodeKeys.has(tcCodeKey);
                                    const tcFramework = String(
                                      tc.framework || tc.suggestionObj?.framework || "",
                                    )
                                      .trim()
                                      .toUpperCase();
                                    const previewCode =
                                      tc.code ||
                                      fetchedCodeByKey[tcCodeKey] ||
                                      tc.suggestionObj?.fullUpdatedContent ||
                                      tc.suggestionObj?.suggestedTestCode ||
                                      tc.suggestionObj?.generatedCode ||
                                      "";
                                    const canInspectCode = Boolean(previewCode || tc.testFile);
                                    const rawErr = Array.isArray(tc.failureMessages)
                                      ? tc.failureMessages.join("\n").trim()
                                      : "";

                                    return (
                                      <div key={tc.id || tcIdx} className="px-3.5 py-2.5 space-y-1.5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                            <input
                                              type="checkbox"
                                              checked={isSelected || selectedTestIds.has(tcSelKey) || selectedTestIds.has(tc.id)}
                                              onChange={() => toggleSelectTest(tcSelKey, entry, tc.id)}
                                              className="rounded border-[var(--color-border)] accent-[var(--color-text)] cursor-pointer shrink-0"
                                            />
                                            {passed ? (
                                              <CheckCircle2 size={14} className="text-[var(--color-text-secondary)] shrink-0" />
                                            ) : failed ? (
                                              <XCircle size={14} className="text-[var(--color-text)] shrink-0" />
                                            ) : isDraft ? (
                                              <FileCode size={14} className="text-[var(--color-text-muted)] shrink-0" />
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
                                                        ? `Another test already targets "${ann.functionLabel || "this module"}" — safe to delete if redundant.`
                                                        : ann.functionLabel
                                                          ? `Tests unit function ${ann.functionLabel}`
                                                          : "Tests top-level module logic"
                                                    }
                                                    className={`px-1.5 py-0.5 rounded border ${
                                                      ann.badgeType === "DUPLICATE"
                                                        ? "bg-amber-500/[0.08] text-amber-300/85 border-amber-500/20"
                                                        : ann.badgeType === "PRIMARY_FAIL"
                                                          ? "bg-rose-500/[0.08] text-rose-400/85 border-rose-500/20"
                                                          : ann.badgeType === "OPTIONAL"
                                                            ? "border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)]"
                                                            : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                                                    }`}
                                                  >
                                                    {ann.badgeLabel}
                                                  </span>
                                                )}
                                                <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                                                  {isDraft ? "AI_DRAFT" : tc.origin || "PROJECT_EXISTING"}
                                                </span>
                                                {(tcFramework === "JEST" || tcFramework === "VITEST") && (
                                                  <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                                                    {tcFramework}
                                                  </span>
                                                )}
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
                                            {failed && onAIFixTestCase && (
                                              <button
                                                type="button"
                                                onClick={() => onAIFixTestCase(tc, entry)}
                                                disabled={fixingTestId === tc.id || isRunning}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                                                title="Let AI diagnose & repair this failing unit test case"
                                              >
                                                {fixingTestId === tc.id ? (
                                                  <Loader2 size={11} className="animate-spin" />
                                                ) : (
                                                  <Code2 size={11} />
                                                )}
                                                <span>AI Fix</span>
                                              </button>
                                            )}

                                            {onOpenEditTest && (
                                              <button
                                                type="button"
                                                onClick={() => onOpenEditTest(tc, entry)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                                                title="Edit test scenario in temporary workspace"
                                              >
                                                <Edit3 size={11} />
                                                <span>Edit</span>
                                              </button>
                                            )}

                                            {canInspectCode && (
                                              <button
                                                type="button"
                                                onClick={() => toggleCodePreview(tcCodeKey, tc)}
                                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors cursor-pointer ${
                                                  isCodeOpen
                                                    ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border-strong)]"
                                                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
                                                }`}
                                                title="Toggle inline unit test code preview"
                                              >
                                                <Code2 size={11} />
                                                <span>Code</span>
                                              </button>
                                            )}

                                            {onDeleteTestCase && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setPendingDelete({
                                                    kind: "single",
                                                    tc,
                                                    entry,
                                                  })
                                                }
                                                disabled={isRunning}
                                                className="p-1 rounded text-[var(--color-text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-50"
                                                title="Delete this unit test case"
                                              >
                                                <Trash2 size={12} />
                                              </button>
                                            )}
                                          </div>
                                        </div>

                                        {/* Inline Collapsible Code Preview Drawer (matches Integration Test UX) */}
                                        {isCodeOpen && (
                                          <div className="ml-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                                            <div className="px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/70 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[var(--color-text-muted)]">
                                              <div className="flex items-center gap-2 min-w-0">
                                                <span className="truncate text-[var(--color-text-secondary)]">
                                                  {tc.testFile || `${entry.filePath} (draft)`}
                                                </span>
                                                {(tcFramework === "JEST" || tcFramework === "VITEST") && (
                                                  <span className="px-1.5 py-0.2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[9px]">
                                                    {tcFramework}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="flex items-center gap-2 shrink-0">
                                                {previewCode && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleCopyCode(tcCodeKey, previewCode)}
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                                                  >
                                                    <Copy size={10} />
                                                    <span>{copiedCodeKey === tcCodeKey ? "Copied" : "Copy"}</span>
                                                  </button>
                                                )}
                                                {tc.testFile && onOpenSourceFile && (
                                                  <button
                                                    type="button"
                                                    onClick={() => onOpenSourceFile(tc.testFile, 1)}
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
                                                  >
                                                    <ExternalLink size={10} />
                                                    <span>Open in Editor</span>
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                            {isCodeLoading ? (
                                              <div className="p-3 flex items-center gap-2 text-[11px] font-mono text-[var(--color-text-muted)]">
                                                <Loader2 size={12} className="animate-spin" />
                                                <span>Loading test case source...</span>
                                              </div>
                                            ) : previewCode ? (
                                              <pre className="p-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)] whitespace-pre max-h-64">
                                                {previewCode}
                                              </pre>
                                            ) : (
                                              <div className="p-3 text-[11px] font-mono text-[var(--color-text-muted)]">
                                                Test code snippet is not available inline. Use Open in Editor to view the full file.
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* Structured Failure Diagnosis Panel (mirrors Integration Test) */}
                                        {failed && (
                                          <div className="ml-6 rounded border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-[11px] space-y-1.5">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <AlertTriangle size={12} className="shrink-0 text-rose-400" />
                                              {diag?.label && (
                                                <span className="px-1.5 py-0.2 rounded bg-rose-500/15 border border-rose-500/30 font-mono text-[10px] text-rose-300">
                                                  {diag.label}
                                                </span>
                                              )}
                                              {diag?.locationHint && (
                                                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                                                  @ {diag.locationHint}
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-rose-300 font-medium leading-snug">
                                              {failureSummary}
                                            </div>
                                            {diag?.suggestedFix && (
                                              <div className="text-[10px] text-[var(--color-text-secondary)] leading-relaxed">
                                                <span className="font-mono text-[var(--color-text-muted)] mr-1">
                                                  Suggested fix:
                                                </span>
                                                {diag.suggestedFix}
                                              </div>
                                            )}
                                            {rawErr && (
                                              <details className="text-[10px] text-[var(--color-text-muted)]">
                                                <summary className="cursor-pointer hover:text-[var(--color-text-secondary)] select-none">
                                                  Technical details
                                                </summary>
                                                <pre className="mt-1.5 p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] overflow-x-auto font-mono text-[10px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words max-h-40">
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

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === "bulk" && onBulkDeleteTestCases) {
            onBulkDeleteTestCases(pendingDelete.items);
            setSelectedFiles(new Set());
            setSelectedTestIds(new Set());
          } else if (pendingDelete.kind === "single" && onDeleteTestCase) {
            onDeleteTestCase(pendingDelete.tc, pendingDelete.entry);
          }
          setPendingDelete(null);
        }}
        title={
          pendingDelete?.kind === "bulk"
            ? `Delete ${pendingDelete.items?.length || 0} Unit Test Cases`
            : "Delete Unit Test Case"
        }
        message={
          pendingDelete?.kind === "bulk"
            ? "Are you sure you want to remove the selected unit test cases? Changes take effect when applied to test files."
            : "Are you sure you want to remove this unit test case?"
        }
        confirmText="Delete"
        variant="danger"
        icon={Trash2}
      >
        {pendingDelete && (
          <div className="px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text-secondary)] break-all">
            {pendingDelete.kind === "bulk"
              ? pendingDelete.items
                  .slice(0, 3)
                  .map((item) => item.title || item.testName)
                  .join("\n") +
                (pendingDelete.items.length > 3
                  ? `\n+${pendingDelete.items.length - 3} more...`
                  : "")
              : pendingDelete.tc?.title || pendingDelete.tc?.testName}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
});

export default UnitFileMatrixTable;
