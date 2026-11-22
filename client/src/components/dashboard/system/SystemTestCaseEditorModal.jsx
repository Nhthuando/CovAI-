import React, { useEffect, useState } from "react";
import { X, Code2, Save, Loader2, Play, AlertCircle } from "lucide-react";
import {
  getSystemTestCaseDetail,
  addSystemTestCaseApi,
  updateSystemTestCaseApi,
} from "../../../services/systemTest.service.js";

function buildDefaultTemplate(framework = "playwright", title = "completes user flow successfully") {
  const safeTitle = String(title || "completes user flow successfully").replace(/'/g, "\\'");
  if (String(framework).toLowerCase() === "cypress") {
    return `it('${safeTitle}', () => {\n  cy.visit('/');\n  cy.get('body').should('be.visible');\n});\n`;
  }
  return `test('${safeTitle}', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.locator('body')).toBeVisible();\n});\n`;
}

function inferDefaultSpecFile(framework = "playwright", fallbackFile = "") {
  if (fallbackFile) return fallbackFile;
  if (String(framework).toLowerCase() === "cypress") {
    return "cypress/e2e/user-flow.cy.js";
  }
  return "tests/e2e/user-flow.spec.js";
}

export default function SystemTestCaseEditorModal({
  isOpen,
  onClose,
  mode = "edit",
  snapshotId,
  defaultTestFile = "",
  scenario = null,
  framework = "playwright",
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
    const inferredFile = inferDefaultSpecFile(framework, scenario?.testFile || defaultTestFile);
    setTestFile(inferredFile);

    if (mode === "add") {
      setTitle("");
      setCode(buildDefaultTemplate(framework));
      return;
    }

    const tcTitle = scenario?.title || scenario?.testName || "";
    setTitle(tcTitle);

    if (scenario?.code) {
      setCode(scenario.code);
      return;
    }

    const targetFile = scenario?.testFile || inferredFile;
    if (snapshotId && targetFile && tcTitle) {
      let cancelled = false;
      setLoading(true);
      getSystemTestCaseDetail(snapshotId, {
        testFile: targetFile,
        testName: tcTitle,
      })
        .then((res) => {
          if (cancelled) return;
          const data = res?.data || res;
          if (data?.testFile) setTestFile(data.testFile);
          if (data?.code) {
            setCode(data.code);
          } else if (data?.fullContent) {
            setCode(data.fullContent);
          } else {
            setCode(buildDefaultTemplate(framework, tcTitle));
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(
              err.response?.data?.message ||
                err.message ||
                "Could not load system test block from spec file.",
            );
            setCode(buildDefaultTemplate(framework, tcTitle));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setCode(buildDefaultTemplate(framework, tcTitle));
  }, [isOpen, mode, snapshotId, defaultTestFile, scenario, framework]);

  if (!isOpen) return null;

  const handleSave = async (runAfterSave = false) => {
    const cleanFile = testFile.trim();
    const cleanTitle = title.trim();
    const cleanCode = code.trim();

    if (!cleanFile) {
      setError("Spec file path is required.");
      return;
    }
    if (!cleanCode) {
      setError("Test code cannot be empty.");
      return;
    }
    if (mode === "add" && !cleanTitle) {
      setError("Scenario title is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (!runAfterSave && onSaved) {
        onSaved({
          staged: true,
          mode,
          testFile: cleanFile,
          testName: cleanTitle || scenario?.title || scenario?.testName || "Scenario",
          originalTestName: scenario?.title || scenario?.testName || cleanTitle,
          code: cleanCode,
          framework,
          runAfterSave: false,
        });
        onClose();
        return;
      }
      if (mode === "add") {
        const res = await addSystemTestCaseApi(snapshotId, {
          testFile: cleanFile,
          testName: cleanTitle,
          code: cleanCode,
          runner: framework,
        });
        const data = res?.data || res;
        onSaved?.({
          mode: "add",
          testFile: data?.testFile || cleanFile,
          testName: cleanTitle,
          runAfterSave,
        });
      } else {
        const originalTitle = scenario?.title || scenario?.testName || cleanTitle;
        const res = await updateSystemTestCaseApi(snapshotId, {
          testFile: cleanFile,
          testName: originalTitle,
          code: cleanCode,
        });
        const data = res?.data || res;
        onSaved?.({
          mode: "edit",
          testFile: data?.testFile || cleanFile,
          testName: cleanTitle || originalTitle,
          runAfterSave,
        });
      }
      onClose();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to save system test scenario.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 font-sans">
      <div className="w-full max-w-3xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] shrink-0">
              <Code2 size={14} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                {mode === "add" ? "Add System Test Scenario" : "Edit System Test Scenario"}
              </h3>
              <p className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">
                {testFile || "spec file"} · {framework}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
            aria-label="Close scenario editor"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 min-h-0">
          {error && (
            <div className="px-3.5 py-2.5 rounded-md border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                Scenario Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={mode === "edit"}
                placeholder="e.g. creates new item and persists after reload"
                className="w-full px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-65 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                Spec File Path
              </label>
              <input
                type="text"
                value={testFile}
                onChange={(e) => setTestFile(e.target.value)}
                disabled={mode === "edit"}
                placeholder="tests/e2e/feature.spec.js"
                className="w-full px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-65 font-mono"
              />
            </div>
          </div>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                E2E Test Block ({framework === "cypress" ? "Cypress it(...)" : "Playwright test(...)"})
              </label>
              <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                Real browser &amp; API (no page.route mocking)
              </span>
            </div>

            {loading ? (
              <div className="h-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={14} className="animate-spin text-[var(--color-primary)]" />
                <span>Loading test block via AST...</span>
              </div>
            ) : (
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                rows={15}
                className="w-full px-3.5 py-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text)] font-mono leading-relaxed focus:outline-none focus:border-[var(--color-primary)] resize-y min-h-[260px]"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--color-text-muted)]">
            Changes sync immediately to spec file, catalog &amp; version history.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-semibold text-[var(--color-text)] cursor-pointer transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              <span>Save</span>
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold cursor-pointer transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
              <span>Save &amp; Run</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
