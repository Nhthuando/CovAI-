import React from "react";
import { Loader2, Cpu, Check } from "lucide-react";

export default function WaveProgressBar({
  progress = 0,
  step = "Running coverage analysis...",
  framework = "Jest & Vitest",
}) {
  const clamped = Math.max(2, Math.min(100, Math.round(progress)));
  const isComplete = clamped >= 100;

  const stages = [
    { id: 1, label: "Sandbox Env", min: 0, max: 20 },
    { id: 2, label: "Spec Runner", min: 20, max: 55 },
    { id: 3, label: "V8 AST Coverage", min: 55, max: 85 },
    { id: 4, label: "CFG & Reports", min: 85, max: 100 },
  ];

  return (
    <div
      style={{
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 20,
        position: "relative",
      }}
    >
      {/* Top Header: Runner Badge, Title, Active Step, Percentage */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Status Pill */}
          {isComplete ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 4,
                background: "rgba(16, 185, 129, 0.12)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
                color: "var(--color-success)",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <Check size={13} strokeWidth={2.5} />
              <span>PASS</span>
            </span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 4,
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.35)",
                color: "var(--color-warning)",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <Loader2 size={13} className="animate-spin text-[var(--color-warning)]" />
              <span>RUNS</span>
            </span>
          )}

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--color-text)",
                  letterSpacing: "-0.01em",
                }}
              >
                {isComplete ? "Unit Test Coverage Analysis Completed" : "Jest & Vitest Test Execution Pipeline"}
              </span>

              {framework && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "var(--color-surface-secondary)",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                    textTransform: "uppercase",
                  }}
                >
                  {framework}
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <span style={{ color: isComplete ? "var(--color-success)" : "var(--color-primary)" }}>❯</span>
              <span>{step}</span>
            </div>
          </div>
        </div>

        {/* Metric percentage */}
        <div style={{ textAlign: "right" }}>
          <span
            style={{
              fontSize: 24,
              fontWeight: 800,
              fontFamily: "var(--font-mono, monospace)",
              color: isComplete ? "var(--color-success)" : "var(--color-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            {clamped}%
          </span>
        </div>
      </div>

      {/* Visual 4-Stage Test Pipeline */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          marginBottom: 10,
        }}
      >
        {stages.map((stage) => {
          const isStageComplete = clamped >= stage.max;
          const isStageActive = clamped >= stage.min && clamped < stage.max;

          return (
            <div
              key={stage.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "var(--font-mono, monospace)",
                background: isStageComplete
                  ? "rgba(16, 185, 129, 0.1)"
                  : isStageActive
                    ? "rgba(14, 165, 233, 0.12)"
                    : "var(--color-surface-secondary)",
                border: isStageComplete
                  ? "1px solid rgba(16, 185, 129, 0.3)"
                  : isStageActive
                    ? "1px solid rgba(14, 165, 233, 0.4)"
                    : "1px solid var(--color-border)",
                color: isStageComplete
                  ? "var(--color-success)"
                  : isStageActive
                    ? "var(--color-primary)"
                    : "var(--color-text-muted)",
                fontWeight: isStageActive || isStageComplete ? 700 : 500,
                transition: "all 0.15s ease",
              }}
            >
              {isStageComplete ? (
                <Check size={12} strokeWidth={2.5} style={{ flexShrink: 0, color: "var(--color-success)" }} />
              ) : isStageActive ? (
                <Loader2 size={12} className="animate-spin text-[var(--color-primary)]" style={{ flexShrink: 0 }} />
              ) : (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--color-border)",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress Bar with Solid Semantic Colors */}
      <div
        style={{
          width: "100%",
          height: 6,
          background: "var(--color-surface-secondary)",
          borderRadius: 3,
          overflow: "hidden",
          position: "relative",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            borderRadius: 3,
            background: isComplete ? "var(--color-success)" : "var(--color-primary)",
            transition: "width 0.3s ease",
          }}
        />

        {/* Milestone markers */}
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            style={{
              position: "absolute",
              left: `${tick}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--color-border)",
              pointerEvents: "none",
            }}
          />
        ))}
      </div>

      {/* Footer Sub-indicator */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
          fontSize: 11,
          color: "var(--color-text-secondary)",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Cpu size={12} style={{ color: "var(--color-text-muted)" }} />
          <span>Pipeline: 1 unified RUN_TESTS worker · Sandbox container telemetry</span>
        </span>
        <span style={{ color: isComplete ? "var(--color-success)" : "var(--color-primary)", fontWeight: 600 }}>
          {isComplete ? "All tests executed & verified" : "Streaming live execution telemetry..."}
        </span>
      </div>
    </div>
  );
}
