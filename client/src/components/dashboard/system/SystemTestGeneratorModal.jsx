import { systemEvidenceRequest } from "../../../services/systemTest.service.js";
import { useProjectAccess } from "../../../hooks/useProjectAccess";
import { useEffect, useState } from "react";
import {
  X,
  Sparkles,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  RotateCcw,
  FileCode2,
  Settings2,
  Clock,
  Zap,
} from "lucide-react";
import Button from "../../common/Button.jsx";
import { generateColdStartSystemTests } from "../../../services/systemTest.service.js";

const DEFAULT_ROUTES = ["/"];

export default function SystemTestGeneratorModal({
  isOpen,
  onClose,
  snapshotId,
  projectId,
  executionMode = "full",
  initialFramework = "playwright",
  onSuccess,
}) {
  const access = useProjectAccess(projectId);
  const [reviewed, setReviewed] = useState(false);
  const [setupApproved, setSetupApproved] = useState(true);
  const [applying, setApplying] = useState(false);
  const [framework, setFramework] = useState(initialFramework);
  const [routes, setRoutes] = useState([]);
  const [newRoute, setNewRoute] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let current = true;
    if (isOpen) {
      systemEvidenceRequest(snapshotId, "generation-drafts/latest")
        .then((data) => {
          if (current && data && data.executionMode === "full") setResult(data);
        })
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [snapshotId, isOpen]);

  if (!isOpen) return null;

  const handleAddRoute = () => {
    const trimmed = newRoute.trim();
    if (!trimmed) return;
    const formatted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (!routes.includes(formatted)) {
      setRoutes([...routes, formatted]);
    }
    setNewRoute("");
  };

  const handleRemoveRoute = (routeToRemove) => {
    setRoutes(routes.filter((r) => r !== routeToRemove));
  };

  const handleToggleDefaultRoute = (route) => {
    if (routes.includes(route)) {
      setRoutes(routes.filter((r) => r !== route));
    } else {
      setRoutes([...routes, route]);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    setReviewed(false);
    setSetupApproved(true);

    try {
      const res = await generateColdStartSystemTests(snapshotId, {
        framework,
        routes,
        executionMode,
      });
      setResult(res.data);
      window.dispatchEvent(new CustomEvent("covai:ai-usage-updated"));
      if (onSuccess) {
        onSuccess(res.data);
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to generate system tests.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      const saved = await systemEvidenceRequest(
        snapshotId,
        `generation-drafts/${result.aiTestId}/apply`,
        {
          method: "POST",
          data: {
            expectedCandidateHash: result.candidateHash,
            reviewed: true,
            approveSharedSetup: setupApproved,
          },
        },
      );
      window.dispatchEvent(new CustomEvent("covai:ai-usage-updated"));
      onSuccess?.(saved);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setApplying(false);
    }
  };

  const hasSetupChanges = !!result?.setupChanges?.length;
  const canApply =
    !!result &&
    !result.stale &&
    reviewed &&
    access.can("evidence.approve") &&
    (!hasSetupChanges || setupApproved);

  const frameworkButtonClass = (name) =>
    `px-4 py-3 rounded-xl border text-sm text-left flex items-center justify-between cursor-pointer transition-all ${
      framework === name
        ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)] font-semibold shadow-xs"
        : "bg-[var(--color-surface-secondary)]/50 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/65 backdrop-blur-xs font-sans">
      <div
        className={`w-full ${
          result ? "max-w-2xl" : "max-w-xl"
        } bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] transition-all`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] shrink-0">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--color-text)] leading-tight">
                {result ? "Generated Test Suite" : "Generate Full Stack Tests"}
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                {result
                  ? "Review scenarios and apply to your workspace"
                  : "Automated E2E tests from your application routes and workflows"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close test generator"
            disabled={generating || applying}
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {error && (
            <div className="p-4 rounded-xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[var(--color-danger)] flex items-start gap-3 text-xs leading-relaxed">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {result ? (
            <div className="space-y-5">
              {result.stale && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  Workspace changed after this draft was generated. Click <strong>Regenerate</strong> before applying.
                </div>
              )}

              {/* Summary Badges */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                    {result.scenarioCount ?? result.scenariosCount ?? 0} scenarios
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                    {result.executionMode === "full" ? "Full Stack" : "Frontend"}
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                    Not runtime verified
                  </span>
                </div>
                <code className="font-mono text-xs text-[var(--color-text-muted)] break-all">
                  {result.filePath}
                </code>
              </div>

              {/* Telemetry row */}
              {result.telemetry && (
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-indigo-400">
                    <Clock size={13} />
                    <span>
                      {result.telemetry.durationSeconds ||
                        (result.telemetry.durationMs / 1000).toFixed(1)}
                      s
                    </span>
                  </div>
                  <span className="opacity-40">•</span>
                  <div className="flex items-center gap-1.5 text-amber-400">
                    <Zap size={13} />
                    <span>
                      {(result.telemetry.tokens?.total || 0).toLocaleString()}{" "}
                      tokens
                    </span>
                  </div>
                  {result.telemetry.tokens?.prompt > 0 && (
                    <span className="text-[10px] text-[var(--color-text-muted)] font-sans ml-auto">
                      ({result.telemetry.tokens.prompt} in /{" "}
                      {result.telemetry.tokens.completion} out)
                    </span>
                  )}
                </div>
              )}

              {/* Scenarios List */}
              {result.scenarios?.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] px-0.5">
                    Scenarios
                  </div>
                  <div className="grid gap-2.5">
                    {result.scenarios.map((row, idx) => (
                      <article
                        key={row.id || row.title}
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/25 px-4 py-3.5 flex items-start gap-3.5 hover:border-[var(--color-border)]/80 transition-colors"
                      >
                        <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-[11px] font-semibold text-[var(--color-text-secondary)] shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-medium text-[var(--color-text)] leading-snug">
                            {row.title}
                          </h4>
                          <p className="mt-1 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                            Input: {[...(row.preconditions || []), ...(row.inputs || [])].join("; ") || "Not specified"}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                            Expected: {(row.expected || []).join("; ") || "Review the code assertions"}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {/* Collapsible Code Preview */}
              <details className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/20 overflow-hidden">
                <summary className="px-4 py-3 cursor-pointer select-none flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors">
                  <span className="inline-flex items-center gap-2">
                    <FileCode2 size={15} className="text-[var(--color-primary)]" />
                    <span>View generated test code</span>
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)] group-open:hidden">
                    Expand
                  </span>
                </summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-[var(--color-border)] bg-[var(--color-bg)] p-4 font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  {result.code}
                </pre>
              </details>

              {/* Collapsible Auto-Configured Setup */}
              {hasSetupChanges && (
                <details className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/20 overflow-hidden">
                  <summary className="px-4 py-3 cursor-pointer select-none flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors">
                    <span className="inline-flex items-center gap-2">
                      <Settings2 size={15} className="text-[var(--color-text-muted)]" />
                      <span>Auto-configured test setup ({result.setupChanges.length} files)</span>
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] group-open:hidden">
                      Expand
                    </span>
                  </summary>
                  <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)] bg-[var(--color-bg)]">
                    {result.setupChanges.map((file) => (
                      <div key={file.path} className="p-3.5 space-y-2">
                        <div className="font-mono text-[11px] font-medium text-[var(--color-text-secondary)]">
                          {file.path}
                        </div>
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-[11px] text-[var(--color-text-muted)]">
                          {file.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Review confirmations */}
              {hasSetupChanges && (
                <label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={setupApproved}
                    onChange={(event) => setSetupApproved(event.target.checked)}
                    className="mt-0.5"
                  />
                  I reviewed shared setup changes. They are not rolled back by test versions.
                </label>
              )}
              <label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                  className="mt-0.5"
                />
                I reviewed the test code, inputs and expected outcomes.
              </label>

              {!access.can("evidence.approve") && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Ask a project owner to approve and apply these tests.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Framework Selector */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2.5">
                  Target Framework
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFramework("playwright")}
                    className={frameworkButtonClass("playwright")}
                  >
                    <span>Playwright</span>
                    {framework === "playwright" && (
                      <Check size={16} className="text-[var(--color-primary)]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFramework("cypress")}
                    className={frameworkButtonClass("cypress")}
                  >
                    <span>Cypress</span>
                    {framework === "cypress" && (
                      <Check size={16} className="text-[var(--color-primary)]" />
                    )}
                  </button>
                </div>
              </div>

              {/* Target Routes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Target Routes
                  </label>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    Default routes recommended
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {DEFAULT_ROUTES.map((route) => {
                    const isSelected = routes.includes(route);
                    return (
                      <button
                        key={route}
                        type="button"
                        onClick={() => handleToggleDefaultRoute(route)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[var(--color-primary)]/15 border-[var(--color-primary)]/50 text-[var(--color-primary)] font-medium"
                            : "bg-[var(--color-surface-secondary)]/40 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        {route}
                      </button>
                    );
                  })}
                </div>

                {routes.length > 0 && (
                  <div className="space-y-1.5 mb-3 max-h-32 overflow-y-auto pr-1">
                    {routes.map((route) => (
                      <div
                        key={route}
                        className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg font-mono text-xs"
                      >
                        <span className="text-[var(--color-text)]">
                          {route}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveRoute(route)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRoute}
                    onChange={(e) => setNewRoute(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddRoute();
                      }
                    }}
                    placeholder="/custom-page or /profile"
                    className="flex-1 h-9 bg-[var(--color-surface-secondary)]/60 border border-[var(--color-border)] rounded-lg px-3 text-xs text-[var(--color-text)] font-mono focus:outline-hidden focus:border-[var(--color-primary)]"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    icon={Plus}
                    onClick={handleAddRoute}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-between gap-3">
          {result ? (
            <>
              <Button
                variant="outline"
                size="md"
                icon={RotateCcw}
                disabled={applying || generating}
                onClick={() => {
                  setResult(null);
                  setReviewed(false);
                  setSetupApproved(true);
                }}
              >
                Regenerate
              </Button>
              <div className="flex items-center gap-2.5">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onClose}
                  disabled={applying}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  className="system-test-primary-action"
                  icon={Check}
                  loading={applying}
                  disabled={!canApply}
                  onClick={handleApply}
                >
                  Apply Test Suite
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-end gap-2.5 w-full">
              <Button
                variant="ghost"
                size="md"
                onClick={onClose}
                disabled={generating}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                className="system-test-primary-action"
                icon={generating ? Loader2 : Sparkles}
                loading={generating}
                disabled={generating}
                onClick={handleGenerate}
              >
                {generating ? "Generating..." : "Generate Test Suite"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}