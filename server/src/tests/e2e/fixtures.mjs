import path from "node:path";
import { writeProjectFile } from "./mockPrismaHarness.mjs";

export function makeCoverageEntry(linesCov, linesTot, branchCov, branchTot, fnCov, fnTot, stmtCov = linesCov, stmtTot = linesTot) {
  const pct = (c, t) => (t > 0 ? Number(((c / t) * 100).toFixed(2)) : 100);
  return {
    lines: { total: linesTot, covered: linesCov, skipped: 0, pct: pct(linesCov, linesTot) },
    branches: { total: branchTot, covered: branchCov, skipped: 0, pct: pct(branchCov, branchTot) },
    functions: { total: fnTot, covered: fnCov, skipped: 0, pct: pct(fnCov, fnTot) },
    statements: { total: stmtTot, covered: stmtCov, skipped: 0, pct: pct(stmtCov, stmtTot) },
  };
}

export function buildMeasuredSystemMeasurement({ linesCovered = 110, linesTotal = 130, branchesCovered = 30, branchesTotal = 40 } = {}) {
  const pct = (c, t) => (t > 0 ? Number(((c / t) * 100).toFixed(1)) : 0);
  return {
    schemaVersion: 1,
    status: "MEASURED",
    provider: "istanbul",
    tiers: {
      frontend: {
        counters: {
          lines: { covered: linesCovered, total: linesTotal, pct: pct(linesCovered, linesTotal) },
          branches: { covered: branchesCovered, total: branchesTotal, pct: pct(branchesCovered, branchesTotal) },
          statements: { covered: linesCovered, total: linesTotal, pct: pct(linesCovered, linesTotal) },
          functions: { covered: 20, total: 24, pct: 83.3 },
        },
      },
    },
  };
}

export function createSnapshotShell({
  snapshotId,
  projectId = "proj-e2e-1",
  ownerId = "user-e2e-owner",
  projectName = "CovAI E2E Project",
  branch = "develop",
  rootDir = "",
  versionNumber = 1,
  label = "v1.0.0",
  commitSha = "a1b2c3d4e5f6",
  createdAt = new Date("2026-11-26T10:00:00.000Z"),
  coverageSummaries = null,
} = {}) {
  return {
    id: snapshotId,
    projectId,
    storagePath: null,
    rootDir,
    source: "LOCAL",
    versionNumber,
    label,
    contentHash: "hash1234567890",
    commitSha,
    createdAt,
    coverageSummaries,
    _count: {
      systemScenarios: 0,
      systemProposals: 0,
    },
    project: {
      id: projectId,
      ownerId,
      name: projectName,
      defaultBranch: branch,
      lifecycleStatus: "DOING",
      lifecycleUpdatedAt: createdAt,
      updatedAt: createdAt,
      activeSnapshotId: snapshotId,
      _count: {
        aiSuggestions: 2,
      },
    },
  };
}

/**
 * Synthesizes the exact `fifa-wc2026-stadium-ai` disk + Prisma fixture matching live dashboard telemetry:
 * - Unit: Lines 97.6% (837/858), Branches 99.4% (172/173), Functions 98.1% (52/53), Statements 97.6% (837/858)
 * - 16 business files (15 covered, 1 uncovered), 106/108 tests passed (2 failed), 200ms (0.2s)
 * - Stale DB / polluted raw total: 72.9% branches, 99.3% functions, vitest.setup.ts 0%
 * - Integration: Covered, Partial, Script Error, Uncovered endpoints
 * - System: 5/5 passed, systemMeasurement: null (unmeasured coverage -> Pending)
 */
export function createFifaWc2026BackendFixture(rootDir, snapshotId, options = {}) {
  const {
    includeIntegration = true,
    includeSystem = true,
    withHistoricalTrend = true,
  } = options;

  const vitestConfig = `
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      exclude: ['vitest.setup.ts', 'vitest.workspace.ts', 'src/scripts/**', '**/*.test.ts']
    }
  }
});
`;
  writeProjectFile(rootDir, "vitest.config.ts", vitestConfig);

  const businessFileSpecs = [
    { rel: "src/services/matchPredictor.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/stadiumGraph.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/bracketResolver.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/ticketAllocation.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/crowdFlow.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/gateDispatch.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/transitSync.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/weatherImpact.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/broadcastFeed.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/refereeAssignment.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/securityScreening.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/hospitalitySlot.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/seatInventory.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/fanZoneRouter.service.ts", l: [55, 55], b: [11, 11], f: [3, 3] },
    { rel: "src/services/pricingEngine.service.ts", l: [67, 67], b: [18, 19], f: [10, 11] },
    { rel: "src/services/stadiumLegacyAdapter.service.ts", l: [0, 21], b: [0, 0], f: [0, 0] },
  ];
  // Sums across 16 business files:
  // lines: 14*55 + 67 + 0 = 837 / 858 (97.6%)
  // branches: 14*11 + 18 + 0 = 172 / 173 (99.4%)
  // functions: 14*3 + 10 + 0 = 52 / 53 (98.1%)

  const summaryJson = {
    total: {
      lines: { total: 1068, covered: 837, skipped: 0, pct: 78.37 },
      branches: { total: 236, covered: 172, skipped: 0, pct: 72.88 },
      functions: { total: 143, covered: 142, skipped: 0, pct: 99.3 },
      statements: { total: 1068, covered: 837, skipped: 0, pct: 78.37 },
    },
  };

  const coverageFiles = [];
  for (const spec of businessFileSpecs) {
    const absPath = path.join(rootDir, spec.rel);
    const entry = makeCoverageEntry(spec.l[0], spec.l[1], spec.b[0], spec.b[1], spec.f[0], spec.f[1]);
    summaryJson[absPath] = entry;
    coverageFiles.push({
      id: `cf-${coverageFiles.length + 1}`,
      snapshotId,
      filePath: spec.rel,
      linesPct: entry.lines.pct,
      branchesPct: entry.branches.pct,
      funcsPct: entry.functions.pct,
      stmtsPct: entry.statements.pct,
    });
  }

  // Excluded files in summary + Prisma CoverageFile (must NOT pollute matrix or metrics)
  summaryJson[path.join(rootDir, "vitest.setup.ts")] = makeCoverageEntry(0, 120, 0, 63, 0, 12);
  summaryJson[path.join(rootDir, "src/scripts/seedStadiums.ts")] = makeCoverageEntry(0, 90, 0, 0, 0, 5);
  coverageFiles.push(
    {
      id: "cf-excluded-vitest",
      snapshotId,
      filePath: "vitest.setup.ts",
      linesPct: 0,
      branchesPct: 0,
      funcsPct: 0,
      stmtsPct: 0,
    },
    {
      id: "cf-excluded-script",
      snapshotId,
      filePath: "src/scripts/seedStadiums.ts",
      linesPct: 0,
      branchesPct: 0,
      funcsPct: 0,
      stmtsPct: 0,
    }
  );

  // Older stale summary + newer filtered vitest summary
  writeProjectFile(rootDir, "coverage/unit/coverage-summary.json", {
    total: makeCoverageEntry(784, 1000, 172, 236, 142, 143),
    [path.join(rootDir, "vitest.setup.ts")]: makeCoverageEntry(0, 120, 0, 63, 0, 12),
  }, { mtimeOffsetMs: -60_000 });
  writeProjectFile(rootDir, "coverage/unit/vitest-coverage-summary.json", summaryJson, { mtimeOffsetMs: -1_000 });

  const unitScenarios = [];
  for (let i = 1; i <= 106; i++) {
    const targetFile = businessFileSpecs[(i - 1) % 15].rel;
    unitScenarios.push({
      id: `usc-${i}`,
      title: `passes scenario ${i}`,
      suiteName: path.basename(targetFile),
      testFile: targetFile.replace(".ts", ".test.ts"),
      status: "passed",
      durationMs: 2,
      failureMessages: [],
    });
  }
  unitScenarios.push(
    {
      id: "usc-107",
      title: "handles edge case pricing tier",
      suiteName: "pricingEngine",
      testFile: "src/services/pricingEngine.service.test.ts",
      status: "failed",
      durationMs: 4,
      failureMessages: ["AssertionError: expected 120 to equal 125"],
    },
    {
      id: "usc-108",
      title: "handles legacy stadium capacity fallback",
      suiteName: "stadiumLegacyAdapter",
      testFile: "src/services/stadiumLegacyAdapter.service.test.ts",
      status: "failed",
      durationMs: 3,
      failureMessages: ["AssertionError: expected null to be defined"],
    }
  );

  const tUnit = new Date("2026-11-26T09:50:00.000Z");
  const tUnitOld = new Date("2026-11-26T08:30:00.000Z");
  const tInt = new Date("2026-11-26T09:55:00.000Z");
  const tSys = new Date("2026-11-26T09:58:00.000Z");

  const unitRun = {
    id: `run-unit-${snapshotId}`,
    snapshotId,
    type: "VITEST",
    status: "FAILED",
    totalTests: 108,
    passedTests: 106,
    failedTests: 2,
    skippedTests: 0,
    flakyTests: 0,
    durationMs: 200,
    coverageLinesPct: 78.4,
    coverageBranchesPct: 72.9,
    coverageFunctionsPct: 99.3,
    coverageStatementsPct: 78.4,
    createdAt: tUnit,
    startedAt: tUnit,
    snapshot: { id: snapshotId, commitSha: "wc2026a", createdAt: tUnit },
    scenarios: unitScenarios,
  };

  const testRuns = [unitRun];
  const jobs = [
    {
      id: `job-unit-${snapshotId}`,
      snapshotId,
      type: "RUN_TESTS",
      status: "SUCCESS",
      progress: 100,
      resultJson: null,
      createdAt: tUnit,
      startedAt: tUnit,
      finishedAt: tUnit,
    },
  ];

  let integrationScan = null;
  if (includeIntegration) {
    integrationScan = {
      explicitlyScanned: true,
      scannedAt: tInt.toISOString(),
      sourceFilesCount: 4,
      discoveredEndpoints: [
        {
          id: "ep-matches",
          method: "GET",
          path: "/api/matches",
          fullPath: "/api/matches",
          sourceFile: "src/routes/matches.routes.js",
          controllerFile: "src/services/matchPredictor.service.ts",
        },
        {
          id: "ep-tickets-reserve",
          method: "POST",
          path: "/api/tickets/reserve",
          fullPath: "/api/tickets/reserve",
          sourceFile: "src/routes/tickets.routes.js",
          controllerFile: "src/services/ticketAllocation.service.ts",
          requestBodySchema: { stadiumId: "string", qty: "number" },
        },
        {
          id: "ep-stadium-cap",
          method: "GET",
          path: "/api/stadiums/:id/capacity",
          fullPath: "/api/stadiums/:id/capacity",
          sourceFile: "src/routes/stadiums.routes.js",
          controllerFile: "src/services/stadiumGraph.service.ts",
        },
        {
          id: "ep-tickets-del",
          method: "DELETE",
          path: "/api/tickets/:id",
          fullPath: "/api/tickets/:id",
          sourceFile: "src/routes/tickets.routes.js",
          controllerFile: "src/services/ticketAllocation.service.ts",
        },
      ],
    };

    testRuns.push({
      id: `run-int-${snapshotId}`,
      snapshotId,
      type: "SUPERTEST",
      status: "FAILED",
      totalTests: 4,
      passedTests: 2,
      failedTests: 2,
      skippedTests: 0,
      flakyTests: 0,
      durationMs: 1450,
      endpointCoveragePct: 25.0,
      createdAt: tInt,
      startedAt: tInt,
      snapshot: { id: snapshotId, commitSha: "wc2026a", createdAt: tInt },
      scenarios: [
        {
          id: "isc-1",
          title: "GET /api/matches returns upcoming schedule",
          suiteName: "GET /api/matches",
          testFile: "tests/integration/matches.test.js",
          status: "passed",
          actualStatus: 200,
          durationMs: 42,
          failureMessages: [],
        },
        {
          id: "isc-2",
          title: "POST /api/tickets/reserve happy path 201",
          suiteName: "POST /api/tickets/reserve",
          testFile: "tests/integration/tickets.test.js",
          status: "passed",
          actualStatus: 201,
          durationMs: 65,
          failureMessages: [],
        },
        {
          id: "isc-3",
          title: "POST /api/tickets/reserve validation 400",
          suiteName: "POST /api/tickets/reserve",
          testFile: "tests/integration/tickets.test.js",
          status: "failed",
          actualStatus: 500,
          durationMs: 88,
          failureLayer: "CONTROLLER_ERROR",
          failureMessages: ["Expected: 400\nReceived: 500"],
        },
        {
          id: "isc-4",
          title: "GET /api/stadiums/:id/capacity returns seating map",
          suiteName: "GET /api/stadiums/:id/capacity",
          testFile: "tests/integration/stadiums.test.js",
          status: "failed",
          durationMs: 15,
          failureMessages: ["TypeError: Cannot read properties of undefined (reading 'seats')"],
        },
      ],
    });

    jobs.push({
      id: `job-int-${snapshotId}`,
      snapshotId,
      type: "SUPERTEST_COVERAGE",
      status: "SUCCESS",
      progress: 100,
      resultJson: JSON.stringify({ analyzedEndpoints: ["*"] }),
      createdAt: tInt,
      startedAt: tInt,
      finishedAt: tInt,
    });
  }

  if (includeSystem) {
    testRuns.push({
      id: `run-sys-${snapshotId}`,
      snapshotId,
      type: "PLAYWRIGHT",
      status: "PASSED",
      totalTests: 5,
      passedTests: 5,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      durationMs: 12400,
      systemMeasurement: null,
      createdAt: tSys,
      startedAt: tSys,
      snapshot: { id: snapshotId, commitSha: "wc2026a", createdAt: tSys },
      scenarios: [
        {
          id: "ssc-1",
          title: "Stadium seat selector flow",
          suiteName: "seatInventory",
          testFile: "e2e/seat-selector.spec.ts",
          status: "passed",
          durationMs: 2400,
          failureMessages: [],
        },
        {
          id: "ssc-2",
          title: "Match bracket explorer flow",
          suiteName: "bracketResolver",
          testFile: "e2e/bracket.spec.ts",
          status: "passed",
          durationMs: 2500,
          failureMessages: [],
        },
      ],
    });
  }

  const historicalTestRuns = [...testRuns];
  if (withHistoricalTrend) {
    historicalTestRuns.push({
      id: `run-unit-old-${snapshotId}`,
      snapshotId,
      type: "VITEST",
      status: "FAILED",
      totalTests: 96,
      passedTests: 90,
      failedTests: 6,
      skippedTests: 0,
      flakyTests: 0,
      durationMs: 260,
      coverageLinesPct: 91.2,
      coverageBranchesPct: 88.5,
      coverageFunctionsPct: 92.0,
      coverageStatementsPct: 91.2,
      createdAt: tUnitOld,
      startedAt: tUnitOld,
      snapshot: { id: snapshotId, commitSha: "wc20260", createdAt: tUnitOld },
      scenarios: [],
    });
  }

  const snapshot = createSnapshotShell({
    snapshotId,
    projectId: "proj-wc2026",
    projectName: "fifa-wc2026-stadium-ai",
    branch: "main",
    rootDir,
    versionNumber: 3,
    label: "#3 (wc2026a)",
    commitSha: "wc2026a112233",
    createdAt: new Date("2026-11-26T10:05:00.000Z"),
    coverageSummaries: {
      id: `cs-${snapshotId}`,
      snapshotId,
      linesPct: 78.4,
      branchesPct: 72.9,
      funcsPct: 99.3,
      stmtsPct: 78.4,
      createdAt: tUnit,
    },
  });

  return {
    snapshot,
    projectSnapshots: [snapshot],
    coverageFiles,
    coverageSummary: snapshot.coverageSummaries,
    jobs,
    aiTests: [],
    testRuns,
    snapshotTestRuns: testRuns,
    historicalTestRuns,
    integrationScan,
  };
}

/**
 * Pure VM fixture for `fifa-wc2026-stadium-ai` conforming strictly to the R2 contract.
 */
export function createFifaWc2026Vm(adaptUnifiedDashboard, overrides = {}) {
  const baseBackendRaw = {
    context: {
      projectId: "proj-wc2026",
      projectName: "fifa-wc2026-stadium-ai",
      branch: "main",
      snapshotId: "snap-wc2026-001",
      snapshotLabel: "#3 (wc2026a)",
      updatedAt: "2026-11-26T10:05:00.000Z",
    },
    pillars: {
      unit: {
        framework: "Vitest",
        totalTests: 108,
        passedTests: 106,
        failedTests: 2,
        skippedTests: 0,
        durationMs: 200,
        avgDurationMs: 200,
        coverageSource: "filtered-summary",
        coverageMetrics: {
          lines: 97.6,
          branches: 99.4,
          functions: 98.1,
          statements: 97.6,
          linesCovered: 837,
          linesTotal: 858,
          branchesCovered: 172,
          branchesTotal: 173,
          functionsCovered: 52,
          functionsTotal: 53,
          statementsCovered: 837,
          statementsTotal: 858,
        },
        coverageFiles: [
          { filePath: "src/services/stadiumLegacyAdapter.service.ts", name: "stadiumLegacyAdapter.service.ts", linesPct: 0, branchesPct: 0, functionsPct: 0, statementsPct: 0 },
          { filePath: "src/services/pricingEngine.service.ts", name: "pricingEngine.service.ts", linesPct: 100, branchesPct: 94.7, functionsPct: 90.9, statementsPct: 100 },
          { filePath: "src/services/matchPredictor.service.ts", name: "matchPredictor.service.ts", linesPct: 100, branchesPct: 100, functionsPct: 100, statementsPct: 100 },
        ],
        lowCoverageItems: [
          { filePath: "src/services/stadiumLegacyAdapter.service.ts", name: "stadiumLegacyAdapter.service.ts", linesPct: 0, branchesPct: 0, functionsPct: 0 },
          { filePath: "src/services/pricingEngine.service.ts", name: "pricingEngine.service.ts", linesPct: 100, branchesPct: 94.7, functionsPct: 90.9 },
        ],
      },
      integration: {
        framework: "Supertest",
        totalTests: 4,
        passedTests: 2,
        failedTests: 2,
        skippedTests: 0,
        durationMs: 1450,
        avgDurationMs: 65,
        avgEndpointLatencyMs: 65,
        coverageMetrics: {
          lines: 74.2,
          branches: 68.0,
          functions: 75.0,
          statements: 74.2,
          apiEndpoint: 25.0,
          coveredApis: 1,
          partialApis: 1,
          failedApis: 2,
          uncoveredApis: 3,
          totalApis: 4,
        },
        failureDistribution: { route: 0, middlewareAuth: 1, controller: 1, database: 0 },
      },
      system: {
        framework: "Playwright",
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        skippedTests: 0,
        flakyTests: 0,
        durationMs: 12400,
        avgDurationMs: 2480,
        coverageAvailable: false,
        coverageMetrics: { lines: null, flow: null },
        failureDistribution: { selectorNotFound: 0, networkTimeout: 0, assertion: 0, flaky: 0 },
      },
    },
    ai: { aiGenerated: 6, aiRepaired: 2, gaps: 4 },
    matrix: {
      rows: [
        {
          id: "mod-match-predictor",
          moduleName: "Match Predictor Module",
          unit: { status: "pass", label: "20/20 · 100% lines", passed: 20, failed: 0, total: 20 },
          integration: { status: "pass", label: "1/1", passed: 1, failed: 0, total: 1 },
          system: { status: "pass", label: "2/2", passed: 2, failed: 0, total: 2 },
          rootCause: { suspectLayer: "none", summary: "Verified across all 3 layers" },
        },
        {
          id: "mod-ticket-allocation",
          moduleName: "Ticket Allocation Module",
          unit: { status: "pass", label: "18/18 · 100% lines", passed: 18, failed: 0, total: 18 },
          integration: { status: "fail", label: "1/2", passed: 1, failed: 1, total: 2 },
          system: { status: "untested", label: "Not Run", passed: 0, failed: 0, total: 0 },
          rootCause: { suspectLayer: "integration", summary: "API route failure" },
        },
        {
          id: "mod-stadium-graph",
          moduleName: "Stadium Graph Module",
          unit: { status: "pass", label: "15/15 · 100% lines", passed: 15, failed: 0, total: 15 },
          integration: { status: "fail", label: "0/1", passed: 0, failed: 1, total: 1 },
          system: { status: "untested", label: "Not Run", passed: 0, failed: 0, total: 0 },
          rootCause: { suspectLayer: "integration", summary: "Script error in API suite" },
        },
        {
          id: "mod-pricing-engine",
          moduleName: "Pricing Engine Module",
          unit: { status: "fail", label: "14/15 · 100% lines", passed: 14, failed: 1, total: 15 },
          integration: { status: "none", label: "No APIs", passed: 0, failed: 0, total: 0 },
          system: { status: "untested", label: "Not Run", passed: 0, failed: 0, total: 0 },
          rootCause: { suspectLayer: "unit", summary: "Unit test assertion failure" },
        },
        {
          id: "mod-stadium-legacy",
          moduleName: "Stadium Legacy Adapter",
          unit: { status: "fail", label: "0/1 · 0% lines", passed: 0, failed: 1, total: 1 },
          integration: { status: "none", label: "No APIs", passed: 0, failed: 0, total: 0 },
          system: { status: "untested", label: "Not Run", passed: 0, failed: 0, total: 0 },
          rootCause: { suspectLayer: "unit", summary: "Unit test assertion failure" },
        },
      ],
    },
    trend: {
      series: [
        { runLabel: "#1", overallCoverage: 64.0, unitCoverage: 91.2, integrationCoverage: 0, systemCoverage: null, passRate: 93.8 },
        { runLabel: "#2", overallCoverage: 71.5, unitCoverage: 95.0, integrationCoverage: 25.0, systemCoverage: null, passRate: 96.4 },
        { runLabel: "#3", overallCoverage: 56.3, unitCoverage: 97.6, integrationCoverage: 25.0, systemCoverage: null, passRate: 96.6 },
      ],
    },
    history: {
      runs: [
        { id: "run-u3", shortId: "run-u3", type: "unit", status: "fail", passed: 106, failed: 2, coveragePct: 97.6, durationMs: 200, commitSha: "wc2026a" },
        { id: "run-i3", shortId: "run-i3", type: "integration", status: "fail", passed: 2, failed: 2, coveragePct: 25.0, durationMs: 1450, commitSha: "wc2026a" },
        { id: "run-s3", shortId: "run-s3", type: "system", status: "pass", passed: 5, failed: 0, coveragePct: null, durationMs: 12400, commitSha: "wc2026a" },
      ],
    },
  };

  const mergedRaw = {
    ...baseBackendRaw,
    ...overrides,
    context: {
      ...baseBackendRaw.context,
      ...(overrides.context || {}),
    },
    pillars: {
      unit: {
        ...baseBackendRaw.pillars.unit,
        ...(overrides.pillars?.unit || {}),
      },
      integration: {
        ...baseBackendRaw.pillars.integration,
        ...(overrides.pillars?.integration || {}),
      },
      system: {
        ...baseBackendRaw.pillars.system,
        ...(overrides.pillars?.system || {}),
      },
    },
  };

  return adaptUnifiedDashboard({
    context: mergedRaw.context,
    unifiedBackendRaw: mergedRaw,
  });
}

export function createEnterpriseHealthyVm(adaptUnifiedDashboard, { moduleCount = 12, trendCount = 6 } = {}) {
  const rows = Array.from({ length: moduleCount }, (_, i) => ({
    id: `mod-ent-${i + 1}`,
    moduleName: `Enterprise Domain Service ${i + 1}`,
    unit: { status: "pass", label: "35/35", passed: 35, failed: 0, total: 35 },
    integration: { status: "pass", label: "3/3", passed: 3, failed: 0, total: 3 },
    system: { status: "pass", label: "1/1", passed: 1, failed: 0, total: 1 },
    rootCause: { suspectLayer: "none", summary: "Verified across all 3 layers" },
  }));

  const series = Array.from({ length: trendCount }, (_, i) => ({
    runLabel: `RC-${i + 1}`,
    overallCoverage: Number((80 + i * 2.1).toFixed(1)),
    unitCoverage: Number((84 + i * 1.6).toFixed(1)),
    integrationCoverage: Number((82 + i * 2.4).toFixed(1)),
    systemCoverage: Number((76 + i * 2.2).toFixed(1)),
    passRate: Number((95 + i * 0.9).toFixed(1)),
  }));

  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-ent",
      projectName: "Enterprise Commerce Monorepo",
      branch: "release/v4.2",
      snapshotId: "snap-ent-rc42",
      snapshotLabel: "v4.2.0-rc1",
      updatedAt: "2026-11-26T14:30:00.000Z",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Vitest",
          totalTests: 420,
          passedTests: 420,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 1800,
          avgDurationMs: 1800,
          coverageMetrics: { lines: 92.4, branches: 86.1, functions: 94.0, statements: 92.4 },
          coverageFiles: [
            { filePath: "packages/billing/src/invoice.service.ts", name: "invoice.service.ts", linesPct: 92.4, branchesPct: 86.1, functionsPct: 94.0 },
          ],
          lowCoverageItems: [],
        },
        integration: {
          framework: "Supertest",
          totalTests: 38,
          passedTests: 38,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 4200,
          avgDurationMs: 42,
          avgEndpointLatencyMs: 42,
          coverageMetrics: {
            lines: 88.0,
            branches: 81.5,
            functions: 89.0,
            statements: 88.0,
            apiEndpoint: 95.0,
            coveredApis: 19,
            failedApis: 0,
            uncoveredApis: 1,
            totalApis: 20,
          },
          failureDistribution: { route: 0, middlewareAuth: 0, controller: 0, database: 0 },
        },
        system: {
          framework: "Playwright",
          totalTests: 14,
          passedTests: 14,
          failedTests: 0,
          skippedTests: 0,
          flakyTests: 0,
          durationMs: 24500,
          avgDurationMs: 1750,
          coverageAvailable: true,
          coverageMetrics: { lines: 88.4, flow: 88.4 },
          failureDistribution: { selectorNotFound: 0, networkTimeout: 0, assertion: 0, flaky: 0 },
        },
      },
      ai: { aiGenerated: 14, aiRepaired: 5, gaps: 1 },
      matrix: { rows },
      trend: { series },
      history: {
        runs: [
          { id: "ent-u1", shortId: "ent-u1", type: "unit", status: "pass", passed: 420, failed: 0, coveragePct: 92.4, durationMs: 1800, commitSha: "ent4200" },
          { id: "ent-i1", shortId: "ent-i1", type: "integration", status: "pass", passed: 38, failed: 0, coveragePct: 95.0, durationMs: 4200, commitSha: "ent4200" },
          { id: "ent-s1", shortId: "ent-s1", type: "system", status: "pass", passed: 14, failed: 0, coveragePct: 88.4, durationMs: 24500, commitSha: "ent4200" },
        ],
      },
    },
  });
}

export function createUnitOnlyVm(adaptUnifiedDashboard) {
  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-lib",
      projectName: "Core Math Utility Library",
      branch: "main",
      snapshotId: "snap-lib-01",
      snapshotLabel: "v0.4.0",
      updatedAt: "2026-11-26T09:00:00.000Z",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Vitest",
          totalTests: 64,
          passedTests: 64,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 400,
          avgDurationMs: 400,
          coverageMetrics: { lines: 89.0, branches: 81.5, functions: 91.0, statements: 89.0 },
          coverageFiles: [
            { filePath: "src/math/vector.ts", name: "vector.ts", linesPct: 89.0, branchesPct: 81.5, functionsPct: 91.0 },
          ],
          lowCoverageItems: [
            { filePath: "src/math/vector.ts", name: "vector.ts", linesPct: 89.0, branchesPct: 81.5, functionsPct: 91.0 },
          ],
        },
        integration: {
          framework: "Supertest",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          avgDurationMs: 0,
          coverageMetrics: { lines: 0, branches: 0, functions: 0, statements: 0, apiEndpoint: 0, coveredApis: 0, failedApis: 0, uncoveredApis: 0, totalApis: 0 },
        },
        system: {
          framework: "Playwright",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          flakyTests: 0,
          durationMs: 0,
          avgDurationMs: 0,
          coverageAvailable: false,
          coverageMetrics: { lines: null, flow: null },
        },
      },
      ai: { aiGenerated: 2, aiRepaired: 0, gaps: 0 },
      matrix: {
        rows: [
          {
            id: "mod-vector",
            moduleName: "Vector Math Module",
            unit: { status: "pass", label: "64/64", passed: 64, failed: 0, total: 64 },
            integration: { status: "none", label: "No APIs", passed: 0, failed: 0, total: 0 },
            system: { status: "untested", label: "Not Run", passed: 0, failed: 0, total: 0 },
            rootCause: { suspectLayer: "none", summary: "Unit verified (no APIs)" },
          },
        ],
      },
      trend: {
        series: [
          { runLabel: "Init", overallCoverage: 44.5, unitCoverage: 89.0, integrationCoverage: 0, systemCoverage: null, passRate: 100.0 },
        ],
      },
      history: {
        runs: [
          { id: "lib-u1", shortId: "lib-u1", type: "unit", status: "pass", passed: 64, failed: 0, coveragePct: 89.0, durationMs: 400, commitSha: "lib0001" },
        ],
      },
    },
  });
}

export function createMultiTierIncidentVm(adaptUnifiedDashboard) {
  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-incident",
      projectName: "Checkout Gateway Incident",
      branch: "hotfix/payment-500",
      snapshotId: "snap-inc-999",
      snapshotLabel: "hotfix-999",
      updatedAt: "2026-11-26T16:45:00.000Z",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 52,
          passedTests: 48,
          failedTests: 4,
          skippedTests: 0,
          durationMs: 1120,
          avgDurationMs: 1120,
          coverageMetrics: { lines: 71.0, branches: 62.0, functions: 75.0, statements: 71.0 },
          lowCoverageItems: [
            { filePath: "src/services/payment.service.js", name: "payment.service.js", linesPct: 62.0, branchesPct: 48.0, functionsPct: 70.0 },
          ],
        },
        integration: {
          framework: "Supertest",
          totalTests: 10,
          passedTests: 6,
          failedTests: 4,
          skippedTests: 0,
          durationMs: 3100,
          avgDurationMs: 310,
          avgEndpointLatencyMs: 310,
          coverageMetrics: {
            lines: 65.0,
            branches: 58.0,
            functions: 68.0,
            statements: 65.0,
            apiEndpoint: 50.0,
            coveredApis: 3,
            partialApis: 2,
            failedApis: 3,
            uncoveredApis: 3,
            totalApis: 6,
          },
          failureDistribution: { route: 1, middlewareAuth: 1, controller: 1, database: 1 },
        },
        system: {
          framework: "Playwright",
          totalTests: 5,
          passedTests: 3,
          failedTests: 2,
          skippedTests: 0,
          flakyTests: 1,
          durationMs: 48200,
          avgDurationMs: 9640,
          coverageAvailable: true,
          coverageMetrics: { lines: 60.0, flow: 60.0 },
          failureDistribution: { selectorNotFound: 1, networkTimeout: 1, assertion: 0, flaky: 1 },
        },
      },
      ai: { aiGenerated: 4, aiRepaired: 1, gaps: 8 },
      matrix: {
        rows: [
          {
            id: "mod-catalog",
            moduleName: "Catalog Module",
            unit: { status: "pass", label: "20/20", passed: 20, failed: 0, total: 20 },
            integration: { status: "pass", label: "2/2", passed: 2, failed: 0, total: 2 },
            system: { status: "pass", label: "2/2", passed: 2, failed: 0, total: 2 },
            rootCause: { suspectLayer: "none", summary: "Verified across all 3 layers" },
          },
          {
            id: "mod-payment",
            moduleName: "Payment Checkout Module",
            unit: { status: "fail", label: "10/14", passed: 10, failed: 4, total: 14 },
            integration: { status: "fail", label: "1/4", passed: 1, failed: 3, total: 4 },
            system: { status: "fail", label: "1/3", passed: 1, failed: 2, total: 3 },
            rootCause: { suspectLayer: "unit", summary: "Core service logic defect propagating upward" },
          },
        ],
      },
      trend: {
        series: [
          { runLabel: "#10", overallCoverage: 78.0, unitCoverage: 82.0, integrationCoverage: 75.0, systemCoverage: 72.0, passRate: 92.0 },
          { runLabel: "#11", overallCoverage: 62.5, unitCoverage: 71.0, integrationCoverage: 50.0, systemCoverage: 60.0, passRate: 85.1 },
        ],
      },
      history: {
        runs: [
          { id: "inc-u", shortId: "inc-u", type: "unit", status: "fail", passed: 48, failed: 4, coveragePct: 71.0, durationMs: 1120, commitSha: "hotfix9" },
          { id: "inc-i", shortId: "inc-i", type: "integration", status: "fail", passed: 6, failed: 4, coveragePct: 50.0, durationMs: 3100, commitSha: "hotfix9" },
          { id: "inc-s", shortId: "inc-s", type: "system", status: "fail", passed: 3, failed: 2, coveragePct: 60.0, durationMs: 48200, commitSha: "hotfix9" },
        ],
      },
    },
  });
}

export function createUnrunVm(adaptUnifiedDashboard) {
  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-fresh",
      projectName: "Fresh Unrun Repository",
      branch: "main",
      snapshotId: "snap-fresh-0",
      snapshotLabel: "initial-import",
      updatedAt: "2026-11-26T08:00:00.000Z",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          avgDurationMs: 0,
          coverageMetrics: { lines: 0, branches: 0, functions: 0, statements: 0 },
        },
        integration: {
          framework: "Supertest",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          avgDurationMs: 0,
          coverageMetrics: { lines: 0, branches: 0, functions: 0, statements: 0, apiEndpoint: 0, coveredApis: 0, failedApis: 0, uncoveredApis: 5, totalApis: 5 },
        },
        system: {
          framework: "Playwright",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          flakyTests: 0,
          durationMs: 0,
          avgDurationMs: 0,
          coverageAvailable: false,
          coverageMetrics: { lines: null, flow: null },
        },
      },
      ai: { aiGenerated: 0, aiRepaired: 0, gaps: 5 },
      matrix: { rows: [] },
      trend: { series: [] },
      history: { runs: [] },
    },
  });
}

export function createHighDensity18ModuleVm(adaptUnifiedDashboard) {
  const rows = Array.from({ length: 18 }, (_, i) => {
    const idx = i + 1;
    const isFailing = idx >= 14;
    return {
      id: `mod-hd-${idx}`,
      moduleName: `packages/domain-${idx}/AuthenticationAndAuthorizationGatewayModule${idx}`,
      unit: {
        status: isFailing ? "fail" : "pass",
        label: isFailing ? "9/12" : "12/12",
        passed: isFailing ? 9 : 12,
        failed: isFailing ? 3 : 0,
        total: 12,
      },
      integration: {
        status: isFailing ? "fail" : "pass",
        label: isFailing ? "1/2" : "2/2",
        passed: isFailing ? 1 : 2,
        failed: isFailing ? 1 : 0,
        total: 2,
      },
      system: {
        status: idx === 18 ? "fail" : "pass",
        label: idx === 18 ? "0/1" : "1/1",
        passed: idx === 18 ? 0 : 1,
        failed: idx === 18 ? 1 : 0,
        total: 1,
      },
      rootCause: {
        suspectLayer: isFailing ? "unit" : "none",
        summary: isFailing ? "Core domain failure in downstream gateway" : "Verified across all 3 layers",
      },
    };
  });

  const series = Array.from({ length: 10 }, (_, i) => ({
    runLabel: `R${i + 1}`,
    overallCoverage: Number((70 + i * 1.8).toFixed(1)),
    unitCoverage: Number((78 + i * 1.5).toFixed(1)),
    integrationCoverage: Number((65 + i * 2.0).toFixed(1)),
    systemCoverage: i % 3 === 0 ? null : Number((72 + i * 1.2).toFixed(1)),
    passRate: Number((86 + i * 1.1).toFixed(1)),
  }));

  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-hd",
      projectName: "Global FinTech Monorepo Platform With Extended Portfolio Scope",
      branch: "feature/multi-region-settlement-engine",
      snapshotId: "snap-hd-18",
      snapshotLabel: "v6.0.0-portfolio-stress",
      updatedAt: "2026-11-26T18:00:00.000Z",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Vitest",
          totalTests: 216,
          passedTests: 201,
          failedTests: 15,
          skippedTests: 0,
          durationMs: 3450,
          avgDurationMs: 3450,
          coverageMetrics: { lines: 86.2, branches: 79.4, functions: 88.5, statements: 86.2 },
          lowCoverageItems: [
            { filePath: "packages/billing/src/services/settlementReconciliationEngine.ts", name: "settlementReconciliationEngine.ts", linesPct: 68.0, branchesPct: 54.0, functionsPct: 72.0 },
          ],
        },
        integration: {
          framework: "Supertest",
          totalTests: 36,
          passedTests: 31,
          failedTests: 5,
          skippedTests: 0,
          durationMs: 6800,
          avgDurationMs: 189,
          avgEndpointLatencyMs: 189,
          coverageMetrics: {
            lines: 80.5,
            branches: 74.0,
            functions: 82.0,
            statements: 80.5,
            apiEndpoint: 83.3,
            coveredApis: 15,
            failedApis: 3,
            uncoveredApis: 3,
            totalApis: 18,
          },
          failureDistribution: { route: 1, middlewareAuth: 2, controller: 2, database: 0 },
        },
        system: {
          framework: "Playwright",
          totalTests: 18,
          passedTests: 17,
          failedTests: 1,
          skippedTests: 0,
          flakyTests: 0,
          durationMs: 75000,
          avgDurationMs: 4167,
          coverageAvailable: false,
          coverageMetrics: { lines: null, flow: null },
          failureDistribution: { selectorNotFound: 0, networkTimeout: 1, assertion: 0, flaky: 0 },
        },
      },
      ai: { aiGenerated: 24, aiRepaired: 9, gaps: 6 },
      matrix: { rows },
      trend: { series },
      history: {
        runs: Array.from({ length: 12 }, (_, i) => ({
          id: `hd-run-${i + 1}`,
          shortId: `hd-r${i + 1}`,
          type: i % 3 === 0 ? "unit" : i % 3 === 1 ? "integration" : "system",
          status: i < 2 ? "fail" : "pass",
          passed: 20,
          failed: i < 2 ? 2 : 0,
          coveragePct: 84.0,
          durationMs: 1200 + i * 150,
          commitSha: "fintech9",
        })),
      },
    },
  });
}

/**
 * Installs deterministic DOM / Blob / URL / iframe shims for testing
 * `exportUnifiedDashboardReport` and `exportUnifiedDashboardPdf` under Node.
 */
export async function withBrowserShims(fn) {
  const originals = {
    Blob: Object.getOwnPropertyDescriptor(globalThis, "Blob"),
    URL: Object.getOwnPropertyDescriptor(globalThis, "URL"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  };

  const downloads = [];
  const printedFrames = [];
  const windowListeners = new Map();

  class MockBlob {
    constructor(parts, opts = {}) {
      this.parts = parts;
      this.type = opts.type || "";
      this.content = parts.map((p) => String(p)).join("");
    }
  }

  const fakeUrl = globalThis.URL;
  const origCreate = fakeUrl.createObjectURL;
  const origRevoke = fakeUrl.revokeObjectURL;
  let blobCounter = 0;
  const blobStore = new Map();
  fakeUrl.createObjectURL = (blob) => {
    blobCounter += 1;
    const url = `blob:covai-e2e-${blobCounter}`;
    blobStore.set(url, blob);
    return url;
  };
  fakeUrl.revokeObjectURL = (url) => {
    blobStore.delete(url);
  };

  const makeMockElement = (tagName) => {
    const el = {
      tagName: String(tagName || "div").toUpperCase(),
      style: {},
      attributes: {},
      children: [],
      parentNode: null,
      setAttribute(k, v) {
        this.attributes[k] = String(v);
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((c) => c !== child);
        child.parentNode = null;
        return child;
      },
      click() {
        if (this.tagName === "A") {
          const blob = blobStore.get(this.href);
          downloads.push({
            filename: this.download,
            mimeType: blob?.type || "",
            content: blob?.content || "",
          });
        }
      },
    };
    if (el.tagName === "IFRAME") {
      const frameListeners = new Map();
      let writtenHtml = "";
      const frameWin = {
        printCalls: 0,
        focusCalls: 0,
        requestAnimationFrame: (cb) => cb(),
        addEventListener(evt, handler) {
          const list = frameListeners.get(evt) || [];
          list.push(handler);
          frameListeners.set(evt, list);
        },
        removeEventListener(evt, handler) {
          const list = frameListeners.get(evt) || [];
          frameListeners.set(evt, list.filter((h) => h !== handler));
        },
        dispatchEvent(evtName) {
          for (const h of frameListeners.get(evtName) || []) {
            h();
          }
        },
        focus() {
          this.focusCalls += 1;
        },
        print() {
          this.printCalls += 1;
        },
        document: {
          fonts: { ready: Promise.resolve() },
          open() {
            writtenHtml = "";
          },
          write(str) {
            writtenHtml += String(str);
          },
          close() {},
          getWrittenHtml() {
            return writtenHtml;
          },
        },
      };
      el.contentWindow = frameWin;
      printedFrames.push(el);
    }
    return el;
  };

  const mockBody = makeMockElement("BODY");
  globalThis.Blob = MockBlob;
  globalThis.document = {
    body: mockBody,
    createElement: (tag) => makeMockElement(tag),
  };
  globalThis.window = {
    addEventListener(evt, handler) {
      const list = windowListeners.get(evt) || [];
      list.push(handler);
      windowListeners.set(evt, list);
    },
    removeEventListener(evt, handler) {
      const list = windowListeners.get(evt) || [];
      windowListeners.set(evt, list.filter((h) => h !== handler));
    },
    dispatchEvent(evtName) {
      for (const h of windowListeners.get(evtName) || []) {
        h();
      }
    },
  };

  try {
    return await fn({ downloads, printedFrames, mockBody });
  } finally {
    fakeUrl.createObjectURL = origCreate;
    fakeUrl.revokeObjectURL = origRevoke;
    for (const key of ["Blob", "document", "window"]) {
      if (originals[key]) {
        Object.defineProperty(globalThis, key, originals[key]);
      } else {
        delete globalThis[key];
      }
    }
  }
}
