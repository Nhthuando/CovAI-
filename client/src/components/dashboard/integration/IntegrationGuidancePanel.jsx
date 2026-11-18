import { useState, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Activity,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchIntegrationGuidance } from "../../../services/report.service";

const getSeverityMeta = (severity) => {
  switch (severity) {
    case "ERROR":
      return {
        icon: <XCircle className="text-rose-400/80" size={15} />,
        dot: "bg-rose-400/75",
        label: "Error",
        text: "text-rose-300/85",
      };
    case "WARNING":
      return {
        icon: <AlertTriangle className="text-amber-500/75" size={15} />,
        dot: "bg-amber-500/65",
        label: "Warning",
        text: "text-[var(--color-text-secondary)]",
      };
    case "SUCCESS":
      return {
        icon: <CheckCircle2 className="text-emerald-500/75" size={15} />,
        dot: "bg-emerald-500/65",
        label: "Verified",
        text: "text-[var(--color-text-secondary)]",
      };
    default:
      return {
        icon: <Info className="text-[var(--color-text-muted)]" size={15} />,
        dot: "bg-[var(--color-border-strong)]",
        label: severity || "Info",
        text: "text-[var(--color-text-muted)]",
      };
  }
};

function GuidanceRule({ rule, projectId }) {
  const navigate = useNavigate();
  const meta = getSeverityMeta(rule.severity);

  const handleAction = () => {
    if (rule.actionType === "VIEW_REPORT") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (rule.actionType === "VIEW_HISTORY") {
      navigate(
        `/main-editor?projectId=${projectId}&tab=integration-tests&subtab=history`,
      );
    } else {
      navigate(`/main-editor?projectId=${projectId}&tab=integration-tests`);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 shrink-0">{meta.icon}</div>
          <div className="space-y-0.5 min-w-0">
            <h4 className="text-xs font-semibold text-[var(--color-text)] m-0">
              {rule.finding}
            </h4>
            <p className="text-xs text-[var(--color-text-secondary)] m-0 leading-relaxed">
              {rule.meaning}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-mono shrink-0 ${meta.text}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
        <div className="p-3 bg-[var(--color-bg)] rounded-md border border-[var(--color-border)] space-y-1.5 text-xs">
          <div className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
            Evidence
          </div>
          <ul className="text-[11px] text-[var(--color-text-secondary)] space-y-1 m-0 pl-0 list-none">
            {rule.evidence?.source && (
              <li>
                <span className="text-[var(--color-text-muted)]">Source:</span>{" "}
                {rule.evidence.source}
              </li>
            )}
            {rule.evidence?.snapshotId && (
              <li>
                <span className="text-[var(--color-text-muted)]">
                  Snapshot:
                </span>{" "}
                <span className="font-mono">
                  {rule.evidence.snapshotId.slice(-6)}
                </span>
              </li>
            )}
            {rule.evidence?.jobId && (
              <li>
                <span className="text-[var(--color-text-muted)]">Job:</span>{" "}
                <span className="font-mono">
                  {rule.evidence.jobId.slice(-6)}
                </span>
              </li>
            )}
            {rule.evidence?.testRunId && (
              <li>
                <span className="text-[var(--color-text-muted)]">
                  Test run:
                </span>{" "}
                <span className="font-mono">
                  {rule.evidence.testRunId.slice(-6)}
                </span>
              </li>
            )}
            {rule.evidence?.details && (
              <li>
                <span className="text-[var(--color-text-muted)]">Details:</span>{" "}
                {rule.evidence.details}
              </li>
            )}
          </ul>
          {rule.calculation && (
            <p className="text-[11px] text-[var(--color-text-muted)] pt-1.5 border-t border-[var(--color-border)] m-0 font-mono">
              Formula: {rule.calculation}
            </p>
          )}
          {rule.scope && (
            <p className="text-[11px] text-[var(--color-text-muted)] m-0">
              Scope: {rule.scope}
            </p>
          )}
        </div>

        <div className="p-3 bg-[var(--color-bg)] rounded-md border border-[var(--color-border)] flex flex-col justify-between gap-2 text-xs">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
              Recommended action
            </div>
            {rule.impact && (
              <p className="text-[11px] text-rose-300/85 font-medium m-0">
                {rule.impact}
              </p>
            )}
            <p className="text-xs text-[var(--color-text-secondary)] m-0 leading-relaxed">
              {rule.recommendedAction}
            </p>
          </div>

          {rule.actionType && (
            <button
              type="button"
              onClick={handleAction}
              className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-[11px] font-medium transition-colors cursor-pointer"
            >
              <span>{rule.actionType.replace(/_/g, " ").toLowerCase()}</span>
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>

      {Array.isArray(rule.pathConstraints) &&
        rule.pathConstraints.length > 0 && (
          <div className="ml-6 p-3 bg-[var(--color-bg)] rounded-md border border-[var(--color-border)] space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-[var(--color-text-secondary)]">
                Branch conditions for target execution
              </span>
              <span className="font-mono text-[var(--color-text-muted)] tabular-nums">
                {rule.pathConstraints.length}{" "}
                {rule.pathConstraints.length === 1 ? "condition" : "conditions"}
              </span>
            </div>

            <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar">
              {rule.pathConstraints.map((pc, idx) => {
                const isUnresolved =
                  pc.status === "UNRESOLVED" || pc.condition === "unresolved";
                return (
                  <div
                    key={idx}
                    className="p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="px-1.5 py-0.2 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] font-semibold">
                          {pc.type || "BRANCH"}
                        </span>
                        {pc.filePath && (
                          <span
                            className="text-[var(--color-text-muted)] truncate max-w-[220px]"
                            title={pc.filePath}
                          >
                            {pc.filePath}
                          </span>
                        )}
                      </div>
                      <span className="text-[var(--color-text-muted)] tabular-nums shrink-0">
                        {pc.line ? `L${pc.line}` : "L?"}
                        {pc.uncoveredLine && pc.uncoveredLine !== pc.line
                          ? ` -> L${pc.uncoveredLine}`
                          : ""}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      {isUnresolved ? (
                        <span className="text-[var(--color-text-muted)] text-[11px] font-mono">
                          Condition unresolved (dynamic path)
                        </span>
                      ) : (
                        <code className="text-[var(--color-text)] font-mono text-[11px] bg-[var(--color-surface-secondary)] px-1.5 py-0.5 rounded border border-[var(--color-border)] break-all">
                          {pc.condition}
                        </code>
                      )}
                      <span className="text-[var(--color-text-muted)] text-[11px] whitespace-nowrap ml-auto font-mono">
                        {isUnresolved ? (
                          <span className="text-[var(--color-text-muted)]">UNRESOLVED</span>
                        ) : (
                          <>
                            Requires{" "}
                            <strong className="text-[var(--color-text)]">
                              {pc.requiredBranch || "COVER"}
                            </strong>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {rule.verification && (
        <div className="pl-6 text-[11px] text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text-secondary)]">
            Verification:
          </span>{" "}
          {rule.verification}
        </div>
      )}
    </div>
  );
}

export default function IntegrationGuidancePanel({ projectId }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchIntegrationGuidance(projectId)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data && Array.isArray(res.data.rules)) {
          setRules(res.data.rules);
        } else {
          setRules([]);
        }
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Guidance could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="text-[var(--color-text-muted)]" size={14} />
          <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
            Integration guidance
          </h3>
        </div>
        {!loading && !error && (
          <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
            {rules.length} {rules.length === 1 ? "note" : "notes"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-center text-xs text-[var(--color-text-muted)]">
          Loading guidance...
        </div>
      ) : error ? (
        <div className="p-4 text-xs text-rose-400">{error}</div>
      ) : rules.length === 0 ? (
        <div className="p-6 text-center text-xs text-[var(--color-text-muted)]">
          No guidance rules triggered for this snapshot.
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {rules.map((rule, idx) => (
            <GuidanceRule
              key={`${rule.id}-${idx}`}
              rule={rule}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
