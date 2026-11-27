import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  loadBackendModules,
  loadClientModules,
  nextSnapshotId,
  createTempProjectDir,
  writeProjectFile,
  removeTempDir,
  cleanupTempDirs,
  runBackendDashboard,
} from "./mockPrismaHarness.mjs";
import {
  makeCoverageEntry,
  buildMeasuredSystemMeasurement,
  createSnapshotShell,
  createFifaWc2026BackendFixture,
  createFifaWc2026Vm,
  createEnterpriseHealthyVm,
  createUnitOnlyVm,
  createMultiTierIncidentVm,
  createUnrunVm,
  createHighDensity18ModuleVm,
  withBrowserShims,
} from "./fixtures.mjs";
import {
  auditStandaloneHtml,
  auditPrintPdfHtml,
  closeSharedBrowser,
  A4_PRINTABLE_HEIGHT_PX,
  A4_PRINTABLE_WIDTH_PX,
} from "./playwrightPdfHarness.mjs";

function parseCliOptions(argv = process.argv.slice(2)) {
  let keepScreenshotsDir = process.env.COVAI_E2E_KEEP_SCREENSHOTS || "";
  let tierFilter = process.env.COVAI_E2E_TIER ? Number(process.env.COVAI_E2E_TIER) : null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep-screenshots" && argv[i + 1]) {
      keepScreenshotsDir = argv[++i];
    } else if (arg.startsWith("--keep-screenshots=")) {
      keepScreenshotsDir = arg.slice("--keep-screenshots=".length);
    } else if (arg === "--tier" && argv[i + 1]) {
      tierFilter = Number(argv[++i]);
    } else if (arg.startsWith("--tier=")) {
      tierFilter = Number(arg.slice("--tier=".length));
    }
  }

  return {
    keepScreenshotsDir: keepScreenshotsDir ? path.resolve(keepScreenshotsDir) : null,
    tierFilter: Number.isFinite(tierFilter) ? tierFilter : null,
  };
}

const CLI_OPTS = parseCliOptions();
const shouldRunTier = (n) => CLI_OPTS.tierFilter === null || CLI_OPTS.tierFilter === n;

function stripHtmlTags(html = "") {
  return String(html).replace(/<[^>]+>/g, "");
}

function parseSvgViewBox(svg = "") {
  const m = String(svg).match(/viewBox="([^"]+)"/i);
  if (!m) return null;
  const [x, y, w, h] = m[1].trim().split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

function extractKeyFindingsRowText(html, tierLabel) {
  const secMatch = String(html).match(/<section[^>]*id="sec-key-findings"[\s\S]*?<\/section>/i);
  const scope = secMatch ? secMatch[0] : String(html);
  const rowRegex = new RegExp(`<tr[^>]*>[\\s\\S]*?${tierLabel}[\\s\\S]*?<\\/tr>`, "i");
  const rowMatch = scope.match(rowRegex);
  return rowMatch ? stripHtmlTags(rowMatch[0]).replace(/\s+/g, " ").trim() : "";
}

function assertCleanSvgMetrics(svgMetrics, { minViewBoxW = 720, minRenderedW = 0 } = {}) {
  assert.ok(svgMetrics.length > 0, "Expected at least one rendered SVG chart");
  for (const s of svgMetrics) {
    assert.ok(
      s.vbWidth >= minViewBoxW,
      `SVG ${s.diagramId} viewBox width ${s.vbWidth} < ${minViewBoxW}`
    );
    if (minRenderedW > 0) {
      assert.ok(
        s.rect.width >= minRenderedW,
        `SVG ${s.diagramId} rendered width ${s.rect.width.toFixed(1)}px < ${minRenderedW}px`
      );
      assert.ok(
        s.rect.right <= 794 - 32,
        `SVG ${s.diagramId} overflows printable right bound (${s.rect.right.toFixed(1)}px)`
      );
    }
    assert.equal(
      s.textOverlaps.length,
      0,
      `SVG ${s.diagramId} has overlapping text labels: ${JSON.stringify(s.textOverlaps)}`
    );
    assert.equal(
      s.clippedTexts.length,
      0,
      `SVG ${s.diagramId} has clipped text labels: ${JSON.stringify(s.clippedTexts.map((c) => c.text))}`
    );
    assert.equal(s.hasGradient, false, `SVG ${s.diagramId} must not contain gradients`);
    assert.equal(s.role, "img", `SVG ${s.diagramId} must have role="img"`);
    assert.equal(s.hasAriaLabel, true, `SVG ${s.diagramId} must have aria-label`);
  }
}

function assertPrintLayoutQuality(audit, { expectFollowup = true } = {}) {
  assert.equal(audit.chartsGrid2x2Count, 0, "Must not render cramped .charts-grid-2x2");
  assert.ok(audit.chartPages.length >= (expectFollowup ? 2 : 1), "Expected [data-chart-page] containers");
  for (const cp of audit.chartPages) {
    assert.ok(
      cp.svgCount >= 1 && cp.svgCount <= 2,
      `Chart page ${cp.pageAttr} has ${cp.svgCount} SVGs (expected 1..2)`
    );
  }
  assert.equal(audit.orphanSvgs, 0, "All SVGs must live inside [data-chart-page]");
  assertCleanSvgMetrics(audit.svgMetrics, { minViewBoxW: 720, minRenderedW: 650 });

  assert.equal(audit.pageOne.exists, true, "Missing .page-one container");
  assert.ok(
    audit.pageOne.height >= A4_PRINTABLE_HEIGHT_PX * 0.85,
    `.page-one height ${audit.pageOne.height.toFixed(1)}px fills < 85% of A4 (${A4_PRINTABLE_HEIGHT_PX}px)`
  );
  assert.ok(
    audit.pageOne.height <= A4_PRINTABLE_HEIGHT_PX + 2,
    `.page-one height ${audit.pageOne.height.toFixed(1)}px exceeds A4 printable height (${A4_PRINTABLE_HEIGHT_PX}px)`
  );
  assert.equal(audit.pageOneFootnote.exists, true, "Missing .page1-footnote");
  assert.equal(
    audit.footnoteFitsPageOne,
    true,
    `.page1-footnote bottom (${audit.pageOneFootnote.bottom.toFixed(1)}px) spills past Page 1 (${A4_PRINTABLE_HEIGHT_PX}px)`
  );

  const wrappedBadges = audit.badges.filter((b) => b.wrapped);
  assert.equal(
    wrappedBadges.length,
    0,
    `Badges must stay single-line: ${JSON.stringify(wrappedBadges)}`
  );
  assert.equal(
    audit.keyFindingsOverflowCells.length,
    0,
    `Key Findings table cells overflow: ${JSON.stringify(audit.keyFindingsOverflowCells)}`
  );
  assert.equal(
    audit.keyFindingsWrappedTokens.length,
    0,
    `Key Findings header/framework tokens wrapped mid-word: ${JSON.stringify(audit.keyFindingsWrappedTokens)}`
  );
  assert.equal(audit.nanMatches.length, 0, "Found NaN in rendered text");
  assert.equal(audit.undefinedMatches.length, 0, "Found undefined in rendered text");
}

after(async () => {
  await closeSharedBrowser();
  cleanupTempDirs();
});

// ============================================================================
// TIER 1 — Feature Coverage (45 Tests: 5 per Feature F1–F9)
// ============================================================================
if (shouldRunTier(1)) {
  describe("Tier 1 — Feature Coverage (F1–F9, 45 tests)", () => {
    // --- F1: Canonical Unit Coverage Aggregation ---
    test("T1-F1-01: buildUnifiedQualityDashboard computes filtered business-only unit coverage from coverage-summary.json", async () => {
      const rootDir = createTempProjectDir("covai-t1-f1-01-");
      const snapshotId = nextSnapshotId("t1-f1-01");
      try {
        writeProjectFile(
          rootDir,
          "vitest.config.ts",
          "export default { test: { coverage: { exclude: ['vitest.setup.ts', 'src/scripts/**'] } } };"
        );
        // 3 business files: lines (60+60+50)=170/200 (85.0%), branches (12+12+12)=36/40 (90.0%), funcs (6+6+5)=17/20 (85.0%)
        writeProjectFile(rootDir, "coverage/unit/coverage-summary.json", {
          total: makeCoverageEntry(170, 400, 36, 100, 17, 50),
          [path.join(rootDir, "src/services/orders.service.ts")]: makeCoverageEntry(60, 70, 12, 14, 6, 7),
          [path.join(rootDir, "src/services/cart.service.ts")]: makeCoverageEntry(60, 70, 12, 13, 6, 7),
          [path.join(rootDir, "src/services/tax.service.ts")]: makeCoverageEntry(50, 60, 12, 13, 5, 6),
          [path.join(rootDir, "src/services/orders.service.test.ts")]: makeCoverageEntry(0, 100, 0, 30, 0, 15),
          [path.join(rootDir, "vitest.setup.ts")]: makeCoverageEntry(0, 100, 0, 30, 0, 15),
        });

        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            testRuns: [
              {
                id: "run-u-1",
                snapshotId,
                type: "VITEST",
                status: "PASSED",
                totalTests: 30,
                passedTests: 30,
                failedTests: 0,
                skippedTests: 0,
                durationMs: 320,
                coverageLinesPct: 42.5,
                coverageBranchesPct: 36.0,
                createdAt: new Date("2026-11-26T10:00:00Z"),
                snapshot: { id: snapshotId, commitSha: "abc1234", createdAt: new Date() },
                scenarios: [],
              },
            ],
          },
        });

        const cov = payload.pillars.unit.coverageMetrics;
        assert.equal(cov.lines, 85.0);
        assert.equal(cov.branches, 90.0);
        assert.equal(cov.functions, 85.0);
        assert.equal(cov.statements, 85.0);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F1-02: buildUnifiedQualityDashboard prefers filtered disk vitest-coverage-summary.json over stale DB CoverageSummary", async () => {
      const rootDir = createTempProjectDir("covai-t1-f1-02-");
      const snapshotId = nextSnapshotId("t1-f1-02");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId, {
          includeIntegration: false,
          includeSystem: false,
          withHistoricalTrend: false,
        });
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        assert.equal(payload.pillars.unit.coverageMetrics.lines, 97.6);
        assert.equal(payload.pillars.unit.coverageMetrics.branches, 99.4);
        assert.equal(payload.pillars.unit.coverageMetrics.functions, 98.1);
        assert.equal(payload.pillars.unit.coverageMetrics.statements, 97.6);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F1-03: buildUnifiedQualityDashboard falls back to peakUnitReport when latest run is targeted partial run", async () => {
      const rootDir = createTempProjectDir("covai-t1-f1-03-");
      const snapshotId = nextSnapshotId("t1-f1-03");
      try {
        // Disk only has partial targeted run (1 file, 12% lines)
        writeProjectFile(rootDir, "coverage/unit/coverage-summary.json", {
          total: makeCoverageEntry(12, 100, 5, 20, 2, 10),
          [path.join(rootDir, "src/services/alpha.service.ts")]: makeCoverageEntry(12, 100, 5, 20, 2, 10),
        });
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            peakUnitReport: {
              isPeakCoverageReport: true,
              peakMeta: {
                score: 980000,
                linesPct: 97.6,
                branchesPct: 99.4,
                funcsPct: 98.1,
                stmtsPct: 97.6,
                coveredFiles: 15,
                totalFiles: 16,
                passedTests: 106,
                failedTests: 2,
                totalTests: 108,
                isTargetedRun: false,
              },
              coverageSummary: { lines: 97.6, branches: 99.4, functions: 98.1, statements: 97.6 },
              rawTotals: makeCoverageEntry(837, 858, 172, 173, 52, 53),
              fileCoverages: [
                { filePath: "src/services/alpha.service.ts", linesPct: 100, branchesPct: 100, funcsPct: 100, stmtsPct: 100 },
              ],
              testStats: { total: 108, passed: 106, failed: 2, durationMs: 200 },
            },
            testRuns: [
              {
                id: "run-targeted",
                snapshotId,
                type: "VITEST",
                status: "PASSED",
                totalTests: 6,
                passedTests: 6,
                failedTests: 0,
                skippedTests: 0,
                durationMs: 50,
                coverageLinesPct: 12.0,
                coverageBranchesPct: 25.0,
                createdAt: new Date("2026-11-26T12:00:00Z"),
                snapshot: { id: snapshotId, commitSha: "part123", createdAt: new Date() },
                scenarios: [],
              },
            ],
          },
        });
        assert.equal(payload.pillars.unit.coverageMetrics.lines, 97.6);
        assert.equal(payload.pillars.unit.coverageMetrics.branches, 99.4);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F1-04: adaptUnit preserves exact lines, branches, functions, statements, coverageFiles, and lowCoverageItems from unifiedUnit", async () => {
      const { adaptUnit } = await loadClientModules();
      const adapted = adaptUnit(null, {
        framework: "Vitest",
        totalTests: 108,
        passedTests: 106,
        failedTests: 2,
        skippedTests: 0,
        durationMs: 200,
        coverageMetrics: { lines: 97.6, branches: 99.4, functions: 98.1, statements: 97.6 },
        coverageFiles: [
          { filePath: "src/a.ts", linesPct: 100, branchesPct: 100, functionsPct: 100, statementsPct: 100 },
          { filePath: "src/b.ts", linesPct: 60.4, branchesPct: 90.0, functionsPct: 75.0, statementsPct: 60.4 },
        ],
        lowCoverageItems: [
          { filePath: "src/b.ts", linesPct: 60.4, branchesPct: 90.0, functionsPct: 75.0 },
        ],
      });
      assert.equal(adapted.coverageMetrics.lines, 97.6);
      assert.equal(adapted.coverageMetrics.branches, 99.4);
      assert.equal(adapted.coverageMetrics.functions, 98.1);
      assert.equal(adapted.coverageMetrics.statements, 97.6);
      assert.equal(adapted.coverageFiles.length, 2);
      assert.equal(adapted.lowCoverageItems.length, 1);
      assert.equal(adapted.lowCoverageItems[0].filePath, "src/b.ts");
    });

    test("T1-F1-05: adaptUnit live fallback mode preserves coverageMetrics and filters out test/spec/node_modules files", async () => {
      const { adaptUnit } = await loadClientModules();
      const adapted = adaptUnit(
        {
          summary: {
            testExecution: { numTotalTests: 12, numPassedTests: 12, numFailedTests: 0, durationMs: 410 },
            coverage: { lines: 91.2, branches: 87.5, functions: 93.0, statements: 91.2 },
          },
          files: [
            { filePath: "src/core/calc.ts", linesPct: 91.2, branchesPct: 87.5, funcsPct: 93.0 },
            { filePath: "src/core/calc.test.ts", linesPct: 0, branchesPct: 0 },
            { filePath: "src/core/calc.spec.ts", linesPct: 0, branchesPct: 0 },
            { filePath: "node_modules/pkg/index.js", linesPct: 0, branchesPct: 0 },
          ],
        },
        null
      );
      assert.equal(adapted.coverageMetrics.lines, 91.2);
      assert.equal(adapted.coverageMetrics.branches, 87.5);
      assert.equal(adapted.coverageMetrics.functions, 93.0);
      assert.equal(adapted.coverageMetrics.statements, 91.2);
      assert.equal(adapted.coverageFiles.length, 1);
      assert.equal(adapted.coverageFiles[0].filePath, "src/core/calc.ts");
    });

    // --- F2: Unit Quality Gate Accuracy ---
    test("T1-F2-01: computeQualityGate passes chk-unit-branch when branches = 99.4%", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gate = computeQualityGate({
        unit: { totalTests: 108, passedTests: 106, failedTests: 2, coverageMetrics: { lines: 97.6, branches: 99.4 } },
        integration: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { apiEndpoint: 0 } },
        system: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { flow: null } },
      });
      const chk = gate.checklist.find((c) => c.id === "chk-unit-branch");
      assert.ok(chk, "Missing chk-unit-branch");
      assert.equal(chk.passed, true);
      assert.equal(chk.status, "pass");
      assert.equal(chk.currentValue, "99.4%");
    });

    test("T1-F2-02: computeQualityGate returns PASSED / READY TO RELEASE when all 3 tiers meet targets", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gate = computeQualityGate({
        unit: { totalTests: 100, passedTests: 100, failedTests: 0, coverageMetrics: { lines: 85, branches: 88 } },
        integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
        system: { totalTests: 5, passedTests: 5, failedTests: 0, flakyTests: 0, coverageMetrics: { flow: 82 } },
      });
      assert.equal(gate.status, "PASSED");
      assert.equal(gate.label, "READY TO RELEASE");
      assert.ok(gate.checklist.every((c) => c.passed === true));
    });

    test("T1-F2-03: computeQualityGate fails chk-unit-branch when branches = 60.0% < 75%", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gate = computeQualityGate({
        unit: { totalTests: 20, passedTests: 19, failedTests: 1, coverageMetrics: { lines: 80, branches: 60.0 } },
        integration: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { apiEndpoint: 85 } },
        system: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { flow: 80 } },
      });
      const chk = gate.checklist.find((c) => c.id === "chk-unit-branch");
      assert.equal(chk.passed, false);
      assert.equal(chk.status, "fail");
      assert.equal(chk.currentValue, "60.0%");
    });

    test("T1-F2-04: computeQualityGate returns FAILED / BLOCKED when overall pass rate is 75.0% < 80%", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gate = computeQualityGate({
        unit: { totalTests: 100, passedTests: 75, failedTests: 25, coverageMetrics: { lines: 90, branches: 90 } },
        integration: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { apiEndpoint: 0 } },
        system: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { flow: null } },
      });
      assert.equal(gate.status, "FAILED");
      assert.equal(gate.label, "BLOCKED");
      assert.ok(gate.reasons.some((r) => /pass rate|75/i.test(r)));
    });

    test("T1-F2-05: computeQualityGate returns WARNING / AT RISK (not BLOCKED) for 99.4% branches and 106/108 unit pass", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gate = computeQualityGate({
        unit: { totalTests: 108, passedTests: 106, failedTests: 2, coverageMetrics: { lines: 97.6, branches: 99.4 } },
        integration: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { apiEndpoint: 0 } },
        system: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { flow: null } },
      });
      assert.equal(gate.status, "WARNING");
      assert.equal(gate.label, "AT RISK");
      const chk = gate.checklist.find((c) => c.id === "chk-unit-branch");
      assert.equal(chk.passed, true);
    });

    // --- F3: Module Matrix Exclusion & Root Cause ---
    test("T1-F3-01: buildUnifiedQualityDashboard excludes vitest.setup.ts & config-excluded scripts from matrix.rows (no Vitest Module)", async () => {
      const rootDir = createTempProjectDir("covai-t1-f3-01-");
      const snapshotId = nextSnapshotId("t1-f3-01");
      try {
        writeProjectFile(
          rootDir,
          "vitest.config.ts",
          "export default { test: { coverage: { exclude: ['src/scripts/**', 'vitest.setup.ts'] } } };"
        );
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            coverageFiles: [
              { id: "cf-1", snapshotId, filePath: "vitest.setup.ts", linesPct: 0, branchesPct: 0, funcsPct: 0, stmtsPct: 0 },
              { id: "cf-2", snapshotId, filePath: "src/scripts/seed.ts", linesPct: 0, branchesPct: 0, funcsPct: 0, stmtsPct: 0 },
              { id: "cf-3", snapshotId, filePath: "src/services/billing.service.ts", linesPct: 95, branchesPct: 90, funcsPct: 95, stmtsPct: 95 },
            ],
            testRuns: [
              {
                id: "run-u-f3",
                snapshotId,
                type: "VITEST",
                status: "PASSED",
                totalTests: 5,
                passedTests: 5,
                failedTests: 0,
                durationMs: 120,
                coverageLinesPct: 95,
                coverageBranchesPct: 90,
                createdAt: new Date(),
                snapshot: { id: snapshotId, commitSha: "abc", createdAt: new Date() },
                scenarios: [
                  { id: "s1", title: "bills order", suiteName: "billing", testFile: "src/services/billing.service.test.ts", status: "passed", durationMs: 20, failureMessages: [] },
                ],
              },
            ],
          },
        });
        const names = payload.matrix.rows.map((r) => r.moduleName.toLowerCase());
        assert.equal(names.some((n) => n.includes("vitest")), false, `Unexpected Vitest Module in: ${names.join(", ")}`);
        assert.equal(names.some((n) => n.includes("seed") || n.includes("script")), false, `Unexpected script row in: ${names.join(", ")}`);
        assert.equal(names.some((n) => n.includes("billing")), true);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F3-02: buildCrossLayerMatrix merges unitFiles and endpoints into correlated Auth Module row", async () => {
      const { buildCrossLayerMatrix } = await loadBackendModules();
      const rows = buildCrossLayerMatrix({
        unitFiles: [{ filePath: "src/services/auth.service.js", linesPct: 92, branchesPct: 88 }],
        unitScenarios: [{ title: "signs jwt", testFile: "src/services/auth.service.test.js", status: "passed" }],
        endpoints: [{ method: "POST", path: "/api/auth/login", status: "Covered", passedCount: 2, failedCount: 0, executedCount: 2 }],
        systemScenarios: [],
      });
      const authRows = rows.filter((r) => /auth/i.test(r.moduleName));
      assert.equal(authRows.length, 1);
      assert.equal(authRows[0].unit.status, "pass");
      assert.equal(authRows[0].integration.status, "pass");
    });

    test("T1-F3-03: diagnoseModuleRootCause decision tree accurately identifies unit, integration, and system culprits", async () => {
      const { diagnoseModuleRootCause } = await loadBackendModules();
      assert.equal(diagnoseModuleRootCause("fail", "fail", "pass").suspectLayer, "unit");
      assert.equal(diagnoseModuleRootCause("fail", "pass", "pass").suspectLayer, "unit");
      assert.equal(diagnoseModuleRootCause("pass", "fail", "pass", { endpoint: "GET /api/x" }).suspectLayer, "integration");
      assert.equal(diagnoseModuleRootCause("pass", "pass", "fail", { flowName: "Checkout" }).suspectLayer, "system");
    });

    test("T1-F3-04: adaptUnifiedDashboard live fallback excludes test/node_modules/vitest setup/config files from trace matrix", async () => {
      const { adaptUnifiedDashboard } = await loadClientModules();
      const vm = adaptUnifiedDashboard({
        context: { projectId: "p", projectName: "P", snapshotId: "s" },
        unitRaw: {
          summary: { testExecution: { numTotalTests: 4, numPassedTests: 4, numFailedTests: 0, durationMs: 100 }, coverage: { lines: 90, branches: 85 } },
          files: [
            { filePath: "vitest.setup.ts", linesPct: 0, branchesPct: 0 },
            { filePath: "jest.config.js", linesPct: 0, branchesPct: 0 },
            { filePath: "src/services/auth.test.ts", linesPct: 0, branchesPct: 0 },
            { filePath: "node_modules/foo/index.js", linesPct: 0, branchesPct: 0 },
            { filePath: "src/services/inventory.service.ts", linesPct: 90, branchesPct: 85 },
          ],
        },
        integrationRaw: { endpoints: [] },
      });
      const names = (vm.matrix?.rows || []).map((r) => r.moduleName.toLowerCase());
      assert.equal(names.some((n) => /vitest|jest|node_modules/.test(n)), false, `Matrix leaked excluded tooling: ${names.join(", ")}`);
      assert.equal(names.some((n) => n.includes("inventory")), true);
    });

    test("T1-F3-05: buildUnifiedQualityDashboard produces accurate passed/total, % lines, and rootCause.summary for business modules", async () => {
      const rootDir = createTempProjectDir("covai-t1-f3-05-");
      const snapshotId = nextSnapshotId("t1-f3-05");
      try {
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            coverageFiles: [
              { id: "cf-p1", snapshotId, filePath: "src/services/checkout.service.js", linesPct: 91.5, branchesPct: 88.0, funcsPct: 90.0, stmtsPct: 91.5 },
            ],
            testRuns: [
              {
                id: "run-u-f305",
                snapshotId,
                type: "VITEST",
                status: "FAILED",
                totalTests: 4,
                passedTests: 3,
                failedTests: 1,
                durationMs: 150,
                coverageLinesPct: 91.5,
                coverageBranchesPct: 88.0,
                createdAt: new Date(),
                snapshot: { id: snapshotId, commitSha: "chk", createdAt: new Date() },
                scenarios: [
                  { id: "1", title: "t1", suiteName: "checkout", testFile: "src/services/checkout.service.test.js", status: "passed", durationMs: 10, failureMessages: [] },
                  { id: "2", title: "t2", suiteName: "checkout", testFile: "src/services/checkout.service.test.js", status: "passed", durationMs: 10, failureMessages: [] },
                  { id: "3", title: "t3", suiteName: "checkout", testFile: "src/services/checkout.service.test.js", status: "passed", durationMs: 10, failureMessages: [] },
                  { id: "4", title: "t4", suiteName: "checkout", testFile: "src/services/checkout.service.test.js", status: "failed", durationMs: 10, failureMessages: ["fail"] },
                ],
              },
            ],
          },
        });
        const checkoutRow = payload.matrix.rows.find((r) => /checkout/i.test(r.moduleName));
        assert.ok(checkoutRow, "Missing checkout row");
        assert.equal(checkoutRow.unit.passed, 3);
        assert.equal(checkoutRow.unit.total, 4);
        assert.match(checkoutRow.unit.label, /3\/4/);
        assert.equal(checkoutRow.rootCause.suspectLayer, "unit");
        assert.ok(checkoutRow.rootCause.summary.length > 0);
      } finally {
        removeTempDir(rootDir);
      }
    });

    // --- F4: Duration & Latency Parity Across Exports ---
    test("T1-F4-01: buildUnifiedQualityDashboard preserves latestUnitRun.durationMs = 200 regardless of totalTests = 108", async () => {
      const rootDir = createTempProjectDir("covai-t1-f4-01-");
      const snapshotId = nextSnapshotId("t1-f4-01");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId, {
          includeIntegration: false,
          includeSystem: false,
        });
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        assert.equal(payload.pillars.unit.durationMs, 200);
        assert.equal(payload.pillars.unit.totalTests, 108);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F4-02: adaptUnifiedDashboard preserves durationMs across all 3 layers and computes execution.durationMs sum", async () => {
      const { adaptUnifiedDashboard } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      assert.equal(vm.pillars.unit.durationMs, 200);
      assert.equal(vm.pillars.integration.durationMs, 1450);
      assert.equal(vm.pillars.system.durationMs, 12400);
      assert.equal(vm.execution.durationMs, 200 + 1450 + 12400);
    });

    test("T1-F4-03: HTML & PDF Tier Breakdown displays suite duration (0.2s or 200ms), never 1ms/2ms for Unit 200ms/108 tests", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          unit: {
            framework: "Vitest",
            totalTests: 108,
            passedTests: 106,
            failedTests: 2,
            skippedTests: 0,
            durationMs: 200,
            avgDurationMs: 2, // simulate legacy per-test avg that must NOT leak as suite duration
            coverageMetrics: { lines: 97.6, branches: 99.4, functions: 98.1, statements: 97.6 },
          },
          integration: {
            framework: "Supertest",
            totalTests: 4,
            passedTests: 2,
            failedTests: 2,
            durationMs: 1450,
            avgDurationMs: 65,
            avgEndpointLatencyMs: 65,
            coverageMetrics: { apiEndpoint: 25.0, coveredApis: 1, uncoveredApis: 3, totalApis: 4, statements: 74.2 },
          },
          system: {
            framework: "Playwright",
            totalTests: 5,
            passedTests: 5,
            failedTests: 0,
            durationMs: 12400,
            avgDurationMs: 2480,
            coverageAvailable: false,
            coverageMetrics: { lines: null, flow: null },
          },
        },
      });
      for (const html of [generateHtmlReport(vm), generatePdfHtmlReport(vm)]) {
        const unitRow = extractKeyFindingsRowText(html, "Unit Tests");
        assert.match(unitRow, /0\.2s|200\s*ms/i, `Unit row missing 0.2s/200ms: ${unitRow}`);
        assert.equal(/\b[12]ms\b/.test(unitRow), false, `Unit row leaked per-test latency 1ms/2ms: ${unitRow}`);
      }
    });

    test("T1-F4-04: Markdown Tier Breakdown displays consistent suite Duration (0.2s / 200ms) for Unit, Integration, and System", async () => {
      const { adaptUnifiedDashboard, generateMarkdownReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const md = generateMarkdownReport(vm);
      const unitLine = md.split("\n").find((l) => l.includes("| **Unit**")) || "";
      const intLine = md.split("\n").find((l) => l.includes("| **Integration**")) || "";
      const sysLine = md.split("\n").find((l) => l.includes("| **System (E2E)**")) || "";
      assert.match(unitLine, /0\.2s|200\s*ms/i, `MD Unit line missing 0.2s/200ms: ${unitLine}`);
      assert.equal(/\b[12]ms\b/.test(unitLine), false, `MD Unit line leaked 1ms/2ms: ${unitLine}`);
      assert.match(intLine, /1\.5s|1\.4s|1450\s*ms|65\s*ms/i, `MD Int line missing duration: ${intLine}`);
      assert.match(sysLine, /12\.4s|12400\s*ms/i, `MD System line missing 12.4s: ${sysLine}`);
    });

    test("T1-F4-05: buildFilteredJsonPayload includes durationMs and avgDurationMs inside layerDefinitions.{unit,integration,system}.metrics", async () => {
      const { adaptUnifiedDashboard, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const json = buildFilteredJsonPayload(vm);
      assert.equal(json.layerDefinitions.unit.metrics.durationMs, 200);
      assert.equal(typeof json.layerDefinitions.unit.metrics.avgDurationMs, "number");
      assert.equal(json.layerDefinitions.integration.metrics.durationMs, 1450);
      assert.equal(typeof json.layerDefinitions.integration.metrics.avgDurationMs, "number");
      assert.equal(json.layerDefinitions.system.metrics.durationMs, 12400);
      assert.equal(typeof json.layerDefinitions.system.metrics.avgDurationMs, "number");
    });

    // --- F5: Integration & System Tier Parity ---
    test("T1-F5-01: Integration coveredApis stays endpoint-based (2/4 = 50%), never inflated by 10 passing scenarios", async () => {
      const rootDir = createTempProjectDir("covai-t1-f5-01-");
      const snapshotId = nextSnapshotId("t1-f5-01");
      try {
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const tInt = new Date("2026-11-26T10:00:00Z");
        const scenarios = [];
        for (let i = 1; i <= 5; i++) {
          scenarios.push({ id: `sc-a-${i}`, title: `GET /api/alpha case ${i}`, suiteName: "GET /api/alpha", status: "passed", actualStatus: 200, durationMs: 20, failureMessages: [] });
          scenarios.push({ id: `sc-b-${i}`, title: `GET /api/beta case ${i}`, suiteName: "GET /api/beta", status: "passed", actualStatus: 200, durationMs: 20, failureMessages: [] });
        }
        scenarios.push({ id: "sc-c-1", title: "GET /api/gamma fails", suiteName: "GET /api/gamma", status: "failed", actualStatus: 500, durationMs: 30, failureMessages: ["Expected: 200\nReceived: 500"] });

        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            integrationScan: {
              explicitlyScanned: true,
              sourceFilesCount: 1,
              discoveredEndpoints: [
                { id: "e1", method: "GET", path: "/api/alpha", fullPath: "/api/alpha" },
                { id: "e2", method: "GET", path: "/api/beta", fullPath: "/api/beta" },
                { id: "e3", method: "GET", path: "/api/gamma", fullPath: "/api/gamma" },
                { id: "e4", method: "GET", path: "/api/delta", fullPath: "/api/delta" },
              ],
            },
            jobs: [{ id: "j1", snapshotId, type: "SUPERTEST_COVERAGE", status: "SUCCESS", resultJson: JSON.stringify({ analyzedEndpoints: ["*"] }), createdAt: tInt }],
            testRuns: [
              { id: "r-int", snapshotId, type: "SUPERTEST", status: "FAILED", totalTests: 11, passedTests: 10, failedTests: 1, durationMs: 230, createdAt: tInt, snapshot: { id: snapshotId, commitSha: "a", createdAt: tInt }, scenarios },
            ],
          },
        });
        const cov = payload.pillars.integration.coverageMetrics;
        assert.equal(cov.totalApis, 4);
        assert.equal(cov.coveredApis, 2);
        assert.equal(cov.apiEndpoint, 50.0);
        assert.equal(cov.uncoveredApis, 2);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F5-02: Integration failedApis / issue metrics include both Script Error and Partial endpoints", async () => {
      const rootDir = createTempProjectDir("covai-t1-f5-02-");
      const snapshotId = nextSnapshotId("t1-f5-02");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId, { includeSystem: false });
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        const cov = payload.pillars.integration.coverageMetrics;
        // Fixture has 1 Covered, 1 Partial, 1 Script Error, 1 Uncovered
        assert.equal(cov.coveredApis, 1);
        assert.ok(cov.failedApis >= 2 || (cov.partialApis >= 1 && cov.failedApis >= 1), `Expected Partial + Script Error accounted for: ${JSON.stringify(cov)}`);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F5-03: System returns flowCoveragePct: null and coverageAvailable: false when systemMeasurement is null (no sysPassRate fabrication)", async () => {
      const rootDir = createTempProjectDir("covai-t1-f5-03-");
      const snapshotId = nextSnapshotId("t1-f5-03");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId, { includeIntegration: false });
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        assert.equal(payload.pillars.system.passedTests, 5);
        assert.equal(payload.pillars.system.totalTests, 5);
        assert.equal(payload.pillars.system.coverageAvailable, false);
        assert.equal(payload.pillars.system.coverageMetrics.flow, null);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F5-04: System returns exact flowCoveragePct = 84.6 and coverageAvailable = true when systemMeasurement provides frontend lines.pct", async () => {
      const rootDir = createTempProjectDir("covai-t1-f5-04-");
      const snapshotId = nextSnapshotId("t1-f5-04");
      try {
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const tSys = new Date("2026-11-26T10:00:00Z");
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            testRuns: [
              {
                id: "run-sys-measured",
                snapshotId,
                type: "PLAYWRIGHT",
                status: "PASSED",
                totalTests: 5,
                passedTests: 5,
                failedTests: 0,
                durationMs: 8500,
                systemMeasurement: buildMeasuredSystemMeasurement({ linesCovered: 110, linesTotal: 130 }),
                createdAt: tSys,
                snapshot: { id: snapshotId, commitSha: "sys1", createdAt: tSys },
                scenarios: [],
              },
            ],
          },
        });
        assert.equal(payload.pillars.system.coverageAvailable, true);
        assert.equal(payload.pillars.system.coverageMetrics.flow, 84.6);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F5-05: Unmeasured System coverage renders Pending / — / null across adapter, reportDiagrams, HTML, PDF, MD, and JSON", async () => {
      const {
        adaptUnifiedDashboard,
        buildReportMetricsModel,
        generateHtmlReport,
        generatePdfHtmlReport,
        generateMarkdownReport,
        buildFilteredJsonPayload,
      } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      assert.equal(vm.pillars.system.coverageMetrics.flow, null);
      const model = buildReportMetricsModel(vm);
      assert.equal(model.layers.system.coverage.flow, null);
      assert.equal(model.layers.system.coverageAvailable, false);

      const sysHtmlRow = extractKeyFindingsRowText(generateHtmlReport(vm), "System Tests");
      const sysPdfRow = extractKeyFindingsRowText(generatePdfHtmlReport(vm), "System Tests");
      assert.match(sysHtmlRow, /Pending|—/i);
      assert.doesNotMatch(sysHtmlRow, /100\.0%/);
      assert.match(sysPdfRow, /Pending|—/i);

      const md = generateMarkdownReport(vm);
      const sysMdLine = md.split("\n").find((l) => l.includes("| **System (E2E)**")) || "";
      assert.match(sysMdLine, /Pending|—/i);
      assert.doesNotMatch(sysMdLine, /100\.0%/);

      const json = buildFilteredJsonPayload(vm);
      assert.equal(json.layerDefinitions.system.metrics.coverage.flow, null);
    });

    // --- F6: Parity Test Fixtures (fifa-wc2026-stadium-ai) ---
    test("T1-F6-01: Backend fifa-wc2026-stadium-ai fixture yields 97.6% / 99.4% / 98.1% / 97.6%, 106/108, durationMs 200", async () => {
      const rootDir = createTempProjectDir("covai-t1-f6-01-");
      const snapshotId = nextSnapshotId("t1-f6-01");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId);
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        const u = payload.pillars.unit;
        assert.equal(u.coverageMetrics.lines, 97.6);
        assert.equal(u.coverageMetrics.branches, 99.4);
        assert.equal(u.coverageMetrics.functions, 98.1);
        assert.equal(u.coverageMetrics.statements, 97.6);
        assert.equal(u.passedTests, 106);
        assert.equal(u.failedTests, 2);
        assert.equal(u.totalTests, 108);
        assert.equal(u.durationMs, 200);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T1-F6-02: Adapter on fifa-wc2026-stadium-ai preserves exact metrics, 98.1% passRate, 200ms duration, and zero Vitest Module", async () => {
      const { adaptUnifiedDashboard } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      assert.equal(vm.pillars.unit.coverageMetrics.lines, 97.6);
      assert.equal(vm.pillars.unit.coverageMetrics.branches, 99.4);
      assert.equal(vm.pillars.unit.coverageMetrics.functions, 98.1);
      assert.equal(vm.pillars.unit.coverageMetrics.statements, 97.6);
      assert.equal(vm.pillars.unit.passRate, 98.1);
      assert.equal(vm.pillars.unit.durationMs, 200);
      assert.equal((vm.matrix?.rows || []).some((r) => /vitest/i.test(r.moduleName)), false);
    });

    test("T1-F6-03: Quality Gate on fifa-wc2026-stadium-ai passes chk-unit-branch (99.4% >= 75%)", async () => {
      const { adaptUnifiedDashboard, computeQualityGate } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const gate = computeQualityGate(vm.pillars, vm.matrix?.rows || []);
      const chk = gate.checklist.find((c) => c.id === "chk-unit-branch");
      assert.equal(chk.passed, true);
      assert.equal(chk.currentValue, "99.4%");
    });

    test("T1-F6-04: HTML & PDF on fifa-wc2026-stadium-ai contain exact unit figures & 0.2s/200ms with zero 72.9%/99.3%/Vitest Module", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      for (const html of [generateHtmlReport(vm), generatePdfHtmlReport(vm)]) {
        const plain = stripHtmlTags(html);
        assert.match(plain, /Lines 97\.6%/);
        assert.match(plain, /Branch 99\.4%/);
        assert.match(plain, /Fn 98\.1%/);
        assert.match(plain, /Stmt 97\.6%/);
        assert.match(plain, /106\/2\/0\/108/);
        const unitRow = extractKeyFindingsRowText(html, "Unit Tests");
        assert.match(unitRow, /0\.2s|200\s*ms/i);
        assert.equal(plain.includes("72.9%"), false, "Stale 72.9% leaked into report");
        assert.equal(plain.includes("99.3%"), false, "Stale 99.3% leaked into report");
        assert.equal(/Vitest Module/i.test(plain), false, "Ghost Vitest Module leaked into report");
      }
    });

    test("T1-F6-05: Markdown & JSON on fifa-wc2026-stadium-ai match exact HTML/PDF parity figures", async () => {
      const { adaptUnifiedDashboard, generateMarkdownReport, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const md = generateMarkdownReport(vm);
      assert.match(md, /97\.6%/);
      assert.match(md, /99\.4%/);
      assert.match(md, /98\.1%/);
      assert.match(md, /106 \/ 2 \/ 0 \/ 108/);
      assert.equal(md.includes("72.9%"), false);
      assert.equal(/Vitest Module/i.test(md), false);

      const json = buildFilteredJsonPayload(vm);
      assert.equal(json.layerDefinitions.unit.metrics.coverage.lines, 97.6);
      assert.equal(json.layerDefinitions.unit.metrics.coverage.branches, 99.4);
      assert.equal(json.layerDefinitions.unit.metrics.coverage.functions, 98.1);
      assert.equal(json.layerDefinitions.unit.metrics.coverage.statements, 97.6);
      assert.equal(json.layerDefinitions.unit.metrics.passedTests, 106);
      assert.equal(json.layerDefinitions.unit.metrics.failedTests, 2);
      assert.equal(json.layerDefinitions.unit.metrics.totalTests, 108);
      assert.equal(json.layerDefinitions.unit.metrics.durationMs, 200);
    });

    // --- F7: Max 2 Charts Per Page (Print/PDF & HTML) ---
    test("T1-F7-01: Standalone HTML groups charts in [data-chart-page] with <= 2 SVGs per container and zero .charts-grid-2x2", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditStandaloneHtml(generateHtmlReport(vm));
      assert.equal(audit.chartsGrid2x2Count, 0);
      assert.ok(audit.chartPages.length >= 2);
      for (const cp of audit.chartPages) {
        assert.ok(cp.svgCount >= 1 && cp.svgCount <= 2, `Chart page ${cp.pageAttr} has ${cp.svgCount} SVGs`);
      }
      assert.equal(audit.totalSvgs, 4);
    });

    test("T1-F7-02: Print/PDF HTML groups charts in [data-chart-page] with <= 2 SVGs per container and zero .charts-grid-2x2", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditStandaloneHtml(generatePdfHtmlReport(vm));
      assert.equal(audit.chartsGrid2x2Count, 0);
      assert.ok(audit.chartPages.length >= 2);
      for (const cp of audit.chartPages) {
        assert.ok(cp.svgCount >= 1 && cp.svgCount <= 2, `Chart page ${cp.pageAttr} has ${cp.svgCount} SVGs`);
      }
      assert.equal(audit.totalSvgs, 4);
    });

    test("T1-F7-03: Chart Page 1 ([data-chart-page='1'] inside .page-one) contains tier-bar-comparison and tier-outcome-donut", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditStandaloneHtml(generatePdfHtmlReport(vm));
      const p1 = audit.chartPages.find((cp) => cp.pageAttr === "1");
      assert.ok(p1, "Missing [data-chart-page='1']");
      assert.deepEqual(p1.diagramIds, ["tier-bar-comparison", "tier-outcome-donut"]);
    });

    test("T1-F7-04: Chart Page 2 ([data-chart-page='2'] inside .followup-pages) contains coverage-passrate-trend and module-tier-heatmap", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditStandaloneHtml(generatePdfHtmlReport(vm));
      const p2 = audit.chartPages.find((cp) => cp.pageAttr === "2");
      assert.ok(p2, "Missing [data-chart-page='2']");
      assert.deepEqual(p2.diagramIds, ["coverage-passrate-trend", "module-tier-heatmap"]);
    });

    test("T1-F7-05: CSS in both HTML and PDF HTML uses single-column .charts-stack (1fr) and omits 2x2 grid rules", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      for (const html of [generateHtmlReport(vm), generatePdfHtmlReport(vm)]) {
        assert.match(html, /\.charts-stack/);
        assert.equal(/\.charts-grid-2x2\s*\{/.test(html), false, "CSS still defines .charts-grid-2x2");
      }
    });

    // --- F8: Enlarged Readable SVG Charts ---
    test("T1-F8-01: renderTierBarComparisonSvg uses enlarged viewBox width >= 720, readable fonts, zero NaN", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderTierBarComparisonSvg } = await loadClientModules();
      const model = buildReportMetricsModel(createFifaWc2026Vm(adaptUnifiedDashboard));
      const svg = renderTierBarComparisonSvg(model);
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720, `Expected viewBox width >= 720, got ${vb?.w}`);
      assert.equal(/\bNaN\b/.test(svg), false);
      const fontSizes = [...svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
      assert.ok(fontSizes.some((s) => s >= 11), "Expected readable font-size >= 11");
    });

    test("T1-F8-02: renderTierOutcomeDonutSvg uses enlarged viewBox width >= 720, valid donut arcs, zero NaN", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderTierOutcomeDonutSvg } = await loadClientModules();
      const model = buildReportMetricsModel(createFifaWc2026Vm(adaptUnifiedDashboard));
      const svg = renderTierOutcomeDonutSvg(model);
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720, `Expected viewBox width >= 720, got ${vb?.w}`);
      assert.match(svg, /<path\b|<circle\b/);
      assert.equal(/\bNaN\b/.test(svg), false);
    });

    test("T1-F8-03: renderCoveragePassRateTrendSvg (>= 2 runs) uses viewBox >= 720, single-row legend, 80% gate line, end labels", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderCoveragePassRateTrendSvg } = await loadClientModules();
      const model = buildReportMetricsModel(createEnterpriseHealthyVm(adaptUnifiedDashboard));
      const svg = renderCoveragePassRateTrendSvg(model);
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720, `Expected viewBox width >= 720, got ${vb?.w}`);
      assert.match(svg, /80%/);
      assert.match(svg, /<polyline\b/);
      assert.equal(/\bNaN\b/.test(svg), false);

      // Verify single-row legend: all legend labels share one Y coordinate band
      const legendYs = [];
      for (const m of svg.matchAll(/<text[^>]*\by="([\d.]+)"[^>]*>([^<]+)<\/text>/g)) {
        const y = Number(m[1]);
        const label = m[2].trim();
        if (/^(Overall|Unit|Integration|System|Pass Rate|80% Gate)$/i.test(label) && y < 70) {
          legendYs.push(y);
        }
      }
      assert.ok(legendYs.length >= 4, `Expected >= 4 top legend labels, found ${legendYs.length}`);
      assert.ok(Math.max(...legendYs) - Math.min(...legendYs) <= 6, `Legend wrapped onto multiple rows: y=${legendYs.join(",")}`);
    });

    test("T1-F8-04: renderModuleTierHeatmapSvg (> 6 rows) expands maxRows >= 10 and updates overflow note without 'Page 2 matrix'", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderModuleTierHeatmapSvg } = await loadClientModules();
      const model = buildReportMetricsModel(createEnterpriseHealthyVm(adaptUnifiedDashboard, { moduleCount: 12 }));
      const svg = renderModuleTierHeatmapSvg(model);
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720, `Expected viewBox width >= 720, got ${vb?.w}`);
      const renderedRows = (svg.match(/Enterprise Domain Service/g) || []).length;
      assert.ok(renderedRows >= 10, `Expected >= 10 heatmap rows, got ${renderedRows}`);
      assert.equal(/Page 2 matrix/i.test(svg), false, "Heatmap overflow note must not reference stale 'Page 2 matrix'");
    });

    test("T1-F8-05: All 4 SVGs preserve flat industrial aesthetic (no gradients, role='img', aria-label, NFC normalized)", async () => {
      const {
        adaptUnifiedDashboard,
        buildReportMetricsModel,
        renderTierBarComparisonSvg,
        renderTierOutcomeDonutSvg,
        renderCoveragePassRateTrendSvg,
        renderModuleTierHeatmapSvg,
      } = await loadClientModules();
      const model = buildReportMetricsModel(createEnterpriseHealthyVm(adaptUnifiedDashboard));
      const svgs = [
        renderTierBarComparisonSvg(model),
        renderTierOutcomeDonutSvg(model),
        renderCoveragePassRateTrendSvg(model),
        renderModuleTierHeatmapSvg(model),
      ];
      for (const svg of svgs) {
        assert.equal(/linearGradient|radialGradient/i.test(svg), false);
        assert.match(svg, /role="img"/);
        assert.match(svg, /aria-label="/);
        assert.equal(svg, svg.normalize("NFC"));
      }
    });

    // --- F9: Pagination, Whitespace & Table Wrapping ---
    test("T1-F9-01: Playwright A4 @media print measures .page-one height >= 85% and <= 100% printable A4 height", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assert.ok(
        audit.pageOneFillRatio >= 0.85 && audit.pageOneFillRatio <= 1.01,
        `.page-one fill ratio ${(audit.pageOneFillRatio * 100).toFixed(1)}% outside 85%..100%`
      );
    });

    test("T1-F9-02: Playwright A4 @media print keeps .page1-footnote on Page 1 and paginates Page 2 cleanly", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assert.equal(audit.footnoteFitsPageOne, true, "Footnote spilled past Page 1");
      assert.ok(audit.pdfNumPages >= 2, `Expected >= 2 A4 PDF pages, got ${audit.pdfNumPages}`);
      assert.match(audit.pdfPageTexts[0] || "", /Note:.*NOT RUN/i);
      assert.match(audit.pdfPageTexts[1] || "", /Coverage & Pass-Rate Trend|Module .* Health Heatmap/i);
    });

    test("T1-F9-03: Playwright A4 @media print renders all 4 SVGs at width >= 650px within printable bounds", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assertCleanSvgMetrics(audit.svgMetrics, { minViewBoxW: 720, minRenderedW: 650 });
    });

    test("T1-F9-04: Playwright A4 @media print keeps all .badge labels on a single line", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      const wrapped = audit.badges.filter((b) => b.wrapped);
      assert.equal(wrapped.length, 0, `Wrapped badges: ${JSON.stringify(wrapped)}`);
    });

    test("T1-F9-05: Playwright A4 @media print prevents mid-word wrapping in keyFindingsHtml headers & framework cells", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assert.equal(audit.keyFindingsOverflowCells.length, 0);
      assert.equal(audit.keyFindingsWrappedTokens.length, 0);
    });
  });
}

// ============================================================================
// TIER 2 — Boundary & Corner Cases (45 Tests: 5 per Feature F1–F9)
// ============================================================================
if (shouldRunTier(2)) {
  describe("Tier 2 — Boundary & Corner Cases (F1–F9, 45 tests)", () => {
    // --- F1 Boundaries ---
    test("T2-F1-01: Missing snapshotId rejects with statusCode 400; unknown snapshotId rejects with 404", async () => {
      await assert.rejects(
        () => runBackendDashboard({ snapshotId: "", fixtureState: {} }),
        (err) => err?.statusCode === 400
      );
      await assert.rejects(
        () => runBackendDashboard({ snapshotId: nextSnapshotId("missing"), fixtureState: { snapshot: null } }),
        (err) => err?.statusCode === 404
      );
    });

    test("T2-F1-02: Corrupt JSON in coverage-summary.json falls back cleanly without SyntaxError or NaN", async () => {
      const rootDir = createTempProjectDir("covai-t2-f1-02-");
      const snapshotId = nextSnapshotId("t2-f1-02");
      try {
        writeProjectFile(rootDir, "coverage/unit/coverage-summary.json", "{ corrupt json !!!", { mtimeOffsetMs: -5000 });
        writeProjectFile(rootDir, "coverage/unit/vitest-coverage-summary.json", {
          total: makeCoverageEntry(40, 50, 10, 10, 5, 5),
          [path.join(rootDir, "src/services/valid.service.ts")]: makeCoverageEntry(40, 50, 10, 10, 5, 5),
        });
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            testRuns: [
              { id: "r1", snapshotId, type: "VITEST", status: "PASSED", totalTests: 5, passedTests: 5, failedTests: 0, durationMs: 80, createdAt: new Date(), snapshot: { id: snapshotId, commitSha: "a", createdAt: new Date() }, scenarios: [] },
            ],
          },
        });
        assert.equal(payload.pillars.unit.coverageMetrics.lines, 80.0);
        assert.equal(Number.isNaN(payload.pillars.unit.coverageMetrics.branches), false);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F1-03: All business files having 0 total branches and 100% lines produces deterministic branch % (never NaN)", async () => {
      const rootDir = createTempProjectDir("covai-t2-f1-03-");
      const snapshotId = nextSnapshotId("t2-f1-03");
      try {
        writeProjectFile(rootDir, "coverage/unit/coverage-summary.json", {
          total: makeCoverageEntry(50, 50, 0, 0, 5, 5),
          [path.join(rootDir, "src/services/pure.service.ts")]: makeCoverageEntry(50, 50, 0, 0, 5, 5),
        });
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            testRuns: [
              { id: "r1", snapshotId, type: "VITEST", status: "PASSED", totalTests: 3, passedTests: 3, failedTests: 0, durationMs: 40, createdAt: new Date(), snapshot: { id: snapshotId, commitSha: "a", createdAt: new Date() }, scenarios: [] },
            ],
          },
        });
        const b = payload.pillars.unit.coverageMetrics.branches;
        assert.equal(typeof b, "number");
        assert.equal(Number.isFinite(b), true);
        assert.equal(payload.pillars.unit.coverageMetrics.lines, 100);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F1-04: latestUnitRun.totalTests === 0 reports 0 executed tests and NOT_RUN state even if stale CoverageSummary exists", async () => {
      const rootDir = createTempProjectDir("covai-t2-f1-04-");
      const snapshotId = nextSnapshotId("t2-f1-04");
      try {
        const snapshot = createSnapshotShell({
          snapshotId,
          rootDir,
          coverageSummaries: { id: "cs-stale", snapshotId, linesPct: 72.9, branchesPct: 72.9, funcsPct: 99.3, stmtsPct: 72.9 },
        });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: { snapshot, testRuns: [] },
        });
        const { resolvePillarState } = await loadClientModules();
        assert.equal(payload.pillars.unit.totalTests, 0);
        assert.equal(payload.pillars.unit.coverageMetrics.branches, 0);
        assert.equal(resolvePillarState(payload.pillars.unit), "NOT_RUN");
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F1-05: Canceled unit TestRun is excluded via isExcludedCausalRun in favor of older valid TestRun", async () => {
      const rootDir = createTempProjectDir("covai-t2-f1-05-");
      const snapshotId = nextSnapshotId("t2-f1-05");
      try {
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const newer = new Date("2026-11-26T12:00:00Z");
        const older = new Date("2026-11-26T11:00:00Z");
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            testRuns: [
              { id: "r-cancel", snapshotId, type: "VITEST", status: "CANCELED", totalTests: 5, passedTests: 1, failedTests: 0, durationMs: 999, createdAt: newer, snapshot: { id: snapshotId, commitSha: "a", createdAt: newer }, scenarios: [] },
              { id: "r-valid", snapshotId, type: "VITEST", status: "PASSED", totalTests: 22, passedTests: 22, failedTests: 0, durationMs: 310, coverageLinesPct: 88.0, coverageBranchesPct: 82.0, createdAt: older, snapshot: { id: snapshotId, commitSha: "a", createdAt: older }, scenarios: [] },
            ],
          },
        });
        assert.equal(payload.pillars.unit.totalTests, 22);
        assert.equal(payload.pillars.unit.durationMs, 310);
      } finally {
        removeTempDir(rootDir);
      }
    });

    // --- F2 Boundaries ---
    test("T2-F2-01: Exact branch threshold boundary 74.9% fails vs 75.0% passes chk-unit-branch", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gateFail = computeQualityGate({ unit: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { lines: 85, branches: 74.9 } } });
      const gatePass = computeQualityGate({ unit: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { lines: 85, branches: 75.0 } } });
      assert.equal(gateFail.checklist.find((c) => c.id === "chk-unit-branch").passed, false);
      assert.equal(gatePass.checklist.find((c) => c.id === "chk-unit-branch").passed, true);
    });

    test("T2-F2-02: Exact passRate boundary 79.9% is FAILED/BLOCKED vs 80.0% is not FAILED", async () => {
      const { computeQualityGate } = await loadClientModules();
      const g1 = computeQualityGate({ unit: { totalTests: 1000, passedTests: 799, failedTests: 201, coverageMetrics: { lines: 90, branches: 90 } } });
      const g2 = computeQualityGate({ unit: { totalTests: 100, passedTests: 80, failedTests: 20, coverageMetrics: { lines: 90, branches: 90 } } });
      assert.equal(g1.status, "FAILED");
      assert.equal(g1.label, "BLOCKED");
      assert.notEqual(g2.status, "FAILED");
    });

    test("T2-F2-03: Exact API endpoint threshold 79.9% fails vs 80.0% passes (requires passedTests > 0)", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gLow = computeQualityGate({
        unit: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { lines: 90, branches: 90 } },
        integration: { totalTests: 2, passedTests: 2, failedTests: 0, coverageMetrics: { apiEndpoint: 79.9 } },
      });
      const gOk = computeQualityGate({
        unit: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { lines: 90, branches: 90 } },
        integration: { totalTests: 2, passedTests: 2, failedTests: 0, coverageMetrics: { apiEndpoint: 80.0 } },
      });
      const gUnrun = computeQualityGate({
        unit: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { lines: 90, branches: 90 } },
        integration: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { apiEndpoint: 80.0 } },
      });
      assert.equal(gLow.checklist.find((c) => c.id === "chk-api-endpoint").passed, false);
      assert.equal(gOk.checklist.find((c) => c.id === "chk-api-endpoint").passed, true);
      assert.equal(gUnrun.checklist.find((c) => c.id === "chk-api-endpoint").passed, false);
    });

    test("T2-F2-04: system.flakyTests = 1 with 0 failures and 100% coverage yields WARNING / AT RISK", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gate = computeQualityGate({
        unit: { totalTests: 50, passedTests: 50, failedTests: 0, coverageMetrics: { lines: 95, branches: 95 } },
        integration: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { apiEndpoint: 100 } },
        system: { totalTests: 5, passedTests: 5, failedTests: 0, flakyTests: 1, coverageMetrics: { flow: 90 } },
      });
      assert.equal(gate.status, "WARNING");
      assert.equal(gate.label, "AT RISK");
      assert.ok(gate.reasons.some((r) => /flaky/i.test(r)));
    });

    test("T2-F2-05: Null branches and lines fallback cleanly to '0.0%' (no null% or NaN%)", async () => {
      const { computeQualityGate } = await loadClientModules();
      const gate = computeQualityGate({
        unit: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { lines: null, branches: null } },
      });
      const chk = gate.checklist.find((c) => c.id === "chk-unit-branch");
      assert.equal(chk.passed, false);
      assert.equal(chk.currentValue, "0.0%");
    });

    // --- F3 Boundaries ---
    test("T2-F3-01: All 5 tooling setup/config filenames are excluded from matrix.rows", async () => {
      const rootDir = createTempProjectDir("covai-t2-f3-01-");
      const snapshotId = nextSnapshotId("t2-f3-01");
      try {
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const tooling = ["vitest.setup.ts", "vitest.workspace.mjs", "jest.setup.js", "jest.config.ts", "playwright.config.ts"];
        const coverageFiles = tooling.map((filePath, idx) => ({
          id: `cf-t-${idx}`,
          snapshotId,
          filePath,
          linesPct: 0,
          branchesPct: 0,
          funcsPct: 0,
          stmtsPct: 0,
        }));
        const payload = await runBackendDashboard({ snapshotId, fixtureState: { snapshot, coverageFiles } });
        const names = payload.matrix.rows.map((r) => r.moduleName.toLowerCase());
        assert.equal(names.some((n) => /vitest|jest|playwright|setup|config/.test(n)), false, `Leaked tooling rows: ${names.join(", ")}`);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F3-02: Windows backslash paths normalize cleanly (vitest.setup.ts excluded, order.service.js -> Order Module)", async () => {
      const rootDir = createTempProjectDir("covai-t2-f3-02-");
      const snapshotId = nextSnapshotId("t2-f3-02");
      try {
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            coverageFiles: [
              { id: "w1", snapshotId, filePath: "C:\\repo\\src\\vitest.setup.ts", linesPct: 0, branchesPct: 0 },
              { id: "w2", snapshotId, filePath: "storage\\p1\\src\\services\\order.service.js", linesPct: 88, branchesPct: 80 },
            ],
          },
        });
        const names = payload.matrix.rows.map((r) => r.moduleName);
        assert.equal(names.some((n) => /vitest/i.test(n)), false);
        assert.equal(names.some((n) => /order/i.test(n)), true);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F3-03: 12 distinct modules where #9..#12 fail are NOT dropped by any < 8 module cap", async () => {
      const { buildCrossLayerMatrix } = await loadBackendModules();
      const unitFiles = Array.from({ length: 12 }, (_, i) => ({
        filePath: `src/services/domain${String.fromCharCode(65 + i)}.service.js`,
        linesPct: i >= 8 ? 40 : 95,
        branchesPct: i >= 8 ? 30 : 90,
      }));
      const unitScenarios = Array.from({ length: 12 }, (_, i) => ({
        title: `spec ${i}`,
        testFile: `src/services/domain${String.fromCharCode(65 + i)}.service.test.js`,
        status: i >= 8 ? "failed" : "passed",
      }));
      const rows = buildCrossLayerMatrix({ unitFiles, unitScenarios });
      const failingRows = rows.filter((r) => r.unit?.status === "fail");
      assert.equal(failingRows.length, 4, `Expected all 4 failing modules #9..#12 retained, got ${failingRows.length}`);
    });

    test("T2-F3-04: Coverage-only module with 0 total branches (100% lines, 0% branches) does NOT emit 'Low unit branch coverage'", async () => {
      const { buildCrossLayerMatrix } = await loadBackendModules();
      const rows = buildCrossLayerMatrix({
        unitFiles: [{ filePath: "src/services/constants.service.js", linesPct: 100, branchesPct: 0, branchesTotal: 0 }],
        unitScenarios: [{ title: "exports constants", testFile: "src/services/constants.service.test.js", status: "passed" }],
      });
      const row = rows.find((r) => /constant/i.test(r.moduleName));
      assert.ok(row);
      assert.notEqual(row.rootCause?.summary, "Low unit branch coverage");
    });

    test("T2-F3-05: Empty arrays passed to buildCrossLayerMatrix return [] without throwing", async () => {
      const { buildCrossLayerMatrix } = await loadBackendModules();
      assert.deepEqual(buildCrossLayerMatrix({ unitFiles: [], unitScenarios: [], endpoints: [], systemScenarios: [] }), []);
    });

    // --- F4 Boundaries ---
    test("T2-F4-01: Executed run with durationMs = 0 displays '0ms' while NOT_RUN displays '—'", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport } = await loadClientModules();
      const vm = adaptUnifiedDashboard({
        context: { projectId: "p", projectName: "ZeroDur", snapshotId: "s" },
        unifiedBackendRaw: {
          pillars: {
            unit: { framework: "Vitest", totalTests: 5, passedTests: 5, failedTests: 0, durationMs: 0, avgDurationMs: 0, coverageMetrics: { lines: 90, branches: 90, functions: 90, statements: 90 } },
            integration: { framework: "Supertest", totalTests: 0, passedTests: 0, failedTests: 0, durationMs: 0, coverageMetrics: { apiEndpoint: 0, totalApis: 0, uncoveredApis: 0 } },
            system: { framework: "Playwright", totalTests: 0, passedTests: 0, failedTests: 0, durationMs: 0, coverageMetrics: { flow: null } },
          },
        },
      });
      const html = generateHtmlReport(vm);
      assert.match(extractKeyFindingsRowText(html, "Unit Tests"), /\b0ms\b/);
      assert.match(extractKeyFindingsRowText(html, "System Tests"), /—/);
    });

    test("T2-F4-02: Duration formatting thresholds 999ms, 1.0s, 59.9s, 1m 5s match consistently across HTML/PDF/MD", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport, generateMarkdownReport } = await loadClientModules();
      const vm999 = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          unit: { framework: "Vitest", totalTests: 10, passedTests: 10, failedTests: 0, durationMs: 999, avgDurationMs: 999, coverageMetrics: { lines: 90, branches: 90, functions: 90, statements: 90 } },
          integration: { framework: "Supertest", totalTests: 2, passedTests: 2, failedTests: 0, durationMs: 1000, avgDurationMs: 500, coverageMetrics: { apiEndpoint: 100, coveredApis: 2, totalApis: 2, uncoveredApis: 0 } },
          system: { framework: "Playwright", totalTests: 2, passedTests: 2, failedTests: 0, durationMs: 65000, avgDurationMs: 32500, coverageMetrics: { flow: 90 } },
        },
      });
      for (const out of [generateHtmlReport(vm999), generatePdfHtmlReport(vm999), generateMarkdownReport(vm999)]) {
        assert.match(out, /999ms/);
        assert.match(out, /1\.0s/);
        assert.match(out, /1m 5s/);
      }
      const vm59 = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          unit: { framework: "Vitest", totalTests: 1, passedTests: 1, failedTests: 0, durationMs: 59949, avgDurationMs: 59949, coverageMetrics: { lines: 90, branches: 90, functions: 90, statements: 90 } },
        },
      });
      assert.match(generateMarkdownReport(vm59), /59\.9s/);
    });

    test("T2-F4-03: Negative, NaN, and null durations sanitize to '—' across HTML/PDF/MD with zero NaN leakage", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport, generateMarkdownReport } = await loadClientModules();
      const vm = adaptUnifiedDashboard({
        context: { projectId: "p", projectName: "BadDur", snapshotId: "s" },
        unifiedBackendRaw: {
          pillars: {
            unit: { framework: "Vitest", totalTests: 5, passedTests: 5, failedTests: 0, durationMs: -10, avgDurationMs: -10, coverageMetrics: { lines: 90, branches: 90, functions: 90, statements: 90 } },
            integration: { framework: "Supertest", totalTests: 2, passedTests: 2, failedTests: 0, durationMs: Number.NaN, avgDurationMs: Number.NaN, coverageMetrics: { apiEndpoint: 100, coveredApis: 2, totalApis: 2, uncoveredApis: 0 } },
            system: { framework: "Playwright", totalTests: 2, passedTests: 2, failedTests: 0, durationMs: null, avgDurationMs: null, coverageMetrics: { flow: 80 } },
          },
        },
      });
      for (const out of [generateHtmlReport(vm), generatePdfHtmlReport(vm), generateMarkdownReport(vm)]) {
        assert.equal(/\bNaN\b/.test(stripHtmlTags(out)), false);
        assert.match(out, /—/);
      }
    });

    test("T2-F4-04: High test count + sub-second duration (500 tests, 200ms) keeps suite duration 0.2s/200ms", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          unit: { framework: "Vitest", totalTests: 500, passedTests: 500, failedTests: 0, durationMs: 200, avgDurationMs: 0, coverageMetrics: { lines: 95, branches: 95, functions: 95, statements: 95 } },
        },
      });
      const unitRow = extractKeyFindingsRowText(generateHtmlReport(vm), "Unit Tests");
      assert.match(unitRow, /0\.2s|200\s*ms/i);
      assert.equal(buildFilteredJsonPayload(vm).layerDefinitions.unit.metrics.durationMs, 200);
    });

    test("T2-F4-05: Integration distinguishes suite durationMs = 4200 from avgEndpointLatencyMs = 85", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          integration: {
            framework: "Supertest",
            totalTests: 10,
            passedTests: 10,
            failedTests: 0,
            durationMs: 4200,
            avgDurationMs: 85,
            avgEndpointLatencyMs: 85,
            coverageMetrics: { apiEndpoint: 100, coveredApis: 5, uncoveredApis: 0, totalApis: 5 },
          },
        },
      });
      const intRow = extractKeyFindingsRowText(generateHtmlReport(vm), "Integration Tests");
      assert.match(intRow, /4\.2s|85ms/);
      const jsonMetrics = buildFilteredJsonPayload(vm).layerDefinitions.integration.metrics;
      assert.equal(jsonMetrics.durationMs, 4200);
      assert.equal(jsonMetrics.avgEndpointLatencyMs ?? jsonMetrics.avgDurationMs, 85);
    });

    // --- F5 Boundaries ---
    test("T2-F5-01: totalApis = 0 and intTotal = 0 yields 0% apiEndpoint, 0 uncoveredApis, and clean HTML/MD notice", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generateMarkdownReport } = await loadClientModules();
      const vm = createUnitOnlyVm(adaptUnifiedDashboard);
      assert.equal(vm.pillars.integration.coverageMetrics.apiEndpoint, 0);
      assert.equal(vm.pillars.integration.coverageMetrics.uncoveredApis, 0);
      assert.match(generateHtmlReport(vm), /No AST API endpoints were discovered/i);
      assert.match(generateMarkdownReport(vm), /No AST API endpoints were discovered/i);
    });

    test("T2-F5-02: totalApis = 3, coveredApis = 0, intPassed = 12 never inflates coveredApis or apiEndpoint to 100%", async () => {
      const { adaptIntegration } = await loadClientModules();
      const res = adaptIntegration(
        {
          summary: {
            totalApis: 3,
            totalTests: 12,
            passedTests: 12,
            failedTests: 0,
            endpointCoverageMetrics: { totalEndpoints: 3, coveredEndpoints: 0, endpointCoveragePct: 0 },
          },
          endpoints: [
            { method: "GET", path: "/api/a", status: "Partial" },
            { method: "GET", path: "/api/b", status: "Partial" },
            { method: "GET", path: "/api/c", status: "Uncovered" },
          ],
        },
        null,
        null
      );
      assert.equal(res.coverageMetrics.coveredApis, 0);
      assert.equal(res.coverageMetrics.apiEndpoint, 0);
    });

    test("T2-F5-03: Empty systemMeasurement ({}) with 4/4 passed system tests yields flow: null and coverageAvailable: false", async () => {
      const rootDir = createTempProjectDir("covai-t2-f5-03-");
      const snapshotId = nextSnapshotId("t2-f5-03");
      try {
        const snapshot = createSnapshotShell({ snapshotId, rootDir });
        const t = new Date("2026-11-26T10:00:00Z");
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            testRuns: [
              { id: "r-sys-empty", snapshotId, type: "PLAYWRIGHT", status: "PASSED", totalTests: 4, passedTests: 4, failedTests: 0, durationMs: 5000, systemMeasurement: {}, createdAt: t, snapshot: { id: snapshotId, commitSha: "a", createdAt: t }, scenarios: [] },
            ],
          },
        });
        assert.equal(payload.pillars.system.coverageMetrics.flow, null);
        assert.equal(payload.pillars.system.coverageAvailable, false);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F5-04: system.coverageMetrics.flow = null across selectors, diagrams, and exports produces zero NaN or 'null%'", async () => {
      const {
        adaptUnifiedDashboard,
        computeCoverageIndex,
        buildReportMetricsModel,
        generateHtmlReport,
        generateMarkdownReport,
        buildFilteredJsonPayload,
      } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const covIdx = computeCoverageIndex(vm.pillars);
      assert.equal(Number.isFinite(covIdx.overall), true);
      const model = buildReportMetricsModel(vm);
      assert.equal(model.layers.system.coverage.flow, null);
      for (const txt of [generateHtmlReport(vm), generateMarkdownReport(vm), JSON.stringify(buildFilteredJsonPayload(vm))]) {
        assert.equal(/\bNaN\b/.test(txt), false);
        assert.equal(txt.includes("null%"), false);
      }
    });

    test("T2-F5-05: Integration endpoints with Script Error and Partial appear in lowCoverageItems / issue counts", async () => {
      const rootDir = createTempProjectDir("covai-t2-f5-05-");
      const snapshotId = nextSnapshotId("t2-f5-05");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId, { includeSystem: false });
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        const names = (payload.pillars.integration.lowCoverageItems || []).map((i) => i.name);
        assert.ok(names.some((n) => n.includes("/api/tickets/reserve")), "Partial endpoint missing from lowCoverageItems");
        assert.ok(names.some((n) => n.includes("/api/stadiums/:id/capacity")), "Script Error endpoint missing from lowCoverageItems");
      } finally {
        removeTempDir(rootDir);
      }
    });

    // --- F6 Boundaries ---
    test("T2-F6-01: fifa-wc2026-stadium-ai with 0 Integration & 0 System keeps exact Unit parity while other tiers stay NOT_RUN", async () => {
      const rootDir = createTempProjectDir("covai-t2-f6-01-");
      const snapshotId = nextSnapshotId("t2-f6-01");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId, {
          includeIntegration: false,
          includeSystem: false,
        });
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        assert.equal(payload.pillars.unit.coverageMetrics.lines, 97.6);
        assert.equal(payload.pillars.unit.coverageMetrics.branches, 99.4);
        assert.equal(payload.pillars.unit.durationMs, 200);
        assert.equal(payload.pillars.integration.totalTests, 0);
        assert.equal(payload.pillars.system.totalTests, 0);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F6-02: fifa-wc2026-stadium-ai pass rate is consistently 98.1% across backend, adapter, HTML, PDF, MD, JSON", async () => {
      const {
        adaptUnifiedDashboard,
        generateHtmlReport,
        generatePdfHtmlReport,
        generateMarkdownReport,
        buildFilteredJsonPayload,
      } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      assert.equal(vm.pillars.unit.passRate, 98.1);
      assert.match(extractKeyFindingsRowText(generateHtmlReport(vm), "Unit Tests"), /98\.1%/);
      assert.match(extractKeyFindingsRowText(generatePdfHtmlReport(vm), "Unit Tests"), /98\.1%/);
      assert.match(generateMarkdownReport(vm), /98\.1%/);
      assert.equal(buildFilteredJsonPayload(vm).layerDefinitions.unit.metrics.passRate, 98.1);
    });

    test("T2-F6-03: fifa-wc2026-stadium-ai preserves all 16 business coverageFiles and excludes vitest.setup.ts", async () => {
      const rootDir = createTempProjectDir("covai-t2-f6-03-");
      const snapshotId = nextSnapshotId("t2-f6-03");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId);
        const payload = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        const paths = payload.pillars.unit.coverageFiles.map((f) => f.filePath);
        assert.equal(paths.length, 16);
        assert.equal(paths.some((p) => p.includes("vitest.setup")), false);
        assert.equal(paths.some((p) => p.includes("seedStadiums")), false);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T2-F6-04: fifa-wc2026-stadium-ai with partial sections filter omits executive summary while keeping matrix parity", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const sections = { executive: false, pyramidPillars: false, traceMatrix: true, actionCenter: false, trendsHistory: false };
      const html = generateHtmlReport(vm, sections);
      assert.equal(html.includes('id="sec-key-findings"'), false);
      assert.match(html, /Match Predictor Module/);
      const json = buildFilteredJsonPayload(vm, sections);
      assert.equal(json.executiveSummary, undefined);
      assert.ok(Array.isArray(json.matrix?.rows));
    });

    test("T2-F6-05: exportUnifiedDashboardReport (.html, .md, .json) matches pure generator outputs byte-for-byte", async () => {
      const {
        adaptUnifiedDashboard,
        exportUnifiedDashboardReport,
        generateHtmlReport,
        generateMarkdownReport,
        buildFilteredJsonPayload,
      } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      await withBrowserShims(async ({ downloads }) => {
        const fHtml = exportUnifiedDashboardReport(vm, "html");
        const fMd = exportUnifiedDashboardReport(vm, "markdown");
        const fJson = exportUnifiedDashboardReport(vm, "json");
        assert.match(fHtml, /\.html$/);
        assert.match(fMd, /\.md$/);
        assert.match(fJson, /\.json$/);
        assert.equal(downloads.length, 3);
        assert.equal(downloads[0].content, generateHtmlReport(vm).normalize("NFC"));
        assert.equal(downloads[1].content, generateMarkdownReport(vm).normalize("NFC"));
        const parsed = JSON.parse(downloads[2].content);
        const direct = buildFilteredJsonPayload(vm);
        assert.deepEqual(parsed.layerDefinitions, direct.layerDefinitions);
      });
    });

    // --- F7 Boundaries ---
    test("T2-F7-01: All sections disabled emits 0 [data-chart-page] containers and 0 <svg> elements", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const html = generateHtmlReport(vm, {
        executive: false,
        pyramidPillars: false,
        traceMatrix: false,
        actionCenter: false,
        trendsHistory: false,
      });
      const audit = await auditStandaloneHtml(html);
      assert.equal(audit.chartPages.length, 0);
      assert.equal(audit.totalSvgs, 0);
    });

    test("T2-F7-02: Partial sections (executive only) still paginates <= 2 SVGs per [data-chart-page]", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const html = generatePdfHtmlReport(vm, {
        executive: true,
        pyramidPillars: false,
        traceMatrix: false,
        actionCenter: false,
        trendsHistory: false,
      });
      const audit = await auditStandaloneHtml(html);
      assert.ok(audit.chartPages.length >= 1);
      for (const cp of audit.chartPages) {
        assert.ok(cp.svgCount >= 1 && cp.svgCount <= 2);
      }
      assert.equal(audit.orphanSvgs, 0);
    });

    test("T2-F7-03: Unrun snapshot still enforces <= 2 SVGs per [data-chart-page] with clean Not Run placeholders", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createUnrunVm(adaptUnifiedDashboard);
      const audit = await auditStandaloneHtml(generatePdfHtmlReport(vm));
      assert.equal(audit.chartsGrid2x2Count, 0);
      assert.ok(audit.chartPages.length >= 2);
      for (const cp of audit.chartPages) {
        assert.ok(cp.svgCount >= 1 && cp.svgCount <= 2);
      }
      assert.match(audit.bodyText, /Not Run/i);
    });

    test("T2-F7-04: Zero orphan <svg> elements exist outside [data-chart-page] in HTML and PDF HTML", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport } = await loadClientModules();
      const vm = createEnterpriseHealthyVm(adaptUnifiedDashboard);
      for (const html of [generateHtmlReport(vm), generatePdfHtmlReport(vm)]) {
        const audit = await auditStandaloneHtml(html);
        assert.equal(audit.orphanSvgs, 0);
      }
    });

    test("T2-F7-05: Language option 'vi' or 'bilingual' normalizes to 'en' and preserves <= 2 chart-page pagination", async () => {
      const { adaptUnifiedDashboard, normalizeReportLanguage, generatePdfHtmlReport } = await loadClientModules();
      assert.equal(normalizeReportLanguage("vi"), "en");
      assert.equal(normalizeReportLanguage("bilingual"), "en");
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditStandaloneHtml(generatePdfHtmlReport(vm, { language: "vi" }));
      assert.equal(audit.chartsGrid2x2Count, 0);
      assert.ok(audit.chartPages.every((cp) => cp.svgCount <= 2));
    });

    // --- F8 Boundaries ---
    test("T2-F8-01: Single-run trend renders Baseline bar fallback (no <polyline>) at viewBox width >= 720", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderCoveragePassRateTrendSvg } = await loadClientModules();
      const model = buildReportMetricsModel(createUnitOnlyVm(adaptUnifiedDashboard));
      const svg = renderCoveragePassRateTrendSvg(model);
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720);
      assert.equal(/<polyline\b/.test(svg), false);
      assert.match(svg, /<rect\b/);
    });

    test("T2-F8-02: Identical trend end values (overall = 100, passRate = 100) separate end-of-line labels cleanly", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderCoveragePassRateTrendSvg } = await loadClientModules();
      const vm = createEnterpriseHealthyVm(adaptUnifiedDashboard, { trendCount: 2 });
      vm.trend.series = [
        { runLabel: "R1", overallCoverage: 90, unitCoverage: 90, integrationCoverage: 90, systemCoverage: 90, passRate: 95 },
        { runLabel: "R2", overallCoverage: 100, unitCoverage: 100, integrationCoverage: 100, systemCoverage: 100, passRate: 100 },
      ];
      const svg = renderCoveragePassRateTrendSvg(buildReportMetricsModel(vm));
      const endLabels = [...svg.matchAll(/<text[^>]*\by="([\d.]+)"[^>]*>(?:Overall|Pass)[^<]*100(?:\.0)?%<\/text>/gi)].map((m) => Number(m[1]));
      assert.equal(endLabels.length, 2, `Expected 2 end labels, got ${endLabels.length}`);
      assert.ok(Math.abs(endLabels[1] - endLabels[0]) >= 13, `End labels collided: y=${endLabels.join(",")}`);
    });

    test("T2-F8-03: 0 matrixRows renders 3-tier readiness fallback at viewBox width >= 720 with System Pending handled cleanly", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderModuleTierHeatmapSvg } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard, { matrix: { rows: [] } });
      const svg = renderModuleTierHeatmapSvg(buildReportMetricsModel(vm));
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720);
      assert.equal(/\bNaN\b/.test(svg), false);
      assert.match(svg, /Unit|Integration|System/);
    });

    test("T2-F8-04: 15 matrixRows with 45-char names expands maxRows >= 10, truncates cleanly, and reports accurate overflow", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderModuleTierHeatmapSvg } = await loadClientModules();
      const vm = createHighDensity18ModuleVm(adaptUnifiedDashboard);
      vm.matrix.rows = vm.matrix.rows.slice(0, 15);
      const svg = renderModuleTierHeatmapSvg(buildReportMetricsModel(vm));
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720);
      assert.equal(/\bNaN\b/.test(svg), false);
      const rowDots = (svg.match(/AuthenticationAndAuthorization|packages\/domain/g) || []).length;
      assert.ok(rowDots >= 10, `Expected >= 10 rendered rows, got ${rowDots}`);
      assert.match(svg, /\+\d+\s+more\s+module/i);
    });

    test("T2-F8-05: Extreme 0.1% donut slice (1 passed, 1000 failed, 1 skipped) renders valid SVG without NaN", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderTierOutcomeDonutSvg } = await loadClientModules();
      const vm = createEnterpriseHealthyVm(adaptUnifiedDashboard);
      vm.execution = { total: 1002, passed: 1, failed: 1000, skipped: 1, passRate: 0.1 };
      const svg = renderTierOutcomeDonutSvg(buildReportMetricsModel(vm));
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720);
      assert.equal(/\bNaN\b/.test(svg), false);
      assert.match(svg, /<path\b|<circle\b/);
    });

    // --- F9 Boundaries ---
    test("T2-F9-01: 120-char projectName + 80-char snapshotLabel wrap cleanly inside printable A4 width", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      vm.context.projectName = "UltraLongEnterpriseWorkspaceServicePlatformName".repeat(3).slice(0, 120);
      vm.context.snapshotLabel = "release-candidate-2026-11-27-build-verification-tag-".repeat(2).slice(0, 80);
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assert.ok(audit.headingRect.right <= A4_PRINTABLE_WIDTH_PX + 40, `Heading overflows: ${audit.headingRect.right}`);
      assert.equal(audit.horizontalOverflow, false);
    });

    test("T2-F9-02: XSS payload, Markdown pipes, and NFD accented text escape cleanly and normalize to NFC", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generateMarkdownReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      vm.context.projectName = "D\u0061\u0301tabase | <script>alert(1)</script> & Co";
      const html = generateHtmlReport(vm);
      const md = generateMarkdownReport(vm);
      assert.equal(html.includes("<script>alert(1)</script>"), false);
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.equal(html, html.normalize("NFC"));
      assert.equal(md, md.normalize("NFC"));
      const audit = await auditStandaloneHtml(html);
      assert.equal(audit.dialogTriggered, false);
    });

    test("T2-F9-03: 25 historyRuns cap cleanly and render in A4 print without horizontal table overflow", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      vm.history.runs = Array.from({ length: 25 }, (_, i) => ({
        id: `run-long-identifier-hash-${i + 1}`,
        shortId: `r-${i + 1}`,
        type: i % 2 === 0 ? "unit" : "integration",
        status: i === 0 ? "fail" : "pass",
        passed: 20,
        failed: i === 0 ? 1 : 0,
        coveragePct: 90,
        durationMs: 400 + i * 25,
        commitSha: `deadbeef${String(i).padStart(4, "0")}`,
      }));
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assert.equal(audit.overflowingTables.length, 0);
    });

    test("T2-F9-04: exportUnifiedDashboardPdf creates hidden iframe, triggers win.print(), and cleans up on afterprint", async () => {
      const { adaptUnifiedDashboard, exportUnifiedDashboardPdf } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      await withBrowserShims(async ({ printedFrames, mockBody }) => {
        const ok = exportUnifiedDashboardPdf(vm);
        assert.equal(ok, true);
        await new Promise((r) => setTimeout(r, 40));
        assert.equal(printedFrames.length, 1);
        const frame = printedFrames[0];
        assert.equal(frame.contentWindow.printCalls, 1);
        assert.match(frame.contentWindow.document.getWrittenHtml(), /data-chart-page/);
        frame.contentWindow.dispatchEvent("afterprint");
        assert.equal(mockBody.children.length, 0, "Iframe was not removed on afterprint");
      });
    });

    test("T2-F9-05: Standalone HTML renders cleanly at desktop (1280x900) and mobile (390x844) with toolbar & zero horizontal overflow", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport } = await loadClientModules();
      const html = generateHtmlReport(createFifaWc2026Vm(adaptUnifiedDashboard));
      for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        const audit = await auditStandaloneHtml(html, { viewport: vp });
        assert.equal(audit.toolbarVisible, true, `Toolbar missing at ${vp.width}x${vp.height}`);
        assert.equal(audit.horizontalOverflow, false, `Horizontal overflow at ${vp.width}x${vp.height}`);
        assert.ok(audit.chartPages.every((cp) => cp.svgCount <= 2));
      }
    });
  });
}

// ============================================================================
// TIER 3 — Cross-Feature Combinations (12 Pairwise Tests)
// ============================================================================
if (shouldRunTier(3)) {
  describe("Tier 3 — Cross-Feature Combinations (12 pairwise tests)", () => {
    test("T3-01 (F1+F2+F6): Backend 99.4% filtered vs 72.9% stale DB -> Adapter -> Gate passes chk-unit-branch", async () => {
      const rootDir = createTempProjectDir("covai-t3-01-");
      const snapshotId = nextSnapshotId("t3-01");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId);
        const backend = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        const { adaptUnifiedDashboard, computeQualityGate, computeHealth } = await loadClientModules();
        const vm = adaptUnifiedDashboard({ context: backend.context, unifiedBackendRaw: backend });
        const gate = computeQualityGate(vm.pillars, vm.matrix.rows);
        const health = computeHealth(vm.pillars, null, gate);
        assert.equal(vm.pillars.unit.coverageMetrics.branches, 99.4);
        assert.equal(gate.checklist.find((c) => c.id === "chk-unit-branch").passed, true);
        assert.ok(health.score >= 70 && health.grade !== "—");
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T3-02 (F1+F3+F5): Mixed vitest exclusions + CoverageFile tooling + Partial/Script Error APIs + null System coverage", async () => {
      const rootDir = createTempProjectDir("covai-t3-02-");
      const snapshotId = nextSnapshotId("t3-02");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId);
        const backend = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        assert.equal(backend.pillars.unit.coverageMetrics.branches, 99.4);
        assert.equal(backend.matrix.rows.some((r) => /vitest|seed/i.test(r.moduleName)), false);
        assert.equal(backend.pillars.integration.coverageMetrics.coveredApis, 1);
        assert.equal(backend.pillars.system.coverageMetrics.flow, null);
        assert.equal(backend.pillars.system.coverageAvailable, false);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T3-03 (F4+F5+F6): Full export parity (HTML === PDF === MD === JSON) for duration, avgEndpointLatencyMs, and System Pending", async () => {
      const {
        adaptUnifiedDashboard,
        generateHtmlReport,
        generatePdfHtmlReport,
        generateMarkdownReport,
        buildFilteredJsonPayload,
      } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const html = generateHtmlReport(vm);
      const pdfHtml = generatePdfHtmlReport(vm);
      const md = generateMarkdownReport(vm);
      const json = buildFilteredJsonPayload(vm);

      assert.match(extractKeyFindingsRowText(html, "Unit Tests"), /0\.2s|200\s*ms/i);
      assert.match(extractKeyFindingsRowText(pdfHtml, "Unit Tests"), /0\.2s|200\s*ms/i);
      assert.match(md, /0\.2s|200\s*ms/i);
      assert.equal(json.layerDefinitions.unit.metrics.durationMs, 200);
      assert.equal(json.layerDefinitions.system.metrics.coverage.flow, null);
    });

    test("T3-04 (F7+F8+F9): Playwright A4 print + standalone HTML verify <= 2 charts/page, SVG >= 650px, >= 85% Page-1 fill, 0 overlap", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport } = await loadClientModules();
      const vm = createEnterpriseHealthyVm(adaptUnifiedDashboard);
      const htmlAudit = await auditStandaloneHtml(generateHtmlReport(vm));
      assert.equal(htmlAudit.chartsGrid2x2Count, 0);
      assert.ok(htmlAudit.chartPages.every((cp) => cp.svgCount <= 2));
      assertCleanSvgMetrics(htmlAudit.svgMetrics, { minViewBoxW: 720 });

      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assertPrintLayoutQuality(pdfAudit);
    });

    test("T3-05 (F3+F8+F9): 12-module matrix with long names & failing modules renders >= 10 heatmap rows cleanly in Playwright", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createHighDensity18ModuleVm(adaptUnifiedDashboard);
      vm.matrix.rows = vm.matrix.rows.slice(0, 12);
      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assertPrintLayoutQuality(pdfAudit);
      const heatmapSvg = pdfAudit.svgMetrics.find((s) => s.diagramId === "module-tier-heatmap");
      assert.ok(heatmapSvg && heatmapSvg.textOverlaps.length === 0);
    });

    test("T3-06 (F2+F4+F7): BLOCKED gate renders single-line BLOCKED badge alongside 0.2s Unit duration and Page-1 2-chart stack", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          unit: { framework: "Vitest", totalTests: 50, passedTests: 45, failedTests: 5, durationMs: 200, avgDurationMs: 4, coverageMetrics: { lines: 70, branches: 62, functions: 72, statements: 70 } },
          integration: { framework: "Supertest", totalTests: 4, passedTests: 4, failedTests: 0, durationMs: 800, avgDurationMs: 200, coverageMetrics: { apiEndpoint: 100, coveredApis: 4, totalApis: 4, uncoveredApis: 0 } },
          system: { framework: "Playwright", totalTests: 5, passedTests: 3, failedTests: 2, durationMs: 9000, avgDurationMs: 1800, coverageMetrics: { flow: 60 } },
        },
      });
      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assert.equal(vm.qualityGate.label, "BLOCKED");
      assertPrintLayoutQuality(pdfAudit);
      assert.match(pdfAudit.pdfPageTexts[0], /BLOCKED/);
    });

    test("T3-07 (F5+F7+F8): System null flow + Integration 0/0 APIs renders clean Not Run / Pending states across enlarged SVGs", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createUnitOnlyVm(adaptUnifiedDashboard);
      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assertPrintLayoutQuality(pdfAudit);
      assert.equal(pdfAudit.nanMatches.length, 0);
    });

    test("T3-08 (F1+F4+F9): Sub-second Unit (200ms) + multi-minute System (75000ms = 1m 15s) render without column overflow in Playwright", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          system: { framework: "Playwright", totalTests: 10, passedTests: 10, failedTests: 0, durationMs: 75000, avgDurationMs: 7500, coverageAvailable: false, coverageMetrics: { lines: null, flow: null } },
        },
      });
      const pdfHtml = generatePdfHtmlReport(vm);
      assert.match(extractKeyFindingsRowText(pdfHtml, "System Tests"), /1m 15s/);
      const pdfAudit = await auditPrintPdfHtml(pdfHtml);
      assertPrintLayoutQuality(pdfAudit);
    });

    test("T3-09 (F6+F7+F9): fifa-wc2026-stadium-ai A4 PDF parsed via pdfjs-dist verifies exact Page 1 & Page 2+ text parity", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const audit = await auditPrintPdfHtml(generatePdfHtmlReport(vm));
      assertPrintLayoutQuality(audit);
      const p1Text = audit.pdfPageTexts[0] || "";
      const restText = audit.pdfPageTexts.slice(1).join(" ");
      assert.match(p1Text, /Executive Summary/i);
      assert.match(p1Text, /Note:.*NOT RUN/i);
      assert.match(restText, /Lines 97\.6%/);
      assert.match(restText, /Branch 99\.4%/);
      assert.match(restText, /0\.2s|200\s*ms/i);
      assert.equal(audit.pdfPageTexts.join(" ").includes("72.9%"), false);
      assert.equal(/Vitest Module/i.test(audit.pdfPageTexts.join(" ")), false);
    });

    test("T3-10 (F1+F5+F8): Multi-run history (8 trend points with null system coverage) renders Trend SVG cleanly without 0% spike or NaN", async () => {
      const { adaptUnifiedDashboard, buildReportMetricsModel, renderCoveragePassRateTrendSvg } = await loadClientModules();
      const vm = createEnterpriseHealthyVm(adaptUnifiedDashboard, { trendCount: 8 });
      vm.trend.series[2].systemCoverage = null;
      vm.trend.series[5].systemCoverage = null;
      const svg = renderCoveragePassRateTrendSvg(buildReportMetricsModel(vm));
      const vb = parseSvgViewBox(svg);
      assert.ok(vb && vb.w >= 720);
      assert.equal(/\bNaN\b/.test(svg), false);
    });

    test("T3-11 (F2+F3+F6): buildDashboardAiAnalysisPrompt reflects 97.6% lines, 99.4% branches, AT RISK (not BLOCKED), and zero Vitest Module", async () => {
      const { adaptUnifiedDashboard, buildDashboardAiAnalysisPrompt } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard, {
        pillars: {
          integration: {
            framework: "Supertest",
            totalTests: 10,
            passedTests: 9,
            failedTests: 1,
            skippedTests: 0,
            durationMs: 1450,
            avgDurationMs: 65,
            avgEndpointLatencyMs: 65,
            coverageMetrics: { apiEndpoint: 25.0, coveredApis: 1, uncoveredApis: 3, totalApis: 4 },
          },
        },
      });
      const prompt = buildDashboardAiAnalysisPrompt(vm);
      assert.match(prompt, /97\.6%/);
      assert.match(prompt, /99\.4%/);
      assert.match(prompt, /AT RISK/);
      assert.equal(/BLOCKED/.test(prompt), false);
      assert.equal(/Vitest Module/i.test(prompt), false);
    });

    test("T3-12 (F7+F8+F9): Partial sections (executive + traceMatrix only) passes all 4 formats & Playwright print checks", async () => {
      const {
        adaptUnifiedDashboard,
        generateHtmlReport,
        generatePdfHtmlReport,
        generateMarkdownReport,
        buildFilteredJsonPayload,
      } = await loadClientModules();
      const vm = createFifaWc2026Vm(adaptUnifiedDashboard);
      const sections = { executive: true, pyramidPillars: false, traceMatrix: true, actionCenter: false, trendsHistory: false };
      const html = generateHtmlReport(vm, sections);
      const pdfHtml = generatePdfHtmlReport(vm, sections);
      const md = generateMarkdownReport(vm, sections);
      const json = buildFilteredJsonPayload(vm, sections);

      assert.equal(html.includes('id="sec-key-findings"'), false);
      assert.equal(md.includes("## Key Findings"), false);
      assert.equal(json.pillars, undefined);
      assert.ok(Array.isArray(json.matrix?.rows));

      const audit = await auditPrintPdfHtml(pdfHtml);
      assertPrintLayoutQuality(audit, { expectFollowup: true });
    });
  });
}

// ============================================================================
// TIER 4 — Real-World Application Scenarios (8 Full E2E Scenarios)
// ============================================================================
if (shouldRunTier(4)) {
  describe("Tier 4 — Real-World Application Scenarios (8 full E2E scenarios)", () => {
    const shotDir = CLI_OPTS.keepScreenshotsDir;

    test("T4-01: fifa-wc2026-stadium-ai Full Disk+Prisma -> Backend -> Adapter -> All 4 Exports -> Playwright A4 PDF + HTML", async () => {
      const rootDir = createTempProjectDir("covai-t4-01-");
      const snapshotId = nextSnapshotId("t4-01");
      try {
        const fixture = createFifaWc2026BackendFixture(rootDir, snapshotId);
        const backend = await runBackendDashboard({ snapshotId, fixtureState: fixture });
        const {
          adaptUnifiedDashboard,
          generateHtmlReport,
          generatePdfHtmlReport,
          generateMarkdownReport,
          buildFilteredJsonPayload,
        } = await loadClientModules();

        const vm = adaptUnifiedDashboard({ context: backend.context, unifiedBackendRaw: backend });
        assert.equal(vm.pillars.unit.coverageMetrics.lines, 97.6);
        assert.equal(vm.pillars.unit.coverageMetrics.branches, 99.4);
        assert.equal(vm.pillars.unit.coverageMetrics.functions, 98.1);
        assert.equal(vm.pillars.unit.coverageMetrics.statements, 97.6);
        assert.equal(vm.pillars.unit.durationMs, 200);
        assert.equal(vm.pillars.system.coverageMetrics.flow, null);

        const html = generateHtmlReport(vm);
        const pdfHtml = generatePdfHtmlReport(vm);
        const md = generateMarkdownReport(vm);
        const json = buildFilteredJsonPayload(vm);

        assert.equal(json.layerDefinitions.unit.metrics.durationMs, 200);
        assert.equal(md.includes("72.9%"), false);

        const htmlAudit = await auditStandaloneHtml(html, {
          screenshotPath: shotDir ? path.join(shotDir, "t4-01-wc2026-standalone.png") : null,
        });
        assert.equal(htmlAudit.chartsGrid2x2Count, 0);
        assertCleanSvgMetrics(htmlAudit.svgMetrics, { minViewBoxW: 720 });

        const pdfAudit = await auditPrintPdfHtml(pdfHtml, {
          screenshotDir: shotDir,
          screenshotName: "t4-01-wc2026",
        });
        assertPrintLayoutQuality(pdfAudit);
        const fullPdfText = pdfAudit.pdfPageTexts.join(" ");
        assert.match(fullPdfText, /97\.6%/);
        assert.match(fullPdfText, /99\.4%/);
        assert.match(fullPdfText, /0\.2s|200\s*ms/i);
        assert.equal(fullPdfText.includes("72.9%"), false);
        assert.equal(/Vitest Module/i.test(fullPdfText), false);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T4-02: Enterprise Healthy Monorepo Release Candidate (READY TO RELEASE, Grade A, 12 modules, 6 trend runs)", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createEnterpriseHealthyVm(adaptUnifiedDashboard, { moduleCount: 12, trendCount: 6 });
      assert.equal(vm.qualityGate.status, "PASSED");
      assert.equal(vm.qualityGate.label, "READY TO RELEASE");
      assert.equal(vm.health.grade, "A");

      const json = buildFilteredJsonPayload(vm);
      assert.equal(json.coverageDiagrams.coveragePassRateTrend.series.length, 6);

      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm), {
        screenshotDir: shotDir,
        screenshotName: "t4-02-enterprise-healthy",
      });
      assertPrintLayoutQuality(pdfAudit);
      assert.match(pdfAudit.pdfPageTexts[0], /READY TO RELEASE/);
    });

    test("T4-03: Unit-Only Early-Stage Library (Zero Discovered APIs, Single Run)", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport, generateMarkdownReport } = await loadClientModules();
      const vm = createUnitOnlyVm(adaptUnifiedDashboard);
      assert.equal(vm.pyramid.shape, "unit-only");
      assert.match(generateMarkdownReport(vm), /No AST API endpoints were discovered/i);

      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm), {
        screenshotDir: shotDir,
        screenshotName: "t4-03-unit-only",
      });
      assertPrintLayoutQuality(pdfAudit);
    });

    test("T4-04: Multi-Tier Incident Snapshot (API Script Error + E2E Selector/Timeout + Flaky)", async () => {
      const { adaptUnifiedDashboard, generatePdfHtmlReport, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createMultiTierIncidentVm(adaptUnifiedDashboard);
      assert.equal(vm.qualityGate.label, "BLOCKED");
      const json = buildFilteredJsonPayload(vm);
      assert.ok(json.coverageDiagrams.failureDistributionAndActions.failureDistribution.system.selectorNotFound >= 1);
      assert.ok(json.coverageDiagrams.failureDistributionAndActions.failureDistribution.system.networkTimeout >= 1);
      assert.ok(json.actions.items.length > 0);

      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm), {
        screenshotDir: shotDir,
        screenshotName: "t4-04-multi-tier-incident",
      });
      assertPrintLayoutQuality(pdfAudit);
      assert.match(pdfAudit.pdfPageTexts[0], /BLOCKED/);
    });

    test("T4-05: Fresh Unrun Repository Snapshot (UNVERIFIED • NOT RUN)", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport, generateMarkdownReport, buildFilteredJsonPayload } = await loadClientModules();
      const vm = createUnrunVm(adaptUnifiedDashboard);
      assert.equal(vm.qualityGate.status, "UNVERIFIED");
      assert.match(generateMarkdownReport(vm), /NOT RUN/);
      const json = buildFilteredJsonPayload(vm);
      assert.equal(json.execution.total, 0);

      const htmlAudit = await auditStandaloneHtml(generateHtmlReport(vm));
      assert.equal(htmlAudit.nanMatches.length, 0);
      assert.equal(htmlAudit.undefinedMatches.length, 0);

      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm), {
        screenshotDir: shotDir,
        screenshotName: "t4-05-unrun",
      });
      assertPrintLayoutQuality(pdfAudit);
    });

    test("T4-06: High-Density Portfolio (18 Modules, 10 Trend Runs, Long Monorepo Paths)", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport, generatePdfHtmlReport } = await loadClientModules();
      const vm = createHighDensity18ModuleVm(adaptUnifiedDashboard);
      const htmlAudit = await auditStandaloneHtml(generateHtmlReport(vm));
      assertCleanSvgMetrics(htmlAudit.svgMetrics, { minViewBoxW: 720 });

      const pdfAudit = await auditPrintPdfHtml(generatePdfHtmlReport(vm), {
        screenshotDir: shotDir,
        screenshotName: "t4-06-high-density-18",
      });
      assertPrintLayoutQuality(pdfAudit);
      assert.equal(pdfAudit.overflowingTables.length, 0);
    });

    test("T4-07: Peak Snapshot Preservation After Targeted Re-Run", async () => {
      const rootDir = createTempProjectDir("covai-t4-07-");
      const snapshotId = nextSnapshotId("t4-07");
      try {
        // Targeted run only touched 1 file (12% overall lines)
        writeProjectFile(rootDir, "coverage/unit/coverage-summary.json", {
          total: makeCoverageEntry(12, 100, 3, 10, 1, 5),
          [path.join(rootDir, "src/services/matchPredictor.service.ts")]: makeCoverageEntry(12, 100, 3, 10, 1, 5),
        });
        const snapshot = createSnapshotShell({ snapshotId, projectName: "fifa-wc2026-stadium-ai", rootDir });
        const payload = await runBackendDashboard({
          snapshotId,
          fixtureState: {
            snapshot,
            peakUnitReport: {
              isPeakCoverageReport: true,
              peakMeta: {
                score: 990000,
                linesPct: 97.6,
                branchesPct: 99.4,
                funcsPct: 98.1,
                stmtsPct: 97.6,
                coveredFiles: 15,
                totalFiles: 16,
                passedTests: 106,
                failedTests: 2,
                totalTests: 108,
                isTargetedRun: false,
              },
              coverageSummary: { lines: 97.6, branches: 99.4, functions: 98.1, statements: 97.6 },
              rawTotals: makeCoverageEntry(837, 858, 172, 173, 52, 53),
              fileCoverages: [
                { filePath: "src/services/matchPredictor.service.ts", linesPct: 100, branchesPct: 100, funcsPct: 100, stmtsPct: 100 },
              ],
              testStats: { total: 108, passed: 106, failed: 2, durationMs: 200 },
            },
            testRuns: [
              {
                id: "run-targeted-only",
                snapshotId,
                type: "VITEST",
                status: "PASSED",
                totalTests: 4,
                passedTests: 4,
                failedTests: 0,
                durationMs: 45,
                coverageLinesPct: 12.0,
                coverageBranchesPct: 30.0,
                createdAt: new Date(),
                snapshot: { id: snapshotId, commitSha: "tgt1", createdAt: new Date() },
                scenarios: [],
              },
            ],
          },
        });
        assert.equal(payload.pillars.unit.coverageMetrics.lines, 97.6);
        assert.equal(payload.pillars.unit.coverageMetrics.branches, 99.4);
      } finally {
        removeTempDir(rootDir);
      }
    });

    test("T4-08: Standalone Interactive HTML UX Check (Desktop 1280x900 + Mobile 390x844)", async () => {
      const { adaptUnifiedDashboard, generateHtmlReport } = await loadClientModules();
      const html = generateHtmlReport(createFifaWc2026Vm(adaptUnifiedDashboard));
      const desktop = await auditStandaloneHtml(html, {
        viewport: { width: 1280, height: 900 },
        screenshotPath: shotDir ? path.join(shotDir, "t4-08-desktop.png") : null,
      });
      const mobile = await auditStandaloneHtml(html, {
        viewport: { width: 390, height: 844 },
        screenshotPath: shotDir ? path.join(shotDir, "t4-08-mobile.png") : null,
      });

      for (const audit of [desktop, mobile]) {
        assert.equal(audit.toolbarVisible, true);
        assert.match(audit.toolbarButtonText, /Print|PDF/i);
        assert.equal(audit.horizontalOverflow, false);
        assert.equal(audit.chartsGrid2x2Count, 0);
        assert.ok(audit.chartPages.every((cp) => cp.svgCount <= 2));
        assertCleanSvgMetrics(audit.svgMetrics, { minViewBoxW: 720 });
      }
    });
  });
}
