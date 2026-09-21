import React, { useState, useMemo } from "react";
import { GitBranch, CheckCircle2, AlertCircle, Sparkles, ArrowDown, Network } from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

export default function FileBranchCFGView({
  filePath,
  fileCoverage,
  onOpenFile,
  onSuggestTestcase,
}) {
  const branches = fileCoverage?.branches || [];
  const functions = fileCoverage?.functions || [];
  const sourceCode = fileCoverage?.sourceCode || "";

  // Group branches by function or by line
  const functionsWithCfg = useMemo(() => {
    if (functions.length === 0) {
      // Fallback: create a synthetic function container for the file
      return [
        {
          name: cleanDisplayPath(filePath),
          startLine: 1,
          endLine: 999,
          branches: branches,
        },
      ];
    }

    return functions.map((fn) => {
      const fnStart = fn.startLine || fn.line || 1;
      const fnEnd = fn.endLine || 9999;
      const fnBranches = branches.filter(
        (b) => b.line >= fnStart && b.line <= fnEnd,
      );
      return {
        ...fn,
        name: fn.realName || fn.name || `function_${fn.id}`,
        branches: fnBranches,
      };
    });
  }, [functions, branches, filePath]);

  const [selectedFnIndex, setSelectedFnIndex] = useState(0);
  const activeFn = functionsWithCfg[selectedFnIndex] || functionsWithCfg[0];

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background: "#090d13",
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "rgba(251, 191, 36, 0.08)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GitBranch size={15} style={{ color: "#fbbf24" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", fontFamily: "var(--font-mono)" }}>
            Control Flow Graph (CFG) — {cleanDisplayPath(filePath)}
          </span>
        </div>

        {/* Function Selector Tabs */}
        {functionsWithCfg.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#8b949e" }}>Hàm:</span>
            {functionsWithCfg.map((fn, idx) => {
              const isSelected = idx === selectedFnIndex;
              const hasBranches = fn.branches.length > 0;
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedFnIndex(idx)}
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    fontWeight: isSelected ? 700 : 500,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: isSelected ? "rgba(251, 191, 36, 0.2)" : "rgba(255, 255, 255, 0.04)",
                    color: isSelected ? "#fbbf24" : "#8b949e",
                    border: isSelected ? "1px solid rgba(251, 191, 36, 0.4)" : "1px solid rgba(255, 255, 255, 0.06)",
                    cursor: "pointer",
                  }}
                >
                  {fn.name}() {hasBranches ? `(${fn.branches.length} rẽ nhánh)` : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* CFG Graph Canvas */}
      <div
        style={{
          padding: "24px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          background: "radial-gradient(ellipse at top, rgba(251, 191, 36, 0.03) 0%, transparent 70%)",
        }}
      >
        {/* Function Entry Node */}
        <div
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            background: "rgba(56, 189, 248, 0.12)",
            border: "1.5px solid #38bdf8",
            color: "#38bdf8",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            boxShadow: "0 2px 12px rgba(56, 189, 248, 0.15)",
            textAlign: "center",
            minWidth: 150,
          }}
        >
          {activeFn?.name || "function"}()
        </div>

        {/* Down Arrow */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#64748b" }}>
          <div style={{ width: 2, height: 16, background: "rgba(255,255,255,0.2)" }} />
          <div style={{ fontSize: 10, marginTop: -4 }}>▼</div>
        </div>

        {/* If Function Has Branches */}
        {activeFn?.branches && activeFn.branches.length > 0 ? (
          activeFn.branches.map((branch, bIdx) => {
            const truePath = branch.paths?.find((p) => p.type === "True") || branch.paths?.[0];
            const falsePath = branch.paths?.find((p) => p.type === "False") || branch.paths?.[1];

            const isTrueCovered = (truePath?.hits || 0) > 0;
            const isFalseCovered = (falsePath?.hits || 0) > 0;

            // Clean condition snippet
            let condText = branch.condition || branch.fullConditionText || "condition";
            if (!condText.endsWith("?")) condText += " ?";

            // Clean true snippet
            const trueCode = truePath?.codeSnippet
              ?.replace(/return\s+/, "")
              ?.replace(/;$/, "") || "true";

            // Clean false snippet
            const falseCode = falsePath?.codeSnippet
              ?.replace(/return\s+/, "")
              ?.replace(/;$/, "") || "false";

            return (
              <div
                key={branch.id || bIdx}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: "100%",
                  maxWidth: 580,
                }}
              >
                {/* Decision Condition Node */}
                <div
                  style={{
                    padding: "9px 22px",
                    borderRadius: 8,
                    background: "rgba(251, 191, 36, 0.12)",
                    border: "1.5px solid #fbbf24",
                    color: "#fde047",
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    boxShadow: "0 2px 14px rgba(251, 191, 36, 0.15)",
                    textAlign: "center",
                    minWidth: 160,
                  }}
                >
                  {condText}
                </div>

                {/* Split Paths Diagram */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 32,
                    width: "100%",
                    marginTop: 8,
                  }}
                >
                  {/* TRUE Path Column */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        color: isTrueCovered ? "#4ade80" : "#f87171",
                        fontFamily: "var(--font-mono)",
                        marginBottom: 4,
                      }}
                    >
                      <span>TRUE</span>
                      <span style={{ fontSize: 12 }}>{isTrueCovered ? "🟢" : "🔴"}</span>
                      <span style={{ fontSize: 10, color: "#8b949e" }}>
                        ({truePath?.hits || 0} hits)
                      </span>
                    </div>

                    <div style={{ width: 2, height: 16, background: isTrueCovered ? "#22c55e" : "#ef4444" }} />
                    <div style={{ fontSize: 10, color: isTrueCovered ? "#22c55e" : "#ef4444", marginTop: -4 }}>▼</div>

                    {/* True Block Box */}
                    <div
                      style={{
                        marginTop: 4,
                        padding: "8px 16px",
                        borderRadius: 6,
                        background: isTrueCovered ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        border: isTrueCovered ? "1px solid rgba(34, 197, 94, 0.35)" : "1.5px dashed #f87171",
                        color: isTrueCovered ? "#86efac" : "#fca5a5",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: "center",
                        width: "85%",
                        minHeight: 38,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {trueCode}
                    </div>

                    {/* Connector line down to return */}
                    <div style={{ width: 2, height: 20, background: "rgba(255,255,255,0.15)", marginTop: 4 }} />
                  </div>

                  {/* FALSE Path Column */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        color: isFalseCovered ? "#4ade80" : "#f87171",
                        fontFamily: "var(--font-mono)",
                        marginBottom: 4,
                      }}
                    >
                      <span>FALSE</span>
                      <span style={{ fontSize: 12 }}>{isFalseCovered ? "🟢" : "🔴"}</span>
                      <span style={{ fontSize: 10, color: "#8b949e" }}>
                        ({falsePath?.hits || 0} hits)
                      </span>
                    </div>

                    <div style={{ width: 2, height: 16, background: isFalseCovered ? "#22c55e" : "#ef4444" }} />
                    <div style={{ fontSize: 10, color: isFalseCovered ? "#22c55e" : "#ef4444", marginTop: -4 }}>▼</div>

                    {/* False Block Box */}
                    <div
                      style={{
                        marginTop: 4,
                        padding: "8px 16px",
                        borderRadius: 6,
                        background: isFalseCovered ? "rgba(56, 189, 248, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        border: isFalseCovered ? "1px solid rgba(56, 189, 248, 0.35)" : "1.5px dashed #f87171",
                        color: isFalseCovered ? "#bae6fd" : "#fca5a5",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: "center",
                        width: "85%",
                        minHeight: 38,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {falseCode}
                    </div>

                    {/* Connector line down to return */}
                    <div style={{ width: 2, height: 20, background: "rgba(255,255,255,0.15)", marginTop: 4 }} />
                  </div>
                </div>

                {/* Missing Branch Warning & Suggest Button */}
                {(!isTrueCovered || !isFalseCovered) && onSuggestTestcase && (
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#f87171" }}>
                      ⚠️ Còn nhánh chưa được kiểm thử
                    </span>
                    <button
                      onClick={() => onSuggestTestcase(filePath)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: "rgba(168, 85, 247, 0.2)",
                        border: "1px solid rgba(168, 85, 247, 0.4)",
                        color: "#c084fc",
                        fontSize: 11,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      <Sparkles size={11} />
                      <span>Gợi ý testcase</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          /* Function has no branches: straight pipeline */
          <div
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#c9d1d9",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            Thực thi tuần tự (Không có rẽ nhánh điều kiện)
          </div>
        )}

        {/* Merge Arrow to Return */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#64748b", marginTop: -6 }}>
          <div style={{ width: 2, height: 16, background: "rgba(255,255,255,0.2)" }} />
          <div style={{ fontSize: 10, marginTop: -4 }}>▼</div>
        </div>

        {/* Exit / Return Node */}
        <div
          style={{
            padding: "7px 24px",
            borderRadius: 8,
            background: "rgba(168, 85, 247, 0.12)",
            border: "1.5px solid #a855f7",
            color: "#c084fc",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            boxShadow: "0 2px 12px rgba(168, 85, 247, 0.15)",
            textAlign: "center",
            minWidth: 120,
          }}
        >
          return
        </div>
      </div>
    </div>
  );
}

