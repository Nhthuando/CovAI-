import React, { useState, useEffect, useCallback } from "react";

import {
    getCoverageSummary,
    getCoverageFiles,
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
        <div style={{ position: "relative", width: 140, height: 140, flexShrink: 0 }}>
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
                <span style={{ fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>Lines</span>
            </div>
        </div>
    );
};

const StatPill = ({ label, value, color = "#f0f6fc" }) => (
    <div style={{
        flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4,
    }}>
        <span style={{ fontSize: 11, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: "-0.02em" }}>{value}</span>
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
            <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{
                    height: "100%", width: `${pct ?? 0}%`,
                    background: getCoverageGradient(pct), borderRadius: 99,
                    boxShadow: `0 0 8px ${theme.color}50`, transition: "width 0.8s ease-out",
                }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: theme.color, minWidth: 48, textAlign: "right" }}>
                {fmt(pct)}
            </span>
        </div>
    );
};

const FileRow = ({ file, index }) => {
    // Dùng linesPct làm coverage chính để hiển thị badge + màu
    const mainPct = file.linesPct;
    const theme = getCoverageColor(mainPct);

    return (
        <div
            style={{
                display: "flex", alignItems: "center", gap: 16,
                padding: "16px 20px",
                background: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)"}
        >
            {/* Icon */}
            <div style={{
                width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                background: theme.bg, border: `1px solid ${theme.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
            }}>
                <svg width={16} height={16} viewBox="0 0 14 14" fill="none">
                    <path d="M2 1.5A.5.5 0 0 1 2.5 1h6L11 3.5V12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-11Z" stroke={theme.color} strokeWidth={1.2} />
                    <path d="M8.5 1v3h3" stroke={theme.color} strokeWidth={1.2} strokeLinecap="round" />
                </svg>
            </div>

            {/* File path + bars */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                    fontSize: 15, fontWeight: 500, color: "#c9d1d9",
                    display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                    marginBottom: 8,
                }}>
                    {file.filePath}
                </span>

                {/* Lines bar (chính) */}
                <CoverageBar pct={file.linesPct} />

                {/* Mini bars: branches / funcs / stmts */}
                <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                    {[
                        { label: "Br", pct: file.branchesPct, color: "#38bdf8" },
                        { label: "Fn", pct: file.funcsPct, color: "#a78bfa" },
                        { label: "St", pct: file.stmtsPct, color: "#fb923c" },
                    ].map(({ label, pct, color }) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, flex: 1 }}>
                            <span style={{ fontSize: 10, color: "#484f58", fontWeight: 600, minWidth: 16 }}>{label}</span>
                            <MiniBar pct={pct} color={color} />
                            <span style={{ fontSize: 10, color, fontWeight: 600, minWidth: 32, textAlign: "right" }}>{fmt(pct)}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Badge */}
            <div style={{
                flexShrink: 0, padding: "5px 12px", borderRadius: 99,
                background: theme.bg, border: `1px solid ${theme.border}`,
                fontSize: 11, fontWeight: 700, color: theme.color, letterSpacing: "0.04em",
            }}>
                {mainPct == null ? "N/A" : mainPct >= 90 ? "GOOD" : mainPct >= 70 ? "WARN" : "LOW"}
            </div>
        </div>
    );
};

// ── Loading / Error / Empty states ────────────────────────────
const Spinner = () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16, color: "#8b949e" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid rgba(124,58,237,0.2)", borderTopColor: "#a78bfa", animation: "spin 0.8s linear infinite" }} />
        <span style={{ fontSize: 14 }}>Đang tải dữ liệu coverage…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
);

const ErrorState = ({ message, onRetry }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
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
                Thử lại
            </button>
        )}
    </div>
);

// ── Main Component ────────────────────────────────────────────
const CoverageDashboard = ({ snapshotId }) => {
    const [summary, setSummary] = useState(null);
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortBy, setSortBy] = useState("linesPct");
    const [order, setOrder] = useState("asc");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState(null);

    const LIMIT = 50;

    const fetchData = useCallback(async () => {
        if (!snapshotId) { setLoading(false); return; }
        setLoading(true);
        setError(null);
        try {
            const [sumRes, filesRes] = await Promise.all([
                getCoverageSummary(snapshotId),
                getCoverageFiles(snapshotId, {
                    sortBy,
                    order,
                    page,
                    limit: LIMIT,
                }),
            ]);
            setSummary(sumRes.data);
            setFiles(filesRes.data.files ?? []);
            setPagination(filesRes.data.pagination ?? null);
        } catch (err) {
            setError(err.message || "Không thể tải dữ liệu coverage.");
        } finally {
            setLoading(false);
        }
    }, [snapshotId, sortBy, order, page]);

    useEffect(() => { fetchData(); }, [fetchData]);

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
    if (!summary) return <ErrorState message="Chưa có dữ liệu coverage. Hãy chạy test trước." />;

    const cov = summary.coverage;

    const highCount = files.filter(f => (f.linesPct ?? 0) >= 90).length;
    const warnCount = files.filter(f => (f.linesPct ?? 0) >= 70 && (f.linesPct ?? 0) < 90).length;
    const lowCount = files.filter(f => (f.linesPct ?? 0) < 70).length;

    return (
        <div style={{
            display: "flex", flexDirection: "column",
            width: "100%", height: "100%", overflow: "hidden",
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
                            Coverage Dashboard
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

            {/* ── Hero: Ring + Stats ── */}
            <div style={{
                display: "flex", alignItems: "center", gap: 24,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 18, padding: "22px 28px", marginBottom: 18, flexShrink: 0,
            }}>
                <OverallRing value={cov.lines} />
                <div style={{ width: 1, height: 72, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
                <div style={{ display: "flex", gap: 12, flex: 1, flexWrap: "wrap" }}>
                    <StatPill label="Branches" value={fmt(cov.branches)} color="#38bdf8" />
                    <StatPill label="Functions" value={fmt(cov.functions)} color="#a78bfa" />
                    <StatPill label="Statements" value={fmt(cov.statements)} color="#fb923c" />
                    <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, margin: "0 4px" }} />
                    <StatPill label="High ≥90%" value={highCount} color="#22c55e" />
                    <StatPill label="Warn 70–90%" value={warnCount} color="#f59e0b" />
                    <StatPill label="Low <70%" value={lowCount} color="#ef4444" />
                </div>
            </div>

            {/* ── Legend + Search ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexShrink: 0, flexWrap: "wrap" }}>
                {[{ label: "High ≥90%", color: "#22c55e" }, { label: "Warn 70–90%", color: "#f59e0b" }, { label: "Low <70%", color: "#ef4444" }].map(({ label, color }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, marginRight: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${color}` }} />
                        <span style={{ fontSize: 11, color: "#6e7681" }}>{label}</span>
                    </div>
                ))}
                <div style={{ flex: 1 }} />
                <div style={{ position: "relative" }}>
                    <svg width={13} height={13} viewBox="0 0 14 14" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                        <circle cx={6} cy={6} r={5} stroke="#484f58" strokeWidth={1.5} />
                        <path d="M10 10l2.5 2.5" stroke="#484f58" strokeWidth={1.5} strokeLinecap="round" />
                    </svg>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter files…"
                        style={{
                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 8, color: "#c9d1d9", fontSize: 13, padding: "6px 12px 6px 28px",
                            outline: "none", width: 190, fontFamily: "inherit",
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
                    <div style={{ width: 38, flexShrink: 0 }} />
                    <button onClick={() => toggleSort("filePath")} style={{
                        flex: 1, textAlign: "left", background: "none", border: "none",
                        fontSize: 11, fontWeight: 700, color: "#6e7681", textTransform: "uppercase",
                        letterSpacing: "0.08em", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                        fontFamily: "inherit",
                    }}>
                        File Path <SortIcon field="filePath" />
                    </button>
                    {[
                        { label: "Lines", field: "linesPct" },
                        { label: "Branches", field: "branchesPct" },
                        { label: "Funcs", field: "funcsPct" },
                        { label: "Stmts", field: "stmtsPct" },
                    ].map(({ label, field }) => (
                        <button key={field} onClick={() => toggleSort(field)} style={{
                            background: "none", border: "none",
                            fontSize: 11, fontWeight: 700, color: sortBy === field ? "#a78bfa" : "#6e7681",
                            textTransform: "uppercase", letterSpacing: "0.08em",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                            fontFamily: "inherit", minWidth: 60, justifyContent: "flex-end",
                        }}>
                            {label} <SortIcon field={field} />
                        </button>
                    ))}
                    <div style={{ minWidth: 62 }} />
                </div>

                {/* Scrollable rows */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: "48px 0", textAlign: "center", color: "#484f58", fontSize: 14 }}>
                            {search ? "Không tìm thấy file nào khớp." : "Chưa có dữ liệu CoverageFile."}
                        </div>
                    ) : (
                        filtered.map((file, i) => <FileRow key={file.id} file={file} index={i} />)
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
                            ? `Hiển thị ${filtered.length} / ${files.length} files (trang ${page})`
                            : `Trang ${page}/${pagination?.totalPages ?? 1} · ${pagination?.total ?? files.length} files`
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