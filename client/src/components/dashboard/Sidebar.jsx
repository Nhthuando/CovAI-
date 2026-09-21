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
  AlertTriangle,
  Check,
  X,
  Box,
  Lock,
  Sliders,
  File,
  FolderGit2,
  ChevronsDownUp,
  ChevronDown,
  Sparkles,
} from "lucide-react";

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
          background: "#0d1117",
          border: "1px solid #7c3aed",
          borderRadius: "4px",
          color: "#e6edf3",
          fontSize: "12px",
          padding: "2px 6px",
          outline: "none",
          fontFamily: "var(--font-sans)",
          boxShadow: "0 0 8px rgba(124, 58, 237, 0.4)",
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
  allCollapsed,
}) {
  const [open, setOpen] = useState(depth < 1);
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
    if (allCollapsed) {
      setOpen(false);
    }
  }, [allCollapsed]);

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
            ? "rgba(124, 58, 237, 0.14)"
            : hovered
              ? "rgba(255, 255, 255, 0.04)"
              : "transparent",
          borderLeft: isActive ? "2px solid #a78bfa" : "2px solid transparent",
          color: isActive ? "#c4b5fd" : hovered ? "#e6edf3" : "#8b949e",
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
                background: "#0d1117",
                border: "1px solid #7c3aed",
                borderRadius: "4px",
                color: "#e6edf3",
                fontSize: "12px",
                padding: "1px 6px",
                outline: "none",
                fontFamily: "var(--font-sans)",
                boxShadow: "0 0 8px rgba(124, 58, 237, 0.3)",
              }}
            />
          </form>
        ) : (
          <span
            className="truncate leading-none"
            style={{
              fontWeight: isActive ? 500 : 400,
              color: isActive ? "#f0f6fc" : undefined,
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
              background: "rgba(22, 27, 34, 0.92)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              padding: "2px 3px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              backdropFilter: "blur(6px)",
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
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#8b949e",
                    cursor: "pointer",
                    padding: "3px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255, 255, 255, 0.1)";
                    e.currentTarget.style.color = "#c4b5fd";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#8b949e";
                  }}
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  title="New Folder here"
                  onClick={() =>
                    onStartAction({ type: "folder", parentPath: node.id })
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#8b949e",
                    cursor: "pointer",
                    padding: "3px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "rgba(255, 255, 255, 0.1)";
                    e.currentTarget.style.color = "#fde047";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#8b949e";
                  }}
                >
                  <FolderPlus size={12} />
                </button>
              </>
            )}
            <button
              type="button"
              title="Rename"
              onClick={() => onStartAction({ type: "rename", node })}
              style={{
                background: "transparent",
                border: "none",
                color: "#8b949e",
                cursor: "pointer",
                padding: "3px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                e.currentTarget.style.color = "#38bdf8";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#8b949e";
              }}
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              title="Delete"
              onClick={() => onStartAction({ type: "delete", node })}
              style={{
                background: "transparent",
                border: "none",
                color: "#8b949e",
                cursor: "pointer",
                padding: "3px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
                e.currentTarget.style.color = "#f87171";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#8b949e";
              }}
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
              allCollapsed={allCollapsed}
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
  const [showProjectSelect, setShowProjectSelect] = useState(false);
  const [allCollapsed, setAllCollapsed] = useState(false);
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

  const handleCollapseAll = () => {
    setAllCollapsed(true);
    setTimeout(() => setAllCollapsed(false), 100);
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
        background: "#0d1117",
        borderRight: "1px solid var(--ide-border)",
        position: "relative",
      }}
    >
      {/* ── Explorer Header & Tools ──────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 44,
          paddingLeft: 18,
          paddingRight: 12,
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <span
          style={{
            color: "#8b949e",
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
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-1 rounded cursor-pointer"
            style={{
              color: "#8b949e",
              background: "transparent",
              border: "none",
            }}
            title="New File at root"
            onClick={() => handleStartAction({ type: "file", parentPath: "" })}
          >
            <Plus size={14} />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-1 rounded cursor-pointer"
            style={{
              color: "#8b949e",
              background: "transparent",
              border: "none",
            }}
            title="New Folder at root"
            onClick={() =>
              handleStartAction({ type: "folder", parentPath: "" })
            }
          >
            <FolderPlus size={14} />
          </motion.button>

          <motion.button
            whileHover={{ rotate: 180 }}
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.35 }}
            onClick={handleTriggerRefresh}
            className="p-1 rounded cursor-pointer"
            style={{
              color: "#8b949e",
              background: "transparent",
              border: "none",
            }}
            title="Refresh Files"
          >
            <RefreshCw
              size={13}
              className={isRefreshing ? "animate-spin" : ""}
            />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={handleCollapseAll}
            className="p-1 rounded cursor-pointer"
            style={{
              color: "#8b949e",
              background: "transparent",
              border: "none",
            }}
            title="Collapse All Folders"
          >
            <ChevronsDownUp size={13} />
          </motion.button>
        </div>
      </div>

      {/* ── Project Switcher Bar ─────────────────────────── */}
      <div
        style={{
          position: "relative",
          borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
        }}
      >
        <div
          onClick={() =>
            projects.length > 1 && setShowProjectSelect(!showProjectSelect)
          }
          className="flex items-center justify-between flex-shrink-0 cursor-pointer"
          style={{
            padding: "9px 18px",
            background: "rgba(255, 255, 255, 0.015)",
            fontSize: "12px",
            fontWeight: 600,
            color: "#c9d1d9",
            fontFamily: "var(--font-sans)",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (projects.length > 1) {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.015)";
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#3fb950",
                boxShadow: "0 0 6px #3fb950",
                flexShrink: 0,
              }}
            />
            <span className="truncate font-mono text-[11px] text-[#e6edf3]">
              {project?.name || "No Project"}
            </span>
          </div>

          {projects.length > 1 && (
            <ChevronDown
              size={12}
              style={{
                color: "#6e7681",
                transform: showProjectSelect ? "rotate(180deg)" : "none",
                transition: "transform 0.2s ease",
              }}
            />
          )}
        </div>

        {/* Project Dropdown */}
        <AnimatePresence>
          {showProjectSelect && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              style={{
                position: "absolute",
                top: "100%",
                left: 6,
                right: 6,
                background: "#161b22",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "8px",
                zIndex: 40,
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                padding: "4px",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {projects.map((p) => {
                const isCur = p.id === project?.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      onChangeProject(p.id);
                      setShowProjectSelect(false);
                    }}
                    style={{
                      padding: "7px 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      color: isCur ? "#c4b5fd" : "#c9d1d9",
                      background: isCur
                        ? "rgba(124, 58, 237, 0.15)"
                        : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                    onMouseEnter={(e) => {
                      if (!isCur)
                        e.currentTarget.style.background =
                          "rgba(255, 255, 255, 0.05)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isCur)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                    {isCur && <Check size={12} />}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
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
          <div
            className="flex items-center gap-2 text-xs text-[#8b949e]"
            style={{ padding: "18px 24px" }}
          >
            <Loader2 size={14} className="animate-spin" />
            <span>Scanning project tree...</span>
          </div>
        ) : fileTree.length === 0 ? (
          <div
            className="text-xs text-[#6e7681] text-center"
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
              allCollapsed={allCollapsed}
            />
          ))
        )}
      </div>

      {/* ── Footer / Git Status ──────────────────────────── */}
      <div
        className="flex items-center gap-2 flex-shrink-0"
        style={{
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          fontSize: 11,
          color: "#6e7681",
          fontFamily: "var(--font-mono)",
          padding: "10px 18px",
          background: "rgba(0, 0, 0, 0.2)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#3fb950",
            display: "inline-block",
            flexShrink: 0,
            boxShadow: "0 0 6px rgba(63, 185, 80, 0.5)",
          }}
        />
        <span style={{ color: "#8b949e" }}>main</span>
        <span style={{ color: "#3fb950", marginLeft: "auto" }}>
          ↑ 2 commits
        </span>
      </div>

      {/* ── Sleek Item Delete Modal (File or Folder) ─────── */}
      <AnimatePresence>
        {itemToDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(6px)",
            }}
            onClick={() => setItemToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 380,
                background: "#161b22",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 14,
                boxShadow:
                  "0 0 30px rgba(239, 68, 68, 0.15), 0 12px 36px rgba(0,0,0,0.6)",
                padding: "22px",
                color: "#e6edf3",
                fontFamily: "var(--font-sans)",
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#f87171",
                  }}
                >
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                    Delete {itemToDelete.type === "folder" ? "Folder" : "File"}?
                  </h3>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 12,
                      color: "#8b949e",
                    }}
                  >
                    This action cannot be undone.
                  </p>
                </div>
              </div>

              <div
                style={{
                  background: "rgba(0, 0, 0, 0.3)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: "#f87171",
                  wordBreak: "break-all",
                  marginBottom: 20,
                }}
              >
                {itemToDelete.id || itemToDelete.name}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setItemToDelete(null)}
                  disabled={isDeleting}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#c9d1d9",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleConfirmDeleteItem}
                  disabled={isDeleting}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    background: "#da3633",
                    border: "1px solid rgba(248, 81, 73, 0.5)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 10px rgba(218, 54, 51, 0.4)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {isDeleting && <Loader2 size={13} className="animate-spin" />}
                  {isDeleting ? "Deleting..." : "Delete"}
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Project Delete Modal ─────────────────────────── */}
      <AnimatePresence>
        {projectToDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(6px)",
            }}
            onClick={() => setProjectToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 400,
                background: "#161b22",
                border: "1px solid rgba(248, 81, 73, 0.4)",
                borderRadius: 16,
                boxShadow:
                  "0 0 40px rgba(248, 81, 73, 0.15), 0 8px 32px rgba(0,0,0,0.5)",
                padding: "24px",
                color: "#e6edf3",
                fontFamily: "var(--font-sans)",
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "rgba(248, 81, 73, 0.1)",
                    color: "#f87171",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                    Delete Project
                  </h3>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 12,
                      color: "#8b949e",
                    }}
                  >
                    This action cannot be undone.
                  </p>
                </div>
              </div>

              <p
                style={{
                  fontSize: 13,
                  color: "#c9d1d9",
                  lineHeight: 1.5,
                  marginBottom: 24,
                }}
              >
                Are you sure you want to permanently delete{" "}
                <strong style={{ color: "#fff" }}>
                  {projectToDelete.name}
                </strong>
                ? All associated files, test suites, and job history will be
                removed.
              </p>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProjectToDelete(null)}
                  disabled={isDeleting}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    background: "transparent",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#c9d1d9",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setIsDeleting(true);
                    await onDeleteProject(projectToDelete.id);
                    setIsDeleting(false);
                    setProjectToDelete(null);
                  }}
                  disabled={isDeleting}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    background: "#da3633",
                    border: "1px solid rgba(248, 81, 73, 0.5)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 12px rgba(248, 81, 73, 0.4)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {isDeleting && <Loader2 size={14} className="animate-spin" />}
                  {isDeleting ? "Deleting..." : "Delete Project"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
