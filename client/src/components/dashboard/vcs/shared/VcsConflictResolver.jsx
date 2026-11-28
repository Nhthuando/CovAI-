import { useMemo, useState } from "react";
import "../../../../lib/monacoSetup.js";
import Editor from "@monaco-editor/react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  GitMerge,
  XCircle,
} from "lucide-react";
import Button from "../../../common/Button";
import { useTheme } from "../../../../contexts/ThemeContext";

export default function VcsConflictResolver({
  mode = "git",
  operationLabel = "Merge Conflict Resolution",
  conflicts = [],
  onResolveFile,
  onResolveAllSnapshot,
  onAbort,
  onContinue,
  resolving = false,
  canResolve = true,
  disabledReason = "",
}) {
  const { resolvedTheme } = useTheme();
  const [selectedPath, setSelectedPath] = useState(
    () => conflicts[0]?.path || null,
  );
  const [draftsByPath, setDraftsByPath] = useState({});
  const [snapshotResolutions, setSnapshotResolutions] = useState({});
  const [manualOpen, setManualOpen] = useState(false);

  const activeConflict = useMemo(() => {
    return (
      conflicts.find((c) => c.path === selectedPath) ||
      conflicts[0] ||
      null
    );
  }, [conflicts, selectedPath]);

  if (!conflicts || (conflicts.length === 0 && mode !== "git")) {
    return null;
  }

  const currentManualText = activeConflict
    ? draftsByPath[activeConflict.path] ??
      activeConflict.working ??
      activeConflict.ours ??
      ""
    : "";

  const handleResolveGit = async (resolution, manualContent) => {
    if (!activeConflict || !onResolveFile) return;
    await onResolveFile({
      filePath: activeConflict.path,
      resolution,
      ...(resolution === "manual" ? { manualContent } : {}),
    });
    setManualOpen(false);
  };

  const handleMarkSnapshot = (resolution, manualContent) => {
    if (!activeConflict) return;
    setSnapshotResolutions((prev) => ({
      ...prev,
      [activeConflict.path]:
        resolution === "manual"
          ? { resolution: "manual", manualContent }
          : { resolution },
    }));
    setManualOpen(false);
    const nextUnresolved = conflicts.find(
      (c) => c.path !== activeConflict.path && !snapshotResolutions[c.path],
    );
    if (nextUnresolved) {
      setSelectedPath(nextUnresolved.path);
    }
  };

  const allSnapshotResolved =
    mode === "snapshot" &&
    conflicts.every((c) => Boolean(snapshotResolutions[c.path]));

  return (
    <div className="flex flex-col border border-[var(--color-border)] border-l-2 border-l-[var(--color-danger)] rounded-lg bg-[var(--color-surface)] overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-[var(--color-surface-secondary)]/55 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-[var(--color-danger)] shrink-0" />
          <div>
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              {operationLabel} ({conflicts.length} conflicted file
              {conflicts.length === 1 ? "" : "s"})
            </h3>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              Choose Ours, Theirs, Both, or edit manually in Monaco before completing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onAbort && (
            <Button
              size="sm"
              variant="secondary"
              icon={XCircle}
              disabled={!canResolve || resolving}
              title={!canResolve ? disabledReason : "Abort operation"}
              onClick={onAbort}
            >
              Abort
            </Button>
          )}
          {mode === "git" && onContinue && (
            <Button
              size="sm"
              variant="primary"
              icon={GitMerge}
              loading={resolving}
              disabled={!canResolve || resolving}
              title={!canResolve ? disabledReason : "Complete merge/rebase"}
              onClick={onContinue}
            >
              Complete Operation
            </Button>
          )}
          {mode === "snapshot" && onResolveAllSnapshot && (
            <Button
              size="sm"
              variant="primary"
              icon={CheckCircle2}
              loading={resolving}
              disabled={!canResolve || !allSnapshotResolved || resolving}
              title={
                !canResolve
                  ? disabledReason
                  : !allSnapshotResolved
                    ? "Mark all conflicted files resolved first"
                    : "Complete 3-way snapshot merge"
              }
              onClick={() => onResolveAllSnapshot(snapshotResolutions)}
            >
              Commit Merged Checkpoint
            </Button>
          )}
        </div>
      </div>

      {/* Body Grid (or ready-to-complete banner when all conflicts are resolved) */}
      {conflicts.length === 0 ? (
        <div className="px-3.5 py-2.5 text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface)] border-l-2 border-l-[var(--color-success)] flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[var(--color-success)] shrink-0" />
          <span>
            All conflicted files are resolved and staged. Click{" "}
            <strong className="font-semibold text-[var(--color-text)]">
              Complete Operation
            </strong>{" "}
            to finalize.
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[360px]">
        {/* Left: Conflicted Files List */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[var(--color-border)] bg-[var(--color-bg)]/50 p-2 space-y-1">
          {conflicts.map((conflict) => {
            const isSelected = activeConflict?.path === conflict.path;
            const resolvedChoice = snapshotResolutions[conflict.path];
            return (
              <button
                key={conflict.path}
                type="button"
                onClick={() => {
                  setSelectedPath(conflict.path);
                  setManualOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-left text-xs cursor-pointer transition-colors duration-150 ${
                  isSelected
                    ? "bg-[var(--color-primary)]/12 text-[var(--color-text)] border border-[var(--color-primary)]/30"
                    : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-transparent"
                }`}
              >
                <span className="font-mono text-[11.5px] truncate">
                  {conflict.path}
                </span>
                {resolvedChoice ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-success)]/12 text-[var(--color-success)] border border-[var(--color-success)]/25 shrink-0">
                    <Check size={10} />
                    {resolvedChoice.resolution}
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-danger)]/12 text-[var(--color-danger)] border border-[var(--color-danger)]/25 shrink-0">
                    {conflict.xy || "!"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Active Conflict Resolution */}
        <div className="lg:col-span-8 flex flex-col min-w-0">
          {activeConflict && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50">
                <span className="font-mono text-xs font-semibold text-[var(--color-text)] truncate">
                  {activeConflict.path}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canResolve || resolving}
                    title={!canResolve ? disabledReason : "Keep current branch version"}
                    onClick={() =>
                      mode === "git"
                        ? handleResolveGit("ours")
                        : handleMarkSnapshot("ours")
                    }
                  >
                    Accept Ours
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canResolve || resolving}
                    title={!canResolve ? disabledReason : "Take incoming branch version"}
                    onClick={() =>
                      mode === "git"
                        ? handleResolveGit("theirs")
                        : handleMarkSnapshot("theirs")
                    }
                  >
                    Accept Theirs
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canResolve || resolving || activeConflict.isBinary}
                    title={!canResolve ? disabledReason : "Keep both changes"}
                    onClick={() =>
                      mode === "git"
                        ? handleResolveGit("both")
                        : handleMarkSnapshot("both")
                    }
                  >
                    Accept Both
                  </Button>
                  {!activeConflict.isBinary && (
                    <Button
                      size="sm"
                      variant={manualOpen ? "primary" : "outline"}
                      icon={Code2}
                      disabled={!canResolve || resolving}
                      onClick={() => setManualOpen((v) => !v)}
                    >
                      Manual Edit
                    </Button>
                  )}
                </div>
              </div>

              {manualOpen ? (
                <div className="flex-1 flex flex-col min-h-[280px]">
                  <div className="flex-1 min-h-[240px]">
                    <Editor
                      height="260px"
                      language={activeConflict.language || "plaintext"}
                      theme={resolvedTheme === "light" ? "vs" : "vs-dark"}
                      value={currentManualText}
                      onChange={(val) =>
                        setDraftsByPath((prev) => ({
                          ...prev,
                          [activeConflict.path]: val ?? "",
                        }))
                      }
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12.5,
                        fontFamily: "var(--font-mono), monospace",
                        readOnly: !canResolve,
                      }}
                    />
                  </div>
                  <div className="flex justify-end gap-2 px-3.5 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Check}
                      loading={resolving}
                      disabled={!canResolve || resolving}
                      onClick={() =>
                        mode === "git"
                          ? handleResolveGit("manual", currentManualText)
                          : handleMarkSnapshot("manual", currentManualText)
                      }
                    >
                      Save &amp; Mark Resolved
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--color-border)] flex-1">
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/55 border-b border-[var(--color-border)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-secondary)] shrink-0" />
                      Ours (Current Branch)
                    </div>
                    <pre className="p-3 text-xs font-mono text-[var(--color-text-secondary)] overflow-auto max-h-64 m-0 whitespace-pre-wrap">
                      {activeConflict.ours ?? "(File deleted in Ours)"}
                    </pre>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/55 border-b border-[var(--color-border)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] shrink-0" />
                      Theirs (Incoming Branch)
                    </div>
                    <pre className="p-3 text-xs font-mono text-[var(--color-text-secondary)] overflow-auto max-h-64 m-0 whitespace-pre-wrap">
                      {activeConflict.theirs ?? "(File deleted in Theirs)"}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </div>
      )}
    </div>
  );
}
