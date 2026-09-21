/* eslint-disable react-hooks/refs */
/* eslint-disable no-unused-vars */
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import {
  X,
  FileCode2,
  FileJson,
  FileText,
  Braces,
  TestTube2,
  Sliders,
  Box,
  Lock,
  File,
  Loader2,
  AlertCircle,
  Save,
  Check,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Copy,
  WrapText,
  Layers,
  Code2,
  Terminal,
} from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import { GitPanel } from "./GitPanel";
import {
  getFileContentApi,
  updateFileContentApi,
} from "../../services/project.service";
import { getFileCoverage } from "../../services/coverage.service";

/* ── Smart File Icon Resolver ────────────────────────────── */
function getFileIcon(fileName = "") {
  const lower = fileName.toLowerCase();

  // Tests
  if (
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".spec.js") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".spec.jsx") ||
    lower.endsWith(".test.jsx")
  ) {
    return <TestTube2 size={13} style={{ color: "#c084fc", flexShrink: 0 }} />;
  }

  // React & TypeScript
  if (lower.endsWith(".tsx")) {
    return <FileCode2 size={13} style={{ color: "#67e8f9", flexShrink: 0 }} />;
  }
  if (lower.endsWith(".jsx")) {
    return <FileCode2 size={13} style={{ color: "#22d3ee", flexShrink: 0 }} />;
  }
  if (lower.endsWith(".ts")) {
    return <Braces size={13} style={{ color: "#38bdf8", flexShrink: 0 }} />;
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return <FileCode2 size={13} style={{ color: "#fbbf24", flexShrink: 0 }} />;
  }

  // Config files
  if (
    lower.includes(".config.") ||
    lower.startsWith("tsconfig") ||
    lower.startsWith("vite.config") ||
    lower.startsWith("tailwind") ||
    lower.startsWith("eslint")
  ) {
    return <Sliders size={13} style={{ color: "#facc15", flexShrink: 0 }} />;
  }

  // Package & JSON
  if (lower === "package.json" || lower === "package-lock.json") {
    return <Box size={13} style={{ color: "#fb923c", flexShrink: 0 }} />;
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
    return <FileJson size={13} style={{ color: "#4ade80", flexShrink: 0 }} />;
  }

  // Styles
  if (
    lower.endsWith(".css") ||
    lower.endsWith(".scss") ||
    lower.endsWith(".sass") ||
    lower.endsWith(".less")
  ) {
    return <FileText size={13} style={{ color: "#f472b6", flexShrink: 0 }} />;
  }

  // HTML
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return <FileCode2 size={13} style={{ color: "#fb923c", flexShrink: 0 }} />;
  }

  // Markdown & Docs
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".txt")
  ) {
    return <FileText size={13} style={{ color: "#38bdf8", flexShrink: 0 }} />;
  }

  // Git / Env / Lock
  if (
    lower.startsWith(".git") ||
    lower.startsWith(".env") ||
    lower.endsWith(".lock")
  ) {
    return <Lock size={13} style={{ color: "#86efac", flexShrink: 0 }} />;
  }

  return <File size={13} style={{ color: "#94a3b8", flexShrink: 0 }} />;
}

/* ── Extension to Language Mapping ───────────────────────── */
const EXT_LANG_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".css": "css",
  ".html": "html",
  ".md": "markdown",
  ".py": "python",
  ".java": "java",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".xml": "xml",
  ".sh": "shell",
  ".bash": "shell",
  ".txt": "text",
};

export const isTestFile = (filePath) => {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    /(^|\/)(tests?|__tests__|spec|cypress|e2e)\//i.test(normalized) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(normalized)
  );
};

/* ── Tab Component (Reorderable with Drag & Drop) ────────── */
function ReorderableTab({ tab, isActive, onSelect, onClose }) {
  const [hovered, setHovered] = useState(false);
  const icon = getFileIcon(tab.name);

  return (
    <Reorder.Item
      as="div"
      key={tab.id}
      value={tab}
      id={`tab-${tab.id}`}
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6, width: 0 }}
      whileDrag={{
        scale: 1.04,
        zIndex: 50,
        boxShadow:
          "0 8px 24px rgba(0, 0, 0, 0.7), 0 0 12px rgba(124, 58, 237, 0.5)",
        cursor: "grabbing",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(tab.id)}
      className="relative flex items-center gap-2 h-full cursor-grab select-none group flex-shrink-0"
      style={{
        minWidth: 120,
        maxWidth: 200,
        padding: "0 12px",
        background: isActive ? "#0d1117" : "transparent",
        color: isActive ? "#f0f6fc" : "#8b949e",
        borderRight: "1px solid rgba(255, 255, 255, 0.06)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: isActive ? 500 : 400,
        transition: "background 0.15s ease, color 0.15s ease",
      }}
    >
      {/* Active Top Highlight Line */}
      {isActive && (
        <motion.div
          layoutId="tab-top-indicator"
          className="absolute top-0 left-0 right-0"
          style={{
            height: 2,
            background: "linear-gradient(90deg, #7c3aed 0%, #22d3ee 100%)",
            boxShadow: "0 0 10px rgba(124, 58, 237, 0.7)",
          }}
        />
      )}

      {/* File Icon */}
      {icon}

      {/* File Name */}
      <span className="truncate flex-1 min-w-0">{tab.name}</span>

      {/* Unsaved indicator or Close Button */}
      <div
        className="flex items-center justify-center flex-shrink-0 ml-1"
        style={{ width: 16, height: 16 }}
      >
        {tab.unsaved ? (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#a78bfa",
              boxShadow: "0 0 6px #a78bfa",
              display: "inline-block",
            }}
          />
        ) : (
          <motion.button
            animate={{ opacity: hovered || isActive ? 1 : 0 }}
            transition={{ duration: 0.1 }}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            whileHover={{ scale: 1.15, background: "rgba(255,255,255,0.12)" }}
            whileTap={{ scale: 0.9 }}
            className="p-0.5 rounded cursor-pointer flex items-center justify-center"
            style={{
              color: "#8b949e",
              background: "transparent",
              border: "none",
            }}
            title="Close (Ctrl+W)"
          >
            <X size={12} />
          </motion.button>
        )}
      </div>
    </Reorder.Item>
  );
}

/* ── Rich Markdown Previewer ─────────────────────────────── */
function MarkdownPreview({ content }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderLines = () => {
    if (!content)
      return <p className="text-gray-500 italic">No content to preview.</p>;

    const lines = content.split("\n");
    let inCodeBlock = false;
    let codeContent = [];
    let codeLang = "";
    const elements = [];

    lines.forEach((line, idx) => {
      if (line.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
          codeContent = [];
        } else {
          inCodeBlock = false;
          elements.push(
            <div
              key={`code-${idx}`}
              className="my-3 rounded-lg overflow-hidden"
              style={{
                background: "#090d13",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <div
                className="flex items-center justify-between px-3 py-1.5"
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                  fontSize: 11,
                  color: "#8b949e",
                }}
              >
                <span>{codeLang || "text"}</span>
              </div>
              <pre
                className="p-3 text-xs overflow-x-auto m-0"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "#e6edf3",
                  lineHeight: 1.6,
                }}
              >
                <code>{codeContent.join("\n")}</code>
              </pre>
            </div>,
          );
        }
        return;
      }

      if (inCodeBlock) {
        codeContent.push(line);
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        elements.push(<div key={`empty-${idx}`} className="h-2" />);
        return;
      }

      if (trimmed.startsWith("# ")) {
        elements.push(
          <h1
            key={idx}
            className="text-xl font-bold pb-2 mb-3 mt-4"
            style={{
              color: "#f0f6fc",
              borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            {trimmed.slice(2)}
          </h1>,
        );
        return;
      }

      if (trimmed.startsWith("## ")) {
        elements.push(
          <h2
            key={idx}
            className="text-base font-semibold pb-1 mb-2 mt-4"
            style={{
              color: "#e6edf3",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            {trimmed.slice(3)}
          </h2>,
        );
        return;
      }

      if (trimmed.startsWith("### ")) {
        elements.push(
          <h3
            key={idx}
            className="text-sm font-semibold mb-1 mt-3"
            style={{ color: "#c4b5fd" }}
          >
            {trimmed.slice(4)}
          </h3>,
        );
        return;
      }

      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        elements.push(
          <div
            key={idx}
            className="flex items-start gap-2 text-sm text-[#c9d1d9] pl-2 py-0.5"
          >
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "#a78bfa",
                marginTop: 8,
                flexShrink: 0,
              }}
            />
            <span>{trimmed.slice(2)}</span>
          </div>,
        );
        return;
      }

      elements.push(
        <p
          key={idx}
          className="text-sm text-[#c9d1d9] leading-relaxed m-0 py-0.5"
        >
          {line}
        </p>,
      );
    });

    return elements;
  };

  return (
    <div
      className="flex-1 overflow-y-auto p-8 custom-scrollbar"
      style={{
        background: "#0d1117",
        maxWidth: 900,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-cyan-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Markdown Preview
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
        >
          {copied ? (
            <Check size={12} className="text-green-400" />
          ) : (
            <Copy size={12} />
          )}
          <span>{copied ? "Copied" : "Copy Markdown"}</span>
        </button>
      </div>

      <div className="space-y-1">{renderLines()}</div>
    </div>
  );
}

/* ── Main Editor Component ───────────────────────────────── */
export default function Editor({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  fileTree = [],
  isLoadingTree,
  projectId,
  snapshotId,
  coverageType = "unit",
  onOpenFile,
  onRunAnalysis,
  onSuggestTestcase,
}) {
  const [fileContents, setFileContents] = useState({});
  const fetchedRef = useRef(new Set());
  const saveHandlerRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showGitPanel, setShowGitPanel] = useState(false);

  // Coverage state
  const [fileCoverage, setFileCoverage] = useState(null);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);
  const [appliedNotification, setAppliedNotification] = useState(null);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsCollectionRef = useRef(null);

  const isCurrentTestFile = isTestFile(activeTabId);

  // Fetch file coverage when active tab or snapshot changes
  useEffect(() => {
    if (!activeTabId || !snapshotId || isCurrentTestFile) {
      setFileCoverage(null);
      return;
    }

    let isMounted = true;
    setIsLoadingCoverage(true);

    getFileCoverage(snapshotId, activeTabId)
      .then((res) => {
        if (!isMounted) return;
        setFileCoverage(res?.data || null);
      })
      .catch(() => {
        if (!isMounted) return;
        setFileCoverage(null);
      })
      .finally(() => {
        if (isMounted) setIsLoadingCoverage(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTabId, snapshotId, isCurrentTestFile]);

  // Editor View Preferences
  const [wordWrap, setWordWrap] = useState(true);
  const [showMinimap, setShowMinimap] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [copiedCode, setCopiedCode] = useState(false);

  // Fetch file content when active tab changes
  useEffect(() => {
    if (!activeTabId || !projectId) return;

    if (
      fileContents[activeTabId]?.content !== undefined ||
      fileContents[activeTabId]?.loading
    )
      return;
    if (fetchedRef.current.has(activeTabId)) return;

    fetchedRef.current.add(activeTabId);

    setFileContents((prev) => ({
      ...prev,
      [activeTabId]: { content: undefined, loading: true, error: null },
    }));

    getFileContentApi(projectId, activeTabId)
      .then((res) => {
        setFileContents((prev) => ({
          ...prev,
          [activeTabId]: {
            content: res.data.content,
            loading: false,
            error: null,
          },
        }));
      })
      .catch((err) => {
        setFileContents((prev) => ({
          ...prev,
          [activeTabId]: {
            content: undefined,
            loading: false,
            error: err.message || "Failed to load file",
          },
        }));
      });
  }, [activeTabId, projectId, fileContents]);

  const currentFile = fileContents[activeTabId] || {};
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Update Monaco decorations for coverage gutters (✓, ⚑, ×)
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    if (decorationsCollectionRef.current) {
      if (typeof decorationsCollectionRef.current.clear === "function") {
        decorationsCollectionRef.current.clear();
      } else if (Array.isArray(decorationsCollectionRef.current)) {
        editor.deltaDecorations(decorationsCollectionRef.current, []);
        decorationsCollectionRef.current = [];
      }
    }

    if (isCurrentTestFile || !fileCoverage || !fileCoverage.lines) return;

    const decorations = [];
    const lineEntries = Object.entries(fileCoverage.lines);

    for (const [lineStr, info] of lineEntries) {
      const lineNum = Number(lineStr);
      if (isNaN(lineNum) || lineNum < 1) continue;

      let glyphMarginClassName = "";
      let className = "";
      let hoverText = "";

      if (info.status === "failed") {
        glyphMarginClassName = "coverage-glyph-failed";
        className = "coverage-line-failed";
        hoverText = `**× Test Assertion Failed** on line ${lineNum}\n\n${info.error || "Assertion failure in test run"}${info.details ? `\n\n\`\`\`\n${info.details.slice(0, 300)}\n\`\`\`` : ""}`;
      } else if (info.status === "uncovered") {
        glyphMarginClassName = "coverage-glyph-uncovered";
        className = "coverage-line-uncovered";
        hoverText = `**⚑ Uncovered** (Line ${lineNum})\n\n${info.reason || "Not executed by any unit tests"}`;
      } else if (info.status === "covered") {
        glyphMarginClassName = "coverage-glyph-passed";
        hoverText = `**✓ Covered** (Line ${lineNum})\n\nExecuted by tests (${info.hits || 1} hits)`;
      }

      if (glyphMarginClassName) {
        decorations.push({
          range: new monaco.Range(lineNum, 1, lineNum, 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName,
            className: className || undefined,
            glyphMarginHoverMessage: hoverText ? { value: hoverText } : undefined,
          },
        });
      }
    }

    if (typeof editor.createDecorationsCollection === "function") {
      decorationsCollectionRef.current = editor.createDecorationsCollection(decorations);
    } else {
      decorationsCollectionRef.current = editor.deltaDecorations([], decorations);
    }
  }, [fileCoverage, activeTabId, currentFile.content, isCurrentTestFile]);

  // Determine language
  const ext = activeTab ? "." + activeTab.name.split(".").pop() : "";
  const lang = EXT_LANG_MAP[ext.toLowerCase()] || "text";
  const isMarkdown =
    ext.toLowerCase() === ".md" || ext.toLowerCase() === ".markdown";

  // Build breadcrumb
  const breadcrumb = activeTabId ? activeTabId.split("/") : [];

  const handleChange = (value) => {
    setSaveError("");
    setFileContents((prev) => ({
      ...prev,
      [activeTabId]: { ...prev[activeTabId], draft: value ?? "" },
    }));
  };

  const handleSave = async () => {
    const file = fileContents[activeTabId];
    if (
      !projectId ||
      !activeTabId ||
      !file ||
      file.draft === undefined ||
      saving
    )
      return;

    setSaving(true);
    setSaveError("");
    try {
      await updateFileContentApi(projectId, activeTabId, file.draft);
      setFileContents((prev) => ({
        ...prev,
        [activeTabId]: {
          ...prev[activeTabId],
          content: file.draft,
          draft: undefined,
        },
      }));
    } catch (err) {
      setSaveError(err.message || "Could not save file");
    } finally {
      setSaving(false);
    }
  };

  saveHandlerRef.current = handleSave;

  const handleCopyCurrentCode = () => {
    const code = currentFile.draft ?? currentFile.content ?? "";
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const hasUnsavedChanges =
    currentFile.draft !== undefined &&
    currentFile.draft !== currentFile.content;

  const covPctColor = (pct) =>
    pct >= 80 ? "#22c55e" : pct >= 60 ? "#fbbf24" : "#f87171";

  // Configure custom Monaco Theme
  const handleEditorWillMount = (monaco) => {
    monaco.editor.defineTheme("covai-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6e7681", fontStyle: "italic" },
        { token: "keyword", foreground: "c084fc", fontStyle: "bold" },
        { token: "identifier", foreground: "e6edf3" },
        { token: "string", foreground: "7ee787" },
        { token: "number", foreground: "fca5a5" },
        { token: "type", foreground: "67e8f9" },
        { token: "function", foreground: "93c5fd" },
        { token: "delimiter", foreground: "8b949e" },
      ],
      colors: {
        "editor.background": "#0d1117",
        "editor.foreground": "#e6edf3",
        "editor.lineHighlightBackground": "#161b2280",
        "editor.lineHighlightBorder": "#00000000",
        "editorCursor.foreground": "#a78bfa",
        "editorWhitespace.foreground": "#21262d",
        "editorIndentGuide.background": "#21262d",
        "editorIndentGuide.activeBackground": "#7c3aed60",
        "editorLineNumber.foreground": "#484f58",
        "editorLineNumber.activeForeground": "#c4b5fd",
        "scrollbarSlider.background": "#7c3aed20",
        "scrollbarSlider.hoverBackground": "#7c3aed50",
        "scrollbarSlider.activeBackground": "#7c3aed80",
        "editor.selectionBackground": "#7c3aed35",
        "editor.inactiveSelectionBackground": "#7c3aed20",
      },
    });
  };

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Save shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      saveHandlerRef.current?.(),
    );

    // Track cursor position
    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({
        line: e.position.lineNumber,
        col: e.position.column,
      });
    });
  };

  // Empty state: No files found in workspace
  if (!isLoadingTree && fileTree.length === 0) {
    return (
      <motion.div
        className="flex flex-col flex-1 h-full min-w-0 items-center justify-center p-6 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ background: "#0d1117" }}
      >
        <div
          className="flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
          style={{
            background: "rgba(124, 58, 237, 0.1)",
            border: "1px solid rgba(124, 58, 237, 0.25)",
            boxShadow: "0 0 20px rgba(124, 58, 237, 0.2)",
          }}
        >
          <Code2 size={26} className="text-purple-400" />
        </div>
        <div style={{ color: "#f0f6fc", fontSize: 18, fontWeight: 600 }}>
          No workspace files detected
        </div>
        <div
          style={{
            color: "#8b949e",
            fontSize: 13,
            marginTop: 6,
            maxWidth: 360,
          }}
        >
          Import your repository or wait for the source code extraction process
          to complete.
        </div>
      </motion.div>
    );
  }

  // Empty state: No tabs open
  if (tabs.length === 0) {
    return (
      <motion.div
        className="flex flex-col flex-1 h-full min-w-0 items-center justify-center p-6 text-center select-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ background: "#0d1117" }}
      >
        <div
          className="flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
          style={{
            background:
              "linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(34, 211, 238, 0.1))",
            border: "1px solid rgba(124, 58, 237, 0.3)",
            boxShadow: "0 0 24px rgba(124, 58, 237, 0.25)",
          }}
        >
          <Sparkles size={28} style={{ color: "#a78bfa" }} />
        </div>

        <div style={{ color: "#f0f6fc", fontSize: 18, fontWeight: 600 }}>
          Welcome to TestCovAI Editor
        </div>
        <div
          style={{
            color: "#8b949e",
            fontSize: 13,
            marginTop: 6,
            maxWidth: 380,
            lineHeight: 1.6,
          }}
        >
          Select a file from the explorer on the left to start viewing, editing,
          or generating comprehensive tests.
        </div>

        {/* Shortcut Hints */}
        <div className="flex items-center gap-4 mt-6 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[11px] text-purple-300">
              Ctrl + S
            </kbd>
            <span>Save file</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[11px] text-cyan-300">
              Alt + Z
            </kbd>
            <span>Toggle wrap</span>
          </div>
        </div>
      </motion.div>
    );
  }

  const codeContent = currentFile.draft ?? currentFile.content ?? "";
  const totalLines = codeContent ? codeContent.split("\n").length : 0;

  return (
    <motion.div
      className="flex flex-col flex-1 h-full min-w-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ background: "#0d1117" }}
    >
      {/* ── Tab Bar ──────────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 38,
          background: "#161b22",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        {/* Left: Drag & Drop Reorderable Tabs */}
        <Reorder.Group
          as="div"
          axis="x"
          values={tabs}
          onReorder={(newTabs) => {
            if (onReorderTabs) {
              onReorderTabs(newTabs);
            }
          }}
          className="flex items-center h-full overflow-x-auto flex-1 min-w-0 custom-scrollbar"
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          <AnimatePresence mode="popLayout">
            {tabs.map((tab) => (
              <ReorderableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onSelect={onSelectTab}
                onClose={onCloseTab}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center gap-1 px-3 flex-shrink-0">
          {/* Markdown Preview Toggle */}
          {isMarkdown && (
            <button
              onClick={() => setPreviewMode(!previewMode)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer"
              style={{
                color: previewMode ? "#67e8f9" : "#8b949e",
                background: previewMode
                  ? "rgba(34, 211, 238, 0.15)"
                  : "transparent",
                border: previewMode
                  ? "1px solid rgba(34, 211, 238, 0.3)"
                  : "1px solid transparent",
              }}
              title={
                previewMode
                  ? "Switch to Code View"
                  : "Switch to Markdown Preview"
              }
            >
              {previewMode ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>{previewMode ? "Code" : "Preview"}</span>
            </button>
          )}

          {/* Word Wrap Toggle */}
          {!previewMode && (
            <button
              onClick={() => setWordWrap(!wordWrap)}
              className="flex items-center gap-1 p-1.5 rounded text-xs transition-colors cursor-pointer"
              style={{
                color: wordWrap ? "#a78bfa" : "#8b949e",
                background: wordWrap
                  ? "rgba(124, 58, 237, 0.12)"
                  : "transparent",
              }}
              title={`Word Wrap: ${wordWrap ? "ON" : "OFF"} (Alt+Z)`}
            >
              <WrapText size={14} />
            </button>
          )}

          {/* Copy Code */}
          <button
            onClick={handleCopyCurrentCode}
            className="flex items-center gap-1 p-1.5 rounded text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title="Copy all code"
          >
            {copiedCode ? (
              <Check size={14} className="text-green-400" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      </div>

      {/* ── Breadcrumb & Action Header ────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          minHeight: 32,
          padding: "4px 16px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          background: "rgba(13, 17, 23, 0.6)",
          fontSize: 12,
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Left: Path Segments */}
        <div className="flex items-center gap-1 overflow-hidden truncate">
          {getFileIcon(activeTab?.name)}
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && (
                <ChevronRight
                  size={11}
                  style={{ margin: "0 2px", color: "#484f58" }}
                />
              )}
              <span
                style={{
                  color: i === breadcrumb.length - 1 ? "#f0f6fc" : "#8b949e",
                  fontWeight: i === breadcrumb.length - 1 ? 500 : 400,
                }}
              >
                {crumb}
              </span>
            </span>
          ))}
        </div>

        {/* Right: Coverage summary tags, Suggest testcase & Save Status */}
        <div className="flex items-center gap-2.5">
          {!isCurrentTestFile && fileCoverage?.summary && (
            <div
              className="flex items-center gap-2 text-xs"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <span
                className="px-2 py-0.5 rounded"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: covPctColor(fileCoverage.summary.linesPct),
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                title="Line Coverage"
              >
                Lines: {fileCoverage.summary.linesPct}%
              </span>
              <span
                className="px-2 py-0.5 rounded"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: covPctColor(fileCoverage.summary.branchesPct),
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                title="Branch Coverage"
              >
                Branches: {fileCoverage.summary.branchesPct}%
              </span>
              <span
                className="px-2 py-0.5 rounded"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: covPctColor(fileCoverage.summary.stmtsPct),
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                title="Statement Coverage"
              >
                Stmts: {fileCoverage.summary.stmtsPct}%
              </span>
            </div>
          )}

          {snapshotId && !isCurrentTestFile && (
            <button
              type="button"
              onClick={() => onSuggestTestcase?.(activeTabId)}
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold"
              style={{
                background: "rgba(168, 85, 247, 0.15)",
                color: "#c084fc",
                border: "1px solid rgba(168, 85, 247, 0.35)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Yêu cầu AI Agent gợi ý testcase Jest/Vitest trong chat"
            >
              <Sparkles size={12} style={{ color: "#c084fc" }} />
              <span>Suggest testcase</span>
            </button>
          )}
          {saveError && (
            <span style={{ color: "#f85149", fontSize: 11 }}>{saveError}</span>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!hasUnsavedChanges || saving}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all"
            style={{
              color: hasUnsavedChanges ? "#fff" : "#8b949e",
              background: hasUnsavedChanges
                ? "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)"
                : "rgba(255, 255, 255, 0.04)",
              border: hasUnsavedChanges
                ? "none"
                : "1px solid rgba(255, 255, 255, 0.06)",
              boxShadow: hasUnsavedChanges
                ? "0 0 10px rgba(124, 58, 237, 0.4)"
                : "none",
              cursor: hasUnsavedChanges && !saving ? "pointer" : "default",
            }}
            title="Save changes (Ctrl/Cmd + S)"
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin text-purple-300" />
            ) : hasUnsavedChanges ? (
              <Save size={12} />
            ) : (
              <Check size={12} style={{ color: "#4ade80" }} />
            )}
            <span>
              {saving ? "Saving..." : hasUnsavedChanges ? "Save" : "Saved"}
            </span>
          </button>
        </div>
      </div>

      {/* ── Applied Notification Banner ─────────────────────── */}
      {appliedNotification && (
        <div
          className="flex items-center justify-between px-4 py-2 text-xs flex-shrink-0"
          style={{
            background: "rgba(124, 58, 237, 0.15)",
            borderBottom: "1px solid rgba(124, 58, 237, 0.3)",
            color: "#e9d5ff",
          }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2
              size={15}
              style={{ color: "#34d399", flexShrink: 0 }}
            />
            <span>
              Đã áp dụng testcase vào file{" "}
              <strong style={{ color: "#ffffff" }}>
                {appliedNotification.targetTestFile}
              </strong>
              . Hãy xem lại mã dự thảo và bấm <strong>Run Analysis</strong> để
              xác nhận test vượt qua và độ bao phủ tăng.
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onRunAnalysis && (
              <button
                type="button"
                onClick={() => {
                  setAppliedNotification(null);
                  onRunAnalysis();
                }}
                className="px-3 py-1 rounded font-semibold text-xs transition-colors"
                style={{
                  background: "#7c3aed",
                  color: "#ffffff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Run Analysis
              </button>
            )}
            <button
              type="button"
              onClick={() => setAppliedNotification(null)}
              className="p-1 rounded hover:bg-white/10"
              style={{
                color: "#a78bfa",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Code Editor Body ──────────────────────────────── */}
      <div
        className="flex-1 overflow-hidden relative"
        style={{ background: "#0d1117" }}
      >
        {showGitPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute top-4 right-4 z-50 w-96 shadow-2xl"
          >
            <GitPanel projectId={projectId} />
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {currentFile.loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full gap-3"
            >
              <Loader2 size={28} className="animate-spin text-purple-400" />
              <span className="text-xs text-[#8b949e] font-sans">
                Reading file content...
              </span>
            </motion.div>
          ) : currentFile.error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full gap-3"
            >
              <AlertCircle size={28} className="text-red-400" />
              <span className="text-xs text-red-400 font-sans">
                {currentFile.error}
              </span>
            </motion.div>
          ) : previewMode && isMarkdown ? (
            <MarkdownPreview key="md-preview" content={codeContent} />
          ) : (
            <MonacoEditor
              key={activeTabId}
              height="100%"
              language={lang}
              theme="covai-dark"
              value={codeContent}
              onChange={handleChange}
              beforeMount={handleEditorWillMount}
              onMount={handleEditorDidMount}
              options={{
                fontSize: 13.5,
                fontFamily: "var(--font-mono), monospace",
                lineHeight: 22,
                minimap: { enabled: showMinimap },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: wordWrap ? "on" : "off",
                wrappingStrategy: "advanced",
                smoothScrolling: true,
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                bracketPairColorization: { enabled: true },
                guides: {
                  bracketPairs: true,
                  indentation: true,
                },
                renderLineHighlight: "all",
                renderWhitespace: "selection",
                padding: { top: 10, bottom: 10 },
                glyphMargin: true,
                lineNumbersMinChars: 3,
                scrollbar: {
                  vertical: "visible",
                  horizontal: "visible",
                  verticalScrollbarSize: 7,
                  horizontalScrollbarSize: 7,
                  useShadows: false,
                },
              }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Editor Status Strip ────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0 select-none"
        style={{
          height: 24,
          padding: "0 14px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          background: "#090d13",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "#8b949e",
        }}
      >
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-[#c4b5fd]">
            <Code2 size={11} />
            <span>{lang.charAt(0).toUpperCase() + lang.slice(1)}</span>
          </span>
          <span>{totalLines} lines</span>
          <span>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
        </div>
        {!isCurrentTestFile && fileCoverage?.summary && (
          <span style={{ color: "#8b949e", fontSize: 11 }}>
            Coverage: {fileCoverage.summary.linesPct}% (
            {fileCoverage.coveredLines?.length || 0} covered,{" "}
            {fileCoverage.uncoveredLines?.length || 0} uncovered
            {fileCoverage.failedLines?.length
              ? `, ${fileCoverage.failedLines.length} failed`
              : ""}
            )
          </span>
        )}

        <div className="flex items-center gap-3">
          <span>UTF-8</span>
          <span>Spaces: 2</span>
        </div>
      </div>
    </motion.div>
  );
}
