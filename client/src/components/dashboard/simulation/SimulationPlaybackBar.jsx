import { useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  FastForward,
  Clock,
  Command,
} from "lucide-react";
import { SIMULATION_PHASES } from "../../../hooks/useUnitTestSimulation.js";

/**
 * Returns color representation for a given phase
 */
function getPhaseColor(phase) {
  return SIMULATION_PHASES[phase]?.color || "#6366f1";
}

/**
 * SimulationPlaybackBar
 * 
 * Provides interactive playback controls, speed selector, timeline scrubber with
 * color-coded taxonomy badges, step counter, and keyboard shortcuts guide.
 */
export default function SimulationPlaybackBar({
  steps = [],
  currentStepIndex = 0,
  isPlaying = false,
  playbackSpeed = 1,
  onPlay,
  onPause,
  onStepForward,
  onStepBackward,
  onReset,
  onJumpToEnd,
  onJumpToStep,
  onSetSpeed,
  isLight = false,
}) {
  const [hoveredStepIndex, setHoveredStepIndex] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const totalSteps = steps?.length || 0;
  const progressPct =
    totalSteps > 1 ? Math.round((currentStepIndex / (totalSteps - 1)) * 100) : totalSteps === 1 ? 100 : 0;

  return (
    <div
      style={{
        padding: "10px 18px",
        background: isLight ? "#f8fafc" : "#161b22",
        borderTop: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        userSelect: "none",
      }}
    >
      {/* ── TOP ROW: TIMELINE SCRUBBER ── */}
      <div style={{ position: "relative", width: "100%", paddingTop: 6, paddingBottom: 6 }}>
        {/* Progress track background */}
        <div
          onClick={(e) => {
            if (totalSteps <= 1) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
            const targetIndex = Math.round(ratio * (totalSteps - 1));
            onJumpToStep?.(targetIndex);
          }}
          style={{
            position: "relative",
            height: 6,
            background: isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.1)",
            borderRadius: 999,
            cursor: "pointer",
            overflow: "visible",
          }}
        >
          {/* Active progress fill */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, #6366f1 0%, #10b981 100%)",
              borderRadius: 999,
              transition: isPlaying ? "width 0.15s ease-out" : "width 0.08s ease",
            }}
          />

          {/* Color-coded Step Badges / Nodes along timeline */}
          {(steps || []).map((step, idx) => {
            const stepPosPct = totalSteps > 1 ? (idx / (totalSteps - 1)) * 100 : 50;
            const isActive = idx === currentStepIndex;
            const isPassed = idx < currentStepIndex;
            const phaseColor = getPhaseColor(step?.phase);

            return (
              <div
                key={step?.stepIndex || idx}
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpToStep?.(idx);
                }}
                onMouseEnter={() => setHoveredStepIndex(idx)}
                onMouseLeave={() => setHoveredStepIndex(null)}
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${stepPosPct}%`,
                  transform: "translate(-50%, -50%)",
                  width: isActive ? 16 : 10,
                  height: isActive ? 16 : 10,
                  borderRadius: "50%",
                  background: isActive ? phaseColor : isPassed ? phaseColor : isLight ? "#cbd5e1" : "#4b5563",
                  border: isActive
                    ? `3px solid ${isLight ? "#ffffff" : "#0d1117"}`
                    : `2px solid ${isLight ? "#ffffff" : "#161b22"}`,
                  boxShadow: isActive ? `0 0 10px ${phaseColor}` : "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  zIndex: isActive ? 10 : 5,
                }}
                title={`Step ${idx + 1}: ${step?.title || step?.phase || ""}`}
              />
            );
          })}
        </div>

        {/* Floating Tooltip when hovering over a step node */}
        {hoveredStepIndex !== null && steps?.[hoveredStepIndex] && (
          <div
            style={{
              position: "absolute",
              bottom: 22,
              left: `${totalSteps > 1 ? (hoveredStepIndex / (totalSteps - 1)) * 100 : 50}%`,
              transform: "translateX(-50%)",
              background: isLight ? "#0f172a" : "#1e293b",
              color: "#ffffff",
              padding: "5px 10px",
              borderRadius: 6,
              fontSize: 11,
              whiteSpace: "nowrap",
              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.4)",
              pointerEvents: "none",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: getPhaseColor(steps[hoveredStepIndex]?.phase),
                }}
              />
              <span style={{ fontWeight: 700 }}>
                Step {hoveredStepIndex + 1} of {totalSteps}: {steps[hoveredStepIndex]?.phase}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{steps[hoveredStepIndex]?.title}</div>
          </div>
        )}
      </div>

      {/* ── BOTTOM ROW: CONTROLS, SPEED & STEP PROGRESS ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Left: Playback Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Reset (⏮) */}
          <button
            onClick={onReset}
            disabled={currentStepIndex === 0 && !isPlaying}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
              color: isLight ? "#334155" : "#e2e8f0",
              cursor: currentStepIndex === 0 && !isPlaying ? "not-allowed" : "pointer",
              opacity: currentStepIndex === 0 && !isPlaying ? 0.4 : 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
            title="Reset to Start (Home or R)"
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>

          {/* Step Backwards (⏪) */}
          <button
            onClick={onStepBackward}
            disabled={currentStepIndex <= 0}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
              color: isLight ? "#334155" : "#e2e8f0",
              cursor: currentStepIndex <= 0 ? "not-allowed" : "pointer",
              opacity: currentStepIndex <= 0 ? 0.4 : 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
            title="Step Backward (ArrowLeft)"
          >
            <SkipBack size={13} />
            <span>Back</span>
          </button>

          {/* Play / Pause Toggle (⏯) */}
          <button
            onClick={isPlaying ? onPause : onPlay}
            disabled={totalSteps === 0}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              background: isPlaying
                ? "#f59e0b"
                : "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
              border: "none",
              color: "#ffffff",
              cursor: totalSteps === 0 ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 700,
              boxShadow: isPlaying
                ? "0 4px 10px rgba(245, 158, 11, 0.35)"
                : "0 4px 10px rgba(99, 102, 241, 0.35)",
            }}
            title={isPlaying ? "Pause Simulation (Space)" : "Play Simulation (Space)"}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} fill="#ffffff" />}
            <span>{isPlaying ? "Pause" : "Play"}</span>
          </button>

          {/* Step Forward (⏩) */}
          <button
            onClick={onStepForward}
            disabled={currentStepIndex >= totalSteps - 1}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
              color: isLight ? "#334155" : "#e2e8f0",
              cursor: currentStepIndex >= totalSteps - 1 ? "not-allowed" : "pointer",
              opacity: currentStepIndex >= totalSteps - 1 ? 0.4 : 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
            title="Step Forward (ArrowRight)"
          >
            <span>Step</span>
            <SkipForward size={13} />
          </button>

          {/* Jump to End (⏭) */}
          <button
            onClick={onJumpToEnd}
            disabled={currentStepIndex >= totalSteps - 1}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
              color: isLight ? "#334155" : "#e2e8f0",
              cursor: currentStepIndex >= totalSteps - 1 ? "not-allowed" : "pointer",
              opacity: currentStepIndex >= totalSteps - 1 ? 0.4 : 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
            title="Jump to Final Assertion (End)"
          >
            <span>End</span>
            <FastForward size={13} />
          </button>
        </div>

        {/* Center: Playback Speed Selector (0.5x, 1x, 2x) */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              color: isLight ? "#64748b" : "#8b949e",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginRight: 4,
            }}
          >
            <Clock size={12} />
            <span>Speed:</span>
          </span>
          {[0.5, 1, 2].map((spd) => {
            const isSelected = playbackSpeed === spd;
            return (
              <button
                key={spd}
                onClick={() => onSetSpeed?.(spd)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 5,
                  background: isSelected
                    ? isLight
                      ? "#4f46e5"
                      : "#6366f1"
                    : isLight
                    ? "#ffffff"
                    : "rgba(255, 255, 255, 0.05)",
                  color: isSelected ? "#ffffff" : isLight ? "#475569" : "#94a3b8",
                  border: isSelected
                    ? "none"
                    : isLight
                    ? "1px solid #e2e8f0"
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.12s ease",
                }}
                title={`Set playback speed to ${spd}x`}
              >
                {spd}x
              </button>
            );
          })}
        </div>

        {/* Right: Step Counter & Keyboard Guide */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Step Counter Badge */}
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: isLight ? "#eff6ff" : "rgba(99, 102, 241, 0.12)",
              border: isLight ? "1px solid #bfdbfe" : "1px solid rgba(99, 102, 241, 0.25)",
              color: isLight ? "#1e40af" : "#a5b4fc",
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
            }}
          >
            <span>
              Step {totalSteps > 0 ? currentStepIndex + 1 : 0} of {totalSteps}
            </span>
            <span style={{ margin: "0 5px", color: isLight ? "#93c5fd" : "#6366f1" }}>·</span>
            <span>{progressPct}%</span>
          </div>

          {/* Keyboard Shortcuts Trigger Button */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                background: "transparent",
                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.1)",
                color: isLight ? "#64748b" : "#8b949e",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
              }}
              title="Keyboard shortcuts"
            >
              <Command size={12} />
              <span>Keys</span>
            </button>

            {/* Floating shortcuts popup */}
            {showShortcuts && (
              <div
                style={{
                  position: "absolute",
                  bottom: 34,
                  right: 0,
                  width: 220,
                  background: isLight ? "#ffffff" : "#1e293b",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid #334155",
                  borderRadius: 8,
                  padding: "10px 12px",
                  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.35)",
                  zIndex: 30,
                  fontSize: 11,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9" }}>
                  Keyboard Shortcuts
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: isLight ? "#475569" : "#94a3b8" }}>
                  <span>Play / Pause</span>
                  <kbd style={{ background: isLight ? "#f1f5f9" : "#0f172a", padding: "1px 5px", borderRadius: 3 }}>Space</kbd>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: isLight ? "#475569" : "#94a3b8" }}>
                  <span>Step Forward</span>
                  <kbd style={{ background: isLight ? "#f1f5f9" : "#0f172a", padding: "1px 5px", borderRadius: 3 }}>→</kbd>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: isLight ? "#475569" : "#94a3b8" }}>
                  <span>Step Back</span>
                  <kbd style={{ background: isLight ? "#f1f5f9" : "#0f172a", padding: "1px 5px", borderRadius: 3 }}>←</kbd>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: isLight ? "#475569" : "#94a3b8" }}>
                  <span>Reset</span>
                  <kbd style={{ background: isLight ? "#f1f5f9" : "#0f172a", padding: "1px 5px", borderRadius: 3 }}>R / Home</kbd>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: isLight ? "#475569" : "#94a3b8" }}>
                  <span>Jump to End</span>
                  <kbd style={{ background: isLight ? "#f1f5f9" : "#0f172a", padding: "1px 5px", borderRadius: 3 }}>End</kbd>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
