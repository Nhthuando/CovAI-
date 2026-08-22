import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { getFrameworkRecommendationApi, selectTestingFrameworkApi } from "../../services/project.service";

const labelFor = (framework) => framework === "vitest" ? "Vitest" : "Jest";

export default function FrameworkRecommendationPanel({ projectId, snapshotId }) {
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
    } catch (loadError) {
      setError(loadError.message || "Không thể phân tích test framework.");
    } finally {
      setLoading(false);
    }
  }, [projectId, snapshotId]);

  useEffect(() => { load(); }, [load]);

  const selectFramework = async (framework) => {
    if (!projectId || !snapshotId || saving) return;
    setSaving(framework);
    setError("");
    try {
      const response = await selectTestingFrameworkApi(projectId, snapshotId, framework);
      setData(response.data);
    } catch (saveError) {
      setError(saveError.message || "Không thể lưu framework đã chọn.");
    } finally {
      setSaving("");
    }
  };

  if (!projectId || !snapshotId) return null;

  return (
    <section
      className="rounded-xl"
      style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.18)", padding: 12 }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: "#a78bfa" }} />
          <span style={{ color: "#e6edf3", fontSize: 12, fontWeight: 600 }}>Test framework</span>
        </div>
        <button onClick={load} disabled={loading || Boolean(saving)} title="Phân tích lại" style={{ color: "#8b949e" }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {error && <p style={{ color: "#f87171", fontSize: 11, lineHeight: 1.45, marginTop: 8 }}>{error}</p>}
      {loading && !data && <p style={{ color: "#8b949e", fontSize: 11, marginTop: 8 }}>Đang phân tích dự án…</p>}

      {data && (
        <>
          <p style={{ color: "#8b949e", fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            Đề xuất: <strong style={{ color: "#c4b5fd" }}>{labelFor(data.recommendedFramework)}</strong> · {data.projectType}
          </p>
          <div className="flex gap-2" style={{ marginTop: 10 }}>
            {(data.candidates || []).map((candidate) => {
              const selected = data.selectedTestingFramework === candidate.framework;
              return (
                <button
                  key={candidate.framework}
                  onClick={() => selectFramework(candidate.framework)}
                  disabled={Boolean(saving)}
                  className="flex-1 rounded-lg transition-colors"
                  style={{
                    padding: "7px 8px",
                    border: `1px solid ${selected ? "rgba(74,222,128,0.6)" : "rgba(255,255,255,0.1)"}`,
                    background: selected ? "rgba(63,185,80,0.12)" : "rgba(255,255,255,0.03)",
                    color: selected ? "#86efac" : "#c9d1d9",
                    fontSize: 11,
                  }}
                >
                  <span className="flex items-center justify-center gap-1">
                    {saving === candidate.framework ? <Loader2 size={12} className="animate-spin" /> : selected && <CheckCircle2 size={12} />}
                    {labelFor(candidate.framework)}
                  </span>
                </button>
              );
            })}
          </div>
          {data.selection?.requiresInstallation && (
            <p style={{ color: "#fbbf24", fontSize: 10, lineHeight: 1.45, marginTop: 8 }}>
              Cần cài framework đã chọn trước khi chạy test.
            </p>
          )}
          {data.explanation?.[0] && <p style={{ color: "#6e7681", fontSize: 10, lineHeight: 1.45, marginTop: 8 }}>{data.explanation[0]}</p>}
        </>
      )}
    </section>
  );
}
