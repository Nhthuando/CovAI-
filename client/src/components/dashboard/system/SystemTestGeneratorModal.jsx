import { useState } from "react";
import { X, Sparkles, Plus, Trash2, Check, AlertCircle, Loader2 } from "lucide-react";
import Button from "../../common/Button.jsx";
import { generateColdStartSystemTests } from "../../../services/systemTest.service.js";

const DEFAULT_ROUTES = ["/", "/login", "/register", "/dashboard", "/cart"];

export default function SystemTestGeneratorModal({
  isOpen,
  onClose,
  snapshotId,
  initialFramework = "playwright",
  onSuccess,
}) {
  const [framework, setFramework] = useState(initialFramework);
  const [routes, setRoutes] = useState(["/", "/login"]);
  const [newRoute, setNewRoute] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

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
    if (routes.length === 0) {
      setError("Please specify at least one route to generate tests for.");
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await generateColdStartSystemTests(snapshotId, {
        framework,
        routes,
      });
      setResult(res.data);
      if (onSuccess) {
        onSuccess(res.data);
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to generate system tests."
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans">
      <div className="w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Auto-Generate System Tests with AI
              </h3>
              <p className="text-[11px] text-[var(--color-text-secondary)] m-0">
                Cold-start generator for frontend routes & user workflows
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={generating}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[var(--color-danger)] flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {result ? (
            <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 text-[var(--color-text)] space-y-2">
              <div className="flex items-center gap-2 text-[var(--color-success)] font-semibold text-xs">
                <Check size={16} />
                <span>Test Suite Generated Successfully!</span>
              </div>
              <div className="text-[11px] text-[var(--color-text-secondary)]">
                File created:{" "}
                <span className="font-mono text-[var(--color-text)] font-medium">
                  {result.filePath}
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-text-secondary)]">
                Scenarios generated:{" "}
                <span className="font-semibold text-[var(--color-text)]">
                  {result.scenariosCount || 1}
                </span>
              </div>
              <div className="pt-2 flex justify-end">
                <Button variant="primary" size="sm" onClick={onClose}>
                  Done & Refresh
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Framework Selector */}
              <div>
                <label className="block font-medium text-[var(--color-text)] mb-1.5">
                  Target Framework
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFramework("playwright")}
                    className={`px-3 py-2 rounded-[var(--radius-md)] border text-left flex items-center justify-between cursor-pointer transition-colors ${
                      framework === "playwright"
                        ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
                        : "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    <span>Playwright</span>
                    {framework === "playwright" && <Check size={14} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setFramework("cypress")}
                    className={`px-3 py-2 rounded-[var(--radius-md)] border text-left flex items-center justify-between cursor-pointer transition-colors ${
                      framework === "cypress"
                        ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
                        : "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    <span>Cypress</span>
                    {framework === "cypress" && <Check size={14} />}
                  </button>
                </div>
              </div>

              {/* Target Routes */}
              <div>
                <label className="block font-medium text-[var(--color-text)] mb-1.5">
                  Target Routes to Cover
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {DEFAULT_ROUTES.map((route) => {
                    const active = routes.includes(route);
                    return (
                      <button
                        key={route}
                        type="button"
                        onClick={() => handleToggleDefaultRoute(route)}
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${
                          active
                            ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                            : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        {route}
                      </button>
                    );
                  })}
                </div>

                {/* Selected Routes List */}
                <div className="space-y-1.5 max-h-32 overflow-y-auto border border-[var(--color-border)] rounded-[var(--radius-md)] p-2 bg-[var(--color-surface-secondary)]/30">
                  {routes.length === 0 ? (
                    <div className="text-[11px] text-[var(--color-text-muted)] italic text-center py-2">
                      No routes selected. Please add or select at least one route.
                    </div>
                  ) : (
                    routes.map((route) => (
                      <div
                        key={route}
                        className="flex items-center justify-between px-2 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] font-mono text-[11px]"
                      >
                        <span className="text-[var(--color-text)]">{route}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveRoute(route)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors p-0.5"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Custom Route */}
                <div className="flex items-center gap-2 mt-2">
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
                    className="flex-1 bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-[var(--color-text)] font-mono focus:outline-hidden focus:border-[var(--color-primary)]"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Plus}
                    onClick={handleAddRoute}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={generating}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={generating ? Loader2 : Sparkles}
              loading={generating}
              disabled={generating || routes.length === 0}
              onClick={handleGenerate}
            >
              {generating ? "Generating..." : "Generate Test Suite"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

