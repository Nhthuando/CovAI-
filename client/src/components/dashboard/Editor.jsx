/* eslint-disable react-hooks/refs */
/* eslint-disable no-unused-vars */
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  BarChart3,
  GitBranch,
  Zap,
  ChevronRight,
  Loader2,
  AlertCircle,
  Save,
  Check,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import { GitPanel } from "./GitPanel";
import {
  getFileContentApi,
  updateFileContentApi,
} from "../../services/project.service";
import { getFileCoverage } from "../../services/coverage.service";

/* ── Token color map (for simple syntax highlighting) ────── */
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

/* ── Simple keyword highlighting ─────────────────────────── */
const JS_KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "default",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "in",
  "of",
  "class",
  "extends",
  "super",
  "this",
  "try",
  "catch",
  "finally",
  "throw",
  "async",
  "await",
  "yield",
  "null",
  "undefined",
  "true",
  "false",
  "void",
  "static",
  "interface",
  "type",
  "enum",
  "implements",
  "abstract",
  "private",
  "public",
  "protected",
  "readonly",
  "declare",
  "module",
  "namespace",
]);

const PYTHON_KEYWORDS = new Set([
  "import",
  "from",
  "def",
  "class",
  "return",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "break",
  "continue",
  "pass",
  "raise",
  "try",
  "except",
  "finally",
  "with",
  "as",
  "lambda",
  "yield",
  "global",
  "nonlocal",
  "True",
  "False",
  "None",
  "and",
  "or",
  "not",
  "in",
  "is",
  "del",
  "assert",
  "async",
  "await",
]);

function getKeywords(lang) {
  if (lang === "javascript" || lang === "typescript") return JS_KEYWORDS;
  if (lang === "python") return PYTHON_KEYWORDS;
  return JS_KEYWORDS; // fallback
}

/* ── Tokenize a single line ──────────────────────────────── */
function tokenizeLine(line, lang) {
  const tokens = [];
  const keywords = getKeywords(lang);
  let i = 0;

  while (i < line.length) {
    // Comments: // or #
    if (
      (line[i] === "/" && line[i + 1] === "/") ||
      (lang === "python" && line[i] === "#")
    ) {
      tokens.push({ type: "comment", value: line.slice(i) });
      break;
    }

    // Multi-line comment start /*
    if (line[i] === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end !== -1) {
        tokens.push({ type: "comment", value: line.slice(i, end + 2) });
        i = end + 2;
      } else {
        tokens.push({ type: "comment", value: line.slice(i) });
        break;
      }
      continue;
    }

    // Strings: single, double, backtick
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j++; // skip escape
        j++;
      }
      tokens.push({ type: "string", value: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // Numbers
    if (
      /\d/.test(line[i]) &&
      (i === 0 || /[\s(,=+\-*/<>:[\]{};!&|^~%?]/.test(line[i - 1]))
    ) {
      let j = i;
      while (j < line.length && /[\d.xXa-fA-FeEnN_]/.test(line[j])) j++;
      tokens.push({ type: "number", value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Words (keywords, identifiers)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        tokens.push({ type: "keyword", value: word });
      } else if (j < line.length && line[j] === "(") {
        tokens.push({ type: "function", value: word });
      } else {
        tokens.push({ type: "plain", value: word });
      }
      i = j;
      continue;
    }

    // JSX/HTML tags
    if (
      line[i] === "<" &&
      i + 1 < line.length &&
      /[a-zA-Z/]/.test(line[i + 1])
    ) {
      let j = i;
      let depth = 0;
      while (j < line.length) {
        if (line[j] === "<") depth++;
        if (line[j] === ">") {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: "tag", value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Operators and punctuation
    tokens.push({ type: "plain", value: line[i] });
    i++;
  }

  return tokens;
}

/* ── Token colors ────────────────────────────────────────── */
const TOKEN_COLORS = {
  keyword: "#c084fc",
  function: "#93c5fd",
  string: "#86efac",
  number: "#fca5a5",
  comment: "#4b5563",
  tag: "#f9a8d4",
  plain: "#e2e8f0",
};

/* ── File Tab ────────────────────────────────────────────── */
function Tab({ tab, isActive, onSelect, onClose }) {
  const [hovered, setHovered] = useState(false);

  const getTabColor = (name) => {
    if (name.endsWith(".tsx") || name.endsWith(".jsx")) return "#61dafb";
    if (name.endsWith(".ts")) return "#3b82f6";
    if (name.endsWith(".js")) return "#fbbf24";
    if (name.endsWith(".css")) return "#38bdf8";
    if (name.endsWith(".py")) return "#3572A5";
    if (name.endsWith(".json")) return "#4ade80";
    return "#8b949e";
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, width: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(tab.id)}
      className="relative flex items-center gap-2 h-full cursor-pointer select-none"
      style={{
        minWidth: 110,
        maxWidth: 180,
        padding: "0 16px",
        background: isActive ? "var(--ide-bg)" : "transparent",
        color: isActive ? "#e6edf3" : "#6e7681",
        borderRight: "1px solid var(--ide-border)",
        fontFamily: "var(--font-sans)",
        fontSize: 12.5,
        transition: "background 0.15s ease",
      }}
      id={`tab-${tab.id}`}
    >
      {isActive && (
        <motion.div
          layoutId="tab-top-indicator"
          className="absolute top-0 left-0 right-0"
          style={{
            height: 1.5,
            background: "#7c3aed",
            boxShadow: "0 0 8px rgba(124,58,237,0.6)",
          }}
        />
      )}
      {tab.unsaved && (
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#a78bfa",
            flexShrink: 0,
          }}
        />
      )}
      <span
        className="truncate"
        style={{ color: isActive ? getTabColor(tab.name) : undefined }}
      >
        {tab.name}
      </span>
      <motion.button
        animate={{ opacity: hovered || isActive ? 1 : 0 }}
        transition={{ duration: 0.1 }}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        whileHover={{ background: "rgba(255,255,255,0.1)" }}
        whileTap={{ scale: 0.85 }}
        className="ml-auto p-0.5 rounded flex-shrink-0"
        style={{ color: "#6e7681", lineHeight: 0 }}
      >
        <X size={12} />
      </motion.button>
    </motion.div>
  );
}

/* ── Editor ─────────────────────────────────────────────── */
export default function Editor({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  fileTree = [],
  isLoadingTree,
  projectId,
  snapshotId,
  coverageType = "unit",
  onOpenFile,
  onRunAnalysis,
  onSuggestTestcase,
}) {
  const [fileContents, setFileContents] = useState({}); // cache: { [fileId]: { content, loading, error } }
  const [complexities, setComplexities] = useState({}); // cache: { [fileId]: { [funcName]: { value, decisionPoints } } }
  const fetchedRef = useRef(new Set()); // track what we've already fetched
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

  // Fetch complexities when active tab changes
  useEffect(() => {
    if (!activeTabId || !projectId || !snapshotId) return;

    const user = localStorage.getItem("user");
    const userToken = user ? JSON.parse(user).token : null;
    const token = localStorage.getItem("token") || userToken;

    fetch(`http://localhost:5000/api/cyclomatic?snapshotId=${snapshotId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })
      .then((res) => res.text())
      .then((text) => {
        try {
          const data = JSON.parse(text);
          const arrayData = Array.isArray(data)
            ? data
            : data.data || data.results || [];

          if (Array.isArray(arrayData)) {
            const newComplexities = {};
            const normalize = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

            arrayData.forEach((item) => {
              const key = normalize(item.filePath);
              if (!newComplexities[key]) newComplexities[key] = {};
              newComplexities[key][item.functionName] = {
                value: item.value,
                decisionPoints:
                  item.decisionPoints !== undefined
                    ? item.decisionPoints
                    : Math.max(0, item.value - 1),
              };
            });
            setComplexities(newComplexities);
          }
        } catch (e) {
          // ignore parsing error
        }
      })
      .catch((err) => console.error("Failed to fetch complexities", err));
  }, [activeTabId, projectId, snapshotId]);

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

  // No files state
  if (!isLoadingTree && fileTree.length === 0) {
    return (
      <motion.div
        className="flex flex-col flex-1 h-full min-w-0 items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ background: "var(--ide-bg)" }}
      >
        <div
          style={{
            color: "#8b949e",
            fontSize: 24,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
          }}
        >
          No files found
        </div>
        <div
          style={{
            color: "#6e7681",
            fontSize: 14,
            marginTop: 8,
            fontFamily: "var(--font-sans)",
          }}
        >
          Please import a project or wait for extraction to complete.
        </div>
      </motion.div>
    );
  }

  // No tabs open
  if (tabs.length === 0) {
    return (
      <motion.div
        className="flex flex-col flex-1 h-full min-w-0 items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ background: "var(--ide-bg)" }}
      >
        <div
          style={{
            color: "#8b949e",
            fontSize: 20,
            fontFamily: "var(--font-sans)",
          }}
        >
          Select a file from the Explorer to view code
        </div>
      </motion.div>
    );
  }

  // Determine language from file extension
  const ext = activeTab ? "." + activeTab.name.split(".").pop() : "";
  const lang = EXT_LANG_MAP[ext.toLowerCase()] || "text";

  // Build breadcrumb from file path
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

  const hasUnsavedChanges =
    currentFile.draft !== undefined &&
    currentFile.draft !== currentFile.content;

  const covPctColor = (pct) =>
    pct >= 80 ? "#22c55e" : pct >= 60 ? "#fbbf24" : "#f87171";

  return (
    <motion.div
      className="flex flex-col flex-1 h-full min-w-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      style={{ background: "var(--ide-bg)" }}
    >
      {/* ── Tab Bar ──────────────────────────────────────── */}
      <div
        className="flex items-end overflow-x-auto flex-shrink-0"
        style={{
          height: 44,
          background: "var(--ide-tabbar)",
          borderBottom: "1px solid var(--ide-border)",
        }}
      >
        <AnimatePresence mode="popLayout">
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={onSelectTab}
              onClose={onCloseTab}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* ── Breadcrumb & Action Bar ────────────────────────── */}
      <div
        className="flex items-center flex-shrink-0 flex-wrap gap-2"
        style={{
          borderBottom: "1px solid var(--ide-border)",
          color: "#484f58",
          fontFamily: "var(--font-sans)",
          background: "var(--ide-bg)",
          fontSize: 12,
          padding: "6px 16px",
        }}
      >
        <div className="flex items-center">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && (
                <ChevronRight
                  size={11}
                  style={{ margin: "0 3px", opacity: 0.4 }}
                />
              )}
              <span
                style={{
                  color: i === breadcrumb.length - 1 ? "#8b949e" : "#484f58",
                }}
              >
                {crumb}
              </span>
            </span>
          ))}
        </div>

        {/* Coverage summary tags and Suggest testcase button */}
        <div className="ml-auto flex items-center gap-3">
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
            className="flex items-center gap-1 rounded px-2 py-1"
            style={{
              color: hasUnsavedChanges ? "#ddd6fe" : "#6e7681",
              background: hasUnsavedChanges
                ? "rgba(124,58,237,0.18)"
                : "transparent",
              cursor: hasUnsavedChanges && !saving ? "pointer" : "default",
            }}
            title="Save file (Ctrl/Cmd + S)"
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : hasUnsavedChanges ? (
              <Save size={13} />
            ) : (
              <Check size={13} />
            )}
            {saving ? "Saving" : hasUnsavedChanges ? "Save" : "Saved"}
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

      {/* ── Code Area ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto relative">
        {showGitPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute top-4 right-4 z-50 w-96"
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
              className="flex flex-col items-center justify-center h-full"
              style={{ gap: 12 }}
            >
              <Loader2
                size={24}
                className="animate-spin"
                style={{ color: "#a78bfa" }}
              />
              <span
                style={{
                  color: "#6e7681",
                  fontSize: 13,
                  fontFamily: "var(--font-sans)",
                }}
              >
                Loading file content...
              </span>
            </motion.div>
          ) : currentFile.error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full"
              style={{ gap: 12 }}
            >
              <AlertCircle size={24} style={{ color: "#f85149" }} />
              <span
                style={{
                  color: "#f85149",
                  fontSize: 13,
                  fontFamily: "var(--font-sans)",
                }}
              >
                {currentFile.error}
              </span>
            </motion.div>
          ) : (
            <MonacoEditor
              key={activeTabId}
              height="100%"
              language={lang}
              theme="vs-dark"
              value={currentFile.draft ?? currentFile.content ?? ""}
              onChange={handleChange}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                editor.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                  () => saveHandlerRef.current?.(),
                );
              }}
              options={{
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                lineHeight: 21,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 8 },
                glyphMargin: true,
                lineNumbersMinChars: 3,
              }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Bottom Info Bar ────────────────────────────────── */}
      <div
        className="flex items-center flex-shrink-0"
        style={{
          gap: 20,
          padding: "8px 20px",
          borderTop: "1px solid var(--ide-border)",
          background:
            "linear-gradient(0deg, rgba(124,58,237,0.04) 0%, transparent 100%)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        <div className="flex items-center gap-1.5">
          <BarChart3 size={12} style={{ color: "#a78bfa" }} />
          <span style={{ color: "#a78bfa", fontWeight: 600 }}>
            {lang.charAt(0).toUpperCase() + lang.slice(1)}
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
        <div
          className="ml-auto flex items-center gap-1.5 cursor-pointer"
          style={{ color: "#484f58" }}
          onClick={() => setShowGitPanel(!showGitPanel)}
        >
          <GitBranch size={11} />
          <span>main</span>
          <Zap size={11} style={{ color: "#fde68a", marginLeft: 6 }} />
          <span style={{ color: "#fde68a" }}>AI Ready</span>
        </div>
      </div>
    </motion.div>
  );
}
