import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { X } from "lucide-react";
import { useTheme } from "../../../contexts/ThemeContext";

export default function IntegrationScenarioEditorModal({
  isOpen,
  onClose,
  onSave,
  initialCode,
  title,
  loading,
}) {
  const [code, setCode] = useState(initialCode || "");
  const { theme } = useTheme();
  const isDark = theme !== "light";

  useEffect(() => {
    if (isOpen) setCode(initialCode || "");
  }, [isOpen, initialCode]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans"
    >
      <div className="w-full max-w-4xl h-[600px] max-h-[90vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-xl flex flex-col overflow-hidden text-[var(--color-text)]">
        {/* Header */}
        <div className="h-14 px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
          <h3
            id="scenario-editor-title"
            className="text-sm font-bold text-[var(--color-text)] tracking-tight"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            title="Close"
            aria-label="Close"
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Editor Area */}
        <div className="flex-1 min-h-0 bg-[var(--color-bg)]">
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme={isDark ? "vs-dark" : "light"}
            value={code}
            onChange={(value) => setCode(value || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              fontFamily: "var(--font-mono)",
            }}
          />
        </div>

        {/* Footer */}
        <div className="h-14 px-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(code)}
            disabled={loading}
            className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {loading ? "Saving..." : "Save Scenario"}
          </button>
        </div>
      </div>
    </div>
  );
}
