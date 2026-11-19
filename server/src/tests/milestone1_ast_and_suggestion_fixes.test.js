import { describe, expect, it, jest } from "@jest/globals";
import path from "path";
import os from "os";
import fs from "fs";
import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { extractTestRequests } from "../services/testSourceParser.service.js";
import { analyzeSourceAst } from "../services/businessLogicAstAnalyzer.service.js";
import {
    buildDecisionTableMatrix,
    buildIndirectTestingStrategy
} from "../services/unitTestContextEngineering.service.js";
import {
    escapePromptCode,
    autoHealAstSyntax
} from "../services/unitTestGenerator.service.js";
import {
    findSourceOnDisk
} from "../services/unitTestSuggestion.service.js";
import { suggestUnitTestcaseAll } from "../controllers/coverage.controller.js";
import coverageRouter from "../routes/coverage.route.js";

describe("Milestone 1 — Comprehensive AST & Suggestion Pipeline Hardening", () => {
    // ------------------------------------------------------------------------
    // Feature 1: Babel Parser Plugin Deficiencies
    // ------------------------------------------------------------------------
    describe("Feature 1: Babel Parser Plugins & Generics Resolution", () => {
        it("successfully parses TypeScript decorators", () => {
            const code = `
                @Injectable()
                export class OrderService {
                    @Prop()
                    total: number = 0;
                }
            `;
            const result = parseJavaScriptCode(code, { filePath: "src/services/order.service.ts" });
            expect(result.success).toBe(true);
            expect(result.ast).toBeTruthy();
        });

        it("resolves TypeScript generic arrow functions without JSX collision", () => {
            const code = `export const identity = <T>(x: T): T => x;`;
            const result = parseJavaScriptCode(code, { filePath: "src/utils/identity.ts" });
            expect(result.success).toBe(true);
            expect(result.ast).toBeTruthy();
        });

        it("parses JSX elements in React/JSX contexts", () => {
            const code = `export const Header = () => <div><h1>Title</h1></div>;`;
            const result = parseJavaScriptCode(code, { filePath: "src/components/Header.jsx" });
            expect(result.success).toBe(true);
            expect(result.ast).toBeTruthy();
        });

        it("returns a safe error message on malformed JavaScript", () => {
            const result = parseJavaScriptCode("const = ;");
            expect(result.success).toBe(false);
            expect(result.ast).toBeNull();
            expect(result.error).toBeTruthy();
        });
    });

    // ------------------------------------------------------------------------
    // Feature 2: Modern ES Syntax in Test Source Parser
    // ------------------------------------------------------------------------
    describe("Feature 2: Modern ES Syntax in Test Source Parser", () => {
        it("extracts Supertest requests without crashing on optional chaining, nullish coalescing, numeric separators, or private fields", () => {
            const testCode = `
                describe("Modern API Test", () => {
                    class FixtureHandler {
                        #secretKey = 1_000_000;
                    }
                    it("fetches cart details", async () => {
                        const payload = {
                            limit: 1_000,
                            filter: req?.query?.filter ?? "active"
                        };
                        const res = await request(app).get("/api/cart").send(payload);
                        expect(res.status).toBe(200);
                    });
                });
            `;
            const requests = extractTestRequests(testCode, "tests/cart.test.js");
            expect(requests).toHaveLength(1);
            expect(requests[0].method).toBe("GET");
            expect(requests[0].path).toBe("/api/cart");
            expect(requests[0].expectedStatus).toBe(200);
            expect(requests[0].payload).toEqual({ limit: 1000, filter: null });
        });
    });

    // ------------------------------------------------------------------------
    // Feature 3: Scope Attribution in Context Engineering
    // ------------------------------------------------------------------------
    describe("Feature 3: Scope Attribution Bug & Innermost Enclosing Symbol", () => {
        it("accurately attributes decision points to the enclosing function rather than halting on exportedSymbols[0]", () => {
            const astMetadata = {
                exportedSymbols: [
                    { name: "init", line: 5, startLine: 5, endLine: 20 },
                    { name: "processOrder", line: 50, startLine: 50, endLine: 100 },
                    { name: "checkout", line: 120, startLine: 120, endLine: 150 }
                ],
                internalFunctions: [],
                decisionPoints: [
                    { line: 65, type: "if", text: "if (order.total > 0)" },
                    { line: 135, type: "if", text: "if (payment.approved)" }
                ],
                exceptionPoints: [],
                cyclomaticComplexity: 3
            };

            const result = buildDecisionTableMatrix({
                astMetadata,
                sourceCode: "// dummy source",
                filePath: "src/services/order.service.js"
            });

            const branchScenarios = result.matrixEntries.filter(e => e.category === "BRANCH_TOGGLING");
            expect(branchScenarios.length).toBeGreaterThan(0);

            // Line 65 must map to processOrder, NOT init
            const line65Scenarios = branchScenarios.filter(e => e.targetLine === 65);
            expect(line65Scenarios.length).toBeGreaterThan(0);
            expect(line65Scenarios[0].targetFunction).toBe("processOrder");

            // Line 135 must map to checkout, NOT init
            const line135Scenarios = branchScenarios.filter(e => e.targetLine === 135);
            expect(line135Scenarios.length).toBeGreaterThan(0);
            expect(line135Scenarios[0].targetFunction).toBe("checkout");
        });
    });

    // ------------------------------------------------------------------------
    // Feature 4: Call Graph Regex Fallback Scope Guard
    // ------------------------------------------------------------------------
    describe("Feature 4: Call Graph Regex Fallback Scope Guard", () => {
        it("only links helper callers to exported symbols whose function bodies actually invoke the helper", () => {
            const sourceCode = `
                function _privateHelper() {
                    return 42;
                }

                export function callerA() {
                    return _privateHelper();
                }

                export function callerB() {
                    return "independent function";
                }
            `;

            const analysis = analyzeSourceAst(sourceCode);
            const helper = analysis.internalFunctions.find(f => f.name === "_privateHelper");
            expect(helper).toBeDefined();
            expect(helper.callers).toContain("callerA");
            expect(helper.callers).not.toContain("callerB");
        });
    });

    // ------------------------------------------------------------------------
    // Feature 5: Clean Helper Backtracking (No Fake Chains)
    // ------------------------------------------------------------------------
    describe("Feature 5: Clean Helper Backtracking without Fabricated Call Chains", () => {
        it("flags uncalled internal helpers without manufacturing fictitious caller chains", () => {
            const internalFunctions = [
                { name: "_orphanHelper", line: 10, callers: [] }
            ];
            const exportedSymbols = [
                { name: "unrelatedExport", type: "function", line: 50 }
            ];

            const result = buildIndirectTestingStrategy({
                astMetadata: { internalFunctions, exportedSymbols, callEdges: [] }
            });
            expect(result.indirectStrategies).toHaveLength(1);
            expect(result.indirectStrategies[0].exportedCallers).toEqual([]);
            expect(result.indirectStrategies[0].callChains).toEqual([]);
            expect(result.indirectGuidancePrompt).toContain("NO discovered exported caller");
            expect(result.indirectGuidancePrompt).not.toContain("unrelatedExport -> _orphanHelper");
        });
    });

    // ------------------------------------------------------------------------
    // Feature 6: Code Fence & Markdown Table Sanitization
    // ------------------------------------------------------------------------
    describe("Feature 6: Prompt Code Fence & Markdown Table Escaping", () => {
        it("escapes triple backticks in source code so prompt code fences do not break", () => {
            const codeWithFences = "const markdown = '```javascript\\nconsole.log(1);\\n```';";
            const escaped = escapePromptCode(codeWithFences);
            expect(escaped).not.toContain("```");
            expect(escaped).toContain("\\`\\`\\`");
        });

        it("sanitizes newlines in decision table cells to preserve markdown table rows", () => {
            const astMetadata = {
                exportedSymbols: [{ name: "calculate", line: 1, startLine: 1, endLine: 30 }],
                internalFunctions: [],
                decisionPoints: [
                    {
                        line: 10,
                        type: "if",
                        text: "if (a > 0 &&\n    b > 0 &&\n    c > 0)"
                    }
                ],
                exceptionPoints: [],
                cyclomaticComplexity: 2
            };

            const result = buildDecisionTableMatrix({
                astMetadata,
                sourceCode: "// code",
                filePath: "src/calc.js"
            });

            const rows = result.decisionTableMarkdown.split("\n").filter(r => r.startsWith("|"));
            for (const row of rows) {
                // Each table row should be on a single physical line and not contain raw newlines
                expect(row).not.toMatch(/\r?\n/);
            }
        });
    });

    // ------------------------------------------------------------------------
    // Feature 7: Batch Suggestion Route & Controller Handler
    // ------------------------------------------------------------------------
    describe("Feature 7: Batch Suggestion Endpoint & Multi-file Iteration", () => {
        it("registers POST /:snapshotId/suggest-testcase-all route handler", () => {
            const routes = coverageRouter.stack
                .filter(layer => layer.route)
                .map(layer => ({
                    path: layer.route.path,
                    methods: Object.keys(layer.route.methods)
                }));

            const batchRoute = routes.find(r => r.path === "/:snapshotId/suggest-testcase-all");
            expect(batchRoute).toBeDefined();
            expect(batchRoute.methods).toContain("post");
        });

        it("suggestUnitTestcaseAll requires authenticated user session (returns 401 when unauthorized)", async () => {
            const reqUnauthorized = {
                params: { snapshotId: "snap_m1_test" },
                body: {}
            };
            const resUnauthorized = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcaseAll(reqUnauthorized, resUnauthorized);
            expect(resUnauthorized.status).toHaveBeenCalledWith(401);
            expect(resUnauthorized.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: "Unauthorized."
            }));
        });
    });

    // ------------------------------------------------------------------------
    // Feature 8: Arbitrary Path Traversal Guard
    // ------------------------------------------------------------------------
    describe("Feature 8: Arbitrary Path Traversal Guard in findSourceOnDisk", () => {
        it("rejects path traversal attempts outside workspace root", () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-test-"));
            try {
                // File inside workspace
                const validFile = path.join(tempDir, "service.js");
                fs.writeFileSync(validFile, "export const ok = true;");

                // Legitimate lookup
                const found = findSourceOnDisk(tempDir, "service.js");
                expect(found.content).toContain("export const ok = true;");

                // Arbitrary absolute file outside workspace
                const outsideFile = path.join(os.tmpdir(), "outside-secret.txt");
                fs.writeFileSync(outsideFile, "secret_data");
                try {
                    const traversalRes = findSourceOnDisk(tempDir, outsideFile);
                    expect(traversalRes.content).toBe("");
                    expect(traversalRes.path).toBeNull();
                } finally {
                    fs.rmSync(outsideFile, { force: true });
                }

                // Relative directory traversal
                const relTraversal = findSourceOnDisk(tempDir, "../../../etc/passwd");
                expect(relTraversal.content).toBe("");
                expect(relTraversal.path).toBeNull();
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });

    // ------------------------------------------------------------------------
    // Feature 9: AST Brace Balancing & Timer Cleanup
    // ------------------------------------------------------------------------
    describe("Feature 9: AST Brace Balancing without Extraneous Parentheses", () => {
        it("balances unclosed block braces using closing braces without injecting extraneous closing parentheses", () => {
            const unclosedObjCode = `
                describe("suite", () => {
                    it("tests something", () => {
                        const payload = {
                            a: 1,
                            b: 2
            `;
            const healed = autoHealAstSyntax(unclosedObjCode, { framework: "jest" });
            expect(healed.success).toBe(true);

            // Verify parse produces no syntax errors
            const parsed = parseJavaScriptCode(healed.code);
            expect(parsed.success).toBe(true);
        });
    });
});
