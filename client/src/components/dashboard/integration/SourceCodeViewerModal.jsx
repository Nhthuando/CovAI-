/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useCallback } from "react";
import MonacoEditor from "@monaco-editor/react";
import { X, ExternalLink, Copy, Check, FileCode, Loader2, AlertCircle, Eye } from "lucide-react";
import { getFileContentApi } from "../../../services/project.service.js";

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

export default function SourceCodeViewerModal({
  isOpen,
  onClose,
  projectId,
  snapshotId,
  fileOptions = [], // [{ label, filePath, line, method }]
  initialIndex = 0,
  onOpenFile, // optional callback to jump to main editor
}) {
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
  const currentPath = currentOption?.filePath || "";
  const currentLine = currentOption?.line ? Number(currentOption.line) : null;

  // Fetch file content whenever currentPath changes
  useEffect(() => {
    if (!isOpen || !projectId || !currentPath) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    getFileContentApi(projectId, currentPath, snapshotId)
      .then((res) => {
        if (!isMounted) return;
        const raw = res?.data?.content ?? res?.content ?? "";
        setFileContent(raw);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to fetch file content:", err);
        setError(err.message || "Failed to load source code");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, projectId, currentPath]);

  // Handle jump and line highlight in Monaco
  const applyLineHighlight = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (currentLine && currentLine > 0) {
      editor.revealLineInCenter(currentLine);
      editor.setPosition({ lineNumber: currentLine, column: 1 });

      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
        {
          range: new monaco.Range(currentLine, 1, currentLine, 1),
          options: {
            isWholeLine: true,
            className: "bg-blue-500/20 border-l-4 border-blue-400 font-semibold",
            glyphMarginClassName: "text-blue-400",
          },
        },
      ]);
    } else {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
    }
  }, [currentLine]);

  useEffect(() => {
    if (!loading && fileContent) {
      // Small timeout to allow Monaco to finish setting content
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div 
        className="bg-[#181a1f] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] max-h-[850px] flex flex-col overflow-hidden text-[#e6edf3]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[#1e2227] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 shrink-0">
              <FileCode size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate font-mono text-white">
                  {currentPath ? currentPath.split("/").pop() : "Source Code"}
                </span>
                {currentLine && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
                    Line {currentLine}
                  </span>
                )}
                {currentOption?.method && (
                  <span className="text-xs text-[var(--color-text-secondary)] font-mono">
                    #{currentOption.method}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--color-text-secondary)] font-mono truncate max-w-md">
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
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-[#282c34] hover:bg-[#323640] text-[var(--color-text-secondary)] hover:text-white transition-colors border border-[var(--color-border)] cursor-pointer"
                title="Copy file path"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white transition-colors cursor-pointer shadow-sm"
                title="Open directly in the full workspace editor"
              >
                <ExternalLink size={13} />
                <span>Open in IDE Editor</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[#323640] text-[var(--color-text-secondary)] hover:text-white transition-colors cursor-pointer ml-1"
              title="Close modal (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab switcher if both Route and Controller are provided */}
        {fileOptions.length > 1 && (
          <div className="flex items-center gap-2 px-5 py-2 border-b border-[var(--color-border)] bg-[#181a1f] shrink-0">
            <span className="text-xs text-[var(--color-text-secondary)] mr-2 font-medium">View:</span>
            {fileOptions.map((opt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer border ${
                  activeIdx === idx
                    ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/40 shadow-xs"
                    : "bg-[#21252b] text-[var(--color-text-secondary)] border-transparent hover:text-white hover:bg-[#282c34]"
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
        <div className="flex-1 min-h-0 relative bg-[#1e1e1e]">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#1e1e1e]/80 backdrop-blur-xs gap-3">
              <Loader2 size={28} className="animate-spin text-[var(--color-primary)]" />
              <span className="text-xs text-[var(--color-text-secondary)]">Loading source code...</span>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center gap-3">
              <AlertCircle size={32} className="text-red-400" />
              <div className="text-sm font-semibold text-white">Cannot Load Source Code</div>
              <p className="text-xs text-[var(--color-text-secondary)] max-w-md">{error}</p>
            </div>
          )}

          {!error && (
            <MonacoEditor
              height="100%"
              language={getLanguage(currentPath)}
              theme="vs-dark"
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
        <div className="px-5 py-2.5 border-t border-[var(--color-border)] bg-[#1e2227] flex items-center justify-between text-xs text-[var(--color-text-secondary)] shrink-0 font-mono">
          <div className="flex items-center gap-3 truncate">
            {currentLine ? (
              <span className="text-blue-400">
                ▶ Jumped to line {currentLine}
              </span>
            ) : (
              <span>Top of file</span>
            )}
            <span className="text-gray-600">|</span>
            <span className="truncate">{currentPath}</span>
          </div>
          <span className="shrink-0 text-gray-500">Read-only preview</span>
        </div>
      </div>
    </div>
  );
}
