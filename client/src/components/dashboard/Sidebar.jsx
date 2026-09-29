import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileCode2,
  FileJson,
  FileText,
  Braces,
  TestTube2,
  RefreshCw,
  Plus,
  FolderPlus,
  Pencil,
  Trash2,
  Loader2,
  Check,
  Box,
  Lock,
  Sliders,
  File,
  FolderGit2,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import ConfirmDialog from "../common/ConfirmDialog";
import { FileTreeSkeleton } from "../common/Skeleton";

/* ── Smart Icon Resolver ─────────────────────────────────── */
function getFileIcon(fileName = "") {
  const lower = fileName.toLowerCase();

  // Test files
  if (
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".spec.js") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".spec.jsx") ||
    lower.endsWith(".test.jsx")
  ) {
    return <TestTube2 size={14} style={{ color: "#c084fc", flexShrink: 0 }} />;
  }

  // React & TypeScript
  if (lower.endsWith(".tsx")) {
    return <FileCode2 size={14} style={{ color: "#67e8f9", flexShrink: 0 }} />;
  }
  if (lower.endsWith(".jsx")) {
    return <FileCode2 size={14} style={{ color: "#22d3ee", flexShrink: 0 }} />;
  }
  if (lower.endsWith(".ts")) {
    return <Braces size={14} style={{ color: "#38bdf8", flexShrink: 0 }} />;
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return <FileCode2 size={14} style={{ color: "#fbbf24", flexShrink: 0 }} />;
  }

  // Config files
  if (
    lower.includes(".config.") ||
    lower.startsWith("tsconfig") ||
    lower.startsWith("vite.config") ||
    lower.startsWith("tailwind") ||
    lower.startsWith("eslint") ||
    lower.startsWith("jest.config")
  ) {
    return <Sliders size={14} style={{ color: "#facc15", flexShrink: 0 }} />;
  }

  // Package & NPM
  if (lower === "package.json" || lower === "package-lock.json") {
    return <Box size={14} style={{ color: "#fb923c", flexShrink: 0 }} />;
  }

  // JSON
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
    return <FileJson size={14} style={{ color: "#4ade80", flexShrink: 0 }} />;
  }

  // Styles
  if (
    lower.endsWith(".css") ||
    lower.endsWith(".scss") ||
    lower.endsWith(".sass") ||
    lower.endsWith(".less")
  ) {
    return <FileText size={14} style={{ color: "#f472b6", flexShrink: 0 }} />;
  }

  // HTML
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return <FileCode2 size={14} style={{ color: "#fb923c", flexShrink: 0 }} />;
  }

  // Markdown & Docs
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".txt")
  ) {
    return <FileText size={14} style={{ color: "#94a3b8", flexShrink: 0 }} />;
  }

  // Git / Env / Lock
  if (
    lower.startsWith(".git") ||
    lower.startsWith(".env") ||
    lower.endsWith(".lock")
  ) {
    return <Lock size={13} style={{ color: "#86efac", flexShrink: 0 }} />;
  }

  return <File size={14} style={{ color: "#94a3b8", flexShrink: 0 }} />;
}

function getFolderIcon(folderName = "", isOpen = false) {
  const lower = folderName.toLowerCase();

  if (
    lower === "__tests__" ||
    lower === "test" ||
    lower === "tests" ||
    lower === "e2e"
  ) {
    return <TestTube2 size={14} style={{ color: "#c084fc", flexShrink: 0 }} />;
  }

  if (
    lower === "src" ||
    lower === "client" ||
    lower === "server" ||
    lower === "app" ||
    lower === "components" ||
    lower === "controllers" ||
    lower === "services" ||
    lower === "routes"
  ) {
    return (
      <FolderGit2
        size={14}
        style={{ color: isOpen ? "#38bdf8" : "#0284c7", flexShrink: 0 }}
      />
    );
  }

  if (isOpen) {
    return <FolderOpen size={14} style={{ color: "#e3b341", flexShrink: 0 }} />;
  }
  return <Folder size={14} style={{ color: "#e3b341", flexShrink: 0 }} />;
}

/* ── Inline Input Row (for New File / Folder) ─────────────── */
function InlineCreationRow({ type, indent, onSubmit, onCancel }) {
  const [val, setVal] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && val.trim()) {
      e.preventDefault();
      onSubmit(val.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-2 select-none"
      style={{
        paddingLeft: indent,
        paddingRight: 14,
        paddingTop: 4,
        paddingBottom: 4,
        background: "rgba(124, 58, 237, 0.08)",
        borderLeft: "2px solid #7c3aed",
      }}
    >
      <span className="w-3 flex-shrink-0" />
      {type === "folder" ? (
        <FolderPlus size={14} style={{ color: "#e3b341", flexShrink: 0 }} />
      ) : (
        <FileCode2 size={14} style={{ color: "#a78bfa", flexShrink: 0 }} />
      )}
      <input
        ref={inputRef}
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (val.trim()) onSubmit(val.trim());
          else onCancel();
        }}
        placeholder={type === "folder" ? "folder-name" : "file-name.js"}
        style={{
          flex: 1,
          background: "var(--color-bg)",
          border: "1px solid var(--color-primary)",
          borderRadius: "4px",
          color: "var(--color-text)",
          fontSize: "12px",
          padding: "2px 6px",
          outline: "none",
          fontFamily: "var(--font-sans)",
        }}
      />
    </div>
  );
}

/* ── Tree Node Component ─────────────────────────────────── */
function TreeNode({
  node,
  depth = 0,
  onSelect,
  activeFileId,
  action,
  onStartAction,
  onCancelAction,
  onSubmitAction,
  treeToggleTrigger,
}) {
  const [open, setOpen] = useState(
    treeToggleTrigger ? !treeToggleTrigger.collapsed : depth < 1,
  );
  const [hovered, setHovered] = useState(false);
  const [renameVal, setRenameVal] = useState(node.name);
  const renameInputRef = useRef(null);

  const isFolder = node.type === "folder";
  const isActive = activeFileId === node.id;
  const indent = depth * 14 + 14;

  const isRenaming = action?.type === "rename" && action?.node?.id === node.id;
  const isCreatingInside =
    (action?.type === "file" || action?.type === "folder") &&
    action?.parentPath === node.id;

  useEffect(() => {
    if (treeToggleTrigger) {
      setOpen(!treeToggleTrigger.collapsed);
    }
  }, [treeToggleTrigger]);

  useEffect(() => {
    if (isRenaming) {
      setRenameVal(node.name);
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 50);
    }
  }, [isRenaming, node.name]);

  useEffect(() => {
    if (isCreatingInside && !open) {
      setOpen(true);
    }
  }, [isCreatingInside, open]);

  const handleRenameSubmit = (e) => {
    e.preventDefault();
    if (renameVal.trim() && renameVal.trim() !== node.name) {
      onSubmitAction({ type: "rename", node, value: renameVal.trim() });
    } else {
      onCancelAction();
    }
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Indentation guide line */}
      {depth > 0 && (
        <div
          style={{
            position: "absolute",
            left: indent - 8,
            top: 0,
            bottom: 0,
            width: "1px",
            background: "rgba(255, 255, 255, 0.04)",
            pointerEvents: "none",
          }}
        />
      )}

      <motion.div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (isFolder) setOpen((o) => !o);
          else onSelect(node);
        }}
        whileTap={{ scale: 0.99 }}
        className="flex items-center gap-2 cursor-pointer select-none relative group"
        style={{
          paddingLeft: indent,
          paddingRight: 10,
          paddingTop: 5,
          paddingBottom: 5,
          background: isActive
            ? "var(--color-primary-light)"
            : hovered
              ? "var(--color-surface-secondary)"
              : "transparent",
          borderLeft: isActive
            ? "2px solid var(--color-primary)"
            : "2px solid transparent",
          color: isActive
            ? "var(--color-primary)"
            : hovered
              ? "var(--color-text)"
              : "var(--color-text-secondary)",
          fontSize: 13,
          fontFamily: "var(--font-sans)",
          transition: "background 0.1s ease, color 0.1s ease",
          borderRadius: "4px",
          margin: "1px 4px",
        }}
      >
        {/* Expand / Collapse arrow */}
        {isFolder ? (
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{ display: "flex", flexShrink: 0 }}
          >
            <ChevronRight
              size={12}
              style={{ opacity: hovered || open ? 0.9 : 0.4 }}
            />
          </motion.span>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Icon */}
        {isFolder ? getFolderIcon(node.name, open) : getFileIcon(node.name)}

        {/* Name / Rename Input */}
        {isRenaming ? (
          <form onSubmit={handleRenameSubmit} style={{ flex: 1, margin: 0 }}>
            <input
              ref={renameInputRef}
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onCancelAction();
              }}
              onBlur={() => {
                if (renameVal.trim() && renameVal.trim() !== node.name) {
                  onSubmitAction({
                    type: "rename",
                    node,
                    value: renameVal.trim(),
                  });
                } else {
                  onCancelAction();
                }
              }}
              style={{
                width: "100%",
                background: "var(--color-bg)",
                border: "1px solid var(--color-primary)",
                borderRadius: "4px",
                color: "var(--color-text)",
                fontSize: "12px",
                padding: "1px 6px",
                outline: "none",
                fontFamily: "var(--font-sans)",
              }}
            />
          </form>
        ) : (
          <span
            className="truncate leading-none"
            style={{
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "var(--color-primary)" : undefined,
            }}
          >
            {node.name}
          </span>
        )}

        {/* Hover Action Buttons */}
        {hovered && !isRenaming && (
          <span
            className="ml-auto flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "2px 3px",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            {isFolder && (
              <>
                <button
                  type="button"
                  title="New File here"
                  onClick={() =>
                    onStartAction({ type: "file", parentPath: node.id })
                  }
                  className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent flex items-center"
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  title="New Folder here"
                  onClick={() =>
                    onStartAction({ type: "folder", parentPath: node.id })
                  }
                  className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent flex items-center"
                >
                  <FolderPlus size={12} />
                </button>
              </>
            )}
            <button
              type="button"
              title="Rename"
              onClick={() => onStartAction({ type: "rename", node })}
              className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent flex items-center"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              title="Delete"
              onClick={() => onStartAction({ type: "delete", node })}
              className="p-1 rounded-[var(--radius-sm)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 transition-colors cursor-pointer border-0 bg-transparent flex items-center"
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </motion.div>

      {/* Children & Inline creation */}
      {isFolder && open && (
        <div>
          {isCreatingInside && (
            <InlineCreationRow
              type={action.type}
              indent={indent + 14}
              onSubmit={(val) =>
                onSubmitAction({
                  type: action.type,
                  parentPath: node.id,
                  value: val,
                })
              }
              onCancel={onCancelAction}
            />
          )}

          {node.children?.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              activeFileId={activeFileId}
              action={action}
              onStartAction={onStartAction}
              onCancelAction={onCancelAction}
              onSubmitAction={onSubmitAction}
              treeToggleTrigger={treeToggleTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Sidebar Component ──────────────────────────────── */
export default function Sidebar({
  sidebarWidth = 260,
  onOpenFile,
  activeFileId,
  fileTree = [],
  project,
  projects = [],
  onChangeProject,
  onDeleteProject,
  isLoading,
  onRefresh,
  onCreateFile,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntry,
}) {
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [action, setAction] = useState(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treeToggleTrigger, setTreeToggleTrigger] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleStartAction = (act) => {
    if (act.type === "delete") {
      setItemToDelete(act.node);
    } else {
      setAction(act);
    }
  };

  const handleCancelAction = () => {
    setAction(null);
  };

  const handleSubmitAction = async (act) => {
    if (!act) return;
    if (act.type === "rename" && act.value.trim()) {
      const parent = act.node.id.includes("/")
        ? act.node.id.slice(0, act.node.id.lastIndexOf("/"))
        : "";
      await onRenameEntry(
        act.node.id,
        parent ? `${parent}/${act.value.trim()}` : act.value.trim(),
      );
    } else if (act.value?.trim()) {
      const targetPath = act.parentPath
        ? `${act.parentPath}/${act.value.trim()}`
        : act.value.trim();
      await (act.type === "file"
        ? onCreateFile(targetPath)
        : onCreateFolder(targetPath));
    }
    setAction(null);
  };

  const handleConfirmDeleteItem = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    await onDeleteEntry(itemToDelete);
    setIsDeleting(false);
    setItemToDelete(null);
  };

  const handleTriggerRefresh = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleToggleCollapse = () => {
    const nextCollapsed = !treeCollapsed;
    setTreeCollapsed(nextCollapsed);
    setTreeToggleTrigger({ collapsed: nextCollapsed, id: Date.now() });
  };

  return (
    <motion.div
      className="flex flex-col h-full flex-shrink-0 select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, width: sidebarWidth }}
      transition={{
        opacity: { duration: 0.25 },
        width: { duration: 0.18, ease: [0.4, 0, 0.2, 1] },
      }}
      style={{
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        position: "relative",
      }}
    >
      {/* ── Explorer Header ─────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 44,
          paddingLeft: 18,
          paddingRight: 12,
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span
          style={{
            color: "var(--color-text-secondary)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "var(--font-sans)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          Explorer
        </span>

        {/* Toolbar buttons */}
        <div className="flex items-center gap-1">
          <motion.button
            whileTap={{ scale: 0.9 }}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent"
            title="New File at root"
            aria-label="New File at root"
            onClick={() => handleStartAction({ type: "file", parentPath: "" })}
          >
            <Plus size={14} />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.9 }}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent"
            title="New Folder at root"
            aria-label="New Folder at root"
            onClick={() =>
              handleStartAction({ type: "folder", parentPath: "" })
            }
          >
            <FolderPlus size={14} />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleTriggerRefresh}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent"
            title="Refresh Files"
            aria-label="Refresh Files"
          >
            <RefreshCw
              size={13}
              className={
                isRefreshing ? "animate-spin text-[var(--color-primary)]" : ""
              }
            />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={handleToggleCollapse}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent flex items-center justify-center relative"
            title={
              treeCollapsed ? "Expand All Folders" : "Collapse All Folders"
            }
            aria-label={
              treeCollapsed ? "Expand All Folders" : "Collapse All Folders"
            }
          >
            <motion.div
              key={treeCollapsed ? "expand" : "collapse"}
              initial={{
                scale: 0.7,
                opacity: 0,
                rotate: treeCollapsed ? -45 : 45,
              }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex items-center justify-center"
            >
              {treeCollapsed ? (
                <ChevronsUpDown size={14} />
              ) : (
                <ChevronsDownUp size={14} />
              )}
            </motion.div>
          </motion.button>
        </div>
      </div>

      {/* ── Current Project Header ───────────────────────── */}
      <div
        className="flex items-center gap-2 flex-shrink-0"
        style={{
          padding: "9px 18px",
          background: "var(--color-surface-secondary)",
          borderBottom: "1px solid var(--color-border)",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--color-success)",
            flexShrink: 0,
          }}
        />
        <span
          className="truncate font-mono text-[11px] text-[var(--color-text)] font-semibold"
          title={project?.name || "No Project"}
        >
          {project?.name || "No Project"}
        </span>
      </div>

      {/* ── File Tree Area ───────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto custom-scrollbar"
        style={{
          paddingTop: 6,
          paddingBottom: 6,
        }}
      >
        {/* Root inline creation row */}
        {action && action.parentPath === "" && (
          <InlineCreationRow
            type={action.type}
            indent={14}
            onSubmit={(val) =>
              handleSubmitAction({
                type: action.type,
                parentPath: "",
                value: val,
              })
            }
            onCancel={handleCancelAction}
          />
        )}

        {isLoading ? (
          <FileTreeSkeleton rows={10} />
        ) : fileTree.length === 0 ? (
          <div
            className="text-xs text-[var(--color-text-muted)] text-center"
            style={{ padding: "32px 16px" }}
          >
            No files found in workspace
          </div>
        ) : (
          fileTree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              onSelect={onOpenFile}
              activeFileId={activeFileId}
              action={action}
              onStartAction={handleStartAction}
              onCancelAction={handleCancelAction}
              onSubmitAction={handleSubmitAction}
              treeToggleTrigger={treeToggleTrigger}
            />
          ))
        )}
      </div>

      {/* ── Footer / Git Status ──────────────────────────── */}
      <div
        className="flex items-center gap-2 flex-shrink-0"
        style={{
          borderTop: "1px solid var(--color-border)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
          fontFamily: "var(--font-mono)",
          padding: "10px 18px",
          background: "var(--color-surface)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--color-success)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ color: "var(--color-text-secondary)" }}>main</span>
        <span style={{ color: "var(--color-success)", marginLeft: "auto" }}>
          ↑ 2 commits
        </span>
      </div>

      {/* ── Item Delete Modal (File or Folder) ─────── */}
      <ConfirmDialog
        isOpen={Boolean(itemToDelete)}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleConfirmDeleteItem}
        title={`Delete ${itemToDelete?.type === "folder" ? "Folder" : "File"}?`}
        message="This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        loading={isDeleting}
      >
        {itemToDelete && (
          <div
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--color-danger)",
              wordBreak: "break-all",
              marginTop: 12,
            }}
          >
            {itemToDelete.id || itemToDelete.name}
          </div>
        )}
      </ConfirmDialog>

      {/* ── Project Delete Modal ─────────────────────────── */}
      <ConfirmDialog
        isOpen={Boolean(projectToDelete)}
        onClose={() => setProjectToDelete(null)}
        onConfirm={async () => {
          setIsDeleting(true);
          await onDeleteProject(projectToDelete.id);
          setIsDeleting(false);
          setProjectToDelete(null);
        }}
        title="Delete Project?"
        message={`Are you sure you want to permanently delete "${projectToDelete?.name}"? All associated files, snapshots, and tests will be lost.`}
        confirmText="Delete Project"
        variant="danger"
        loading={isDeleting}
      />
    </motion.div>
  );
}
