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
  TestTube,
  RefreshCw,
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
          { id: "app-tsx", name: "App.tsx", type: "file", lang: "react" },
          { id: "navbar-tsx", name: "Navbar.tsx", type: "file", lang: "react" },
          { id: "hero-tsx", name: "Hero.tsx", type: "file", lang: "react" },
        ],
      },
      {
        id: "src-pages",
        name: "pages",
        type: "folder",
        children: [
          {
            id: "dashboard-tsx",
            name: "Dashboard.tsx",
            type: "file",
            lang: "react",
            active: true,
          },
          { id: "login-tsx", name: "Login.tsx", type: "file", lang: "react" },
        ],
      },
      {
        id: "src-services",
        name: "services",
        type: "folder",
        children: [
          { id: "api-ts", name: "api.ts", type: "file", lang: "ts" },
          { id: "auth-ts", name: "auth.ts", type: "file", lang: "ts" },
        ],
      },
      { id: "index-tsx", name: "index.tsx", type: "file", lang: "react" },
      { id: "main-css", name: "index.css", type: "file", lang: "css" },
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
              {
                id: "coverage-svc",
                name: "coverage.service.js",
                type: "file",
                lang: "js",
              },
              {
                id: "ai-svc",
                name: "ai.service.js",
                type: "file",
                lang: "js",
              },
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
      {
        id: "coverage-test",
        name: "coverage.test.js",
        type: "file",
        lang: "test",
      },
      { id: "ai-test", name: "ai.test.js", type: "file", lang: "test" },
    ],
  },
  { id: "pkg-json", name: "package.json", type: "file", lang: "json" },
  { id: "readme-md", name: "README.md", type: "file", lang: "md" },
];

/* ── File icon ──────────────────────────────────────────── */
function FileIcon({ lang }) {
  const map = {
    react: { icon: FileCode2, color: "#61DAFB" },
    ts: { icon: Braces, color: "#3178C6" },
    js: { icon: FileCode2, color: "#F7DF1E" },
    json: { icon: FileJson, color: "#A8FF78" },
    css: { icon: FileText, color: "#38BDF8" },
    md: { icon: FileText, color: "#8b949e" },
    test: { icon: TestTube, color: "#C084FC" },
  };
  const { icon: Icon, color } = map[lang] || { icon: FileText, color: "#8b949e" };
  return <Icon size={14} style={{ color, flexShrink: 0 }} />;
}

/* ── Tree Node ──────────────────────────────────────────── */
function TreeNode({ node, depth = 0, onSelect, activeFileId }) {
  const [open, setOpen] = useState(depth < 1);

  const isFolder = node.type === "folder";
  const isActive = activeFileId === node.id;

  const indent = depth * 14 + 10;

  return (
    <div>
      <motion.div
        whileHover={{ backgroundColor: "rgba(255,255,255,0.05)" }}
        onClick={() =>
          isFolder ? setOpen((o) => !o) : onSelect(node)
        }
        className="flex items-center gap-2 py-1 cursor-pointer rounded-md mx-1.5 text-sm select-none"
        style={{
          paddingLeft: indent,
          background: isActive
            ? "rgba(124,58,237,0.15)"
            : "transparent",
          color: isActive
            ? "var(--primary-light)"
            : "var(--text-secondary)",
          borderLeft: isActive ? "1px solid var(--primary)" : "1px solid transparent",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
        }}
        id={`file-${node.id}`}
      >
        {isFolder ? (
          <>
            {open ? (
              <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            ) : (
              <ChevronRight size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            )}
            {open ? (
              <FolderOpen size={14} style={{ color: "#e3b341", flexShrink: 0 }} />
            ) : (
              <Folder size={14} style={{ color: "#e3b341", flexShrink: 0 }} />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileIcon lang={node.lang} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </motion.div>

      {/* Children */}
      <AnimatePresence initial={false}>
        {isFolder && open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
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

/* ── Sidebar ────────────────────────────────────────────── */
export default function Sidebar({ onOpenFile, activeFileId }) {
  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 256,
        background: "var(--ide-sidebar)",
        borderRight: "1px solid var(--ide-border)",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          borderBottom: "1px solid var(--ide-border)",
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span>Explorer</span>
        <motion.button
          whileHover={{ rotate: 180 }}
          transition={{ duration: 0.4 }}
          className="opacity-50 hover:opacity-100"
          style={{ color: "var(--text-secondary)" }}
          title="Refresh"
        >
          <RefreshCw size={13} />
        </motion.button>
      </div>

      {/* File tree — scrollable */}
      <div className="flex-1 overflow-y-auto py-2" style={{ fontFamily: "var(--font-sans)" }}>
        {/* Project header */}
        <div
          className="flex items-center gap-1.5 px-4 py-2"
          style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          <ChevronDown size={12} />
          <span>TestCovAI</span>
        </div>
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
    </div>
  );
}
