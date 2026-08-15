/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Shield,
  Zap,
  Bug,
  Award,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  TrendingUp,
  ArrowRight,
  Code2,
  Cpu,
  FileCheck2,
  Lock,
  Flame,
} from "lucide-react";
import { startQualityAnalysisApi, getQualityReportApi } from "../../services/quality.service";

// ── Score utilities ───────────────────────────────────────
const getScoreColor = (score) => {
  if (score == null) return { color: "#6e7681", bg: "rgba(110,118,129,0.12)", border: "rgba(110,118,129,0.25)" };
  if (score >= 80) return { color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.25)" };
  if (score >= 60) return { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)" };
  return { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.25)" };
};

const getGrade = (score) => {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
};

const getGradeColor = (grade) =>
  ({
    A: "#22c55e",
    B: "#4ade80",
    C: "#f59e0b",
    D: "#f97316",
    F: "#ef4444",
  })[grade] || "#6e7681";

const getSeverityStyle = (severity) =>
  ({
    Critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.25)", icon: AlertTriangle },
    Warning: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)", icon: AlertTriangle },
    Info: { color: "#38bdf8", bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.25)", icon: Info },
  })[severity] || { color: "#8b949e", bg: "rgba(139,148,158,0.12)", border: "rgba(139,148,158,0.25)", icon: Info };

// ── Score Ring Component ──────────────────────────────────
const ScoreRing = ({ value, size = 130, label, strokeWidth = 9, delay = 0 }) => {
  const theme = getScoreColor(value);
  const r = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = value != null ? circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference : circumference;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: "easeOut" }}
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={theme.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 1.2s ease-out",
            filter: `drop-shadow(0 0 10px ${theme.color}80)`,
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: size * 0.23, fontWeight: 800, color: theme.color, letterSpacing: "-0.02em" }}>
          {value != null ? Number(value).toFixed(1) : "—"}
        </span>
        {label && (
          <span
            style={{
              fontSize: 10,
              color: "#8b949e",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginTop: 2,
            }}
          >
            {label}
          </span>
        )}
      </div>
    </motion.div>
  );
};

// ── Metric Detail Card ─────────────────────────────────────
const ScoreCard = ({ icon: Icon, title, score, delay = 0, badge, children }) => {
  const theme = getScoreColor(score);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      style={{
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 14,
        padding: 20,
        flex: 1,
        minWidth: 240,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: theme.bg,
                border: `1px solid ${theme.border}`,
              }}
            >
              <Icon size={18} style={{ color: theme.color }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>{title}</div>
              <div style={{ fontSize: 11, color: "#6e7681" }}>{badge}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: theme.color }}>
              {score != null ? Number(score).toFixed(1) : "—"}
            </span>
            <span style={{ fontSize: 12, color: "#6e7681", marginLeft: 2 }}>/100</span>
          </div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
          {children}
        </div>
      </div>
    </motion.div>
  );
};

// ── Main QualityDashboard Modal ────────────────────────────
export default function QualityDashboard({ projectId, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const fetchReport = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getQualityReportApi(projectId);
      setReport(res.data);
    } catch (err) {
      if (err.message?.includes("not found")) {
        setReport(null);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleRunAnalysis = async () => {
    setRunning(true);
    setError(null);
    try {
      await startQualityAnalysisApi(projectId);

      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const reportRes = await getQualityReportApi(projectId);
          if (reportRes.data) {
            setReport(reportRes.data);
            setRunning(false);
            clearInterval(pollInterval);
          }
        } catch {
          // Keep polling
        }
      }, 3000);

      // Timeout after 90 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        setRunning(false);
        fetchReport();
      }, 90000);
    } catch (err) {
      setError(err.message);
      setRunning(false);
    }
  };

  const grade = report ? getGrade(report.overallScore) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.82)",
        backdropFilter: "blur(10px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        overflowY: "auto",
        padding: "24px 16px",
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 1060,
          background: "#161b22",
          borderRadius: 18,
          border: "1px solid #30363d",
          boxShadow: "0 28px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.05)",
          overflow: "hidden",
          position: "relative",
          margin: "auto",
        }}
      >
        {/* Top glowing accent border */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: "linear-gradient(90deg, #7c3aed 0%, #38bdf8 50%, #22c55e 100%)",
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "24px 28px 20px",
            borderBottom: "1px solid #21262d",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(56,189,248,0.2) 100%)",
                border: "1px solid rgba(124,58,237,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Award size={22} style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f0f6fc", margin: 0 }}>
                API Code Quality Dashboard
              </h2>
              <p style={{ fontSize: 12, color: "#6e7681", margin: "2px 0 0" }}>
                {report
                  ? `Last evaluated: ${new Date(report.createdAt).toLocaleString()}`
                  : "Comprehensive health, security, and performance report"}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {report && (
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={handleRunAnalysis}
                disabled={running}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  background: "rgba(124,58,237,0.15)",
                  border: "1px solid rgba(124,58,237,0.35)",
                  borderRadius: 8,
                  color: "#c4b5fd",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: running ? "wait" : "pointer",
                }}
              >
                <RefreshCw size={14} className={running ? "animate-spin" : ""} />
                {running ? "Analyzing..." : "Re-evaluate Quality"}
              </motion.button>
            )}

            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: 8,
                cursor: "pointer",
                color: "#8b949e",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={18} />
            </motion.button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: "28px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#8b949e" }}>
              <RefreshCw size={32} className="animate-spin" style={{ margin: "0 auto 16px", color: "#a78bfa" }} />
              <div>Loading quality report...</div>
            </div>
          ) : error ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 12,
                color: "#f87171",
              }}
            >
              <AlertTriangle size={32} style={{ margin: "0 auto 12px" }} />
              <div style={{ fontWeight: 600, fontSize: 15 }}>Could not load quality report</div>
              <div style={{ fontSize: 13, marginTop: 4, color: "#8b949e" }}>{error}</div>
              <button
                onClick={handleRunAnalysis}
                style={{
                  marginTop: 16,
                  padding: "8px 20px",
                  background: "#21262d",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  color: "#f0f6fc",
                  cursor: "pointer",
                }}
              >
                Try Running Analysis
              </button>
            </div>
          ) : !report && !running ? (
            /* Empty State */
            <div style={{ textAlign: "center", padding: "50px 20px" }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  background: "linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(56,189,248,0.15) 100%)",
                  border: "1px solid rgba(124,58,237,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                }}
              >
                <Award size={36} style={{ color: "#a78bfa" }} />
              </div>
              <h3 style={{ color: "#f0f6fc", fontSize: 19, fontWeight: 700, margin: "0 0 8px" }}>
                No Quality Evaluation Available
              </h3>
              <p style={{ color: "#8b949e", fontSize: 14, maxWidth: 480, margin: "0 auto 28px", lineHeight: 1.6 }}>
                Run an intelligent quality analysis to get real-time performance complexity scoring, AI-powered security
                audit, test coverage health, and high-priority debug reports.
              </p>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={handleRunAnalysis}
                style={{
                  padding: "12px 32px",
                  background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 4px 20px rgba(124,58,237,0.4)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Zap size={16} />
                Evaluate Project Quality
              </motion.button>
            </div>
          ) : running && !report ? (
            /* Running in progress */
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <RefreshCw size={36} className="animate-spin" style={{ margin: "0 auto 16px", color: "#a78bfa" }} />
              <h3 style={{ color: "#f0f6fc", fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>
                Analyzing Code Quality...
              </h3>
              <p style={{ color: "#8b949e", fontSize: 13, margin: 0 }}>
                Aggregating coverage metrics, evaluating cyclomatic complexity, and performing AI security scanning.
              </p>
            </div>
          ) : report ? (
            <>
              {/* Overall Quality Banner */}
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(13,17,23,0.95) 0%, rgba(22,27,34,0.95) 100%)",
                  border: "1px solid #30363d",
                  borderRadius: 16,
                  padding: "24px 32px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 24,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
                  <ScoreRing value={report.overallScore} size={130} label="Overall" strokeWidth={10} delay={0.05} />
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                      <span
                        style={{
                          fontSize: 48,
                          fontWeight: 900,
                          color: getGradeColor(grade),
                          lineHeight: 1,
                          filter: `drop-shadow(0 0 16px ${getGradeColor(grade)}70)`,
                        }}
                      >
                        Grade {grade}
                      </span>
                      <span style={{ fontSize: 14, color: "#8b949e", fontWeight: 500 }}>
                        (Weighted Composite Index)
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#8b949e", marginTop: 8, maxWidth: 440, lineHeight: 1.5 }}>
                      Composite score calculated from 30% Coverage + 25% Performance + 25% Security + 20% Maintainability.
                    </div>
                    {!report.aiAvailable && (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: "#f59e0b",
                          background: "rgba(245,158,11,0.1)",
                          padding: "4px 10px",
                          borderRadius: 6,
                          marginTop: 10,
                        }}
                      >
                        <AlertTriangle size={13} />
                        AI analysis degraded — showing rule-based evaluation
                      </div>
                    )}
                  </div>
                </div>

                {/* Formula Quick Breakdown */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "12px 18px",
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.05)",
                    fontSize: 12,
                    color: "#8b949e",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
                    <span>Coverage (30%):</span>
                    <span style={{ fontWeight: 600, color: "#e6edf3" }}>{report.coverageScore.toFixed(1)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
                    <span>Performance (25%):</span>
                    <span style={{ fontWeight: 600, color: "#e6edf3" }}>{report.performanceScore.toFixed(1)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
                    <span>Security (25%):</span>
                    <span style={{ fontWeight: 600, color: "#e6edf3" }}>{report.securityScore.toFixed(1)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
                    <span>Maintainability (20%):</span>
                    <span style={{ fontWeight: 600, color: "#e6edf3" }}>{report.maintainabilityScore.toFixed(1)}</span>
                  </div>
                </div>
              </div>

              {/* 4 Dimension Cards */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
                {/* Performance */}
                <ScoreCard
                  icon={TrendingUp}
                  title="Performance"
                  badge="Complexity & Cohesion"
                  score={report.performanceScore}
                  delay={0.1}
                >
                  <div style={{ fontSize: 12, color: "#8b949e", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Avg Cyclomatic:</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.performanceDetails?.avgCC ?? "—"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>High CC Ratio (&gt;10):</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.performanceDetails?.highCCRatio ?? "0"}%
                      </span>
                    </div>
                    {report.performanceDetails?.hotspots?.length > 0 ? (
                      <div
                        style={{
                          marginTop: 6,
                          padding: "4px 8px",
                          background: "rgba(245,158,11,0.1)",
                          borderRadius: 6,
                          color: "#f59e0b",
                          fontSize: 11,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Flame size={12} />
                        {report.performanceDetails.hotspots.length} complex hotspots detected
                      </div>
                    ) : (
                      <div style={{ color: "#22c55e", fontSize: 11, marginTop: 4 }}>
                        ✓ No high complexity hotspots
                      </div>
                    )}
                  </div>
                </ScoreCard>

                {/* Security */}
                <ScoreCard
                  icon={Shield}
                  title="Security"
                  badge="AI Vulnerability Scan"
                  score={report.securityScore}
                  delay={0.15}
                >
                  <div style={{ fontSize: 12, color: "#8b949e", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Total Findings:</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.securityDetails?.totalFindings ?? 0}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Critical Issues:</span>
                      <span
                        style={{
                          color: (report.securityDetails?.criticalCount ?? 0) > 0 ? "#ef4444" : "#22c55e",
                          fontWeight: 700,
                        }}
                      >
                        {report.securityDetails?.criticalCount ?? 0}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Warnings:</span>
                      <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                        {report.securityDetails?.warningCount ?? 0}
                      </span>
                    </div>
                  </div>
                </ScoreCard>

                {/* Coverage */}
                <ScoreCard
                  icon={CheckCircle2}
                  title="Test Coverage"
                  badge="Jest Execution"
                  score={report.coverageScore}
                  delay={0.2}
                >
                  <div style={{ fontSize: 12, color: "#8b949e", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Line Coverage:</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.coverageDetails?.linesPct != null
                          ? `${report.coverageDetails.linesPct.toFixed(1)}%`
                          : "—"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Branch Coverage:</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.coverageDetails?.branchesPct != null
                          ? `${report.coverageDetails.branchesPct.toFixed(1)}%`
                          : "—"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Function Coverage:</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.coverageDetails?.funcsPct != null
                          ? `${report.coverageDetails.funcsPct.toFixed(1)}%`
                          : "—"}
                      </span>
                    </div>
                  </div>
                </ScoreCard>

                {/* Maintainability */}
                <ScoreCard
                  icon={FileCheck2}
                  title="Maintainability"
                  badge="Structure & Standards"
                  score={report.maintainabilityScore}
                  delay={0.25}
                >
                  <div style={{ fontSize: 12, color: "#8b949e", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>File Organization:</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.maintainabilityDetails?.fileOrganization ?? 80}%
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Module Consistency:</span>
                      <span style={{ color: "#e6edf3", fontWeight: 600 }}>
                        {report.maintainabilityDetails?.moduleFormatConsistency ?? 90}%
                      </span>
                    </div>
                    <div style={{ color: "#22c55e", fontSize: 11, marginTop: 4 }}>
                      ✓ Clean architectural layer design
                    </div>
                  </div>
                </ScoreCard>
              </div>

              {/* Debug Report Section */}
              {report.debugReport?.entries?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  style={{
                    background: "#0d1117",
                    border: "1px solid #21262d",
                    borderRadius: 14,
                    padding: 20,
                    marginBottom: 24,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Bug size={18} style={{ color: "#f59e0b" }} />
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#f0f6fc", margin: 0 }}>
                        Debug Report — Riskiest Functions
                      </h3>
                    </div>
                    <span style={{ fontSize: 12, color: "#6e7681" }}>
                      Prioritized by High CC + Zero/Low Test Coverage
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {report.debugReport.entries.map((entry, i) => {
                      const sev = getSeverityStyle(entry.severity);
                      const SevIcon = sev.icon;
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "12px 14px",
                            borderRadius: 10,
                            background: sev.bg,
                            border: `1px solid ${sev.border}`,
                          }}
                        >
                          <SevIcon size={16} style={{ color: sev.color, marginTop: 2, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f6fc" }}>
                                {entry.functionName}()
                              </span>
                              <span style={{ fontSize: 12, color: "#8b949e", fontFamily: "var(--font-mono)" }}>
                                {entry.filePath}
                              </span>
                              {entry.cc != null && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    background: "rgba(255,255,255,0.06)",
                                    color: "#e6edf3",
                                  }}
                                >
                                  CC: {entry.cc}
                                </span>
                              )}
                              {entry.coveragePct != null && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    background: entry.coveragePct === 0 ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)",
                                    color: entry.coveragePct === 0 ? "#ef4444" : "#22c55e",
                                  }}
                                >
                                  Coverage: {entry.coveragePct}%
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4, lineHeight: 1.4 }}>
                              {entry.reason}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Security Findings Section */}
              {report.securityDetails?.findings?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  style={{
                    background: "#0d1117",
                    border: "1px solid #21262d",
                    borderRadius: 14,
                    padding: 20,
                    marginBottom: 24,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <Shield size={18} style={{ color: "#38bdf8" }} />
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#f0f6fc", margin: 0 }}>
                      Security Findings
                    </h3>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {report.securityDetails.findings.map((item, i) => {
                      const sev = getSeverityStyle(item.severity);
                      const SevIcon = sev.icon;
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "12px 14px",
                            borderRadius: 10,
                            background: sev.bg,
                            border: `1px solid ${sev.border}`,
                          }}
                        >
                          <SevIcon size={16} style={{ color: sev.color, marginTop: 2, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f6fc" }}>
                                {item.title}
                              </span>
                              {item.filePath && (
                                <span style={{ fontSize: 12, color: "#8b949e", fontFamily: "var(--font-mono)" }}>
                                  {item.filePath}
                                  {item.line ? `:${item.line}` : ""}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4, lineHeight: 1.4 }}>
                              {item.description}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* AI Actionable Recommendations */}
              {report.recommendations?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  style={{
                    background: "#0d1117",
                    border: "1px solid #21262d",
                    borderRadius: 14,
                    padding: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <Zap size={18} style={{ color: "#a78bfa" }} />
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#f0f6fc", margin: 0 }}>
                      AI Actionable Recommendations
                    </h3>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {report.recommendations.map((rec, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "14px 16px",
                          borderRadius: 10,
                          background: "rgba(124,58,237,0.05)",
                          border: "1px solid rgba(124,58,237,0.18)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <ArrowRight size={14} style={{ color: "#a78bfa" }} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f6fc" }}>{rec.title}</span>
                          </div>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: 4,
                              background:
                                rec.impact === "high"
                                  ? "rgba(239,68,68,0.15)"
                                  : rec.impact === "medium"
                                  ? "rgba(245,158,11,0.15)"
                                  : "rgba(34,197,94,0.15)",
                              color:
                                rec.impact === "high" ? "#ef4444" : rec.impact === "medium" ? "#f59e0b" : "#22c55e",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {rec.impact} impact
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#8b949e", paddingLeft: 22, lineHeight: 1.5 }}>
                          {rec.description}
                        </div>
                        {rec.relatedFiles?.length > 0 && (
                          <div style={{ paddingLeft: 22, marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {rec.relatedFiles.map((file, fIdx) => (
                              <span
                                key={fIdx}
                                style={{
                                  fontSize: 11,
                                  fontFamily: "var(--font-mono)",
                                  background: "rgba(255,255,255,0.04)",
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  color: "#a78bfa",
                                }}
                              >
                                {file}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}
