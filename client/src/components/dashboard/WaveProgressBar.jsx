import React from "react";
import { Loader2, Cpu, Check } from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";

export default function WaveProgressBar({
  progress = 0,
  step = "Running coverage analysis...",
  framework = "Jest & Vitest",
  color = "#a78bfa",
  isLight: propIsLight,
}) {
  const { resolvedTheme } = useTheme();
  const isLight = propIsLight ?? (resolvedTheme === "light");
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
        background: isLight
          ? "#ffffff"
          : "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 27, 75, 0.8) 100%)",
        border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(167, 139, 250, 0.25)",
        boxShadow: isLight
          ? "0 4px 16px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.03)"
          : "0 8px 32px rgba(0, 0, 0, 0.35), 0 0 20px rgba(139, 92, 246, 0.15)",
        backdropFilter: isLight ? "none" : "blur(12px)",
        borderRadius: 12,
        padding: "16px 20px",
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes runnerPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.97); }
        }
        @keyframes shimmerSweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

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
                padding: "4px 9px",
                borderRadius: 6,
                background: isLight ? "#f0fdf4" : "rgba(16, 185, 129, 0.15)",
                border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(16, 185, 129, 0.35)",
                color: isLight ? "#15803d" : "#4ade80",
                fontSize: 11,
                fontWeight: 800,
                fontFamily: "var(--font-mono, monospace)",
                letterSpacing: "0.5px",
              }}
            >
              <Check size={13} strokeWidth={3} />
              <span>PASS</span>
            </span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 9px",
                borderRadius: 6,
                background: isLight ? "#fef3c7" : "rgba(245, 158, 11, 0.15)",
                border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.35)",
                color: isLight ? "#b45309" : "#fbbf24",
                fontSize: 11,
                fontWeight: 800,
                fontFamily: "var(--font-mono, monospace)",
                letterSpacing: "0.5px",
              }}
            >
              <Loader2 size={13} className={`animate-spin ${isLight ? "text-amber-600" : "text-amber-400"}`} />
              <span>RUNS</span>
            </span>
          )}

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 750,
                  color: isLight ? "#0f172a" : "#f8fafc",
                  letterSpacing: "-0.01em",
                }}
              >
                {isComplete ? "Unit Test Coverage Analysis Completed" : "Jest & Vitest Test Execution Pipeline"}
              </span>

              {framework && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: isLight ? "#f1f5f9" : "rgba(139, 92, 246, 0.2)",
                    color: isLight ? "#334155" : "#c084fc",
                    border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(139, 92, 246, 0.35)",
                    textTransform: "uppercase",
                    letterSpacing: "0.3px",
                  }}
                >
                  {framework}
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 12,
                color: isLight ? "#475569" : "#cbd5e1",
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <span style={{ color: isComplete ? (isLight ? "#15803d" : "#4ade80") : (isLight ? "#6366f1" : "#a78bfa") }}>❯</span>
              <span>{step}</span>
            </div>
          </div>
        </div>

        {/* Metric percentage */}
        <div style={{ textAlign: "right" }}>
          <span
            style={{
              fontSize: 26,
              fontWeight: 800,
              fontFamily: "var(--font-mono, monospace)",
              color: isComplete ? (isLight ? "#15803d" : "#4ade80") : (isLight ? "#4f46e5" : "#a78bfa"),
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
                padding: "5px 8px",
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "var(--font-mono, monospace)",
                background: isStageComplete
                  ? (isLight ? "#f0fdf4" : "rgba(16, 185, 129, 0.12)")
                  : isStageActive
                    ? (isLight ? "#eef2ff" : "rgba(99, 102, 241, 0.2)")
                    : (isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.03)"),
                border: isStageComplete
                  ? (isLight ? "1px solid #bbf7d0" : "1px solid rgba(16, 185, 129, 0.3)")
                  : isStageActive
                    ? (isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.45)")
                    : (isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)"),
                color: isStageComplete
                  ? (isLight ? "#15803d" : "#4ade80")
                  : isStageActive
                    ? (isLight ? "#4338ca" : "#c7d2fe")
                    : (isLight ? "#94a3b8" : "#64748b"),
                fontWeight: isStageActive || isStageComplete ? 700 : 500,
                transition: "all 0.2s ease",
              }}
            >
              {isStageComplete ? (
                <Check size={12} strokeWidth={2.5} style={{ flexShrink: 0, color: isLight ? "#16a34a" : "#4ade80" }} />
              ) : isStageActive ? (
                <Loader2 size={12} className={`animate-spin ${isLight ? "text-indigo-600" : "text-indigo-400"}`} style={{ flexShrink: 0 }} />
              ) : (
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.1)",
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

      {/* High-Precision Progress Bar */}
      <div
        style={{
          width: "100%",
          height: 9,
          background: isLight ? "#f1f5f9" : "rgba(0, 0, 0, 0.45)",
          borderRadius: 6,
          overflow: "hidden",
          position: "relative",
          border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            borderRadius: 6,
            background: isComplete
              ? "linear-gradient(90deg, #10b981, #059669)"
              : isLight
                ? "linear-gradient(90deg, #4f46e5 0%, #06b6d4 100%)"
                : "linear-gradient(90deg, #6366f1 0%, #38bdf8 50%, #06b6d4 100%)",
            transition: "width 0.4s ease",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Shimmer line */}
          {!isComplete && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                animation: "shimmerSweep 2s infinite ease-in-out",
              }}
            />
          )}
        </div>

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
              background: isLight ? "#cbd5e1" : "rgba(255, 255, 255, 0.15)",
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
          color: isLight ? "#64748b" : "#94a3b8",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Cpu size={12} style={{ color: isLight ? "#6366f1" : "#a78bfa" }} />
          <span>Pipeline: 1 unified RUN_TESTS worker · Sandbox container telemetry</span>
        </span>
        <span style={{ color: isComplete ? (isLight ? "#15803d" : "#4ade80") : (isLight ? "#0284c7" : "#38bdf8"), fontWeight: 600 }}>
          {isComplete ? "All tests executed & verified" : "Streaming live execution telemetry..."}
        </span>
      </div>
    </div>
  );
}
