import fs from "fs";
import os from "os";
import path from "path";
import { parse } from "@babel/parser";
import {
  buildPrismaTestRunData,
  parseJestResults,
  parseVitestResults,
} from "../services/testResultParser.service.js";
import { extractStaticUnitTestAssertions } from "../services/testSourceParser.service.js";
import {
  applyUnitFrameworkFilter,
  mergeCoverageSummaries,
  resolveJestBin,
  syncUnitArtifactsToRoot,
} from "../services/runTestsJob.service.js";
import { isBusinessLogicSourceFile } from "../utils/businessLogicFileDetector.js";
import { buildIsolationMockContracts } from "../services/unitTestContextEngineering.service.js";
import { convertJestMocksAndStaticImportsToEsm } from "../services/esmTestRepair.service.js";
import {
  diagnoseUnitFailure,
  getFileUnitCaseCoverage,
  isTrivialCallbackFunctionName,
  matchUnitTestToFunctions,
} from "../../../shared/unitTestCaseCoverage.js";

describe("Unit Test Overhaul: Jest/Vitest runner filtering, Prisma safety, and failure diagnostics", () => {
  test("applyUnitFrameworkFilter honors explicit jest, vitest, and auto modes", () => {
    const jestFiles = ["server/src/a.test.js", "server/src/b.test.js"];
    const vitestFiles = ["client/src/c.spec.js"];

    const autoRes = applyUnitFrameworkFilter({
      jestFiles,
      vitestFiles,
      requestedFramework: "auto",
    });
    expect(autoRes.jestFiles).toEqual(jestFiles);
    expect(autoRes.vitestFiles).toEqual(vitestFiles);
    expect(autoRes.effectiveFramework).toBe("auto");
    expect(autoRes.skippedByFrameworkFilter).toBe(0);

    const jestOnly = applyUnitFrameworkFilter({
      jestFiles,
      vitestFiles,
      requestedFramework: "jest",
    });
    expect(jestOnly.jestFiles).toEqual(jestFiles);
    expect(jestOnly.vitestFiles).toEqual([]);
    expect(jestOnly.effectiveFramework).toBe("jest");
    expect(jestOnly.skippedByFrameworkFilter).toBe(1);

    const vitestOnly = applyUnitFrameworkFilter({
      jestFiles,
      vitestFiles,
      requestedFramework: "vitest",
    });
    expect(vitestOnly.jestFiles).toEqual([]);
    expect(vitestOnly.vitestFiles).toEqual(vitestFiles);
    expect(vitestOnly.effectiveFramework).toBe("vitest");
    expect(vitestOnly.skippedByFrameworkFilter).toBe(2);
  });

  test("buildPrismaTestRunData strips allSuitesFailedToLoad and preserves Prisma TestRun schema columns", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-unit-parse-"));
    try {
      const jestCrashPayload = {
        success: false,
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        numRuntimeErrorTestSuites: 1,
        startTime: 1000,
        testResults: [
          {
            name: path.join(tmpDir, "src/utils/math.test.js"),
            status: "failed",
            message: "Cannot find module '../missing.js' from 'src/utils/math.test.js'",
            startTime: 1000,
            endTime: 1200,
            assertionResults: [],
          },
        ],
      };
      fs.writeFileSync(
        path.join(tmpDir, "jest-results.json"),
        JSON.stringify(jestCrashPayload),
        "utf8",
      );

      const parsedJest = parseJestResults(tmpDir, { rootDir: tmpDir });
      expect(parsedJest.allSuitesFailedToLoad).toBe(true);
      expect(parsedJest.status).toBe("FAILED");

      const prismaPayload = buildPrismaTestRunData("snap-1", "JEST", parsedJest);
      expect(prismaPayload).not.toBeNull();
      expect("allSuitesFailedToLoad" in prismaPayload).toBe(false);
      expect(prismaPayload.snapshotId).toBe("snap-1");
      expect(prismaPayload.type).toBe("JEST");
      expect(prismaPayload.status).toBe("FAILED");
      expect(prismaPayload.scenarios?.create?.length).toBe(1);

      fs.writeFileSync(
        path.join(tmpDir, "vitest-results.json"),
        JSON.stringify(jestCrashPayload),
        "utf8",
      );
      const parsedVitest = parseVitestResults(tmpDir, { rootDir: tmpDir });
      expect(parsedVitest.allSuitesFailedToLoad).toBe(true);
      expect(parsedVitest.status).toBe("FAILED");

      const prismaVitest = buildPrismaTestRunData("snap-1", "VITEST", parsedVitest);
      expect("allSuitesFailedToLoad" in prismaVitest).toBe(false);
      expect(prismaVitest.type).toBe("VITEST");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("diagnoseUnitFailure classifies module, syntax/ESM, mock hoisting, timeout, and assertion errors", () => {
    const modDiag = diagnoseUnitFailure({
      status: "failed",
      failureMessages: ["Error: Cannot find module 'axios' from 'src/services/api.js'"],
    });
    expect(modDiag.failureLayer).toBe("MODULE_NOT_FOUND");
    expect(modDiag.suggestedFix).toContain("axios");

    const esmDiag = diagnoseUnitFailure({
      status: "failed",
      failureMessages: ["SyntaxError: Cannot use import statement outside a module\n  at src/utils/calc.js:1:1"],
    });
    expect(esmDiag.failureLayer).toBe("SYNTAX_ERROR");
    expect(esmDiag.locationHint).toBe("src/utils/calc.js:1:1");

    const mockDiag = diagnoseUnitFailure({
      status: "failed",
      failureMessages: [
        "ReferenceError: The module factory of `jest.mock()` is not allowed to reference any out-of-scope variables.",
      ],
    });
    expect(mockDiag.failureLayer).toBe("MOCK_ERROR");

    const timeoutDiag = diagnoseUnitFailure({
      status: "failed",
      failureMessages: ["Error: Test timed out in 5000ms."],
    });
    expect(timeoutDiag.failureLayer).toBe("TIMEOUT");

    const assertDiag = diagnoseUnitFailure({
      status: "failed",
      failureMessages: ["AssertionError: expected 4 to deeply equal 5\nExpected: 5\nReceived: 4"],
    });
    expect(assertDiag.failureLayer).toBe("ASSERTION_FAILED");
    expect(assertDiag.explanation).toContain("Expected 5");
    expect(assertDiag.explanation).toContain("received 4");

    expect(diagnoseUnitFailure({ status: "passed", failureMessages: [] })).toBeNull();
  });

  test("extractStaticUnitTestAssertions extracts Jest and Vitest test blocks before execution", () => {
    const code = `
      import { describe, it, test, expect } from "vitest";
      describe("session.service", () => {
        describe("getSessions", () => {
          it("computes pagination metadata", async () => {
            expect(1).toBe(1);
          });
          test.skip("handles edge cursor", () => {});
        });
      });
    `;
    const assertions = extractStaticUnitTestAssertions(code, "server/tests/unit/session.service.test.js");
    expect(assertions).toHaveLength(2);
    expect(assertions[0]).toMatchObject({
      title: "computes pagination metadata",
      ancestorTitles: ["session.service", "getSessions"],
      status: "not_run",
    });
    expect(assertions[0].code).toContain("expect(1).toBe(1)");
    expect(assertions[1]).toMatchObject({
      title: "handles edge cursor",
      status: "pending",
    });
  });

  test("syncUnitArtifactsToRoot copies unit -> root one-way without letting integration files overwrite coverage/unit", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-unit-isolation-"));
    try {
      const rootCovDir = path.join(tmpDir, "coverage");
      const unitCovDir = path.join(rootCovDir, "unit");
      fs.mkdirSync(unitCovDir, { recursive: true });

      const supertestSummary = { total: { lines: { pct: 100 } }, "routes/api.js": { lines: { pct: 100 } } };
      fs.writeFileSync(path.join(rootCovDir, "coverage-summary.json"), JSON.stringify(supertestSummary), "utf8");

      // If unit coverage has not produced a file yet, root Supertest summary must NOT be copied into coverage/unit
      syncUnitArtifactsToRoot(unitCovDir, rootCovDir);
      expect(fs.existsSync(path.join(unitCovDir, "coverage-summary.json"))).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(rootCovDir, "coverage-summary.json"), "utf8"))).toEqual(supertestSummary);

      // Once unit coverage writes its own file, sync copies unit -> root only
      const unitSummary = { total: { lines: { pct: 42 } }, "services/calc.js": { lines: { pct: 42 } } };
      fs.writeFileSync(path.join(unitCovDir, "coverage-summary.json"), JSON.stringify(unitSummary), "utf8");
      const copied = syncUnitArtifactsToRoot(unitCovDir, rootCovDir);
      expect(copied).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(rootCovDir, "coverage-summary.json"), "utf8"))).toEqual(unitSummary);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("filters parenthesized anonymous callbacks, tracks multi-function scenarios via @covers & callgraph, and refuses to mark failed functions as 100% covered", () => {
    expect(isTrivialCallbackFunctionName("(anonymous_1)()")).toBe(true);
    expect(isTrivialCallbackFunctionName("(anonymous_14)")).toBe(true);

    const file = {
      funcsTotal: 19,
      funcsCovered: 19,
      linesPct: 94,
      functionCallees: {
        getWeeklyReadingTopicStats: ["getDayName", "calculateActiveSessionDuration"],
      },
    };
    const fns = [
      { functionName: "getWeeklyReadingTopicStats", startLine: 13, hit: 1 },
      { functionName: "getDayName", startLine: 53, hit: 3 },
      { functionName: "calculateActiveSessionDuration", startLine: 102, hit: 1 },
      { functionName: "fetchStats", startLine: 136, hit: 2 },
      { functionName: "getArticleSessionStats", startLine: 156, hit: 2 },
      { functionName: "(anonymous_1)", startLine: 25, hit: 7 },
      { functionName: "(anonymous_6)", startLine: 163, hit: 2 },
    ];
    const tests = [
      {
        id: "t1",
        title: "aggregates weekly reading time and unique domains",
        code: "await statsService.getWeeklyReadingTopicStats();",
        status: "passed",
        origin: "PROJECT_EXISTING",
      },
      {
        id: "t2",
        title: "handles fetchStats success and error fallback",
        code: "// @covers fetchStats\nawait statsService.fetchStats();",
        status: "passed",
        origin: "PROJECT_EXISTING",
      },
      {
        id: "t3",
        title: "computes comprehensive article and session statistics",
        code: "await statsService.getArticleSessionStats();",
        status: "passed",
        origin: "PROJECT_EXISTING",
      },
      {
        id: "t4",
        title: "returns null avgReadTimePerArticle when no articles exist",
        code: "await statsService.getArticleSessionStats();",
        status: "failed",
        origin: "PROJECT_EXISTING",
      },
    ];

    const cov = getFileUnitCaseCoverage(file, fns, tests);
    // Only the 5 real business functions remain (anonymous_1 / anonymous_6 excluded)
    expect(cov.functionCoverage.totalFunctions).toBe(5);
    // getArticleSessionStats has a failing assertion, so it MUST NOT count as verified covered (4/5 instead of 5/5 or 19/19)
    expect(cov.functionCoverage.coveredFunctions).toBe(4);
    expect(cov.functionCoverage.isAllFunctionsCovered).toBe(false);

    // Scenario t1 maps to getWeeklyReadingTopicStats + its internal helpers getDayName & calculateActiveSessionDuration
    expect(cov.scenarioAnnotations.t1.targetFunctions).toEqual([
      "getWeeklyReadingTopicStats",
      "getDayName",
      "calculateActiveSessionDuration",
    ]);
    expect(cov.scenarioAnnotations.t1.badgeLabel).toBe(
      "Fn: getWeeklyReadingTopicStats(), getDayName(), calculateActiveSessionDuration()",
    );

    const staticParsed = extractStaticUnitTestAssertions(
      `// @covers helperA, helperB\nit("exercises exported flow", () => { runFlow(); });`,
      "tests/unit/flow.test.js",
    );
    expect(staticParsed[0].targetFunctions).toEqual(["helperA", "helperB"]);
    const directMatches = matchUnitTestToFunctions(staticParsed[0], [
      { key: "1", name: "runFlow" },
      { key: "2", name: "helperA" },
      { key: "3", name: "helperB" },
    ]);
    expect(directMatches.map((m) => m.name)).toEqual(["helperA", "helperB", "runFlow"]);
  });

  test("lcov-report artifacts are excluded from business logic detection and merged coverage summaries", () => {
    expect(isBusinessLogicSourceFile("lcov-report/block-navigation.js")).toBe(false);
    expect(isBusinessLogicSourceFile("lcov-report/prettify.js")).toBe(false);
    expect(isBusinessLogicSourceFile("lcov-report/sorter.js")).toBe(false);
    expect(isBusinessLogicSourceFile("coverage/lcov-report/index.html")).toBe(false);
    expect(isBusinessLogicSourceFile("server/src/controllers/ai.controller.js")).toBe(true);

    const merged = mergeCoverageSummaries(
      { "lcov-report/sorter.js": { lines: { total: 10, covered: 0, pct: 0 } } },
      { "server/src/controllers/ai.controller.js": { lines: { total: 10, covered: 8, pct: 80 } } },
    );
    expect(Object.keys(merged)).toEqual(["server/src/controllers/ai.controller.js", "total"]);
  });

  test("ESM mock repair hoists _createStubMaker transitively, wraps object-literal arrow contracts, injects let req/res/next, and drops uninstalled virtual mocks", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-esm-repair-"));
    try {
      fs.mkdirSync(path.join(tmpRoot, "server/src/services"), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, "server/src/controllers"), { recursive: true });
      const serviceCode = "export const getConfigStatus = () => ({ ok: true });";
      const controllerCode = `
        import SandboxService from "../services/sandbox.service.js";
        export const getConfig = (req, res) => res.json(SandboxService.getConfigStatus());
      `;
      fs.writeFileSync(path.join(tmpRoot, "server/src/services/sandbox.service.js"), serviceCode, "utf8");
      fs.writeFileSync(path.join(tmpRoot, "server/src/controllers/sandbox.controller.js"), controllerCode, "utf8");

      const contracts = buildIsolationMockContracts({
        sourceCode: controllerCode,
        rootDir: tmpRoot,
        sourceFile: "server/src/controllers/sandbox.controller.js",
        targetTestFile: "server/tests/controllers/sandbox.controller.test.js",
        framework: "jest",
      });
      const sampleInput = `
        ${contracts.mockPreambleCode || ""}
        jest.mock("stripe", () => ({ default: jest.fn() }), { virtual: true });
        import { getConfig } from "../../src/controllers/sandbox.controller.js";
        describe("sandbox controller", () => {
          beforeEach(() => {
            req = { body: {} };
            res = { json: jest.fn() };
            next = jest.fn();
          });
          it("works", () => getConfig(req, res, next));
        });
      `;

      const repaired = convertJestMocksAndStaticImportsToEsm(sampleInput, {
        testFilePath: "server/tests/controllers/sandbox.controller.test.js",
        sourceCode: [{ path: "server/src/controllers/sandbox.controller.js", content: controllerCode }],
        rootDir: tmpRoot,
        targetSourceFile: "server/src/controllers/sandbox.controller.js",
      });

      expect(() => parse(repaired, { sourceType: "module" })).not.toThrow();
      const stubIdx = repaired.indexOf("var _createStubMaker");
      const mockIdx = repaired.indexOf("jest.unstable_mockModule");
      expect(stubIdx).toBeGreaterThan(-1);
      expect(mockIdx).toBeGreaterThan(stubIdx);
      expect(repaired).not.toMatch(/jest\.unstable_mockModule\(\s*['"]stripe['"]/);
      expect(repaired).toMatch(/\blet\s+req,\s*res,\s*next;/);

      // Subpackage resolveJestBin falls back to host CovAI jest binary instead of non-existent ./node_modules
      const resolvedBin = resolveJestBin(path.join(tmpRoot, "server"), true);
      expect(resolvedBin).toContain("jest.js");
      expect(resolvedBin).not.toBe("node --experimental-vm-modules node_modules/jest/bin/jest.js");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("passed scenarios increment unit function coverage count even without Istanbul line hits and avoid false Duplicate badges across distinct existing scenarios", () => {
    const file = {
      filePath: "server/src/services/stats.service.js",
      linesPct: 0,
      funcsPct: 0,
      functionCallees: {
        getWeeklyReadingTopicStats: ["getDayName", "calculateActiveSessionDuration"],
      },
    };
    const fns = [
      { key: "getWeeklyReadingTopicStats:13", functionName: "getWeeklyReadingTopicStats", startLine: 13, hit: 0 },
      { key: "getDayName:53", functionName: "getDayName", startLine: 53, hit: 0 },
      { key: "calculateActiveSessionDuration:102", functionName: "calculateActiveSessionDuration", startLine: 102, hit: 0 },
      { key: "fetchStats:136", functionName: "fetchStats", startLine: 136, hit: 0 },
      { key: "getArticleSessionStats:156", functionName: "getArticleSessionStats", startLine: 156, hit: 0 },
    ];
    const tests = [
      {
        id: "t1",
        title: "aggregates weekly reading time",
        code: "await getWeeklyReadingTopicStats();",
        status: "passed",
        origin: "PROJECT_EXISTING",
        testFile: "server/tests/unit/stats.service.test.js",
      },
      {
        id: "t2",
        title: "computes article statistics",
        code: "await getArticleSessionStats();",
        status: "passed",
        origin: "PROJECT_EXISTING",
        testFile: "server/tests/unit/stats.service.test.js",
      },
      {
        id: "t3",
        title: "handles fetchStats success",
        code: "await fetchStats();",
        status: "passed",
        origin: "PROJECT_EXISTING",
        testFile: "server/tests/unit/stats.service.test.js",
      },
      {
        id: "t4",
        title: "returns null when no articles exist",
        code: "await getArticleSessionStats();",
        status: "failed",
        origin: "PROJECT_EXISTING",
        testFile: "server/tests/unit/stats.service.test.js",
      },
    ];
    const covStats = getFileUnitCaseCoverage(file, fns, tests);
    // 4 passed (getWeeklyReadingTopicStats, getDayName, calculateActiveSessionDuration, fetchStats), 1 failed (getArticleSessionStats)
    expect(covStats.functionCoverage.coveredFunctions).toBe(4);
    expect(covStats.functionCoverage.totalFunctions).toBe(5);
    expect(covStats.functionCoverage.functions.filter((f) => f.passed).length).toBe(4);
    expect(covStats.functionCoverage.functions.find((f) => f.name === "getArticleSessionStats").failed).toBe(true);

    // 1-function file with 4 distinct existing scenarios should NOT mark distinct cases as Duplicate
    const singleFile = { filePath: "server/src/services/session.service.js", linesPct: 0, funcsPct: 0 };
    const singleFns = [{ key: "getSessions:3", functionName: "getSessions", startLine: 3, hit: 0 }];
    const singleTests = [
      { id: "s1", title: "computes pagination metadata", status: "passed", origin: "PROJECT_EXISTING", testFile: "server/tests/unit/session.service.test.js" },
      { id: "s2", title: "recalculates active time from unsorted events", status: "passed", origin: "PROJECT_EXISTING", testFile: "server/tests/unit/session.service.test.js" },
      { id: "s3", title: "handles legacy ACTIVE events still open", status: "passed", origin: "PROJECT_EXISTING", testFile: "server/tests/unit/session.service.test.js" },
      { id: "s4", title: "filters out zero active time sessions", status: "passed", origin: "PROJECT_EXISTING", testFile: "server/tests/unit/session.service.test.js" },
      { id: "s5", title: "redundant test from redundant suite", status: "passed", origin: "PROJECT_EXISTING", testFile: "server/tests/unit/session.redundant.test.js" },
    ];
    const covSingle = getFileUnitCaseCoverage(singleFile, singleFns, singleTests);
    expect(covSingle.functionCoverage.coveredFunctions).toBe(1);
    expect(covSingle.functionCoverage.totalFunctions).toBe(1);
    expect(covSingle.redundantCount).toBe(1);
    expect(covSingle.scenarioAnnotations.s3.badgeType).toBe("PRIMARY_PASS");
    expect(covSingle.scenarioAnnotations.s5.badgeType).toBe("DUPLICATE");
  });

  test("preserves bare ESM mocks referenced by source code, extracts Zod controller fields, and enriches chrome DOM shim dispatchers", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-esm-src-mock-"));
    try {
      const cronSrcPath = path.join(tmpRoot, "server/src/cron/cleanup.cron.js");
      fs.mkdirSync(path.dirname(cronSrcPath), { recursive: true });
      const cronSrc = `
        import cron from "node-cron";
        export const startCleanupJob = () => cron.schedule("0 * * * *", async () => {});
      `;
      fs.writeFileSync(cronSrcPath, cronSrc, "utf8");

      const contracts = buildIsolationMockContracts({
        sourceCode: cronSrc,
        rootDir: tmpRoot,
        sourceFile: "server/src/cron/cleanup.cron.js",
        targetTestFile: "server/tests/cron/cleanup.cron.test.js",
        framework: "jest",
      });
      const sample = `
        ${contracts.mockPreambleCode}
        import { startCleanupJob } from "../../src/cron/cleanup.cron.js";
        test("runs", () => startCleanupJob());
      `;
      const repaired = convertJestMocksAndStaticImportsToEsm(sample, {
        testFilePath: "server/tests/cron/cleanup.cron.test.js",
        sourceCode: [{ path: "server/src/cron/cleanup.cron.js", content: cronSrc }],
        rootDir: tmpRoot,
        targetSourceFile: "server/src/cron/cleanup.cron.js",
      });
      expect(repaired).toMatch(/jest\.unstable_mockModule\(\s*['"]node-cron['"]/);

      // Zod controller body key extraction
      const ctrlSrc = `
        import { z } from "zod";
        const eventSchema = z.object({ event_type: z.enum(["PAGE_ENTER"]), url: z.string(), session_id: z.string() });
        export const createEvent = async (req, res) => { const p = eventSchema.parse(req.body); return res.status(201).json(p); };
      `;
      const draft = generateFallbackUnitTests({
        framework: "jest",
        sourceFile: "server/src/controllers/event.controller.js",
        targetTestFile: "server/tests/controllers/event.controller.test.js",
        rootDir: tmpRoot,
        baseName: "event.controller",
        sourceCode: ctrlSrc,
      });
      expect(draft.fullUpdatedContent).toContain('"event_type"');
      expect(draft.fullUpdatedContent).toContain('"PAGE_ENTER"');
      expect(draft.fullUpdatedContent).toContain('"session_id"');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
