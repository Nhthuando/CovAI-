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
} from "lucide-react";

/* ── File tree data ─────────────────────────────────────── */
const FILE_TREE = [
  {
    id: "src",
    name: "src",
    type: "folder",
    children: [
      {
        id: "src-components",
        name: "components",
        type: "folder",
        children: [
          { id: "app-tsx",     name: "App.tsx",     type: "file", lang: "react" },
          { id: "navbar-tsx",  name: "Navbar.tsx",  type: "file", lang: "react" },
          { id: "hero-tsx",    name: "Hero.tsx",    type: "file", lang: "react" },
          { id: "button-tsx",  name: "Button.tsx",  type: "file", lang: "react" },
          { id: "header-tsx",  name: "Header.tsx",  type: "file", lang: "react" },
        ],
      },
      {
        id: "src-pages",
        name: "pages",
        type: "folder",
        children: [
          { id: "dashboard-tsx", name: "Dashboard.tsx", type: "file", lang: "react", active: true },
          { id: "login-tsx",     name: "Login.tsx",     type: "file", lang: "react" },
        ],
      },
      {
        id: "src-services",
        name: "services",
        type: "folder",
        children: [
          { id: "api-ts",  name: "api.ts",  type: "file", lang: "ts" },
          { id: "auth-ts", name: "auth.ts", type: "file", lang: "ts" },
        ],
      },
      { id: "index-tsx", name: "index.tsx",  type: "file", lang: "react" },
      { id: "main-css",  name: "index.css",  type: "file", lang: "css" },
    ],
  },
  {
    id: "server",
    name: "server",
    type: "folder",
    children: [
      {
        id: "server-src",
        name: "src",
        type: "folder",
        children: [
          {
            id: "server-services",
            name: "services",
            type: "folder",
            children: [
              { id: "coverage-svc", name: "coverage.service.js", type: "file", lang: "js" },
              { id: "ai-svc",       name: "ai.service.js",       type: "file", lang: "js" },
            ],
          },
          {
            id: "server-controllers",
            name: "controllers",
            type: "folder",
            children: [
              { id: "coverage-ctrl", name: "coverage.controller.js", type: "file", lang: "js" },
              { id: "job-ctrl",      name: "job.controller.js",      type: "file", lang: "js" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "tests",
    name: "__tests__",
    type: "folder",
    children: [
      { id: "coverage-test", name: "coverage.test.js", type: "file", lang: "test" },
      { id: "ai-test",       name: "ai.test.js",       type: "file", lang: "test" },
    ],
  },
  { id: "pkg-json", name: "package.json", type: "file", lang: "json" },
  { id: "readme-md", name: "README.md",   type: "file", lang: "md" },
];

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

/* ── Tree Node ──────────────────────────────────────────── */
function TreeNode({ node, depth = 0, onSelect, activeFileId }) {
  const [open, setOpen]       = useState(depth < 1);
  const [hovered, setHovered] = useState(false);

  const isFolder = node.type === "folder";
  const isActive = activeFileId === node.id;
    const indent   = depth * 14 + 14;

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
          paddingRight: 12,
          paddingTop: 4,
          paddingBottom: 4,
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
      </motion.div>

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
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────── */
export default function Sidebar({ onOpenFile, activeFileId }) {
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
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 44,
          paddingLeft: 16,
          paddingRight: 12,
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
          >
            <Plus size={14} />
          </motion.button>
          <motion.button
            whileHover={{ rotate: 180 }}
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.35 }}
            className="p-1 rounded"
            style={{ color: "#484f58" }}
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

      {/* Project label */}
      <div
        className="flex items-center gap-1.5 flex-shrink-0"
        style={{
          color: "#484f58",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-sans)",
          borderBottom: "1px solid rgba(255,255,255,0.03)",
          padding: "6px 16px",
        }}
      >
        <ChevronDown size={11} />
        <span>TestCovAI</span>
      </div>

      {/* File tree — scrollable */}
      <div className="flex-1 overflow-y-auto py-1">
        {FILE_TREE.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            onSelect={onOpenFile}
            activeFileId={activeFileId}
          />
        ))}
      </div>

      {/* Footer — branch info */}
      <div
        className="flex items-center gap-2 flex-shrink-0"
        style={{
          borderTop: "1px solid var(--ide-border)",
          fontSize: 11,
          color: "#484f58",
          fontFamily: "var(--font-mono)",
          padding: "8px 16px",
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
    </motion.div>
  );
}
