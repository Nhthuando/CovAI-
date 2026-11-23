import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { getFrameworkRecommendationApi, selectTestingFrameworkApi } from "../../services/project.service";

const labelFor = (framework) => (framework === "vitest" ? "Vitest" : "Jest");

export default function FrameworkRecommendationPanel({ projectId, snapshotId, onSelect }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    if (!projectId || !snapshotId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await getFrameworkRecommendationApi(projectId, snapshotId);
      setData(response.data);
      onSelect?.(response.data.selectedTestingFramework);
    } catch (loadError) {
      console.error("Unable to analyze test framework:", loadError);
      setError(loadError.message || "Unable to analyze test framework.");
    } finally {
      setLoading(false);
    }
  }, [projectId, snapshotId, onSelect]);

  useEffect(() => {
    load();
  }, [load]);

  const selectFramework = async (framework) => {
    if (!projectId || !snapshotId || saving || data?.selectedTestingFramework === framework) return;
    setSaving(framework);
    setError("");
    try {
      const response = await selectTestingFrameworkApi(projectId, snapshotId, framework);
      setData(response.data);
      onSelect?.(response.data.selectedTestingFramework);
    } catch (saveError) {
      console.error("Unable to save selected framework:", saveError);
      setError(saveError.message || "Unable to save selected framework.");
    } finally {
      setSaving("");
    }
  };

  if (!projectId || !snapshotId) return null;

  return (
    <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={13} className="text-[var(--color-text-muted)] shrink-0" />
            <span className="text-xs font-semibold text-[var(--color-text)]">
              Test runner framework
            </span>
          </div>
          {data && (
            <span className="text-xs text-[var(--color-text-muted)] font-mono">
              Recommended: <strong className="text-[var(--color-text-secondary)] font-medium">{labelFor(data.recommendedFramework)}</strong>
              {data.projectType ? ` · ${data.projectType}` : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {data && (
            <div className="inline-flex items-center rounded-md bg-[var(--color-bg)] p-0.5 border border-[var(--color-border)]">
              {(data.candidates || []).map((candidate) => {
                const selected = data.selectedTestingFramework === candidate.framework;
                return (
                  <button
                    key={candidate.framework}
                    type="button"
                    onClick={() => selectFramework(candidate.framework)}
                    disabled={Boolean(saving)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer disabled:opacity-50 ${
                      selected
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] font-medium border border-[var(--color-border)]"
                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
                    }`}
                  >
                    {saving === candidate.framework ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      selected && <CheckCircle2 size={11} className="text-emerald-500/75" />
                    )}
                    <span>{labelFor(candidate.framework)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={load}
            disabled={loading || Boolean(saving)}
            title="Re-analyze"
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-rose-300/85 m-0">{error}</p>
      )}
      {loading && !data && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)] m-0">Analyzing project...</p>
      )}
      {data?.selection?.requiresInstallation && (
        <p className="mt-2 text-[11px] text-amber-400/80 m-0">
          The selected framework needs to be installed before running tests.
        </p>
      )}
      {data?.explanation?.[0] && (
        <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)] m-0 leading-relaxed">
          {data.explanation[0]}
        </p>
      )}
    </section>
  );
}
