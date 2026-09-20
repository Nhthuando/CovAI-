import { useCallback, useEffect, useMemo, useState } from "react";
import { getCoverageFiles, getCoverageFrameworks, getCoverageSummary, getTestExecution, runCoverageByType } from "../../services/coverage.service.js";
import { getJobDetailApi } from "../../services/job.service.js";

const CONFIG = {
  unit: { title: "Unit Test Coverage", subtitle: "Kiểm thử độc lập của hàm, nhánh điều kiện và câu lệnh.", supported: "Jest · Vitest", accent: "#a78bfa", focus: ["Statements", "Branches", "Functions", "Lines"], explanation: [["Statement coverage", "Bao nhiêu câu lệnh đã được test thực thi."], ["Branch coverage", "Bao nhiêu nhánh if/else/switch đã được đi qua."], ["Function coverage", "Bao nhiêu hàm hoặc method đã được gọi."]] },
  integration: { title: "Integration Test Coverage", subtitle: "Kiểm tra API và trao đổi dữ liệu giữa frontend, backend và dịch vụ.", supported: "Playwright · Supertest", accent: "#fbbf24", focus: ["API files", "Covered API files", "Average coverage", "Critical APIs"], explanation: [["API contracts", "Request, response, status code và dữ liệu trả về."], ["Frontend ↔ Backend", "Các lời gọi API từ giao diện đến route/controller."], ["Service integration", "Luồng controller, service và database/dependency."]] },
  system: { title: "System Test Coverage", subtitle: "Kiểm tra E2E các tính năng hoàn chỉnh theo góc nhìn người dùng.", supported: "Playwright · Cypress", accent: "#ec4899", focus: ["E2E tests", "Passed", "Failed", "Feature coverage"], explanation: [["User journeys", "Các luồng đăng nhập, thao tác và hoàn thành nghiệp vụ."], ["Browser behavior", "Giao diện, điều hướng và tương tác trên trình duyệt."], ["Full system", "Frontend, backend và dữ liệu hoạt động cùng nhau."]] },
};
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;
const coverageColor = (value) => value >= 80 ? "#22c55e" : value >= 60 ? "#fbbf24" : "#f87171";
const apiFile = (file) => /(^|\/)(api|routes?|controllers?|services?|endpoints?)(\/|\.|$)/i.test(file.filePath);
const cardStyle = { background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.075)", borderRadius: 12, padding: 17 };
const buttonStyle = (color) => ({ background: `${color}18`, color, border: `1px solid ${color}55`, borderRadius: 8, padding: "8px 14px", fontWeight: 650, cursor: "pointer" });

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await getJobDetailApi(jobId);
    const job = response?.job;
    if (job?.status === "SUCCESS") return;
    if (["FAILED", "CANCELED"].includes(job?.status)) throw new Error(job?.errorMessage || job?.error || `${job.status}: coverage analysis failed.`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Coverage analysis timed out. Open Job Queue to inspect logs.");
}

export default function CoverageTypeDashboard({ type, snapshotId, onOpenFile }) {
  const config = CONFIG[type];
  const [summary, setSummary] = useState(null);
  const [files, setFiles] = useState([]);
  const [executions, setExecutions] = useState({});
  const [frameworks, setFrameworks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [activeFramework, setActiveFramework] = useState("");

  const load = useCallback(async () => {
    if (!snapshotId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([getCoverageSummary(snapshotId), getCoverageFiles(snapshotId, { sortBy: "linesPct", order: "asc", limit: 200 }), getTestExecution(snapshotId)]);
      setSummary(a.data); setFiles(b.data?.files || []); setExecutions(c.data || {}); setError("");
      // Framework metadata enriches the header, but must never block reports or Run.
      try {
        const detection = await getCoverageFrameworks(snapshotId);
        setFrameworks(detection.data || null);
      } catch {
        setFrameworks(null);
      }
    } catch (loadError) { setError(loadError.message || "Unable to load coverage analysis."); }
    finally { setLoading(false); }
  }, [snapshotId]);
  useEffect(() => {
    // Loading remote report data is the external synchronization for this view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const run = async () => {
    if (!snapshotId || running) return;
    setRunning(true); setError("");
    try {
      const response = await runCoverageByType(snapshotId, type);
      setActiveFramework(response.data?.framework || "");
      const jobId = response.data?.job?.id;
      if (!jobId) throw new Error("Backend did not return a coverage job.");
      await waitForJob(jobId); await load();
    } catch (runError) { setError(runError.message || "Coverage analysis failed."); }
    finally { setRunning(false); }
  };

  const cov = summary?.coverage || {};
  const selectedFiles = useMemo(() => type === "integration" ? files.filter(apiFile) : files, [files, type]);
  const relevantRuns = useMemo(() => (type === "unit" ? [executions.jest, executions.vitest] : type === "integration" ? [executions.supertest, executions.playwright] : [executions.playwright, executions.cypress]).filter(Boolean), [executions, type]);
  const totals = relevantRuns.reduce((acc, item) => ({ total: acc.total + (item.totalTests || 0), passed: acc.passed + (item.passedTests || 0), failed: acc.failed + (item.failedTests || 0) }), { total: 0, passed: 0, failed: 0 });
  const avg = selectedFiles.length ? selectedFiles.reduce((sum, file) => sum + (file.linesPct || 0), 0) / selectedFiles.length : 0;
  const values = type === "unit" ? [cov.statements, cov.branches, cov.functions, cov.lines] : type === "integration" ? [selectedFiles.length, selectedFiles.filter((f) => f.linesPct > 0).length, pct(avg), selectedFiles.filter((f) => f.linesPct < 60).length] : [totals.total, totals.passed, totals.failed, pct(cov.lines)];

  return <div style={{ minHeight: "100%", padding: "28px 34px", color: "#e6edf3", background: "#0d1117", boxSizing: "border-box" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 22 }}>
      <div><h1 style={{ margin: 0, fontSize: 27 }}>{config.title}</h1><p style={{ color: "#8b949e", fontSize: 13, margin: "7px 0 0" }}>{config.subtitle}</p><div style={{ color: "#6e7681", fontSize: 12, marginTop: 7 }}>Hỗ trợ: <span style={{ color: config.accent }}>{config.supported}</span>{frameworks && <span> · Phát hiện: <b style={{ color: "#c9d1d9" }}>{frameworks.supported?.[type]?.join(", ") || "không có"}</b></span>}{activeFramework && <span> · Vừa chạy: <b style={{ color: config.accent }}>{activeFramework}</b></span>}</div></div>
      <div style={{ display: "flex", gap: 9 }}><button onClick={load} disabled={loading || running} style={buttonStyle("#8b949e")}>Refresh</button><button onClick={run} disabled={!snapshotId || running} style={buttonStyle(config.accent)}>{running ? "Running analysis..." : "Run Analysis"}</button></div>
    </div>
    {error && <div style={{ padding: "12px 15px", marginBottom: 18, borderRadius: 9, color: "#fca5a5", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)" }}>{error}</div>}
    {loading ? <div style={{ color: "#8b949e", padding: 40, textAlign: "center" }}>Loading coverage analysis...</div> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 13 }}>{config.focus.map((label, i) => <div key={label} style={cardStyle}><div style={{ color: "#8b949e", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{label}</div><div style={{ color: type === "unit" ? coverageColor(values[i]) : config.accent, fontSize: 27, fontWeight: 750, marginTop: 8 }}>{type === "unit" ? pct(values[i]) : values[i]}</div></div>)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 13, marginTop: 18 }}>{config.explanation.map(([title, text]) => <div key={title} style={cardStyle}><div style={{ color: config.accent, fontWeight: 650, fontSize: 14 }}>{title}</div><div style={{ color: "#8b949e", fontSize: 12, lineHeight: 1.55, marginTop: 7 }}>{text}</div></div>)}</div>
      <div style={{ ...cardStyle, marginTop: 18, padding: 0, overflow: "hidden" }}><div style={{ padding: "15px 18px", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,.07)" }}>{type === "integration" ? "API / integration files" : type === "system" ? "Files exercised by E2E tests" : "Source file coverage"}</div>{selectedFiles.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#6e7681" }}>Chưa có dữ liệu. Nhấn Run Analysis để bắt đầu.</div> : selectedFiles.slice(0, 50).map((file) => <button key={file.filePath} onClick={() => onOpenFile?.(file.filePath)} style={{ width: "100%", display: "grid", gridTemplateColumns: "minmax(220px, 1fr) repeat(4, 90px)", gap: 10, padding: "12px 18px", color: "#c9d1d9", background: "transparent", border: 0, borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.filePath}</span>{[file.linesPct, file.branchesPct, file.funcsPct, file.stmtsPct].map((value, i) => <span key={i} style={{ color: coverageColor(value), textAlign: "right" }}>{pct(value)}</span>)}</button>)}</div>
    </>}
  </div>;
}
