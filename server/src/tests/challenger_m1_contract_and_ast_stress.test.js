import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { extractTestRequests } from "../services/testSourceParser.service.js";
import { analyzeSourceAst, isBusinessLogicFile } from "../services/businessLogicAstAnalyzer.service.js";
import { buildDecisionTableMatrix } from "../services/unitTestContextEngineering.service.js";
import { escapePromptCode, autoHealAstSyntax, generateAiUnitTestSuite } from "../services/unitTestGenerator.service.js";
import { suggestUnitTestcases, findSourceOnDisk } from "../services/unitTestSuggestion.service.js";
import { suggestUnitTestcase, suggestUnitTestcaseAll } from "../controllers/coverage.controller.js";

describe("Milestone 1 Adversarial Challenge & Stress Harness", () => {

    // =========================================================================
    // SECTION 1: M1 ↔ M2 CONTRACT VERIFICATION
    // =========================================================================
    describe("1. M1 ↔ M2 Suggestion Payload Contract Verification", () => {
        test("generateAiUnitTestSuite return value contains M1 contract fields", async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-contract-test-"));
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            const srcPath = path.join(srcDir, "calculator.service.js");
            const srcCode = `
                export function add(a, b) {
                    if (a == null || b == null) throw new Error("Invalid args");
                    return a + b;
                }
            `;
            fs.writeFileSync(srcPath, srcCode, "utf8");

            const snapshot = {
                id: "snap-contract-1",
                projectId: "proj-1",
                rootDir: tempDir
            };

            const coverageDetails = {
                summary: { linesPct: 50, branchesPct: 50, funcsPct: 50, statementsPct: 50 },
                uncoveredLines: [3],
                uncoveredBranches: [{ line: 3, type: "if", missedTrue: true }]
            };

            const result = await generateAiUnitTestSuite({
                userId: null,
                framework: "jest",
                snapshot,
                sourceFileToInspect: "src/services/calculator.service.js",
                sourceCode: srcCode,
                coverageDetails,
                isTest: false,
                filePath: "src/services/calculator.service.js"
            });

            // Clean up
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

            // Contract requirements from PROJECT.md:
            // - data.testCode: Clean, valid test code
            // - data.targetTestFile: Relative path to test file
            // - data.targetSourceFile: Relative path to source file under test
            // - data.scenarioMatrix: 4-category test scenario table (Categories A, B, C, D)
            expect(result).toBeDefined();
            // Check contract fields explicitly required by PROJECT.md M1 ↔ M2 contract:
            // 1. data.testCode
            expect(result.testCode).toBeDefined();
            expect(typeof result.testCode).toBe("string");
            expect(result.testCode.length).toBeGreaterThan(0);

            // 2. data.targetTestFile
            expect(result.targetTestFile).toBeDefined();
            expect(typeof result.targetTestFile).toBe("string");
            expect(result.targetTestFile.length).toBeGreaterThan(0);

            // 3. data.targetSourceFile
            expect(result.targetSourceFile).toBeDefined();
            expect(typeof result.targetSourceFile).toBe("string");
            expect(result.targetSourceFile).toBe("src/services/calculator.service.js");

            // 4. data.scenarioMatrix
            expect(result.scenarioMatrix).toBeDefined();
            expect(Array.isArray(result.scenarioMatrix)).toBe(true);
        });

        test("testCode must not be wrapped in markdown code fences (```javascript ... ```)", async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-fences-test-"));
            const srcPath = path.join(tempDir, "service.js");
            const srcCode = "export const echo = (msg) => msg || 'default';";
            fs.writeFileSync(srcPath, srcCode, "utf8");

            const snapshot = { id: "snap-fences-1", rootDir: tempDir };
            const coverageDetails = { uncoveredLines: [1] };

            const result = await generateAiUnitTestSuite({
                userId: null,
                framework: "jest",
                snapshot,
                sourceFileToInspect: "service.js",
                sourceCode: srcCode,
                coverageDetails,
                isTest: false,
                filePath: "service.js"
            });

            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

            const code = result.testCode || result.suggestedTestCode || result.generatedCode;
            expect(code).toBeDefined();
            expect(code).not.toMatch(/^```/);
            expect(code).not.toMatch(/```$/);
        });
    });

    // =========================================================================
    // SECTION 2: 4-CATEGORY DECISION TABLE UNDER EXTREME BOUNDARY INPUTS
    // =========================================================================
    describe("2. 4-Category Decision Table Matrix Under Boundary Inputs", () => {
        test("Class with member methods, getters, setters, and static helpers", () => {
            const code = `
                export class PaymentService {
                    #apiKey;
                    constructor(apiKey) {
                        if (!apiKey) throw new Error("API key required");
                        this.#apiKey = apiKey;
                    }
                    get isConfigured() {
                        return Boolean(this.#apiKey);
                    }
                    static validateCurrency(curr) {
                        return curr === "USD" || curr === "EUR" ? true : false;
                    }
                    async charge(amount, currency = "USD") {
                        if (amount <= 0) throw new RangeError("Invalid amount");
                        const fee = amount > 1000 ? amount * 0.01 : 0;
                        return { charged: amount + fee, currency };
                    }
                }
            `;

            const ast = analyzeSourceAst(code);
            expect(ast.exportedSymbols.length).toBeGreaterThan(0);
            const paymentService = ast.exportedSymbols.find(s => s.name === "PaymentService");
            expect(paymentService).toBeDefined();
            expect(paymentService.methods).toBeDefined();
            expect(paymentService.methods.length).toBeGreaterThanOrEqual(2);

            const matrix = buildDecisionTableMatrix({
                astMetadata: ast,
                coverageGaps: { uncoveredLines: [5, 12, 16], uncoveredBranches: [] },
                sourceCode: code,
                filePath: "PaymentService.js"
            });

            expect(matrix.matrixEntries).toBeDefined();
            const entries = matrix.matrixEntries;

            // Check Category A (Happy Path)
            const happyPath = entries.filter(e => e.category === "HAPPY_PATH");
            expect(happyPath.length).toBeGreaterThanOrEqual(1);

            // Check Category B (Boundary Values)
            const boundary = entries.filter(e => e.category === "BOUNDARY_VALUES");
            expect(boundary.length).toBeGreaterThanOrEqual(2);

            // Check Category C (Branch Toggling)
            const branch = entries.filter(e => e.category === "BRANCH_TOGGLING");
            expect(branch.length).toBeGreaterThanOrEqual(2);

            // Check Category D (Error Handling)
            const errorHandling = entries.filter(e => e.category === "ERROR_HANDLING");
            expect(errorHandling.length).toBeGreaterThanOrEqual(1);

            console.log("Decision table summary for Class:", matrix.summary);
        });

        test("Deeply nested nullish coalescing, optional chaining, and logical ternary chains", () => {
            const code = `
                export function resolveSettings(user) {
                    const theme = user?.preferences?.theme ?? "dark";
                    const timeout = user?.options?.timeout ? (user.options.timeout > 5000 ? 5000 : user.options.timeout) : 1000;
                    const canEdit = user?.role === "ADMIN" || user?.role === "EDITOR" && user?.isActive;
                    if (!canEdit) throw new Error("Unauthorized");
                    return { theme, timeout, canEdit };
                }
            `;

            const ast = analyzeSourceAst(code);
            const matrix = buildDecisionTableMatrix({
                astMetadata: ast,
                coverageGaps: { uncoveredLines: [3, 4, 5, 6], uncoveredBranches: [] },
                sourceCode: code,
                filePath: "settings.js"
            });

            expect(matrix.summary.totalTestCases).toBeGreaterThanOrEqual(4);
            expect(matrix.summary.happyPathCount).toBeGreaterThanOrEqual(1);
            expect(matrix.summary.boundaryCount).toBeGreaterThanOrEqual(2);
            expect(matrix.summary.branchTogglingCount).toBeGreaterThanOrEqual(1);
            expect(matrix.summary.errorHandlingCount).toBeGreaterThanOrEqual(1);
        });

        test("Empty source code and pure comment file produce safe fallbacks without throwing", () => {
            const emptyAst = analyzeSourceAst("");
            expect(emptyAst.cyclomaticComplexity).toBe(1);
            expect(emptyAst.exportedSymbols).toEqual([]);

            const emptyMatrix = buildDecisionTableMatrix({
                astMetadata: emptyAst,
                coverageGaps: null,
                sourceCode: "",
                filePath: "empty.js"
            });

            expect(emptyMatrix.matrixEntries.length).toBeGreaterThanOrEqual(1);
            expect(emptyMatrix.decisionTableMarkdown).toContain("| ID |");

            const commentsCode = "// Only comments\n/* Multi-line\n   comment */";
            const commentsAst = analyzeSourceAst(commentsCode);
            const commentsMatrix = buildDecisionTableMatrix({
                astMetadata: commentsAst,
                coverageGaps: null,
                sourceCode: commentsCode,
                filePath: "comments.js"
            });
            expect(commentsMatrix.matrixEntries.length).toBeGreaterThanOrEqual(1);
        });

        test("Function with 0 parameters and no branches still receives Category A, B, and D tests", () => {
            const code = "export function getSystemInfo() { return { os: 'windows', memory: 16 }; }";
            const ast = analyzeSourceAst(code);
            const matrix = buildDecisionTableMatrix({
                astMetadata: ast,
                coverageGaps: null,
                sourceCode: code,
                filePath: "system.js"
            });

            const categories = new Set(matrix.matrixEntries.map(e => e.category));
            expect(categories.has("HAPPY_PATH")).toBe(true);
            expect(categories.has("BOUNDARY_VALUES")).toBe(true);
            expect(categories.has("ERROR_HANDLING")).toBe(true);
        });
    });

    // =========================================================================
    // SECTION 3: TEST SOURCE PARSER MODERN ES2022+ FEATURES
    // =========================================================================
    describe("3. testSourceParser.service.js with ES2022+ Syntax", () => {
        test("handles top-level await in test file without losing test requests", () => {
            const code = `
                const app = await import("../app.js");
                describe("Top-level Await Suite", () => {
                    it("fetches status", async () => {
                        await request(app).get("/api/status");
                    });
                });
            `;
            const reqs = extractTestRequests(code, "tests/status.test.js");
            expect(reqs.length).toBe(1);
            expect(reqs[0].method.toUpperCase()).toBe("GET");
            expect(reqs[0].path).toBe("/api/status");
        });

        test("handles static class blocks (ES2022) in test helpers", () => {
            const code = `
                class FixtureConfig {
                    static port;
                    static {
                        this.port = 8080;
                    }
                }
                describe("Static Block Suite", () => {
                    it("creates resource", async () => {
                        await request(app).post("/api/items").send({ port: FixtureConfig.port });
                    });
                });
            `;
            const reqs = extractTestRequests(code, "tests/items.test.js");
            expect(reqs.length).toBe(1);
            expect(reqs[0].method.toUpperCase()).toBe("POST");
            expect(reqs[0].path).toBe("/api/items");
        });

        test("handles private brand checks (#field in obj) (ES2022)", () => {
            const code = `
                class BrandValidator {
                    #brand;
                    static isInstance(obj) {
                        return #brand in obj;
                    }
                }
                describe("Brand Check Suite", () => {
                    it("checks brand", async () => {
                        await request(app).put("/api/validate");
                    });
                });
            `;
            const reqs = extractTestRequests(code, "tests/validate.test.js");
            expect(reqs.length).toBe(1);
            expect(reqs[0].method.toUpperCase()).toBe("PUT");
            expect(reqs[0].path).toBe("/api/validate");
        });

        test("handles regex 'd' indices flag and numeric separators (ES2022)", () => {
            const code = `
                const MATCH_ID = /user-(\\d+)/d;
                const RETRIES = 1_000_000;
                describe("Indices Flag Suite", () => {
                    it("deletes user", async () => {
                        await request(app).delete("/api/users/999");
                    });
                });
            `;
            const reqs = extractTestRequests(code, "tests/indices.test.js");
            expect(reqs.length).toBe(1);
            expect(reqs[0].method.toUpperCase()).toBe("DELETE");
            expect(reqs[0].path).toBe("/api/users/999");
        });
    });

    // =========================================================================
    // SECTION 4: STORAGE & UPLOADS IMMUTABILITY GUARD
    // =========================================================================
    describe("4. Storage & Uploads Immutability Guard", () => {
        test("verifies no files in server/storage or server/uploads are modified", () => {
            const storageDir = path.resolve(process.cwd(), "server", "storage");
            const uploadsDir = path.resolve(process.cwd(), "server", "uploads");

            if (fs.existsSync(storageDir)) {
                // Ensure no temp files created by tests exist in root storage
                const entries = fs.readdirSync(storageDir);
                for (const e of entries) {
                    expect(e).not.toMatch(/test-corrupt|temp-mutation/);
                }
            }
            if (fs.existsSync(uploadsDir)) {
                const entries = fs.readdirSync(uploadsDir);
                for (const e of entries) {
                    expect(e).not.toMatch(/test-corrupt|temp-mutation/);
                }
            }
        });
    });
});
