import prisma from "../config/prisma.js";

/**
 * Computes a deterministic rank score for a unit test coverage analysis run.
 * Higher coverage percentages across Lines/Branches/Functions/Statements always dominate,
 * with covered file count and passed tests breaking ties.
 */
export const computeUnitCoverageRank = ({
  linesPct = 0,
  branchesPct = 0,
  funcsPct = 0,
  stmtsPct = 0,
  coveredFiles = 0,
  passedTests = 0,
} = {}) => {
  const compositeCov =
    Number(linesPct || 0) * 0.4 +
    Number(branchesPct || 0) * 0.25 +
    Number(funcsPct || 0) * 0.2 +
    Number(stmtsPct || 0) * 0.15;

  return (
    Math.round(compositeCov * 10000) +
    Math.round(Number(linesPct || 0) * 100) +
    Math.round(Number(coveredFiles || 0) * 50) +
    Number(passedTests || 0)
  );
};

function normalizeTotalsBlock(summaryTotal = null) {
  if (!summaryTotal || typeof summaryTotal !== "object") {
    return {
      lines: { total: 0, covered: 0, pct: 0 },
      branches: { total: 0, covered: 0, pct: 0 },
      functions: { total: 0, covered: 0, pct: 0 },
      statements: { total: 0, covered: 0, pct: 0 },
    };
  }
  const pick = (key) => ({
    total: Number(summaryTotal[key]?.total ?? 0),
    covered: Number(summaryTotal[key]?.covered ?? 0),
    pct: Number(summaryTotal[key]?.pct ?? 0),
  });
  return {
    lines: pick("lines"),
    branches: pick("branches"),
    functions: pick("functions"),
    statements: pick("statements"),
  };
}

function parseAnalysisJson(rawJson) {
  if (!rawJson) return {};
  if (typeof rawJson === "string") {
    try {
      const parsed = JSON.parse(rawJson);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawJson === "object" ? rawJson : {};
}

/**
 * Reads the preserved highest-coverage Unit Test report snapshot for a ProjectSnapshot.
 */
export const getPeakUnitReport = async (snapshotId) => {
  if (!snapshotId || typeof prisma?.projectStructureAnalysis?.findUnique !== "function") {
    return null;
  }
  try {
    const row = await prisma.projectStructureAnalysis.findUnique({
      where: { snapshotId },
      select: { resultJson: true },
    });
    if (!row?.resultJson) return null;
    const parsed = parseAnalysisJson(row.resultJson);
    return parsed?.peakUnitReport || null;
  } catch (err) {
    console.warn("[unitReport] Failed to load peakUnitReport:", err?.message);
    return null;
  }
};

/**
 * Captures and persists the highest unit coverage report achieved for a snapshot
 * after a coverage analysis run, mirroring capturePeakIntegrationReportIfHigher.
 */
export const capturePeakUnitReportIfHigher = async (
  snapshotId,
  {
    summaryTotal = null,
    fileCoverages = [],
    testStats = null,
    failingTests = [],
    isTargetedRun = false,
  } = {},
) => {
  if (!snapshotId || typeof prisma?.projectStructureAnalysis?.upsert !== "function") {
    return null;
  }

  const rawTotals = normalizeTotalsBlock(summaryTotal);
  const linesPct = rawTotals.lines.pct;
  const branchesPct = rawTotals.branches.pct;
  const funcsPct = rawTotals.functions.pct;
  const stmtsPct = rawTotals.statements.pct;

  const cleanFileCoverages = Array.isArray(fileCoverages)
    ? fileCoverages
        .filter((f) => f && f.filePath)
        .map((f) => ({
          filePath: f.filePath,
          linesPct: Number(f.linesPct ?? 0),
          branchesPct: Number(f.branchesPct ?? 0),
          funcsPct: Number(f.funcsPct ?? 0),
          stmtsPct: Number(f.stmtsPct ?? 0),
        }))
    : [];

  const coveredFiles = cleanFileCoverages.filter(
    (f) => Number(f.linesPct || 0) > 0 || Number(f.stmtsPct || 0) > 0,
  ).length;
  const passedTests = Number(testStats?.passed ?? testStats?.passedTests ?? 0);
  const failedTests = Number(testStats?.failed ?? testStats?.failedTests ?? 0);
  const totalTests = Number(testStats?.total ?? testStats?.totalTests ?? passedTests + failedTests);
  const durationMs = Number(testStats?.durationMs ?? 0);

  const score = computeUnitCoverageRank({
    linesPct,
    branchesPct,
    funcsPct,
    stmtsPct,
    coveredFiles,
    passedTests,
  });

  const existingRow = await prisma.projectStructureAnalysis
    .findUnique({
      where: { snapshotId },
      select: { schemaVersion: true, resultJson: true },
    })
    .catch(() => null);

  const baseObj = parseAnalysisJson(existingRow?.resultJson);
  const existingScore = baseObj?.peakUnitReport?.peakMeta?.score ?? -1;

  // Never store a 0% targeted subset run as the project's peak Executive Report
  if (isTargetedRun && score <= 0) {
    return baseObj?.peakUnitReport || null;
  }

  if (baseObj?.peakUnitReport && score < existingScore) {
    return baseObj.peakUnitReport;
  }

  const capturedAt = new Date().toISOString();
  const peakUnitReport = {
    isPeakCoverageReport: true,
    peakMeta: {
      score,
      linesPct,
      branchesPct,
      funcsPct,
      stmtsPct,
      coveredFiles,
      totalFiles: cleanFileCoverages.length,
      passedTests,
      failedTests,
      totalTests,
      isTargetedRun: Boolean(isTargetedRun),
      capturedAt,
    },
    coverageSummary: {
      lines: linesPct,
      branches: branchesPct,
      functions: funcsPct,
      statements: stmtsPct,
    },
    rawTotals,
    fileCoverages: cleanFileCoverages,
    testStats: {
      total: totalTests,
      passed: passedTests,
      failed: failedTests,
      durationMs,
    },
    failingTests: Array.isArray(failingTests) ? failingTests.slice(0, 100) : [],
  };

  const nextJson = JSON.stringify({
    ...baseObj,
    peakUnitReport,
  });

  await prisma.projectStructureAnalysis.upsert({
    where: { snapshotId },
    create: {
      snapshotId,
      schemaVersion: existingRow?.schemaVersion || 1,
      resultJson: nextJson,
    },
    update: {
      resultJson: nextJson,
    },
  });

  return peakUnitReport;
};
