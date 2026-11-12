/**
 * Unit Test Report Export Service (Requirement R3)
 * 
 * Provides client-side formatting and download capabilities for Unit Test results:
 * - Technical Markdown (.md) for GitHub PRs, documentation, and CI summaries.
 * - Structured JSON (.json) for automated pipelines, audit logging, and integrations.
 * - Standalone HTML (.html) with print-to-PDF (@media print) support and CovAI dark engineering theme.
 * - Zero external CDN dependencies, self-contained and hermetic.
 */

/**
 * Escapes characters for safe HTML inclusion.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Formats duration in milliseconds into a human-readable string.
 */
function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(2)} s`;
  const mins = Math.floor(n / 60000);
  const secs = ((n % 60000) / 1000).toFixed(1);
  return `${mins}m ${secs}s`;
}

/**
 * Normalizes disparate test result objects (from raw runners, executions.vitest/jest,
 * test runs, or dashboard summaries) into a consistent data structure.
 */
export function normalizeUnitTestData(data = {}) {
  const safeData = data || {};

  const projectName =
    safeData.projectName ||
    safeData.project?.name ||
    safeData.context?.projectName ||
    "CovAI Project";

  const snapshotId =
    safeData.snapshotId ||
    safeData.context?.snapshotId ||
    safeData.project?.snapshotId ||
    "";

  const exportedAt = safeData.exportedAt || new Date().toISOString();

  // Infer framework from runs or executions
  let framework = safeData.framework;
  if (!framework) {
    const hasVitest = Boolean(safeData.executions?.vitest);
    const hasJest = Boolean(safeData.executions?.jest);
    if (hasVitest && hasJest) framework = "Vitest & Jest";
    else if (hasVitest) framework = "Vitest";
    else if (hasJest) framework = "Jest";
    else framework = "Vitest / Jest";
  }

  // Aggregate test runs
  const runs = [];
  if (safeData.executions?.vitest) runs.push(safeData.executions.vitest);
  if (safeData.executions?.jest) runs.push(safeData.executions.jest);
  if (Array.isArray(safeData.runs)) runs.push(...safeData.runs);
  if (runs.length === 0 && (safeData.totalTests !== undefined || Array.isArray(safeData.scenarios))) {
    runs.push(safeData);
  }

  // Calculate totals
  let totalTests = Number(
    safeData.totalTests ??
      safeData.totals?.totalTests ??
      safeData.totals?.total ??
      safeData.testTotals?.total ??
      0
  );
  let passedTests = Number(
    safeData.passedTests ??
      safeData.totals?.passedTests ??
      safeData.totals?.passed ??
      safeData.testTotals?.passed ??
      0
  );
  let failedTests = Number(
    safeData.failedTests ??
      safeData.totals?.failedTests ??
      safeData.totals?.failed ??
      safeData.testTotals?.failed ??
      0
  );
  let skippedTests = Number(
    safeData.skippedTests ??
      safeData.totals?.skippedTests ??
      safeData.totals?.skipped ??
      safeData.testTotals?.skipped ??
      0
  );
  let durationMs = Number(
    safeData.durationMs ??
      safeData.totals?.durationMs ??
      safeData.totals?.duration ??
      safeData.duration ??
      0
  );

  // If totals were 0 but we have runs, aggregate from runs
  if (totalTests === 0 && runs.length > 0) {
    totalTests = runs.reduce((acc, r) => acc + (Number(r.totalTests) || 0), 0);
    passedTests = runs.reduce((acc, r) => acc + (Number(r.passedTests) || 0), 0);
    failedTests = runs.reduce((acc, r) => acc + (Number(r.failedTests) || 0), 0);
    skippedTests = runs.reduce((acc, r) => acc + (Number(r.skippedTests) || 0), 0);
    durationMs = runs.reduce((acc, r) => acc + (Number(r.durationMs || r.duration) || 0), 0);
  }

  const passRate =
    totalTests > 0 ? Number(((passedTests / totalTests) * 100).toFixed(2)) : (totalTests === 0 ? 100.0 : 0.0);

  const status =
    safeData.status ||
    (failedTests > 0 ? "FAILED" : totalTests > 0 ? "PASSED" : "NO_TESTS");

  // Extract coverage metrics
  const covSource = safeData.coverage || safeData.summary?.coverage || safeData.summary || {};
  const linesPct =
    covSource.linesPct ??
    covSource.lines ??
    safeData.coverageLinesPct ??
    (runs[0]?.coverageLinesPct ?? null);
  const statementsPct =
    covSource.statementsPct ??
    covSource.statements ??
    covSource.stmtsPct ??
    safeData.coverageStatementsPct ??
    (runs[0]?.coverageStatementsPct ?? null);
  const functionsPct =
    covSource.functionsPct ??
    covSource.functions ??
    covSource.funcsPct ??
    safeData.coverageFunctionsPct ??
    (runs[0]?.coverageFunctionsPct ?? null);
  const branchesPct =
    covSource.branchesPct ??
    covSource.branches ??
    safeData.coverageBranchesPct ??
    (runs[0]?.coverageBranchesPct ?? null);

  const coverage = {
    linesPct: linesPct !== null && linesPct !== undefined ? Number(Number(linesPct).toFixed(1)) : null,
    statementsPct: statementsPct !== null && statementsPct !== undefined ? Number(Number(statementsPct).toFixed(1)) : null,
    functionsPct: functionsPct !== null && functionsPct !== undefined ? Number(Number(functionsPct).toFixed(1)) : null,
    branchesPct: branchesPct !== null && branchesPct !== undefined ? Number(Number(branchesPct).toFixed(1)) : null,
  };

  // Collect and normalize scenarios
  const rawScenarios = Array.isArray(safeData.scenarios)
    ? safeData.scenarios
    : runs.flatMap((r) => r.scenarios || []);

  const scenarios = rawScenarios.map((s, idx) => {
    const rawStatus = (s.status || (s.passed ? "passed" : "failed")).toLowerCase();
    const isPassed = rawStatus === "passed" || rawStatus === "pass";
    const isSkipped = rawStatus === "pending" || rawStatus === "skipped" || rawStatus === "skip";
    const normalizedStatus = isPassed ? "passed" : isSkipped ? "skipped" : "failed";

    let failureMessages = [];
    if (Array.isArray(s.failureMessages)) {
      failureMessages = s.failureMessages.map((m) => String(m));
    } else if (typeof s.failureMessages === "string" && s.failureMessages.trim()) {
      failureMessages = [s.failureMessages.trim()];
    } else if (s.errorMessage || s.message) {
      failureMessages = [String(s.errorMessage || s.message)];
    } else if (s.error?.message) {
      failureMessages = [String(s.error.message)];
    }

    const firstMsg =
      failureMessages[0] ||
      s.error?.message ||
      (normalizedStatus === "failed" ? "Test assertion failed." : null);

    const stack =
      s.error?.stack
        ? (failureMessages.length > 0 && !failureMessages.some((m) => m.includes(s.error.stack))
            ? `${failureMessages.join("\n\n")}\n\n${s.error.stack}`
            : s.error.stack)
        : (failureMessages.join("\n\n") || null);

    return {
      id: s.id || `scenario-${idx + 1}`,
      name: s.title || s.name || s.testName || `Test Case #${idx + 1}`,
      suite: s.suiteName || s.suite || "Unit Test Suite",
      file: s.testFile || s.file || s.filePath || "tests/unit.test.js",
      status: normalizedStatus,
      durationMs: Number(s.durationMs ?? s.duration ?? 0),
      isSuiteLevelFailure: Boolean(s.isSuiteLevelFailure),
      error: normalizedStatus === "failed" ? { message: firstMsg, stack } : null,
      failureCategory: s.failureCategory || null,
      failureStep: s.failureStep || null,
    };
  });

  return {
    projectName,
    snapshotId,
    exportedAt,
    framework,
    totals: {
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      passRate,
      durationMs,
      status,
    },
    coverage,
    scenarios,
  };
}

/**
 * Generates a clean, technical GitHub-flavored Markdown report.
 */
export function formatUnitTestMarkdownReport(data) {
  const norm = normalizeUnitTestData(data);
  const { projectName, snapshotId, exportedAt, framework, totals, coverage, scenarios } = norm;

  const lines = [
    `# Unit Test Execution & Quality Report — ${projectName}`,
    ``,
    `> **Snapshot ID:** \`${snapshotId || "N/A"}\``,
    `> **Exported:** ${exportedAt}`,
    `> **Framework:** ${framework}`,
    `> **Overall Status:** **${totals.status === "PASSED" ? "PASSED ✅" : totals.status === "FAILED" ? "FAILED ❌" : totals.status}**`,
    ``,
    `---`,
    ``,
    `## 1. Executive Summary`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| **Total Tests** | ${totals.totalTests} |`,
    `| **Passed Tests** | ${totals.passedTests} |`,
    `| **Failed Tests** | ${totals.failedTests} |`,
    `| **Skipped Tests** | ${totals.skippedTests} |`,
    `| **Pass Rate** | ${totals.passRate}% |`,
    `| **Total Execution Time** | ${formatDuration(totals.durationMs)} (${totals.durationMs} ms) |`,
    `| **Terminal Status** | \`${totals.status}\` |`,
    ``,
  ];

  // Code coverage section
  const hasCoverage =
    coverage.linesPct !== null ||
    coverage.statementsPct !== null ||
    coverage.functionsPct !== null ||
    coverage.branchesPct !== null;

  if (hasCoverage) {
    lines.push(
      `---`,
      ``,
      `## 2. Code Coverage Metrics`,
      ``,
      `| Coverage Dimension | Result % |`,
      `|---|---|`,
      `| **Line Coverage** | ${coverage.linesPct !== null ? `${coverage.linesPct}%` : "—"} |`,
      `| **Statement Coverage** | ${coverage.statementsPct !== null ? `${coverage.statementsPct}%` : "—"} |`,
      `| **Function Coverage** | ${coverage.functionsPct !== null ? `${coverage.functionsPct}%` : "—"} |`,
      `| **Branch Coverage** | ${coverage.branchesPct !== null ? `${coverage.branchesPct}%` : "—"} |`,
      ``
    );
  }

  // Scenarios breakdown
  lines.push(
    `---`,
    ``,
    `## 3. Test Scenarios Breakdown (${scenarios.length} Scenarios)`,
    ``
  );

  if (scenarios.length > 0) {
    lines.push(
      `| # | Suite / Context | Scenario Name | Target Test File | Status | Duration |`,
      `|---|---|---|---|---|---|`
    );
    scenarios.forEach((sc, idx) => {
      const statusIcon =
        sc.status === "passed" ? "✅ PASS" : sc.status === "skipped" ? "⏸️ SKIP" : "❌ FAIL";
      lines.push(
        `| ${idx + 1} | \`${sc.suite}\` | ${sc.name} | \`${sc.file}\` | ${statusIcon} | ${formatDuration(sc.durationMs)} |`
      );
    });
    lines.push(``);
  } else {
    lines.push(`*No test scenarios recorded.*`, ``);
  }

  // Failure diagnostics & stack traces
  const failedScenarios = scenarios.filter((s) => s.status === "failed");
  lines.push(`---`, ``, `## 4. Failure Diagnostics & Error Traces`, ``);

  if (failedScenarios.length > 0) {
    lines.push(
      `> ⚠️ **${failedScenarios.length} test ${failedScenarios.length === 1 ? "case" : "cases"} failed.** Review error messages and stack traces below:`,
      ``
    );

    failedScenarios.forEach((sc, idx) => {
      lines.push(
        `### Failure ${idx + 1}: \`${sc.suite}\` — ${sc.name}`,
        ``,
        `- **File:** \`${sc.file}\``,
        `- **Duration:** ${formatDuration(sc.durationMs)}`,
        sc.isSuiteLevelFailure ? `- **Note:** *Suite-level compilation or initialization failure*` : null,
        sc.failureCategory ? `- **Category:** \`${sc.failureCategory}\`` : null,
        sc.failureStep ? `- **Failing Step:** \`${sc.failureStep}\`` : null,
        `- **Error Diagnostics:**`,
        ``,
        `\`\`\`text`,
        sc.error?.stack || sc.error?.message || "Test assertion failure (No stack trace available).",
        `\`\`\``,
        ``
      );
    });
  } else if (totals.totalTests > 0) {
    lines.push(`✅ **All ${totals.totalTests} unit test scenarios passed with 100% success rate.** Zero failures detected.`, ``);
  } else {
    lines.push(`*No test executions recorded to diagnose.*`, ``);
  }

  lines.push(
    `---`,
    ``,
    `*Report generated by CovAI Engineering Platform.*`
  );

  return lines.filter((l) => l !== null).join("\n");
}

/**
 * Generates a structured, machine-readable JSON report.
 */
export function formatUnitTestJsonReport(data) {
  const norm = normalizeUnitTestData(data);
  const payload = {
    project: {
      name: norm.projectName,
      snapshotId: norm.snapshotId,
    },
    exportedAt: norm.exportedAt,
    framework: norm.framework,
    summary: {
      totalTests: norm.totals.totalTests,
      passedTests: norm.totals.passedTests,
      failedTests: norm.totals.failedTests,
      skippedTests: norm.totals.skippedTests,
      passRate: norm.totals.passRate,
      durationMs: norm.totals.durationMs,
      durationFormatted: formatDuration(norm.totals.durationMs),
      status: norm.totals.status,
    },
    // Also include metrics alias for consumer flexibility
    metrics: {
      totalTests: norm.totals.totalTests,
      passedTests: norm.totals.passedTests,
      failedTests: norm.totals.failedTests,
      skippedTests: norm.totals.skippedTests,
      passRate: norm.totals.passRate,
      durationMs: norm.totals.durationMs,
      status: norm.totals.status,
    },
    coverage: norm.coverage,
    scenarios: norm.scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      suite: s.suite,
      file: s.file,
      status: s.status,
      durationMs: s.durationMs,
      isSuiteLevelFailure: s.isSuiteLevelFailure,
      error: s.error
        ? {
            message: s.error.message,
            stack: s.error.stack,
          }
        : null,
      failureCategory: s.failureCategory,
      failureStep: s.failureStep,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Generates a standalone, self-contained HTML report with embedded CovAI dark engineering theme
 * and clean print-to-PDF (@media print) stylesheet. Zero external CDN dependencies.
 */
export function formatUnitTestHtmlReport(data) {
  const norm = normalizeUnitTestData(data);
  const { projectName, snapshotId, exportedAt, framework, totals, coverage, scenarios } = norm;
  const failedScenarios = scenarios.filter((s) => s.status === "failed");

  const hasCoverage =
    coverage.linesPct !== null ||
    coverage.statementsPct !== null ||
    coverage.functionsPct !== null ||
    coverage.branchesPct !== null;

  const isSuccess = totals.status === "PASSED";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CovAI Unit Test Report — ${escapeHtml(projectName)}</title>
  <style>
    /* ── CovAI Dark Engineering Palette & Design Tokens ── */
    :root {
      --color-bg: #0B0F14;
      --color-surface: #11161D;
      --color-surface-secondary: #171D25;
      --color-border: #29313D;
      --color-text: #F8FAFC;
      --color-text-secondary: #CBD5E1;
      --color-text-muted: #94A3B8;
      --color-primary: #8B7CFD;
      --color-success: #22C55E;
      --color-danger: #EF4444;
      --color-warning: #F59E0B;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--color-bg);
      color: var(--color-text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
    }

    .font-mono {
      font-family: var(--font-mono);
      font-feature-settings: "tnum";
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--color-border);
      margin-bottom: 24px;
      gap: 16px;
      flex-wrap: wrap;
    }

    .brand-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--color-text);
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(139, 124, 253, 0.15);
      color: var(--color-primary);
      border: 1px solid rgba(139, 124, 253, 0.3);
    }

    .meta-list {
      margin-top: 6px;
      font-size: 12px;
      color: var(--color-text-secondary);
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
    }

    .meta-item strong {
      color: var(--color-text);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-print {
      background: var(--color-surface-secondary);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }

    .btn-print:hover {
      background: var(--color-border);
    }

    /* ── Metric Cards ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 14px 16px;
    }

    .card-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
      margin-bottom: 6px;
    }

    .card-value {
      font-size: 24px;
      font-weight: 700;
      font-family: var(--font-mono);
      font-feature-settings: "tnum";
      line-height: 1.1;
    }

    .card-subtext {
      font-size: 11px;
      color: var(--color-text-muted);
      margin-top: 6px;
    }

    .val-pass { color: var(--color-success); }
    .val-fail { color: var(--color-danger); }
    .val-neutral { color: var(--color-text); }
    .val-primary { color: var(--color-primary); }

    /* ── Tables ── */
    .section-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-secondary);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .table-container {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      overflow-x: auto;
      margin-bottom: 28px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 12px;
    }

    th {
      background: var(--color-surface-secondary);
      color: var(--color-text-secondary);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 10px 14px;
      border-bottom: 1px solid var(--color-border);
    }

    td {
      padding: 9px 14px;
      border-bottom: 1px solid var(--color-border);
      color: var(--color-text);
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    /* ── Badges ── */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 700;
      font-family: var(--font-mono);
      border: 1px solid transparent;
    }

    .badge-pass {
      background: rgba(34, 197, 94, 0.12);
      color: #4ade80;
      border-color: rgba(34, 197, 94, 0.3);
    }

    .badge-fail {
      background: rgba(239, 68, 68, 0.12);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.3);
    }

    .badge-skip {
      background: rgba(148, 163, 184, 0.12);
      color: #cbd5e1;
      border-color: rgba(148, 163, 184, 0.3);
    }

    /* ── Diagnostics / Error Blocks ── */
    .failure-item {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-left: 3px solid var(--color-danger);
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 14px;
    }

    .failure-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .failure-title {
      font-size: 13px;
      font-weight: 700;
      color: #f87171;
    }

    .failure-meta {
      font-size: 11px;
      color: var(--color-text-muted);
      font-family: var(--font-mono);
    }

    pre.stack-trace {
      background: #06090e;
      border: 1px solid var(--color-border);
      color: #fca5a5;
      padding: 10px 12px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      overflow-x: auto;
      white-space: pre-wrap;
      line-height: 1.45;
      margin-top: 8px;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 36px;
      padding-top: 16px;
      border-top: 1px solid var(--color-border);
      font-size: 11px;
      color: var(--color-text-muted);
      text-align: center;
    }

    /* ── Print Stylesheet (@media print) for direct PDF printing ── */
    @media print {
      body {
        background: #ffffff !important;
        color: #0b0f14 !important;
        padding: 0 !important;
      }

      .container {
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .no-print {
        display: none !important;
      }

      .card, .table-container, .failure-item {
        background: #ffffff !important;
        border: 1px solid #d1d5db !important;
        color: #0b0f14 !important;
        box-shadow: none !important;
        page-break-inside: avoid;
      }

      th {
        background: #f3f4f6 !important;
        color: #111827 !important;
        border-bottom: 1px solid #d1d5db !important;
      }

      td {
        color: #111827 !important;
        border-bottom: 1px solid #e5e7eb !important;
      }

      .card-value {
        color: #111827 !important;
      }

      .val-pass { color: #15803d !important; }
      .val-fail { color: #b91c1c !important; }

      .badge-pass {
        background: #dcfce7 !important;
        color: #166534 !important;
        border: 1px solid #86efac !important;
      }

      .badge-fail {
        background: #fee2e2 !important;
        color: #991b1b !important;
        border: 1px solid #fca5a5 !important;
      }

      .badge-skip {
        background: #f3f4f6 !important;
        color: #4b5563 !important;
        border: 1px solid #d1d5db !important;
      }

      pre.stack-trace {
        background: #f9fafb !important;
        color: #991b1b !important;
        border: 1px solid #e5e7eb !important;
      }

      .failure-item {
        border-left: 3px solid #ef4444 !important;
      }

      .header {
        border-bottom: 2px solid #111827 !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div>
        <h1 class="brand-title">
          ${escapeHtml(projectName)}
          <span class="brand-badge">Unit Test Report</span>
        </h1>
        <div class="meta-list">
          <span class="meta-item">Snapshot: <strong class="font-mono">${escapeHtml(snapshotId || "N/A")}</strong></span>
          <span class="meta-item">Framework: <strong>${escapeHtml(framework)}</strong></span>
          <span class="meta-item">Exported: <strong class="font-mono">${escapeHtml(exportedAt)}</strong></span>
          <span class="meta-item">Status: <strong class="${isSuccess ? "val-pass" : "val-fail"}">${escapeHtml(totals.status)}</strong></span>
        </div>
      </div>
      <div class="header-actions no-print">
        <button class="btn-print" onclick="window.print()">
          Print / Save as PDF
        </button>
      </div>
    </header>

    <!-- Executive Metrics Grid -->
    <section class="metrics-grid">
      <div class="card">
        <div class="card-title">Total Tests</div>
        <div class="card-value val-neutral font-mono">${totals.totalTests}</div>
        <div class="card-subtext font-mono">${totals.passedTests} passed · ${totals.failedTests} failed</div>
      </div>
      <div class="card">
        <div class="card-title">Pass Rate</div>
        <div class="card-value ${totals.passRate >= 90 ? "val-pass" : totals.passRate >= 75 ? "val-primary" : "val-fail"} font-mono">
          ${totals.passRate}%
        </div>
        <div class="card-subtext font-mono">${totals.skippedTests} skipped</div>
      </div>
      <div class="card">
        <div class="card-title">Execution Duration</div>
        <div class="card-value val-neutral font-mono">${formatDuration(totals.durationMs)}</div>
        <div class="card-subtext font-mono">${totals.durationMs} milliseconds</div>
      </div>
      <div class="card">
        <div class="card-title">Quality Gate</div>
        <div class="card-value ${isSuccess ? "val-pass" : "val-fail"} font-mono">${escapeHtml(totals.status)}</div>
        <div class="card-subtext">${failedScenarios.length === 0 ? "All assertions verified" : `${failedScenarios.length} failing assertion(s)`}</div>
      </div>
    </section>

    <!-- Code Coverage Summary (if available) -->
    ${hasCoverage ? `
    <section>
      <h2 class="section-title">Code Coverage Scorecard</h2>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th>Coverage %</th>
              <th>Status Assessment</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Line Coverage</strong></td>
              <td class="font-mono"><strong>${coverage.linesPct !== null ? `${coverage.linesPct}%` : "—"}</strong></td>
              <td>${(coverage.linesPct || 0) >= 80 ? '<span class="badge badge-pass">HEALTHY</span>' : '<span class="badge badge-fail">ACTION NEEDED</span>'}</td>
            </tr>
            <tr>
              <td><strong>Statement Coverage</strong></td>
              <td class="font-mono"><strong>${coverage.statementsPct !== null ? `${coverage.statementsPct}%` : "—"}</strong></td>
              <td>${(coverage.statementsPct || 0) >= 80 ? '<span class="badge badge-pass">HEALTHY</span>' : '<span class="badge badge-fail">ACTION NEEDED</span>'}</td>
            </tr>
            <tr>
              <td><strong>Function Coverage</strong></td>
              <td class="font-mono"><strong>${coverage.functionsPct !== null ? `${coverage.functionsPct}%` : "—"}</strong></td>
              <td>${(coverage.functionsPct || 0) >= 80 ? '<span class="badge badge-pass">HEALTHY</span>' : '<span class="badge badge-fail">ACTION NEEDED</span>'}</td>
            </tr>
            <tr>
              <td><strong>Branch Coverage</strong></td>
              <td class="font-mono"><strong>${coverage.branchesPct !== null ? `${coverage.branchesPct}%` : "—"}</strong></td>
              <td>${(coverage.branchesPct || 0) >= 75 ? '<span class="badge badge-pass">HEALTHY</span>' : '<span class="badge badge-fail">ACTION NEEDED</span>'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    ` : ""}

    <!-- Scenarios Table -->
    <section>
      <h2 class="section-title">Test Scenarios (${scenarios.length})</h2>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 45px;">#</th>
              <th>Suite / Context</th>
              <th>Scenario Name</th>
              <th>File</th>
              <th style="width: 90px;">Status</th>
              <th style="width: 90px;">Duration</th>
            </tr>
          </thead>
          <tbody>
            ${scenarios.length > 0 ? scenarios.map((sc, idx) => `
            <tr>
              <td class="font-mono" style="color: var(--color-text-muted);">${idx + 1}</td>
              <td class="font-mono">${escapeHtml(sc.suite)}</td>
              <td><strong>${escapeHtml(sc.name)}</strong></td>
              <td class="font-mono" style="color: var(--color-text-secondary);">${escapeHtml(sc.file)}</td>
              <td>
                <span class="badge ${sc.status === "passed" ? "badge-pass" : sc.status === "skipped" ? "badge-skip" : "badge-fail"}">
                  ${sc.status.toUpperCase()}
                </span>
              </td>
              <td class="font-mono">${formatDuration(sc.durationMs)}</td>
            </tr>
            `).join("") : `
            <tr>
              <td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 18px;">
                No test scenarios recorded.
              </td>
            </tr>
            `}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Diagnostics / Failure Stack Traces -->
    <section>
      <h2 class="section-title">Failure Diagnostics &amp; Stack Traces</h2>
      ${failedScenarios.length > 0 ? failedScenarios.map((sc, idx) => `
      <div class="failure-item">
        <div class="failure-header">
          <div class="failure-title">
            #${idx + 1} [${escapeHtml(sc.suite)}] ${escapeHtml(sc.name)}
          </div>
          <div class="failure-meta">
            ${escapeHtml(sc.file)} · ${formatDuration(sc.durationMs)}
          </div>
        </div>
        ${sc.error?.message ? `<div style="font-weight: 600; color: var(--color-danger); margin-bottom: 6px;">${escapeHtml(sc.error.message)}</div>` : ""}
        <pre class="stack-trace">${escapeHtml(sc.error?.stack || sc.error?.message || "Assertion failed (No stack trace available)")}</pre>
      </div>
      `).join("") : `
      <div class="card" style="border-left: 3px solid var(--color-success); color: var(--color-text-secondary);">
        ✅ All tests passed successfully. Zero errors or stack traces detected.
      </div>
      `}
    </section>

    <!-- Footer -->
    <footer class="footer">
      Generated automatically by CovAI Platform · Engineering Test Subsystem
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Triggers a browser download of the generated report string using native Blob and URL APIs.
 * Automatically cleans up the object URL after 20 seconds.
 */
export function downloadUnitTestReport(content, filename, mimeType = "text/plain") {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }, 20000);
    return true;
  } catch (err) {
    console.error("[downloadUnitTestReport] Download trigger error:", err);
    return false;
  }
}

/**
 * High-level helper to generate and trigger download of a Unit Test report in the desired format.
 * Supported formats: 'html' | 'markdown' | 'json'
 */
export function exportUnitTestReport(data, format = "html", customFilename = null) {
  const norm = normalizeUnitTestData(data);
  const snapshotSlug = (norm.snapshotId || "snapshot").slice(0, 8);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  let content = "";
  let defaultFilename = "";
  let mimeType = "text/plain";

  switch (format.toLowerCase()) {
    case "json":
      content = formatUnitTestJsonReport(norm);
      defaultFilename = `covai-unit-test-report-${snapshotSlug}-${timestamp}.json`;
      mimeType = "application/json";
      break;

    case "markdown":
    case "md":
      content = formatUnitTestMarkdownReport(norm);
      defaultFilename = `covai-unit-test-report-${snapshotSlug}-${timestamp}.md`;
      mimeType = "text/markdown";
      break;

    case "html":
    default:
      content = formatUnitTestHtmlReport(norm);
      defaultFilename = `covai-unit-test-report-${snapshotSlug}-${timestamp}.html`;
      mimeType = "text/html";
      break;
  }

  const finalFilename = customFilename || defaultFilename;
  const success = downloadUnitTestReport(content, finalFilename, mimeType);

  return {
    success,
    filename: finalFilename,
    content,
    mimeType,
  };
}

// Compatibility Aliases adhering to PROJECT.md § Test Report Export Contract
export const exportMarkdown = formatUnitTestMarkdownReport;
export const exportJson = formatUnitTestJsonReport;
export const exportHtml = formatUnitTestHtmlReport;
export const triggerBlobDownload = downloadUnitTestReport;

export default {
  formatUnitTestMarkdownReport,
  formatUnitTestJsonReport,
  formatUnitTestHtmlReport,
  downloadUnitTestReport,
  exportUnitTestReport,
  normalizeUnitTestData,
  exportMarkdown,
  exportJson,
  exportHtml,
  triggerBlobDownload,
};
