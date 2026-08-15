import React, { useState, useEffect, useCallback } from "react";

import {
    getCoverageSummary,
    getCoverageFiles,
    runSupertestCoverage,
    getTestExecution,
} from "../../services/coverage.service.js";

async function handleResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status === 401) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            localStorage.removeItem("userName");
            localStorage.removeItem("userEmail");
            window.location.href = "/login";
        }
        throw new Error(data.message || "Failed API call");
    }
    return data;
}

async function getCoverageSummaryApi(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/summary`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

async function getCoverageFilesApi(snapshotId, { sortBy = "filePath", order = "asc", page = 1, limit = 200 } = {}) {
    const params = new URLSearchParams({ sortBy, order, page, limit });
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/files?${params}`, {
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

// ── UI helpers ────────────────────────────────────────────────
const getCoverageColor = (pct) => {
    if (pct == null) return { color: "#6e7681", bg: "rgba(110,118,129,0.12)", border: "rgba(110,118,129,0.25)" };
    if (pct >= 90) return { color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.25)" };
    if (pct >= 70) return { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)" };
    return { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.25)" };
};

const getCoverageGradient = (pct) => {
    if (pct == null) return "rgba(110,118,129,0.3)";
    if (pct >= 90) return "linear-gradient(90deg, #22c55e, #4ade80)";
    if (pct >= 70) return "linear-gradient(90deg, #f59e0b, #fbbf24)";
    return "linear-gradient(90deg, #ef4444, #f87171)";
};

const fmt = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

// ── Sub-components ────────────────────────────────────────────
const OverallRing = ({ value }) => {
    const theme = getCoverageColor(value);
    const circumference = 2 * Math.PI * 54;
    const offset = value != null ? circumference - (value / 100) * circumference : circumference;
    return (
        <div style={{ position: "relative", width: 140, height: 140, flexShrink: 0 }} title="Percentage of code covered by tests">
            <svg width={140} height={140} style={{ transform: "rotate(-90deg)" }}>
                <circle cx={70} cy={70} r={54} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
                <circle cx={70} cy={70} r={54} fill="none" stroke={theme.color} strokeWidth={10}
                    strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
                    style={{ transition: "stroke-dashoffset 1s ease-out", filter: `drop-shadow(0 0 8px ${theme.color}80)` }}
                />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: theme.color, letterSpacing: "-0.02em" }}>
                    {value != null ? `${Number(value).toFixed(1)}%` : "—"}
                </span>
                <span style={{ fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2, textAlign: "center" }}>Covered</span>
            </div>
        </div>
    );
};

const MetricCard = ({ label, desc, value, color = "#f0f6fc" }) => (
    <div style={{
        flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4,
        minWidth: 160
    }} title={desc}>
        <span style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 24, fontWeight: 700, color, letterSpacing: "-0.02em" }}>{value}</span>
        <span style={{ fontSize: 11, color: "#6e7681", marginTop: 4, lineHeight: 1.4 }}>{desc}</span>
    </div>
);

const TestExecutionCard = ({ type, results }) => {
    if (!results) return (
        <div style={{
            flex: 1, background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: 14, padding: "20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minWidth: 240
        }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#484f58" }}>{type}</span>
            <span style={{ fontSize: 12, color: "#484f58" }}>No execution data</span>
        </div>
    );

    const passRate = results.totalTests > 0 ? (results.passedTests / results.totalTests) * 100 : 0;
    const duration = (results.durationMs / 1000).toFixed(1);

    return (
        <div style={{
            flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14, padding: "20px", display: "flex", flexDirection: "column", gap: 12, minWidth: 240
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#a78bfa" }}>{type}</span>
                <span style={{ fontSize: 12, color: "#6e7681" }}>{duration}s</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: "#f0f6fc" }}>{results.totalTests}</span>
                    <span style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase" }}>Tests</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: "#22c55e" }}>{results.passedTests}</span>
                    <span style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase" }}>Passed</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: results.failedTests > 0 ? "#ef4444" : "#f0f6fc" }}>{results.failedTests}</span>
                    <span style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase" }}>Failed</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: "#6e7681" }}>{results.skippedTests}</span>
                    <span style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase" }}>Skipped</span>
                </div>
            </div>
            <div style={{ marginTop: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#8b949e" }}>Pass Rate</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: getCoverageColor(passRate).color }}>{passRate.toFixed(1)}%</span>
                </div>
                <MiniBar pct={passRate} color={getCoverageColor(passRate).color} />
            </div>
        </div>
    );
};

const FileStatusCard = ({ label, count, color, desc }) => (
    <div style={{
        flex: 1, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
        minWidth: 130
    }} title={desc}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: "#f0f6fc", lineHeight: 1 }}>{count}</span>
            <span style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>{label}</span>
        </div>
    </div>
);

const MiniBar = ({ pct, color }) => (
    <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
            height: "100%", width: `${pct ?? 0}%`,
            background: color, borderRadius: 99,
            transition: "width 0.8s ease-out",
        }} />
    </div>
);

const CoverageBar = ({ pct }) => {
    const theme = getCoverageColor(pct);
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
            <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{
                    height: "100%", width: `${pct ?? 0}%`,
                    background: getCoverageGradient(pct), borderRadius: 99,
                    boxShadow: `0 0 8px ${theme.color}50`, transition: "width 0.8s ease-out",
                }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: theme.color, minWidth: 48, textAlign: "right" }}>
                {fmt(pct)}
            </span>
        </div>
    );
};

const FileRow = ({ file, index, onOpenFile }) => {
    const mainPct = file.linesPct;
    const theme = getCoverageColor(mainPct);
    const statusText = mainPct == null ? "Untested" : mainPct >= 90 ? "Good" : mainPct >= 70 ? "Warning" : "Critical";

    return (
        <div
            style={{
                display: "flex", alignItems: "center", gap: 20,
                padding: "20px",
                background: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)"}
        >
            {/* Icon */}
            <div style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: theme.bg, border: `1px solid ${theme.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
            }}>
                <svg width={18} height={18} viewBox="0 0 14 14" fill="none">
                    <path d="M2 1.5A.5.5 0 0 1 2.5 1h6L11 3.5V12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-11Z" stroke={theme.color} strokeWidth={1.5} />
                    <path d="M8.5 1v3h3" stroke={theme.color} strokeWidth={1.5} strokeLinecap="round" />
                </svg>
            </div>

            {/* File path + bars */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <span style={{
                        fontSize: 15, fontWeight: 500, color: "#e6edf3",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                    }}>
                        {file.filePath}
                    </span>
                    <span style={{
                        padding: "3px 10px", borderRadius: 12,
                        background: theme.bg, border: `1px solid ${theme.border}`,
                        fontSize: 11, fontWeight: 700, color: theme.color,
                        textTransform: "uppercase"
                    }}>
                        {statusText}
                    </span>
                </div>

                {/* Lines bar (chính) */}
                <CoverageBar pct={file.linesPct} />

                {/* Mini bars: branches / funcs / stmts */}
                <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {[
                        { label: "Branches", pct: file.branchesPct, color: "#38bdf8", tooltip: "Percentage of branches (If/Else) executed" },
                        { label: "Functions", pct: file.funcsPct, color: "#a78bfa", tooltip: "Percentage of functions called during tests" },
                        { label: "Statements", pct: file.stmtsPct, color: "#fb923c", tooltip: "Percentage of statements executed successfully" },
                    ].map(({ label, pct, color, tooltip }) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 120 }} title={tooltip}>
                            <span style={{ fontSize: 11, color: "#6e7681", fontWeight: 600, minWidth: 65 }}>{label}</span>
                            <MiniBar pct={pct} color={color} />
                            <span style={{ fontSize: 11, color, fontWeight: 600, minWidth: 36, textAlign: "right" }}>{fmt(pct)}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Action button */}
            <button
                onClick={() => onOpenFile && onOpenFile(file.filePath)}
                style={{
                    background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
                    color: "#c4b5fd", borderRadius: 8, padding: "10px 16px", fontSize: 13,
                    cursor: "pointer", fontFamily: "inherit", fontWeight: 600, flexShrink: 0,
                    display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(124,58,237,0.25)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(124,58,237,0.15)"; e.currentTarget.style.transform = "translateY(0)"; }}
                title="Click to view code details line by line"
            >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
                View Code
            </button>
        </div>
    );
};

// ── Loading / Error / Empty states ────────────────────────────
const Spinner = () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", width: "100%", gap: 16, color: "#8b949e" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid rgba(124,58,237,0.2)", borderTopColor: "#a78bfa", animation: "spin 0.8s linear infinite" }} />
        <span style={{ fontSize: 14 }}>Loading report data...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
);

const ErrorState = ({ message, onRetry }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", width: "100%", gap: 12 }}>
        <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 12, padding: "16px 24px", color: "#f87171", fontSize: 14, maxWidth: 480,
        }}>
            <svg width={18} height={18} viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                <circle cx={9} cy={9} r={8} stroke="#ef4444" strokeWidth={1.5} />
                <path d="M9 5v4M9 12v.5" stroke="#ef4444" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
            {message}
        </div>
        {onRetry && (
            <button onClick={onRetry} style={{
                background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
                color: "#a78bfa", borderRadius: 8, padding: "8px 18px", fontSize: 13,
                cursor: "pointer", fontFamily: "inherit",
            }}>
                Retry
            </button>
        )}
    </div>
);

// ── Main Component ────────────────────────────────────────────
const CoverageDashboard = ({ snapshotId, projectId, onOpenFile }) => {
    const [summary, setSummary] = useState(null);
    const [testRuns, setTestRuns] = useState([]);
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortBy, setSortBy] = useState("linesPct");
    const [order, setOrder] = useState("asc");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState(null);
    const [isRunningSupertest, setIsRunningSupertest] = useState(false);

    const LIMIT = 50;

    const fetchData = useCallback(async () => {
        if (!snapshotId) { setLoading(false); return; }
        setLoading(true);
        setError(null);
        try {
            const [sumRes, filesRes, testRes] = await Promise.all([
                getCoverageSummary(snapshotId),
                getCoverageFiles(snapshotId, {
                    sortBy,
                    order,
                    page,
                    limit: LIMIT,
                }),
                getTestExecution(snapshotId),
            ]);
            setSummary(sumRes.data);
            setFiles(filesRes.data.files ?? []);
            setPagination(filesRes.data.pagination ?? null);
            setTestRuns(testRes.data ?? []);
        } catch (err) {
            setError(err.message || "Failed to load coverage data.");
        } finally {
            setLoading(false);
        }
    }, [snapshotId, sortBy, order, page]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleRunSupertest = async () => {
        if (!snapshotId || isRunningSupertest) return;
        setIsRunningSupertest(true);
        try {
            await runSupertestCoverage(snapshotId);
        } catch (err) {
            setError(err.message || "Unable to start Supertest coverage.");
        } finally {
            setIsRunningSupertest(false);
        }
    };

    // Reset page khi sort thay đổi
    const toggleSort = (field) => {
        if (sortBy === field) setOrder(o => o === "asc" ? "desc" : "asc");
        else { setSortBy(field); setOrder("asc"); }
        setPage(1);
    };

    const SortIcon = ({ field }) => {
        if (sortBy !== field) return <span style={{ color: "#484f58" }}>↕</span>;
        return <span style={{ color: "#a78bfa" }}>{order === "asc" ? "↑" : "↓"}</span>;
    };

    // Client-side search filter (trên page hiện tại)
    const filtered = files.filter(f =>
        f.filePath.toLowerCase().includes(search.toLowerCase())
    );

    if (loading) return <Spinner />;
    if (error) return <ErrorState message={error} onRetry={fetchData} />;
    if (!summary) return <ErrorState message="No data available. Please run tests first." />;

    const cov = summary.coverage;

    const jestRun = testRuns.jest;
    const supertestRun = testRuns.supertest;

    const highCount = files.filter(f => (f.linesPct ?? 0) >= 90).length;
    const warnCount = files.filter(f => (f.linesPct ?? 0) >= 70 && (f.linesPct ?? 0) < 90).length;
    const lowCount = files.filter(f => (f.linesPct ?? 0) < 70).length;

    return (
        <div style={{
            display: "flex", flexDirection: "column",
            width: "100%",
            background: "var(--ide-bg, #0d1117)",
            color: "var(--text-primary, #f0f6fc)",
            fontFamily: "var(--font-sans, -apple-system, sans-serif)",
            padding: "28px 36px", boxSizing: "border-box",
        }}>

            {/* ── Header ── */}
            <div style={{ marginBottom: 20, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#f0f6fc", letterSpacing: "-0.025em", margin: 0, marginBottom: 4 }}>
                            Test Coverage Dashboard
                        </h1>
                        <p style={{ fontSize: 13, color: "#6e7681", margin: 0 }}>
                            <span style={{ color: "#a78bfa", fontWeight: 500 }}>{summary.projectName}</span>
                            {summary.commitSha && (
                                <span style={{
                                    marginLeft: 8, fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "#484f58",
                                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                                    borderRadius: 6, padding: "2px 7px"
                                }}>
                                    {summary.commitSha.slice(0, 7)}
                                </span>
                            )}
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={handleRunSupertest} disabled={!snapshotId || isRunningSupertest} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.35)",
                            borderRadius: 8, color: "#c4b5fd", fontSize: 12, fontWeight: 600,
                            cursor: isRunningSupertest ? "wait" : "pointer", padding: "7px 14px", fontFamily: "inherit",
                            opacity: !snapshotId || isRunningSupertest ? 0.65 : 1,
                        }}>
                            {isRunningSupertest ? "Queuing Supertest..." : "Run Supertest"}
                        </button>
                        <button onClick={fetchData} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 8, color: "#8b949e", fontSize: 12, fontWeight: 500,
                            cursor: "pointer", padding: "7px 14px", fontFamily: "inherit",
                        }}>
                            <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                                <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                                <path d="M6 1.5 8 3.5 6 5.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Hero: Health & Metrics ── */}
            <div style={{
                display: "flex", alignItems: "stretch", gap: 24,
                marginBottom: 18, flexShrink: 0, flexWrap: "wrap"
            }}>
                {/* Health Score */}
                <div style={{
                    display: "flex", alignItems: "center", gap: 24,
                    background: "linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 18, padding: "22px 28px", flex: "1 1 300px"
                }}>
                    <OverallRing value={cov.lines} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#f0f6fc" }}>Project Health</h3>
                        <p style={{ margin: 0, fontSize: 13, color: "#8b949e", lineHeight: 1.5 }}>
                            Score based on the percentage of code lines executed during tests. {cov.lines >= 80 ? "The project is in a safe state." : cov.lines >= 50 ? "More tests needed for better safety." : "Code severely lacks tests!"}
                        </p>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <FileStatusCard label="Good" count={highCount} color="#22c55e" desc="Coverage above 90%" />
                            <FileStatusCard label="Warning" count={warnCount} color="#f59e0b" desc="Coverage between 70% and 90%" />
                            <FileStatusCard label="Critical" count={lowCount} color="#ef4444" desc="Coverage below 70%" />
                        </div>
                    </div>
                </div>

                {/* Detailed Metrics */}
                <div style={{
                    display: "flex", gap: 12, flexWrap: "wrap", flex: "2 1 400px",
                    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 18, padding: "22px"
                }}>
                    <MetricCard label="Logic Branches" desc="Percentage of branches (If/Else) executed" value={fmt(cov.branches)} color="#38bdf8" />
                    <MetricCard label="Functions" desc="Percentage of functions called during tests" value={fmt(cov.functions)} color="#a78bfa" />
                    <MetricCard label="Statements" desc="Percentage of statements executed successfully" value={fmt(cov.statements)} color="#fb923c" />
                </div>
            </div>

            {/* ── Test Execution ── */}
            <div style={{ marginBottom: 24, flexShrink: 0 }}>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: "#f0f6fc", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m12 14 4-4" />
                        <path d="m3.34 19 1.4-1.4" />
                        <path d="m19.07 4.93-1.41 1.41" />
                        <rect x="2" y="2" width="20" height="20" rx="5" />
                        <path d="m9 9 6 6" />
                    </svg>
                    Test Execution
                </h3>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <TestExecutionCard type="Jest" results={jestRun} />
                    <TestExecutionCard type="Supertest" results={supertestRun} />
                </div>
            </div>

            {/* ── Legend + Search ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexShrink: 0, flexWrap: "wrap" }}>
                <div style={{ flex: 1 }} />
                <div style={{ position: "relative" }}>
                    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                        <circle cx={6} cy={6} r={5} stroke="#484f58" strokeWidth={1.5} />
                        <path d="M10 10l2.5 2.5" stroke="#484f58" strokeWidth={1.5} strokeLinecap="round" />
                    </svg>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by file name..."
                        style={{
                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 8, color: "#c9d1d9", fontSize: 13, padding: "6px 12px 6px 28px",
                            outline: "none", width: 220, fontFamily: "inherit",
                        }}
                    />
                </div>
            </div>

            {/* ── File Table ── */}
            <div style={{
                flex: 1, minHeight: 0,
                display: "flex", flexDirection: "column",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 18, overflow: "hidden",
            }}>
                {/* Sticky header */}
                <div style={{
                    display: "flex", alignItems: "center", gap: 16,
                    padding: "11px 20px", flexShrink: 0,
                    background: "rgba(255,255,255,0.035)",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                }}>
                    <div style={{ width: 42, flexShrink: 0 }} />
                    <button onClick={() => toggleSort("filePath")} style={{
                        flex: 1, textAlign: "left", background: "none", border: "none",
                        fontSize: 11, fontWeight: 700, color: "#6e7681", textTransform: "uppercase",
                        letterSpacing: "0.08em", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                        fontFamily: "inherit",
                    }}>
                        File Path <SortIcon field="filePath" />
                    </button>
                    {[
                        { label: "Coverage Level", field: "linesPct" },
                    ].map(({ label, field }) => (
                        <button key={field} onClick={() => toggleSort(field)} style={{
                            background: "none", border: "none",
                            fontSize: 11, fontWeight: 700, color: sortBy === field ? "#a78bfa" : "#6e7681",
                            textTransform: "uppercase", letterSpacing: "0.08em",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                            fontFamily: "inherit", minWidth: 120, justifyContent: "flex-end",
                            marginRight: 20
                        }}>
                            {label} <SortIcon field={field} />
                        </button>
                    ))}
                    <div style={{ minWidth: 120 }} />
                </div>

                {/* Scrollable rows */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: "48px 0", textAlign: "center", color: "#484f58", fontSize: 14 }}>
                            {search ? "No matching files found." : "No data available."}
                        </div>
                    ) : (
                        filtered.map((file, i) => <FileRow key={file.id} file={file} index={i} onOpenFile={onOpenFile} />)
                    )}
                </div>

                {/* Footer + pagination */}
                <div style={{
                    padding: "10px 20px", flexShrink: 0,
                    background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.05)",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                }}>
                    <span style={{ fontSize: 12, color: "#484f58" }}>
                        {search
                            ? `Showing ${filtered.length} / ${files.length} files (page ${page})`
                            : `Page ${page}/${pagination?.totalPages ?? 1} · ${pagination?.total ?? files.length} files`
                        }
                    </span>
                    {pagination && pagination.totalPages > 1 && !search && (
                        <div style={{ display: "flex", gap: 6 }}>
                            <button
                                disabled={page <= 1}
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                style={{
                                    background: page <= 1 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
                                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
                                    color: page <= 1 ? "#484f58" : "#c9d1d9", fontSize: 12,
                                    cursor: page <= 1 ? "not-allowed" : "pointer", padding: "4px 10px", fontFamily: "inherit",
                                }}
                            >← Prev</button>
                            <button
                                disabled={page >= pagination.totalPages}
                                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                                style={{
                                    background: page >= pagination.totalPages ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
                                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
                                    color: page >= pagination.totalPages ? "#484f58" : "#c9d1d9", fontSize: 12,
                                    cursor: page >= pagination.totalPages ? "not-allowed" : "pointer", padding: "4px 10px", fontFamily: "inherit",
                                }}
                            >Next →</button>
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
};

export default CoverageDashboard;
