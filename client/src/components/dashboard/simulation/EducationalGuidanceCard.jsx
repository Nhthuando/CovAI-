import {
  Lightbulb,
  GitBranch,
  Cpu,
} from "lucide-react";
import { CATEGORY_METADATA, SIMULATION_PHASES } from "../../../hooks/useUnitTestSimulation.js";

/**
 * EducationalGuidanceCard
 * 
 * Renders structured educational insights aligned with the 4-Category Decision Table Matrix:
 * - Execution Flow: What is happening in the code at this exact step.
 * - Decision Logic: Why a branch toggled True or False.
 * - Developer Learning Note: Concrete, actionable testing advice for authoring tests.
 */
export default function EducationalGuidanceCard({
  guidance = null,
  step = null,
  category = "HAPPY_PATH",
  isLight = false,
}) {
  const effectiveCategory = guidance?.category || step?.educationalGuidance?.category || category || "HAPPY_PATH";
  const cat = CATEGORY_METADATA[effectiveCategory] || CATEGORY_METADATA.HAPPY_PATH;
  const phaseInfo = SIMULATION_PHASES[step?.phase] || { label: step?.phase || "Execution", color: "#6366f1" };

  const title = guidance?.stepTitle || step?.educationalGuidance?.stepTitle || step?.title || "Step Execution";
  const narrative =
    guidance?.stepNarrative ||
    step?.educationalGuidance?.stepNarrative ||
    step?.description ||
    "Step is being executed in memory.";
  const rationale =
    guidance?.logicRationale ||
    step?.educationalGuidance?.logicRationale ||
    step?.branchEvaluation?.explanation ||
    "Evaluating business logic state and branch conditions.";
  const takeaway =
    guidance?.developerTakeaway ||
    step?.educationalGuidance?.developerTakeaway ||
    "Ensure unit tests exercise both expected outcomes and edge cases.";

  return (
    <div
      style={{
        borderRadius: 8,
        background: isLight ? "#ffffff" : "#161b22",
        border: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
        overflow: "hidden",
        boxShadow: isLight ? "0 1px 3px rgba(0,0,0,0.05)" : "0 4px 6px -1px rgba(0,0,0,0.2)",
      }}
    >
      {/* ── CARD HEADER: CATEGORY BADGE & PHASE ── */}
      <div
        style={{
          padding: "10px 14px",
          background: isLight ? cat.bgLight : cat.bgDark,
          borderBottom: `1px solid ${cat.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 750,
              background: isLight ? "#ffffff" : "rgba(0, 0, 0, 0.4)",
              color: cat.color,
              border: `1px solid ${cat.border}`,
            }}
          >
            {cat.badge}
          </span>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: isLight ? "#0f172a" : "#f1f5f9",
            }}
          >
            {title}
          </span>
        </div>

        {/* Phase Pill */}
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            background: isLight ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0.08)",
            color: phaseInfo.color,
            border: `1px solid ${phaseInfo.color}40`,
          }}
        >
          {phaseInfo.label}
        </span>
      </div>

      {/* ── CARD BODY: 3 STRUCTURED EDUCATIONAL SECTIONS ── */}
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Section 1: Execution Flow */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: isLight ? "#64748b" : "#8b949e",
              marginBottom: 3,
            }}
          >
            <Cpu size={12} className="text-indigo-400" />
            <span>Execution Flow</span>
          </div>
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.5,
              color: isLight ? "#1e293b" : "#e2e8f0",
            }}
          >
            {narrative}
          </div>
        </div>

        {/* Section 2: Decision Logic (Branch toggling / evaluation) */}
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.03)",
            border: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: isLight ? "#475569" : "#94a3b8",
              marginBottom: 3,
            }}
          >
            <GitBranch size={12} className="text-amber-400" />
            <span>Decision Logic</span>
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: isLight ? "#334155" : "#cbd5e1",
            }}
          >
            {rationale}
          </div>
        </div>

        {/* Section 3: Developer Learning Note */}
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: isLight ? "#eff6ff" : "rgba(59, 130, 246, 0.08)",
            border: isLight ? "1px solid #dbeafe" : "1px solid rgba(59, 130, 246, 0.2)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: isLight ? "#1d4ed8" : "#93c5fd",
              marginBottom: 3,
            }}
          >
            <Lightbulb size={12} className="text-yellow-400" />
            <span>Developer Learning Note</span>
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: isLight ? "#1e3a8a" : "#bfdbfe",
            }}
          >
            {takeaway}
          </div>
        </div>
      </div>
    </div>
  );
}
