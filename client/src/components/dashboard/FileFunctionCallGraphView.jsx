import React from "react";
import { Cpu, FlaskConical, CheckCircle2, AlertCircle, Sparkles, ArrowDown } from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

export default function FileFunctionCallGraphView({
  filePath,
  fileCoverage,
  testSuites = [],
  onOpenFile,
  onSuggestTestcase,
}) {
  const functions = fileCoverage?.functions || [];
  const totalCalls = functions.reduce((sum, fn) => sum + (fn.hits || 0), 0);
  const coveredFuncs = functions.filter((fn) => (fn.hits || 0) > 0).length;

  // Find relevant test suite if available
  const baseName = filePath.replace(/^(src|app|lib)\//, "").replace(/\.[^.]+$/, "");
  const matchedSuite = testSuites.find(
    (s) => s.filePath?.includes(baseName) || s.fileName?.includes(baseName),
  ) || testSuites[0];

  const testTitle = matchedSuite
    ? `${matchedSuite.fileName} (${matchedSuite.framework || "Unit Test"})`
    : "Unit Test Runner";

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
          background: "rgba(56, 189, 248, 0.08)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Cpu size={15} style={{ color: "#38bdf8" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", fontFamily: "var(--font-mono)" }}>
            Function Call Graph & Execution Flow — {cleanDisplayPath(filePath)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#8b949e" }}>
            Hàm được gọi:{" "}
            <b style={{ color: "#38bdf8" }}>
              {coveredFuncs}/{functions.length} ({functions.length > 0 ? Math.round((coveredFuncs / functions.length) * 100) : 100}%)
            </b>
          </span>

          <span style={{ fontSize: 11, color: "#8b949e" }}>
            Tổng lượt gọi: <b style={{ color: "#22c55e" }}>{totalCalls} calls</b>
          </span>
        </div>
      </div>

      {/* Function Execution Flow Diagram */}
      <div
        style={{
          padding: "26px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          background: "radial-gradient(ellipse at top, rgba(56, 189, 248, 0.03) 0%, transparent 70%)",
        }}
      >
        {/* Top Node: Test Case / Suite */}
        <div
          style={{
            padding: "8px 22px",
            borderRadius: 8,
            background: "rgba(192, 132, 252, 0.12)",
            border: "1.5px solid #c084fc",
            color: "#e9d5ff",
            textAlign: "center",
            boxShadow: "0 2px 14px rgba(192, 132, 252, 0.18)",
            minWidth: 180,
            maxWidth: 320,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#c084fc", letterSpacing: 0.5 }}>
            🧪 Test Case Runner
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", marginTop: 2 }}>
            {testTitle}
          </div>
          {matchedSuite?.passedTests !== undefined && (
            <div style={{ fontSize: 10, color: "#4ade80", marginTop: 2 }}>
              ✓ {matchedSuite.passedTests} passed test cases
            </div>
          )}
        </div>

        {/* Down Arrow from Test to First Function */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#64748b", margin: "2px 0" }}>
          <div style={{ width: 2, height: 20, background: "rgba(255,255,255,0.2)" }} />
          <div style={{ fontSize: 10, marginTop: -4 }}>▼</div>
        </div>

        {/* Function Nodes Chain */}
        {functions.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#6e7681", fontSize: 12 }}>
            Không tìm thấy định nghĩa hàm nào trong file này.
          </div>
        ) : (
          functions.map((fn, index) => {
            const isLast = index === functions.length - 1;
            const calls = fn.hits || 0;
            const isCalled = calls > 0;
            const funcName = fn.realName || fn.name || `function_${index + 1}`;

            return (
              <React.Fragment key={fn.id || index}>
                {/* Function Card */}
                <div
                  style={{
                    padding: "10px 22px",
                    borderRadius: 8,
                    background: isCalled ? "rgba(56, 189, 248, 0.08)" : "rgba(239, 68, 68, 0.08)",
                    border: isCalled ? "1.5px solid rgba(56, 189, 248, 0.4)" : "1.5px dashed #f87171",
                    boxShadow: isCalled ? "0 2px 12px rgba(56, 189, 248, 0.08)" : "0 2px 14px rgba(239, 68, 68, 0.12)",
                    textAlign: "center",
                    minWidth: 190,
                    maxWidth: 320,
                    transition: "all 0.15s ease",
                  }}
                  className="hover:scale-[1.02]"
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                      color: isCalled ? "#ffffff" : "#fca5a5",
                    }}
                  >
                    {funcName}()
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      marginTop: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "1px 7px",
                        borderRadius: 10,
                        background: isCalled ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: isCalled ? "#4ade80" : "#f87171",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {isCalled ? `✓ ${calls} call${calls > 1 ? "s" : ""}` : "⚑ 0 calls (Chưa gọi)"}
                    </span>

                    <span style={{ fontSize: 10, color: "#6e7681", fontFamily: "var(--font-mono)" }}>
                      (Dòng {fn.line})
                    </span>
                  </div>

                  {!isCalled && onSuggestTestcase && (
                    <button
                      onClick={() => onSuggestTestcase(filePath)}
                      style={{
                        marginTop: 6,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "rgba(168, 85, 247, 0.18)",
                        border: "1px solid rgba(168, 85, 247, 0.35)",
                        color: "#c084fc",
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <Sparkles size={10} />
                      <span>Gợi ý test case gọi hàm</span>
                    </button>
                  )}
                </div>

                {/* Connecting Line to Next Function */}
                {!isLast && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#64748b", margin: "2px 0" }}>
                    <div style={{ width: 2, height: 20, background: "rgba(255,255,255,0.2)" }} />
                    <div style={{ fontSize: 10, marginTop: -4 }}>▼</div>
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

