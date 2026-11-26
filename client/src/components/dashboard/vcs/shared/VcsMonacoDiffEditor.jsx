import { useEffect, useRef, useState } from "react";
import "../../../../lib/monacoSetup.js";
import { DiffEditor } from "@monaco-editor/react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Columns2,
  ExternalLink,
  FileWarning,
  GitCompare,
  Minus,
  Plus,
  RotateCcw,
  Rows2,
} from "lucide-react";
import { useTheme } from "../../../../contexts/ThemeContext";
import { EditorCodeSkeleton } from "../../../common/Skeleton";

function defineDiffThemes(monaco) {
  monaco.editor.defineTheme("covai-vcs-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0b0f14",
      "editor.lineHighlightBackground": "#171d2580",
      "diffEditor.insertedTextBackground": "#22c55e1c",
      "diffEditor.removedTextBackground": "#ef44441c",
    },
  });
  monaco.editor.defineTheme("covai-vcs-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f1f5f9",
      "diffEditor.insertedTextBackground": "#16a34a1a",
      "diffEditor.removedTextBackground": "#dc26261a",
    },
  });
}

function MountedDiffCanvas({
  language,
  original,
  modified,
  theme,
  renderSideBySide,
  diffEditorRef,
}) {
  useEffect(() => {
    return () => {
      const editor = diffEditorRef.current;
      diffEditorRef.current = null;
      if (!editor) return;
      try {
        const model = editor.getModel?.();
        editor.setModel?.(null);
        model?.original?.dispose?.();
        model?.modified?.dispose?.();
      } catch (err) {
        console.warn("[VcsMonacoDiffEditor] Model cleanup notice:", err?.message || err);
      }
    };
  }, [diffEditorRef]);

  return (
    <DiffEditor
      height="100%"
      language={language || "plaintext"}
      original={original ?? ""}
      modified={modified ?? ""}
      theme={theme}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      beforeMount={defineDiffThemes}
      onMount={(editor) => {
        diffEditorRef.current = editor;
      }}
      options={{
        readOnly: true,
        renderSideBySide,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12.5,
        lineHeight: 20,
        fontFamily: "var(--font-mono), monospace",
        renderOverviewRuler: true,
        ignoreTrimWhitespace: false,
      }}
    />
  );
}

export default function VcsMonacoDiffEditor({
  diffData = null,
  loading = false,
  error = "",
  emptyTitle = "No file selected",
  emptySubtitle = "Select a modified, staged, or untracked file to inspect line-by-line changes.",
  canLocalWrite = false,
  disabledReason = "",
  showHunkActions = false,
  hunkMode = "working",
  onStageHunk,
  onUnstageHunk,
  onRevertHunk,
  onOpenInEditor,
  headerActions = null,
}) {
  const { resolvedTheme } = useTheme();
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const [hunkBusyIndex, setHunkBusyIndex] = useState(null);
  const diffEditorRef = useRef(null);
  const canRenderDiff = Boolean(
    !error && diffData && !diffData.isBinary && !diffData.isTooLarge,
  );
  const [hasMountedDiff, setHasMountedDiff] = useState(false);
  const [lastLanguage, setLastLanguage] = useState("plaintext");
  if (canRenderDiff && !hasMountedDiff) {
    setHasMountedDiff(true);
  }
  const nextLanguage = canRenderDiff ? diffData.language || "plaintext" : lastLanguage;
  if (canRenderDiff && nextLanguage !== lastLanguage) {
    setLastLanguage(nextLanguage);
  }

  const navigateDiff = (direction) => {
    const editor = diffEditorRef.current;
    if (!editor) return;
    const modifiedEditor = editor.getModifiedEditor?.();
    const changes = editor.getLineChanges?.() || [];
    if (!modifiedEditor || changes.length === 0) return;

    const currentLine = modifiedEditor.getPosition?.()?.lineNumber || 1;
    const lineStarts = changes
      .map((c) => Math.max(1, c.modifiedStartLineNumber || c.originalStartLineNumber || 1))
      .sort((a, b) => a - b);

    let target;
    if (direction === "next") {
      target = lineStarts.find((ln) => ln > currentLine) ?? lineStarts[0];
    } else {
      const prevList = lineStarts.filter((ln) => ln < currentLine);
      target = prevList.length > 0 ? prevList[prevList.length - 1] : lineStarts[lineStarts.length - 1];
    }
    modifiedEditor.revealLineInCenter(target);
    modifiedEditor.setPosition({ lineNumber: target, column: 1 });
  };

  const jumpToLine = (lineNum) => {
    const modifiedEditor = diffEditorRef.current?.getModifiedEditor?.();
    if (!modifiedEditor || !lineNum) return;
    modifiedEditor.revealLineInCenter(Number(lineNum));
    modifiedEditor.setPosition({ lineNumber: Number(lineNum), column: 1 });
  };

  const runHunk = async (fn, idx) => {
    if (!fn || hunkBusyIndex !== null) return;
    setHunkBusyIndex(idx);
    try {
      await fn(diffData.filePath, idx);
    } finally {
      setHunkBusyIndex(null);
    }
  };

  const insertions = diffData?.stats?.insertions ?? 0;
  const deletions = diffData?.stats?.deletions ?? 0;
  const hunks = Array.isArray(diffData?.hunks) ? diffData.hunks : [];

  return (
    <div className="flex flex-col h-full min-h-[380px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/60 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <GitCompare size={14} className="text-[var(--color-primary)] shrink-0" />
          <span
            className="text-xs font-mono font-semibold text-[var(--color-text)] truncate"
            title={diffData?.filePath || ""}
          >
            {diffData?.origPath
              ? `${diffData.origPath} → ${diffData.filePath}`
              : diffData?.filePath || "Diff Preview"}
          </span>
          {diffData?.originalLabel && diffData?.modifiedLabel && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
              <span>{diffData.originalLabel}</span>
              <span>↔</span>
              <span>{diffData.modifiedLabel}</span>
            </span>
          )}
          {diffData && !diffData.isBinary && !diffData.isTooLarge && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
              <span className="text-[var(--color-success)]">+{insertions}</span>
              <span className="text-[var(--color-danger)]">-{deletions}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {diffData && !diffData.isBinary && !diffData.isTooLarge && (
            <>
              <button
                type="button"
                onClick={() => navigateDiff("prev")}
                title="Previous diff hunk"
                className="p-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => navigateDiff("next")}
                title="Next diff hunk"
                className="p-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
              >
                <ArrowDown size={12} />
              </button>
              <div className="flex items-center p-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]">
                <button
                  type="button"
                  onClick={() => setRenderSideBySide(true)}
                  title="Side-by-side split diff"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors duration-150 ${
                    renderSideBySide
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-medium"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <Columns2 size={11} />
                  <span>Split</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRenderSideBySide(false)}
                  title="Unified inline diff"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors duration-150 ${
                    !renderSideBySide
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-medium"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <Rows2 size={11} />
                  <span>Inline</span>
                </button>
              </div>
            </>
          )}

          {diffData?.filePath && onOpenInEditor && (
            <button
              type="button"
              onClick={() => onOpenInEditor(diffData.filePath)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
            >
              <ExternalLink size={11} />
              <span>Open File</span>
            </button>
          )}
          {headerActions}
        </div>
      </div>

      {/* Hunk-Level Actions Bar (Git working/staged diff) */}
      {showHunkActions && hunks.length > 0 && !diffData?.isBinary && !diffData?.isTooLarge && (
        <div className="flex items-center gap-1.5 px-3.5 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg)] overflow-x-auto custom-scrollbar shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] shrink-0 mr-1">
            Hunks ({hunks.length}):
          </span>
          {hunks.map((hunk) => (
            <div
              key={hunk.index}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] font-mono shrink-0"
            >
              <button
                type="button"
                onClick={() => jumpToLine(hunk.newStart || hunk.oldStart)}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] cursor-pointer tabular-nums"
                title={hunk.header}
              >
                #{hunk.index + 1} L{hunk.newStart || hunk.oldStart}
              </button>

              {hunkMode === "working" && onStageHunk && (
                <button
                  type="button"
                  disabled={!canLocalWrite || hunkBusyIndex !== null}
                  title={canLocalWrite ? `Stage Hunk #${hunk.index + 1}` : disabledReason}
                  onClick={() => runHunk(onStageHunk, hunk.index)}
                  className="p-0.5 rounded hover:bg-emerald-500/15 text-emerald-400 disabled:opacity-40 cursor-pointer"
                >
                  <Plus size={11} />
                </button>
              )}

              {hunkMode === "working" && onRevertHunk && (
                <button
                  type="button"
                  disabled={!canLocalWrite || hunkBusyIndex !== null}
                  title={canLocalWrite ? `Revert Hunk #${hunk.index + 1}` : disabledReason}
                  onClick={() => runHunk(onRevertHunk, hunk.index)}
                  className="p-0.5 rounded hover:bg-rose-500/15 text-rose-400 disabled:opacity-40 cursor-pointer"
                >
                  <RotateCcw size={11} />
                </button>
              )}

              {hunkMode === "staged" && onUnstageHunk && (
                <button
                  type="button"
                  disabled={!canLocalWrite || hunkBusyIndex !== null}
                  title={canLocalWrite ? `Unstage Hunk #${hunk.index + 1}` : disabledReason}
                  onClick={() => runHunk(onUnstageHunk, hunk.index)}
                  className="p-0.5 rounded hover:bg-amber-500/15 text-amber-400 disabled:opacity-40 cursor-pointer"
                >
                  <Minus size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Body — keep DiffEditor mounted after first diff open to avoid aborting Monaco workers mid-boot */}
      <div className="flex-1 min-h-[320px] relative bg-[var(--color-bg)]">
        {hasMountedDiff && (
          <div className={canRenderDiff ? "h-full w-full" : "hidden"}>
            <MountedDiffCanvas
              language={lastLanguage}
              original={canRenderDiff ? (diffData.originalContent ?? "") : ""}
              modified={canRenderDiff ? (diffData.modifiedContent ?? "") : ""}
              theme={resolvedTheme === "light" ? "covai-vcs-light" : "covai-vcs-dark"}
              renderSideBySide={renderSideBySide}
              diffEditorRef={diffEditorRef}
            />
          </div>
        )}

        {loading ? (
          <div
            className={`${
              !error && diffData && !diffData.isBinary && !diffData.isTooLarge
                ? "absolute inset-0 z-10 bg-[var(--color-bg)]/85 backdrop-blur-[1px]"
                : "h-full"
            } p-4`}
          >
            <EditorCodeSkeleton lines={14} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-2">
            <AlertCircle size={24} className="text-[var(--color-danger)]" />
            <p className="text-sm font-medium text-[var(--color-text)]">
              Unable to load diff preview
            </p>
            <p className="text-xs text-[var(--color-text-muted)] max-w-md">{error}</p>
          </div>
        ) : !diffData ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <GitCompare size={28} className="text-[var(--color-text-muted)] mb-2.5 opacity-60" />
            <p className="text-sm font-medium text-[var(--color-text)]">{emptyTitle}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-sm">
              {emptySubtitle}
            </p>
          </div>
        ) : diffData.isBinary ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <FileWarning size={26} className="text-[var(--color-warning)] mb-2.5" />
            <p className="text-sm font-medium text-[var(--color-text)]">
              Binary file cannot be displayed in diff viewer
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 font-mono">
              {diffData.filePath}
            </p>
          </div>
        ) : diffData.isTooLarge ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <FileWarning size={26} className="text-[var(--color-warning)] mb-2.5" />
            <p className="text-sm font-medium text-[var(--color-text)]">
              File exceeds 1 MiB inline diff limit
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              You can still stage, commit, or restore this file safely.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
