import fs from "fs";
import os from "os";
import path from "path";
import {
  detectCoverageFrameworks,
  resolveUnitFrameworkForFile,
} from "../services/coverageFramework.service.js";
import { detectSystemTestFrameworks } from "../services/systemTestFrameworkDetection.service.js";
import {
  findUnitFiles,
  materializeDraftTestsForRun,
  restoreDraftTestsForRun,
  filterDiscoveredUnitFiles,
} from "../services/runTestsJob.service.js";
import { convertJestMocksAndStaticImportsToEsm } from "../services/esmTestRepair.service.js";
import { validateAndNormalizeMocks } from "../services/mockValidation.service.js";
import {
  sanitizeAllProjectTestFiles,
  healMissingDependencyMocks,
} from "../services/testSanitizer.service.js";
import { buildIsolationMockContracts } from "../services/unitTestContextEngineering.service.js";

describe("3-Rule Framework Selection & Draft Unit Run Materialization", () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-3rule-draft-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe("Unit 3-rule detection (coverageFramework.service.js)", () => {
    test("Rule 1: auto-uses installed library in package.json without user selection", () => {
      fs.writeFileSync(
        path.join(rootDir, "package.json"),
        JSON.stringify({ name: "app", devDependencies: { vitest: "^3.0.0" } }),
      );
      fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(rootDir, "src", "calc.js"), "export const add = (a, b) => a + b;");

      const res = detectCoverageFrameworks(rootDir);
      expect(res.unitPermutation).toMatchObject({
        permutation: "HAS_DEPS_NO_TESTS",
        needsUserSelection: false,
        detectionSource: "package_json",
        resolvedFramework: "vitest",
      });
      expect(res.recommended).toBe("vitest");
    });

    test("Rule 2: infers framework from existing test syntax when package.json lacks unit library", () => {
      fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "app" }));
      fs.mkdirSync(path.join(rootDir, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "tests", "calc.test.js"),
        `import { describe, it, expect, vi } from "vitest";\ndescribe("calc", () => { it("ok", () => { vi.fn(); expect(1).toBe(1); }); });`,
      );

      const res = detectCoverageFrameworks(rootDir);
      expect(res.unitPermutation).toMatchObject({
        permutation: "HAS_TESTS_NO_DEPS",
        needsUserSelection: false,
        detectionSource: "test_syntax",
        inferredFramework: "vitest",
        resolvedFramework: "vitest",
      });
      expect(res.recommended).toBe("vitest");
    });

    test("Rule 3: prompts 1-of-2 selection ONLY when zero libs and zero unit test files exist", () => {
      fs.writeFileSync(
        path.join(rootDir, "package.json"),
        JSON.stringify({ name: "app", devDependencies: { "@playwright/test": "^1.48.0" } }),
      );
      fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(rootDir, "src", "service.js"), "export function ping() { return 'pong'; }");

      const res = detectCoverageFrameworks(rootDir);
      expect(res.unitPermutation).toMatchObject({
        permutation: "ZERO_TESTS_NO_DEPS",
        needsUserSelection: true,
        detectionSource: "user_selection_required",
        resolvedFramework: null,
        proposedFrameworks: ["jest", "vitest"],
      });
      expect(res.recommended).toBeNull();
    });

    test("Monorepo: resolves owning subpackage framework per file (client=vitest, server=jest)", () => {
      fs.mkdirSync(path.join(rootDir, "client", "src", "utils"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "server", "src", "services"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "package.json"),
        JSON.stringify({ name: "mono", devDependencies: { jest: "^29.0.0" } }),
      );
      fs.writeFileSync(
        path.join(rootDir, "client", "package.json"),
        JSON.stringify({ name: "client", devDependencies: { vitest: "^3.0.0" } }),
      );
      fs.writeFileSync(
        path.join(rootDir, "server", "package.json"),
        JSON.stringify({ name: "server", devDependencies: { jest: "^29.0.0" } }),
      );
      fs.writeFileSync(path.join(rootDir, "client", "src", "utils", "fmt.js"), "export const fmt = (x) => x;");
      fs.writeFileSync(path.join(rootDir, "server", "src", "services", "auth.js"), "export const ok = () => true;");

      expect(resolveUnitFrameworkForFile(rootDir, "client/src/utils/fmt.js")).toBe("vitest");
      expect(resolveUnitFrameworkForFile(rootDir, "server/src/services/auth.js")).toBe("jest");
    });
  });

  describe("System 3-rule detection (systemTestFrameworkDetection.service.js)", () => {
    test("Rule 1: auto-uses installed @playwright/test without user selection", async () => {
      fs.writeFileSync(
        path.join(rootDir, "package.json"),
        JSON.stringify({ name: "web", devDependencies: { "@playwright/test": "^1.48.0" } }),
      );
      const res = await detectSystemTestFrameworks(rootDir);
      expect(res.hasDependencies).toBe(true);
      expect(res.needsUserSelection).toBe(false);
      expect(res.detectionSource).toBe("package_json");
      expect(res.recommendedFramework).toBe("playwright");
      expect(res.permutation).toBe("HAS_DEPS_NO_TESTS");
    });

    test("Rule 2: infers cypress from .cy.js syntax when package.json has no E2E library", async () => {
      fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "web" }));
      fs.mkdirSync(path.join(rootDir, "cypress", "e2e"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "cypress", "e2e", "home.cy.js"),
        `describe("Home", () => { it("visits", () => { cy.visit("/"); }); });`,
      );
      const res = await detectSystemTestFrameworks(rootDir);
      expect(res.hasDependencies).toBe(false);
      expect(res.hasTestFiles).toBe(true);
      expect(res.needsUserSelection).toBe(false);
      expect(res.detectionSource).toBe("test_syntax");
      expect(res.inferredFramework).toBe("cypress");
      expect(res.recommendedFramework).toBe("cypress");
      expect(res.permutation).toBe("HAS_TESTS_NO_DEPS");
    });

    test("Rule 3: marks ZERO_TESTS_NO_DEPS and needsUserSelection when zero E2E deps and zero E2E files", async () => {
      fs.writeFileSync(
        path.join(rootDir, "package.json"),
        JSON.stringify({ name: "web", devDependencies: { jest: "^29.0.0" } }),
      );
      const res = await detectSystemTestFrameworks(rootDir);
      expect(res.hasDependencies).toBe(false);
      expect(res.hasTestFiles).toBe(false);
      expect(res.needsUserSelection).toBe(true);
      expect(res.recommendedFramework).toBeNull();
      expect(res.permutation).toBe("ZERO_TESTS_NO_DEPS");
      expect(res.proposedFrameworks).toEqual(["PLAYWRIGHT", "CYPRESS"]);
    });
  });

  describe("Temporary Unit Draft Run before Apply (runTestsJob.service.js)", () => {
    test("materializes unapplied draftTests, matches selected sourceFiles, and restores repo cleanly", () => {
      fs.writeFileSync(
        path.join(rootDir, "package.json"),
        JSON.stringify({ name: "ext-app", devDependencies: { jest: "^29.0.0" } }),
      );
      fs.mkdirSync(path.join(rootDir, "extension"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "extension", "background.js"),
        "export function initBg() { return true; }",
      );
      const existingPath = path.join(rootDir, "tests", "existing.test.js");
      fs.writeFileSync(existingPath, "test('orig', () => expect(1).toBe(1));");

      const draftTests = [
        {
          sourceFile: "extension/background.js",
          testFile: "tests/draft-bg.coverage.test.js",
          framework: "jest",
          code: "describe('background draft', () => { test('works', () => expect(true).toBe(true)); });",
        },
        {
          sourceFile: "extension/existing.js",
          testFile: "tests/existing.test.js",
          framework: "jest",
          code: "describe('updated draft', () => { test('new', () => expect(2).toBe(2)); });",
        },
      ];

      const draftState = materializeDraftTestsForRun(rootDir, draftTests);
      try {
        expect(fs.existsSync(path.join(rootDir, "tests", "draft-bg.coverage.test.js"))).toBe(true);
        expect(fs.readFileSync(existingPath, "utf8")).toContain("updated draft");

        const discovered = findUnitFiles(rootDir);
        const filtered = filterDiscoveredUnitFiles({
          rootDir,
          jestFiles: discovered.jestFiles,
          vitestFiles: discovered.vitestFiles,
          requestedTargetFiles: ["extension/background.js"],
          draftSourceByTestRel: draftState.draftSourceByTestRel,
          draftFrameworkByTestRel: draftState.draftFrameworkByTestRel,
        });

        expect(filtered.jestFiles).toContain("tests/draft-bg.coverage.test.js");
        expect(filtered.jestFiles).not.toContain("tests/existing.test.js");
      } finally {
        restoreDraftTestsForRun(draftState);
      }

      // Temporary draft file removed; existing test file restored verbatim
      expect(fs.existsSync(path.join(rootDir, "tests", "draft-bg.coverage.test.js"))).toBe(false);
      expect(fs.readFileSync(existingPath, "utf8")).toBe("test('orig', () => expect(1).toBe(1));");
    });

    test("blocks path traversal outside rootDir when materializing draftTests", () => {
      const state = materializeDraftTestsForRun(rootDir, [
        {
          sourceFile: "src/a.js",
          testFile: "../outside-evil.test.js",
          framework: "jest",
          code: "test('x', () => {});",
        },
      ]);
      expect(state.tempDraftBackups).toHaveLength(0);
    });
  });

  describe("Non-existent @/lib/prisma mock prevention & sanitization", () => {
    test("convertJestMocksAndStaticImportsToEsm strips unresolvable '@/lib/prisma' mock in ESM repos", () => {
      fs.mkdirSync(path.join(rootDir, "server", "src", "config"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "server", "tests", "config"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "server", "package.json"),
        JSON.stringify({ name: "server", type: "module" }),
      );
      fs.writeFileSync(
        path.join(rootDir, "server", "src", "config", "prisma.js"),
        `import { PrismaClient } from "@prisma/client";\nconst prisma = new PrismaClient();\nexport default prisma;`,
      );

      const badDraft =
        `import { jest, describe, it, expect } from "@jest/globals";\n` +
        `jest.mock('@/lib/prisma', () => ({ default: {} }), { virtual: true });\n` +
        `import prisma from "../../src/config/prisma.js";\n` +
        `describe("prisma", () => { it("ok", () => expect(prisma).toBeDefined()); });\n`;

      const cleaned = convertJestMocksAndStaticImportsToEsm(badDraft, {
        testFilePath: "server/tests/config/prisma.coverage.test.js",
        rootDir,
        targetSourceFile: "server/src/config/prisma.js",
      });
      expect(cleaned).not.toContain("@/lib/prisma");
    });

    test("convertJestMocksAndStaticImportsToEsm strips unmapped '@/config/prisma' and self-mock even when target exists on disk", () => {
      fs.mkdirSync(path.join(rootDir, "server", "src", "config"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "server", "tests", "config"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "server", "package.json"),
        JSON.stringify({ name: "server", type: "module" }),
      );
      fs.writeFileSync(
        path.join(rootDir, "server", "jest.config.js"),
        `export default { testEnvironment: "node", transform: {} };`,
      );
      fs.writeFileSync(
        path.join(rootDir, "server", "src", "config", "prisma.js"),
        `import { PrismaClient } from "@prisma/client";\nconst prisma = new PrismaClient();\nexport default prisma;`,
      );

      const badDraft =
        `import { jest, describe, it, expect } from "@jest/globals";\n` +
        `await jest.unstable_mockModule('@/lib/prisma', async () => ({ default: {} }));\n` +
        `await jest.unstable_mockModule('@/config/prisma', async () => ({ default: {} }));\n` +
        `await jest.unstable_mockModule('@/config/prisma.js', async () => ({ default: {} }));\n` +
        `await jest.unstable_mockModule('../../src/config/prisma.js', async () => ({ default: {} }));\n` +
        `const importedModule = await import("../../src/config/prisma.js");\n` +
        `describe("prisma", () => { it("ok", () => expect(importedModule).toBeDefined()); });\n`;

      const cleaned = convertJestMocksAndStaticImportsToEsm(badDraft, {
        testFilePath: "server/tests/config/prisma.coverage.test.js",
        rootDir,
        targetSourceFile: "server/src/config/prisma.js",
      });
      expect(cleaned).not.toContain("@/lib/prisma");
      expect(cleaned).not.toContain("@/config/prisma");
      expect(cleaned).not.toContain("unstable_mockModule('../../src/config/prisma.js'");
      expect(cleaned).not.toContain('unstable_mockModule("../../src/config/prisma.js"');
      expect(cleaned).toContain("import(\"../../src/config/prisma.js\")");
    });

    test("sanitizeAllProjectTestFiles heals ESM test file containing bogus '@/lib/prisma' mock", () => {
      fs.mkdirSync(path.join(rootDir, "server", "src", "config"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "server", "tests", "config"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "server", "package.json"),
        JSON.stringify({ name: "server", type: "module" }),
      );
      fs.writeFileSync(
        path.join(rootDir, "server", "src", "config", "prisma.js"),
        `import { PrismaClient } from "@prisma/client";\nexport default new PrismaClient();`,
      );
      const testRel = "server/tests/config/prisma.coverage.test.js";
      const testAbs = path.join(rootDir, testRel);
      fs.writeFileSync(
        testAbs,
        `jest.mock('@/lib/prisma', () => ({ default: {} }));\n` +
          `const prisma = require('../../src/config/prisma.js');\n` +
          `describe("prisma", () => { test("defined", () => expect(prisma).toBeDefined()); });\n`,
      );

      sanitizeAllProjectTestFiles(rootDir, [testRel]);
      const onDisk = fs.readFileSync(testAbs, "utf8");
      expect(onDisk).not.toContain("@/lib/prisma");
    });

    test("validateAndNormalizeMocks virtualizes 1-arg missing '@/lib/prisma' in CommonJS Jest", () => {
      fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "cjs-app" }));
      const res = validateAndNormalizeMocks({
        code: `jest.mock('@/lib/prisma');\ndescribe("x", () => { test("y", () => {}); });`,
        filePath: "tests/a.test.js",
        rootDir,
        framework: "jest",
      });
      expect(res.modified).toBe(true);
      expect(res.code).toContain("virtual: true");
    });

    test("healMissingDependencyMocks strips unimported '@/lib/prisma' from ESM test output", () => {
      const code = `await jest.unstable_mockModule('@/lib/prisma', () => ({}));\ntest('ok', () => expect(1).toBe(1));`;
      const healed = healMissingDependencyMocks(
        code,
        `Cannot find module '@/lib/prisma' from 'tests/config/prisma.coverage.test.js'`,
        { framework: "jest", rootDir, filePath: "server/tests/config/prisma.coverage.test.js" },
      );
      expect(healed).not.toContain("@/lib/prisma");
    });

    test("buildIsolationMockContracts does not emit nonexistent '@/lib/prisma' mock path", () => {
      fs.mkdirSync(path.join(rootDir, "server", "src", "config"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, "server", "src", "config", "prisma.js"),
        `import { PrismaClient } from "@prisma/client";\nexport default new PrismaClient();`,
      );
      const contracts = buildIsolationMockContracts({
        sourceCode: `import { PrismaClient } from "@prisma/client";\nexport default new PrismaClient();`,
        framework: "jest",
        sourceFile: "server/src/config/prisma.js",
        targetTestFile: "server/tests/config/prisma.coverage.test.js",
        rootDir,
      });
      expect(contracts.mockPreambleCode).not.toContain("@/lib/prisma");
    });
  });
});
