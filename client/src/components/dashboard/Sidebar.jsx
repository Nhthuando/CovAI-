import { useProjectAccess } from "../../hooks/useProjectAccess";
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
    return <TestTube2 size={14} className="text-purple-400 shrink-0" />;
  }

  // React & TypeScript
  if (lower.endsWith(".tsx")) {
    return <FileCode2 size={14} className="text-cyan-400 shrink-0" />;
  }
  if (lower.endsWith(".jsx")) {
    return <FileCode2 size={14} className="text-cyan-400 shrink-0" />;
  }
  if (lower.endsWith(".ts")) {
    return <Braces size={14} className="text-sky-400 shrink-0" />;
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return <FileCode2 size={14} className="text-amber-400 shrink-0" />;
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
    return <Sliders size={14} className="text-yellow-400 shrink-0" />;
  }

  // Package & NPM
  if (lower === "package.json" || lower === "package-lock.json") {
    return <Box size={14} className="text-orange-400 shrink-0" />;
  }

  // JSON
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
    return <FileJson size={14} className="text-emerald-400 shrink-0" />;
  }

  // Styles
  if (
    lower.endsWith(".css") ||
    lower.endsWith(".scss") ||
    lower.endsWith(".sass") ||
    lower.endsWith(".less")
  ) {
    return <FileText size={14} className="text-pink-400 shrink-0" />;
  }

  // HTML
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return <FileCode2 size={14} className="text-orange-400 shrink-0" />;
  }

  // Markdown & Docs
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".txt")
  ) {
    return <FileText size={14} className="text-slate-400 shrink-0" />;
  }

  // Git / Env / Lock
  if (
    lower.startsWith(".git") ||
    lower.startsWith(".env") ||
    lower.endsWith(".lock")
  ) {
    return <Lock size={13} className="text-emerald-300 shrink-0" />;
  }

  return <File size={14} className="text-slate-400 shrink-0" />;
}

function getFolderIcon(folderName = "", isOpen = false) {
  const lower = folderName.toLowerCase();

  if (
    lower === "__tests__" ||
    lower === "test" ||
    lower === "tests" ||
    lower === "e2e"
  ) {
    return <TestTube2 size={14} className="text-purple-400 shrink-0" />;
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
        className={`${isOpen ? "text-sky-400" : "text-sky-600"} shrink-0`}
      />
    );
  }

  if (isOpen) {
    return <FolderOpen size={14} className="text-amber-500 shrink-0" />;
  }
  return <Folder size={14} className="text-amber-500 shrink-0" />;
}

/* ── Inline Input Row (for New File / Folder) ─────────────── */
function InlineCreationRow({ type, indent, onSubmit, onCancel }) {
  const [val, setVal] = useState("");
  const inputRef = useRef(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (value) => {
    if (submittedRef.current) return;
    const trimmed = (value ?? val).trim();
    if (!trimmed) {
      submittedRef.current = true;
      onCancel();
      return;
    }
    submittedRef.current = true;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      submittedRef.current = true;
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-2 select-none py-1 px-2 my-0.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 border-l-2 border-[var(--color-primary)]"
      style={{
        paddingLeft: indent,
      }}
    >
      <span className="w-3 shrink-0" />
      {type === "folder" ? (
        <FolderPlus size={14} className="text-amber-500 shrink-0" />
      ) : (
        <FileCode2 size={14} className="text-[var(--color-primary)] shrink-0" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => handleSubmit()}
        placeholder={type === "folder" ? "folder-name" : "file-name.js"}
        className="flex-1 bg-[var(--color-bg)] border border-[var(--color-primary)] rounded-[var(--radius-sm)] text-[var(--color-text)] text-xs px-1.5 py-0.5 outline-none font-sans"
      />
    </div>
  );
}

/* ── Helper to find node in tree ─────────────────────────── */
function findNodeInTree(nodes, id) {
  if (!nodes || !id) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNodeInTree(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/* ── Tree Node Component ─────────────────────────────────── */
function TreeNode({
  node,
  depth = 0,
  onSelect,
  activeFileId,
  selectedNode,
  onSelectNode,
  onContextMenu,
  action,
  onStartAction,
  onCancelAction,
  onSubmitAction,
  treeToggleTrigger,
}) {
  const [open, setOpen] = useState(
    treeToggleTrigger ? !treeToggleTrigger.collapsed : depth < 1,
  );
  const [renameVal, setRenameVal] = useState(node.name);
  const renameInputRef = useRef(null);
  const renameSubmittedRef = useRef(false);

  const isFolder = node.type === "folder";
  const isActive = activeFileId === node.id;
  const isSelected = selectedNode?.id === node.id;
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
      renameSubmittedRef.current = false;
      setRenameVal(node.name);
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          const dotIdx = node.name.lastIndexOf(".");
          if (dotIdx > 0 && !isFolder) {
            renameInputRef.current.setSelectionRange(0, dotIdx);
          } else {
            renameInputRef.current.select();
          }
        }
      }, 50);
    }
  }, [isRenaming, node.name, isFolder]);

  useEffect(() => {
    if (isCreatingInside && !open) {
      setOpen(true);
    }
  }, [isCreatingInside, open]);

  const handleRenameSubmit = (e) => {
    if (e) e.preventDefault();
    if (renameSubmittedRef.current) return;
    const trimmed = renameVal.trim();
    if (trimmed && trimmed !== node.name) {
      renameSubmittedRef.current = true;
      onSubmitAction({ type: "rename", node, value: trimmed });
    } else {
      renameSubmittedRef.current = true;
      onCancelAction();
    }
  };

  return (
    <div className="relative">
      {/* Indentation guide line: smooth, subtle, theme-aware */}
      {depth > 0 && (
        <div
          style={{
            position: "absolute",
            left: indent - 8,
            top: 0,
            bottom: 0,
            width: "1px",
            background: "var(--color-border)",
            opacity: 0.45,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Row: pure VS Code style, no clutter on hover */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelectNode?.(node);
          if (isFolder) setOpen((o) => !o);
          else onSelect?.(node);
        }}
        onContextMenu={(e) => onContextMenu?.(e, node)}
        className={`group flex items-center gap-2 cursor-pointer select-none relative transition-colors duration-100 rounded-[var(--radius-sm)] mx-1 my-0.5 py-1 pr-2 ${
          isActive
            ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium border-l-2 border-[var(--color-primary)]"
            : isSelected
            ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-medium border-l-2 border-[var(--color-primary)]/60"
            : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]/60 border-l-2 border-transparent"
        }`}
        style={{
          paddingLeft: indent,
          fontSize: 13,
        }}
      >
        {/* Expand / Collapse arrow */}
        {isFolder ? (
          <span
            className="flex shrink-0 transition-transform duration-150 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]"
            style={{
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            <ChevronRight size={12} />
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Icon */}
        {isFolder ? getFolderIcon(node.name, open) : getFileIcon(node.name)}

        {/* Name / Rename Input */}
        {isRenaming ? (
          <form
            onSubmit={handleRenameSubmit}
            className="flex-1 m-0 mr-2"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={renameInputRef}
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleRenameSubmit(e);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  renameSubmittedRef.current = true;
                  onCancelAction();
                }
              }}
              onBlur={() => handleRenameSubmit()}
              className="w-full bg-[var(--color-bg)] border border-[var(--color-primary)] rounded-[var(--radius-sm)] text-[var(--color-text)] text-xs px-1.5 py-0.5 outline-none font-sans"
            />
          </form>
        ) : (
          <span
            className="truncate leading-tight flex-1"
            title={node.name}
          >
            {node.name}
          </span>
        )}
      </div>

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
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
              onContextMenu={onContextMenu}
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
  const access = useProjectAccess(project?.id);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [action, setAction] = useState(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treeToggleTrigger, setTreeToggleTrigger] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // VS Code style selection & context menu
  const [selectedNode, setSelectedNode] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);

  // Auto-sync selectedNode when activeFileId changes
  useEffect(() => {
    if (activeFileId && (!selectedNode || selectedNode.id !== activeFileId)) {
      const found = findNodeInTree(fileTree, activeFileId);
      if (found) setSelectedNode(found);
    }
  }, [activeFileId, fileTree]);

  // Context menu dismissal on global click
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener("click", handleCloseMenu);
    return () => window.removeEventListener("click", handleCloseMenu);
  }, []);

  const handleStartAction = (act) => {
    if (!access.can("files.write")) return;
    if (act.type === "delete") {
      setItemToDelete(act.node);
    } else {
      setAction(act);
    }
  };

  const handleCancelAction = () => {
    setAction(null);
  };

  const handleSubmitAction = (act) => {
    if (!act) return;
    // Immediately close inline input to guarantee zero UX lag
    setAction(null);
    try {
      if (act.type === "rename" && act.value?.trim()) {
        const parent = act.node.id.includes("/")
          ? act.node.id.slice(0, act.node.id.lastIndexOf("/"))
          : "";
        const newPath = parent ? `${parent}/${act.value.trim()}` : act.value.trim();
        onRenameEntry(act.node.id, newPath);
      } else if (act.value?.trim()) {
        const targetPath = act.parentPath
          ? `${act.parentPath}/${act.value.trim()}`
          : act.value.trim();
        if (act.type === "file") {
          onCreateFile(targetPath);
        } else {
          onCreateFolder(targetPath);
        }
      }
    } catch (err) {
      console.error("Action submit failed", err);
    }
  };

  const handleConfirmDeleteItem = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      await onDeleteEntry(itemToDelete);
    } finally {
      setIsDeleting(false);
      setItemToDelete(null);
      if (selectedNode?.id === itemToDelete.id) {
        setSelectedNode(null);
      }
    }
  };

  const handleTriggerRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  const handleToggleCollapse = () => {
    const nextCollapsed = !treeCollapsed;
    setTreeCollapsed(nextCollapsed);
    setTreeToggleTrigger({ collapsed: nextCollapsed, id: Date.now() });
  };

  /**
   * VS Code exact creation path resolution:
   * 1. No item selected (or clicked on root / empty space) -> root ("")
   * 2. Folder selected -> inside that folder
   * 3. File selected -> alongside that file (in the same directory)
   */
  const getCreationParentPath = () => {
    if (!selectedNode) return "";
    if (selectedNode.type === "folder") {
      return selectedNode.id;
    }
    const norm = selectedNode.id.replace(/\\/g, "/");
    const lastSlash = norm.lastIndexOf("/");
    return lastSlash > -1 ? norm.slice(0, lastSlash) : "";
  };

  // Right-click context menu handlers
  const handleContextMenu = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedNode(node);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    });
  };

  const handleContainerContextMenu = (e) => {
    e.preventDefault();
    setSelectedNode(null);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node: null,
    });
  };

  // Keyboard shortcuts: F2 for Rename, Delete for Delete
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        document.activeElement?.isContentEditable ||
        document.activeElement?.closest(".monaco-editor")
      ) {
        return;
      }

      const target =
        selectedNode ||
        (activeFileId ? findNodeInTree(fileTree, activeFileId) : null);

      if (!target) return;

      if (e.key === "F2") {
        e.preventDefault();
        if (access.can("files.write")) {
          handleStartAction({ type: "rename", node: target });
        }
      } else if (e.key === "Delete") {
        e.preventDefault();
        if (access.can("files.write")) {
          setItemToDelete(target);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNode, activeFileId, fileTree, access]);

  return (
    <div
      className="flex flex-col h-full shrink-0 select-none bg-[var(--color-surface)] border-r border-[var(--color-border)] relative"
      style={{
        width: sidebarWidth,
      }}
    >
      {/* ── Explorer Header ─────────────────────────────── */}
      <div className="flex items-center justify-between shrink-0 h-11 px-4 border-b border-[var(--color-border)]">
        <span className="text-[11px] font-bold tracking-wider uppercase text-[var(--color-text-secondary)] font-sans flex items-center gap-1.5">
          Explorer
        </span>

        {/* Toolbar buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent"
            title={
              selectedNode
                ? selectedNode.type === "folder"
                  ? `New File inside '${selectedNode.name}'`
                  : `New File alongside '${selectedNode.name}'`
                : "New File at root"
            }
            aria-label="New File"
            disabled={!access.can("files.write")}
            onClick={() =>
              handleStartAction({
                type: "file",
                parentPath: getCreationParentPath(),
              })
            }
          >
            <Plus size={14} />
          </button>

          <button
            type="button"
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent"
            title={
              selectedNode
                ? selectedNode.type === "folder"
                  ? `New Folder inside '${selectedNode.name}'`
                  : `New Folder alongside '${selectedNode.name}'`
                : "New Folder at root"
            }
            aria-label="New Folder"
            disabled={!access.can("files.write")}
            onClick={() =>
              handleStartAction({
                type: "folder",
                parentPath: getCreationParentPath(),
              })
            }
          >
            <FolderPlus size={14} />
          </button>

          <button
            type="button"
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
          </button>

          <button
            type="button"
            onClick={handleToggleCollapse}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer border-0 bg-transparent flex items-center justify-center"
            title={
              treeCollapsed ? "Expand All Folders" : "Collapse All Folders"
            }
            aria-label={
              treeCollapsed ? "Expand All Folders" : "Collapse All Folders"
            }
          >
            {treeCollapsed ? (
              <ChevronsUpDown size={14} />
            ) : (
              <ChevronsDownUp size={14} />
            )}
          </button>
        </div>
      </div>

      {/* ── Current Project Header ───────────────────────── */}
      <div
        onClick={() => setSelectedNode(null)}
        className="flex items-center gap-2 shrink-0 py-2 px-4 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] text-xs font-sans cursor-pointer hover:bg-[var(--color-surface-secondary)]/80 transition-colors"
        title="Project Root (click to deselect)"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shrink-0" />
        <span
          className="truncate font-mono text-[11px] text-[var(--color-text)] font-semibold"
          title={project?.name || "No Project"}
        >
          {project?.name || "No Project"}
        </span>
      </div>

      {/* ── File Tree Area ───────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto custom-scrollbar py-1.5 focus:outline-none"
        onClick={() => setSelectedNode(null)}
        onContextMenu={handleContainerContextMenu}
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
          <div className="text-xs text-[var(--color-text-muted)] text-center py-8 px-4">
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
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              onContextMenu={handleContextMenu}
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
      <div className="flex items-center gap-2 shrink-0 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-secondary)] font-mono py-2 px-4 bg-[var(--color-surface)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] inline-block shrink-0" />
        <span className="text-[var(--color-text-secondary)]">main</span>
        <span className="text-[var(--color-success)] ml-auto">
          ↑ 2 commits
        </span>
      </div>

      {/* ── Context Menu (VS Code style) ─────────────────── */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[170px] py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-xl text-xs font-sans text-[var(--color-text)] select-none animate-in fade-in duration-100"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 190),
            top: Math.min(contextMenu.y, window.innerHeight - 200),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--color-primary)] hover:text-white transition-colors cursor-pointer border-0 bg-transparent"
            disabled={!access.can("files.write")}
            onClick={() => {
              const parentPath = contextMenu.node
                ? contextMenu.node.type === "folder"
                  ? contextMenu.node.id
                  : contextMenu.node.id.includes("/")
                  ? contextMenu.node.id.slice(0, contextMenu.node.id.lastIndexOf("/"))
                  : ""
                : "";
              setContextMenu(null);
              handleStartAction({ type: "file", parentPath });
            }}
          >
            <span className="flex items-center gap-2">
              <Plus size={13} /> New File
            </span>
          </button>

          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--color-primary)] hover:text-white transition-colors cursor-pointer border-0 bg-transparent"
            disabled={!access.can("files.write")}
            onClick={() => {
              const parentPath = contextMenu.node
                ? contextMenu.node.type === "folder"
                  ? contextMenu.node.id
                  : contextMenu.node.id.includes("/")
                  ? contextMenu.node.id.slice(0, contextMenu.node.id.lastIndexOf("/"))
                  : ""
                : "";
              setContextMenu(null);
              handleStartAction({ type: "folder", parentPath });
            }}
          >
            <span className="flex items-center gap-2">
              <FolderPlus size={13} /> New Folder
            </span>
          </button>

          {contextMenu.node && (
            <>
              <div className="my-1 border-t border-[var(--color-border)]" />
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--color-primary)] hover:text-white transition-colors cursor-pointer border-0 bg-transparent"
                disabled={!access.can("files.write")}
                onClick={() => {
                  const node = contextMenu.node;
                  setContextMenu(null);
                  handleStartAction({ type: "rename", node });
                }}
              >
                <span className="flex items-center gap-2">
                  <Pencil size={12} /> Rename
                </span>
                <span className="text-[10px] opacity-60 font-mono">F2</span>
              </button>

              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white transition-colors cursor-pointer border-0 bg-transparent"
                disabled={!access.can("files.write")}
                onClick={() => {
                  const node = contextMenu.node;
                  setContextMenu(null);
                  setItemToDelete(node);
                }}
              >
                <span className="flex items-center gap-2">
                  <Trash2 size={12} /> Delete
                </span>
                <span className="text-[10px] opacity-60 font-mono">Del</span>
              </button>
            </>
          )}
        </div>
      )}

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
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-2.5 text-xs font-mono text-[var(--color-danger)] break-all mt-3">
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
          try {
            const deleted = await onDeleteProject(projectToDelete.id);
            if (deleted !== false) setProjectToDelete(null);
          } finally {
            setIsDeleting(false);
          }
        }}
        title="Delete Project?"
        message={`Are you sure you want to permanently delete "${projectToDelete?.name}"? All associated files, snapshots, and tests will be lost.`}
        confirmText="Delete Project"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
