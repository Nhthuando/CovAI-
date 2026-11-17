import React from "react";

/**
 * TraceChain - Pure visual 3-node connected diagnostic chain: [● Unit] ── [● API] ── [○ E2E].
 */
export function TraceChain({
  unitStatus = "neutral",       // 'pass' | 'fail' | 'warn' | 'neutral'
  integrationStatus = "neutral",
  systemStatus = "neutral",
  size = "md",
  className = "",
}) {
  const getStatusColor = (status) => {
    switch (status) {
      case "pass":
        return "var(--ud-pass)";
      case "fail":
        return "var(--ud-fail)";
      case "warn":
        return "var(--ud-warn)";
      default:
        return "var(--ud-text-muted)";
    }
  };

  const getStatusDot = (status) => {
    const isSolid = status === "pass" || status === "fail" || status === "warn";
    const color = getStatusColor(status);
    return (
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform hover:scale-125"
        style={{
          backgroundColor: isSolid ? color : "transparent",
          border: `2px solid ${color}`,
        }}
      />
    );
  };

  const nodes = [
    { key: "unit", label: "Unit", status: unitStatus },
    { key: "integration", label: "API", status: integrationStatus },
    { key: "system", label: "E2E", status: systemStatus },
  ];

  return (
    <div
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${className}`}
      aria-label={`Trace: Unit ${unitStatus}, API ${integrationStatus}, E2E ${systemStatus}`}
      title={`Trace Flow: Unit (${unitStatus}) → API (${integrationStatus}) → E2E (${systemStatus})`}
    >
      {nodes.map((node, idx) => (
        <React.Fragment key={node.key}>
          <div
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--ud-border)]/60 bg-[var(--ud-surface-2)]/40 hover:bg-[var(--ud-surface-2)] transition-colors"
            title={`${node.label}: ${node.status}`}
          >
            {getStatusDot(node.status)}
            <span
              className="text-[10px] font-semibold"
              style={{ color: getStatusColor(node.status) }}
            >
              {node.label}
            </span>
          </div>

          {idx < nodes.length - 1 && (
            <span className="text-[var(--ud-border)] text-xs select-none">─</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default TraceChain;

