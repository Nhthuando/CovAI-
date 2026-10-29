import { useState } from "react";
import { X, Download, Printer, FileText, Check, Copy } from "lucide-react";
import { Button } from "../../../common/Button.jsx";

export function ExportPortfolioReportModal({
  isOpen = false,
  onClose,
  vm = {},
}) {
  const [sections, setSections] = useState({
    kpis: true,
    gate: true,
    benchmark: true,
    attention: true,
    directory: true,
  });
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const kpis = vm?.kpis || {};
  const projects = vm?.projects || [];
  const attention = vm?.attentionQueue || [];
  const metadata = vm?.metadata || {};

  const toggleSection = (key) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Generate Markdown summary text
  const generateMarkdownReport = () => {
    const lines = [];
    lines.push("# CovAI Multi-Project Quality Portfolio Report");
    lines.push(`Generated: ${new Date().toLocaleString()} | Account Telemetry Mode: ${vm?.dataMode || "live"}`);
    lines.push("");

    if (sections.kpis) {
      lines.push("## 1. Portfolio Executive Quality KPIs");
      lines.push(`- **Average Health Score**: ${kpis.card1Health?.avgHealthScore || 0}/100 (Grade ${kpis.card1Health?.grade || "—"})`);
      lines.push(`- **Active Projects**: ${kpis.totalProjects || 0} (${kpis.gateBreakdown?.passed || 0} Passed, ${kpis.gateBreakdown?.atRisk || 0} At Risk, ${kpis.gateBreakdown?.blocked || 0} Blocked, ${kpis.gateBreakdown?.untested || 0} Untested)`);
      lines.push(`- **Unified Coverage Index**: ${kpis.card2Coverage?.unifiedCoveragePct || 0}%`);
      lines.push(`  - Unit Line Coverage: ${kpis.card2Coverage?.avgUnitCoveragePct || 0}%`);
      lines.push(`  - Integration API Coverage: ${kpis.card2Coverage?.avgIntegrationCoveragePct || 0}%`);
      lines.push(`  - System Flow Coverage: ${kpis.card2Coverage?.avgSystemCoveragePct || 0}%`);
      lines.push(`- **Total Executed Tests**: ${kpis.card3Scale?.totalExecutedTests || 0} (${kpis.card3Scale?.overallPassRatePct || 0}% Pass Rate)`);
      lines.push(`- **AI Synthesized Tests**: ${kpis.card4AiImpact?.totalAiTests || 0} (${kpis.card4AiImpact?.aiRepairedCount || 0} Repaired Faulty Tests)`);
      lines.push("");
    }

    if (sections.attention && attention.length > 0) {
      lines.push("## 2. Priority Cross-Project Attention Queue");
      attention.forEach((item, idx) => {
        lines.push(`${idx + 1}. **[${item.severity}] ${item.projectName}** (${item.pillar}): ${item.title}`);
        lines.push(`   - ${item.description}`);
      });
      lines.push("");
    }

    if (sections.directory && projects.length > 0) {
      lines.push("## 3. Project Directory Summary");
      lines.push("| Project | Gate Status | Health Score | Unit Cov | API Cov | Flow Cov | Pass Rate | Gaps |");
      lines.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");
      projects.forEach((p) => {
        lines.push(`| ${p.name} | ${p.gateStatus} | ${p.healthScore} | ${p.pillars?.unit?.coveragePct ?? 0}% | ${p.pillars?.integration?.coveragePct ?? 0}% | ${p.pillars?.system?.coveragePct ?? 0}% | ${p.passRatePct ?? 0}% | ${p.aiMetrics?.uncoveredGaps ?? 0} |`);
      });
      lines.push("");
    }

    return lines.join("\n");
  };

  const markdownContent = generateMarkdownReport();

  const handleDownloadMd = () => {
    const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `covai_portfolio_report_${Date.now()}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadJson = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      metadata,
      kpis,
      projects,
      attentionQueue: attention,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `covai_portfolio_telemetry_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(markdownContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans animate-in fade-in duration-150 ud-no-print"
    >
      <div className="w-full max-w-3xl max-h-[90vh] rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ud-border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center">
              <FileText size={16} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--ud-text)]">
                Export Quality Portfolio Summary Report
              </h2>
              <p className="text-xs text-[var(--ud-text-muted)] mt-0.5">
                Generate executive summary in Markdown, JSON telemetry, or printable view
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Section Selectors */}
        <div className="px-6 py-3 border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 flex flex-wrap items-center gap-4 text-xs font-mono">
          <span className="text-[var(--ud-text-muted)]">Include Sections:</span>
          {Object.entries({
            kpis: "Executive KPIs",
            attention: "Attention Queue",
            directory: "Project Directory",
          }).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sections[key]}
                onChange={() => toggleSection(key)}
                className="rounded border-[var(--ud-border)] text-[var(--color-primary)] cursor-pointer"
              />
              <span className="text-[var(--ud-text)]">{label}</span>
            </label>
          ))}
        </div>

        {/* Preview Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          <pre className="p-4 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] font-mono text-xs text-[var(--ud-text)] whitespace-pre-wrap leading-relaxed select-text">
            {markdownContent}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--ud-border)] bg-[var(--ud-surface-2)]">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] cursor-pointer"
          >
            {copied ? <Check size={13} className="text-[var(--ud-pass)]" /> : <Copy size={13} />}
            <span>{copied ? "Copied to Clipboard" : "Copy Markdown"}</span>
          </button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={Printer}
              onClick={handlePrint}
            >
              Print / Save PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={Download}
              onClick={handleDownloadJson}
            >
              JSON
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Download}
              onClick={handleDownloadMd}
            >
              Download .MD
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExportPortfolioReportModal;

