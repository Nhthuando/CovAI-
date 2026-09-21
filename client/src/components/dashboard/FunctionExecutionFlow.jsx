import React, { useState, useMemo } from "react";
import {
  Cpu,
  CheckCircle2,
  AlertCircle,
  Code2,
  Network,
  Search,
  ExternalLink,
  BarChart3
} from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

const cardStyle = {
  background: "rgba(255,255,255,.025)",
  border: "1px solid rgba(255,255,255,.075)",
  borderRadius: 12,
  padding: 16,
};

export default function FunctionExecutionFlow({
  functionsList = [],
  loading = false,
  onOpenFile,
  onSuggestTestcase,
  onOpenCfg,
}) {
  const [filterMode, setFilterMode] = useState("all"); // "all" | "uncalled" | "called"
  const [searchQuery, setSearchQuery] = useState("");

  // Clean real names if needed
  const cleanedFunctions = useMemo(() => {
    return functionsList.map((fn) => {
      let displayName = fn.realName || fn.functionName || "anonymous";
      if (displayName.startsWith("(") || displayName.startsWith("anonymous")) {
        // Try to derive from decl or location
        if (fn.filePath && fn.startLine) {
          displayName = `func_L${fn.startLine}`;
        }
      }
      return {
        ...fn,
        displayName,
      };
    });
  }, [functionsList]);

  // Max invocations for proportional bar
  const maxHits = useMemo(() => {
    if (cleanedFunctions.length === 0) return 1;
    return Math.max(1, ...cleanedFunctions.map((f) => f.hit || 0));
  }, [cleanedFunctions]);

  const totalHits = useMemo(() => {
    return cleanedFunctions.reduce((sum, f) => sum + (f.hit || 0), 0);
  }, [cleanedFunctions]);

  const totalFns = cleanedFunctions.length;
  const calledFns = cleanedFunctions.filter((f) => (f.hit || 0) > 0).length;
  const uncalledFns = cleanedFunctions.filter((f) => (f.hit || 0) === 0).length;
  const funcsPct =
    totalFns > 0 ? Number(((calledFns / totalFns) * 100).toFixed(1)) : 100;

  // Filtered functions
  const filteredFunctions = useMemo(() => {
    let list = cleanedFunctions;
    if (filterMode === "uncalled") {
      list = list.filter((f) => (f.hit || 0) === 0);
    } else if (filterMode === "called") {
      list = list.filter((f) => (f.hit || 0) > 0);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (f) =>
          f.displayName?.toLowerCase().includes(q) ||
          f.functionName?.toLowerCase().includes(q) ||
          f.filePath?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [cleanedFunctions, filterMode, searchQuery]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top Overview & Stats Bar */}
      <div
        style={{
          ...cardStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 14,
          background: "rgba(56, 189, 248, 0.03)",
          borderColor: "rgba(56, 189, 248, 0.15)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              background: "rgba(56, 189, 248, 0.12)",
              color: "#38bdf8",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Cpu size={16} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              Sơ đồ luồng phương thức & hàm (Method Execution Map)
            </span>
          </div>
        </div>

        {/* Stats Badges */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 11,
              color: "#8b949e",
            }}
          >
            Tổng số hàm: <b style={{ color: "#e6edf3" }}>{totalFns} hàm</b>
          </div>

          <div
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 11,
              color: "#8b949e",
            }}
          >
            Đã gọi:{" "}
            <b style={{ color: "#38bdf8" }}>
              {calledFns}/{totalFns} ({funcsPct}%)
            </b>
          </div>

          <div
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 11,
              color: "#8b949e",
            }}
          >
            Tổng số lượt gọi:{" "}
            <b style={{ color: "#22c55e" }}>{totalHits} lượt gọi</b>
          </div>

          {uncalledFns > 0 && (
            <div
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                fontSize: 11,
                color: "#fca5a5",
                fontWeight: 600,
              }}
            >
              ⚑ {uncalledFns} hàm chưa được gọi
            </div>
          )}
        </div>
      </div>

      {/* Comparative Execution Throughput Bar */}
      {totalFns > 0 && totalHits > 0 && (
        <div
          style={{
            ...cardStyle,
            padding: "12px 16px",
            background: "rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              fontSize: 11,
              fontWeight: 650,
              color: "#8b949e",
              textTransform: "uppercase",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 size={13} style={{ color: "#38bdf8" }} />
              Phân bổ số lượt gọi giữa các phương thức
            </span>
            <span>Tổng: {totalHits} lần gọi</span>
          </div>

          {/* Multi-color distribution bar */}
          <div
            style={{
              width: "100%",
              height: 10,
              borderRadius: 5,
              background: "rgba(255,255,255,0.06)",
              display: "flex",
              overflow: "hidden",
            }}
          >
            {cleanedFunctions
              .filter((f) => (f.hit || 0) > 0)
              .map((fn, i) => {
                const colors = [
                  "#38bdf8",
                  "#a78bfa",
                  "#34d399",
                  "#fbbf24",
                  "#f472b6",
                  "#60a5fa",
                ];
                const color = colors[i % colors.length];
                const pctWidth = Math.max(
                  3,
                  Math.round(((fn.hit || 0) / totalHits) * 100),
                );

                return (
                  <div
                    key={fn.id || i}
                    style={{
                      width: `${pctWidth}%`,
                      height: "100%",
                      background: color,
                      borderRight: "1px solid rgba(0,0,0,0.5)",
                    }}
                    title={`${fn.displayName}(): ${fn.hit} lượt gọi (${pctWidth}%)`}
                  />
                );
              })}
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 8,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
          >
            {cleanedFunctions
              .filter((f) => (f.hit || 0) > 0)
              .slice(0, 6)
              .map((fn, i) => {
                const colors = [
                  "#38bdf8",
                  "#a78bfa",
                  "#34d399",
                  "#fbbf24",
                  "#f472b6",
                  "#60a5fa",
                ];
                const color = colors[i % colors.length];
                return (
                  <div
                    key={fn.id || i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      color: "#c9d1d9",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: color,
                      }}
                    />
                    <span>{fn.displayName}()</span>
                    <span style={{ color: "#8b949e", fontSize: 10 }}>
                      ({fn.hit}x)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { id: "all", label: `Tất cả (${totalFns})` },
            { id: "called", label: `✓ Đã gọi (${calledFns})`, color: "#38bdf8" },
            {
              id: "uncalled",
              label: `⚑ Chưa gọi (${uncalledFns})`,
              color: "#fbbf24",
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterMode(tab.id)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "5px 12px",
                borderRadius: 6,
                cursor: "pointer",
                background:
                  filterMode === tab.id
                    ? tab.color
                      ? `${tab.color}25`
                      : "rgba(56, 189, 248, 0.2)"
                    : "rgba(255,255,255,0.04)",
                color:
                  filterMode === tab.id
                    ? tab.color || "#38bdf8"
                    : "#8b949e",
                border:
                  filterMode === tab.id
                    ? `1px solid ${tab.color || "rgba(56, 189, 248, 0.4)"}`
                    : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 12,
          }}
        >
          <Search size={13} style={{ color: "#8b949e" }} />
          <input
            type="text"
            placeholder="Tìm tên hàm hoặc file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#e6edf3",
              fontSize: 12,
              width: 170,
            }}
          />
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            ...cardStyle,
            padding: 40,
            textAlign: "center",
            color: "#8b949e",
          }}
        >
          Đang tải dữ liệu sơ đồ luồng hàm...
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredFunctions.length === 0 && (
        <div
          style={{
            ...cardStyle,
            padding: 30,
            textAlign: "center",
            color: "#8b949e",
          }}
        >
          {cleanedFunctions.length === 0
            ? "Chưa có dữ liệu hàm. Hãy bấm 'Run Analysis' để phân tích Jest/Vitest."
            : "Không tìm thấy hàm phù hợp với bộ lọc."}
        </div>
      )}

      {/* METHOD EXECUTION CARDS GRID */}
      {!loading && filteredFunctions.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {filteredFunctions.map((fn, idx) => {
            const isCalled = (fn.hit || 0) > 0;
            const hitRatio = maxHits > 0 ? (fn.hit || 0) / maxHits : 0;

            return (
              <div
                key={fn.id || idx}
                style={{
                  ...cardStyle,
                  background: isCalled
                    ? "rgba(56, 189, 248, 0.03)"
                    : "rgba(251, 191, 36, 0.03)",
                  border: isCalled
                    ? "1px solid rgba(56, 189, 248, 0.2)"
                    : "1px solid rgba(251, 191, 36, 0.25)",
                  boxShadow: isCalled
                    ? "0 4px 12px rgba(0,0,0,0.2)"
                    : "0 4px 12px rgba(251, 191, 36, 0.05)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 12,
                  transition: "all 0.15s ease",
                }}
                className="hover:border-white/20 transition-all"
              >
                <div>
                  {/* Card Header: Name + Badge */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 8,
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: isCalled
                            ? "rgba(56, 189, 248, 0.15)"
                            : "rgba(251, 191, 36, 0.15)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: isCalled ? "#38bdf8" : "#fbbf24",
                          flexShrink: 0,
                        }}
                      >
                        <Code2 size={16} />
                      </div>

                      <div style={{ overflow: "hidden" }}>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 14,
                            fontWeight: 700,
                            color: isCalled ? "#e6edf3" : "#fde68a",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={fn.displayName}
                        >
                          {fn.displayName}()
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#8b949e",
                            fontFamily: "var(--font-mono)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={fn.filePath}
                        >
                          {cleanDisplayPath(fn.filePath)}
                        </div>
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 750,
                        padding: "2px 7px",
                        borderRadius: 10,
                        background: isCalled
                          ? "rgba(34, 197, 94, 0.15)"
                          : "rgba(251, 191, 36, 0.15)",
                        color: isCalled ? "#4ade80" : "#fde047",
                        border: isCalled
                          ? "1px solid rgba(34, 197, 94, 0.3)"
                          : "1px solid rgba(251, 191, 36, 0.3)",
                        flexShrink: 0,
                      }}
                    >
                      {isCalled ? "✓ PASS" : "⚑ UNCALLED"}
                    </span>
                  </div>

                  {/* Execution Metric Gauge */}
                  <div
                    style={{
                      background: "rgba(0,0,0,0.35)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      border: "1px solid rgba(255,255,255,0.05)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 10, color: "#8b949e" }}>
                        Số lượt thực thi
                      </div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 750,
                          fontFamily: "var(--font-mono)",
                          color: isCalled ? "#22c55e" : "#fbbf24",
                        }}
                      >
                        {isCalled ? `${fn.hit} hits` : "0 hits"}
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "#8b949e" }}>
                        Vị trí dòng
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontFamily: "var(--font-mono)",
                          color: "#c9d1d9",
                        }}
                      >
                        L{fn.startLine || fn.line || 1}
                        {fn.endLine && fn.endLine !== fn.startLine
                          ? ` - L${fn.endLine}`
                          : ""}
                      </div>
                    </div>
                  </div>

                  {/* Frequency Progress Bar */}
                  <div
                    style={{
                      width: "100%",
                      height: 4,
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 2,
                      marginTop: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round(hitRatio * 100)}%`,
                        height: "100%",
                        background: isCalled ? "#38bdf8" : "#fbbf24",
                        borderRadius: 2,
                      }}
                    />
                  </div>
                </div>

                {/* Actions Footer */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 8,
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    gap: 6,
                  }}
                >
                  <button
                    onClick={() => onOpenFile?.(fn.filePath)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 8px",
                      borderRadius: 5,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#c9d1d9",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                    title="Mở file mã nguồn tại vị trí hàm"
                  >
                    <Code2 size={12} />
                    <span>Mở code</span>
                  </button>

                  <div style={{ display: "flex", gap: 6 }}>
                    {onOpenCfg && (
                      <button
                        onClick={() => onOpenCfg(fn.filePath, fn.displayName)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          borderRadius: 5,
                          background: "rgba(56, 189, 248, 0.12)",
                          border: "1px solid rgba(56, 189, 248, 0.3)",
                          color: "#38bdf8",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                        title="Xem Control Flow Graph (CFG) của hàm này"
                      >
                        <Network size={12} />
                        <span>Xem CFG</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

