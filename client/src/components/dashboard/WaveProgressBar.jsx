import React from "react";
import { Sparkles, Activity, CheckCircle2, Loader2, Cpu, Check, Layers } from "lucide-react";
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

  if (isLight) {
    const stages = [
      { id: 1, label: "Sandbox Env", min: 0, max: 20 },
      { id: 2, label: "Spec Runner", min: 20, max: 55 },
      { id: 3, label: "V8 AST Coverage", min: 55, max: 85 },
      { id: 4, label: "CFG & Reports", min: 85, max: 100 },
    ];

    return (
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          boxShadow: "0 4px 16px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.03)",
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
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  color: "#15803d",
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
                  background: "#fef3c7",
                  border: "1px solid #fde68a",
                  color: "#b45309",
                  fontSize: 11,
                  fontWeight: 800,
                  fontFamily: "var(--font-mono, monospace)",
                  letterSpacing: "0.5px",
                }}
              >
                <Loader2 size={13} className="animate-spin text-amber-600" />
                <span>RUNS</span>
              </span>
            )}

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 750,
                    color: "#0f172a",
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
                      background: "#f1f5f9",
                      color: "#334155",
                      border: "1px solid #e2e8f0",
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
                  color: "#475569",
                  marginTop: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                <span style={{ color: isComplete ? "#15803d" : "#6366f1" }}>❯</span>
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
                color: isComplete ? "#15803d" : "#4f46e5",
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
                    ? "#f0fdf4"
                    : isStageActive
                      ? "#eef2ff"
                      : "#f8fafc",
                  border: isStageComplete
                    ? "1px solid #bbf7d0"
                    : isStageActive
                      ? "1px solid #c7d2fe"
                      : "1px solid #e2e8f0",
                  color: isStageComplete
                    ? "#15803d"
                    : isStageActive
                      ? "#4338ca"
                      : "#94a3b8",
                  fontWeight: isStageActive || isStageComplete ? 700 : 500,
                  transition: "all 0.2s ease",
                }}
              >
                {isStageComplete ? (
                  <Check size={12} strokeWidth={2.5} style={{ flexShrink: 0, color: "#16a34a" }} />
                ) : isStageActive ? (
                  <Loader2 size={12} className="animate-spin text-indigo-600" style={{ flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#e2e8f0", display: "inline-block", flexShrink: 0 }} />
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
            background: "#f1f5f9",
            borderRadius: 6,
            overflow: "hidden",
            position: "relative",
            border: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              width: `${clamped}%`,
              height: "100%",
              borderRadius: 6,
              background: isComplete
                ? "linear-gradient(90deg, #10b981, #059669)"
                : "linear-gradient(90deg, #4f46e5 0%, #06b6d4 100%)",
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
                background: "#cbd5e1",
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
            color: "#64748b",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Cpu size={12} style={{ color: "#6366f1" }} />
            <span>Pipeline: 1 unified RUN_TESTS worker · Sandbox container telemetry</span>
          </span>
          <span style={{ color: isComplete ? "#15803d" : "#0284c7", fontWeight: 600 }}>
            {isComplete ? "All tests executed & verified" : "Streaming live execution telemetry..."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(17, 24, 39, 0.85) 0%, rgba(30, 27, 75, 0.75) 100%)",
        border: "1px solid rgba(167, 139, 250, 0.3)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.35), 0 0 20px rgba(139, 92, 246, 0.15)",
        backdropFilter: "blur(12px)",
        borderRadius: 14,
        padding: "16px 20px",
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes waveMoveFront {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes waveMoveBack {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.6; filter: drop-shadow(0 0 6px rgba(139, 92, 246, 0.6)); }
          50% { opacity: 1; filter: drop-shadow(0 0 14px rgba(6, 182, 212, 0.8)); }
        }
        @keyframes ripple {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 0.4; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
      `}</style>

      {/* Header Info */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: isComplete ? "rgba(34, 197, 94, 0.2)" : "rgba(139, 92, 246, 0.2)",
              border: `1px solid ${isComplete ? "#22c55e" : "#a78bfa"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: isComplete ? "none" : "pulseGlow 2s infinite ease-in-out",
            }}
          >
            {isComplete ? (
              <CheckCircle2 size={16} color="#4ade80" />
            ) : (
              <Activity size={16} color="#c084fc" />
            )}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#f3f4f6",
                  letterSpacing: "0.2px",
                }}
              >
                {isComplete ? "Analysis Completed" : "Running Unified Coverage Analysis"}
              </span>
              {framework && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 9999,
                    background: "rgba(139, 92, 246, 0.2)",
                    color: "#c084fc",
                    border: "1px solid rgba(139, 92, 246, 0.4)",
                    textTransform: "uppercase",
                  }}
                >
                  {framework}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "#9ca3af",
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>{step}</span>
            </div>
          </div>
        </div>

        {/* Dynamic Percentage Badge */}
        <div style={{ textAlign: "right", display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            style={{
              fontSize: 24,
              fontWeight: 800,
              fontFamily: "var(--font-mono, monospace)",
              background: isComplete
                ? "linear-gradient(90deg, #4ade80, #22c55e)"
                : "linear-gradient(90deg, #a78bfa, #38bdf8, #06b6d4)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {clamped}%
          </span>
        </div>
      </div>

      {/* Wave Progress Bar Container */}
      <div
        style={{
          width: "100%",
          height: 28,
          background: "rgba(0, 0, 0, 0.45)",
          borderRadius: 14,
          overflow: "hidden",
          position: "relative",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "inset 0 2px 6px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Dynamic Filled Bar */}
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            position: "relative",
            overflow: "hidden",
            borderRadius: "14px",
            transition: "width 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
            background: "linear-gradient(90deg, rgba(99, 102, 241, 0.4) 0%, rgba(139, 92, 246, 0.6) 50%, rgba(6, 182, 212, 0.7) 100%)",
          }}
        >
          {/* Back Wave (Fluid Layer 2) */}
          <svg
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "200%",
              height: "100%",
              opacity: 0.4,
              animation: "waveMoveBack 6s linear infinite",
            }}
            viewBox="0 0 1000 60"
            preserveAspectRatio="none"
          >
            <path
              d="M 0 20 Q 125 5 250 20 T 500 20 T 750 20 T 1000 20 L 1000 60 L 0 60 Z"
              fill="url(#waveGradientBack)"
            />
            <defs>
              <linearGradient id="waveGradientBack" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="50%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
            </defs>
          </svg>

          {/* Front Wave (Fluid Layer 1) */}
          <svg
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "200%",
              height: "100%",
              opacity: 0.85,
              animation: "waveMoveFront 3.5s linear infinite",
            }}
            viewBox="0 0 1000 60"
            preserveAspectRatio="none"
          >
            <path
              d="M 0 25 Q 125 45 250 25 T 500 25 T 750 25 T 1000 25 L 1000 60 L 0 60 Z"
              fill="url(#waveGradientFront)"
            />
            <defs>
              <linearGradient id="waveGradientFront" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="40%" stopColor="#8b5cf6" />
                <stop offset="80%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
          </svg>

          {/* Glowing Crest Highlight */}
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: 14,
              height: "100%",
              background: "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6))",
              filter: "blur(2px)",
            }}
          />
        </div>

        {/* Milestone Tick Marks (25%, 50%, 75%) */}
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            style={{
              position: "absolute",
              left: `${tick}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: "rgba(255, 255, 255, 0.12)",
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
          color: "#6b7280",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <span>Pipeline: 1 unified RUN_TESTS job</span>
        <span>{isComplete ? "All tests analyzed" : "Syncing live..."}</span>
      </div>
    </div>
  );
}

