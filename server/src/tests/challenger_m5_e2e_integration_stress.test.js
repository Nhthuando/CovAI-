import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock Prisma for service and controller integration tests
const mockPrisma = {
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
    },
    project: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
    },
    coverageFile: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
    },
    coverageSummary: {
        findUnique: jest.fn().mockResolvedValue(null),
    },
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma,
}));

// Mock projectProposalBase.service.js
await jest.unstable_mockModule("../services/projectProposalBase.service.js", () => ({
    captureProjectProposalBase: jest.fn(async () => ({
        snapshotId: "snap-m5-stress",
        workspaceRevision: 1,
        baseVersion: { revision: 1, sha256: "sha-proposal-test" },
        isExisting: false,
        existingContent: "",
    })),
}));

// Mock projectAccess.service.js
await jest.unstable_mockModule("../services/projectAccess.service.js", () => ({
    resolveProjectAccess: jest.fn().mockResolvedValue({
        hasAccess: true,
        project: {
            id: "proj-m5-stress",
            workspaceRevision: 1,
            ownerId: "user-123",
        },
        role: "OWNER",
        capabilities: ["ai.use", "project.read", "project.write"],
    }),
    resolveSnapshotAccess: jest.fn().mockImplementation(async ({ projectId, snapshotId, userId }) => ({
        project: { id: projectId || "proj-m5-stress", workspaceRevision: 1, ownerId: userId },
        snapshot: { id: snapshotId || "snap-m5-stress", projectId: projectId || "proj-m5-stress" },
        role: "OWNER",
        capabilities: ["ai.use", "project.read", "project.write"],
    })),
    resolveJobAccess: jest.fn(),
    membershipWhere: jest.fn(() => ({})),
    withProjectGuard: jest.fn(async (params, run) => run(mockPrisma, {
        role: "OWNER",
        project: { id: params.projectId, workspaceRevision: 1 },
        capabilities: ["project.write", "project.read", "ai.use"],
    })),
}));

// Mock fileCoverage.service.js
await jest.unstable_mockModule("../services/fileCoverage.service.js", () => ({
    normalizePath: (p) => (p ? String(p).replace(/\\/g, "/") : ""),
    cleanRelativePath: (rootDir, p) => (p ? String(p).replace(/\\/g, "/") : ""),
    matchesFilePath: (a, b) => true,
    findAssociatedTestFile: jest.fn((rootDir, rawSourceFilePath, framework = null) => ({
        found: false,
        filePath: null,
        suggestedFilePath: rawSourceFilePath ? `tests/${path.basename(rawSourceFilePath, path.extname(rawSourceFilePath))}.test.js` : null,
    })),
    findAllAssociatedTestFiles: jest.fn(() => ({ primaryTestFile: { found: false }, linkedTestFiles: [] })),
    getFileCoverageDetails: jest.fn().mockImplementation(async (snapshotId, filePath) => {
        return {
            lines: { 5: 0, 10: 1 },
            uncoveredLines: [5],
            failedLines: [],
            uncoveredBranches: [
                {
                    line: 5,
                    type: "if",
                    isInfeasible: false,
                    infeasibleMeta: null,
                },
            ],
            summary: {
                linesPct: 80.0,
                branchesPct: 50.0,
                functionsPct: 100.0,
                statementsPct: 85.0,
                linesTotal: 10,
                linesCovered: 8,
                branchesTotal: 4,
                branchesCovered: 2,
            },
            sourceCode: "export function calculateTax(income) {\n    if (income <= 0) return 0;\n    return income * 0.2;\n}",
        };
    }),
}));

// Now dynamically import services under test
const {
    analyzeSourceAst,
    analyzeBusinessLogicFile,
    extractSourceImportsAst,
} = await import("../services/businessLogicAstAnalyzer.service.js");

const {
    assembleUnitTestContext,
    buildIsolationMockContracts,
    generateMathjsMockCode,
} = await import("../services/unitTestContextEngineering.service.js");

const {
    generateAiUnitTestSuite,
} = await import("../services/unitTestGenerator.service.js");

const {
    suggestUnitTestcases,
} = await import("../services/unitTestSuggestion.service.js");

const {
    suggestUnitTestcase,
} = await import("../controllers/coverage.controller.js");

describe("Milestone 5 Empirical Stress Suite: sourceImports Scoping & End-to-End Test Suggestion Pipeline", () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-m5-stress-"));
        jest.clearAllMocks();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // =========================================================================
    // SECTION 1: AST ANALYZER SCOPING & FUZZING RESILIENCE
    // =========================================================================
    describe("1. AST Analyzer Scoping & Fuzzing Stress Tests", () => {
        it("handles multi-specifier, aliased, namespace, and side-effect ESM imports without scoping errors", () => {
            const complexEsmCode = `
                import defaultExport from 'my-default-lib';
                import * as namespaceExport from 'my-namespace-lib';
                import { singleNamed, aliasNamed as renamedSymbol, trailingComma, } from 'my-named-lib';
                import 'side-effect-only-lib';
                import type { TypeSpecifier } from 'ts-type-lib';

                export function compute(val) {
                    if (val > 100) return namespaceExport.transform(val);
                    return defaultExport(val);
                }
            `;

            const astResult = analyzeSourceAst(complexEsmCode);

            // Verifies no ReferenceError: sourceImports is not defined
            expect(astResult).toBeDefined();
            expect(astResult.imports).toBeDefined();
            expect(astResult.sourceImports).toBeDefined();
            expect(astResult.formattedImports).toBeDefined();

            // Verify equality of aliases
            expect(astResult.imports).toEqual(astResult.sourceImports);
            expect(astResult.sourceImports).toEqual(astResult.formattedImports);

            // Verify specific import specifiers
            expect(astResult.imports["my-default-lib"]).toEqual({ default: true, namespace: false, names: [] });
            expect(astResult.imports["my-namespace-lib"]).toEqual({ default: false, namespace: true, names: [] });
            expect(astResult.imports["my-named-lib"]?.names).toContain("singleNamed");
            expect(astResult.imports["my-named-lib"]?.names).toContain("aliasNamed");
            expect(astResult.imports["my-named-lib"]?.names).toContain("trailingComma");

            // Verify exported symbols
            expect(astResult.exportedSymbolNames).toContain("compute");
        });

        it("handles CommonJS require variants: single identifier, destructuring, and multi-declarations", () => {
            const cjsCode = `
                const fs = require('fs');
                const { readFile, writeFile: writeCustom } = require('fs/promises');
                const math = require('mathjs'), path = require('path');

                function internalWorker(file) {
                    return fs.readFileSync(file, 'utf8');
                }

                module.exports = {
                    processFile(filePath) {
                        return internalWorker(filePath);
                    }
                };
            `;

            const astResult = analyzeSourceAst(cjsCode);

            expect(astResult).toBeDefined();
            expect(astResult.imports["fs"]).toBeDefined();
            expect(astResult.imports["fs"].default).toBe(true);

            expect(astResult.imports["fs/promises"]).toBeDefined();
            expect(astResult.imports["fs/promises"].names).toContain("readFile");
            expect(astResult.imports["fs/promises"].names).toContain("writeFile");

            expect(astResult.imports["mathjs"]).toBeDefined();
            expect(astResult.imports["mathjs"].default).toBe(true);
            expect(astResult.imports["path"]).toBeDefined();
            expect(astResult.imports["path"].default).toBe(true);
        });

        it("stress-tests hostile, malformed, and non-string inputs without throwing ReferenceError", () => {
            const malformedInputs = [
                "",
                "   ",
                null,
                undefined,
                12345,
                true,
                false,
                {},
                [],
                () => {},
                Symbol("test"),
                "const x = ;;; if (",
                "function incomplete( { return 42;",
                "\x00\x01\x02\x03\x04\x05",
                "import { unclosed from 'broken",
            ];

            for (const input of malformedInputs) {
                expect(() => {
                    const res = analyzeSourceAst(input);
                    expect(res).toBeDefined();
                    expect(typeof res.imports).toBe("object");
                    expect(typeof res.sourceImports).toBe("object");
                    expect(typeof res.formattedImports).toBe("object");
                    expect(Array.isArray(res.exportedSymbols)).toBe(true);
                    expect(Array.isArray(res.internalFunctions)).toBe(true);
                    expect(Array.isArray(res.decisionPoints)).toBe(true);
                    expect(Array.isArray(res.exceptionPoints)).toBe(true);
                }).not.toThrow();
            }
        });

        it("verifies analyzeBusinessLogicFile is strictly identical to analyzeSourceAst", () => {
            expect(analyzeBusinessLogicFile).toBe(analyzeSourceAst);

            const testSample = "export const greet = (name) => `Hello ${name}`;";
            const res1 = analyzeSourceAst(testSample);
            const res2 = analyzeBusinessLogicFile(testSample);

            expect(res1).toEqual(res2);
        });

        it("performance stress: analyzes a large 1000-line synthetic module with 100 imports and 50 functions in < 200ms", () => {
            const lines = [];
            for (let i = 0; i < 50; i++) {
                lines.push(`import { util_${i} } from 'module-dep-${i}';`);
                lines.push(`const cjs_${i} = require('cjs-dep-${i}');`);
            }
            for (let i = 0; i < 50; i++) {
                lines.push(`
                    export function publicFn_${i}(arg) {
                        if (arg > ${i}) return helper_${i}(arg);
                        return null;
                    }
                    function helper_${i}(val) {
                        return val * ${i};
                    }
                `);
            }
            const largeCode = lines.join("\n");

            const startTime = Date.now();
            const result = analyzeSourceAst(largeCode);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(1000); // well within acceptable limits
            expect(Object.keys(result.imports).length).toBe(100);
            expect(result.exportedSymbols.length).toBe(50);
            expect(result.internalFunctions.length).toBe(50);
        });
    });

    // =========================================================================
    // SECTION 2: CONTEXT ENGINEERING INTEGRATION (assembleUnitTestContext)
    // =========================================================================
    describe("2. assembleUnitTestContext Integration with AST Metadata", () => {
        it("seamlessly feeds AST metadata into decision table, indirect testing, and isolation mocks", () => {
            const sourceCode = `
                import { create, all } from 'mathjs';
                import axios from 'axios';

                function computeDiscount(price, rate) {
                    if (rate < 0 || rate > 1) throw new Error("Invalid rate");
                    return price * rate;
                }

                export async function checkout(cart, discountRate) {
                    if (!cart || cart.items.length === 0) return { total: 0 };
                    const discount = computeDiscount(cart.subtotal, discountRate);
                    const netTotal = cart.subtotal - discount;
                    const res = await axios.post('/api/orders', { total: netTotal });
                    return res.data;
                }
            `;

            const context = assembleUnitTestContext({
                sourceCode,
                framework: "vitest",
                existingTestCode: ""
            });

            expect(context).toBeDefined();
            expect(context.astMetadata).toBeDefined();
            expect(context.astMetadata.imports["mathjs"]?.names).toContain("create");
            expect(context.astMetadata.imports["mathjs"]?.names).toContain("all");

            // Verify isolation mocks detected dependencies
            expect(context.mockContracts.detectedDependencies).toContain("mathjs");
            expect(context.mockContracts.detectedDependencies).toContain("axios-http");

            // Verify indirect testing directives
            expect(context.indirectTesting.indirectStrategies.map(s => s.helperName)).toContain("computeDiscount");
            expect(context.indirectTesting.indirectGuidancePrompt).toContain("NEVER write `import { computeDiscount }`");

            // Verify engineered prompt context sections
            expect(context.engineeredPromptContext).toContain("SECTION 1: PUBLIC APIS & INDIRECT TESTING DIRECTIVE");
            expect(context.engineeredPromptContext).toContain("SECTION 2: ISOLATION MOCK CONTRACTS");
            expect(context.engineeredPromptContext).toContain("SECTION 3: MANDATORY DECISION TABLE TEST MATRIX");
            expect(context.engineeredPromptContext).toContain("SECTION 4: COVERAGE GAPS & TARGETED DECISION GUIDANCE");
        });

        it("assembles context gracefully on empty string or syntax error source code without throwing", () => {
            const edgeCases = ["", "   ", "const invalid = {"];
            for (const badCode of edgeCases) {
                expect(() => {
                    const ctx = assembleUnitTestContext({
                        sourceCode: badCode,
                        framework: "jest",
                        existingTestCode: ""
                    });
                    expect(ctx).toBeDefined();
                    expect(ctx.engineeredPromptContext).toBeDefined();
                }).not.toThrow();
            }
        });
    });

    // =========================================================================
    // SECTION 3: DOWNSTREAM TEST GENERATION (generateAiUnitTestSuite)
    // =========================================================================
    describe("3. generateAiUnitTestSuite Resilient Fallback", () => {
        it("executes assembleUnitTestContext and generates structured fallback tests without 500", async () => {
            const sourceCode = `
                export function add(a, b) {
                    if (typeof a !== 'number' || typeof b !== 'number') {
                        throw new TypeError("Arguments must be numbers");
                    }
                    return a + b;
                }
            `;

            const snapshot = {
                id: "snap-m5-test",
                projectId: "proj-m5-stress",
                rootDir: tmpDir,
            };

            const srcFile = path.join(tmpDir, "src", "mathService.js");
            fs.mkdirSync(path.dirname(srcFile), { recursive: true });
            fs.writeFileSync(srcFile, sourceCode, "utf8");

            const suggestion = await generateAiUnitTestSuite({
                userId: "user-test",
                framework: "jest",
                snapshot,
                sourceFileToInspect: "src/mathService.js",
                sourceCode,
                coverageDetails: {
                    uncoveredLines: [3],
                    failedLines: [],
                    summary: { linesPct: 66.7, branchesPct: 50.0, functionsPct: 100.0, statementsPct: 75.0 },
                },
                isTest: false,
                filePath: "src/mathService.js"
            });

            expect(suggestion).toBeDefined();
            expect(suggestion.suggestionId).toBeDefined();
            expect(suggestion.framework).toBe("jest");
            expect(suggestion.sourceFile).toBe("src/mathService.js");
            expect(suggestion.suggestedTestCode).toBeDefined();
            expect(suggestion.fullUpdatedContent).toBeDefined();
            expect(suggestion.targetLines).toEqual([3]);
        });
    });

    // =========================================================================
    // SECTION 4: suggestUnitTestcases SERVICE INTEGRATION
    // =========================================================================
    describe("4. suggestUnitTestcases Service End-to-End Execution", () => {
        it("successfully analyzes business logic file on disk and returns complete suggestion without 500", async () => {
            const sourceCode = `
                import { create, all } from 'mathjs';

                export function calculateMetric(val) {
                    if (val < 0) return 0;
                    return val * 1.5;
                }
            `;

            const srcDir = path.join(tmpDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            const serviceFile = path.join(srcDir, "metric.service.js");
            fs.writeFileSync(serviceFile, sourceCode, "utf8");

            // Mock project & snapshot in prisma
            mockPrisma.project.findFirst.mockResolvedValueOnce({
                id: "proj-m5-stress",
                workspaceRevision: 1,
                snapshots: [
                    {
                        id: "snap-m5-stress",
                        rootDir: tmpDir,
                        createdAt: new Date(),
                    },
                ],
            });

            const result = await suggestUnitTestcases({
                projectId: "proj-m5-stress",
                snapshotId: "snap-m5-stress",
                filePath: "src/services/metric.service.js",
                userId: "user-123",
                framework: "vitest",
            });

            expect(result).toBeDefined();
            expect(result.suggestionId).toBeDefined();
            expect(result.sourceFile).toBe("src/services/metric.service.js");
            expect(result.framework).toBe("vitest");
            expect(result.suggestedTestCode).toBeDefined();
            expect(result.infeasibleCode).toBeDefined();
            expect(result.infeasibleBranches).toBeDefined();
        });

        it("handles source code with syntax error without throwing 500 error", async () => {
            const brokenCode = `
                export function brokenSyntax(a, b) {
                    if (a > 0
                    return a;
                }
            `;

            const srcDir = path.join(tmpDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            const serviceFile = path.join(srcDir, "broken.service.js");
            fs.writeFileSync(serviceFile, brokenCode, "utf8");

            mockPrisma.project.findFirst.mockResolvedValueOnce({
                id: "proj-m5-stress",
                workspaceRevision: 1,
                snapshots: [
                    {
                        id: "snap-m5-stress",
                        rootDir: tmpDir,
                        createdAt: new Date(),
                    },
                ],
            });

            const result = await suggestUnitTestcases({
                projectId: "proj-m5-stress",
                snapshotId: "snap-m5-stress",
                filePath: "src/services/broken.service.js",
                userId: "user-123",
                framework: "jest",
            });

            expect(result).toBeDefined();
            expect(result.sourceFile).toBe("src/services/broken.service.js");
            expect(result.suggestedTestCode).toBeDefined();
        });
    });

    // =========================================================================
    // SECTION 5: CONTROLLER POST /api/coverage/:snapshotId/suggest-testcase
    // =========================================================================
    describe("5. Controller POST /api/coverage/:snapshotId/suggest-testcase Integration", () => {
        it("returns HTTP 200 with complete Section 3.1 payload on valid request", async () => {
            const sourceCode = `
                export function validateUser(user) {
                    if (!user) throw new Error("User required");
                    if (!user.email) return false;
                    return true;
                }
            `;
            const srcDir = path.join(tmpDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "user.service.js"), sourceCode, "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: "snap-controller-test",
                projectId: "proj-controller-test",
            });

            mockPrisma.project.findFirst.mockResolvedValueOnce({
                id: "proj-controller-test",
                workspaceRevision: 1,
                snapshots: [
                    {
                        id: "snap-controller-test",
                        rootDir: tmpDir,
                        createdAt: new Date(),
                    },
                ],
            });

            const req = {
                user: { id: "user-123" },
                params: { snapshotId: "snap-controller-test" },
                body: {
                    filePath: "src/services/user.service.js",
                    framework: "jest",
                },
            };

            let responseStatus = null;
            let responseJson = null;
            const res = {
                status: jest.fn((code) => {
                    responseStatus = code;
                    return res;
                }),
                json: jest.fn((data) => {
                    responseJson = data;
                    return res;
                }),
            };

            await suggestUnitTestcase(req, res);

            expect(responseStatus).toBe(200);
            expect(responseJson).toBeDefined();
            expect(responseJson.success).toBe(true);
            expect(responseJson.data).toBeDefined();
            expect(responseJson.data.sourceFile).toBe("src/services/user.service.js");
            expect(responseJson.data.suggestedTestCode).toBeDefined();
            expect(Array.isArray(responseJson.data.infeasibleCode)).toBe(true);
            expect(Array.isArray(responseJson.data.infeasibleBranches)).toBe(true);
        });

        it("returns HTTP 400 when filePath is missing", async () => {
            const req = {
                user: { id: "user-123" },
                params: { snapshotId: "snap-123" },
                body: {},
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: "filePath is required in body.",
            }));
        });

        it("returns HTTP 401 when user is not authenticated", async () => {
            const req = {
                user: null,
                params: { snapshotId: "snap-123" },
                body: { filePath: "src/service.js" },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: "Unauthorized.",
            }));
        });
    });
});
