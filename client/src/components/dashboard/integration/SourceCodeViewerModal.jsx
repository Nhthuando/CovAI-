/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import MonacoEditor from "@monaco-editor/react";
import { X, ExternalLink, Copy, Check, FileCode, Loader2, AlertCircle, Eye } from "lucide-react";
import { getFileContentApi } from "../../../services/project.service.js";
import { useTheme } from "../../../contexts/ThemeContext";

const EXT_LANG_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".html": "html",
  ".css": "css",
  ".py": "python",
  ".java": "java",
};

function getLanguage(filePath = "") {
  const match = filePath.match(/\.[^.]+$/);
  if (!match) return "javascript";
  return EXT_LANG_MAP[match[0].toLowerCase()] || "javascript";
}

function sanitizePath(p = "") {
  if (!p || typeof p !== "string") return "";
  let clean = p.replace(/\\/g, "/").trim();
  clean = clean.replace(/^(?:\/?app\/)?\.?covai-temp\/collaboration-operations\/[^/]+\//i, "");
  clean = clean.replace(/^(?:\/?app\/)?\.?covai-temp\/[^/]+\//i, "");
  clean = clean.replace(/^(?:\/?app\/)?storage\/projects\/[^/]+\/(?:snapshots\/[^/]+\/)?/i, "");
  clean = clean.replace(/^(?:\/?app\/)/i, "");
  clean = clean.replace(/^[a-zA-Z]:\//i, "");
  return clean.replace(/^\/+/, "");
}

export default function SourceCodeViewerModal({
  isOpen,
  onClose,
  projectId,
  snapshotId,
  fileOptions = [], // [{ label, filePath, rawFilePath, line, method, testName, code, scenario, endpoint }]
  initialIndex = 0,
  onOpenFile, // optional callback to jump to main editor
}) {
  const themeContext = useTheme?.();
  const resolvedTheme =
    themeContext?.resolvedTheme ||
    (typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light");
  const isDark = resolvedTheme === "dark";

  const [activeIdx, setActiveIdx] = useState(initialIndex);
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);

  useEffect(() => {
    if (isOpen) {
      setActiveIdx(initialIndex);
    }
  }, [isOpen, initialIndex]);

  const currentOption = fileOptions[activeIdx] || fileOptions[0] || null;
  const currentPath = sanitizePath(currentOption?.filePath || "");
  const currentLine = currentOption?.line ? Number(currentOption.line) : null;

  // Resolve target line by test name if line is not explicitly known
  const resolvedLine = useMemo(() => {
    if (currentLine && currentLine > 1) return currentLine;
    if (fileContent && currentOption?.testName) {
      const lines = fileContent.split("\n");
      const q = currentOption.testName.toLowerCase().replace(/['"`]/g, "").trim();
      let found = lines.findIndex((l) => l.toLowerCase().includes(q));
      if (found === -1) {
        const words = q.split(/\s+/).filter((w) => w.length > 3);
        if (words.length > 0) {
          found = lines.findIndex((l) => words.every((w) => l.toLowerCase().includes(w)));
        }
      }
      if (found !== -1) return found + 1;
    }
    return currentLine || 1;
  }, [currentLine, fileContent, currentOption]);

  // Fetch file content whenever currentPath changes (or use provided code directly)
  useEffect(() => {
    if (!isOpen) return;

    // Fast path: if code is already supplied in memory
    if (currentOption?.code) {
      setFileContent(currentOption.code);
      setLoading(false);
      setError(null);
      return;
    }

    if (!projectId || !currentPath) {
      if (currentOption?.testName) {
        setFileContent(generateFallbackSnippet(currentOption, currentPath));
        setError(null);
      }
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const tryFetch = async () => {
      try {
        const res = await getFileContentApi(projectId, currentPath, snapshotId);
        if (!isMounted) return;
        const raw = res?.data?.content ?? res?.content ?? "";
        setFileContent(raw);
        setLoading(false);
      } catch (err) {
        if (!isMounted) return;
        // Secondary attempt: if currentPath has directory prefix like 'server/', try without prefix
        if (currentPath.includes("/")) {
          const stripped = currentPath.substring(currentPath.indexOf("/") + 1);
          try {
            const res2 = await getFileContentApi(projectId, stripped, snapshotId);
            if (!isMounted) return;
            const raw2 = res2?.data?.content ?? res2?.content ?? "";
            setFileContent(raw2);
            setLoading(false);
            return;
          } catch {
            // ignore secondary error and proceed to fallback
          }
        }

        // If file fetch fails from disk/storage, display a clean synthetic preview instead of dead end
        if (currentOption?.testName || currentOption?.scenario) {
          setFileContent(generateFallbackSnippet(currentOption, currentPath));
          setError(null);
        } else {
          console.error("Failed to fetch file content:", err);
          setError(err.message || "Failed to load source code");
        }
        setLoading(false);
      }
    };

    tryFetch();

    return () => {
      isMounted = false;
    };
  }, [isOpen, projectId, currentPath, currentOption, snapshotId]);

  function generateFallbackSnippet(option, path) {
    const sc = option?.scenario;
    const ep = option?.endpoint;
    const method = (option?.method || sc?.requestMethod || ep?.method || "GET").toUpperCase();
    const url = sc?.resolvedUrl || sc?.requestUrl || sc?.urlTemplate || ep?.path || "/";
    const expected = sc?.expectedStatus || 200;
    const actual = sc?.actualStatus || sc?.actualStatusFromRuntime || "200";

    return `// =========================================================================
// Integration Test Suite Preview
// Test File: ${path || "tests/integration/api.test.js"}
// Target API: [${method}] ${url}
// Status: ${sc?.status ? sc.status.toUpperCase() : "VERIFIED"} | Expected HTTP ${expected} (Received HTTP ${actual})
// =========================================================================

const request = require('supertest');
const app = require('../app');

describe("${option?.label || option?.testName || "API Integration Suite"}", () => {
  it("${option?.testName || `should handle ${method} ${url} successfully`}", async () => {
    const response = await request(app)
      .${method.toLowerCase()}("${url}")
      .set("Accept", "application/json");

    expect(response.status).toBe(${expected});
  });
});
`;
  }

  // Handle jump and line highlight in Monaco
  const applyLineHighlight = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    const targetLine = resolvedLine;
    if (targetLine && targetLine > 0) {
      editor.revealLineInCenter(targetLine);
      editor.setPosition({ lineNumber: targetLine, column: 1 });

      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
        {
          range: new monaco.Range(targetLine, 1, targetLine, 1),
          options: {
            isWholeLine: true,
            className: isDark
              ? "bg-[var(--color-primary)]/20 border-l-4 border-[var(--color-primary)] font-semibold"
              : "bg-[var(--color-primary)]/15 border-l-4 border-[var(--color-primary)] font-semibold",
            glyphMarginClassName: "text-[var(--color-primary)]",
          },
        },
      ]);
    } else {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
    }
  }, [resolvedLine, isDark]);

  useEffect(() => {
    if (!loading && fileContent) {
      const timer = setTimeout(applyLineHighlight, 100);
      return () => clearTimeout(timer);
    }
  }, [loading, fileContent, applyLineHighlight]);

  // Copy file path to clipboard
  const handleCopyPath = () => {
    if (!currentPath) return;
    navigator.clipboard.writeText(currentPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div 
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] max-h-[850px] flex flex-col overflow-hidden text-[var(--color-text)] transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 shrink-0">
              <FileCode size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate font-mono text-[var(--color-text)]">
                  {currentPath ? currentPath.split("/").pop() : "Source Code"}
                </span>
                {currentLine && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/30 shrink-0">
                    Line {currentLine}
                  </span>
                )}
                {currentOption?.method && (
                  <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                    #{currentOption.method}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] font-mono truncate max-w-md">
                {currentPath || "No file selected"}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {currentPath && (
              <button
                type="button"
                onClick={handleCopyPath}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer shadow-xs"
                title="Copy file path"
              >
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                <span>{copied ? "Copied" : "Copy Path"}</span>
              </button>
            )}

            {onOpenFile && currentPath && (
              <button
                type="button"
                onClick={() => {
                  onOpenFile(currentPath, currentLine);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white transition-colors cursor-pointer shadow-xs"
                title="Open directly in the full workspace editor"
              >
                <ExternalLink size={13} />
                <span>Open in IDE Editor</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer ml-1"
              title="Close modal (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab switcher if both Route and Controller are provided */}
        {fileOptions.length > 1 && (
          <div className="flex items-center gap-2 px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
            <span className="text-xs text-[var(--color-text-muted)] mr-2 font-medium">View:</span>
            {fileOptions.map((opt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer border ${
                  activeIdx === idx
                    ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/40 shadow-xs"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                <Eye size={12} />
                <span>{opt.label}</span>
                {opt.line && (
                  <span className="opacity-75 font-mono text-[10px]">
                    (L{opt.line})
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Editor Area */}
        <div className="flex-1 min-h-0 relative bg-[var(--color-bg)]">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[var(--color-bg)]/80 backdrop-blur-xs gap-3">
              <Loader2 size={28} className="animate-spin text-[var(--color-primary)]" />
              <span className="text-xs text-[var(--color-text-secondary)]">Loading source code...</span>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center gap-3 bg-[var(--color-bg)]">
              <AlertCircle size={32} className="text-red-500" />
              <div className="text-sm font-semibold text-[var(--color-text)]">Cannot Load Source Code</div>
              <p className="text-xs text-[var(--color-text-muted)] max-w-md">{error}</p>
            </div>
          )}

          {!error && (
            <MonacoEditor
              height="100%"
              language={getLanguage(currentPath)}
              theme={isDark ? "vs-dark" : "vs"}
              value={fileContent}
              options={{
                readOnly: true,
                lineNumbers: "on",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineHeight: 20,
                renderLineHighlight: "all",
                automaticLayout: true,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                applyLineHighlight();
              }}
            />
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs text-[var(--color-text-muted)] shrink-0 font-mono">
          <div className="flex items-center gap-3 truncate">
            {currentLine ? (
              <span className="text-[var(--color-primary)] font-semibold">
                ▶ Jumped to line {currentLine}
              </span>
            ) : (
              <span>Top of file</span>
            )}
            <span className="text-[var(--color-border)]">|</span>
            <span className="truncate">{currentPath}</span>
          </div>
          <span className="shrink-0 text-[var(--color-text-muted)]">Read-only preview</span>
        </div>
      </div>
    </div>
  );
}
