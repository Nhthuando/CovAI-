import React from "react";
import { Sparkles, Activity, CheckCircle2 } from "lucide-react";

export default function WaveProgressBar({
  progress = 0,
  step = "Running coverage analysis...",
  framework = "Jest & Vitest",
  color = "#a78bfa",
}) {
  const clamped = Math.max(2, Math.min(100, Math.round(progress)));
  const isComplete = clamped >= 100;

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

