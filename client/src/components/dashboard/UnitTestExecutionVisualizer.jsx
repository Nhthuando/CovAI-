import React, { useState, useMemo } from "react";
import {
  Activity,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Cpu,
  Layers,
  Search,
  Filter,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode,
  FlaskConical,
  BarChart3,
  Timer,
  RefreshCw,
  AlertTriangle,
  FolderCode,
  Gauge,
  SlidersHorizontal,
  Flame,
  Check,
  X,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

export default function UnitTestExecutionVisualizer({
  testSuites = [],
  executions = {},
  sourceFiles = [],
  isLight = false,
  onOpenFile,
  onSelectSourceFile,
  onRunTests,
  running = false,
  runProgress = 0,
  runStep = "",
}) {
  // Mode switcher: "timeline" | "tree" | "performance"
  const [activeTab, setActiveTab] = useState("timeline");

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "passed" | "failed" | "slow"
  const [sortBy, setSortBy] = useState("duration_desc"); // "duration_desc" | "duration_asc" | "name" | "status"

  // Expanded test suites in timeline or tree
  const [expandedSuites, setExpandedSuites] = useState(() => new Set());
  const [selectedTestCase, setSelectedTestCase] = useState(null);

  // Toggle suite expansion
  const toggleSuite = (filePath) => {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSuites(new Set(testSuites.map((s) => s.filePath)));
  };

  const collapseAll = () => {
    setExpandedSuites(new Set());
  };

  // Extract raw test execution data from executions or testSuites
  const jestRun = executions?.jest;
  const vitestRun = executions?.vitest;

  // Flattened assertions across all suites
  const allAssertions = useMemo(() => {
    const list = [];
    testSuites.forEach((suite) => {
      (suite.assertions || []).forEach((tc, idx) => {
        const targetFn =
          tc.targetFunction ||
          (Array.isArray(tc.ancestorTitles) && tc.ancestorTitles.length > 1
            ? tc.ancestorTitles[tc.ancestorTitles.length - 1]
            : null);
        list.push({
          ...tc,
          id: `${suite.filePath}#${idx}`,
          suiteFilePath: suite.filePath,
          suiteFileName: suite.fileName,
          suiteFramework: suite.framework,
          targetFn,
          duration: tc.duration || Math.round((suite.durationMs || 0) / Math.max(1, suite.assertions?.length || 1)),
        });
      });
    });
    return list;
  }, [testSuites]);

  // Global KPIs calculation
  const kpis = useMemo(() => {
    const totalSuites = testSuites.length;
    const passedSuites = testSuites.filter((s) => s.status === "passed" && (s.failedTests || 0) === 0).length;
    const failedSuites = testSuites.filter((s) => s.status === "failed" || (s.failedTests || 0) > 0).length;

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let totalDurationMs = 0;

    testSuites.forEach((s) => {
      totalTests += s.totalTests || (s.assertions?.length || 0);
      passedTests += s.passedTests || 0;
      failedTests += s.failedTests || 0;
      totalDurationMs += s.durationMs || 0;
    });

    if (totalTests === 0 && (jestRun || vitestRun)) {
      totalTests = (jestRun?.totalTests || 0) + (vitestRun?.totalTests || 0);
      passedTests = (jestRun?.passedTests || 0) + (vitestRun?.passedTests || 0);
      failedTests = (jestRun?.failedTests || 0) + (vitestRun?.failedTests || 0);
    }

    const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 100;
    const avgSuiteDuration = totalSuites > 0 ? Math.round(totalDurationMs / totalSuites) : 0;
    const avgTestDuration = totalTests > 0 ? Math.round(totalDurationMs / totalTests) : 0;

    const maxSuiteDuration = testSuites.length > 0 ? Math.max(...testSuites.map((s) => s.durationMs || 0)) : 100;
    const minSuiteDuration = testSuites.length > 0 ? Math.min(...testSuites.map((s) => s.durationMs || 0)) : 0;

    const slowSuitesCount = testSuites.filter((s) => (s.durationMs || 0) >= 100).length;
    const slowTestsCount = allAssertions.filter((a) => (a.duration || 0) >= 40).length;

    return {
      totalSuites,
      passedSuites,
      failedSuites,
      totalTests,
      passedTests,
      failedTests,
      passRate,
      totalDurationMs,
      avgSuiteDuration,
      avgTestDuration,
      maxSuiteDuration: Math.max(maxSuiteDuration, 10),
      minSuiteDuration,
      slowSuitesCount,
      slowTestsCount,
    };
  }, [testSuites, jestRun, vitestRun, allAssertions]);

  // Filtered and sorted suites
  const processedSuites = useMemo(() => {
    let list = [...testSuites];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => {
        const matchFile =
          s.filePath?.toLowerCase().includes(q) ||
          s.fileName?.toLowerCase().includes(q) ||
          s.framework?.toLowerCase().includes(q);
        const matchAssertions = (s.assertions || []).some(
          (a) =>
            a.title?.toLowerCase().includes(q) ||
            a.targetFunction?.toLowerCase().includes(q) ||
            (a.ancestorTitles || []).some((t) => t.toLowerCase().includes(q))
        );
        return matchFile || matchAssertions;
      });
    }

    // Status filter
    if (statusFilter === "passed") {
      list = list.filter((s) => s.status === "passed" && (s.failedTests || 0) === 0);
    } else if (statusFilter === "failed") {
      list = list.filter((s) => s.status === "failed" || (s.failedTests || 0) > 0);
    } else if (statusFilter === "slow") {
      list = list.filter((s) => (s.durationMs || 0) >= 100);
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === "duration_desc") return (b.durationMs || 0) - (a.durationMs || 0);
      if (sortBy === "duration_asc") return (a.durationMs || 0) - (b.durationMs || 0);
      if (sortBy === "name") return (a.fileName || "").localeCompare(b.fileName || "");
      if (sortBy === "status") {
        const scoreA = a.failedTests > 0 ? 0 : a.status === "passed" ? 1 : 2;
        const scoreB = b.failedTests > 0 ? 0 : b.status === "passed" ? 1 : 2;
        return scoreA - scoreB;
      }
      return 0;
    });

    return list;
  }, [testSuites, searchQuery, statusFilter, sortBy]);

  // Card & Container Styles
  const cardStyle = {
    background: isLight ? "#ffffff" : "rgba(255,255,255,0.025)",
    border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    boxShadow: isLight ? "0 1px 3px rgba(15, 23, 42, 0.05)" : "none",
  };

  const isFailed = kpis.failedTests > 0 || kpis.failedSuites > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── 1. EXECUTIVE HEADER & ACTIONS ────────────────────────────────────────── */}
      <div
        style={{
          ...cardStyle,
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 14,
          background: isLight
            ? "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)"
            : "linear-gradient(135deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)",
          borderLeft: isLight
            ? isFailed ? "4px solid #ef4444" : "4px solid #10b981"
            : isFailed ? "4px solid #f87171" : "4px solid #34d399",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: isLight
                ? isFailed ? "#fef2f2" : "#ecfdf5"
                : isFailed ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
              color: isLight
                ? isFailed ? "#dc2626" : "#059669"
                : isFailed ? "#f87171" : "#34d399",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Activity size={24} />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2
                style={{
                  fontSize: 17,
                  fontWeight: 750,
                  color: isLight ? "#0f172a" : "#f1f5f9",
                  margin: 0,
                  letterSpacing: "-0.01em",
                }}
              >
                Test Execution Visualization Unit
              </h2>

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 750,
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: isFailed
                    ? (isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.15)")
                    : (isLight ? "#ecfdf5" : "rgba(16, 185, 129, 0.15)"),
                  color: isFailed
                    ? (isLight ? "#b91c1c" : "#fca5a5")
                    : (isLight ? "#047857" : "#6ee7b7"),
                  border: isFailed
                    ? (isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.3)")
                    : (isLight ? "1px solid #a7f3d0" : "1px solid rgba(16, 185, 129, 0.3)"),
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {isFailed ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                {isFailed ? `${kpis.failedTests} FAILED` : "ALL TESTS PASSED"}
              </span>

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 650,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.06)",
                  color: isLight ? "#475569" : "#94a3b8",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Runner: Jest & Vitest
              </span>
            </div>

            <p
              style={{
                fontSize: 12,
                color: isLight ? "#64748b" : "#94a3b8",
                margin: "4px 0 0 0",
              }}
            >
              Interactive execution waterfall, test suite hierarchy, and execution bottleneck diagnostics
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onRunTests && (
            <button
              onClick={onRunTests}
              disabled={running}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 650,
                cursor: running ? "not-allowed" : "pointer",
                background: isLight ? "#7c3aed" : "#8b5cf6",
                color: "#ffffff",
                border: "none",
                boxShadow: "0 2px 8px rgba(124, 58, 237, 0.25)",
                transition: "all 0.15s ease",
              }}
              title="Execute full unit test suite"
            >
              <RefreshCw size={13} className={running ? "animate-spin" : ""} />
              <span>{running ? "Running Tests..." : "Re-run Unit Tests"}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 2. KPI METRICS CARDS ────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
        }}
      >
        {/* Pass Rate Card */}
        <div
          style={{
            ...cardStyle,
            padding: "14px 16px",
            borderLeft: isLight ? "3px solid #10b981" : "3px solid #34d399",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: isLight ? "#64748b" : "#94a3b8" }}>
              Test Success Rate
            </span>
            <ShieldCheck size={16} style={{ color: kpis.passRate === 100 ? "#10b981" : "#f59e0b" }} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: isLight ? "#0f172a" : "#f8fafc", fontFamily: "var(--font-mono)" }}>
              {kpis.passRate}%
            </span>
            <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8" }}>
              ({kpis.passedTests}/{kpis.totalTests} passed)
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ width: "100%", height: 4, background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
            <div
              style={{
                width: `${kpis.passRate}%`,
                height: "100%",
                background: isFailed ? "#ef4444" : "#10b981",
                borderRadius: 2,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>

        {/* Execution Duration Card */}
        <div
          style={{
            ...cardStyle,
            padding: "14px 16px",
            borderLeft: isLight ? "3px solid #6366f1" : "3px solid #818cf8",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: isLight ? "#64748b" : "#94a3b8" }}>
              Total Execution Time
            </span>
            <Timer size={16} style={{ color: isLight ? "#6366f1" : "#818cf8" }} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: isLight ? "#0f172a" : "#f8fafc", fontFamily: "var(--font-mono)" }}>
              {kpis.totalDurationMs}ms
            </span>
            <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8" }}>
              (avg {kpis.avgSuiteDuration}ms/suite)
            </span>
          </div>
          <div style={{ fontSize: 11, color: isLight ? "#475569" : "#94a3b8", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
            <Zap size={11} style={{ color: "#eab308" }} />
            <span>Fastest: {kpis.minSuiteDuration}ms · Slowest: {kpis.maxSuiteDuration}ms</span>
          </div>
        </div>

        {/* Test Suites Count Card */}
        <div
          style={{
            ...cardStyle,
            padding: "14px 16px",
            borderLeft: isLight ? "3px solid #7c3aed" : "3px solid #c084fc",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: isLight ? "#64748b" : "#94a3b8" }}>
              Active Test Suites
            </span>
            <FlaskConical size={16} style={{ color: isLight ? "#7c3aed" : "#c084fc" }} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: isLight ? "#0f172a" : "#f8fafc", fontFamily: "var(--font-mono)" }}>
              {kpis.totalSuites}
            </span>
            <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8" }}>
              suites executed
            </span>
          </div>
          <div style={{ fontSize: 11, color: isLight ? "#475569" : "#94a3b8", marginTop: 8, display: "flex", gap: 8 }}>
            <span style={{ color: isLight ? "#16a34a" : "#4ade80" }}>✓ {kpis.passedSuites} clean</span>
            {kpis.failedSuites > 0 && <span style={{ color: isLight ? "#dc2626" : "#f87171" }}>× {kpis.failedSuites} failed</span>}
          </div>
        </div>

        {/* Assertions & Bottlenecks Card */}
        <div
          style={{
            ...cardStyle,
            padding: "14px 16px",
            borderLeft: isLight ? "3px solid #0284c7" : "3px solid #38bdf8",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: isLight ? "#64748b" : "#94a3b8" }}>
              Assertions & Latency
            </span>
            <Flame size={16} style={{ color: kpis.slowSuitesCount > 0 ? "#f97316" : "#38bdf8" }} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: isLight ? "#0f172a" : "#f8fafc", fontFamily: "var(--font-mono)" }}>
              {allAssertions.length}
            </span>
            <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8" }}>
              assertions checked
            </span>
          </div>
          <div style={{ fontSize: 11, color: isLight ? "#475569" : "#94a3b8", marginTop: 8 }}>
            {kpis.slowSuitesCount > 0 ? (
              <span style={{ color: isLight ? "#d97706" : "#fbbf24", fontWeight: 650 }}>
                ⚡ {kpis.slowSuitesCount} slow suite(s) (≥100ms)
              </span>
            ) : (
              <span style={{ color: isLight ? "#059669" : "#34d399" }}>
                ⚡ Optimal execution latency
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 3. VISUALIZATION NAVIGATION TABS & FILTER BAR ───────────────────────── */}
      <div
        style={{
          ...cardStyle,
          padding: "10px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Mode Switcher Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {[
            { id: "timeline", label: "Timeline Waterfall", icon: Activity },
            { id: "tree", label: "Execution Hierarchy Tree", icon: Layers },
            { id: "performance", label: "Performance & Bottlenecks", icon: BarChart3 },
          ].map((tab) => {
            const isCurrent = activeTab === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: isCurrent ? 700 : 500,
                  cursor: "pointer",
                  background: isCurrent
                    ? (isLight ? "#ede9fe" : "rgba(124, 58, 237, 0.25)")
                    : "transparent",
                  color: isCurrent
                    ? (isLight ? "#6d28d9" : "#c084fc")
                    : (isLight ? "#475569" : "#94a3b8"),
                  border: isCurrent
                    ? (isLight ? "1px solid #c4b5fd" : "1px solid rgba(192, 132, 252, 0.4)")
                    : "1px solid transparent",
                  transition: "all 0.15s ease",
                }}
              >
                <TabIcon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search & Filter Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Status Filter Pills */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.04)",
              borderRadius: 6,
              padding: 2,
              border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {[
              { id: "all", label: "All" },
              { id: "passed", label: "Passed" },
              { id: "failed", label: "Failed" },
              { id: "slow", label: "Slow (>100ms)" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: statusFilter === f.id ? 700 : 500,
                  borderRadius: 4,
                  cursor: "pointer",
                  border: "none",
                  background: statusFilter === f.id
                    ? (isLight ? "#ffffff" : "rgba(255,255,255,0.12)")
                    : "transparent",
                  color: statusFilter === f.id
                    ? (isLight ? "#0f172a" : "#ffffff")
                    : (isLight ? "#64748b" : "#8b949e"),
                  boxShadow: statusFilter === f.id && isLight ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: isLight ? "#ffffff" : "rgba(255,255,255,0.04)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
            }}
          >
            <Search size={13} style={{ color: isLight ? "#64748b" : "#8b949e" }} />
            <input
              type="text"
              placeholder="Search tests or functions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: isLight ? "#0f172a" : "#e6edf3",
                fontSize: 12,
                width: 140,
              }}
            />
          </div>

          {/* Sort Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: isLight ? "#64748b" : "#8b949e",
            }}
          >
            <ArrowUpDown size={12} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                background: isLight ? "#ffffff" : "rgba(255,255,255,0.05)",
                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "3px 6px",
                fontSize: 11,
                color: isLight ? "#0f172a" : "#e6edf3",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="duration_desc">Slowest First</option>
              <option value="duration_asc">Fastest First</option>
              <option value="name">File Name</option>
              <option value="status">Failures First</option>
            </select>
          </div>

          {/* Expand/Collapse All */}
          <button
            onClick={() => (expandedSuites.size > 0 ? collapseAll() : expandAll())}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              background: isLight ? "#ffffff" : "rgba(255,255,255,0.04)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
              color: isLight ? "#475569" : "#c9d1d9",
              cursor: "pointer",
            }}
            title="Expand or collapse all test suite details"
          >
            {expandedSuites.size > 0 ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

      {/* ── 4. VIEW CONTENT ──────────────────────────────────────────────────────── */}
      {processedSuites.length === 0 ? (
        <div
          style={{
            ...cardStyle,
            padding: 40,
            textAlign: "center",
            color: isLight ? "#64748b" : "#8b949e",
          }}
        >
          <FlaskConical size={32} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
          <div style={{ fontSize: 14, fontWeight: 650, color: isLight ? "#0f172a" : "#e2e8f0" }}>
            No matching test execution data found
          </div>
          <p style={{ fontSize: 12, margin: "6px 0 0 0" }}>
            Try adjusting your search query, or click "Re-run Unit Tests" to generate fresh execution data.
          </p>
        </div>
      ) : activeTab === "timeline" ? (
        /* ── VIEW A: EXECUTION WATERFALL & GANTT TIMELINE ─────────────────────── */
        <div style={{ ...cardStyle, overflow: "hidden", padding: 0 }}>
          {/* Timeline Header & Scale Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px, 320px) 1fr",
              padding: "10px 18px",
              background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)",
              borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.06)",
              fontSize: 11,
              fontWeight: 700,
              color: isLight ? "#64748b" : "#8b949e",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            <span>Test Suite File</span>
            <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 10, paddingRight: 10 }}>
              <span>0ms</span>
              <span>{Math.round(kpis.maxSuiteDuration * 0.25)}ms</span>
              <span>{Math.round(kpis.maxSuiteDuration * 0.5)}ms</span>
              <span>{Math.round(kpis.maxSuiteDuration * 0.75)}ms</span>
              <span>{kpis.maxSuiteDuration}ms max</span>
            </div>
          </div>

          {/* Timeline Rows */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {processedSuites.map((suite, suiteIdx) => {
              const isExpanded = expandedSuites.has(suite.filePath);
              const duration = suite.durationMs || 0;
              const pctWidth = Math.min(100, Math.max(8, Math.round((duration / kpis.maxSuiteDuration) * 100)));
              const isSuiteFailed = suite.status === "failed" || (suite.failedTests || 0) > 0;
              const isSlow = duration >= 100;
              const cleanPath = cleanDisplayPath(suite.filePath);

              return (
                <div
                  key={suite.filePath || suiteIdx}
                  style={{
                    borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,0.04)",
                    background: isExpanded
                      ? (isLight ? "#faf5ff" : "rgba(124, 58, 237, 0.04)")
                      : "transparent",
                    transition: "background 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(260px, 320px) 1fr",
                      padding: "10px 18px",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    {/* Left: Suite Identifier & Toggle */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          fontFamily: "var(--font-mono, monospace)",
                          color: isLight ? "#64748b" : "#94a3b8",
                          background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)",
                          border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                          borderRadius: 5,
                          padding: "1px 5px",
                          minWidth: 22,
                          textAlign: "center",
                          flexShrink: 0,
                        }}
                      >
                        {suiteIdx + 1}
                      </span>
                      <button
                        onClick={() => toggleSuite(suite.filePath)}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 2,
                          cursor: "pointer",
                          color: isLight ? "#64748b" : "#94a3b8",
                          display: "flex",
                          alignItems: "center",
                        }}
                        title={isExpanded ? "Collapse assertions" : "Expand assertions"}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>

                      {isSuiteFailed ? (
                        <XCircle size={15} style={{ color: isLight ? "#dc2626" : "#f87171", flexShrink: 0 }} />
                      ) : (
                        <CheckCircle2 size={15} style={{ color: isLight ? "#16a34a" : "#4ade80", flexShrink: 0 }} />
                      )}

                      <div
                        onClick={() => onOpenFile?.(suite.filePath)}
                        style={{
                          cursor: "pointer",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={`Open test file: ${suite.filePath}`}
                      >
                        <div style={{ fontSize: 12.5, fontWeight: 650, color: isLight ? "#0f172a" : "#f1f5f9", fontFamily: "var(--font-mono)" }}>
                          {suite.fileName}
                        </div>
                        <div style={{ fontSize: 10.5, color: isLight ? "#64748b" : "#8b949e", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {cleanPath}
                        </div>
                      </div>

                      {/* Framework badge */}
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 750,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: suite.framework === "vitest"
                            ? (isLight ? "#e0f2fe" : "rgba(56, 189, 248, 0.15)")
                            : (isLight ? "#f3e8ff" : "rgba(192, 132, 252, 0.15)"),
                          color: suite.framework === "vitest"
                            ? (isLight ? "#0369a1" : "#38bdf8")
                            : (isLight ? "#7e22ce" : "#c084fc"),
                          textTransform: "uppercase",
                          marginLeft: "auto",
                          flexShrink: 0,
                        }}
                      >
                        {suite.framework}
                      </span>
                    </div>

                    {/* Right: Gantt Duration Bar */}
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      {/* Grid background reference lines */}
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          top: 0,
                          bottom: 0,
                          display: "flex",
                          justifyContent: "space-between",
                          pointerEvents: "none",
                          opacity: 0.15,
                        }}
                      >
                        <div style={{ width: 1, background: isLight ? "#000" : "#fff", height: "100%" }} />
                        <div style={{ width: 1, background: isLight ? "#000" : "#fff", height: "100%" }} />
                        <div style={{ width: 1, background: isLight ? "#000" : "#fff", height: "100%" }} />
                        <div style={{ width: 1, background: isLight ? "#000" : "#fff", height: "100%" }} />
                      </div>

                      {/* Proportional Duration Bar */}
                      <div
                        onClick={() => toggleSuite(suite.filePath)}
                        style={{
                          width: `${pctWidth}%`,
                          height: 24,
                          borderRadius: 6,
                          background: isSuiteFailed
                            ? "linear-gradient(90deg, #ef4444 0%, #b91c1c 100%)"
                            : isSlow
                              ? "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)"
                              : "linear-gradient(90deg, #10b981 0%, #059669 100%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0 8px",
                          color: "#ffffff",
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                          cursor: "pointer",
                          boxShadow: isSuiteFailed
                            ? "0 2px 6px rgba(239, 68, 68, 0.3)"
                            : isSlow
                              ? "0 2px 6px rgba(245, 158, 11, 0.3)"
                              : "0 2px 6px rgba(16, 185, 129, 0.25)",
                          transition: "width 0.3s ease, transform 0.15s ease",
                        }}
                        title={`Suite: ${suite.fileName} · Duration: ${duration}ms · Assertions: ${suite.assertions?.length || 0}`}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {isSlow && <Flame size={12} />}
                          <span>{duration}ms</span>
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.9 }}>
                          {suite.passedTests || suite.assertions?.length || 0} passed
                        </span>
                      </div>

                      {/* External Link button */}
                      <button
                        onClick={() => onOpenFile?.(suite.filePath)}
                        style={{
                          marginLeft: 10,
                          padding: 4,
                          background: "transparent",
                          border: "none",
                          color: isLight ? "#94a3b8" : "#64748b",
                          cursor: "pointer",
                        }}
                        title="Open test file in Monaco Editor"
                      >
                        <ExternalLink size={13} />
                      </button>
                    </div>
                  </div>

                  {/* ── EXPANDED ASSERTIONS BREAKDOWN ─────────────────────── */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: "10px 18px 14px 44px",
                        background: isLight ? "#f8fafc" : "rgba(0,0,0,0.25)",
                        borderTop: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,0.03)",
                      }}
                    >
                      {/* Failure Banner */}
                      {suite.message && (
                        <div
                          style={{
                            padding: "8px 12px",
                            borderRadius: 6,
                            background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.1)",
                            border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.25)",
                            color: isLight ? "#991b1b" : "#fca5a5",
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                            whiteSpace: "pre-wrap",
                            marginBottom: 10,
                            maxHeight: 180,
                            overflowY: "auto",
                          }}
                        >
                          <span style={{ fontWeight: 700, display: "block", marginBottom: 3 }}>
                            ⚠ Error Trace in {suite.fileName}:
                          </span>
                          {suite.message}
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: isLight ? "#64748b" : "#94a3b8",
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Assertions & Scenarios in {suite.fileName} ({suite.assertions?.length || 0}):
                      </div>

                      {(!suite.assertions || suite.assertions.length === 0) ? (
                        <div style={{ fontSize: 11, color: isLight ? "#94a3b8" : "#64748b", fontStyle: "italic" }}>
                          No granular test case assertions returned for this suite.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {suite.assertions.map((tc, tcIdx) => {
                            const tcPassed = tc.status === "passed";
                            const tcDuration = tc.duration || Math.round(duration / Math.max(1, suite.assertions.length));
                            const targetFn =
                              tc.targetFunction ||
                              (Array.isArray(tc.ancestorTitles) && tc.ancestorTitles.length > 1
                                ? tc.ancestorTitles[tc.ancestorTitles.length - 1]
                                : null);

                            return (
                              <div
                                key={tcIdx}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "26px 20px minmax(200px, 1fr) auto 120px",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "6px 10px",
                                  borderRadius: 6,
                                  background: isLight ? "#ffffff" : "rgba(255,255,255,0.02)",
                                  border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.04)",
                                  fontSize: 11.5,
                                  fontFamily: "var(--font-mono)",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: isLight ? "#94a3b8" : "#64748b",
                                    fontFamily: "var(--font-mono)",
                                    textAlign: "center",
                                  }}
                                >
                                  #{tcIdx + 1}
                                </span>
                                {tcPassed ? (
                                  <Check size={13} style={{ color: isLight ? "#16a34a" : "#4ade80" }} />
                                ) : (
                                  <X size={13} style={{ color: isLight ? "#dc2626" : "#f87171" }} />
                                )}

                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  <span style={{ color: isLight ? "#0f172a" : "#f1f5f9" }}>{tc.title}</span>
                                </div>

                                {targetFn ? (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: isLight ? "#eff6ff" : "rgba(59, 130, 246, 0.15)",
                                      color: isLight ? "#1d4ed8" : "#60a5fa",
                                      border: isLight ? "1px solid #bfdbfe" : "1px solid rgba(59, 130, 246, 0.3)",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={`Target function: ${targetFn}`}
                                  >
                                    ƒ {targetFn}
                                  </span>
                                ) : <div />}

                                {/* Assertion Mini Timeline Bar */}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                                  <div
                                    style={{
                                      width: Math.min(60, Math.max(10, Math.round((tcDuration / Math.max(1, duration)) * 60))),
                                      height: 6,
                                      borderRadius: 3,
                                      background: tcPassed
                                        ? (isLight ? "#10b981" : "#34d399")
                                        : (isLight ? "#ef4444" : "#f87171"),
                                    }}
                                  />
                                  <span style={{ color: isLight ? "#64748b" : "#8b949e", fontSize: 10.5 }}>
                                    {tcDuration}ms
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === "tree" ? (
        /* ── VIEW B: EXECUTION HIERARCHY TREE GRAPH ───────────────────────────── */
        <div style={{ ...cardStyle, padding: "18px 20px" }}>
          {/* Root node */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 8,
              background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.05)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
              marginBottom: 16,
            }}
          >
            <Terminal size={18} style={{ color: isLight ? "#7c3aed" : "#c084fc" }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 750, color: isLight ? "#0f172a" : "#f8fafc" }}>
                Unit Test Engine Root (Jest & Vitest Runtime)
              </div>
              <div style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8" }}>
                Total {kpis.totalSuites} suites · {kpis.totalTests} tests · Total execution {kpis.totalDurationMs}ms
              </div>
            </div>
          </div>

          {/* Suites branch list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingLeft: 16, borderLeft: isLight ? "2px dashed #cbd5e1" : "2px dashed rgba(255,255,255,0.15)" }}>
            {processedSuites.map((suite, suiteIdx) => {
              const isSuiteFailed = suite.status === "failed" || (suite.failedTests || 0) > 0;
              const assertions = suite.assertions || [];

              return (
                <div
                  key={suite.filePath}
                  style={{
                    borderRadius: 8,
                    background: isLight ? "#ffffff" : "rgba(255,255,255,0.02)",
                    border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.06)",
                    padding: 12,
                  }}
                >
                  {/* Suite Node Header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                      marginBottom: assertions.length > 0 ? 10 : 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          fontFamily: "var(--font-mono, monospace)",
                          color: isLight ? "#64748b" : "#94a3b8",
                          background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)",
                          border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                          borderRadius: 5,
                          padding: "1px 5px",
                          minWidth: 22,
                          textAlign: "center",
                        }}
                      >
                        {suiteIdx + 1}
                      </span>
                      {isSuiteFailed ? (
                        <XCircle size={15} style={{ color: "#ef4444" }} />
                      ) : (
                        <CheckCircle2 size={15} style={{ color: "#10b981" }} />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9", fontFamily: "var(--font-mono)" }}>
                        {suite.fileName}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: isLight ? "#ede9fe" : "rgba(124, 58, 237, 0.15)",
                          color: isLight ? "#6d28d9" : "#c084fc",
                        }}
                      >
                        {suite.framework}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e", fontFamily: "var(--font-mono)" }}>
                        ⏱ {suite.durationMs || 0}ms
                      </span>
                      <button
                        onClick={() => onOpenFile?.(suite.filePath)}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 600,
                          background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.06)",
                          border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                          color: isLight ? "#334155" : "#e2e8f0",
                          cursor: "pointer",
                        }}
                      >
                        Open File
                      </button>
                    </div>
                  </div>

                  {/* Child Assertions Sub-tree */}
                  {assertions.length > 0 && (
                    <div
                      style={{
                        paddingLeft: 14,
                        borderLeft: isLight ? "2px solid #e2e8f0" : "2px solid rgba(255,255,255,0.06)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {assertions.map((tc, idx) => {
                        const targetFn =
                          tc.targetFunction ||
                          (Array.isArray(tc.ancestorTitles) && tc.ancestorTitles.length > 1
                            ? tc.ancestorTitles[tc.ancestorTitles.length - 1]
                            : null);
                        const isTcPassed = tc.status === "passed";

                        return (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              fontSize: 11.5,
                              fontFamily: "var(--font-mono)",
                              padding: "4px 8px",
                              borderRadius: 4,
                              background: isLight ? "#f8fafc" : "rgba(0,0,0,0.15)",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: isLight ? "#94a3b8" : "#64748b",
                                  fontFamily: "var(--font-mono)",
                                  minWidth: 20,
                                }}
                              >
                                #{idx + 1}
                              </span>
                              {isTcPassed ? (
                                <Check size={12} style={{ color: "#10b981", flexShrink: 0 }} />
                              ) : (
                                <X size={12} style={{ color: "#ef4444", flexShrink: 0 }} />
                              )}
                              <span
                                style={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  color: isTcPassed
                                    ? (isLight ? "#334155" : "#cbd5e1")
                                    : (isLight ? "#dc2626" : "#fca5a5"),
                                }}
                              >
                                {tc.title}
                              </span>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              {targetFn && (
                                <span
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                    background: isLight ? "#eff6ff" : "rgba(59, 130, 246, 0.15)",
                                    color: isLight ? "#1d4ed8" : "#60a5fa",
                                  }}
                                >
                                  ƒ {targetFn}
                                </span>
                              )}
                              <span style={{ fontSize: 10.5, color: isLight ? "#64748b" : "#8b949e" }}>
                                {tc.duration ? `${tc.duration}ms` : ""}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── VIEW C: PERFORMANCE & BOTTLENECK ANALYTICS ────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Top Bottleneck Leaderboard */}
          <div style={{ ...cardStyle, padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Flame size={18} style={{ color: "#f97316" }} />
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9" }}>
                  Execution Latency Ranking (Top Slowest Suites)
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: isLight ? "#64748b" : "#8b949e" }}>
                  Bottleneck analysis to detect slow assertions, expensive fixtures, or heavy mocking overhead
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...processedSuites]
                .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
                .slice(0, 5)
                .map((suite, idx) => {
                  const duration = suite.durationMs || 0;
                  const pct = Math.round((duration / kpis.maxSuiteDuration) * 100);

                  return (
                    <div
                      key={suite.filePath}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        background: isLight ? "#f8fafc" : "rgba(255,255,255,0.02)",
                        border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.05)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: 4,
                              background: idx === 0 ? "#f97316" : isLight ? "#e2e8f0" : "rgba(255,255,255,0.1)",
                              color: idx === 0 ? "#fff" : isLight ? "#334155" : "#e2e8f0",
                              fontSize: 11,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            #{idx + 1}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9", fontFamily: "var(--font-mono)" }}>
                            {suite.fileName}
                          </span>
                          <span style={{ fontSize: 10, color: isLight ? "#64748b" : "#8b949e" }}>
                            ({suite.assertions?.length || 0} assertions)
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 750, color: isLight ? "#0f172a" : "#f8fafc", fontFamily: "var(--font-mono)" }}>
                            {duration}ms
                          </span>
                          <button
                            onClick={() => onOpenFile?.(suite.filePath)}
                            style={{
                              fontSize: 10.5,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: isLight ? "#ffffff" : "rgba(255,255,255,0.06)",
                              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                              color: isLight ? "#334155" : "#cbd5e1",
                              cursor: "pointer",
                            }}
                          >
                            Inspect
                          </button>
                        </div>
                      </div>

                      {/* Distribution bar */}
                      <div style={{ width: "100%", height: 6, background: isLight ? "#e2e8f0" : "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: idx === 0 ? "#f97316" : isLight ? "#6366f1" : "#818cf8",
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Test Suites to Source Files Coverage Mapping Matrix */}
          <div style={{ ...cardStyle, padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <FolderCode size={18} style={{ color: isLight ? "#0284c7" : "#38bdf8" }} />
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9" }}>
                  Test Suite & Source File Coverage Alignment
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: isLight ? "#64748b" : "#8b949e" }}>
                  Correlating unit test execution files with corresponding implementation source files
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
              {processedSuites.map((suite) => {
                const baseNameNoExt = suite.fileName.replace(/\.(spec|test)\.(ts|js|jsx|tsx)$/, "");
                const matchedSource = sourceFiles.find((sf) =>
                  sf.filePath?.toLowerCase().includes(baseNameNoExt.toLowerCase())
                );

                return (
                  <div
                    key={suite.filePath}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: isLight ? "#ffffff" : "rgba(255,255,255,0.02)",
                      border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <FlaskConical size={13} style={{ color: isLight ? "#7c3aed" : "#c084fc" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9", fontFamily: "var(--font-mono)" }}>
                        {suite.fileName}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>↳ Verified Source:</span>
                      {matchedSource ? (
                        <span
                          onClick={() => onSelectSourceFile?.(matchedSource.filePath)}
                          style={{
                            color: isLight ? "#2563eb" : "#60a5fa",
                            fontWeight: 600,
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                          title={`Click to inspect coverage for ${matchedSource.filePath}`}
                        >
                          {matchedSource.filePath.split(/[/\\]/).pop()} ({matchedSource.linesPct ?? 0}% lines)
                        </span>
                      ) : (
                        <span style={{ fontStyle: "italic", opacity: 0.7 }}>Module test suite</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
