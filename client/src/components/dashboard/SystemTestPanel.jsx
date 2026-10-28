import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { getSystemTestFrameworks } from "../../services/systemTest.service";

export default function SystemTestPanel({ projectId, snapshotId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadFrameworks = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getSystemTestFrameworks(projectId, snapshotId);
        setData(response.data);
      } catch (err) {
        setError(err.message || "Failed to detect system test frameworks");
      } finally {
        setLoading(false);
      }
    };

    if (projectId) {
      loadFrameworks();
    }
  }, [projectId, snapshotId]);

  if (loading) {
    return (
      <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] font-sans">
        <div className="flex items-center gap-2">
          <Loader2
            size={14}
            className="animate-spin text-[var(--color-primary)]"
          />
          <span className="text-xs text-[var(--color-text-secondary)]">
            Detecting system test frameworks...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-danger)] font-sans">
        <div className="flex items-center gap-2 text-[var(--color-danger)] text-xs">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (
    !data ||
    !data.frameworks ||
    data.frameworks.length === 0 ||
    !data.hasSystemTests
  ) {
    return (
      <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] font-sans">
        <div className="mb-2">
          <span className="text-xs font-semibold text-[var(--color-text)]">
            System Tests
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed m-0">
          No supported System Test framework detected.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] font-sans text-[var(--color-text)]">
      <div className="mb-3">
        <span className="text-xs font-semibold text-[var(--color-text)]">
          System Tests
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {data.frameworks.map((framework) => (
          <div key={framework.name}>
            <div className="flex items-center gap-2 mb-1.5">
              <CheckCircle2
                size={13}
                className="text-[var(--color-success)] shrink-0"
              />
              <span className="text-xs font-semibold capitalize text-[var(--color-text)]">
                {framework.name.toLowerCase()}
              </span>
            </div>

            {framework.configPath && (
              <div className="ml-5 mb-1 text-[11px] text-[var(--color-text-secondary)]">
                Config:{" "}
                <span className="text-[var(--color-primary)] font-mono">
                  {framework.configPath}
                </span>
              </div>
            )}

            {framework.testDirectory && (
              <div className="ml-5 mb-1 text-[11px] text-[var(--color-text-secondary)]">
                Test Dir:{" "}
                <span className="text-[var(--color-primary)] font-mono">
                  {framework.testDirectory}
                </span>
              </div>
            )}

            {framework.testFileCount && framework.testFileCount > 0 && (
              <div className="ml-5 mb-1 text-[11px] text-[var(--color-text-secondary)]">
                Tests:{" "}
                <span className="text-[var(--color-primary)] font-mono">
                  {framework.testFileCount}
                </span>
              </div>
            )}

            {framework.browsers && (
              <div className="ml-5 text-[11px] text-[var(--color-text-secondary)]">
                Browsers:{" "}
                <span className="text-[var(--color-primary)] font-mono">
                  {framework.browsers}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {data.errors && data.errors.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <div className="text-[10px] text-[var(--color-warning)] leading-relaxed flex flex-col gap-0.5">
            {data.errors.map((err, i) => (
              <div key={i}>• {err}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
