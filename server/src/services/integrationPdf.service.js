import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { getEndpointCaseCoverage } from "../../../shared/integrationCaseCoverage.js";

const FONTS_DIR = new URL("../assets/fonts/", import.meta.url);

const COLORS = {
  ink: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  accent: "#4F46E5",
  rule: "#E2E8F0",
  paper: "#F8FAFC",
  headerFill: "#0F172A",
  pass: "#15803D",
  warn: "#B45309",
  fail: "#DC2626",
};

const cleanText = (value, limit = 300) => {
  const str = String(value ?? "N/A")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .normalize("NFC")
    .trim();
  if (!str) return "N/A";
  return str.length > limit ? `${str.slice(0, limit - 3)}...` : str;
};

const formatDateTime = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date) + " (UTC+7)"
  );
};

const formatPct = (value) =>
  Number.isFinite(Number(value)) ? `${Number(Number(value).toFixed(1))}%` : "N/A";

const computeRouteEntry = (ep, fallbackFromReport = false) => {
  const scenarios = Array.isArray(ep.scenarios) ? ep.scenarios : [];
  const passScenarios = scenarios.filter(
    (s) => s.status === "passed" || s.executionVerdict === "PASS",
  ).length;
  const failScenarios = scenarios.filter(
    (s) => s.status === "failed" || s.executionVerdict === "FAIL",
  ).length;
  const caseCoverage = ep.caseCoverage || getEndpointCaseCoverage(ep, scenarios);

  const rawStatus = String(ep.status || "").toUpperCase();
  const isFailed =
    rawStatus === "FAILED" ||
    rawStatus === "FAIL" ||
    (ep.failedCount || 0) > 0 ||
    failScenarios > 0;
  const isCovered =
    !isFailed &&
    (rawStatus === "COVERED" ||
      rawStatus === "PASS" ||
      rawStatus === "PASSED" ||
      rawStatus === "PARTIAL" ||
      (ep.passedCount || 0) > 0 ||
      passScenarios > 0);

  let status = "UNCOVERED";
  if (isFailed) status = "FAILED";
  else if (isCovered && (fallbackFromReport ? caseCoverage.isComplete || rawStatus === "COVERED" : caseCoverage.isFullyVerified)) {
    status = "COVERED";
  } else if (isCovered) {
    status = "PARTIAL";
  }

  return {
    method: String(ep.method || "GET").toUpperCase(),
    path: ep.fullPath || ep.path || ep.route || "/",
    handler: ep.controllerMethod || ep.controllerName || ep.handler || "anonymousHandler",
    sourceFile: ep.sourceFile || ep.source?.sourceFile || ep.filePath || "routes/api.js",
    status,
    scenarioCount: ep.scenarioCount ?? scenarios.length,
    passedCount: ep.passedCount ?? passScenarios,
    failedCount: ep.failedCount ?? failScenarios,
    avgDurationMs: Number(ep.avgDurationMs || 0),
    latencyStatus: ep.latencyStatus || "NORMAL",
    caseCoverage: {
      coveredCount: caseCoverage.coveredCount || 0,
      passedCasesCount: caseCoverage.passedCasesCount || 0,
      totalRequired: caseCoverage.totalRequired || 0,
      isComplete: Boolean(caseCoverage.isComplete),
      isFullyVerified: Boolean(caseCoverage.isFullyVerified),
      missingCases: (caseCoverage.missingCases || []).map((c) => ({ key: c.key, label: c.label })),
      cases: (caseCoverage.cases || []).map((c) => ({
        key: c.key,
        label: c.label,
        covered: Boolean(c.covered),
        passed: Boolean(c.passed),
        failed: Boolean(c.failed),
      })),
    },
    scenarios: scenarios.map((s) => ({
      id: s.scenarioId || s.id || null,
      title: s.title || s.name || s.testName || "Integration scenario",
      status: s.status || "READY",
      expectedStatus: s.expectedStatus ?? null,
      actualStatus: s.actualStatus ?? null,
      durationMs: s.duration ?? s.durationMs ?? null,
      origin: s.origin || "AI",
      failureLayer: s.failureLayer || null,
    })),
  };
};

/**
 * Build a canonical, schema-consistent integration report DTO for JSON and PDF export.
 */
export const buildIntegrationExportDto = ({
  project = null,
  report = {},
  workspace = null,
  snapshotId = null,
} = {}) => {
  const usePeak = Boolean(
    report?.isPeakCoverageReport &&
      Array.isArray(report?.routeMatrix) &&
      report.routeMatrix.length > 0,
  );

  const resolvedSnapshotId =
    snapshotId || report?.overview?.snapshotId || workspace?.snapshotId || null;

  const sourceEndpoints = usePeak
    ? report.routeMatrix
    : Array.isArray(workspace?.endpoints) && workspace.endpoints.length > 0
      ? workspace.endpoints
      : Array.isArray(report?.routeMatrix)
        ? report.routeMatrix
        : [];

  const routeMatrix = sourceEndpoints.map((ep) =>
    computeRouteEntry(ep, usePeak || !(workspace?.endpoints?.length > 0)),
  );

  const totalDiscovered = Math.max(
    routeMatrix.length,
    report?.apiCoverage?.discoveredApis || 0,
    workspace?.summary?.discoveredApis || 0,
  );
  const coveredRoutes = routeMatrix.filter((r) => r.status === "COVERED");
  const partialRoutes = routeMatrix.filter((r) => r.status === "PARTIAL");
  const failedRoutes = routeMatrix.filter((r) => r.status === "FAILED");
  const uncoveredRoutes = routeMatrix.filter((r) => r.status === "UNCOVERED");

  const totalTested = coveredRoutes.length;
  const totalUncovered = Math.max(0, totalDiscovered - totalTested);
  const apiCoverageRate =
    totalDiscovered > 0 ? Number(((totalTested / totalDiscovered) * 100).toFixed(1)) : 0;

  const allScenarios = routeMatrix.flatMap((r) =>
    (r.scenarios || []).map((s) => ({ ...s, targetEndpoint: `${r.method} ${r.path}` })),
  );

  const latestExec = report?.latestExecution || workspace?.execution || {};
  const executedPass = allScenarios.filter(
    (s) => String(s.status).toLowerCase() === "passed",
  ).length;
  const executedFail = allScenarios.filter(
    (s) => String(s.status).toLowerCase() === "failed",
  ).length;

  const totalScenarios = Math.max(
    allScenarios.length,
    latestExec?.totalTests || 0,
    report?.overview?.totalScenarios || 0,
  );
  const totalExecuted = Math.max(
    executedPass + executedFail,
    latestExec?.totalTests || 0,
  );
  const totalFailed = executedFail > 0 ? executedFail : latestExec?.failedTests || 0;
  const totalPassed =
    executedPass > 0
      ? executedPass
      : Math.max(0, latestExec?.passedTests ?? totalExecuted - totalFailed);
  const passRate =
    totalExecuted > 0 ? Number(((totalPassed / totalExecuted) * 100).toFixed(1)) : 0;

  const hasExecutedCoverage = Boolean(
    report?.apiCoverage?.hasExecutedCoverage ||
      report?.overview?.hasExecutedCoverage ||
      totalExecuted > 0,
  );

  const qualityScore = hasExecutedCoverage
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(apiCoverageRate * 0.45 + passRate * 0.45 + (totalFailed === 0 ? 10 : 0)),
        ),
      )
    : null;
  const qualityGrade =
    qualityScore == null
      ? "—"
      : qualityScore >= 95
        ? "A+"
        : qualityScore >= 85
          ? "A"
          : qualityScore >= 70
            ? "B"
            : qualityScore >= 50
              ? "C"
              : "D";
  const verdict = !hasExecutedCoverage
    ? "PENDING_ANALYSIS"
    : totalFailed > 0
      ? "REGRESSION_DETECTED"
      : apiCoverageRate >= 80 && passRate === 100
        ? "PRODUCTION_READY"
        : "PARTIAL_COVERAGE";

  const durationMs = Number(latestExec?.durationMs || 0);
  const avgDurationMs = totalExecuted > 0 ? Math.round(durationMs / totalExecuted) : 0;
  const throughputTestsPerSec =
    durationMs > 0 ? Number((totalExecuted / (durationMs / 1000)).toFixed(1)) : 0;

  const failureLogs =
    Array.isArray(report?.failureLogs) && report.failureLogs.length > 0
      ? report.failureLogs
      : failedRoutes.map((r, idx) => ({
          id: `fail_${idx + 1}`,
          targetEndpoint: `${r.method} ${r.path}`,
          title: `Endpoint regression on ${r.path}`,
          failureLayer: "ASSERTION_FAILED",
          expectedStatus: 200,
          responseStatus: null,
          sourceFile: r.sourceFile,
          errorMessage: "Endpoint has failing test scenarios or contract mismatch.",
        }));

  const methodDistribution = (() => {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OTHER"];
    const counts = Object.fromEntries(methods.map((m) => [m, { total: 0, tested: 0 }]));
    routeMatrix.forEach((r) => {
      const key = counts[r.method] ? r.method : "OTHER";
      counts[key].total += 1;
      if (r.status === "COVERED") counts[key].tested += 1;
    });
    return methods
      .filter((m) => counts[m].total > 0)
      .map((method) => ({
        method,
        total: counts[method].total,
        tested: counts[method].tested,
        uncovered: counts[method].total - counts[method].tested,
        coverageRate: Math.round((counts[method].tested / counts[method].total) * 100),
      }));
  })();

  const layerHealth =
    Array.isArray(report?.layerHealth) && report.layerHealth.length > 0
      ? report.layerHealth
      : [
          { layer: "Router", key: "ROUTER_NOT_FOUND", description: "Route path resolution & mounting" },
          { layer: "Middleware", key: "MIDDLEWARE_REJECTED", description: "Auth tokens, CORS, body validation" },
          { layer: "Controller", key: "CONTROLLER_CRASH", description: "Business logic runtime stability" },
          { layer: "Database", key: "DATABASE_FAILURE", description: "Queries, ORM relations & constraints" },
          { layer: "Assertion", key: "ASSERTION_FAILED", description: "Contract schemas & HTTP status codes" },
        ].map((item) => {
          const failures = failureLogs.filter((f) => f.failureLayer === item.key).length;
          return {
            ...item,
            failures,
            status: failures === 0 ? "HEALTHY" : "DEGRADED",
          };
        });

  const moduleBreakdown = (() => {
    if (Array.isArray(report?.moduleBreakdown) && report.moduleBreakdown.length > 0) {
      return report.moduleBreakdown;
    }
    const map = {};
    routeMatrix.forEach((r) => {
      const segs = (r.path || "").split("/").filter(Boolean);
      let idx = 0;
      while (idx < segs.length && /^(api|v\d+)$/i.test(segs[idx])) idx++;
      const mod = idx < segs.length ? segs[idx].replace(/^:/, "").toUpperCase() || "ROOT" : "ROOT";
      if (!map[mod]) {
        map[mod] = {
          module: mod,
          totalEndpoints: 0,
          testedEndpoints: 0,
          scenariosCount: 0,
          failedCount: 0,
        };
      }
      map[mod].totalEndpoints += 1;
      if (r.status === "COVERED") map[mod].testedEndpoints += 1;
      if (r.status === "FAILED") map[mod].failedCount += 1;
      map[mod].scenariosCount += r.scenarioCount || 0;
    });
    return Object.values(map)
      .map((m) => ({
        ...m,
        coveragePct: m.totalEndpoints > 0 ? Math.round((m.testedEndpoints / m.totalEndpoints) * 100) : 0,
        health:
          m.failedCount > 0
            ? "FAILING"
            : m.testedEndpoints === m.totalEndpoints
              ? "FULL_COVERAGE"
              : "PARTIAL",
      }))
      .sort((a, b) => b.totalEndpoints - a.totalEndpoints);
  })();

  const codeCov = report?.projectCodeCoverage || workspace?.summary?.codeCoverage || null;

  return {
    schemaVersion: "1.0",
    reportType: "integration",
    exportedAt: new Date().toISOString(),
    isPeakCoverageReport: usePeak,
    project: {
      id: project?.id || null,
      name: project?.name || "CovAI Project",
      description: project?.description || null,
      repoUrl: project?.repoUrl || null,
    },
    snapshotId: resolvedSnapshotId,
    qualityHealth: {
      score: qualityScore,
      grade: qualityGrade,
      verdict,
      passRate,
    },
    overview: {
      snapshotId: resolvedSnapshotId,
      totalScenarios,
      totalDiscoveredEndpoints: totalDiscovered,
      totalTestedEndpoints: totalTested,
      partialEndpoints: partialRoutes.length,
      failedEndpoints: failedRoutes.length,
      uncoveredEndpoints: totalUncovered,
      apiCoverageRate,
      unmodifiedAiScenarios: report?.overview?.unmodifiedAiScenarios || 0,
      modifiedScenarios: report?.overview?.modifiedScenarios || 0,
      hasScannedEndpoints: Boolean(
        report?.apiCoverage?.hasScannedEndpoints ||
          report?.overview?.hasScannedEndpoints ||
          routeMatrix.length > 0,
      ),
      hasExecutedCoverage,
    },
    apiCoverage: {
      discoveredApis: totalDiscovered,
      testedApis: totalTested,
      partialApis: partialRoutes.length,
      uncoveredApis: uncoveredRoutes.length,
      failedApis: failedRoutes.length,
      coveragePercentage: apiCoverageRate,
    },
    projectCodeCoverage: codeCov
      ? {
          stmtsPct: Number(codeCov.stmtsPct ?? codeCov.statement ?? 0),
          linesPct: Number(codeCov.linesPct ?? codeCov.line ?? codeCov.stmtsPct ?? 0),
          branchesPct: Number(codeCov.branchesPct ?? codeCov.branch ?? 0),
          funcsPct: Number(codeCov.funcsPct ?? codeCov.function ?? 0),
        }
      : null,
    latestExecution: {
      testRunId: latestExec?.testRunId || latestExec?.id || null,
      timestamp: latestExec?.timestamp || latestExec?.completedAt || null,
      status: latestExec?.status || (totalExecuted > 0 ? (totalFailed > 0 ? "FAILED" : "PASSED") : "PENDING"),
      totalExecuted,
      totalPassed,
      totalFailed,
      skippedTests: Number(latestExec?.skippedTests || 0),
      passRate,
      durationMs,
      avgDurationMs,
      throughputTestsPerSec,
    },
    methodDistribution,
    layerHealth,
    scenarioClassification: report?.scenarioClassification || null,
    moduleBreakdown,
    routeMatrix,
    failureLogs,
    history: report?.history || { executions: [], coverage: [], generations: [] },
  };
};

/**
 * Render a genuine, paginated A4 vector PDF report for API Integration Testing.
 */
export const renderIntegrationReportPdf = (dto) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: `${cleanText(dto?.project?.name || "CovAI", 100)} - Integration Test Report`,
        Author: "CovAI",
        Subject: "API Integration Coverage & Verification Report",
        Creator: "CovAI Integration Report Exporter",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      doc.registerFont("Body", fileURLToPath(new URL("NotoSans-Regular.ttf", FONTS_DIR)));
      doc.registerFont("Bold", fileURLToPath(new URL("NotoSans-Bold.ttf", FONTS_DIR)));

      const left = 48;
      const width = 499.28;
      const bottom = 772;
      let y = 90;

      const text = (value, x, top, options = {}) => {
        const { bold = false, size = 9.5, color = COLORS.ink, ...rest } = options;
        doc
          .font(bold ? "Bold" : "Body")
          .fontSize(size)
          .fillColor(color)
          .text(String(value ?? ""), x, top, { width, lineGap: 2, ...rest });
      };

      const measureHeight = (value, size = 9.5, cellWidth = width, bold = false) =>
        doc
          .font(bold ? "Bold" : "Body")
          .fontSize(size)
          .heightOfString(String(value ?? ""), { width: cellWidth, lineGap: 2 });

      const addPage = () => {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, 4).fill(COLORS.accent);
        text("CovAI", left, 26, { bold: true, size: 13 });
        text("INTEGRATION TEST REPORT", 220, 30, {
          size: 8,
          color: COLORS.muted,
          width: 327,
          align: "right",
          characterSpacing: 0.8,
        });
        doc
          .moveTo(left, 56)
          .lineTo(left + width, 56)
          .lineWidth(0.5)
          .strokeColor(COLORS.rule)
          .stroke();
        y = 76;
      };

      const ensure = (space) => {
        if (y + space > bottom) addPage();
      };

      const paragraph = (value, { size = 9, color = COLORS.muted } = {}) => {
        const content = cleanText(value, 1400);
        const h = measureHeight(content, size);
        ensure(h + 10);
        text(content, left, y, { size, color });
        y += h + 10;
      };

      const section = (index, title, subtitle) => {
        const subH = subtitle ? measureHeight(cleanText(subtitle, 400), 8.5) + 8 : 0;
        ensure(36 + subH + 45);
        text(index, left, y + 2, { bold: true, size: 9.5, color: COLORS.accent, width: 24 });
        text(title, left + 26, y, { bold: true, size: 14, width: width - 26 });
        y += 22;
        if (subtitle) paragraph(subtitle, { size: 8.5, color: COLORS.muted });
        else y += 4;
      };

      const drawTable = (headers, rows, widths, { limit = 120, statusColIndex = -1 } = {}) => {
        if (!rows.length) {
          paragraph("No records available in this snapshot.", { size: 8.5 });
          return;
        }
        const drawHeader = () => {
          doc.rect(left, y, width, 24).fill(COLORS.headerFill);
          let x = left;
          headers.forEach((label, i) => {
            text(label, x + 7, y + 7, {
              size: 7.5,
              bold: true,
              color: "#FFFFFF",
              width: widths[i] - 14,
              lineBreak: false,
            });
            x += widths[i];
          });
          y += 24;
        };

        ensure(64);
        drawHeader();

        rows.slice(0, limit).forEach((row, rIdx) => {
          const cells = row.map((cell, cIdx) => cleanText(cell, widths[cIdx] < 70 ? 32 : 240));
          const rowH = Math.max(
            24,
            ...cells.map((cell, cIdx) => measureHeight(cell, 8, widths[cIdx] - 14) + 12),
          );
          if (y + rowH > bottom) {
            addPage();
            drawHeader();
          }
          if (rIdx % 2 === 0) doc.rect(left, y, width, rowH).fill(COLORS.paper);

          let x = left;
          cells.forEach((cell, cIdx) => {
            let cellColor = COLORS.body;
            let isBold = cIdx === 0;
            if (cIdx === statusColIndex) {
              isBold = true;
              const upper = cell.toUpperCase();
              if (upper.includes("COVERED") || upper.includes("PASS") || upper.includes("HEALTHY") || upper.includes("FULL")) {
                cellColor = COLORS.pass;
              } else if (upper.includes("FAIL") || upper.includes("DEGRADED") || upper.includes("REGRESSION")) {
                cellColor = COLORS.fail;
              } else if (upper.includes("PARTIAL") || upper.includes("UNCOVERED")) {
                cellColor = COLORS.warn;
              }
            }
            text(cell, x + 7, y + 6, {
              size: 8,
              bold: isBold,
              color: cellColor,
              width: widths[cIdx] - 14,
            });
            x += widths[cIdx];
          });

          y += rowH;
          doc
            .moveTo(left, y)
            .lineTo(left + width, y)
            .lineWidth(0.4)
            .strokeColor(COLORS.rule)
            .stroke();
        });

        y += 10;
        if (rows.length > limit) {
          paragraph(
            `Showing ${limit} of ${rows.length} rows. Export JSON for the complete dataset.`,
            { size: 8 },
          );
        }
      };

      const drawMetricCard = (label, value, sub, x, top, w, progressPct = null) => {
        doc.roundedRect(x, top, w, 74, 4).fill(COLORS.paper);
        doc
          .roundedRect(x, top, w, 74, 4)
          .lineWidth(0.6)
          .strokeColor(COLORS.rule)
          .stroke();
        text(label, x + 10, top + 10, { size: 7.5, bold: true, color: COLORS.muted, width: w - 20 });
        text(value, x + 10, top + 25, { size: 18, bold: true, color: COLORS.ink, width: w - 20 });
        text(sub, x + 10, top + 50, { size: 7.5, color: COLORS.muted, width: w - 20, lineBreak: false });
        if (progressPct != null && Number.isFinite(progressPct)) {
          doc.rect(x + 10, top + 65, w - 20, 3).fill(COLORS.rule);
          const fillW = ((w - 20) * Math.max(0, Math.min(100, progressPct))) / 100;
          if (fillW > 0) doc.rect(x + 10, top + 65, fillW, 3).fill(COLORS.accent);
        }
      };

      // Cover / Page 1
      addPage();
      text("API INTEGRATION AUDIT", left, y, {
        size: 8.5,
        bold: true,
        color: COLORS.accent,
        characterSpacing: 1,
      });
      y += 18;
      const projectTitle = cleanText(dto?.project?.name || "CovAI Project", 140);
      text(projectTitle, left, y, { size: 24, bold: true });
      y += measureHeight(projectTitle, 24, width, true) + 6;
      text("Integration Test Coverage & Verification Report", left, y, {
        size: 13,
        color: COLORS.muted,
      });
      y += 28;

      const verdictMap = {
        PRODUCTION_READY: "Production ready",
        REGRESSION_DETECTED: "Regression detected",
        PARTIAL_COVERAGE: "Needs attention",
        PENDING_ANALYSIS: "Pending analysis",
      };
      const verdictLabel = verdictMap[dto?.qualityHealth?.verdict] || "Pending analysis";

      drawTable(
        ["METADATA", "VALUE"],
        [
          ["Project", `${projectTitle}${dto?.project?.id ? ` (${dto.project.id})` : ""}`],
          ["Snapshot", dto?.snapshotId || "Latest"],
          ["Verdict", verdictLabel],
          ["Report Scope", dto?.isPeakCoverageReport ? "Peak coverage snapshot preserved" : "Live snapshot state"],
          ["Engine", "Supertest / Node Integration Runner"],
          ["Exported", formatDateTime(dto?.exportedAt)],
        ],
        [120, width - 120],
      );

      // Section 01: Executive Summary
      section(
        "01",
        "Executive summary",
        "Measured endpoint verification, scenario pass rate, and execution performance for this snapshot.",
      );
      ensure(88);
      const cardW = (width - 24) / 4;
      const qScore = dto?.qualityHealth?.score;
      const qGrade = dto?.qualityHealth?.grade || "—";
      const epCov = dto?.overview?.apiCoverageRate ?? 0;
      const testedEps = dto?.overview?.totalTestedEndpoints ?? 0;
      const totalEps = dto?.overview?.totalDiscoveredEndpoints ?? 0;
      const passRate = dto?.latestExecution?.passRate ?? 0;
      const passedTests = dto?.latestExecution?.totalPassed ?? 0;
      const executedTests = dto?.latestExecution?.totalExecuted ?? 0;
      const failedTests = dto?.latestExecution?.totalFailed ?? 0;
      const durationSec = ((dto?.latestExecution?.durationMs || 0) / 1000).toFixed(1);

      drawMetricCard(
        "Quality score",
        qScore != null ? `${qScore} / 100` : "—",
        `Grade ${qGrade}`,
        left,
        y,
        cardW,
        qScore,
      );
      drawMetricCard(
        "Endpoint coverage",
        `${epCov}%`,
        `${testedEps} / ${totalEps} routes`,
        left + (cardW + 8),
        y,
        cardW,
        epCov,
      );
      drawMetricCard(
        "Pass rate",
        executedTests > 0 ? `${passRate}%` : "—",
        `${passedTests} pass / ${failedTests} fail`,
        left + (cardW + 8) * 2,
        y,
        cardW,
        executedTests > 0 ? passRate : null,
      );
      drawMetricCard(
        "Run duration",
        `${durationSec}s`,
        `${dto?.latestExecution?.avgDurationMs || 0}ms avg / case`,
        left + (cardW + 8) * 3,
        y,
        cardW,
      );
      y += 86;

      if (dto?.projectCodeCoverage) {
        const cc = dto.projectCodeCoverage;
        paragraph(
          `Measured code coverage: Lines ${formatPct(cc.linesPct)}  |  Statements ${formatPct(cc.stmtsPct)}  |  Branches ${formatPct(cc.branchesPct)}  |  Functions ${formatPct(cc.funcsPct)}`,
          { size: 8.5, color: COLORS.body },
        );
      }

      // Section 02: Method & Layer Health
      section(
        "02",
        "Protocol & layer diagnostics",
        "HTTP method coverage breakdown and 5-layer request lifecycle health.",
      );
      drawTable(
        ["METHOD", "TOTAL ROUTES", "VERIFIED", "UNCOVERED", "COVERAGE"],
        (dto?.methodDistribution || []).map((m) => [
          m.method,
          String(m.total),
          String(m.tested),
          String(m.uncovered),
          `${m.coverageRate}%`,
        ]),
        [80, 100, 100, 100, width - 380],
      );

      drawTable(
        ["LAYER", "SCOPE", "FAILURES", "STATUS"],
        (dto?.layerHealth || []).map((l) => [
          l.layer,
          l.description,
          String(l.failures || 0),
          l.status,
        ]),
        [95, 250, 70, width - 415],
        { statusColIndex: 3 },
      );

      // Section 03: Failures
      section(
        "03",
        "Failure localization",
        "Failing scenarios grouped by target endpoint and request lifecycle layer.",
      );
      if ((dto?.failureLogs || []).length === 0) {
        paragraph(
          executedTests > 0
            ? `All ${passedTests} executed scenarios passed across 5 layers with no regressions.`
            : "No executed test failures recorded for this snapshot.",
          { size: 9, color: COLORS.body },
        );
      } else {
        drawTable(
          ["ENDPOINT", "LAYER", "STATUS", "DIAGNOSTIC MESSAGE"],
          dto.failureLogs.map((f) => [
            f.targetEndpoint || "Endpoint",
            f.failureLayer || "ASSERTION_FAILED",
            `Exp ${f.expectedStatus ?? "?"} / Got ${f.responseStatus ?? "ERR"}`,
            f.errorMessage || "Assertion mismatch",
          ]),
          [130, 105, 85, width - 320],
          { limit: 40 },
        );
      }

      // Section 04: Endpoint & Contract Matrix
      section(
        "04",
        "Endpoint verification matrix",
        "Discovered Express/Node routes, required contract test cases, scenario counts, and verification status.",
      );
      drawTable(
        ["METHOD", "ENDPOINT", "HANDLER", "CASES", "SCENARIOS", "STATUS"],
        (dto?.routeMatrix || []).map((r) => {
          const cc = r.caseCoverage || {};
          const missing = (cc.missingCases || []).map((c) => c.label).join(", ");
          const caseText = `${cc.coveredCount ?? 0}/${cc.totalRequired ?? 0}${missing ? ` (missing: ${missing})` : ""}`;
          return [
            r.method,
            r.path,
            r.handler,
            caseText,
            `${r.passedCount ?? 0}/${r.scenarioCount ?? 0} pass`,
            r.status,
          ];
        }),
        [48, 132, 95, 105, 58, width - 438],
        { limit: 150, statusColIndex: 5 },
      );

      // Section 05: Modules & Recent Runs
      if ((dto?.moduleBreakdown || []).length > 0) {
        section("05", "Functional module breakdown");
        drawTable(
          ["MODULE", "ENDPOINTS", "VERIFIED", "SCENARIOS", "COVERAGE", "HEALTH"],
          dto.moduleBreakdown.map((m) => [
            m.module,
            String(m.totalEndpoints),
            String(m.testedEndpoints),
            String(m.scenariosCount),
            `${m.coveragePct}%`,
            m.health,
          ]),
          [110, 75, 75, 75, 75, width - 410],
          { statusColIndex: 5 },
        );
      }

      const recentExecs = (dto?.history?.executions || []).slice(-10).reverse();
      if (recentExecs.length > 0) {
        section("06", "Recent execution history");
        drawTable(
          ["TIMESTAMP", "STATUS", "PASSED / TOTAL", "DURATION"],
          recentExecs.map((run) => [
            formatDateTime(run.timestamp),
            run.status,
            `${run.passedTests ?? 0} / ${run.totalTests ?? 0}`,
            `${((run.durationMs || 0) / 1000).toFixed(1)}s`,
          ]),
          [185, 105, 110, width - 400],
          { statusColIndex: 1 },
        );
      }

      // Page headers & footers
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc
          .moveTo(left, 790)
          .lineTo(left + width, 790)
          .lineWidth(0.5)
          .strokeColor(COLORS.rule)
          .stroke();
        const prevBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        text(`CovAI  /  ${cleanText(dto?.project?.name || "Integration Report", 50)}`, left, 800, {
          size: 7.5,
          color: COLORS.muted,
          width: 340,
          lineBreak: false,
        });
        text(`Page ${i + 1} / ${range.count}`, left + 350, 800, {
          size: 7.5,
          color: COLORS.muted,
          width: width - 350,
          align: "right",
          lineBreak: false,
        });
        doc.page.margins.bottom = prevBottom;
      }

      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
