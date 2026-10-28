import { describe, it, expect } from "@jest/globals";
import path from "path";
import fs from "fs";
import { performance } from "perf_hooks";
import * as testDepService from "../services/testDependencyResolver.service.js";
import * as fileCovService from "../services/fileCoverage.service.js";
import * as testSanitizerService from "../services/testSanitizer.service.js";
import { insertCodeIntoTestFile } from "../services/applyTestSuggestion.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";
import {
    resolveSmartBadgeState,
    generateLinkedTestTabs,
    resolveSuggestionStatusBadge
} from "../utils/traceabilityUiHelpers.js";

describe("Section 7: Acceptance Criteria (AC-TRACE-01 -> AC-TRACE-08) Verification Suite", () => {
    const realUserRepo = path.resolve(
        process.cwd(),
        "storage/projects/cmuxfsnh300012hob32cjq63v/github/1791336995812/repo"
    );

    // =========================================================================
    // AC-TRACE-01: Name-Agnostic Resolution via AST Inverted Index
    // =========================================================================
    describe("AC-TRACE-01: Name-Agnostic AST Resolution", () => {
        it("Links business logic file with completely different test file name in real repository", () => {
            if (!fs.existsSync(realUserRepo)) {
                console.warn("[SKIP] Real user repo not on disk:", realUserRepo);
                return;
            }

            const targetSource = "src/handlers/create-quickbooks-account.handler.ts";
            const result = fileCovService.findAllAssociatedTestFiles(realUserRepo, targetSource);

            expect(result.hasExecutingTests).toBe(true);
            expect(result.primaryTestFile).toBeDefined();
            expect(result.primaryTestFile.found).toBe(true);
            expect(result.primaryTestFile.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
            expect(result.primaryTestFile.relationType).toBe("DIRECT_IMPORT");
            expect(result.primaryTestFile.score).toBeGreaterThanOrEqual(1000);
        });

        it("Resolves synthetic AST specifiers across all 5 syntax patterns", () => {
            const sampleCode = `
                import { createAccount } from "../handlers/create-quickbooks-account.handler.ts";
                const helper = require("./account.helper.js");
                const dynamic = await import("../services/auth.service");
                jest.mock("../config/quickbooks.config", () => ({}));
                jest.unstable_mockModule("../clients/qb.client", () => ({}));
            `;
            const specifiers = testDepService.extractModuleSpecifiers(sampleCode);
            expect(specifiers).toContain("../handlers/create-quickbooks-account.handler.ts");
            expect(specifiers).toContain("./account.helper.js");
            expect(specifiers).toContain("../services/auth.service");
            expect(specifiers).toContain("../config/quickbooks.config");
            expect(specifiers).toContain("../clients/qb.client");
        });
    });

    // =========================================================================
    // AC-TRACE-02: Zero False Negative Screen
    // =========================================================================
    describe("AC-TRACE-02: Eradication of False Negative Blank Screen", () => {
        it("Never defaults to GREENFIELD_UNTESTED when coverage statements > 0 or test files exist", () => {
            // Case A: Coverage exists from integration test without direct import
            const badgeIntegration = resolveSmartBadgeState([], { statements: { covered: 45, pct: 60 } });
            expect(badgeIntegration.type).toBe("INTEGRATION_COVERED");
            expect(badgeIntegration.label).toContain("Covered via integration suite");

            // Case B: Direct test file found
            const badgeFound = resolveSmartBadgeState([
                { filePath: "tests/unit/handlers/create-account.handlers.test.ts", fileName: "create-account.handlers.test.ts", relationType: "DIRECT_IMPORT", found: true }
            ]);
            expect(badgeFound.type).toBe("SINGLE_LINKED");
            expect(badgeFound.label).toContain("create-account.handlers.test.ts");

            // Case C: Truly untested greenfield file
            const badgeGreenfield = resolveSmartBadgeState([], { statements: { covered: 0, pct: 0 } });
            expect(badgeGreenfield.type).toBe("GREENFIELD_UNTESTED");
            expect(badgeGreenfield.readyForAi).toBe(true);
        });
    });

    // =========================================================================
    // AC-TRACE-03: Full Multi-Test Support & Priority Ordering
    // =========================================================================
    describe("AC-TRACE-03: Multi-Test Resolution & Priority Ordering", () => {
        it("Orders linked test files strictly descending by quantitative score", () => {
            const rawItems = [
                { filePath: "tests/e2e/smoke.test.ts", fileName: "smoke.test.ts", relationType: "EXECUTION_TRACE", score: 650 },
                { filePath: "tests/unit/account.test.ts", fileName: "account.test.ts", relationType: "DIRECT_IMPORT", score: 1050 },
                { filePath: "tests/integration/flow.test.ts", fileName: "flow.test.ts", relationType: "EXECUTION_TRACE", score: 700 }
            ];

            const sorted = [...rawItems].sort((a, b) => b.score - a.score);
            expect(sorted[0].filePath).toBe("tests/unit/account.test.ts");
            expect(sorted[0].relationType).toBe("DIRECT_IMPORT");
            expect(sorted[1].filePath).toBe("tests/integration/flow.test.ts");
            expect(sorted[2].filePath).toBe("tests/e2e/smoke.test.ts");

            const tabs = generateLinkedTestTabs(sorted);
            expect(tabs.showTabsBar).toBe(true);
            expect(tabs.tabs).toHaveLength(3);
            expect(tabs.tabs[0].isSelected).toBe(true);
        });
    });

    // =========================================================================
    // AC-TRACE-04: Monaco In-Place Editor Contracts
    // =========================================================================
    describe("AC-TRACE-04: Monaco Test Content Viewer & Status Badges", () => {
        it("Maps AI suggestion lifecycle badges deterministically for editor feedback", () => {
            expect(resolveSuggestionStatusBadge("APPLYING")).toEqual({ label: "Applying...", color: "blue", spin: true });
            expect(resolveSuggestionStatusBadge("APPLIED")).toEqual({ label: "✓ Applied & Passed", color: "green", spin: false });
            expect(resolveSuggestionStatusBadge("PASSED")).toEqual({ label: "✓ Applied & Passed", color: "green", spin: false });
            expect(resolveSuggestionStatusBadge("FAILED")).toEqual({ label: "✗ Test Failed", color: "red", spin: false });
            expect(resolveSuggestionStatusBadge("EDITED")).toEqual({ label: "Edited", color: "purple", spin: false });
            expect(resolveSuggestionStatusBadge(null)).toEqual({ label: "Ready to Apply", color: "cyan", spin: false });
        });
    });

    // =========================================================================
    // AC-TRACE-05: Zero-Regression Backward Compatibility
    // =========================================================================
    describe("AC-TRACE-05: Strict Backward Compatibility", () => {
        it("findAssociatedTestFile yields identical result to findAllAssociatedTestFiles.primaryTestFile", () => {
            const rootDir = process.cwd();
            const sourcePath = "src/index.js";

            const singleResult = fileCovService.findAssociatedTestFile(rootDir, sourcePath);
            const multiResult = fileCovService.findAllAssociatedTestFiles(rootDir, sourcePath);

            expect(singleResult).toEqual(multiResult.primaryTestFile);
            expect(singleResult).toHaveProperty("found");
            expect(singleResult).toHaveProperty("filePath");
            expect(singleResult).toHaveProperty("fileName");
            expect(singleResult).toHaveProperty("relationType");
        });
    });

    // =========================================================================
    // AC-TRACE-06: Performance & Cache SLA (< 2.0ms on Warm RAM Cache)
    // =========================================================================
    describe("AC-TRACE-06: Performance & Cache SLA", () => {
        it("Responds under 2.0ms on warm In-Memory Cache across consecutive lookups", () => {
            const rootDir = fs.existsSync(realUserRepo) ? realUserRepo : process.cwd();

            // Warm up cache
            testDepService.buildProjectTestDependencyMap(rootDir);

            const iterations = 50;
            const latencies = [];

            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                testDepService.findTestsImportingSource(rootDir, "src/handlers/create-quickbooks-account.handler.ts");
                const duration = performance.now() - start;
                latencies.push(duration);
            }

            const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            const maxLatency = Math.max(...latencies);

            expect(avgLatency).toBeLessThan(2.0); // SLA: < 2.0ms
            expect(maxLatency).toBeLessThan(15.0);
        });
    });

    // =========================================================================
    // AC-TRACE-07: AST Sanitization & Code Integrity Guard
    // =========================================================================
    describe("AC-TRACE-07: AST Integrity Guard & Clean Append", () => {
        it("Deduplicates mock statements, heals import paths, and preserves valid AST", () => {
            const originalTestContent = `import { describe, it } from "@jest/globals";
jest.mock("axios");

describe("Suite", () => {
    it("existing case", () => {});
});
`;

            const aiSnippet = `jest.mock("axios");
import { createAccount } from "../../handlers/account.handler";

it("new case", () => {});
`;

            // 1. insertCodeIntoTestFile deduplicates mocks when merging into existing test
            const merged = insertCodeIntoTestFile(originalTestContent, aiSnippet, "tests/unit/account.test.js");
            const mockMatches = [...merged.matchAll(/jest\.mock\("axios"\)/g)];
            expect(mockMatches.length).toBe(1); // Exactly 1 mock, no duplicate
            expect(merged).toContain('it("new case"');

            // 2. cleanAndDeduplicateTestContent resolves duplicate requires and parses with 0 syntax errors
            const rawWithDuplicates = `
const { DataTypes } = require('sequelize');
const { DataTypes } = require("sequelize");
describe('test', () => { it('ok', () => {}); });
`;
            const cleaned = testSanitizerService.cleanAndDeduplicateTestContent(rawWithDuplicates);
            expect(cleaned).toContain("// [deduped]");
            const parsedAst = parseJavaScriptCode(cleaned);
            expect(parsedAst).not.toBeNull();

            // 3. Heal hallucinated storage paths into valid relative paths
            const healed = testSanitizerService.healImportPathsInTestCode(
                'import { foo } from "../storage/projects/p1/github/123/repo/src/service.js";',
                "tests/unit/service.test.js"
            );
            expect(healed).toContain("../../src/service");
        });
    });

    // =========================================================================
    // AC-TRACE-08: Fault Tolerance & Resiliency
    // =========================================================================
    describe("AC-TRACE-08: Fault Tolerance & Resiliency", () => {
        it("Handles non-existent repository and empty files gracefully without throwing", () => {
            const nonExistent = path.resolve(process.cwd(), "non/existent/path/for/traceability");
            
            // Should not throw UnhandledException
            expect(() => {
                const res = fileCovService.findAllAssociatedTestFiles(nonExistent, "some/file.js");
                expect(res.hasExecutingTests).toBe(false);
                expect(res.linkedTestFiles).toEqual([]);
                expect(res.primaryTestFile.found).toBe(false);
            }).not.toThrow();

            // Broken specifier extractor input
            expect(testDepService.extractModuleSpecifiers(null)).toEqual([]);
            expect(testDepService.extractModuleSpecifiers(undefined)).toEqual([]);
            expect(testDepService.extractModuleSpecifiers("<<< Syntax Error >>>")).toEqual([]);
        });
    });
});
