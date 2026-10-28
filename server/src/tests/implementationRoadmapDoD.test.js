import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as testDepService from "../services/testDependencyResolver.service.js";
import * as fileCovService from "../services/fileCoverage.service.js";
import * as unitTestSuggService from "../services/unitTestSuggestion.service.js";
import * as testSanitizerService from "../services/testSanitizer.service.js";
import {
    resolveSmartBadgeState,
    generateLinkedTestTabs,
    resolveSuggestionStatusBadge
} from "../utils/traceabilityUiHelpers.js";

describe("Section 6: Implementation Roadmap 5-Phase Definition of Done (DoD) Verification", () => {
    // =========================================================================
    // Phase 1: Core Engine & AST Inverted Index DoD
    // =========================================================================
    describe("Phase 1 DoD: testDependencyResolver.service Module & Capabilities", () => {
        it("Exports all required Phase 1 core resolver functions", () => {
            expect(typeof testDepService.discoverAllTestFiles).toBe("function");
            expect(typeof testDepService.extractModuleSpecifiers).toBe("function");
            expect(typeof testDepService.resolveSpecifierToRelativePath).toBe("function");
            expect(typeof testDepService.normalizePath).toBe("function");
            expect(typeof testDepService.stripExtension).toBe("function");
            expect(typeof testDepService.buildProjectTestDependencyMap).toBe("function");
            expect(typeof testDepService.findTestsImportingSource).toBe("function");
        });
    });

    // =========================================================================
    // Phase 2: Backend Integration & Traceability Scorer DoD
    // =========================================================================
    describe("Phase 2 DoD: fileCoverage.service Traceability & Scoring Engine", () => {
        it("Exports all required Phase 2 multi-tiered and quantitative scoring functions", () => {
            expect(typeof fileCovService.findAllAssociatedTestFiles).toBe("function");
            expect(typeof fileCovService.findAssociatedTestFile).toBe("function");
            expect(typeof fileCovService.calculateTraceabilityScore).toBe("function");
            expect(typeof fileCovService.getFileCoverageDetails).toBe("function");
        });

        it("Guarantees backward-compatible findAssociatedTestFile delegates to findAllAssociatedTestFiles", () => {
            const rootDir = process.cwd();
            const resAll = fileCovService.findAllAssociatedTestFiles(rootDir, "src/index.js");
            const resSingle = fileCovService.findAssociatedTestFile(rootDir, "src/index.js");

            expect(resSingle).toEqual(resAll.primaryTestFile);
        });
    });

    // =========================================================================
    // Phase 3: AI Test Generation Context & Safe Apply DoD
    // =========================================================================
    describe("Phase 3 DoD: unitTestSuggestion & testSanitizer Context and Security Guard", () => {
        it("Exports all required Phase 3 context extractor and AST sanitizer functions", () => {
            expect(typeof unitTestSuggService.findExistingTestFile).toBe("function");
            expect(typeof testSanitizerService.healImportPathsInTestCode).toBe("function");
            expect(typeof testSanitizerService.cleanAndDeduplicateTestContent).toBe("function");
            expect(typeof testSanitizerService.sanitizeAllProjectTestFiles).toBe("function");
            expect(typeof testSanitizerService.isDirectStorageDirectory).toBe("function");
        });
    });

    // =========================================================================
    // Phase 4: Frontend UI/UX Transformation DoD
    // =========================================================================
    describe("Phase 4 DoD: Frontend UI/UX State Machine & Interaction Contracts", () => {
        it("Verifies UI Smart Badge state transitions and Linked Tabs Bar logic", () => {

            expect(typeof resolveSmartBadgeState).toBe("function");
            expect(typeof generateLinkedTestTabs).toBe("function");
            expect(typeof resolveSuggestionStatusBadge).toBe("function");

            // Multi-linked test files
            const badge = resolveSmartBadgeState([
                { filePath: "tests/a.test.ts", fileName: "a.test.ts", relationType: "DIRECT_IMPORT", found: true },
                { filePath: "tests/b.test.ts", fileName: "b.test.ts", relationType: "EXECUTION_TRACE", found: true }
            ]);
            expect(badge.type).toBe("MULTI_LINKED");
            expect(badge.count).toBe(2);

            const tabs = generateLinkedTestTabs([
                { filePath: "tests/a.test.ts", fileName: "a.test.ts", relationType: "DIRECT_IMPORT" },
                { filePath: "tests/b.test.ts", fileName: "b.test.ts", relationType: "EXECUTION_TRACE" }
            ]);
            expect(tabs.showTabsBar).toBe(true);
            expect(tabs.tabs).toHaveLength(2);
        });
    });

    // =========================================================================
    // Phase 5: Verification & Production Readiness DoD
    // =========================================================================
    describe("Phase 5 DoD: Real User Repository & Container Health Invariants", () => {
        it("Verifies QuickBooks real user repository resolves seamlessly without regression", () => {
            const realUserRepo = path.resolve(
                process.cwd(),
                "storage/projects/cmuxfsnh300012hob32cjq63v/github/1791336995812/repo"
            );

            if (!fs.existsSync(realUserRepo)) {
                console.warn("[SKIP] Real user project not present on disk:", realUserRepo);
                return;
            }

            const targetSource = "src/handlers/create-quickbooks-account.handler.ts";
            const result = fileCovService.findAllAssociatedTestFiles(realUserRepo, targetSource);

            expect(result.hasExecutingTests).toBe(true);
            expect(result.primaryTestFile.found).toBe(true);
            expect(result.primaryTestFile.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
            expect(result.primaryTestFile.relationType).toBe("DIRECT_IMPORT");
            expect(result.primaryTestFile.score).toBeGreaterThanOrEqual(1000);
        });
    });
});
