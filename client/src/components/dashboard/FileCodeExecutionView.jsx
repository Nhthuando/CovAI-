import React, { useMemo, useState } from "react";
import { FileCode, CheckCircle2, AlertCircle, Sparkles, Filter } from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

export default function FileCodeExecutionView({
  filePath,
  fileCoverage,
  onOpenFile,
  onSuggestTestcase,
}) {
  const sourceCode = fileCoverage?.sourceCode || "";
  const linesMap = fileCoverage?.lines || {};
  const statements = fileCoverage?.statements || [];
  const summary = fileCoverage?.summary || {};

  const [filterMode, setFilterMode] = useState("all"); // "all" | "covered" | "missed"

  const codeLines = useMemo(() => {
    if (!sourceCode) return [];
    return sourceCode.split("\n");
  }, [sourceCode]);

  // Index statements by line number for fallback and enrichment
  const stmtsByLine = useMemo(() => {
    const map = {};
    statements.forEach((stmt) => {
      const start = stmt.startLine || 1;
      const end = stmt.endLine || start;
      for (let l = start; l <= end; l++) {
        if (!map[l]) map[l] = [];
        map[l].push(stmt);
      }
    });
    return map;
  }, [statements]);

  // Helper to extract line coverage details with full compatibility for object and number forms
  const getLineData = useMemo(() => {
    return (lineNum) => {
      const rawLine = linesMap[lineNum] ?? linesMap[String(lineNum)];
      const stmtsOnLine = stmtsByLine[lineNum] || [];

      let hits = null;
      let status = null;
      let error = null;
      let reason = null;

      if (rawLine !== undefined && rawLine !== null) {
        if (typeof rawLine === "number") {
          hits = rawLine;
          status = rawLine > 0 ? "covered" : "uncovered";
        } else if (typeof rawLine === "object") {
          hits = typeof rawLine.hits === "number" ? rawLine.hits : (rawLine.status === "covered" ? 1 : 0);
          status = rawLine.status || (hits > 0 ? "covered" : "uncovered");
          error = rawLine.error;
          reason = rawLine.reason;
        }
      } else if (stmtsOnLine.length > 0) {
        hits = Math.max(...stmtsOnLine.map((s) => s.hits ?? 0));
        status = hits > 0 ? "covered" : "uncovered";
      }

      const isExecutable = hits !== null;
      const isFailed = status === "failed";
      const isCovered = isExecutable && !isFailed && (status === "covered" || hits > 0);
      const isMissed = isExecutable && !isFailed && (status === "uncovered" || hits === 0);

      return {
        isExecutable,
        hits: hits ?? 0,
        isCovered,
        isMissed,
        isFailed,
        status,
        error,
        reason,
        statements: stmtsOnLine,
      };
    };
  }, [linesMap, stmtsByLine]);

  // Calculate statistics across all lines
  const { executableLines, coveredLines, missedLines, failedLines, maxHits } = useMemo(() => {
    let exec = 0;
    let cov = 0;
    let miss = 0;
    let fail = 0;
    let max = 1;

    // Evaluate over code lines if sourceCode exists, else over linesMap keys
    const totalLinesToCheck = codeLines.length > 0 ? codeLines.length : Math.max(...Object.keys(linesMap).map(Number), 0);
    for (let i = 1; i <= totalLinesToCheck; i++) {
      const info = getLineData(i);
      if (info.isExecutable) {
        exec += 1;
        if (info.isFailed) fail += 1;
        else if (info.isCovered) cov += 1;
        else if (info.isMissed) miss += 1;
        if (info.hits > max) max = info.hits;
      }
    }

    return {
      executableLines: exec,
      coveredLines: cov,
      missedLines: miss,
      failedLines: fail,
      maxHits: max,
    };
  }, [codeLines, linesMap, getLineData]);

  // Statement counts
  const totalStatements = summary?.stmtsTotal ?? statements.length;
  const coveredStatements = summary?.stmtsCovered ?? (statements.length > 0 ? statements.filter((s) => s.covered || (s.hits || 0) > 0).length : coveredLines);
  const stmtsPct = summary?.stmtsPct ?? (totalStatements > 0 ? Math.round((coveredStatements / totalStatements) * 100) : (executableLines > 0 ? Math.round((coveredLines / executableLines) * 100) : 100));

  // Filter lines to display based on active filterMode
  const visibleLineEntries = useMemo(() => {
    return codeLines.map((codeText, index) => {
      const lineNum = index + 1;
      const info = getLineData(lineNum);
      return { lineNum, codeText, ...info };
    }).filter((item) => {
      if (filterMode === "covered") return item.isCovered;
      if (filterMode === "missed") return item.isMissed || item.isFailed;
      return true;
    });
  }, [codeLines, getLineData, filterMode]);

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
      {/* View Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "rgba(167, 139, 250, 0.08)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileCode size={15} style={{ color: "#a78bfa" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", fontFamily: "var(--font-mono)" }}>
            Statement Coverage — {cleanDisplayPath(filePath)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Statement & Line summary */}
          <span style={{ fontSize: 11, color: "#8b949e" }}>
            Bao phủ câu lệnh:{" "}
            <b style={{ color: stmtsPct >= 80 ? "#4ade80" : stmtsPct >= 60 ? "#fbbf24" : "#f87171" }}>
              {totalStatements > 0 ? `${coveredStatements}/${totalStatements}` : `${coveredLines}/${executableLines}`} ({stmtsPct}%)
            </b>
            {executableLines > 0 && (
              <span style={{ marginLeft: 6, color: "#6e7681" }}>
                ({coveredLines}/{executableLines} dòng)
              </span>
            )}
          </span>

          {missedLines > 0 ? (
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 10,
                background: "rgba(239, 68, 68, 0.15)",
                color: "#f87171",
                fontWeight: 600,
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              ⚑ {missedLines} dòng chưa chạy
            </span>
          ) : executableLines > 0 ? (
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 10,
                background: "rgba(34, 197, 94, 0.15)",
                color: "#4ade80",
                fontWeight: 600,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              ✓ 100% Bao phủ
            </span>
          ) : null}

          {/* Quick Line Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(255,255,255,0.03)", padding: 2, borderRadius: 5, border: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => setFilterMode("all")}
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 3,
                border: "none",
                background: filterMode === "all" ? "rgba(167, 139, 250, 0.25)" : "transparent",
                color: filterMode === "all" ? "#c084fc" : "#8b949e",
                cursor: "pointer",
                fontWeight: filterMode === "all" ? 700 : 500,
              }}
            >
              Tất cả ({codeLines.length})
            </button>
            <button
              onClick={() => setFilterMode("covered")}
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 3,
                border: "none",
                background: filterMode === "covered" ? "rgba(34, 197, 94, 0.2)" : "transparent",
                color: filterMode === "covered" ? "#4ade80" : "#8b949e",
                cursor: "pointer",
                fontWeight: filterMode === "covered" ? 700 : 500,
              }}
            >
              Đã chạy ({coveredLines})
            </button>
            {missedLines > 0 && (
              <button
                onClick={() => setFilterMode("missed")}
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 3,
                  border: "none",
                  background: filterMode === "missed" ? "rgba(239, 68, 68, 0.2)" : "transparent",
                  color: filterMode === "missed" ? "#f87171" : "#8b949e",
                  cursor: "pointer",
                  fontWeight: filterMode === "missed" ? 700 : 500,
                }}
              >
                Chưa chạy ({missedLines})
              </button>
            )}
          </div>

          {onOpenFile && (
            <button
              onClick={() => onOpenFile(filePath)}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#c9d1d9",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Mở trong Editor
            </button>
          )}
        </div>
      </div>

      {/* Code Container */}
      <div
        style={{
          maxHeight: 480,
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: "22px",
          padding: "6px 0",
        }}
      >
        {visibleLineEntries.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#6e7681" }}>
            {codeLines.length === 0
              ? "Chưa có nội dung mã nguồn của file này."
              : "Không có dòng nào phù hợp với bộ lọc đã chọn."}
          </div>
        ) : (
          visibleLineEntries.map(({ lineNum, codeText, isExecutable, isCovered, isMissed, isFailed, hits, error, reason }) => {
            const lineNumStr = String(lineNum).padStart(2, "0");

            let rowBg = "transparent";
            let borderLeft = "3px solid transparent";

            if (isFailed) {
              rowBg = "rgba(239, 68, 68, 0.12)";
              borderLeft = "3px solid #ef4444";
            } else if (isMissed) {
              rowBg = "rgba(239, 68, 68, 0.08)";
              borderLeft = "3px solid #ef4444";
            } else if (isCovered) {
              rowBg = "rgba(34, 197, 94, 0.03)";
              borderLeft = "3px solid #22c55e";
            }

            return (
              <div
                key={lineNum}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "2px 16px",
                  background: rowBg,
                  borderLeft: borderLeft,
                  transition: "background 0.1s ease",
                }}
                className="hover:bg-white/[0.04]"
                title={error ? `Lỗi: ${error}` : reason ? reason : isCovered ? `Đã thực thi ${hits} lần` : ""}
              >
                {/* Line number */}
                <span
                  style={{
                    width: 32,
                    color: isMissed || isFailed ? "#f87171" : isCovered ? "#8b949e" : "#484f58",
                    textAlign: "right",
                    userSelect: "none",
                    fontWeight: isCovered || isMissed ? 600 : 400,
                    marginRight: 12,
                  }}
                >
                  {lineNumStr}
                </span>

                {/* Separator */}
                <span
                  style={{
                    color: "rgba(255, 255, 255, 0.12)",
                    userSelect: "none",
                    marginRight: 14,
                  }}
                >
                  │
                </span>

                {/* Code text */}
                <span
                  style={{
                    flex: 1,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: isMissed || isFailed
                      ? "#fca5a5"
                      : isCovered
                        ? "#e6edf3"
                        : "#8b949e",
                  }}
                >
                  {codeText || " "}
                </span>

                {/* Hits Badge on the right */}
                {isExecutable && (
                  <div
                    style={{
                      marginLeft: 16,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "1px 7px",
                        borderRadius: 4,
                        background: isFailed
                          ? "rgba(239, 68, 68, 0.2)"
                          : isCovered
                            ? "rgba(34, 197, 94, 0.14)"
                            : "rgba(239, 68, 68, 0.15)",
                        color: isFailed ? "#fca5a5" : isCovered ? "#4ade80" : "#f87171",
                        border: isFailed
                          ? "1px solid rgba(239, 68, 68, 0.4)"
                          : isCovered
                            ? "1px solid rgba(34, 197, 94, 0.3)"
                            : "1px solid rgba(239, 68, 68, 0.3)",
                      }}
                    >
                      {isFailed
                        ? "× Failed"
                        : isCovered
                          ? `✓ ${hits} hit${hits > 1 ? "s" : ""}`
                          : "⚑ 0 hits"}
                    </span>

                    {isMissed && onSuggestTestcase && (
                      <button
                        onClick={() => onSuggestTestcase(filePath)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: "rgba(168, 85, 247, 0.15)",
                          border: "1px solid rgba(168, 85, 247, 0.35)",
                          color: "#c084fc",
                          fontSize: 10,
                          cursor: "pointer",
                        }}
                        title="AI gợi ý test case bao phủ dòng này"
                      >
                        <Sparkles size={10} />
                        <span>Suggest</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
