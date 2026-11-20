import React, { useState, useMemo, useEffect } from "react";
import {
  FileDiff,
  Check,
  RotateCcw,
  X,
  Columns,
  Rows,
  ChevronLeft,
  ChevronRight,
  TestTube2,
  FileCode2,
  Play,
  Loader2,
  CheckSquare,
  Square,
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  ListChecks,
} from "lucide-react";
import { DiffEditor } from "@monaco-editor/react";
import { diffLines } from "diff";

export function countDiffLines(original, updated) {
  return diffLines(original || "", updated || "").reduce(
    (counts, change) => ({
      added: counts.added + (change.added ? change.count : 0),
      removed: counts.removed + (change.removed ? change.count : 0),
    }),
    { added: 0, removed: 0 },
  );
}

/**
 * Extracts individual `test(...)` / `it(...)` blocks from generated unit test code
 * using balanced parenthesis scanning so users can select and run/apply specific test cases.
 */
export function extractTestCasesFromCode(code = "") {
  if (!code || typeof code !== "string") return [];
  const results = [];
  const regex =
    /(?:^|\n)([ \t]*(?:\/\/[^\n]*\n[ \t]*)*)(?:it|test)(?:\.each\([^)]*\))?\s*\(\s*(['"`])([\s\S]*?)\2\s*,/g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    const leadingCommentsAndIndent = match[1] || "";
    const blockStart = match.index + (match[0].startsWith("\n") ? 1 : 0);
    const title = (match[3] || "").trim();

    // Find the opening '(' of the test(...) / it(...) call
    const callHeaderStart = blockStart + leadingCommentsAndIndent.length;
    const openParenIdx = code.indexOf("(", callHeaderStart);
    if (openParenIdx === -1) continue;

    // Scan for matching closing ')' using string/comment-aware state
    let depth = 0;
    let inString = null;
    let inLineComment = false;
    let inBlockComment = false;
    let endIdx = -1;

    for (let i = openParenIdx; i < code.length; i++) {
      const ch = code[i];
      const next = code[i + 1];

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          i++;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }

      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        inString = ch;
        continue;
      }

      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          while (
            endIdx < code.length &&
            (code[endIdx] === ";" ||
              code[endIdx] === " " ||
              code[endIdx] === "\t")
          ) {
            endIdx++;
          }
          if (code[endIdx] === "\r") endIdx++;
          if (code[endIdx] === "\n") endIdx++;
          break;
        }
      }
    }

    if (endIdx !== -1) {
      const startLine = code.slice(0, blockStart).split("\n").length;
      const endLine = code.slice(0, endIdx).split("\n").length;
      const lowerTitle = title.toLowerCase();
      let category = "Happy Path";
      if (
        /\b(error|throw|reject|fail|invalid|exception|catch)\b/i.test(
          lowerTitle,
        )
      ) {
        category = "Error";
      } else if (
        /\b(bound|edge|empty|zero|null|undefined|max|min|limit|negative)\b/i.test(
          lowerTitle,
        )
      ) {
        category = "Boundary";
      } else if (
        /\b(branch|toggle|condition|if|else|fallback|default|false|true)\b/i.test(
          lowerTitle,
        )
      ) {
        category = "Branch";
      }

      results.push({
        id: `tc_${results.length}_${title.slice(0, 40)}`,
        index: results.length,
        title,
        category,
        startIndex: blockStart,
        endIndex: endIdx,
        startLine,
        endLine,
        rawBlock: code.slice(blockStart, endIdx),
      });
    }
  }

  return results;
}

/**
 * Filters a test file's code so only the checked test cases remain while preserving
 * all imports, mocks, describe blocks, and setup/teardown hooks.
 */
export function filterCodeBySelectedTestCases(
  code = "",
  selectedIds = null,
  extractedCases = [],
) {
  if (!code || !extractedCases.length || !selectedIds) return code;
  if (selectedIds.size >= extractedCases.length) return code;

  const toRemove = extractedCases
    .filter((tc) => !selectedIds.has(tc.id))
    .sort((a, b) => b.startIndex - a.startIndex);

  let updated = code;
  for (const tc of toRemove) {
    updated = updated.slice(0, tc.startIndex) + updated.slice(tc.endIndex);
  }
  return updated.replace(/\n{3,}/g, "\n\n");
}

function getFileIcon(fileName = "") {
  const lower = fileName.toLowerCase();
  if (lower.includes(".test.") || lower.includes(".spec.")) {
    return (
      <TestTube2 size={13} className="text-[var(--color-primary)] shrink-0" />
    );
  }
  return (
    <FileCode2
      size={13}
      className="text-[var(--color-text-secondary)] shrink-0"
    />
  );
}

export default function DiffReviewModal({
  isOpen,
  onClose,
  files = [],
  initialFileIndex = 0,
  onApplyFile,
  onDryRunFile,
  onDryRunAll,
  onUndoFile,
  onApplyAll,
  onRunAnalysis,
  isApplying = false,
  isDryRunning = false,
  applyingStep = "",
  applyResultsByFile = {},
  error = null,
}) {
  const [activeIdx, setActiveIdx] = useState(initialFileIndex);
  const [sideBySide, setSideBySide] = useState(true);
  const [showTestCasesPanel, setShowTestCasesPanel] = useState(true);
  const diffEditorRef = React.useRef(null);

  // Per-file selected test case IDs: { [fileKey]: Set<string> }
  const [selectedTestCasesByFile, setSelectedTestCasesByFile] = useState({});

  const handleDiffMount = (editor) => {
    diffEditorRef.current = editor;
  };

  useEffect(() => {
    return () => {
      if (diffEditorRef.current) {
        try {
          const model = diffEditorRef.current.getModel?.();
          diffEditorRef.current.setModel?.({ original: null, modified: null });
          if (model) {
            if (model.original && !model.original.isDisposed()) {
              model.original.dispose();
            }
            if (model.modified && !model.modified.isDisposed()) {
              model.modified.dispose();
            }
          }
        } catch (_) { }
      }
    };
  }, []);

  useEffect(() => {
    if (initialFileIndex >= 0 && initialFileIndex < files.length) {
      setActiveIdx(initialFileIndex);
    }
  }, [initialFileIndex, files.length]);

  const activeFile = files[activeIdx] || files[0];

  const [activeFw, setActiveFw] = useState(activeFile?.framework || "vitest");
  useEffect(() => {
    if (activeFile?.framework) {
      setActiveFw(activeFile.framework);
    }
  }, [activeFile]);

  const [isApplyingCurrent, setIsApplyingCurrent] = useState(false);
  const [isDryRunningCurrent, setIsDryRunningCurrent] = useState(false);
  const [isApplyingAllInternal, setIsApplyingAllInternal] = useState(false);
  const [isDryRunningAllInternal, setIsDryRunningAllInternal] = useState(false);

  const isApplyingAllCombined = Boolean(isApplying || isApplyingAllInternal);
  const isDryRunningAllCombined = Boolean(
    isDryRunning || isDryRunningAllInternal,
  );
  const isAnyBusy = Boolean(
    isApplyingCurrent ||
    isDryRunningCurrent ||
    isApplyingAllCombined ||
    isDryRunningAllCombined,
  );
  const unappliedCount = files.filter((f) => !f.applied).length;

  const currentSuggestion = useMemo(() => {
    if (!activeFile) return null;
    if (
      Array.isArray(activeFile.suggestions) &&
      activeFile.suggestions.length > 0
    ) {
      return (
        activeFile.suggestions.find((s) => s.framework === activeFw) ||
        activeFile.suggestions[0]
      );
    }
    return activeFile;
  }, [activeFile, activeFw]);

  const rawModifiedCode =
    currentSuggestion?.fullUpdatedContent ||
    currentSuggestion?.suggestedTestCode ||
    currentSuggestion?.generatedCode ||
    activeFile?.fullUpdatedContent ||
    activeFile?.suggestedTestCode ||
    activeFile?.generatedCode ||
    "";

  const extractedTestCases = useMemo(
    () => extractTestCasesFromCode(rawModifiedCode),
    [rawModifiedCode],
  );

  const fileKey =
    activeFile?.filePath || activeFile?.testFilePath || String(activeIdx);

  // Initialize all extracted test cases as selected by default for each file
  const selectedIdsForActiveFile = useMemo(() => {
    const existing = selectedTestCasesByFile[fileKey];
    if (existing) return existing;
    return new Set(extractedTestCases.map((tc) => tc.id));
  }, [selectedTestCasesByFile, fileKey, extractedTestCases]);

  const toggleTestCase = (tcId) => {
    setSelectedTestCasesByFile((prev) => {
      const base = prev[fileKey]
        ? new Set(prev[fileKey])
        : new Set(extractedTestCases.map((tc) => tc.id));
      if (base.has(tcId)) {
        base.delete(tcId);
      } else {
        base.add(tcId);
      }
      return { ...prev, [fileKey]: base };
    });
  };

  const toggleAllTestCases = () => {
    setSelectedTestCasesByFile((prev) => {
      const current = prev[fileKey]
        ? prev[fileKey]
        : new Set(extractedTestCases.map((tc) => tc.id));
      const allSelected = current.size === extractedTestCases.length;
      const next = allSelected
        ? new Set()
        : new Set(extractedTestCases.map((tc) => tc.id));
      return { ...prev, [fileKey]: next };
    });
  };

  const effectiveModifiedCode = useMemo(
    () =>
      filterCodeBySelectedTestCases(
        rawModifiedCode,
        selectedIdsForActiveFile,
        extractedTestCases,
      ),
    [rawModifiedCode, selectedIdsForActiveFile, extractedTestCases],
  );

  const buildScopedSuggestion = (sug) => {
    if (!sug) return sug;
    if (
      extractedTestCases.length === 0 ||
      selectedIdsForActiveFile.size === extractedTestCases.length
    ) {
      return sug;
    }
    return {
      ...sug,
      generatedCode: effectiveModifiedCode,
      suggestedTestCode: effectiveModifiedCode,
      fullUpdatedContent: effectiveModifiedCode,
    };
  };

  const handleDryRunCurrentFile = async () => {
    if (isAnyBusy || !onDryRunFile) return;
    if (extractedTestCases.length > 0 && selectedIdsForActiveFile.size === 0)
      return;
    setIsDryRunningCurrent(true);
    try {
      const scopedSug = buildScopedSuggestion(currentSuggestion);
      await onDryRunFile(activeFile, scopedSug, effectiveModifiedCode);
    } catch (err) {
      console.error("Dry-run file error:", err);
    } finally {
      setIsDryRunningCurrent(false);
    }
  };

  const handleDryRunAllClick = async () => {
    if (isAnyBusy || !onDryRunAll) return;
    setIsDryRunningAllInternal(true);
    try {
      await onDryRunAll();
    } catch (err) {
      console.error("Dry-run all error:", err);
    } finally {
      setIsDryRunningAllInternal(false);
    }
  };

  const handleApplyCurrentFile = async () => {
    if (isAnyBusy || activeFile?.reviewError || activeFile?.hasChanges === false) return;
    if (extractedTestCases.length > 0 && selectedIdsForActiveFile.size === 0)
      return;
    setIsApplyingCurrent(true);
    try {
      const scopedSug = buildScopedSuggestion(currentSuggestion);
      await onApplyFile?.(activeFile, scopedSug, effectiveModifiedCode);
    } catch (err) {
      console.error("Apply file error:", err);
    } finally {
      setIsApplyingCurrent(false);
    }
  };

  const handleApplyAllClick = async () => {
    if (isAnyBusy) return;
    const conflictingFiles = files.filter(file => file.reviewError);
    if (conflictingFiles.length > 0) {
      const names = conflictingFiles.map(f => f.filePath || f.targetTestFile || 'Unknown file').slice(0, 3).join(', ');
      alert(`Cannot Apply All: ${conflictingFiles.length} file(s) have unresolved review conflicts (${names}${conflictingFiles.length > 3 ? '...' : ''}). Please review individual files.`);
      return;
    }
    setIsApplyingAllInternal(true);
    try {
      await onApplyAll?.();
    } catch (err) {
      console.error("Apply all error:", err);
    } finally {
      setIsApplyingAllInternal(false);
    }
  };

  if (!isOpen || !activeFile) return null;

  const originalCode =
    activeFile?.originalContent ??
    currentSuggestion?.originalContent ??
    currentSuggestion?.originalCode ??
    "";
  const isApplied = Boolean(currentSuggestion?.applied ?? activeFile?.applied);
  const addedLines = countDiffLines(originalCode, effectiveModifiedCode).added;

  const fileExecResult =
    applyResultsByFile?.[activeFile.filePath] ||
    applyResultsByFile?.[activeFile.testFilePath] ||
    null;

  const runFailure =
    currentSuggestion?.testRunError ||
    activeFile.suggestions?.find((s) => s.testRunError)?.testRunError ||
    (!fileExecResult?.isPassed && fileExecResult?.errorDetail) ||
    null;

  const anyUnapplied = files.some((f) => !f.applied && f.hasChanges !== false);

  // Extract per-assertion pass/fail status from last dry-run or apply execution
  const assertionStatusByTitle = new Map();
  const rawTestSuites = fileExecResult?.testResults?.testResults || [];
  for (const suite of rawTestSuites) {
    for (const a of suite.assertionResults || []) {
      if (a?.title) {
        assertionStatusByTitle.set(a.title.trim().toLowerCase(), a.status);
      }
    }
  }

  const selectedCount =
    extractedTestCases.length > 0 ? selectedIdsForActiveFile.size : 1;
  const totalCasesCount = extractedTestCases.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-6xl h-[88vh] flex flex-col rounded-lg overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top Header ── */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-[var(--color-bg)] border-b border-[var(--color-border)] gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] shrink-0">
              <FileDiff size={15} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[var(--color-text)] tracking-tight">
                  Review, Test &amp; Apply Candidate Unit Tests
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono tabular-nums font-medium bg-emerald-500/[0.08] text-emerald-400 border border-emerald-500/25">
                  +{addedLines} lines
                </span>
                {fileExecResult && (
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono tabular-nums font-medium border inline-flex items-center gap-1 ${
                      fileExecResult.isPassed
                        ? "bg-emerald-500/[0.08] text-emerald-400 border-emerald-500/25"
                        : "bg-rose-500/[0.08] text-rose-300 border-rose-500/25"
                    }`}
                  >
                    {fileExecResult.isPassed ? (
                      <CheckCircle2 size={11} />
                    ) : (
                      <AlertCircle size={11} />
                    )}
                    <span>
                      {fileExecResult.isDryRun ? "Dry-Run: " : "Run: "}
                      {fileExecResult.isPassed ? "PASSED" : "FAILED"}
                    </span>
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] font-mono truncate max-w-md mt-0.5">
                {currentSuggestion?.targetTestFile ||
                  activeFile.testFilePath ||
                  activeFile.fileName}
              </div>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Framework Switcher (if multi-framework) */}
            {Array.isArray(activeFile.suggestions) &&
              activeFile.suggestions.length > 1 && (
                <div className="flex items-center rounded-md p-0.5 bg-[var(--color-surface)] border border-[var(--color-border)]">
                  {activeFile.suggestions.map((s) => (
                    <button
                      key={s.framework}
                      type="button"
                      onClick={() => setActiveFw(s.framework)}
                      className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors duration-150 cursor-pointer ${
                        activeFw === s.framework
                          ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      }`}
                    >
                      {s.framework === "vitest" ? "Vitest" : "Jest"}
                    </button>
                  ))}
                </div>
              )}

            {/* Toggle Test Cases Selection List */}
            {totalCasesCount > 0 && (
              <button
                type="button"
                onClick={() => setShowTestCasesPanel((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors duration-150 cursor-pointer ${
                  showTestCasesPanel
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30"
                    : "bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                }`}
                title="Select all or specific test cases to run or apply"
              >
                <ListChecks size={13} />
                <span className="font-mono tabular-nums">
                  Cases ({selectedCount}/{totalCasesCount})
                </span>
              </button>
            )}

            {/* Side-by-Side vs Inline Diff Toggle */}
            <button
              type="button"
              onClick={() => setSideBySide(!sideBySide)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors duration-150 cursor-pointer"
              title={
                sideBySide ? "Switch to Unified view" : "Switch to Split view"
              }
            >
              {sideBySide ? <Rows size={13} /> : <Columns size={13} />}
              <span>{sideBySide ? "Split Diff" : "Inline Diff"}</span>
            </button>

            {/* 1. DRY-RUN / VERIFY BEFORE APPLY (Single File / Selected Cases) */}
            {onDryRunFile && !isApplied && (
              <button
                type="button"
                disabled={
                  isAnyBusy || (totalCasesCount > 0 && selectedCount === 0)
                }
                onClick={handleDryRunCurrentFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Run selected test cases in isolated sandbox before applying to verify pass/fail and coverage boost"
              >
                {isDryRunningCurrent ? (
                  <Loader2
                    size={13}
                    className="animate-spin text-[var(--color-primary)]"
                  />
                ) : (
                  <FlaskConical
                    size={13}
                    className="text-[var(--color-primary)]"
                  />
                )}
                <span>
                  {isDryRunningCurrent
                    ? "Testing in Sandbox..."
                    : totalCasesCount > 0 && selectedCount < totalCasesCount
                      ? `Test Selected (${selectedCount}/${totalCasesCount})`
                      : "Test Before Apply"}
                </span>
              </button>
            )}

            {/* 2. DRY-RUN ALL FILES */}
            {onDryRunAll && anyUnapplied && files.length > 1 && (
              <button
                type="button"
                disabled={isAnyBusy}
                onClick={handleDryRunAllClick}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors duration-150 cursor-pointer disabled:opacity-50"
                title="Run all pending candidate files in isolated sandbox before applying"
              >
                {isDryRunningAllCombined ? (
                  <Loader2
                    size={13}
                    className="animate-spin text-[var(--color-primary)]"
                  />
                ) : (
                  <Play size={12} />
                )}
                <span>
                  {isDryRunningAllCombined
                    ? "Testing All..."
                    : `Test All (${unappliedCount})`}
                </span>
              </button>
            )}

            {/* 3. APPLY / UNDO CURRENT FILE */}
            {!isApplied ? (
              <button
                type="button"
                disabled={
                  isAnyBusy || (totalCasesCount > 0 && selectedCount === 0)
                }
                onClick={handleApplyCurrentFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border border-[var(--color-primary)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Write selected test cases to project test file and update coverage"
              >
                {isApplyingCurrent ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                <span>
                  {isApplyingCurrent
                    ? "Applying..."
                    : totalCasesCount > 0 && selectedCount < totalCasesCount
                      ? `Apply Selected (${selectedCount})`
                      : "Apply to File"}
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  isAnyBusy || !onUndoFile || activeFile.canUndo === false
                }
                onClick={() => onUndoFile?.(activeFile, currentSuggestion)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-rose-500/[0.08] hover:bg-rose-500/15 text-rose-300 border border-rose-500/25 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Revert applied test changes"
              >
                <RotateCcw size={13} />
                <span>Undo</span>
              </button>
            )}

            {/* 4. APPLY ALL FILES */}
            {anyUnapplied && files.length > 1 && (
              <button
                type="button"
                disabled={isAnyBusy}
                onClick={handleApplyAllClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors duration-150 cursor-pointer disabled:opacity-50"
                title="Apply all pending candidate test files to project"
              >
                {isApplyingAllCombined ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                <span>
                  {isApplyingAllCombined
                    ? applyingStep ||
                      `Applying ${unappliedCount > 0 ? unappliedCount : files.length} files...`
                    : `Apply All (${unappliedCount > 0 ? unappliedCount : files.length})`}
                </span>
              </button>
            )}

            {/* 5. RE-RUN FULL PROJECT COVERAGE */}
            {onRunAnalysis && (
              <button
                type="button"
                disabled={isAnyBusy}
                onClick={() => {
                  onClose();
                  onRunAnalysis({ restart: true });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors duration-150 cursor-pointer disabled:opacity-50"
                title="Run full project unit test coverage suite"
              >
                <Play size={12} fill="currentColor" />
                <span>Run Full Coverage</span>
              </button>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors duration-150 cursor-pointer"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── File Tabs Bar (Horizontal IDE Style) ── */}
        {files.length > 1 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto custom-scrollbar shrink-0 bg-[var(--color-bg)]/60 border-b border-[var(--color-border)]">
            {files.map((file, idx) => {
              const isSelected = idx === activeIdx;
              const fRes =
                applyResultsByFile?.[file.filePath] ||
                applyResultsByFile?.[file.testFilePath];
              return (
                <button
                  key={file.targetTestFile || file.filePath || idx}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer shrink-0 border ${
                    isSelected
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border-strong)]"
                      : "bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border-transparent hover:bg-[var(--color-surface)]"
                  }`}
                >
                  {getFileIcon(file.fileName)}
                  <span className="font-mono">{file.fileName}</span>
                  <span className="text-[10px] font-mono tabular-nums px-1 py-0.2 rounded bg-emerald-500/[0.08] text-emerald-400 border border-emerald-500/20">
                    +
                    {
                      countDiffLines(
                        file.originalContent || "",
                        file.fullUpdatedContent ||
                          file.suggestedTestCode ||
                          file.generatedCode ||
                          "",
                      ).added
                    }
                  </span>
                  {(isApplyingCurrent || isDryRunningCurrent) && isSelected ? (
                    <Loader2
                      size={11}
                      className="animate-spin text-[var(--color-primary)]"
                    />
                  ) : file.applied ? (
                    <Check
                      size={11}
                      className="text-emerald-400"
                      title="Applied to project"
                    />
                  ) : fRes?.isPassed ? (
                    <CheckCircle2
                      size={11}
                      className="text-sky-400"
                      title="Verified in Dry-Run"
                    />
                  ) : fRes && !fRes.isPassed ? (
                    <AlertCircle
                      size={11}
                      className="text-rose-400"
                      title="Test failed"
                    />
                  ) : null}
                </button>
              );
            })}

            <div className="ml-auto flex items-center gap-1 text-[var(--color-text-muted)] pl-2">
              <button
                type="button"
                disabled={activeIdx === 0}
                onClick={() => setActiveIdx((prev) => Math.max(0, prev - 1))}
                className="p-1 rounded hover:text-[var(--color-text)] disabled:opacity-30 cursor-pointer"
                title="Previous file"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[11px] font-mono tabular-nums">
                {activeIdx + 1} / {files.length}
              </span>
              <button
                type="button"
                disabled={activeIdx === files.length - 1}
                onClick={() =>
                  setActiveIdx((prev) => Math.min(files.length - 1, prev + 1))
                }
                className="p-1 rounded hover:text-[var(--color-text)] disabled:opacity-30 cursor-pointer"
                title="Next file"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── Dry-Run / Execution Result & Coverage Delta Banner ── */}
        {fileExecResult && (
          <div className="px-4 py-2 bg-[var(--color-bg)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                  fileExecResult.isPassed
                    ? "bg-emerald-500/[0.08] text-emerald-400 border-emerald-500/25"
                    : "bg-rose-500/[0.08] text-rose-300 border-rose-500/25"
                }`}
              >
                {fileExecResult.isPassed ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <AlertCircle size={12} />
                )}
                <span>
                  {fileExecResult.isDryRun
                    ? fileExecResult.isPassed
                      ? "Dry-Run Passed (Ready to Apply)"
                      : "Dry-Run Failed"
                    : fileExecResult.isPassed
                      ? "Applied & Verified"
                      : "Execution Failed"}
                </span>
              </span>
              {fileExecResult.testResults && (
                <span className="font-mono tabular-nums text-[var(--color-text-secondary)]">
                  {fileExecResult.testResults.passedTests ?? 0} /{" "}
                  {fileExecResult.testResults.totalTests ?? 0} tests passed
                </span>
              )}
            </div>

            {fileExecResult.newCoverage && (
              <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
                {[
                  ["Stmts", "statements"],
                  ["Branches", "branches"],
                  ["Funcs", "functions"],
                  ["Lines", "lines"],
                ].map(([label, key]) => {
                  const beforeVal = Number(
                    fileExecResult.oldCoverage?.[key] ?? 0,
                  );
                  const afterVal = Number(
                    fileExecResult.newCoverage?.[key] ?? beforeVal,
                  );
                  const delta = Number((afterVal - beforeVal).toFixed(1));
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]"
                    >
                      <span className="text-[var(--color-text-muted)]">
                        {label}:
                      </span>
                      <span className="text-[var(--color-text-secondary)]">
                        {beforeVal.toFixed(0)}%
                      </span>
                      <span className="text-[var(--color-text-muted)]">→</span>
                      <span className="font-semibold text-[var(--color-text)]">
                        {afterVal.toFixed(0)}%
                      </span>
                      {delta > 0 && (
                        <span className="text-emerald-400">+{delta}%</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Error Banner ── */}
        {(error || runFailure) && (
          <div
            role="alert"
            className="px-4 py-2 text-xs font-mono bg-rose-500/[0.06] border-b border-rose-500/20 text-rose-300 max-h-28 overflow-y-auto whitespace-pre-wrap"
          >
            {error || runFailure}
          </div>
        )}

        {/* ── Main Content Split: Optional Test Case Selector + Monaco Diff Editor ── */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {showTestCasesPanel && totalCasesCount > 0 && (
            <div className="w-72 sm:w-80 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={toggleAllTestCases}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] cursor-pointer bg-transparent border-0 p-0"
                >
                  {selectedCount === totalCasesCount ? (
                    <CheckSquare
                      size={13}
                      className="text-[var(--color-primary)]"
                    />
                  ) : (
                    <Square
                      size={13}
                      className="text-[var(--color-text-muted)]"
                    />
                  )}
                  <span>Select All Test Cases</span>
                </button>
                <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
                  {selectedCount}/{totalCasesCount} selected
                </span>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]">
                {extractedTestCases.map((tc, idx) => {
                  const isChecked = selectedIdsForActiveFile.has(tc.id);
                  const execStatus = assertionStatusByTitle.get(
                    tc.title.trim().toLowerCase(),
                  );
                  return (
                    <div
                      key={tc.id}
                      onClick={() => toggleTestCase(tc.id)}
                      className={`px-3 py-2.5 flex items-start gap-2.5 cursor-pointer transition-colors duration-150 ${
                        isChecked
                          ? "bg-[var(--color-surface)]/70 hover:bg-[var(--color-surface-secondary)]"
                          : "bg-transparent opacity-60 hover:opacity-90"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isChecked ? (
                          <CheckSquare
                            size={13}
                            className="text-[var(--color-primary)]"
                          />
                        ) : (
                          <Square
                            size={13}
                            className="text-[var(--color-text-muted)]"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5 mb-0.5">
                          <span className="text-[10px] font-mono tabular-nums text-[var(--color-text-muted)]">
                            #{idx + 1} · L{tc.startLine}–{tc.endLine}
                          </span>
                          <div className="flex items-center gap-1">
                            {execStatus && (
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                                  execStatus === "passed"
                                    ? "bg-emerald-500/[0.08] text-emerald-400 border-emerald-500/25"
                                    : "bg-rose-500/[0.08] text-rose-300 border-rose-500/25"
                                }`}
                              >
                                {execStatus.toUpperCase()}
                              </span>
                            )}
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                              {tc.category}
                            </span>
                          </div>
                        </div>
                        <div
                          className="text-xs font-mono text-[var(--color-text)] leading-snug break-words"
                          title={tc.title}
                        >
                          {tc.title}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="px-3 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                Check one or more test cases above, then click{" "}
                <strong className="text-[var(--color-text)]">
                  Test Before Apply
                </strong>{" "}
                to verify them in the sandbox before writing to disk.
              </div>
            </div>
          )}

          {/* ── Monaco Diff Editor Body ── */}
          {activeFile.reviewError && <div role="alert" className="px-4 py-2 text-sm text-red-300">{activeFile.reviewError}</div>}
          {activeFile.reviewNotice && <div role="status" className="px-4 py-2 text-sm text-slate-300">{activeFile.reviewNotice}</div>}
          {runFailure && <p role="alert" className="px-4 py-2 text-sm text-[var(--color-danger)]">{runFailure}</p>}
          <div className="flex-1 min-h-0 relative">
            <DiffEditor
              height="100%"
              original={originalCode}
              modified={effectiveModifiedCode}
              keepCurrentOriginalModel={true}
              keepCurrentModifiedModel={true}
              onMount={handleDiffMount}
              language="javascript"
              theme="vs-dark"
              loading={
                <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
                  <Loader2
                    size={16}
                    className="animate-spin text-[var(--color-primary)]"
                  />
                  <span className="text-xs">Loading Diff Viewer...</span>
                </div>
              }
              options={{
                readOnly: true,
                renderSideBySide: sideBySide,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                automaticLayout: true,
                lineNumbers: "on",
                wordWrap: "on",
                diffWordWrap: "on",
                renderIndicators: true,
                useInlineViewWhenSpaceIsLimited: true,
                fontSize: 12.5,
              }}
            />
          </div>
        </div>

        {/* ── Footer Info & Explanation ── */}
        <div className="flex items-center justify-between px-4 py-2.5 shrink-0 text-xs bg-[var(--color-bg)] border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)] truncate mr-4">
            <span className="text-[var(--color-text)] font-semibold shrink-0">
              Target Objective:
            </span>
            <span className="truncate">
              {currentSuggestion?.explanation ||
                activeFile.explanation ||
                "Verify generated unit test cases in sandbox before applying to project."}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[var(--color-text-muted)] shrink-0 text-[11px] font-mono tabular-nums">
            <span>Left: Existing file</span>
            <span>·</span>
            <span className="text-emerald-400 font-medium">
              Right: Candidate changes ({selectedCount}/{totalCasesCount || 1}{" "}
              cases)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
