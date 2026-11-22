import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAnalysisStore = new Map();

const mockPrisma = {
  projectStructureAnalysis: {
    findUnique: jest.fn(async ({ where: { snapshotId } }) =>
      mockAnalysisStore.get(snapshotId) || null,
    ),
    upsert: jest.fn(async ({ where: { snapshotId }, create, update }) => {
      const existing = mockAnalysisStore.get(snapshotId);
      const next = existing
        ? { ...existing, ...update }
        : { snapshotId, schemaVersion: create.schemaVersion || 1, resultJson: create.resultJson };
      mockAnalysisStore.set(snapshotId, next);
      return next;
    }),
  },
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
  default: mockPrisma,
}));

const {
  computeUnitCoverageRank,
  capturePeakUnitReportIfHigher,
  getPeakUnitReport,
} = await import("../services/unitReport.service.js");

describe("unitReport.service - Peak Coverage Snapshot", () => {
  const snapshotId = "snap-unit-peak-1";

  beforeEach(() => {
    mockAnalysisStore.clear();
    jest.clearAllMocks();
  });

  it("captures initial analysis run and preserves higher coverage version on lower subsequent run", async () => {
    // 0% targeted run before any full run must not seed a 0% peak report
    const zeroTargeted = await capturePeakUnitReportIfHigher(snapshotId, {
      summaryTotal: {
        lines: { total: 100, covered: 0, pct: 0 },
        branches: { total: 40, covered: 0, pct: 0 },
        functions: { total: 20, covered: 0, pct: 0 },
        statements: { total: 100, covered: 0, pct: 0 },
      },
      fileCoverages: [{ filePath: "src/c.js", linesPct: 0, branchesPct: 0, funcsPct: 0, stmtsPct: 0 }],
      testStats: { total: 0, passed: 0, failed: 0, durationMs: 0 },
      isTargetedRun: true,
    });
    expect(zeroTargeted).toBeNull();

    mockAnalysisStore.set(snapshotId, {
      snapshotId,
      schemaVersion: 1,
      resultJson: JSON.stringify({
        peakIntegrationReport: { peakMeta: { score: 999 } },
      }),
    });

    const first = await capturePeakUnitReportIfHigher(snapshotId, {
      summaryTotal: {
        lines: { total: 100, covered: 65, pct: 65 },
        branches: { total: 40, covered: 20, pct: 50 },
        functions: { total: 20, covered: 14, pct: 70 },
        statements: { total: 100, covered: 65, pct: 65 },
      },
      fileCoverages: [
        { filePath: "src/a.js", linesPct: 80, branchesPct: 60, funcsPct: 75, stmtsPct: 80 },
        { filePath: "src/b.js", linesPct: 50, branchesPct: 40, funcsPct: 65, stmtsPct: 50 },
      ],
      testStats: { total: 10, passed: 9, failed: 1, durationMs: 1200 },
    });

    expect(first.isPeakCoverageReport).toBe(true);
    expect(first.coverageSummary.lines).toBe(65);
    expect(first.peakMeta.coveredFiles).toBe(2);

    // Lower subsequent run (e.g., partial/failing run at 10% lines) must NOT overwrite peak
    const second = await capturePeakUnitReportIfHigher(snapshotId, {
      summaryTotal: {
        lines: { total: 100, covered: 10, pct: 10 },
        branches: { total: 40, covered: 2, pct: 5 },
        functions: { total: 20, covered: 2, pct: 10 },
        statements: { total: 100, covered: 10, pct: 10 },
      },
      fileCoverages: [{ filePath: "src/b.js", linesPct: 10, branchesPct: 5, funcsPct: 10, stmtsPct: 10 }],
      testStats: { total: 2, passed: 1, failed: 1, durationMs: 300 },
      isTargetedRun: true,
    });

    expect(second.coverageSummary.lines).toBe(65);
    expect(second.peakMeta.score).toBe(first.peakMeta.score);

    // Higher subsequent run (88% lines) DOES update peak and preserves peakIntegrationReport
    const third = await capturePeakUnitReportIfHigher(snapshotId, {
      summaryTotal: {
        lines: { total: 100, covered: 88, pct: 88 },
        branches: { total: 40, covered: 32, pct: 80 },
        functions: { total: 20, covered: 18, pct: 90 },
        statements: { total: 100, covered: 88, pct: 88 },
      },
      fileCoverages: [
        { filePath: "src/a.js", linesPct: 95, branchesPct: 85, funcsPct: 100, stmtsPct: 95 },
        { filePath: "src/b.js", linesPct: 81, branchesPct: 75, funcsPct: 80, stmtsPct: 81 },
      ],
      testStats: { total: 12, passed: 12, failed: 0, durationMs: 1500 },
    });

    expect(third.coverageSummary.lines).toBe(88);
    expect(third.peakMeta.score).toBeGreaterThan(first.peakMeta.score);

    const saved = await getPeakUnitReport(snapshotId);
    expect(saved.coverageSummary.lines).toBe(88);

    const storedRow = JSON.parse(mockAnalysisStore.get(snapshotId).resultJson);
    expect(storedRow.peakIntegrationReport).toEqual({ peakMeta: { score: 999 } });
    expect(computeUnitCoverageRank({ linesPct: 88, branchesPct: 80 })).toBeGreaterThan(
      computeUnitCoverageRank({ linesPct: 65, branchesPct: 50 }),
    );
  });
});
