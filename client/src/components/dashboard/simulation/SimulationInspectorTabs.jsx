import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Cpu,
  ShieldCheck,
  Target,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Layers,
  Database,
  Info,
} from "lucide-react";
import EducationalGuidanceCard from "./EducationalGuidanceCard.jsx";

/**
 * Formats values for display inside JSON/variable inspectors
 */
function formatValue(val) {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "object") {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return "[Circular Object]";
    }
  }
  return String(val);
}

/**
 * Returns a type label badge
 */
function getTypeLabel(val) {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (Array.isArray(val)) return `array[${val.length}]`;
  return typeof val;
}

/**
 * SimulationInspectorTabs
 * 
 * Houses tabbed context inspectors for:
 * 1. Educational 4-Category Guidance
 * 2. Variables & Local Scope State
 * 3. Universal RAM Mock Isolation (Rule 4)
 * 4. Assertion Outcomes
 */
export default function SimulationInspectorTabs({
  step = null,
  currentStep = null,
  previousStep = null,
  category = "HAPPY_PATH",
  summary = null,
  initialMocks = [],
  isLight = false,
}) {
  const [activeTab, setActiveTab] = useState("guidance"); // "guidance" | "variables" | "mocks" | "assertions"
  const [copiedKey, setCopiedKey] = useState(null);

  const activeStep = currentStep || step;
  const variables = activeStep?.variables || {};
  const activeMocks = (activeStep?.activeMocks || initialMocks || []).filter(Boolean);
  const assertion = activeStep?.assertionResult || activeStep?.assertion || null;
  const branchEval = activeStep?.branchEvaluation || null;
  const callStack = activeStep?.callStack || ["<global>"];

  // Pedagogical variable diff tracking
  const changedVarList = Array.isArray(activeStep?.changedVariables)
    ? activeStep.changedVariables
    : [];
  const changedVarSet = new Set(changedVarList);

  const prevStepRef = useRef(null);
  useEffect(() => {
    prevStepRef.current = activeStep;
  }, [activeStep]);

  const prevVariables = previousStep?.variables || (prevStepRef.current && prevStepRef.current !== activeStep ? prevStepRef.current.variables : null);

  const isVariableChanged = (key, val) => {
    if (changedVarSet.has(key)) return true;
    if (prevVariables && Object.prototype.hasOwnProperty.call(prevVariables, key)) {
      try {
        return JSON.stringify(prevVariables[key]) !== JSON.stringify(val);
      } catch (_) {
        return prevVariables[key] !== val;
      }
    }
    return false;
  };

  const handleCopy = (key, text) => {
    navigator.clipboard?.writeText(typeof text === "string" ? text : JSON.stringify(text, null, 2));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const tabs = [
    { id: "guidance", label: "Guidance", icon: Sparkles },
    { id: "variables", label: "Variables & Scope", icon: Cpu },
    { id: "mocks", label: "RAM Mocks", icon: ShieldCheck },
    { id: "assertions", label: "Assertions", icon: Target },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: isLight ? "#ffffff" : "#0d1117",
        borderLeft: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
        overflow: "hidden",
      }}
    >
      {/* ── TABS HEADER ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
          background: isLight ? "#f8fafc" : "#161b22",
          padding: "4px 8px",
          gap: 4,
          overflowX: "auto",
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 11px",
                borderRadius: 6,
                background: isActive
                  ? isLight
                    ? "#ffffff"
                    : "#21262d"
                  : "transparent",
                color: isActive
                  ? isLight
                    ? "#0f172a"
                    : "#f0f6fc"
                  : isLight
                  ? "#64748b"
                  : "#8b949e",
                border: isActive
                  ? isLight
                    ? "1px solid #cbd5e1"
                    : "1px solid #30363d"
                  : "1px solid transparent",
                fontSize: 11.5,
                fontWeight: isActive ? 700 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.12s ease",
              }}
            >
              <Icon size={13} className={isActive ? "text-indigo-500" : ""} />
              <span>{tab.label}</span>
              {tab.id === "mocks" && activeMocks.length > 0 && (
                <span
                  style={{
                    fontSize: 9.5,
                    padding: "1px 5px",
                    borderRadius: 999,
                    background: isLight ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.25)",
                    color: isLight ? "#4f46e5" : "#a5b4fc",
                    fontWeight: 700,
                  }}
                >
                  {activeMocks.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── TAB CONTENT BODY ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
        {/* ── TAB 1: EDUCATIONAL GUIDANCE ── */}
        {activeTab === "guidance" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <EducationalGuidanceCard
              guidance={step?.educationalGuidance}
              step={step}
              category={category}
              isLight={isLight}
            />

            {/* Trace Summary Metrics Bar if present */}
            {summary && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: isLight ? "#f8fafc" : "#161b22",
                  border: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: isLight ? "#64748b" : "#8b949e",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Info size={12} className="text-indigo-400" />
                  <span>Execution Summary:</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{summary.totalSteps || 0} steps</span>
                  <span>·</span>
                  <span>{summary.branchesToggled?.length || 0} branches</span>
                  {summary.durationMs && (
                    <>
                      <span>·</span>
                      <span>{summary.durationMs}ms</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Call Stack Hierarchy */}
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: isLight ? "#f8fafc" : "#161b22",
                border: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
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
                  color: isLight ? "#64748b" : "#8b949e",
                  marginBottom: 6,
                }}
              >
                <Layers size={12} className="text-indigo-400" />
                <span>Call Stack</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {callStack.map((frame, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11.5,
                      fontFamily: "var(--font-mono)",
                      color: idx === callStack.length - 1 ? (isLight ? "#4f46e5" : "#818cf8") : isLight ? "#334155" : "#cbd5e1",
                      fontWeight: idx === callStack.length - 1 ? 700 : 500,
                    }}
                  >
                    <span style={{ color: "#94a3b8", fontSize: 10 }}>#{idx}</span>
                    <span>{frame}</span>
                    {idx === callStack.length - 1 && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: isLight ? "rgba(99, 102, 241, 0.1)" : "rgba(99, 102, 241, 0.2)",
                          color: isLight ? "#4f46e5" : "#a5b4fc",
                        }}
                      >
                        active
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Active Branch Decision Details (if on a branch step) */}
            {branchEval && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: branchEval.branchTaken === "TRUE"
                    ? (isLight ? "rgba(16, 185, 129, 0.08)" : "rgba(16, 185, 129, 0.12)")
                    : (isLight ? "rgba(245, 158, 11, 0.08)" : "rgba(245, 158, 11, 0.12)"),
                  border: `1px solid ${branchEval.branchTaken === "TRUE" ? "#10b981" : "#f59e0b"}40`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: branchEval.branchTaken === "TRUE" ? "#10b981" : "#f59e0b" }}>
                    Branch Evaluation
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: branchEval.branchTaken === "TRUE" ? "#10b981" : "#f59e0b",
                      color: "#ffffff",
                    }}
                  >
                    {branchEval.branchTaken === "TRUE" ? "✓ TRUE: TAKEN" : "✗ FALSE: SKIPPED"}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: isLight ? "#0f172a" : "#f1f5f9", marginBottom: 4 }}>
                  {branchEval.condition}
                </div>
                <div style={{ fontSize: 11, color: isLight ? "#475569" : "#94a3b8" }}>
                  {branchEval.explanation}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: VARIABLES & SCOPE ── */}
        {activeTab === "variables" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: isLight ? "#64748b" : "#8b949e" }}>
                Active Scope ({Object.keys(variables).length} entries)
              </span>
              <button
                onClick={() => handleCopy("all_vars", variables)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10.5,
                  padding: "3px 7px",
                  borderRadius: 4,
                  background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.06)",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
                  color: isLight ? "#334155" : "#cbd5e1",
                  cursor: "pointer",
                }}
              >
                {copiedKey === "all_vars" ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                <span>{copiedKey === "all_vars" ? "Copied" : "Copy Scope"}</span>
              </button>
            </div>

            {Object.keys(variables).length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: isLight ? "#94a3b8" : "#64748b",
                  fontSize: 12,
                  fontStyle: "italic",
                }}
              >
                No local variables declared at this step.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(variables).map(([key, val]) => {
                  const isUpdated = isVariableChanged(key, val);
                  return (
                    <div
                      key={key}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: isUpdated
                          ? (isLight ? "rgba(16, 185, 129, 0.06)" : "rgba(16, 185, 129, 0.1)")
                          : (isLight ? "#f8fafc" : "#161b22"),
                        border: isUpdated
                          ? (isLight ? "1px solid rgba(16, 185, 129, 0.45)" : "1px solid rgba(16, 185, 129, 0.5)")
                          : (isLight ? "1px solid #e2e8f0" : "1px solid #30363d"),
                        boxShadow: isUpdated
                          ? (isLight ? "0 0 8px rgba(16, 185, 129, 0.15)" : "0 0 10px rgba(16, 185, 129, 0.22)")
                          : "none",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: isLight ? "#0f172a" : "#f1f5f9" }}>
                            {key}
                          </span>
                          <span
                            style={{
                              fontSize: 9.5,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.08)",
                              color: isLight ? "#475569" : "#94a3b8",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {getTypeLabel(val)}
                          </span>
                          {isUpdated && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 750,
                                padding: "1px 6px",
                                borderRadius: 3,
                                background: isLight ? "rgba(16, 185, 129, 0.18)" : "rgba(16, 185, 129, 0.25)",
                                color: isLight ? "#059669" : "#34d399",
                                border: isLight ? "1px solid rgba(16, 185, 129, 0.35)" : "1px solid rgba(16, 185, 129, 0.45)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                              title="Variable modified or evaluated in this step"
                            >
                              <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: "currentColor" }} />
                              Updated
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleCopy(key, val)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isLight ? "#94a3b8" : "#64748b",
                            cursor: "pointer",
                            padding: 2,
                          }}
                          title="Copy variable value"
                        >
                          {copiedKey === key ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                        </button>
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          color: typeof val === "string" ? (isLight ? "#047857" : "#34d399") : typeof val === "number" ? (isLight ? "#b45309" : "#fbbf24") : typeof val === "boolean" ? (isLight ? "#4338ca" : "#818cf8") : isLight ? "#334155" : "#cbd5e1",
                          background: isLight ? "#ffffff" : "#0d1117",
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.04)",
                          overflowX: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          maxHeight: 120,
                        }}
                      >
                        {formatValue(val)}
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: UNIVERSAL RAM MOCKS (Rule 4) ── */}
        {activeTab === "mocks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Rule 4 Invariant Badge */}
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: isLight ? "rgba(16, 185, 129, 0.1)" : "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <ShieldCheck size={16} className="text-emerald-500 flex-shrink-0" />
              <div style={{ fontSize: 11.5, fontWeight: 700, color: isLight ? "#065f46" : "#6ee7b7" }}>
                🛡️ Universal RAM Mock Isolation: 0 Disk Writes · 0 DB Mutations · Pure RAM Execution
              </div>
            </div>

            {/* Active RAM Mocks List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeMocks.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: isLight ? "#f8fafc" : "#161b22",
                    border: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Database size={13} className="text-indigo-400" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9" }}>
                        {m?.module || "Unknown Module"}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: isLight ? "rgba(16, 185, 129, 0.12)" : "rgba(16, 185, 129, 0.2)",
                        color: "#10b981",
                      }}
                    >
                      {m?.status || "ISOLATED_IN_RAM"}
                    </span>
                  </div>

                  {m?.method && (
                    <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: isLight ? "#475569" : "#94a3b8" }}>
                      Intercepted Method: <strong style={{ color: isLight ? "#1e293b" : "#e2e8f0" }}>{m.method}</strong>
                    </div>
                  )}

                  {m?.returned !== undefined && (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 650, color: isLight ? "#64748b" : "#8b949e", marginBottom: 2 }}>
                        Simulated RAM Response:
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 10.5,
                          fontFamily: "var(--font-mono)",
                          color: isLight ? "#047857" : "#34d399",
                          background: isLight ? "#ffffff" : "#0d1117",
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.04)",
                          overflowX: "auto",
                          maxHeight: 80,
                        }}
                      >
                        {formatValue(m.returned)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB 4: ASSERTION OUTCOMES ── */}
        {activeTab === "assertions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {assertion ? (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: isLight ? "#f8fafc" : "#161b22",
                  border: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {/* Status Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {assertion.passed ? (
                      <CheckCircle2 size={16} className="text-emerald-500" />
                    ) : (
                      <XCircle size={16} className="text-rose-500" />
                    )}
                    <span style={{ fontSize: 13, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9" }}>
                      Matcher: .{assertion.matcher || "toBe"}()
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: assertion.passed
                        ? isLight
                          ? "#ecfdf5"
                          : "rgba(16, 185, 129, 0.2)"
                        : isLight
                        ? "#fef2f2"
                        : "rgba(239, 68, 68, 0.2)",
                      color: assertion.passed ? "#10b981" : "#ef4444",
                    }}
                  >
                    {assertion.passed ? "✓ PASSED" : "✗ FAILED"}
                  </span>
                </div>

                {/* Expected vs Actual comparison */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {/* Expected */}
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: isLight ? "#ffffff" : "#0d1117",
                      border: isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: 3 }}>
                      Expected Contract
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        color: isLight ? "#1e293b" : "#e2e8f0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {formatValue(assertion.expected)}
                    </pre>
                  </div>

                  {/* Actual */}
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: isLight ? "#ffffff" : "#0d1117",
                      border: isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: 3 }}>
                      Actual Value
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        color: assertion.passed ? (isLight ? "#047857" : "#34d399") : (isLight ? "#b91c1c" : "#f87171"),
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {formatValue(assertion.actual)}
                    </pre>
                  </div>
                </div>

                {/* Executed Test Snippet */}
                {step?.codeSnippet && (
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "#64748b", marginBottom: 3 }}>
                      Executed Assertion Snippet
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: isLight ? "#ffffff" : "#0d1117",
                        border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.05)",
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        color: isLight ? "#4f46e5" : "#a5b4fc",
                        overflowX: "auto",
                      }}
                    >
                      {step.codeSnippet}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: isLight ? "#94a3b8" : "#64748b",
                  fontSize: 12,
                  fontStyle: "italic",
                }}
              >
                Assertion evaluation occurs at the final step of the test execution. Advance or jump to end to inspect.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
