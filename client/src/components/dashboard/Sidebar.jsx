import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode2,
  FileJson,
  FileText,
  Braces,
  TestTube2,
  RefreshCw,
  Plus,
  MoreHorizontal,
  Trash2,
  AlertTriangle,
  Loader2,
  FolderPlus,
  Pencil,
} from "lucide-react";

// Removed hardcoded FILE_TREE

/* ── Language icon/color map ─────────────────────────────── */
const LANG_MAP = {
  react: { icon: FileCode2, color: "#61dafb" },
  ts:    { icon: Braces,    color: "#3b82f6" },
  js:    { icon: FileCode2, color: "#fbbf24" },
  json:  { icon: FileJson,  color: "#4ade80" },
  css:   { icon: FileText,  color: "#38bdf8" },
  md:    { icon: FileText,  color: "#94a3b8" },
  test:  { icon: TestTube2, color: "#c084fc" },
};

function FileIcon({ lang }) {
  const cfg = LANG_MAP[lang] || { icon: FileText, color: "#94a3b8" };
  const Icon = cfg.icon;
  return <Icon size={14} style={{ color: cfg.color, flexShrink: 0 }} />;
}

function EntryActionDropdown({ action, setAction, onSubmit }) {
  const isDelete = action.type === "delete";
  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
      onSubmit={onSubmit} className="mx-2 my-1 overflow-hidden rounded-md p-2"
      style={{ background: "#1c2128", border: "1px solid #30363d", boxShadow: "0 8px 20px rgba(0,0,0,.35)" }}
    >
      {isDelete ? (
        <>
          <p className="m-0 mb-2 text-xs" style={{ color: "#e6edf3" }}>Xóa {action.node.type === "folder" ? "thư mục và nội dung" : "file"} <strong>{action.node.name}</strong>?</p>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setAction(null)} className="rounded px-2 py-1 text-xs" style={{ color: "#c9d1d9" }}>Hủy</button><button type="submit" className="rounded px-2 py-1 text-xs" style={{ background: "#da3633", color: "white" }}>Xóa</button></div>
        </>
      ) : (
        <>
          <input autoFocus value={action.value} onChange={(e) => setAction((current) => ({ ...current, value: e.target.value }))}
            placeholder={action.type === "file" ? "new-file.js" : "new-folder"} className="w-full rounded px-2 py-1.5 text-xs outline-none"
            style={{ background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3" }} />
          <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setAction(null)} className="rounded px-2 py-1 text-xs" style={{ color: "#c9d1d9" }}>Hủy</button><button type="submit" disabled={!action.value.trim()} className="rounded px-2 py-1 text-xs" style={{ background: "#7c3aed", color: "white" }}>Xác nhận</button></div>
        </>
      )}
    </motion.form>
  );
}

/* ── Tree Node ──────────────────────────────────────────── */
function TreeNode({ node, depth = 0, onSelect, activeFileId, onCreateFile, onCreateFolder, onRename, onDelete, action, setAction, onSubmitAction }) {
  const [open, setOpen]       = useState(depth < 1);
  const [hovered, setHovered] = useState(false);

  const isFolder = node.type === "folder";
  const isActive = activeFileId === node.id;
  const indent   = depth * 14 + 16;

  return (
    <div>
      <motion.div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => (isFolder ? setOpen((o) => !o) : onSelect(node))}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-2 cursor-pointer select-none relative"
        style={{
          paddingLeft: indent,
          paddingRight: 14,
          paddingTop: 5,
          paddingBottom: 5,
          background: isActive
            ? "rgba(124, 58, 237, 0.12)"
            : hovered
            ? "rgba(255, 255, 255, 0.04)"
            : "transparent",
          borderLeft: isActive
            ? "2px solid #7c3aed"
            : "2px solid transparent",
          color: isActive
            ? "#c4b5fd"
            : hovered
            ? "#e6edf3"
            : "#8b949e",
          fontSize: 13,
          fontFamily: "var(--font-sans)",
          transition: "background 0.1s ease, color 0.1s ease",
        }}
        id={`file-${node.id}`}
      >
        {isFolder ? (
          <>
            <motion.span
              animate={{ rotate: open ? 90 : 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              style={{ display: "flex", flexShrink: 0 }}
            >
              <ChevronRight size={12} style={{ opacity: 0.5 }} />
            </motion.span>
            {open ? (
              <FolderOpen size={14} style={{ color: "#e3b341", flexShrink: 0 }} />
            ) : (
              <Folder size={14} style={{ color: "#e3b341", flexShrink: 0 }} />
            )}
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            <FileIcon lang={node.lang} />
          </>
        )}
        <span className="truncate leading-none">{node.name}</span>
        {hovered && (
          <span className="ml-auto flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {isFolder && <>
              <button title="New file here" onClick={() => onCreateFile(node.id)}><Plus size={12} /></button>
              <button title="New folder here" onClick={() => onCreateFolder(node.id)}><FolderPlus size={12} /></button>
            </>}
            <button title="Rename" onClick={() => onRename(node)}><Pencil size={12} /></button>
            <button title="Delete" onClick={() => onDelete(node)}><Trash2 size={12} /></button>
          </span>
        )}
      </motion.div>

      <AnimatePresence>
        {action && (action.node?.id === node.id || action.parentPath === node.id) && (
          <EntryActionDropdown action={action} setAction={setAction} onSubmit={onSubmitAction} />
        )}
      </AnimatePresence>

      {/* Animated children */}
      <AnimatePresence initial={false}>
        {isFolder && open && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            {node.children?.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                onSelect={onSelect}
                activeFileId={activeFileId}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onRename={onRename}
                onDelete={onDelete}
                action={action}
                setAction={setAction}
                onSubmitAction={onSubmitAction}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────── */
export default function Sidebar({ onOpenFile, activeFileId, fileTree = [], project, projects = [], onChangeProject, onDeleteProject, isLoading, onRefresh, onCreateFile, onCreateFolder, onRenameEntry, onDeleteEntry }) {
  const [showProjectList, setShowProjectList] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [action, setAction] = useState(null);
  const requestNewFile = (parentPath = "") => {
    setAction({ type: "file", parentPath, value: "" });
    return;
    const name = window.prompt("Tên file mới (có thể gồm thư mục con):");
    if (name?.trim()) onCreateFile(parentPath ? `${parentPath}/${name.trim()}` : name.trim());
  };
  const requestNewFolder = (parentPath = "") => {
    setAction({ type: "folder", parentPath, value: "" });
    return;
    const name = window.prompt("Tên thư mục mới (có thể gồm thư mục con):");
    if (name?.trim()) onCreateFolder(parentPath ? `${parentPath}/${name.trim()}` : name.trim());
  };
  const requestRename = (node) => {
    setAction({ type: "rename", node, value: node.name });
    return;
    const newName = window.prompt("Tên hoặc đường dẫn mới:", node.name);
    if (!newName?.trim()) return;
    const parent = node.id.includes("/") ? node.id.slice(0, node.id.lastIndexOf("/")) : "";
    onRenameEntry(node.id, parent ? `${parent}/${newName.trim()}` : newName.trim());
  };
  const requestDelete = (node) => {
    setAction({ type: "delete", node });
    return;
    if (window.confirm(`Xóa ${node.type === "folder" ? "thư mục và toàn bộ nội dung" : "file"} “${node.name}”?`)) onDeleteEntry(node);
  };

  const submitAction = async (event) => {
    event.preventDefault();
    if (!action) return;
    if (action.type === "delete") {
      await onDeleteEntry(action.node);
    } else if (action.type === "rename" && action.value.trim()) {
      const parent = action.node.id.includes("/") ? action.node.id.slice(0, action.node.id.lastIndexOf("/")) : "";
      await onRenameEntry(action.node.id, parent ? `${parent}/${action.value.trim()}` : action.value.trim());
    } else if (action.value.trim()) {
      const targetPath = action.parentPath ? `${action.parentPath}/${action.value.trim()}` : action.value.trim();
      await (action.type === "file" ? onCreateFile(targetPath) : onCreateFolder(targetPath));
    }
    setAction(null);
  };

  return (
    <motion.div
      className="flex flex-col h-full flex-shrink-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      style={{
        width: 260,
        background: "var(--ide-sidebar)",
        borderRight: "1px solid var(--ide-border)",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 46,
          paddingLeft: 24,
          paddingRight: 16,
          borderBottom: "1px solid var(--ide-border)",
        }}
      >
        <span
          style={{
            color: "#6e7681",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "var(--font-sans)",
          }}
        >
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-1 rounded"
            style={{ color: "#484f58" }}
            title="New File"
            onClick={() => requestNewFile()}
          >
            <Plus size={14} />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="p-1 rounded"
            style={{ color: "#484f58" }} title="New Folder" onClick={() => requestNewFolder()}
          >
            <FolderPlus size={14} />
          </motion.button>
          <motion.button
            whileHover={{ rotate: 180 }}
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.35 }}
            onClick={onRefresh}
            className="p-1 rounded"
            style={{ color: "#484f58", cursor: "pointer", background: "transparent", border: "none" }}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-1 rounded"
            style={{ color: "#484f58" }}
            title="More actions"
          >
            <MoreHorizontal size={14} />
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {action && !action.node && !action.parentPath && (
          <motion.form
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            onSubmit={submitAction}
            className="absolute left-2 right-2 z-30 rounded-lg p-3"
            style={{ top: 50, background: "#1c2128", border: "1px solid #30363d", boxShadow: "0 12px 28px rgba(0,0,0,.45)" }}
          >
            {action.type === "delete" ? (
              <>
                <p className="m-0 mb-3 text-xs" style={{ color: "#e6edf3" }}>Xóa {action.node.type === "folder" ? "thư mục và toàn bộ nội dung" : "file"} <strong>{action.node.name}</strong>?</p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setAction(null)} className="rounded px-2 py-1 text-xs" style={{ color: "#c9d1d9" }}>Hủy</button>
                  <button type="submit" className="rounded px-2 py-1 text-xs" style={{ background: "#da3633", color: "white" }}>Xóa</button>
                </div>
              </>
            ) : (
              <>
                <label className="mb-1 block text-xs" style={{ color: "#c9d1d9" }}>
                  {action.type === "rename" ? "Tên mới" : action.type === "file" ? "Tên file mới" : "Tên thư mục mới"}
                </label>
                <input autoFocus value={action.value} onChange={(e) => setAction((current) => ({ ...current, value: e.target.value }))}
                  placeholder={action.type === "file" ? "src/new-file.js" : "components"}
                  className="w-full rounded px-2 py-1.5 text-xs outline-none"
                  style={{ background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3" }} />
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setAction(null)} className="rounded px-2 py-1 text-xs" style={{ color: "#c9d1d9" }}>Hủy</button>
                  <button type="submit" disabled={!action.value.trim()} className="rounded px-2 py-1 text-xs" style={{ background: "#7c3aed", color: "white" }}>Xác nhận</button>
                </div>
              </>
            )}
          </motion.form>
        )}
      </AnimatePresence>

      {/* Project label & Dropdown */}
      <div className="relative">
        <div
          className="flex items-center justify-between flex-shrink-0 cursor-pointer"
          style={{
            color: "#484f58",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontFamily: "var(--font-sans)",
            borderBottom: "1px solid rgba(255,255,255,0.03)",
            padding: "12px 24px",
            background: showProjectList ? "rgba(255,255,255,0.02)" : "transparent",
            transition: "background 0.2s ease"
          }}
          onClick={() => setShowProjectList(!showProjectList)}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <motion.div
              animate={{ rotate: showProjectList ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={11} />
            </motion.div>
            <span className="truncate">{project?.name || "No Project"}</span>
          </div>
        </div>

        {/* Project List Dropdown */}
        <AnimatePresence>
          {showProjectList && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
              style={{
                background: "rgba(13, 17, 23, 0.95)",
                borderBottom: "1px solid var(--ide-border)",
                zIndex: 10
              }}
            >
              {projects.length === 0 ? (
                <div className="px-6 py-3 text-xs text-[#8b949e]">No projects found.</div>
              ) : (
                projects.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between group cursor-pointer"
                    style={{
                      padding: "8px 24px",
                      background: p.id === project?.id ? "rgba(124, 58, 237, 0.1)" : "transparent",
                      borderLeft: p.id === project?.id ? "2px solid #7c3aed" : "2px solid transparent",
                    }}
                    onClick={() => {
                      onChangeProject(p.id);
                      setShowProjectList(false);
                    }}
                  >
                    <span
                      className="truncate text-xs"
                      style={{
                        color: p.id === project?.id ? "#c4b5fd" : "#8b949e",
                        fontFamily: "var(--font-sans)"
                      }}
                    >
                      {p.name}
                    </span>
                    <motion.button
                      whileHover={{ scale: 1.1, color: "#f85149" }}
                      whileTap={{ scale: 0.9 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(p);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded"
                      style={{ color: "#484f58", background: "transparent", border: "none" }}
                      title="Delete Project"
                    >
                      <Trash2 size={12} />
                    </motion.button>
                  </div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* File tree — scrollable */}
      <div className="flex-1 overflow-y-auto" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {isLoading ? (
          <div className="text-xs text-[#8b949e]" style={{ padding: "16px 24px" }}>Loading files...</div>
        ) : (
          fileTree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              onSelect={onOpenFile}
              activeFileId={activeFileId}
              onCreateFile={requestNewFile}
              onCreateFolder={requestNewFolder}
              onRename={requestRename}
              onDelete={requestDelete}
              action={action}
              setAction={setAction}
              onSubmitAction={submitAction}
            />
          ))
        )}
      </div>

      {/* Footer — branch info */}
      <div
        className="flex items-center gap-2 flex-shrink-0"
        style={{
          borderTop: "1px solid var(--ide-border)",
          fontSize: 11,
          color: "#484f58",
          fontFamily: "var(--font-mono)",
          padding: "12px 24px",
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
        <span>main</span>
        <span style={{ color: "#3fb950", marginLeft: "auto" }}>↑ 2 commits</span>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {projectToDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={(e) => {
              e.stopPropagation();
              setProjectToDelete(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="relative overflow-hidden"
              style={{
                width: 400,
                background: "#161b22",
                border: "1px solid rgba(248, 81, 73, 0.4)",
                borderRadius: 16,
                boxShadow: "0 0 40px rgba(248, 81, 73, 0.15), 0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ padding: "24px 24px 16px" }}>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{ width: 40, height: 40, background: "rgba(248, 81, 73, 0.1)", color: "#f85149" }}
                  >
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#e6edf3", fontFamily: "var(--font-sans)" }}>
                      Delete Project
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#8b949e", fontFamily: "var(--font-sans)" }}>
                      This action cannot be undone.
                    </p>
                  </div>
                </div>
                <p style={{ fontSize: 14, color: "#c9d1d9", fontFamily: "var(--font-sans)", lineHeight: 1.5, marginBottom: 24 }}>
                  Are you sure you want to permanently delete <strong style={{ color: "#e6edf3" }}>{projectToDelete.name}</strong>?
                  All associated files, snapshots, and analysis data will be lost.
                </p>
                <div className="flex justify-end gap-3">
                  <motion.button
                    whileHover={!isDeleting ? { backgroundColor: "rgba(255,255,255,0.05)" } : {}}
                    whileTap={!isDeleting ? { scale: 0.95 } : {}}
                    onClick={() => !isDeleting && setProjectToDelete(null)}
                    disabled={isDeleting}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#c9d1d9",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileHover={!isDeleting ? { scale: 1.02 } : {}}
                    whileTap={!isDeleting ? { scale: 0.95 } : {}}
                    onClick={async () => {
                      if (isDeleting) return;
                      setIsDeleting(true);
                      await onDeleteProject(projectToDelete.id);
                      setIsDeleting(false);
                      setProjectToDelete(null);
                      setShowProjectList(false);
                    }}
                    disabled={isDeleting}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      background: isDeleting ? "rgba(218, 54, 51, 0.6)" : "#da3633",
                      border: isDeleting ? "1px solid rgba(248, 81, 73, 0.3)" : "1px solid rgba(248, 81, 73, 0.5)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: isDeleting ? "not-allowed" : "pointer",
                      boxShadow: isDeleting ? "none" : "0 0 12px rgba(248, 81, 73, 0.4)",
                      fontFamily: "var(--font-sans)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {isDeleting ? <Loader2 size={14} className="animate-spin" /> : null}
                    {isDeleting ? "Deleting..." : "Delete Project"}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
