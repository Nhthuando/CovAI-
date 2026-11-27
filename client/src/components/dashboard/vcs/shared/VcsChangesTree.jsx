import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  EyeOff,
  FileCode2,
  Folder,
  FolderTree,
  List,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  buildChangesFileTree,
  getVcsStatusMeta,
} from "../../../../services/vcsUiHelpers";

function ChangeRowActions({
  item,
  section,
  mode,
  canLocalWrite,
  disabledReason,
  pendingActions,
  onStage,
  onUnstage,
  onDiscard,
  onAddToGitignore,
  onOpenInEditor,
}) {
  const isStaging = pendingActions?.has(`stage:${item.path}`);
  const isUnstaging = pendingActions?.has(`unstage:${item.path}`);

  return (
    <div
      className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      {onOpenInEditor && item.status !== "D" && (
        <button
          type="button"
          onClick={() => onOpenInEditor(item.path)}
          title="Open file in Editor"
          className="p-1 rounded hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
        >
          <ExternalLink size={11} />
        </button>
      )}

      {section === "staged" && onUnstage && (
        <button
          type="button"
          disabled={!canLocalWrite || isUnstaging}
          title={canLocalWrite ? "Unstage changes" : disabledReason}
          onClick={() => onUnstage([item.path])}
          className="p-1 rounded hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          {isUnstaging ? <Loader2 size={11} className="animate-spin" /> : <Minus size={11} />}
        </button>
      )}

      {(section === "unstaged" || section === "conflicts") && (
        <>
          {onDiscard && section === "unstaged" && (
            <button
              type="button"
              disabled={!canLocalWrite}
              title={canLocalWrite ? "Discard changes" : disabledReason}
              onClick={() => onDiscard(item)}
              className="p-1 rounded hover:bg-[var(--color-danger)]/15 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
            >
              <RotateCcw size={11} />
            </button>
          )}
          {mode === "git" &&
            onAddToGitignore &&
            item.status === "U" && (
              <button
                type="button"
                disabled={!canLocalWrite}
                title={canLocalWrite ? "Add to .gitignore" : disabledReason}
                onClick={() => onAddToGitignore(item.path)}
                className="p-1 rounded hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
              >
                <EyeOff size={11} />
              </button>
            )}
          {onStage && (
            <button
              type="button"
              disabled={!canLocalWrite || isStaging}
              title={canLocalWrite ? "Stage changes" : disabledReason}
              onClick={() => onStage([item.path])}
              className="p-1 rounded hover:bg-[var(--color-success)]/15 text-[var(--color-text-muted)] hover:text-[var(--color-success)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
            >
              {isStaging ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ChangeTreeNode({
  node,
  depth = 0,
  section,
  mode,
  selectedFile,
  onSelectFile,
  canLocalWrite,
  disabledReason,
  pendingActions,
  onStage,
  onUnstage,
  onStageFolder,
  onUnstageFolder,
  onDiscard,
  onAddToGitignore,
  onOpenInEditor,
}) {
  const [open, setOpen] = useState(true);

  if (node.type === "folder") {
    const isStagingFolder = pendingActions?.has(`stageFolder:${node.path}`);
    const isUnstagingFolder = pendingActions?.has(`unstageFolder:${node.path}`);
    return (
      <div>
        <div
          onClick={() => setOpen((o) => !o)}
          className="group flex items-center justify-between gap-1.5 py-1 pr-2 rounded hover:bg-[var(--color-surface-secondary)]/60 cursor-pointer text-xs text-[var(--color-text-secondary)]"
          style={{ paddingLeft: depth * 12 + 6 }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {open ? (
              <ChevronDown size={11} className="shrink-0 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronRight size={11} className="shrink-0 text-[var(--color-text-muted)]" />
            )}
            <Folder size={12} className="shrink-0 text-[var(--color-warning)]" />
            <span className="truncate font-medium">{node.name}</span>
          </div>

          <div
            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {section === "staged" && onUnstageFolder && (
              <button
                type="button"
                disabled={!canLocalWrite || isUnstagingFolder}
                title={canLocalWrite ? `Unstage folder ${node.path}` : disabledReason}
                onClick={() => onUnstageFolder(node.path)}
                className="p-1 rounded hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-40"
              >
                {isUnstagingFolder ? <Loader2 size={11} className="animate-spin" /> : <Minus size={11} />}
              </button>
            )}
            {section === "unstaged" && onStageFolder && (
              <button
                type="button"
                disabled={!canLocalWrite || isStagingFolder}
                title={canLocalWrite ? `Stage folder ${node.path}` : disabledReason}
                onClick={() => onStageFolder(node.path)}
                className="p-1 rounded hover:bg-[var(--color-success)]/12 text-[var(--color-text-muted)] hover:text-[var(--color-success)] cursor-pointer disabled:opacity-40"
              >
                {isStagingFolder ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              </button>
            )}
          </div>
        </div>
        {open &&
          node.children.map((child) => (
            <ChangeTreeNode
              key={`${section}:${child.type}:${child.path}`}
              node={child}
              depth={depth + 1}
              section={section}
              mode={mode}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              canLocalWrite={canLocalWrite}
              disabledReason={disabledReason}
              pendingActions={pendingActions}
              onStage={onStage}
              onUnstage={onUnstage}
              onStageFolder={onStageFolder}
              onUnstageFolder={onUnstageFolder}
              onDiscard={onDiscard}
              onAddToGitignore={onAddToGitignore}
              onOpenInEditor={onOpenInEditor}
            />
          ))}
      </div>
    );
  }

  const item = node.item;
  const meta = getVcsStatusMeta(section === "conflicts" ? "!" : item.status);
  const isSelected =
    selectedFile?.path === item.path && selectedFile?.section === section;

  return (
    <div
      onClick={() => onSelectFile?.(item, section)}
      className={`group flex items-center justify-between gap-2 py-1 pr-2 rounded-md cursor-pointer text-xs transition-colors duration-150 ${
        isSelected
          ? "bg-[var(--color-primary)]/12 text-[var(--color-text)] border border-[var(--color-primary)]/30"
          : "hover:bg-[var(--color-surface-secondary)]/70 text-[var(--color-text-secondary)] border border-transparent"
      }`}
      style={{ paddingLeft: depth * 12 + 12 }}
      title={item.origPath ? `${item.origPath} → ${item.path}` : item.path}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <FileCode2 size={12} className="shrink-0 text-[var(--color-text-muted)]" />
        <span className="truncate">{node.name}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <ChangeRowActions
          item={item}
          section={section}
          mode={mode}
          canLocalWrite={canLocalWrite}
          disabledReason={disabledReason}
          pendingActions={pendingActions}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
          onAddToGitignore={onAddToGitignore}
          onOpenInEditor={onOpenInEditor}
        />
        <span
          className={`w-4 text-center text-[10px] font-mono font-bold tabular-nums rounded ${meta.textClass}`}
          title={meta.label}
        >
          {meta.char}
        </span>
      </div>
    </div>
  );
}

const PAGE_SIZE = 100;

function ChangeSection({
  title,
  section,
  items,
  viewMode,
  mode,
  selectedFile,
  onSelectFile,
  canLocalWrite,
  disabledReason,
  pendingActions,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onStageFolder,
  onUnstageFolder,
  onDiscard,
  onDiscardAll,
  onAddToGitignore,
  onOpenInEditor,
  defaultExpanded = true,
  accentClass = "text-[var(--color-text-secondary)]",
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const cappedItems = useMemo(
    () => (items.length > visibleLimit ? items.slice(0, visibleLimit) : items),
    [items, visibleLimit],
  );
  const remainingCount = Math.max(0, items.length - cappedItems.length);
  const treeNodes = useMemo(
    () => (viewMode === "tree" ? buildChangesFileTree(cappedItems) : []),
    [viewMode, cappedItems],
  );

  if (items.length === 0 && section !== "unstaged") return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] overflow-hidden">
      <div
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-surface-secondary)]/60 border-b border-[var(--color-border)] cursor-pointer select-none"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown size={13} className="text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight size={13} className="text-[var(--color-text-muted)]" />
          )}
          {section === "conflicts" && (
            <AlertTriangle size={12} className="text-[var(--color-danger)] shrink-0" />
          )}
          <span
            className={`text-[11px] font-semibold uppercase tracking-wider truncate ${accentClass}`}
          >
            {title}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
            {items.length}
          </span>
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {section === "staged" && items.length > 0 && onUnstageAll && (
            <button
              type="button"
              disabled={!canLocalWrite || pendingActions?.has("unstage:all")}
              title={canLocalWrite ? "Unstage All Changes" : disabledReason}
              onClick={onUnstageAll}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-bg)] hover:bg-[var(--color-border)]/40 border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 flex items-center gap-1"
            >
              {pendingActions?.has("unstage:all") ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Minus size={10} />
              )}
              <span>Unstage All</span>
            </button>
          )}
          {section === "unstaged" && items.length > 0 && (
            <>
              {onDiscardAll && (
                <button
                  type="button"
                  disabled={!canLocalWrite}
                  title={canLocalWrite ? "Discard All Unstaged Changes" : disabledReason}
                  onClick={onDiscardAll}
                  className="p-1 rounded hover:bg-[var(--color-danger)]/15 border border-transparent hover:border-[var(--color-danger)]/25 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                >
                  <RotateCcw size={11} />
                </button>
              )}
              {onStageAll && (
                <button
                  type="button"
                  disabled={!canLocalWrite || pendingActions?.has("stage:all")}
                  title={canLocalWrite ? "Stage All Changes" : disabledReason}
                  onClick={onStageAll}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-bg)] hover:bg-[var(--color-success)]/12 border border-[var(--color-border)] hover:border-[var(--color-success)]/35 text-[var(--color-text-secondary)] hover:text-[var(--color-success)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 flex items-center gap-1"
                >
                  {pendingActions?.has("stage:all") ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Plus size={10} />
                  )}
                  <span>Stage All</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-1.5 space-y-0.5 max-h-72 overflow-y-auto custom-scrollbar">
          {items.length === 0 ? (
            <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-[var(--color-text-muted)]">
              <Check size={13} className="text-[var(--color-success)] shrink-0" />
              <span>Working tree clean — no pending modifications.</span>
            </div>
          ) : viewMode === "tree" ? (
            treeNodes.map((node) => (
              <ChangeTreeNode
                key={`${section}:${node.type}:${node.path}`}
                node={node}
                section={section}
                mode={mode}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                canLocalWrite={canLocalWrite}
                disabledReason={disabledReason}
                pendingActions={pendingActions}
                onStage={onStage}
                onUnstage={onUnstage}
                onStageFolder={onStageFolder}
                onUnstageFolder={onUnstageFolder}
                onDiscard={onDiscard}
                onAddToGitignore={onAddToGitignore}
                onOpenInEditor={onOpenInEditor}
              />
            ))
          ) : (
            cappedItems.map((item) => {
              const meta = getVcsStatusMeta(
                section === "conflicts" ? "!" : item.status,
              );
              const fileName = item.path.split("/").pop();
              const dirName = item.path.includes("/")
                ? item.path.slice(0, item.path.lastIndexOf("/"))
                : "";
              const isSelected =
                selectedFile?.path === item.path &&
                selectedFile?.section === section;

              return (
                <div
                  key={`${section}:${item.path}`}
                  onClick={() => onSelectFile?.(item, section)}
                  className={`group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors duration-150 ${
                    isSelected
                      ? "bg-[var(--color-primary)]/12 text-[var(--color-text)] border border-[var(--color-primary)]/30"
                      : "hover:bg-[var(--color-surface-secondary)]/70 text-[var(--color-text-secondary)] border border-transparent"
                  }`}
                  title={
                    item.origPath
                      ? `${item.origPath} → ${item.path}`
                      : item.path
                  }
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`w-4 h-4 rounded text-[10px] font-mono font-bold tabular-nums flex items-center justify-center shrink-0 ${meta.badgeClass}`}
                    >
                      {meta.char}
                    </span>
                    <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
                      <span className="truncate font-mono text-[11.5px] text-[var(--color-text)]">
                        {fileName}
                      </span>
                      {dirName && (
                        <span className="truncate text-[10px] text-[var(--color-text-muted)]">
                          {dirName}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChangeRowActions
                    item={item}
                    section={section}
                    mode={mode}
                    canLocalWrite={canLocalWrite}
                    disabledReason={disabledReason}
                    pendingActions={pendingActions}
                    onStage={onStage}
                    onUnstage={onUnstage}
                    onDiscard={onDiscard}
                    onAddToGitignore={onAddToGitignore}
                    onOpenInEditor={onOpenInEditor}
                  />
                </div>
              );
            })
          )}
          {remainingCount > 0 && (
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
              className="w-full py-1.5 mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/40 text-[11px] font-mono text-[var(--color-primary)] cursor-pointer transition-colors duration-150"
            >
              Show more ({Math.min(PAGE_SIZE, remainingCount)} of {remainingCount} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function filterChangeItems(list, term) {
  if (!term) return list;
  return list.filter(
    (item) =>
      item.path?.toLowerCase().includes(term) ||
      item.origPath?.toLowerCase().includes(term),
  );
}

export default function VcsChangesTree({
  mode = "git",
  conflicts = [],
  staged = [],
  unstaged = [],
  untracked = [],
  selectedFile = null,
  onSelectFile,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onStageFolder,
  onUnstageFolder,
  onDiscard,
  onDiscardAll,
  onAddToGitignore,
  onOpenInEditor,
  canLocalWrite = true,
  disabledReason = "",
  pendingActions = null,
}) {
  const [viewMode, setViewMode] = useState("flat");
  const [filterText, setFilterText] = useState("");

  const term = filterText.trim().toLowerCase();

  const filteredConflicts = useMemo(
    () => filterChangeItems(conflicts, term),
    [conflicts, term],
  );
  const filteredStaged = useMemo(
    () => filterChangeItems(staged, term),
    [staged, term],
  );
  const combinedUnstaged = useMemo(
    () => [
      ...unstaged,
      ...untracked.map((u) => ({ ...u, status: u.status || "U", isUntracked: true })),
    ],
    [unstaged, untracked],
  );
  const filteredUnstaged = useMemo(
    () => filterChangeItems(combinedUnstaged, term),
    [combinedUnstaged, term],
  );

  return (
    <div className="flex flex-col gap-2.5">
      {/* Filter + View Toggle */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus-within:border-[var(--color-primary)] transition-colors duration-150">
          <Search size={12} className="text-[var(--color-text-muted)] shrink-0" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter changed files..."
            aria-label="Filter changed files"
            className="w-full bg-transparent outline-none text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
        <div className="flex items-center p-0.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setViewMode("flat")}
            title="Flat file list"
            className={`p-1.5 rounded cursor-pointer transition-colors duration-150 ${
              viewMode === "flat"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
            }`}
          >
            <List size={12} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            title="Folder tree view"
            className={`p-1.5 rounded cursor-pointer transition-colors duration-150 ${
              viewMode === "tree"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
            }`}
          >
            <FolderTree size={12} />
          </button>
        </div>
      </div>

      <ChangeSection
        title="Merge Conflicts"
        section="conflicts"
        items={filteredConflicts}
        viewMode={viewMode}
        mode={mode}
        selectedFile={selectedFile}
        onSelectFile={onSelectFile}
        canLocalWrite={canLocalWrite}
        disabledReason={disabledReason}
        pendingActions={pendingActions}
        onStage={onStage}
        onOpenInEditor={onOpenInEditor}
        accentClass="text-[var(--color-danger)]"
      />

      <ChangeSection
        title="Staged Changes"
        section="staged"
        items={filteredStaged}
        viewMode={viewMode}
        mode={mode}
        selectedFile={selectedFile}
        onSelectFile={onSelectFile}
        canLocalWrite={canLocalWrite}
        disabledReason={disabledReason}
        pendingActions={pendingActions}
        onUnstage={onUnstage}
        onUnstageAll={onUnstageAll}
        onUnstageFolder={onUnstageFolder}
        onOpenInEditor={onOpenInEditor}
        accentClass="text-[var(--color-success)]"
      />

      <ChangeSection
        title="Changes"
        section="unstaged"
        items={filteredUnstaged}
        viewMode={viewMode}
        mode={mode}
        selectedFile={selectedFile}
        onSelectFile={onSelectFile}
        canLocalWrite={canLocalWrite}
        disabledReason={disabledReason}
        pendingActions={pendingActions}
        onStage={onStage}
        onStageAll={onStageAll}
        onStageFolder={onStageFolder}
        onDiscard={onDiscard}
        onDiscardAll={onDiscardAll}
        onAddToGitignore={onAddToGitignore}
        onOpenInEditor={onOpenInEditor}
      />
    </div>
  );
}
