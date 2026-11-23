import React, { useEffect, useState } from "react";
import { X, Code2, Save, Loader2, Play, Sparkles, AlertCircle } from "lucide-react";
import {
  getUnitTestCaseDetail,
  addUnitTestCaseApi,
  updateUnitTestCaseApi,
} from "../../../services/coverage.service.js";

const DEFAULT_TEMPLATE = `it('handles valid input correctly', () => {\n  // Arrange\n  const input = {};\n\n  // Act & Assert\n  expect(input).toBeDefined();\n});\n`;

export default function UnitTestCaseEditorModal({
  isOpen,
  onClose,
  mode = "edit",
  snapshotId,
  sourceFile = "",
  testCase = null,
  framework = "jest",
  onSaved,
}) {
  const [title, setTitle] = useState("");
  const [testFile, setTestFile] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    const inferredDefaultFile = (() => {
      if (testCase?.testFile) return testCase.testFile;
      const cleanSrc = String(sourceFile || "src/module.js").replace(/\\/g, "/").replace(/^\/+/, "");
      const ext = cleanSrc.match(/\.[cm]?[jt]sx?$/i)?.[0] || ".js";
      const base = cleanSrc.split("/").pop()?.replace(/\.[cm]?[jt]sx?$/i, "") || "unit";
      const sub = ["server", "backend", "api", "client"].includes(cleanSrc.split("/")[0])
        ? `${cleanSrc.split("/")[0]}/tests/unit`
        : "tests/unit";
      return `${sub}/${base}.test${ext}`;
    })();

    setTestFile(inferredDefaultFile);

    if (mode === "add") {
      setTitle("");
      setCode(DEFAULT_TEMPLATE);
      return;
    }

    const tcTitle = testCase?.title || testCase?.testName || "";
    setTitle(tcTitle);

    if (testCase?.code) {
      setCode(testCase.code);
      return;
    }

    if (snapshotId && (testCase?.testFile || inferredDefaultFile)) {
      let cancelled = false;
      setLoading(true);
      getUnitTestCaseDetail(snapshotId, {
        testFile: testCase?.testFile || inferredDefaultFile,
        testName: tcTitle,
      })
        .then((res) => {
          if (cancelled) return;
          const detail = res?.data || res;
          setCode(detail?.code || detail?.fullContent || DEFAULT_TEMPLATE);
          if (detail?.testFile) setTestFile(detail.testFile);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err.message || "Could not load test block from file.");
            setCode(DEFAULT_TEMPLATE);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    } else {
      setCode(DEFAULT_TEMPLATE);
    }
  }, [isOpen, mode, snapshotId, sourceFile, testCase]);

  if (!isOpen) return null;

  const handleSave = async (andRun = false) => {
    setError("");
    if (!code.trim()) {
      setError("Test code cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      if (!andRun && onSaved) {
        await onSaved(
          {
            staged: true,
            mode,
            sourceFile,
            testFile,
            testName: title.trim() || undefined,
            originalTestName: testCase?.title || testCase?.testName || title.trim(),
            code,
            framework,
          },
          {
            staged: true,
            andRun: false,
            testFile,
            testName: title.trim() || testCase?.title || "",
          },
        );
        onClose();
        return;
      }
      let result;
      if (mode === "add") {
        result = await addUnitTestCaseApi(snapshotId, {
          sourceFile,
          testFile,
          testName: title.trim() || undefined,
          code,
          framework,
        });
      } else {
        result = await updateUnitTestCaseApi(snapshotId, {
          sourceFile,
          testFile,
          testName: testCase?.title || testCase?.testName || title.trim(),
          code,
        });
      }
      if (onSaved) {
        await onSaved(result?.data || result, {
          andRun,
          testFile: result?.data?.testFile || testFile,
          testName: title.trim() || testCase?.title || "",
        });
      }
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save unit test case.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 font-sans">
      <div className="w-full max-w-3xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] shrink-0">
              <Code2 size={15} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold m-0 truncate">
                {mode === "add" ? "Add Unit Test Case" : "Edit Unit Test Case"}
              </h3>
              <p className="text-[11px] text-[var(--color-text-muted)] font-mono truncate m-0">
                {sourceFile || testFile}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/25 text-xs text-rose-400 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                Target Test File
              </label>
              <input
                type="text"
                value={testFile}
                onChange={(e) => setTestFile(e.target.value)}
                disabled={mode === "edit"}
                className="w-full px-3 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                placeholder="tests/unit/example.test.js"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                Test Case Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-1.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                placeholder="returns expected value on valid input"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                {framework.toUpperCase()} Test Block Code
              </label>
              <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                AST syntax verified + auto-versioned on save
              </span>
            </div>
            {loading ? (
              <div className="h-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading test block from disk...</span>
              </div>
            ) : (
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                rows={13}
                spellCheck={false}
                className="w-full p-3 rounded-md bg-[#0B0F14] border border-[var(--color-border)] text-xs font-mono leading-relaxed text-[#E2E8F0] focus:outline-none focus:border-[var(--color-primary)] resize-y"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text-secondary)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-semibold text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            <span>Save Changes</span>
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
            <span>Save & Run Test</span>
          </button>
        </div>
      </div>
    </div>
  );
}
