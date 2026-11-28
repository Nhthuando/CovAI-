import {
  computeHealth,
  computeQualityGate,
  computeExecutionTotals,
  computeCoverageIndex,
  computePyramid,
  buildActionItems,
  getPassRate,
} from "./unifiedDashboard.selectors.js";
import { CRITERION_LABELS } from "../../components/dashboard/trustworthiness/criterionLabels.js";

export function resolvePillarState(pillar) {
  if (!pillar) return "NOT_RUN";
  const passed = Number(pillar.passedTests ?? 0);
  const failed = Number(pillar.failedTests ?? 0);
  const total = Number(pillar.totalTests ?? (passed + failed));
  if (total === 0 || (passed === 0 && failed === 0)) {
    return "NOT_RUN";
  }
  if (failed === 0) {
    return "ALL_PASSING";
  }
  return "HAS_FAILURES";
}

function toFixedPct(val, fallback = 0) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Number(num.toFixed(1));
}

function toOptionalPct(val) {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  if (Number.isNaN(num)) return null;
  return Number(num.toFixed(1));
}

function mapCoverageFileEntry(f) {
  return {
    filePath: f.filePath,
    name: f.name || (f.filePath || "").split(/[/\\]/).pop(),
    branchesPct: toFixedPct(f.branchesPct),
    linesPct: toFixedPct(f.linesPct),
    functionsPct: toOptionalPct(f.functionsPct ?? f.funcsPct ?? f.functions),
    statementsPct: toOptionalPct(f.statementsPct ?? f.stmtsPct ?? f.statements),
    line: f.line || 1,
  };
}

const TOOLING_DOMAIN_STOP_WORDS = new Set([
  "vitest",
  "jest",
  "playwright",
  "cypress",
  "mocha",
  "chai",
  "supertest",
  "setup",
  "config",
  "workspace",
  "teardown",
  "mock",
  "mocks",
  "fixture",
  "fixtures",
  "index",
  "app",
  "main",
  "core",
  "service",
  "services",
  "controller",
  "controllers",
  "route",
  "routes",
  "util",
  "utils",
  "helper",
  "helpers",
]);

function isExcludedUnitFilePath(filePath, configExclusions = []) {
  if (!filePath || typeof filePath !== "string") return true;
  const cleanNorm = filePath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^\/+/, "");
  const lower = cleanNorm.toLowerCase();
  if (!lower) return true;
  if (
    /(^|\/)(node_modules|coverage|dist|build|\.next|\.nuxt|\.covai-temp)(\/|$)/i.test(lower) ||
    /\.d\.ts$/i.test(lower) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(lower) ||
    /(^|\/)(__tests__|__mocks__)(\/|$)/i.test(lower)
  ) {
    return true;
  }
  if (
    /(^|\/)(?:vitest|jest|playwright|cypress|babel|eslint|prettier|tailwind|postcss|vite|webpack|rollup|tsconfig)(?:\.[^/]+)*\.(?:c|m)?[jt]sx?$/i.test(lower) ||
    /(^|\/)(?:setup|global-?setup|setup-?tests?|teardown|test-?setup|vitest\.setup|vitest\.workspace|jest\.setup)(?:\.[^/]+)*\.[cm]?[jt]sx?$/i.test(lower) ||
    /\.config\.[cm]?[jt]sx?$/i.test(lower)
  ) {
    return true;
  }
  if (Array.isArray(configExclusions) || configExclusions instanceof Set) {
    for (const exc of configExclusions) {
      if (!exc) continue;
      const cleanExc = String(exc)
        .replace(/\\/g, "/")
        .toLowerCase()
        .replace(/^\.?\//, "")
        .replace(/\/+$/, "");
      if (!cleanExc) continue;
      if (cleanExc.includes("*")) {
        const regexPattern =
          "^" +
          cleanExc
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, ".*")
            .replace(/\*/g, "[^/]*") +
          "$";
        try {
          if (new RegExp(regexPattern, "i").test(lower)) return true;
        } catch (err) {
          console.warn(
            "[unifiedDashboard.adapter] Ignoring invalid glob exclusion pattern:",
            cleanExc,
            err?.message || err
          );
        }
      } else if (
        lower === cleanExc ||
        lower.startsWith(`${cleanExc}/`) ||
        lower.endsWith(`/${cleanExc}`) ||
        lower.includes(`/${cleanExc}/`)
      ) {
        return true;
      }
    }
  }
  return false;
}

function computeCompositeCoverageScore(cov) {
  if (!cov || typeof cov !== "object") return 0;
  return (
    Number(cov.lines || 0) * 0.4 +
    Number(cov.branches || 0) * 0.25 +
    Number(cov.functions || 0) * 0.2 +
    Number(cov.statements || 0) * 0.15
  );
}

/**
 * Adapt Raw Unit Test Data into PillarVM (100% Real Data)
 */
export function adaptUnit(raw, unifiedUnit = null) {
  if (unifiedUnit && typeof unifiedUnit === "object") {
    const passedTests = Number(unifiedUnit.passedTests ?? 0);
    const failedTests = Number(unifiedUnit.failedTests ?? 0);
    const skippedTests = Number(unifiedUnit.skippedTests ?? 0);
    const totalTests = Number(
      unifiedUnit.totalTests ?? passedTests + failedTests + skippedTests
    );
    const durationMs = Number(unifiedUnit.durationMs ?? 0);
    const passRate = getPassRate(passedTests, failedTests) ?? Number(unifiedUnit.passRate ?? 0);
    const avgDurationMs =
      Number(unifiedUnit.avgDurationMs) ||
      (totalTests > 0 ? Math.round(durationMs / totalTests) : 0);
    const avgTestDurationMs = Number(unifiedUnit.avgTestDurationMs ?? avgDurationMs);
    const pillarState =
      unifiedUnit.state || resolvePillarState({ passedTests, failedTests, totalTests });

    const cov = unifiedUnit.coverageMetrics || {};
    const rawLines = cov.lines;
    const hasRawLines =
      rawLines !== null &&
      rawLines !== undefined &&
      rawLines !== "" &&
      Number.isFinite(Number(rawLines));
    const coverageMeasured =
      typeof unifiedUnit.coverageMeasured === "boolean"
        ? unifiedUnit.coverageMeasured
        : totalTests > 0 && unifiedUnit.coverageSource !== "none" && hasRawLines;

    const coverageMetrics =
      totalTests > 0 && coverageMeasured
        ? {
            lines: toFixedPct(cov.lines),
            branches: toOptionalPct(cov.branches) ?? 0,
            functions: toOptionalPct(cov.functions) ?? 0,
            statements: toOptionalPct(cov.statements) ?? 0,
            linesCovered: cov.linesCovered ?? null,
            linesTotal: cov.linesTotal ?? null,
            branchesCovered: cov.branchesCovered ?? null,
            branchesTotal: cov.branchesTotal ?? null,
            functionsCovered: cov.functionsCovered ?? null,
            functionsTotal: cov.functionsTotal ?? null,
            statementsCovered: cov.statementsCovered ?? null,
            statementsTotal: cov.statementsTotal ?? null,
          }
        : {
            lines: totalTests > 0 ? null : 0,
            branches: totalTests > 0 ? toOptionalPct(cov.branches) : 0,
            functions: totalTests > 0 ? toOptionalPct(cov.functions) : 0,
            statements: totalTests > 0 ? toOptionalPct(cov.statements) : 0,
            linesCovered: null,
            linesTotal: null,
            branchesCovered: null,
            branchesTotal: null,
            functionsCovered: null,
            functionsTotal: null,
            statementsCovered: null,
            statementsTotal: null,
          };

    const lowCoverageItems = Array.isArray(unifiedUnit.lowCoverageItems)
      ? unifiedUnit.lowCoverageItems
          .filter((f) => f?.filePath && !isExcludedUnitFilePath(f.filePath))
          .slice(0, 4)
          .map(mapCoverageFileEntry)
      : [];

    const rawCoverageFiles = Array.isArray(unifiedUnit.coverageFiles)
      ? unifiedUnit.coverageFiles
      : Array.isArray(unifiedUnit.lowCoverageItems)
      ? unifiedUnit.lowCoverageItems
      : [];
    const coverageFiles = rawCoverageFiles
      .filter((f) => f?.filePath && !isExcludedUnitFilePath(f.filePath))
      .map(mapCoverageFileEntry);

    return {
      id: "unit",
      label: "Unit Test",
      framework: unifiedUnit.framework || "Jest",
      state: pillarState,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      flakyTests: Number(unifiedUnit.flakyTests ?? 0),
      passRate,
      durationMs,
      avgDurationMs,
      avgTestDurationMs,
      coverageSource: unifiedUnit.coverageSource || null,
      coverageMeasured: Boolean(coverageMeasured),
      coverageMetrics,
      lowCoverageItems,
      coverageFiles,
      failedScenarios: Array.isArray(unifiedUnit.failedScenarios) ? unifiedUnit.failedScenarios : [],
      failureDistribution: unifiedUnit.failureDistribution || {},
      errorMessage: unifiedUnit.errorMessage || null,
    };
  }

  if (!raw || (!raw.summary && (!raw.files || raw.files.length === 0) && !raw.executions)) {
    return {
      id: "unit",
      label: "Unit Test",
      framework: "Jest",
      state: "NOT_RUN",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      avgTestDurationMs: 0,
      coverageSource: "none",
      coverageMetrics: {
        lines: 0,
        branches: 0,
        functions: 0,
        statements: 0,
        linesCovered: null,
        linesTotal: null,
        branchesCovered: null,
        branchesTotal: null,
        functionsCovered: null,
        functionsTotal: null,
        statementsCovered: null,
        statementsTotal: null,
      },
      lowCoverageItems: [],
      coverageFiles: [],
      failedScenarios: [],
      failureDistribution: {},
      errorMessage: null,
    };
  }

  const { summary, files = [], executions = {}, frameworks = {} } = raw;

  // Detect Framework
  const fwName =
    frameworks?.supported?.unit?.[0] ||
    (executions?.vitest ? "Vitest" : executions?.jest ? "Jest" : "Jest");
  const framework = String(fwName).charAt(0).toUpperCase() + String(fwName).slice(1);

  // Test execution counts (merge executions.jest + executions.vitest if summary.testExecution is empty)
  const execList = [executions?.jest, executions?.vitest].filter(Boolean);
  const summaryRunInfo = summary?.testExecution || {};
  const hasSummaryCounts =
    Number(summaryRunInfo.numTotalTests ?? summaryRunInfo.totalTests ?? 0) > 0;
  const runInfo = hasSummaryCounts
    ? summaryRunInfo
    : execList.length > 0
    ? {
        passedTests: execList.reduce(
          (acc, ex) => acc + Number(ex.numPassedTests ?? ex.passedTests ?? 0),
          0
        ),
        failedTests: execList.reduce(
          (acc, ex) => acc + Number(ex.numFailedTests ?? ex.failedTests ?? 0),
          0
        ),
        skippedTests: execList.reduce(
          (acc, ex) => acc + Number(ex.numPendingTests ?? ex.skippedTests ?? 0),
          0
        ),
        totalTests: execList.reduce(
          (acc, ex) =>
            acc +
            Number(
              ex.numTotalTests ??
                ex.totalTests ??
                Number(ex.numPassedTests ?? ex.passedTests ?? 0) +
                  Number(ex.numFailedTests ?? ex.failedTests ?? 0) +
                  Number(ex.numPendingTests ?? ex.skippedTests ?? 0)
            ),
          0
        ),
        durationMs: execList.reduce(
          (acc, ex) => acc + Number(ex.durationMs ?? ex.duration ?? 0),
          0
        ),
      }
    : {};

  let passedTests = Number(runInfo.numPassedTests ?? runInfo.passedTests ?? 0);
  let failedTests = Number(runInfo.numFailedTests ?? runInfo.failedTests ?? 0);
  const skippedTests = Number(runInfo.numPendingTests ?? runInfo.skippedTests ?? 0);
  let totalTests = Number(
    runInfo.numTotalTests ?? runInfo.totalTests ?? passedTests + failedTests + skippedTests
  );
  const flakyTests = 0;
  let durationMs = Number(runInfo.durationMs ?? runInfo.duration ?? 0);
  if (durationMs === 0 && execList.length > 0) {
    durationMs = execList.reduce(
      (acc, ex) => acc + Number(ex.durationMs ?? ex.duration ?? 0),
      0
    );
  }

  // Coverage percentages (honor peakReport parity with UnitTestWorkspace.jsx)
  const liveCovCandidate =
    summary?.coverage ||
    (summaryRunInfo?.coverageLinesPct != null
      ? {
          lines: summaryRunInfo.coverageLinesPct,
          branches: summaryRunInfo.coverageBranchesPct,
          functions: summaryRunInfo.coverageFunctionsPct,
          statements: summaryRunInfo.coverageStatementsPct,
        }
      : null) ||
    summary?.previousCoverage ||
    null;

  const peakReport = summary?.peakReport || null;
  const peakCovCandidate =
    peakReport?.coverageSummary || peakReport?.peakMeta
      ? {
          lines: peakReport.coverageSummary?.lines ?? peakReport.peakMeta?.linesPct ?? 0,
          branches: peakReport.coverageSummary?.branches ?? peakReport.peakMeta?.branchesPct ?? 0,
          functions: peakReport.coverageSummary?.functions ?? peakReport.peakMeta?.funcsPct ?? 0,
          statements: peakReport.coverageSummary?.statements ?? peakReport.peakMeta?.stmtsPct ?? 0,
        }
      : null;

  const liveScore = computeCompositeCoverageScore(liveCovCandidate);
  const peakScore = computeCompositeCoverageScore(peakCovCandidate);
  const usePeak = Boolean(peakReport && peakScore > 0 && peakScore >= liveScore);

  if (usePeak && peakReport?.testStats && Number(peakReport.testStats.total || 0) > totalTests) {
    totalTests = Number(peakReport.testStats.total || 0);
    passedTests = Number(peakReport.testStats.passed || 0);
    failedTests = Number(peakReport.testStats.failed || 0);
    if (durationMs === 0 && Number(peakReport.testStats.durationMs || 0) > 0) {
      durationMs = Number(peakReport.testStats.durationMs);
    }
  }

  const passRate = getPassRate(passedTests, failedTests) ?? 0;
  const avgDurationMs = totalTests > 0 ? Math.round(durationMs / totalTests) : 0;

  const cov = usePeak ? peakCovCandidate || {} : liveCovCandidate || {};
  const rawTotals = usePeak ? peakReport?.rawTotals || summary?.rawTotals || null : summary?.rawTotals || null;
  const rawLiveLines = cov.lines ?? cov.line;
  const hasLiveLines =
    liveCovCandidate != null &&
    rawLiveLines !== null &&
    rawLiveLines !== undefined &&
    rawLiveLines !== "" &&
    Number.isFinite(Number(rawLiveLines));
  const coverageMeasured = totalTests > 0 && (usePeak || hasLiveLines);
  const coverageSource = usePeak
    ? "peak-report"
    : coverageMeasured || liveCovCandidate
    ? "filtered-summary"
    : "none";

  const coverageMetrics =
    totalTests > 0 && coverageMeasured
      ? {
          lines: toFixedPct(cov.lines ?? cov.line),
          branches: toFixedPct(cov.branches ?? cov.branch),
          functions: toFixedPct(cov.functions ?? cov.function),
          statements: toFixedPct(cov.statements ?? cov.statement),
          linesCovered: rawTotals?.lines?.covered ?? null,
          linesTotal: rawTotals?.lines?.total ?? null,
          branchesCovered: rawTotals?.branches?.covered ?? null,
          branchesTotal: rawTotals?.branches?.total ?? null,
          functionsCovered: rawTotals?.functions?.covered ?? null,
          functionsTotal: rawTotals?.functions?.total ?? null,
          statementsCovered: rawTotals?.statements?.covered ?? null,
          statementsTotal: rawTotals?.statements?.total ?? null,
        }
      : {
          lines: totalTests > 0 ? null : 0,
          branches: totalTests > 0 ? toOptionalPct(cov.branches ?? cov.branch) : 0,
          functions: totalTests > 0 ? toOptionalPct(cov.functions ?? cov.function) : 0,
          statements: totalTests > 0 ? toOptionalPct(cov.statements ?? cov.statement) : 0,
          linesCovered: null,
          linesTotal: null,
          branchesCovered: null,
          branchesTotal: null,
          functionsCovered: null,
          functionsTotal: null,
          statementsCovered: null,
          statementsTotal: null,
        };

  const configExclusions = raw?.configExclusions || summary?.configExclusions || [];
  const sourceFileList =
    usePeak && Array.isArray(peakReport?.fileCoverages) && peakReport.fileCoverages.length > 0 && (!Array.isArray(files) || files.length === 0)
      ? peakReport.fileCoverages
      : files;

  // Top 4 lowest branch coverage files
  const validFiles = Array.isArray(sourceFileList)
    ? sourceFileList.filter((f) => f?.filePath && !isExcludedUnitFilePath(f.filePath, configExclusions))
    : [];

  const sortedFiles = [...validFiles].sort(
    (a, b) =>
      (a.branchesPct ?? 0) - (b.branchesPct ?? 0) ||
      (a.linesPct ?? 0) - (b.linesPct ?? 0) ||
      (a.funcsPct ?? a.functionsPct ?? 0) - (b.funcsPct ?? b.functionsPct ?? 0)
  );
  const lowCoverageItems = sortedFiles.slice(0, 4).map(mapCoverageFileEntry);
  const coverageFiles = sortedFiles.map(mapCoverageFileEntry);

  const pillarState = resolvePillarState({ passedTests, failedTests, totalTests });
  return {
    id: "unit",
    label: "Unit Test",
    framework,
    state: pillarState,
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    avgTestDurationMs: avgDurationMs,
    coverageSource,
    coverageMeasured,
    coverageMetrics,
    lowCoverageItems,
    coverageFiles,
    failedScenarios: [],
    failureDistribution: {},
    failuresByCategory: [],
    errorMessage: null,
  };
}

/**
 * Adapt Raw Integration Test Data into PillarVM (100% Real Data)
 * Strictly separates executed tests from Uncovered APIs and never injects mock failures when failedTests === 0.
 */
export function adaptIntegration(workspaceData, coverageSummary = null, unifiedIntegration = null) {
  if (unifiedIntegration && typeof unifiedIntegration === "object") {
    const passedTests = Number(unifiedIntegration.passedTests ?? 0);
    const failedTests = Number(unifiedIntegration.failedTests ?? 0);
    const skippedTests = Number(unifiedIntegration.skippedTests ?? 0);
    const totalTests = Number(
      unifiedIntegration.totalTests ?? passedTests + failedTests + skippedTests
    );
    const durationMs = Number(unifiedIntegration.durationMs ?? 0);
    const avgEndpointLatencyMs = Number(
      unifiedIntegration.avgEndpointLatencyMs ?? unifiedIntegration.avgDurationMs ?? 0
    );
    const avgDurationMs = Number(unifiedIntegration.avgDurationMs ?? avgEndpointLatencyMs);
    const passRate = getPassRate(passedTests, failedTests) ?? Number(unifiedIntegration.passRate ?? 0);
    const pillarState =
      unifiedIntegration.state || resolvePillarState({ passedTests, failedTests, totalTests });

    const cov = unifiedIntegration.coverageMetrics || {};
    const totalApis = Number(cov.totalApis ?? 0);
    const uncoveredApis = Number(cov.uncoveredApis ?? 0);
    const failedApis = Number(cov.failedApis ?? 0);
    const partialApis = Number(cov.partialApis ?? 0);
    const hasIntExecuted = totalTests > 0;
    const coveredApis =
      hasIntExecuted && totalApis > 0
        ? Math.min(
            totalApis,
            Number(
              cov.coveredApis ??
                Math.max(0, totalApis - uncoveredApis - failedApis - partialApis)
            )
          )
        : 0;
    const hasApiCovMetric =
      hasIntExecuted &&
      totalApis > 0 &&
      cov.apiEndpoint !== null &&
      cov.apiEndpoint !== undefined &&
      cov.apiEndpoint !== "" &&
      Number.isFinite(Number(cov.apiEndpoint));
    const apiEndpointPct = hasApiCovMetric
      ? toFixedPct(cov.apiEndpoint)
      : hasIntExecuted && totalApis > 0 && cov.coveredApis !== undefined
      ? toFixedPct((coveredApis / totalApis) * 100)
      : null;
    const codeCoverageMeasured =
      typeof unifiedIntegration.codeCoverageMeasured === "boolean"
        ? unifiedIntegration.codeCoverageMeasured
        : hasIntExecuted &&
          cov.lines !== null &&
          cov.lines !== undefined &&
          cov.lines !== "" &&
          Number(cov.lines) > 0;
    const coverageMetrics = {
      lines: hasIntExecuted ? toFixedPct(cov.lines) : 0,
      branches: hasIntExecuted ? toFixedPct(cov.branches) : 0,
      functions: hasIntExecuted ? toFixedPct(cov.functions) : 0,
      statements: hasIntExecuted ? toFixedPct(cov.statements) : 0,
      apiEndpoint: apiEndpointPct,
      coveredApis,
      partialApis,
      failedApis,
      uncoveredApis,
      totalApis,
    };

    const fd = unifiedIntegration.failureDistribution || {};
    const failureDistribution =
      failedTests <= 0
        ? { route: 0, middlewareAuth: 0, controller: 0, database: 0 }
        : {
            route: Number(fd.route ?? 0),
            middlewareAuth: Number(fd.middlewareAuth ?? 0),
            controller: Number(fd.controller ?? 0),
            database: Number(fd.database ?? 0),
          };

    return {
      id: "integration",
      label: "Integration Test",
      framework: unifiedIntegration.framework || "Supertest",
      state: pillarState,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      flakyTests: Number(unifiedIntegration.flakyTests ?? 0),
      passRate,
      durationMs,
      avgDurationMs,
      avgEndpointLatencyMs,
      codeCoverageMeasured,
      coverageMetrics,
      lowCoverageItems: Array.isArray(unifiedIntegration.lowCoverageItems)
        ? unifiedIntegration.lowCoverageItems
        : [],
      failedScenarios: Array.isArray(unifiedIntegration.failedScenarios)
        ? unifiedIntegration.failedScenarios
        : [],
      failureDistribution,
      errorMessage: unifiedIntegration.errorMessage || null,
    };
  }

  if (!workspaceData?.summary && !Array.isArray(workspaceData?.endpoints) && !coverageSummary?.coverage) {
    return {
      id: "integration",
      label: "Integration Test",
      framework: "Supertest",
      state: "NOT_RUN",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      avgEndpointLatencyMs: 0,
      coverageMetrics: {
        lines: 0,
        branches: 0,
        functions: 0,
        statements: 0,
        apiEndpoint: 0,
        coveredApis: 0,
        partialApis: 0,
        failedApis: 0,
        uncoveredApis: 0,
        totalApis: 0,
      },
      lowCoverageItems: [],
      failedScenarios: [],
      failureDistribution: {
        route: 0,
        middlewareAuth: 0,
        controller: 0,
        database: 0,
      },
      errorMessage: null,
    };
  }

  const wsSummary = workspaceData?.summary || {};
  const endpoints = Array.isArray(workspaceData?.endpoints) ? workspaceData.endpoints : [];

  const coveredCountFromEndpoints = endpoints.filter((e) => e.status === "Covered").length;
  const partialCountFromEndpoints = endpoints.filter((e) => e.status === "Partial").length;
  const errorCountFromEndpoints = endpoints.filter(
    (e) => e.status === "Failed" || e.status === "Script Error"
  ).length;

  const passedTests = Number(wsSummary.passedTests ?? wsSummary.testedApis ?? coveredCountFromEndpoints ?? 0);
  const failedTests = Number(wsSummary.failedTests ?? errorCountFromEndpoints ?? 0);
  const skippedTests = Number(wsSummary.skippedTests ?? 0);

  // Executed test count: only actual executed tests (never counting Uncovered APIs as executed or failed)
  const executedTests = Number(
    wsSummary.totalTests ?? wsSummary.executedApis ?? passedTests + failedTests + skippedTests
  );
  const totalApis = Number(wsSummary.totalApis ?? wsSummary.discoveredApis ?? wsSummary.totalEndpoints ?? (endpoints.length || executedTests));
  const coveredApis =
    executedTests > 0 && totalApis > 0
      ? Math.min(
          totalApis,
          Number(
            wsSummary.endpointCoverageMetrics?.coveredEndpoints ??
              (endpoints.length > 0 ? coveredCountFromEndpoints : 0)
          )
        )
      : 0;
  const partialApis = Math.min(
    Math.max(0, totalApis - coveredApis),
    Number(wsSummary.endpointCoverageMetrics?.partialEndpoints ?? partialCountFromEndpoints)
  );
  const failedApis = Math.min(
    Math.max(0, totalApis - coveredApis),
    errorCountFromEndpoints + partialCountFromEndpoints
  );
  const uncoveredApis = Math.max(0, totalApis - coveredApis);

  const flakyTests = 0;
  const durationMs = Number(wsSummary.durationMs ?? 0);
  const avgDurationMs = Number(wsSummary.avgEndpointLatencyMs ?? wsSummary.avgRequestLatencyMs ?? 0);
  const passRate = getPassRate(passedTests, failedTests) ?? 0;

  // API Coverage metrics
  const epMetrics = wsSummary.endpointCoverageMetrics || {};
  const apiEndpointPct =
    executedTests <= 0 || totalApis <= 0
      ? null
      : epMetrics.endpointCoveragePct !== undefined && epMetrics.endpointCoveragePct !== null
      ? toFixedPct(epMetrics.endpointCoveragePct)
      : toFixedPct((coveredApis / totalApis) * 100);

  const ownCodeCov = wsSummary.codeCoverage || {};
  const rawOwnCodeLines = ownCodeCov.line?.pct ?? ownCodeCov.line ?? ownCodeCov.lines;
  const codeCoverageMeasured =
    executedTests > 0 &&
    rawOwnCodeLines !== null &&
    rawOwnCodeLines !== undefined &&
    rawOwnCodeLines !== "" &&
    Number.isFinite(Number(rawOwnCodeLines));

  const codeCov = wsSummary.codeCoverage || coverageSummary?.coverage || {};
  const coverageMetrics = {
    lines: executedTests > 0 ? toFixedPct(codeCov.line?.pct ?? codeCov.line ?? codeCov.lines) : 0,
    branches: executedTests > 0 ? toFixedPct(codeCov.branch?.pct ?? codeCov.branch ?? codeCov.branches) : 0,
    functions: executedTests > 0 ? toFixedPct(codeCov.function?.pct ?? codeCov.function ?? codeCov.functions) : 0,
    statements: executedTests > 0 ? toFixedPct(codeCov.statement?.pct ?? codeCov.statement ?? codeCov.statements) : 0,
    apiEndpoint: apiEndpointPct,
    coveredApis,
    partialApis,
    failedApis,
    uncoveredApis,
    totalApis,
  };

  // Real failure layer breakdown from endpoints.scenarios or qualityClassification
  let routeCount = 0;
  let middlewareCount = 0;
  let controllerCount = 0;
  let databaseCount = 0;

  if (failedTests > 0) {
    for (const ep of endpoints) {
      if (Array.isArray(ep.scenarios)) {
        for (const sc of ep.scenarios) {
          if (sc.status && sc.status.toLowerCase() !== "passed" && sc.status.toLowerCase() !== "skipped") {
            const fl = String(sc.failureLayer || "").toUpperCase();
            if (fl === "ROUTER_NOT_FOUND") routeCount++;
            else if (fl === "MIDDLEWARE_REJECTED") middlewareCount++;
            else if (fl === "DATABASE_FAILURE") databaseCount++;
            else controllerCount++;
          }
        }
      }
    }
    const qc = wsSummary.qualityClassification || {};
    if (routeCount + middlewareCount + controllerCount + databaseCount === 0) {
      routeCount = Number(qc.invalidTests ?? 0);
      middlewareCount = Number(qc.testScriptErrors ?? 0);
      databaseCount = Number(qc.infrastructureFailures ?? 0);
      controllerCount = Number(qc.assertionFailures ?? Math.max(0, failedTests - routeCount - middlewareCount - databaseCount));
    }
  }

  const failureDistribution = {
    route: routeCount,
    middlewareAuth: middlewareCount,
    controller: controllerCount,
    database: databaseCount,
  };

  const lowCoverageItems = endpoints
    .filter((e) => e.status !== "Covered" || (e.mappedCodeCoverage?.line ?? 100) < 60)
    .slice(0, 5)
    .map((e) => ({
      filePath: e.path,
      name: `${e.method || "GET"} ${e.path}`,
      branchesPct: toFixedPct(e.mappedCodeCoverage?.branch),
      linesPct: toFixedPct(e.mappedCodeCoverage?.line),
      line: 1,
    }));

  return {
    id: "integration",
    label: "Integration Test",
    framework: workspaceData?.snapshot?.framework || "Supertest",
    state: resolvePillarState({ passedTests, failedTests, totalTests: executedTests }),
    totalTests: executedTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    avgEndpointLatencyMs: avgDurationMs,
    codeCoverageMeasured,
    coverageMetrics,
    lowCoverageItems,
    failedScenarios: [],
    failureDistribution,
    errorMessage: null,
  };
}

/**
 * Adapt Raw System Test (E2E) Data into PillarVM (100% Real Data)
 */
export function adaptSystem(systemSummary, scenariosList = [], unifiedSystem = null) {
  if (unifiedSystem && typeof unifiedSystem === "object") {
    const passedTests = Number(unifiedSystem.passedTests ?? 0);
    const failedTests = Number(unifiedSystem.failedTests ?? 0);
    const flakyTests = Number(unifiedSystem.flakyTests ?? 0);
    const skippedTests = Number(unifiedSystem.skippedTests ?? 0);
    const totalTests = Number(
      unifiedSystem.totalTests ?? passedTests + failedTests + skippedTests
    );
    const durationMs = Number(unifiedSystem.durationMs ?? 0);
    const passRate = getPassRate(passedTests, failedTests) ?? Number(unifiedSystem.passRate ?? 0);
    const avgDurationMs =
      Number(unifiedSystem.avgDurationMs) ||
      (totalTests > 0 ? Math.round(durationMs / totalTests) : 0);
    const avgTestDurationMs = Number(unifiedSystem.avgTestDurationMs ?? avgDurationMs);
    const pillarState =
      unifiedSystem.state || resolvePillarState({ passedTests, failedTests, totalTests });

    const cov = unifiedSystem.coverageMetrics || {};
    const rawFlow = cov.flow ?? cov.lines ?? unifiedSystem.flowCoveragePct ?? null;
    const explicitAvail = unifiedSystem.coverageAvailable ?? cov.coverageAvailable;
    const coverageAvailable =
      typeof explicitAvail === "boolean"
        ? explicitAvail && totalTests > 0 && rawFlow !== null && rawFlow !== undefined
        : totalTests > 0 &&
          rawFlow !== null &&
          rawFlow !== undefined &&
          Number.isFinite(Number(rawFlow));
    const flowPct = totalTests > 0 && coverageAvailable ? toOptionalPct(rawFlow) : null;
    const linesPct = totalTests > 0 && coverageAvailable ? toOptionalPct(cov.lines ?? flowPct) : null;

    const fd = unifiedSystem.failureDistribution || {};
    const failureDistribution = {
      selectorNotFound: failedTests > 0 ? Number(fd.selectorNotFound ?? 0) : 0,
      networkTimeout: failedTests > 0 ? Number(fd.networkTimeout ?? 0) : 0,
      assertion: failedTests > 0 ? Number(fd.assertion ?? 0) : 0,
      flaky: Number(fd.flaky ?? flakyTests),
    };

    return {
      id: "system",
      label: "System Test (E2E)",
      framework: unifiedSystem.framework || "Playwright",
      state: pillarState,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      flakyTests,
      passRate,
      durationMs,
      avgDurationMs,
      avgTestDurationMs,
      coverageAvailable,
      coverageMetrics: {
        lines: linesPct,
        flow: flowPct,
      },
      lowCoverageItems: [],
      failedScenarios: Array.isArray(unifiedSystem.failedScenarios)
        ? unifiedSystem.failedScenarios
        : [],
      failureDistribution,
      errorMessage: unifiedSystem.errorMessage || null,
    };
  }

  if (!systemSummary && (!scenariosList || scenariosList.length === 0)) {
    return {
      id: "system",
      label: "System Test (E2E)",
      framework: "Playwright",
      state: "NOT_RUN",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      avgTestDurationMs: 0,
      coverageAvailable: false,
      coverageMetrics: { lines: null, flow: null },
      lowCoverageItems: [],
      failedScenarios: [],
      failureDistribution: {
        selectorNotFound: 0,
        networkTimeout: 0,
        assertion: 0,
        flaky: 0,
      },
      errorMessage: null,
    };
  }

  const s = systemSummary || {};
  const passedTests = Number(s.passedTests ?? s.passed ?? 0);
  const failedTests = Number(s.failedTests ?? s.failed ?? 0);
  const flakyTests = Number(s.flakyTests ?? s.flaky ?? 0);
  const skippedTests = Number(s.skippedTests ?? 0);
  const totalTests = Number(
    s.totalTests ?? s.e2eTests ?? (passedTests + failedTests + skippedTests || scenariosList.length || 0)
  );
  const durationMs = Number(s.durationMs ?? 0);
  const passRate = getPassRate(passedTests, failedTests) ?? Number(s.passRatePct ?? 0);
  const avgDurationMs = totalTests > 0 ? Math.round(durationMs / totalTests) : 0;

  // Flow coverage (do NOT fabricate from passRate when unmeasured)
  const frontendCounters =
    s.coverageSummary?.frontend?.counters ||
    s.coverageSummary?.tiers?.frontend?.counters ||
    {};
  const rawFeLinesPct = frontendCounters.lines?.pct;
  const coverageAvailable =
    typeof s.coverageAvailable === "boolean"
      ? s.coverageAvailable &&
        totalTests > 0 &&
        rawFeLinesPct !== undefined &&
        rawFeLinesPct !== null
      : totalTests > 0 &&
        rawFeLinesPct !== undefined &&
        rawFeLinesPct !== null &&
        Number.isFinite(Number(rawFeLinesPct));
  const flowCoveragePct =
    totalTests > 0 && coverageAvailable ? toOptionalPct(rawFeLinesPct) : null;

  // Failure categories: strictly 0 when failedTests === 0
  const failureDistribution = {
    selectorNotFound: 0,
    networkTimeout: 0,
    assertion: 0,
    flaky: flakyTests,
  };

  if (failedTests > 0 && Array.isArray(s.scenarios) && s.scenarios.length > 0) {
    let selector = 0,
      timeout = 0,
      assertion = 0;
    for (const sc of s.scenarios) {
      if (sc.status === "failed") {
        const cat = String(sc.failureCategory || "").toUpperCase();
        const msg = (sc.failureMessages || []).join(" ").toLowerCase();
        if (cat === "ELEMENT_NOT_FOUND" || msg.includes("selector") || msg.includes("locator") || msg.includes("waiting for element")) {
          selector++;
        } else if (
          ["TIMEOUT", "SERVER_ERROR", "NAVIGATION_ERROR"].includes(cat) ||
          msg.includes("timeout") ||
          msg.includes("timed out")
        ) {
          timeout++;
        } else {
          assertion++;
        }
      }
    }
    failureDistribution.selectorNotFound = selector;
    failureDistribution.networkTimeout = timeout;
    failureDistribution.assertion =
      selector + timeout + assertion > 0 ? assertion : failedTests;
  } else if (failedTests > 0) {
    failureDistribution.assertion = failedTests;
  }

  const runnerRaw = s.runner || "playwright";
  const framework = String(runnerRaw).charAt(0).toUpperCase() + String(runnerRaw).slice(1);

  return {
    id: "system",
    label: "System Test (E2E)",
    framework,
    state: resolvePillarState({ passedTests, failedTests, totalTests }),
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    avgTestDurationMs: avgDurationMs,
    coverageAvailable,
    coverageMetrics: {
      lines: flowCoveragePct,
      flow: flowCoveragePct,
    },
    lowCoverageItems: [],
    failedScenarios: [],
    failureDistribution,
    errorMessage: null,
  };
}

/**
 * Derive Live Traceability Matrix rows from actual live endpoints & unit files
 * when backend matrix.rows is not yet provided.
 */
function buildLiveTraceMatrixRows(unitRaw, integrationRaw, pillars) {
  const endpoints = Array.isArray(integrationRaw?.endpoints) ? integrationRaw.endpoints : [];
  const files = Array.isArray(unitRaw?.files) ? unitRaw.files : [];

  if (endpoints.length === 0 && files.length === 0 && pillars.unit.totalTests === 0) {
    return [];
  }

  // Group endpoints by resource prefix (e.g. /api/auth/login -> Auth)
  const groups = new Map();

  for (const ep of endpoints) {
    const cleanPath = String(ep.path || "/api/resource").replace(/^\/+/, "");
    const parts = cleanPath.split("/");
    const resourceKey = parts[0] === "api" && parts[1] ? parts[1] : parts[0] || "general";
    const groupId = `live-mod-${resourceKey.toLowerCase()}`;

    if (!groups.has(groupId)) {
      const title =
        resourceKey.charAt(0).toUpperCase() +
        resourceKey.slice(1).replace(/[-_]/g, " ") +
        " API Module";
      groups.set(groupId, {
        id: groupId,
        resourceKey: resourceKey.toLowerCase(),
        moduleName: title,
        endpoints: [],
        unitFiles: [],
      });
    }
    groups.get(groupId).endpoints.push(ep);
  }

  const unitConfigExclusions =
    unitRaw?.configExclusions || unitRaw?.summary?.configExclusions || [];

  // Match unit files to groups or create a domain/core module group
  for (const f of files) {
    if (!f?.filePath || isExcludedUnitFilePath(f.filePath, unitConfigExclusions)) continue;
    const base = f.filePath.split(/[/\\]/).pop().toLowerCase();
    let matched = false;
    for (const grp of groups.values()) {
      if (base.includes(grp.resourceKey)) {
        grp.unitFiles.push(f);
        matched = true;
        break;
      }
    }
    if (!matched && groups.size < 12) {
      const stem = base
        .replace(/\.(js|jsx|ts|tsx|mjs|cjs|json)$/i, "")
        .replace(/[._-](test|spec|e2e|cy)\b/gi, "");
      const tokens = stem
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[^a-zA-Z0-9]+/)
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t && !TOOLING_DOMAIN_STOP_WORDS.has(t));
      const key = tokens[0] || "core";
      const groupId = `live-mod-${key}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          resourceKey: key,
          moduleName: `${key.charAt(0).toUpperCase() + key.slice(1)} Module`,
          endpoints: [],
          unitFiles: [],
        });
      }
      groups.get(groupId).unitFiles.push(f);
    }
  }

  const rows = [];
  for (const grp of groups.values()) {
    const totalEp = grp.endpoints.length;
    const coveredEp = grp.endpoints.filter((e) => e.status === "Covered").length;
    const partialEp = grp.endpoints.filter((e) => e.status === "Partial").length;
    const failedEp = grp.endpoints.filter((e) => e.status === "Failed" || e.status === "Script Error").length;
    const issueEp = failedEp + partialEp;
    const firstEp = grp.endpoints[0];
    const firstFile = grp.unitFiles[0];

    const unitHasTests = pillars.unit.totalTests > 0 && grp.unitFiles.length > 0;
    const avgLines =
      grp.unitFiles.length > 0
        ? toFixedPct(
            grp.unitFiles.reduce((acc, f) => acc + Number(f.linesPct ?? 0), 0) / grp.unitFiles.length
          )
        : null;
    const avgBranches =
      grp.unitFiles.length > 0
        ? toFixedPct(
            grp.unitFiles.reduce((acc, f) => acc + Number(f.branchesPct ?? 0), 0) / grp.unitFiles.length
          )
        : null;
    const unitStatus = !unitHasTests
      ? "untested"
      : avgLines === 0 && (avgBranches ?? 0) === 0
      ? "untested"
      : (avgBranches ?? 100) < 50
      ? "warn"
      : "pass";
    const unitLabel = unitHasTests
      ? `${avgLines ?? pillars.unit.coverageMetrics.lines}% lines · ${avgBranches ?? pillars.unit.coverageMetrics.branches}% branch`
      : "0/0 (Not run)";

    const intStatus =
      totalEp === 0
        ? "none"
        : failedEp > 0
        ? "fail"
        : coveredEp === totalEp
        ? "pass"
        : coveredEp > 0 || partialEp > 0
        ? "warn"
        : "untested";
    const intLabel = totalEp > 0 ? `${coveredEp}/${totalEp} covered` : "0/0 APIs";

    const sysStatus =
      pillars.system.failedTests > 0 ? "fail" : pillars.system.totalTests > 0 ? "pass" : "untested";
    const sysLabel =
      pillars.system.totalTests > 0
        ? `${pillars.system.passedTests}/${pillars.system.totalTests} journeys`
        : "0/0 Journeys";

    rows.push({
      id: grp.id,
      moduleName: grp.moduleName,
      description:
        totalEp > 0
          ? `${totalEp} discovered endpoint(s): ${grp.endpoints.map((e) => `${e.method || "GET"} ${e.path}`).slice(0, 2).join(", ")}`
          : `Source file: ${firstFile?.filePath || "N/A"}`,
      unit: {
        status: unitStatus,
        label: unitLabel,
        passed: 0,
        failed: 0,
        total: 0,
        coverageOnly: unitHasTests,
        fileCount: grp.unitFiles.length,
        avgLinesPct: avgLines,
        avgBranchesPct: avgBranches,
        path: firstFile?.filePath || null,
      },
      integration: {
        status: intStatus,
        label: intLabel,
        passed: coveredEp,
        failed: failedEp,
        partial: partialEp,
        total: totalEp,
        uncovered: Math.max(0, totalEp - coveredEp - issueEp),
        endpoint: firstEp ? `${firstEp.method || "GET"} ${firstEp.path}` : null,
      },
      system: {
        status: sysStatus,
        label: sysLabel,
        passed: pillars.system.passedTests || 0,
        failed: pillars.system.failedTests || 0,
        total: pillars.system.totalTests || 0,
        scenarioId: null,
      },
      rootCause: {
        diagnosis:
          coveredEp === 0 && totalEp > 0
            ? `${totalEp} API endpoint(s) discovered without automated integration coverage yet.`
            : "Real workspace module status.",
        suspectLayer: !unitHasTests ? "unit" : coveredEp < totalEp ? "integration" : "none",
        summary: coveredEp === 0 && totalEp > 0 ? "Uncovered API endpoints" : "Verified state",
      },
      layerDetails: {
        unit: {
          file: firstFile?.filePath || "N/A",
          branchCoveragePct: firstFile?.branchesPct ?? pillars.unit.coverageMetrics?.branches ?? 0,
          failingFunctions: [],
          summaryText: unitHasTests
            ? `Branch coverage: ${firstFile?.branchesPct ?? 0}%`
            : "No unit tests executed for this module yet",
        },
        integration: {
          method: firstEp?.method || "GET",
          endpoint: firstEp?.path || `/api/${grp.resourceKey}`,
          httpStatus: coveredEp > 0 ? 200 : null,
          failureLayer: failedEp > 0 ? "controller" : coveredEp < totalEp ? "uncovered" : "none",
          summaryText: `${coveredEp} of ${totalEp} endpoint(s) covered`,
        },
        system: {
          flowName: `${grp.moduleName} E2E Flow`,
          failedStep: pillars.system.totalTests > 0 ? "Executed" : "No E2E journey executed yet",
          failureKind: pillars.system.totalTests > 0 ? "none" : "untested",
          scenarioId: null,
        },
      },
      items: [
        ...(firstFile
          ? [{ type: "unit", name: firstFile.filePath.split(/[/\\]/).pop(), path: firstFile.filePath, status: unitStatus }]
          : []),
        ...grp.endpoints.slice(0, 4).map((e) => ({
          type: "integration",
          name: `${e.method || "GET"} ${e.path} (${e.status || "Uncovered"})`,
          endpoint: `${e.method || "GET"} ${e.path}`,
          status:
            e.status === "Covered"
              ? "pass"
              : e.status === "Failed" || e.status === "Script Error"
              ? "fail"
              : e.status === "Partial"
              ? "warn"
              : "untested",
        })),
      ],
    });
  }

  return rows;
}

function normalizeMatrixRow(row) {
  if (!row || typeof row !== "object") return row;
  const rawUnit = row.unit || {};
  const rawInt = row.integration || {};
  let unitLabel = String(rawUnit.label || "").trim();
  let unitPassRate = rawUnit.passRate ?? null;
  let avgLinesPct = rawUnit.avgLinesPct ?? null;
  let avgBranchesPct = rawUnit.avgBranchesPct ?? null;

  const legacyPassedMatch = unitLabel.match(/^(\d+)\s*\/\s*(\d+)\s+passed\s*\(([0-9.]+)%\)$/i);
  if (legacyPassedMatch) {
    const p = Number(legacyPassedMatch[1]);
    const t = Number(legacyPassedMatch[2]);
    const cov = legacyPassedMatch[3];
    const rate = t > 0 ? Number(((p / t) * 100).toFixed(1)) : 0;
    unitPassRate = unitPassRate ?? rate;
    avgLinesPct = avgLinesPct ?? Number(cov);
    unitLabel = `${p}/${t} passed (${rate}%) · ${cov}% lines`;
  }

  const isCoverageOnly =
    Boolean(rawUnit.coverageOnly) ||
    (Number(rawUnit.passed ?? 0) === 0 &&
      Number(rawUnit.failed ?? 0) === 0 &&
      !/^\s*\d+\s*\/\s*\d+/.test(unitLabel) &&
      /%\s*(?:lines|branch|cov)/i.test(unitLabel));

  if (isCoverageOnly) {
    if (avgLinesPct == null) {
      const mLines = unitLabel.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:lines|cov)/i);
      if (mLines) avgLinesPct = Number(mLines[1]);
    }
    if (avgBranchesPct == null) {
      const mBranch = unitLabel.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*branch/i);
      if (mBranch) avgBranchesPct = Number(mBranch[1]);
    }
  }

  const normalizedUnit = {
    ...rawUnit,
    label: unitLabel || rawUnit.label,
    total: isCoverageOnly ? 0 : Number(rawUnit.total ?? 0),
    coverageOnly: isCoverageOnly,
    fileCount: rawUnit.fileCount ?? (isCoverageOnly && Number(rawUnit.total) > 0 ? Number(rawUnit.total) : undefined),
    avgLinesPct,
    avgBranchesPct,
    passRate: unitPassRate,
  };

  const intTotal = Number(rawInt.total ?? 0);
  const intLabelStr = String(rawInt.label || "");
  const isZeroApi =
    intTotal === 0 &&
    (!intLabelStr || /^0\s*\/\s*0\b/i.test(intLabelStr));
  const normalizedInt = isZeroApi
    ? {
        ...rawInt,
        total: 0,
        status:
          !rawInt.status || String(rawInt.status).toLowerCase() === "untested"
            ? "none"
            : rawInt.status,
      }
    : rawInt;

  let rootCause = row.rootCause;
  if (
    isZeroApi &&
    String(rootCause?.summary || "").toLowerCase().includes("api coverage gap")
  ) {
    rootCause = {
      suspectLayer: "none",
      summary:
        normalizedUnit.status === "pass"
          ? "Unit verified (no APIs)"
          : "Partial verification",
      diagnosis: "Unit suite verified; no API endpoints mapped to this module.",
    };
  }

  return {
    ...row,
    unit: normalizedUnit,
    integration: normalizedInt,
    rootCause,
  };
}

/**
 * Adapt All Layers into UnifiedDashboardVM (100% Real Data — Zero Mock Presets).
 */
export function adaptUnifiedDashboard({
  unifiedBackendRaw = null,
  unitRaw = null,
  integrationRaw = null,
  systemRaw = null,
  comparisonRaw = null,
  context = {},
}) {
  const effectiveSnapshots = Array.isArray(unifiedBackendRaw?.context?.snapshots) &&
    unifiedBackendRaw.context.snapshots.length > 0
    ? unifiedBackendRaw.context.snapshots
    : Array.isArray(context.snapshots)
    ? context.snapshots
    : [];

  const activeSnapshotId =
    context.snapshotId ||
    unifiedBackendRaw?.context?.snapshotId ||
    effectiveSnapshots[0]?.id ||
    "";

  const unitPillar = adaptUnit(unitRaw, unifiedBackendRaw?.pillars?.unit);
  const integrationPillar = adaptIntegration(
    integrationRaw,
    unitRaw?.summary,
    unifiedBackendRaw?.pillars?.integration
  );
  const systemPillar = adaptSystem(
    systemRaw,
    [],
    unifiedBackendRaw?.pillars?.system
  );

  const pillars = {
    unit: unitPillar,
    integration: integrationPillar,
    system: systemPillar,
  };

  const liveMatrixRows =
    Array.isArray(unifiedBackendRaw?.matrix?.rows) && unifiedBackendRaw.matrix.rows.length > 0
      ? unifiedBackendRaw.matrix.rows.map(normalizeMatrixRow)
      : buildLiveTraceMatrixRows(unitRaw, integrationRaw, pillars);

  const qualityGate = unifiedBackendRaw?.qualityGate || computeQualityGate(pillars, liveMatrixRows);
  const health =
    unifiedBackendRaw?.health?.score !== undefined && unifiedBackendRaw?.health?.score !== null
      ? {
          score: unifiedBackendRaw.health.score,
          grade: unifiedBackendRaw.health.grade,
          delta: unifiedBackendRaw.health.delta,
        }
      : computeHealth(pillars, null, qualityGate);
  const execution = computeExecutionTotals(pillars);
  const coverage = computeCoverageIndex(pillars);
  const pyramid = computePyramid(pillars);

  // Baseline Delta from unifiedBackendRaw or comparisonRaw if available
  let healthDelta = null;
  if (unifiedBackendRaw?.health?.delta != null) {
    healthDelta = Number(unifiedBackendRaw.health.delta);
  } else if (comparisonRaw?.testRunComparison?.coverageArtifactDiff?.deltaLinesPct != null) {
    healthDelta = Number(comparisonRaw.testRunComparison.coverageArtifactDiff.deltaLinesPct);
  } else if (comparisonRaw?.runtimeDiff?.summary?.fixesCount > 0) {
    healthDelta = comparisonRaw.runtimeDiff.summary.fixesCount * 2.5;
  }
  health.delta = healthDelta;

  const actionsItems =
    Array.isArray(unifiedBackendRaw?.actions?.items) && unifiedBackendRaw.actions.items.length > 0
      ? unifiedBackendRaw.actions.items
      : buildActionItems(pillars, liveMatrixRows);

  // Real Execution History from backend or derived from current run state
  const rawRuns = Array.isArray(unifiedBackendRaw?.history?.runs)
    ? unifiedBackendRaw.history.runs
    : [];
  const liveRuns = rawRuns.map((r) => ({
    ...r,
    shortId: r.shortId || `#${(r.id || "").slice(-6)}`,
  }));

  if (liveRuns.length === 0) {
    if (unitPillar.totalTests > 0) {
      liveRuns.push({
        id: `run-unit-${String(activeSnapshotId).slice(0, 6)}`,
        type: "unit",
        status: unitPillar.failedTests > 0 ? "fail" : "pass",
        passed: unitPillar.passedTests,
        failed: unitPillar.failedTests,
        total: unitPillar.totalTests,
        coveragePct: unitPillar.coverageMetrics.lines,
        durationMs: unitPillar.durationMs,
        startedAt: Date.now(),
        commitSha: String(activeSnapshotId).slice(0, 7),
        failureLayer: unitPillar.failedTests > 0 ? "Unit Assertion Failure" : "None — All Passed",
        stackTrace: `${unitPillar.framework} Execution:\n  Passed: ${unitPillar.passedTests}/${unitPillar.totalTests}\n  Line Coverage: ${unitPillar.coverageMetrics.lines != null ? `${unitPillar.coverageMetrics.lines}%` : "Not measured"}`,
        testCases: [],
      });
    }
    if (integrationPillar.totalTests > 0) {
      liveRuns.push({
        id: `run-int-${String(activeSnapshotId).slice(0, 6)}`,
        type: "integration",
        status: integrationPillar.failedTests > 0 ? "fail" : "pass",
        passed: integrationPillar.passedTests,
        failed: integrationPillar.failedTests,
        total: integrationPillar.totalTests,
        coveragePct: integrationPillar.coverageMetrics.apiEndpoint,
        durationMs: integrationPillar.durationMs,
        startedAt: Date.now(),
        commitSha: String(activeSnapshotId).slice(0, 7),
        failureLayer: integrationPillar.failedTests > 0 ? "API Integration Failure" : "None — All Covered",
        stackTrace: `${integrationPillar.framework} Execution:\n  Covered: ${integrationPillar.passedTests}/${integrationPillar.coverageMetrics.totalApis} APIs`,
        testCases: [],
      });
    }
    if (systemPillar.totalTests > 0) {
      liveRuns.push({
        id: `run-sys-${String(activeSnapshotId).slice(0, 6)}`,
        type: "system",
        status: systemPillar.failedTests > 0 ? "fail" : "pass",
        passed: systemPillar.passedTests,
        failed: systemPillar.failedTests,
        total: systemPillar.totalTests,
        coveragePct: systemPillar.coverageMetrics.flow,
        durationMs: systemPillar.durationMs,
        startedAt: Date.now(),
        commitSha: String(activeSnapshotId).slice(0, 7),
        failureLayer: systemPillar.failedTests > 0 ? "System E2E Failure" : "None — All Journeys Passed",
        stackTrace: `${systemPillar.framework} Execution:\n  Passed: ${systemPillar.passedTests}/${systemPillar.totalTests} journeys`,
        testCases: [],
      });
    }
  }

  // Real Trend Series from backend or current snapshot state
  const liveTrendSeries =
    Array.isArray(unifiedBackendRaw?.trend?.series) && unifiedBackendRaw.trend.series.length > 0
      ? unifiedBackendRaw.trend.series
      : execution.total > 0 || (coverage.overall && coverage.overall > 0)
      ? [
          {
            runLabel: `#1 (${String(activeSnapshotId).slice(0, 7) || "Current"})`,
            timestamp: Date.now(),
            unitCoverage: coverage.codePct || 0,
            integrationCoverage: coverage.apiPct || 0,
            systemCoverage: systemPillar.coverageAvailable ? coverage.flowPct : null,
            overallCoverage: coverage.overall || 0,
            passRate: execution.passRate || 0,
            unitPassRate: unitPillar.passRate || 0,
            integrationPassRate: integrationPillar.passRate || 0,
            systemPassRate: systemPillar.passRate || 0,
          },
        ]
      : [];

  const beforeAfter = unifiedBackendRaw?.trend?.beforeAfter || {
    before: {
      unit: 0,
      integration: 0,
      system: 0,
      unitPassRate: 0,
      integrationPassRate: 0,
      systemPassRate: 0,
    },
    after: {
      unit: coverage.codePct || 0,
      integration: coverage.apiPct || 0,
      system: systemPillar.coverageAvailable ? coverage.flowPct : null,
      unitPassRate: unitPillar.passRate || 0,
      integrationPassRate: integrationPillar.passRate || 0,
      systemPassRate: systemPillar.passRate || 0,
    },
  };

  const liveGaps =
    unifiedBackendRaw?.ai?.gaps ??
    (integrationPillar.coverageMetrics?.uncoveredApis || 0) +
      (unitPillar.lowCoverageItems?.filter((f) => (f.branchesPct ?? 0) < 75).length || 0);

  const featureDurations = normalizeFeatureDurations(unifiedBackendRaw?.featureDurations);
  const aiTrustworthiness = normalizeAiTrustworthiness(unifiedBackendRaw?.aiEvaluation);

  return {
    context: {
      projectId: context.projectId || unifiedBackendRaw?.context?.projectId || "",
      projectName: context.projectName || unifiedBackendRaw?.context?.projectName || "CovAI Project",
      branch: unifiedBackendRaw?.context?.branch || context.branch || "main",
      lifecycleStatus:
        unifiedBackendRaw?.context?.lifecycleStatus ||
        context.lifecycleStatus ||
        (execution.total > 0 ? "DOING" : null),
      snapshotId: activeSnapshotId,
      snapshotLabel:
        unifiedBackendRaw?.context?.snapshotLabel ||
        effectiveSnapshots
          .find((s) => s.id === activeSnapshotId)
          ?.label?.replace(/ — Active$/, "") ||
        context.snapshotLabel ||
        "",
      snapshots: effectiveSnapshots,
      activeSuiteRun:
        unifiedBackendRaw?.context?.activeSuiteRun ??
        unifiedBackendRaw?.activeSuiteRun ??
        null,
      updatedAt: unifiedBackendRaw?.context?.updatedAt || Date.now(),
    },
    qualityGate,
    health,
    execution,
    coverage,
    ai: {
      aiGenerated: Number(unifiedBackendRaw?.ai?.aiGenerated ?? 0),
      aiRepaired: Number(unifiedBackendRaw?.ai?.aiRepaired ?? 0),
      gaps: Number(liveGaps),
    },
    pillars,
    pyramid,
    matrix: {
      rows: liveMatrixRows,
    },
    actions: {
      items: actionsItems,
    },
    trend: {
      series: liveTrendSeries,
      beforeAfter,
    },
    history: {
      runs: liveRuns,
    },
    featureDurations,
    aiTrustworthiness,
  };
}

const CANONICAL_FEATURE_DURATIONS = [
  { key: "project_analysis", label: "Project Analysis", jobTypes: ["ANALYSIS"] },
  {
    key: "unit_test_coverage",
    label: "Unit Test Coverage",
    jobTypes: ["RUN_TESTS", "RUN_VITEST_TESTS", "COVERAGE", "VITEST_COVERAGE", "PARSE_COVERAGE"],
  },
  { key: "integration_ai_tests", label: "Integration AI Tests", jobTypes: ["AI_TESTS"] },
  {
    key: "integration_coverage",
    label: "Integration Coverage",
    jobTypes: ["SUPERTEST_COVERAGE", "PLAYWRIGHT_API_COVERAGE"],
  },
  {
    key: "system_tests",
    label: "System Tests",
    jobTypes: [
      "SYSTEM_TEST_ASSESSMENT",
      "PLAYWRIGHT_SYSTEM_TEST",
      "PLAYWRIGHT_SYSTEM_COVERAGE",
      "CYPRESS_SYSTEM_TEST",
      "CYPRESS_SYSTEM_COVERAGE",
      "SYSTEM_TEST_IMPROVEMENT",
      "SYSTEM_TEST_ANALYSIS",
      "SYSTEM_TEST_MUTATION",
    ],
  },
  { key: "install_deps", label: "Install Dependencies", jobTypes: ["INSTALL_DEPS"] },
  { key: "ai_evaluation", label: "AI Evaluation", jobTypes: ["AI_EVALUATION"] },
];

function toOptionalDurationMs(val) {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
}

export function normalizeFeatureDurations(rawList) {
  const byKey = new Map();
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (item?.key) byKey.set(item.key, item);
    }
  }

  return CANONICAL_FEATURE_DURATIONS.map((def) => {
    const raw = byKey.get(def.key);
    const runCount = Math.max(0, Number(raw?.runCount ?? 0) || 0);
    const hasRuns = runCount > 0;
    const latestDurationMs = hasRuns ? toOptionalDurationMs(raw?.latestDurationMs) : null;
    const totalDurationMs = hasRuns ? toOptionalDurationMs(raw?.totalDurationMs) : null;
    const avgDurationMs = hasRuns
      ? toOptionalDurationMs(raw?.avgDurationMs) ??
        (totalDurationMs !== null ? Math.round(totalDurationMs / runCount) : null)
      : null;

    return {
      key: def.key,
      label: raw?.label || def.label,
      jobTypes: Array.isArray(raw?.jobTypes) && raw.jobTypes.length > 0 ? raw.jobTypes : [...def.jobTypes],
      runCount,
      latestDurationMs,
      totalDurationMs,
      avgDurationMs,
      lastRunAt: hasRuns && raw?.lastRunAt ? String(raw.lastRunAt) : null,
      lastStatus: hasRuns ? String(raw?.lastStatus || "SUCCESS").toUpperCase() : "NOT_RUN",
    };
  });
}

export function normalizeAiTrustworthiness(rawEval) {
  const mappedAudit = rawEval?.designAudit
    ? {
        status: String(rawEval.designAudit.status || "READY"),
        detected: Boolean(rawEval.designAudit.detected),
        designScore:
          rawEval.designAudit.designScore !== null &&
          rawEval.designAudit.designScore !== undefined &&
          Number.isFinite(Number(rawEval.designAudit.designScore))
            ? Number(Number(rawEval.designAudit.designScore).toFixed(1))
            : null,
        findingsCount: Math.max(0, Number(rawEval.designAudit.findingsCount ?? 0) || 0),
      }
    : null;

  if (!rawEval || rawEval.hasRun === false || rawEval.status === "NOT_RUN") {
    return {
      hasRun: false,
      status: "NOT_RUN",
      verdict: "NOT_RUN",
      score: null,
      rawScore: null,
      scoreHidden: false,
      passMark: null,
      criticalSafetyFailure: false,
      partial: false,
      completeness: null,
      scenarioPassRate: null,
      stability: null,
      latency: null,
      criteriaSummary: [],
      tasks: [],
      totalRuns: 0,
      latestRunId: null,
      lastRunAt: null,
      targetName: null,
      profileName: null,
      designAudit: mappedAudit,
    };
  }

  const criteriaSummary = Array.isArray(rawEval.criteriaSummary)
    ? rawEval.criteriaSummary.map((c) => ({
        criterionKey: String(c?.criterionKey || ""),
        label: c?.label || CRITERION_LABELS[c?.criterionKey] || String(c?.criterionKey || "Criterion"),
        score: toOptionalPct(c?.score),
        scored: Math.max(0, Number(c?.scored ?? 0) || 0),
        applicable: Math.max(0, Number(c?.applicable ?? 0) || 0),
      }))
    : [];

  const tasks = Array.isArray(rawEval.tasks)
    ? rawEval.tasks.map((t) => ({
        taskType: String(t?.taskType || ""),
        score: toOptionalPct(t?.score),
        scored: Math.max(0, Number(t?.scored ?? 0) || 0),
        applicable: Math.max(0, Number(t?.applicable ?? 0) || 0),
        partial: Boolean(t?.partial),
      }))
    : [];

  return {
    hasRun: true,
    status: String(rawEval.status || "COMPLETED").toUpperCase(),
    verdict: String(rawEval.verdict || "INCOMPLETE").toUpperCase(),
    score: toOptionalPct(rawEval.score),
    rawScore: toOptionalPct(rawEval.rawScore),
    scoreHidden: Boolean(rawEval.scoreHidden),
    passMark:
      rawEval.passMark !== null &&
      rawEval.passMark !== undefined &&
      Number.isFinite(Number(rawEval.passMark))
        ? Number(rawEval.passMark)
        : null,
    criticalSafetyFailure: Boolean(rawEval.criticalSafetyFailure),
    partial: Boolean(rawEval.partial),
    completeness: rawEval.completeness
      ? {
          scored: Math.max(0, Number(rawEval.completeness.scored ?? 0) || 0),
          applicable: Math.max(0, Number(rawEval.completeness.applicable ?? 0) || 0),
        }
      : null,
    scenarioPassRate: rawEval.scenarioPassRate
      ? {
          passed: Math.max(0, Number(rawEval.scenarioPassRate.passed ?? 0) || 0),
          evaluated: Math.max(0, Number(rawEval.scenarioPassRate.evaluated ?? 0) || 0),
          total: Math.max(0, Number(rawEval.scenarioPassRate.total ?? 0) || 0),
          rate: toOptionalPct(rawEval.scenarioPassRate.rate),
          wilson95: rawEval.scenarioPassRate.wilson95
            ? {
                rate: Number(rawEval.scenarioPassRate.wilson95.rate ?? 0),
                lower: Number(rawEval.scenarioPassRate.wilson95.lower ?? 0),
                upper: Number(rawEval.scenarioPassRate.wilson95.upper ?? 0),
              }
            : null,
        }
      : null,
    stability: rawEval.stability
      ? {
          eligibleCases: Math.max(0, Number(rawEval.stability.eligibleCases ?? 0) || 0),
          stableCases: Math.max(0, Number(rawEval.stability.stableCases ?? 0) || 0),
          unstableCases: Math.max(0, Number(rawEval.stability.unstableCases ?? 0) || 0),
          stabilityRate: toOptionalPct(rawEval.stability.stabilityRate),
        }
      : null,
    latency: rawEval.latency
      ? {
          avgMs: toOptionalDurationMs(rawEval.latency.avgMs),
          p95Ms: toOptionalDurationMs(rawEval.latency.p95Ms),
          slaMs: toOptionalDurationMs(rawEval.latency.slaMs),
          withinSlaRate: toOptionalPct(rawEval.latency.withinSlaRate),
          status: rawEval.latency.status ? String(rawEval.latency.status) : null,
        }
      : null,
    criteriaSummary,
    tasks,
    totalRuns: Math.max(0, Number(rawEval.totalRuns ?? 1) || 1),
    latestRunId: rawEval.latestRunId || null,
    lastRunAt: rawEval.lastRunAt || null,
    targetName: rawEval.targetName || null,
    profileName: rawEval.profileName || null,
    designAudit: mappedAudit,
  };
}
