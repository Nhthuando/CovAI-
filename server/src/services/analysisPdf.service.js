import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";

const fonts = new URL("../assets/fonts/", import.meta.url);
const colors = { ink: "#172B46", muted: "#62748A", teal: "#087F8C", rule: "#DFE7ED", paper: "#F4F7FA", danger: "#B54745" };
const number = (value, suffix = "") => Number.isFinite(value) ? `${Number(value.toFixed(1))}${suffix}` : "N/A";
const short = (value, limit = 260) => {
    const text = String(value ?? "N/A").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").normalize("NFC");
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
};
const timestamp = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "N/A" : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "short",
    }).format(date) + " (UTC+7)";
};

/** A self-contained PDF renderer: only receives the public, sanitized export DTO. */
export const renderAnalysisPdf = (report) => new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, autoFirstPage: false,
        info: { Title: `${short(report.project.name, 100)} - Analysis Report`, Author: "CovAI", Subject: "Snapshot analysis and testing report", Creator: "CovAI Project & Analysis Export" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
        doc.registerFont("Body", fileURLToPath(new URL("NotoSans-Regular.ttf", fonts)));
        doc.registerFont("Bold", fileURLToPath(new URL("NotoSans-Bold.ttf", fonts)));
        const width = 499.28, left = 48, bottom = 772;
        let y = 92;
        const text = (value, x, top, options = {}) => {
            const { bold = false, size = 10, color = colors.ink, ...rest } = options;
            doc.font(bold ? "Bold" : "Body").fontSize(size).fillColor(color).text(String(value), x, top, { width, lineGap: 2, ...rest });
        };
        const height = (value, size = 10, cellWidth = width, bold = false) => doc.font(bold ? "Bold" : "Body").fontSize(size)
            .heightOfString(String(value), { width: cellWidth, lineGap: 2 });
        const page = () => {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, 5).fill(colors.teal);
            text("CovAI", left, 28, { bold: true, size: 14 });
            text("PROJECT & ANALYSIS REPORT", 215, 33, { size: 8, color: colors.muted, width: 333, align: "right", characterSpacing: 1 });
            doc.moveTo(left, 63).lineTo(left + width, 63).lineWidth(0.5).strokeColor(colors.rule).stroke();
            y = 90;
        };
        const ensure = (space) => { if (y + space > bottom) page(); };
        const paragraph = (value, { size = 10, color = colors.muted } = {}) => {
            const content = short(value, 1800), h = height(content, size);
            ensure(h + 12); text(content, left, y, { size, color }); y += h + 12;
        };
        const section = (index, title, description) => {
            ensure(31 + (description ? height(short(description, 1800), 9) + 12 : 0) + 70);
            text(index, left, y + 2, { bold: true, size: 10, color: colors.teal, width: 28 });
            text(title, left + 34, y, { bold: true, size: 16, width: width - 34 });
            y += 31;
            if (description) paragraph(description, { size: 9 });
        };
        const table = (headers, rows, widths, { limit = 60, total = rows.length } = {}) => {
            if (!rows.length) { paragraph("Chưa có dữ liệu / No saved results."); return; }
            const header = () => {
                doc.rect(left, y, width, 27).fill(colors.ink);
                let x = left;
                headers.forEach((label, i) => { text(label, x + 8, y + 7, { size: 8, bold: true, color: "#FFFFFF", width: widths[i] - 16, lineBreak: false }); x += widths[i]; });
                y += 27;
            };
            ensure(70); header();
            rows.slice(0, limit).forEach((row, index) => {
                const cells = row.map((cell, i) => short(cell, widths[i] < 80 ? 40 : 260));
                const h = Math.max(29, ...cells.map((cell, i) => height(cell, 8.5, widths[i] - 16) + 16));
                if (y + h > bottom) { page(); header(); }
                if (index % 2 === 0) doc.rect(left, y, width, h).fill(colors.paper);
                let x = left;
                cells.forEach((cell, i) => { text(cell, x + 8, y + 7, { size: 8.5, width: widths[i] - 16 }); x += widths[i]; });
                y += h;
                doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(colors.rule).stroke();
            });
            y += 10;
            if (total > limit) paragraph(`Showing ${Math.min(limit, rows.length)} of ${total} records. Export JSON for the complete data. Long table cells are shortened for readability.`, { size: 8 });
            y += 8;
        };
        const metric = (label, value, x, top, w) => {
            doc.roundedRect(x, top, w, 83, 4).fill(colors.paper);
            text(label.toUpperCase(), x + 12, top + 11, { size: 7.5, bold: true, color: colors.muted, width: w - 24 });
            text(number(value, "%"), x + 12, top + 29, { size: 23, bold: true, width: w - 24 });
            doc.rect(x + 12, top + 66, w - 24, 3).fill(colors.rule);
            if (Number.isFinite(value)) doc.rect(x + 12, top + 66, (w - 24) * Math.max(0, Math.min(100, value)) / 100, 3).fill(colors.teal);
        };
        page();
        text("SNAPSHOT INTELLIGENCE", left, y, { size: 9, bold: true, color: colors.teal, characterSpacing: 1.2 }); y += 26;
        const name = short(report.project.name, 160);
        text(name, left, y, { size: 30, bold: true }); y += height(name, 30, width, true) + 12;
        text("Project & Analysis Report", left, y, { size: 17, color: colors.muted }); y += 40;
        if (report.project.description) paragraph(short(report.project.description, 380), { size: 10 });
        const { snapshot, analysis } = report;
        const metadata = [
            ["Snapshot", snapshot.id], ["Source", `${snapshot.source}${snapshot.commitSha ? ` / commit ${snapshot.commitSha.slice(0, 12)}` : ""}`],
            ["Captured", timestamp(snapshot.createdAt)], ["Exported", timestamp(report.exportedAt)],
        ];
        if (report.project.repoUrl) metadata.push(["Repository", short(report.project.repoUrl, 180)]);
        table(["PROVENANCE", "VALUE"], metadata, [95, width - 95]);
        section("01", "Coverage at a glance", "Persisted snapshot coverage. N/A means the analysis has not produced a saved result; it does not mean 0% coverage.");
        ensure(100);
        const coverage = analysis.coverage.summary;
        [ ["Lines", coverage?.linesPct], ["Branches", coverage?.branchesPct], ["Functions", coverage?.funcsPct], ["Statements", coverage?.stmtsPct] ]
            .forEach(([label, value], i) => metric(label, value, left + i * 128, y, 115));
        y += 101;
        paragraph(`Coverage files: ${analysis.coverage.files.length}   |   Functions measured: ${analysis.coverage.functions.length}   |   Complexity records: ${analysis.complexity.length}`, { size: 9 });
        if (coverage?.createdAt) paragraph(`Coverage recorded: ${timestamp(coverage.createdAt)}`, { size: 8 });
        paragraph("Report scope: saved analysis for the selected snapshot at export time. This document does not run tests or recalculate scores. Export JSON for complete coverage functions, control-flow graphs, performance metrics, quality recommendations and test history.", { size: 8 });
        for (const warning of report.warnings || []) paragraph(warning, { size: 9, color: colors.danger });

        page();
        section("02", "Quality assessment", "Scores reflect the saved quality report for this snapshot. They are separate from individual test execution results.");
        const quality = analysis.quality;
        table(["DIMENSION", "SCORE / 100"], quality ? [
            ["Overall quality", number(quality.overallScore)], ["Maintainability", number(quality.maintainabilityScore)],
            ["Security", number(quality.securityScore)], ["Performance", number(quality.performanceScore)], ["Coverage", number(quality.coverageScore)],
        ] : [], [350, width - 350]);
        if (quality) paragraph(`Recorded: ${timestamp(quality.createdAt)}${quality.aiAvailable === false ? ". AI recommendations were unavailable for this analysis." : ""}`, { size: 8 });
        section("03", "Test execution", "Latest saved run per runner and execution mode. Earlier runs remain available in the JSON export. Durations are shown in seconds.");
        const latestRuns = [...new Map(analysis.testRuns.map((run) => [`${run.type}:${run.executionMode}`, run]).reverse()).values()]
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        table(["RUNNER / MODE", "STATUS", "PASS", "FAIL", "SKIP", "TIME"], latestRuns.map((run) => [
            `${run.type}\n${run.executionMode}\n${timestamp(run.finishedAt)}`, run.status,
            run.passedTests, run.failedTests, run.skippedTests, number(run.durationMs / 1000, "s"),
        ]), [172, 115, 49, 49, 49, width - 434], { limit: 20 });
        const failed = latestRuns.flatMap((run) => (run.scenarios || []).filter((scenario) => ["FAILED", "TIMEDOUT", "TIMED_OUT"].includes(String(scenario.status).toUpperCase())));
        if (failed.length) table(["FAILED SCENARIO", "FILE", "CATEGORY"], failed.map((scenario) => [scenario.title, scenario.testFile, scenario.failureCategory]), [215, 185, width - 400], { limit: 15 });
        if (latestRuns.some((run) => run.flakyTests)) paragraph(`Flaky tests in the latest runs: ${latestRuns.reduce((sum, run) => sum + (run.flakyTests || 0), 0)}. Review retries before treating these runs as stable.`, { size: 9 });
        section("04", "Project structure", "Static structure results describe source organization and discovered dependencies.");
        const summary = analysis.structure?.summary;
        table(["MEASURE", "RESULT"], summary ? [
            ["Source files", summary.totalFiles], ["Functions", summary.totalFunctions], ["Exported functions", summary.exportedFunctionCount],
            ["Module format", summary.moduleFormat], ["Domains", (summary.domains || []).join(", ") || "N/A"],
            ["External dependencies", (summary.externalDependencies || []).join(", ") || "None discovered"],
        ] : [], [180, width - 180]);

        section("05", "File coverage", "Files with the lowest line coverage appear first to help prioritize testing. Values are percentages.");
        const files = [...analysis.coverage.files].sort((a, b) => a.linesPct - b.linesPct || a.filePath.localeCompare(b.filePath));
        table(["SOURCE FILE", "LINES", "BRANCH", "FUNCS", "STMTS"], files.map((file) => [
            file.filePath, number(file.linesPct), number(file.branchesPct), number(file.funcsPct), number(file.stmtsPct),
        ]), [263, 59, 59, 59, width - 440], { limit: 60 });
        section("06", "Complexity hotspots", "Cyclomatic complexity counts independent execution paths. The highest recorded values appear first; high values identify functions worth reviewing.");
        table(["SOURCE FILE", "FUNCTION", "COMPLEXITY"], analysis.complexity.map((item) => [item.filePath, item.functionName, item.value]), [230, 180, width - 410], { limit: 40 });
        section("07", "Security findings", "Saved findings from this snapshot. An empty list means no saved findings are available, rather than a security certification.");
        table(["SEVERITY", "LOCATION", "FINDING"], analysis.vulnerabilities.map((item) => [item.severity, `${item.file}${item.line ? `:${item.line}` : ""}`, item.description]), [80, 190, width - 270], { limit: 25 });
        section("08", "Suggested next steps", "Saved AI suggestions for this snapshot. Validate each suggestion against the current source before applying it.");
        table(["PRIORITY", "LOCATION", "SUGGESTION"], analysis.suggestions.map((item) => [item.priority, `${item.filePath}\n${item.functionName}`, item.message]), [80, 190, width - 270], { limit: 20 });
        const recommendations = Array.isArray(quality?.recommendations) ? quality.recommendations : [];
        if (recommendations.length) {
            ensure(100);
            paragraph("Quality report recommendations", { size: 10, color: colors.ink });
            table(["IMPACT", "ACTION", "RECOMMENDATION"], recommendations.map((item) => [
                item.impact, item.title, item.description,
            ]), [80, 190, width - 270], { limit: 10 });
        }

        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            doc.moveTo(left, 790).lineTo(left + width, 790).lineWidth(0.5).strokeColor(colors.rule).stroke();
            // Bottom margin is temporarily removed so footer text cannot create a new page.
            doc.page.margins.bottom = 0;
            text(`CovAI  /  ${short(report.project.name, 55)}`, left, 801, { size: 7, color: colors.muted, width: 365, lineBreak: false });
            text(`${i + 1} / ${range.count}`, left + 395, 801, { size: 7, color: colors.muted, width: width - 395, align: "right", lineBreak: false });
        }
        doc.end();
    } catch (error) { doc.destroy(); reject(error); }
});
