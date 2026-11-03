import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchIntegrationReport } from "../services/report.service";
import { ArrowLeft, AlertCircle, Activity } from "lucide-react";
import IntegrationReportEmbed from "../components/dashboard/integration/IntegrationReportEmbed";

export default function IntegrationReportPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchIntegrationReport(projectId);
      setReport(res.data);
    } catch (err) {
      setError(err.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Activity size={32} className="animate-spin text-[var(--color-primary)]" />
          <span className="text-xs font-mono text-[var(--color-text-secondary)]">
            Loading executive integration test report...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] p-8">
        <div className="max-w-4xl mx-auto bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-8 text-center">
          <AlertCircle size={48} className="mx-auto text-[var(--color-danger)] mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Report</h2>
          <p className="text-[var(--color-text-secondary)] mb-6">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] rounded font-medium hover:opacity-90 transition-opacity cursor-pointer text-xs"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6 sm:p-8 overflow-y-auto font-sans print:bg-white print:text-black print:p-0">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="no-print">
          <button
            type="button"
            onClick={() => navigate(`/main-editor?projectId=${projectId}&tab=integration-tests`)}
            className="flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] text-xs font-semibold transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} className="mr-1" /> Back to Integration Workbench
          </button>
        </div>

        <IntegrationReportEmbed
          projectId={projectId}
          snapshotId={report.overview?.snapshotId}
          report={report}
          loading={loading}
          onRefreshReport={loadData}
        />
      </div>
    </div>
  );
}
