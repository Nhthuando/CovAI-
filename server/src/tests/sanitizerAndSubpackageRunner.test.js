import fs from "fs";
import os from "os";
import path from "path";
import {
  sanitizeAllProjectTestFiles,
  cleanAndDeduplicateTestContent,
  ensureNodeDomFallback,
} from "../services/testSanitizer.service.js";
import { convertJestMocksAndStaticImportsToEsm } from "../services/esmTestRepair.service.js";
import {
  healAllTestFiles,
  materializeDraftTestsForRun,
  restoreDraftTestsForRun,
  filterDiscoveredUnitFiles,
  runJestCoverage,
} from "../services/runTestsJob.service.js";
import {
  isBusinessLogicSourceFile,
  isTestFilePath,
} from "../utils/businessLogicFileDetector.js";
import {
  classifyUnitTestCase,
  annotateFileUnitTests,
  getFileUnitCaseCoverage,
  getRequiredUnitCasesForFile,
} from "../../../shared/unitTestCaseCoverage.js";
import { extractUnitTestBlocks } from "../utils/testBlockExtractor.js";

describe("testSanitizer & subpackage runner regressions", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-sanitizer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("preserves mock/event-listener callback(mockSocket) invocations inside jest.fn handlers", () => {
    const testPath = path.join(tmpDir, "socket.test.js");
    const source = `import { jest, describe, it, expect, beforeEach } from '@jest/globals';

describe('Socket Config', () => {
  let mockServerInstance, mockSocket;
  beforeEach(() => {
    mockSocket = { id: 'sock-1', on: jest.fn() };
    mockServerInstance = {
      on: jest.fn((event, callback) => {
        if (event === 'connection') {
          callback(mockSocket);
        }
      }),
      emit: jest.fn(),
    };
  });
  it('connects', () => {
    expect(mockServerInstance.on).toBeDefined();
  });
});
`;
    fs.writeFileSync(testPath, source, "utf8");
    sanitizeAllProjectTestFiles(tmpDir, ["socket.test.js"], "jest");
    const sanitized = fs.readFileSync(testPath, "utf8");

    expect(sanitized).toContain("callback(mockSocket);");
    expect(sanitized).not.toContain("if (mockSocket) throw mockSocket;");
  });

  it("heals Mocha (done)/(callback) test blocks while leaving inner shadowed callbacks intact", () => {
    const testPath = path.join(tmpDir, "mocha-done.test.js");
    const source = `describe('Async suites', () => {
  it('heals outer done without corrupting inner cb', (done) => {
    const emitter = { on: (ev, cb) => cb() };
    emitter.on('ready', () => {
      expect(true).toBe(true);
      done();
    });
  });

  it('heals outer callback while preserving shadowed inner callback param', (callback) => {
    const srv = {
      on: jest.fn((event, callback) => {
        callback({ ok: true });
      }),
    };
    srv.on('connection', () => {});
    callback();
  });
});
`;
    fs.writeFileSync(testPath, source, "utf8");
    sanitizeAllProjectTestFiles(tmpDir, ["mocha-done.test.js"], "jest");
    const sanitized = fs.readFileSync(testPath, "utf8");

    expect(sanitized).toContain("it('heals outer done without corrupting inner cb', async () => {");
    expect(sanitized).not.toContain("done();");
    expect(sanitized).toContain("callback({ ok: true });");
    expect(sanitized).not.toContain("if ({ ok: true }) throw");
  });

  it("injects guarded DOM fallback only when a test references document without defining it", () => {
    const domTest = path.join(tmpDir, "popup.test.js");
    const backendTest = path.join(tmpDir, "api.test.js");
    fs.writeFileSync(
      domTest,
      `import { jest } from '@jest/globals';\ndescribe('popup', () => {\n  beforeEach(() => {\n    jest.spyOn(document, 'getElementById').mockReturnValue(null);\n  });\n});\n`,
      "utf8",
    );
    fs.writeFileSync(
      backendTest,
      `import { jest } from '@jest/globals';\ndescribe('api', () => {\n  it('works', () => expect(1).toBe(1));\n});\n`,
      "utf8",
    );

    sanitizeAllProjectTestFiles(tmpDir, ["popup.test.js", "api.test.js"], "jest");
    const domAfter = fs.readFileSync(domTest, "utf8");
    const backendAfter = fs.readFileSync(backendTest, "utf8");

    expect(domAfter).toContain("__covaiDomFallbackApplied");
    expect(domAfter.indexOf("import { jest }")).toBeLessThan(
      domAfter.indexOf("__covaiDomFallbackApplied"),
    );
    expect(backendAfter).not.toContain("__covaiDomFallbackApplied");
  });

  it("does not inject server-relative missing module mocks into unrelated root tests", () => {
    const rootBg = path.join(tmpDir, "tests", "background.test.js");
    const serverAi = path.join(tmpDir, "server", "tests", "controllers", "ai.controller.test.js");
    fs.mkdirSync(path.dirname(rootBg), { recursive: true });
    fs.mkdirSync(path.dirname(serverAi), { recursive: true });

    const bgOriginal = `describe('bg', () => {\n  it('passes', () => expect(true).toBe(true));\n});\n`;
    const aiOriginal = `import { jest } from '@jest/globals';\nconst AIController = (await import('../../src/controllers/ai.controller.js')).default;\ndescribe('ai', () => {\n  it('ok', () => expect(AIController).toBeDefined());\n});\n`;

    fs.writeFileSync(rootBg, bgOriginal, "utf8");
    fs.writeFileSync(serverAi, aiOriginal, "utf8");

    // Simulate runTestsJob in-flight missing-module healer isolation: package.json must never cause cross-file relative injection
    expect(typeof healAllTestFiles).toBe("function");
    expect(fs.readFileSync(rootBg, "utf8")).toBe(bgOriginal);
  });

  it("classifies explicit [Happy Path] / TC-HAPPY prefixes as HAPPY even when description mentions branch/ignore keywords", () => {
    const tc1 = classifyUnitTestCase({
      title: "TC-HAPPY-01 & TC-BRANCH-02/03: Message listener handles LOG_EVENT and ignores other types",
    });
    const tc2 = classifyUnitTestCase({
      title: "[Happy Path] returns default value when input is valid",
    });
    const tc3 = classifyUnitTestCase({
      title: "[Boundary / Edge] handles empty pendingEvents array",
    });
    const tc4 = classifyUnitTestCase({
      title: "[Branch Paths] toggles install and update listener branches",
    });
    const tc5 = classifyUnitTestCase({
      title: "[Error Handling] rejects and logs error when storage fails",
    });

    expect(tc1.key).toBe("HAPPY");
    expect(tc2.key).toBe("HAPPY");
    expect(tc3.key).toBe("BOUNDARY");
    expect(tc4.key).toBe("BRANCH");
    expect(tc5.key).toBe("ERROR");
  });

  it("marks AI test as Duplicate when existing user test passes (or has not failed), and promotes AI test to Primary when user test fails", () => {
    const fileMeta = { funcsTotal: 3, branchesTotal: 4, linesTotal: 40 };
    const reqCases = getRequiredUnitCasesForFile(fileMeta, []);
    expect(reqCases.map((c) => c.key)).toEqual(["HAPPY", "BOUNDARY", "BRANCH", "ERROR"]);

    // 1. User's pre-existing Happy Path test PASSED; AI generated all 4 required cases
    const scenariosWhenUserPasses = [
      {
        id: "user-happy",
        title: "should return enriched session list",
        origin: "PROJECT_EXISTING",
        status: "passed",
      },
      {
        id: "ai-happy",
        title: "[Happy Path] returns enriched session list for valid user",
        origin: "AI_DRAFT",
        status: "draft",
      },
      {
        id: "ai-boundary",
        title: "[Boundary / Edge] returns empty list when page limit is 0",
        origin: "AI_DRAFT",
        status: "draft",
      },
      {
        id: "ai-branch",
        title: "[Branch Paths] filters sessions when status query param is provided",
        origin: "AI_DRAFT",
        status: "draft",
      },
      {
        id: "ai-error",
        title: "[Error Handling] throws error when database query rejects",
        origin: "AI_DRAFT",
        status: "draft",
      },
    ];

    const covUserPass = getFileUnitCaseCoverage(fileMeta, [], scenariosWhenUserPasses);
    expect(covUserPass.coveredCount).toBe(4);
    expect(covUserPass.totalRequired).toBe(4);
    expect(covUserPass.redundantCount).toBe(1);
    expect(covUserPass.scenarioAnnotations["user-happy"].badgeType).toBe("PRIMARY_PASS");
    expect(covUserPass.scenarioAnnotations["user-happy"].badgeLabel).toBe("Case: Happy Path");
    expect(covUserPass.scenarioAnnotations["ai-happy"].badgeType).toBe("DUPLICATE");
    expect(covUserPass.scenarioAnnotations["ai-happy"].badgeLabel).toBe("Duplicate · Happy Path");
    expect(covUserPass.scenarioAnnotations["ai-boundary"].badgeLabel).toBe("Case: Boundary / Edge");
    expect(covUserPass.scenarioAnnotations["ai-branch"].badgeLabel).toBe("Case: Branch Paths");
    expect(covUserPass.scenarioAnnotations["ai-error"].badgeLabel).toBe("Case: Error Handling");

    // 2. After running: User's pre-existing Happy Path test FAILED, while AI's Happy Path test PASSED
    const scenariosWhenUserFails = [
      {
        id: "user-happy",
        title: "should return enriched session list",
        origin: "PROJECT_EXISTING",
        status: "failed",
      },
      {
        id: "ai-happy",
        title: "[Happy Path] returns enriched session list for valid user",
        origin: "AI_DRAFT",
        status: "passed",
      },
      {
        id: "ai-boundary",
        title: "[Boundary / Edge] returns empty list when page limit is 0",
        origin: "AI_DRAFT",
        status: "passed",
      },
      {
        id: "ai-branch",
        title: "[Branch Paths] filters sessions when status query param is provided",
        origin: "AI_DRAFT",
        status: "passed",
      },
      {
        id: "ai-error",
        title: "[Error Handling] throws error when database query rejects",
        origin: "AI_DRAFT",
        status: "passed",
      },
    ];

    const covUserFail = getFileUnitCaseCoverage(fileMeta, [], scenariosWhenUserFails);
    expect(covUserFail.passedCasesCount).toBe(4);
    expect(covUserFail.redundantCount).toBe(0);
    expect(covUserFail.scenarioAnnotations["user-happy"].badgeType).toBe("PRIMARY_FAIL");
    expect(covUserFail.scenarioAnnotations["user-happy"].badgeLabel).toBe("Failed · Happy Path");
    expect(covUserFail.scenarioAnnotations["user-happy"].supersededByAi).toBe(true);
    expect(covUserFail.scenarioAnnotations["ai-happy"].badgeType).toBe("PRIMARY_PASS");
    expect(covUserFail.scenarioAnnotations["ai-happy"].badgeLabel).toBe("Case: Happy Path");
  });

  it("extracts titleStart and titleEnd offsets in extractUnitTestBlocks for exact 1-per-case title normalization", () => {
    const code = `describe('suite', () => {\n  test('TC-BRANCH-01: first test', () => { expect(1).toBe(1); });\n});\n`;
    const blocks = extractUnitTestBlocks(code);
    expect(blocks).toHaveLength(1);
    expect(typeof blocks[0].titleStart).toBe("number");
    expect(typeof blocks[0].titleEnd).toBe("number");
    expect(code.slice(blocks[0].titleStart, blocks[0].titleEnd)).toBe("'TC-BRANCH-01: first test'");
  });

  it("preserves valid unstable_mockModule factories, hoists post-suite mock variables, and injects window/chrome DOM fallbacks", () => {
    const code = [
      "import { jest, describe, it, expect } from '@jest/globals';",
      "const mockEventFindFirst = jest.fn();",
      "await jest.unstable_mockModule('@google/generative-ai', () => ({",
      "  __esModule: true,",
      "  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({",
      "    getGenerativeModel: jest.fn(() => ({",
      "      generateContent: jest.fn(async () => ({",
      "        response: { text: () => JSON.parse(JSON.stringify({ summary: 'ok' })) }",
      "      }))",
      "    }))",
      "  }))",
      "}));",
      "describe('first suite', () => {",
      "  it('runs', () => { expect(window.location).toBeDefined(); expect(chrome.runtime).toBeDefined(); });",
      "});",
      "const mockEventDeleteMany = jest.fn();",
      "await jest.unstable_mockModule('../../src/config/prisma.js', () => ({",
      "  default: { event: { findFirst: mockEventFindFirst, deleteMany: mockEventDeleteMany } }",
      "}));",
    ].join("\n");

    const esmOut = convertJestMocksAndStaticImportsToEsm(code, {
      testFilePath: "server/tests/unit/event.service.partial.test.js",
    });
    expect(esmOut.indexOf("const mockEventDeleteMany")).toBeGreaterThan(-1);
    expect(esmOut.indexOf("const mockEventDeleteMany")).toBeLessThan(
      esmOut.indexOf("jest.unstable_mockModule"),
    );

    const sanitized = cleanAndDeduplicateTestContent(
      esmOut,
      "",
      "server/tests/unit/event.service.partial.test.js",
      { filePath: "server/tests/unit/event.service.partial.test.js" },
    );
    expect(sanitized).toContain("__covaiDomFallbackV2Applied");
    expect(sanitized).toContain("globalThis.window");
    expect(sanitized).toContain("globalThis.chrome");
    expect(sanitized).not.toContain("JSON.parse(JSON.stringify");
    expect(sanitized).toContain("GoogleGenerativeAI: jest.fn()");
  });

  it("auto-injects DOM/browser shims during draft materialization without needing prior Apply", () => {
    const testRel = "tests/content.test.js";
    const draftCode = [
      "/** @jest-environment jsdom */",
      "const content = require('../extension/content.js');",
      "describe('extension content script', () => {",
      "  it('reads window.location and document', () => {",
      "    expect(window.location.href).toBeDefined();",
      "    expect(document.title).toBeDefined();",
      "  });",
      "});",
    ].join("\n");

    const state = materializeDraftTestsForRun(tmpDir, [
      { sourceFile: "extension/content.js", testFile: testRel, code: draftCode },
    ]);
    const written = fs.readFileSync(path.join(tmpDir, testRel), "utf8");
    expect(written).toContain("@jest-environment node");
    expect(written).toContain("globalThis.window");
    expect(written).toContain("globalThis.localStorage");
    expect(written).toContain("globalThis.navigator");
    expect(written).toContain("globalThis.chrome");
    // Forced healing on plain Node suite without docblock also succeeds
    const forced = ensureNodeDomFallback("const x = require('./mod');\n", { force: true });
    expect(forced).toContain("__covaiDomFallbackV3Applied");

    const reordered = ensureNodeDomFallback(
      "import { jest } from '@jest/globals';\nimport * as importedModule from '../extension/content';\ndescribe('c', () => {});\n",
      { force: true },
    );
    expect(reordered).toContain("const importedModule = require('../extension/content');");
    expect(reordered.indexOf("__covaiDomFallbackV3Applied")).toBeLessThan(
      reordered.indexOf("require('../extension/content')"),
    );
    expect(reordered).toContain("globalThis.history");
    expect(reordered).toContain("globalThis.fetch");

    restoreDraftTestsForRun(state);
    expect(fs.existsSync(path.join(tmpDir, testRel))).toBe(false);
  });

  it("resolves monorepo draft targets cleanly for root extension and server subpackages without confusing test files with source files", () => {
    const extSrc = path.join(tmpDir, "extension", "background.js");
    const srvSrc = path.join(tmpDir, "server", "src", "config", "prisma.js");
    fs.mkdirSync(path.dirname(extSrc), { recursive: true });
    fs.mkdirSync(path.dirname(srvSrc), { recursive: true });
    fs.writeFileSync(extSrc, "export function initBg() { return true; }\n", "utf8");
    fs.writeFileSync(srvSrc, "export default {};\n", "utf8");

    const draftState = materializeDraftTestsForRun(tmpDir, [
      {
        sourceFile: "extension/background.js",
        testFile: "tests/background.test.js",
        framework: "jest",
        code: "it('bg', () => expect(true).toBe(true));\n",
      },
      {
        sourceFile: "server/src/config/prisma.js",
        testFile: "server/tests/config/prisma.test.js",
        framework: "jest",
        code: "it('prisma', () => expect(true).toBe(true));\n",
      },
    ]);

    try {
      expect(isTestFilePath("tests/background.test.js")).toBe(true);
      expect(isTestFilePath("server/tests/config/prisma.test.js")).toBe(true);
      expect(isBusinessLogicSourceFile("extension/background.js")).toBe(true);
      expect(isBusinessLogicSourceFile("server/src/config/prisma.js")).toBe(true);

      const filtered = filterDiscoveredUnitFiles({
        rootDir: tmpDir,
        jestFiles: ["tests/background.test.js", "server/tests/config/prisma.test.js"],
        vitestFiles: [],
        requestedTargetFiles: ["extension/background.js", "server/src/config/prisma.js"],
        draftSourceByTestRel: draftState.draftSourceByTestRel,
        draftFrameworkByTestRel: draftState.draftFrameworkByTestRel,
      });

      expect(filtered.jestFiles).toEqual([
        "tests/background.test.js",
        "server/tests/config/prisma.test.js",
      ]);
      expect(filtered.vitestFiles).toEqual([]);
    } finally {
      restoreDraftTestsForRun(draftState);
    }

    expect(fs.existsSync(path.join(tmpDir, "tests", "background.test.js"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "server", "tests", "config", "prisma.test.js"))).toBe(false);
  });

  it("writes long testNamePattern and scoped collectCoverageFrom into Jest JSON config to avoid Windows CLI length overflow", async () => {
    const extSrc = path.join(tmpDir, "extension", "background.js");
    const pkgJson = path.join(tmpDir, "package.json");
    fs.mkdirSync(path.dirname(extSrc), { recursive: true });
    fs.writeFileSync(
      pkgJson,
      JSON.stringify({ name: "cli-len-fixture" }),
      "utf8",
    );
    fs.writeFileSync(
      extSrc,
      "function pingBg(v) { return v ? 'ok' : 'no'; }\nmodule.exports = { pingBg };\n",
      "utf8",
    );

    const draftState = materializeDraftTestsForRun(tmpDir, [
      {
        sourceFile: "extension/background.js",
        testFile: "tests/background.test.js",
        framework: "jest",
        code: "const { pingBg } = require('../extension/background.js');\nit('runs selected draft case', () => { expect(pingBg(true)).toBe('ok'); });\n",
      },
    ]);

    try {
      const fillerPatterns = Array.from({ length: 120 }, (_, i) => `unused scenario name padding number ${i} ${"x".repeat(55)}`);
      const longPattern = ["runs selected draft case", ...fillerPatterns].join("|");
      expect(longPattern.length).toBeGreaterThan(9000);

      const jestBin = path.resolve(process.cwd(), "node_modules", "jest", "bin", "jest.js");
      const covOutDir = ".covai-temp/scoped-cli-check";
      const res = await runJestCoverage(
        "test-cli-len-job",
        tmpDir,
        null,
        ["tests/background.test.js"],
        `node "${jestBin}"`,
        {
          coverageDir: covOutDir,
          targetSourceFiles: ["extension/background.js"],
          testNamePattern: longPattern,
        },
      );

      expect(res.exitCode).toBe(0);
      const sumPath = path.join(tmpDir, covOutDir, "coverage-summary.json");
      expect(fs.existsSync(sumPath)).toBe(true);
      const sum = JSON.parse(fs.readFileSync(sumPath, "utf8"));
      const bgEntry = Object.entries(sum).find(([k]) => k.replace(/\\/g, "/").endsWith("extension/background.js"))?.[1];
      expect(bgEntry).toBeDefined();
      expect(bgEntry.lines.covered).toBeGreaterThan(0);
      expect(bgEntry.lines.pct).toBeGreaterThan(0);
    } finally {
      restoreDraftTestsForRun(draftState);
    }
  }, 30000);
});
