import { describe, test, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

import { parseJavaScriptCode, parseJavaScriptFile } from "../services/babelParser.service.js";
import { extractTestRequests } from "../services/testSourceParser.service.js";
import { analyzeSourceAst } from "../services/businessLogicAstAnalyzer.service.js";
import {
    buildDecisionTableMatrix,
    buildIndirectTestingStrategy
} from "../services/unitTestContextEngineering.service.js";
import { escapePromptCode, autoHealAstSyntax } from "../services/unitTestGenerator.service.js";
import { findSourceOnDisk, computeRelativeImportPath } from "../services/unitTestSuggestion.service.js";
import { suggestUnitTestcaseAll } from "../controllers/coverage.controller.js";

describe("Milestone 1 — Comprehensive Adversarial Challenge & Stress Suite", () => {

    // =========================================================================
    // SECTION 1: AST PARSER STRESS & ADVERSARIAL SYNTAX
    // =========================================================================
    describe("1. AST Parser Stress: Babel & Test Source Parsers", () => {
        test("parses TypeScript generic arrow function with multiple type params and constraints", () => {
            const code = "const fn = <T, U extends keyof T>(a: T, b: U): U => b;";
            const res = parseJavaScriptCode(code, { filePath: "src/utils.ts" });
            expect(res.success).toBe(true);
            expect(res.ast).toBeDefined();
            expect(res.ast.type).toBe("File");
        });

        test("parses TypeScript generic arrow function in plain code without explicit ts extension", () => {
            const code = "const fn = <T, U extends keyof T>(a: T, b: U): U => b;";
            const res = parseJavaScriptCode(code);
            expect(res.success).toBe(true);
            expect(res.ast).toBeDefined();
        });

        test("parses nested class decorators with method decorators and parameter decorators", () => {
            const code = `
                @Injectable()
                export class UserService {
                    @Log()
                    @Validate({ strict: true })
                    async findById(@Param("id") id: string): Promise<User> {
                        return this.repo.find(id);
                    }
                }
            `;
            const res = parseJavaScriptCode(code, { filePath: "src/user.service.ts" });
            expect(res.success).toBe(true);
            expect(res.ast).toBeDefined();
        });

        test("parses complex deeply-nested optional chaining and nullish coalescing expressions", () => {
            const code = `
                const val = a?.b?.()?.[c]?.(d)?.e?.[0]?.f?.() ?? defaultVal ?? "fallback";
            `;
            const res = parseJavaScriptCode(code);
            expect(res.success).toBe(true);
            expect(res.ast).toBeDefined();
        });

        test("testSourceParser extracts Supertest calls with complex optional chaining and template literals", () => {
            const testCode = `
                describe("User API", () => {
                    it("retrieves user profile", async () => {
                        const userId = 42;
                        const res = await request(app)
                            ?.get(\`/api/v1/users/\${userId}\`)
                            ?.set("Authorization", "Bearer token")
                            ?.expect(200);
                        expect(res?.body?.id).toBe(42);
                    });
                });
            `;
            const requests = extractTestRequests(testCode, "tests/user.test.js");
            expect(Array.isArray(requests)).toBe(true);
            expect(requests.length).toBeGreaterThan(0);
            expect(requests[0].method).toBe("GET");
            expect(requests[0].path).toBe("/api/v1/users/42");
        });

        test("testSourceParser gracefully handles private fields and modern numeric separators in tests", () => {
            const testCode = `
                class Fixture {
                    #secret = 1_000_000;
                    getSecret() { return this.#secret; }
                }
                describe("Payment API", () => {
                    test("posts payment", async () => {
                        const fixture = new Fixture();
                        await request(app).post("/api/checkout").send({ amount: fixture.getSecret() });
                    });
                });
            `;
            const requests = extractTestRequests(testCode, "tests/payment.test.js");
            expect(requests.length).toBe(1);
            expect(requests[0].method).toBe("POST");
            expect(requests[0].path).toBe("/api/checkout");
        });
        test("parses TSX containing both generic arrow functions and JSX elements", () => {
            const code = `
                import React from "react";
                export const GenericList = <T, U extends keyof T>({ items, prop }: { items: T[], prop: U }) => {
                    return <div>{items.map((it, idx) => <span key={idx}>{String(it[prop])}</span>)}</div>;
                };
            `;
            const res = parseJavaScriptCode(code, { filePath: "src/components/List.tsx" });
            expect(res.success).toBe(true);
            expect(res.ast).toBeDefined();
        });

        test("parses class with stacked decorators and property decorators", () => {
            const code = `
                @Entity("users")
                @Index(["email", "status"])
                export class UserEntity {
                    @PrimaryGeneratedColumn()
                    id: number;

                    @Column({ type: "varchar", length: 255 })
                    email: string;
                }
            `;
            const res = parseJavaScriptCode(code, { filePath: "src/entities/user.entity.ts" });
            expect(res.success).toBe(true);
            expect(res.ast).toBeDefined();
        });

        test("parses async generators, top-level await, and dynamic imports", () => {
            const code = `
                const config = await import("./config.js");
                export async function* eventStream() {
                    let count = 0;
                    while (count < 10) {
                        yield { count: count++, timestamp: Date.now() };
                    }
                }
            `;
            const res = parseJavaScriptCode(code);
            expect(res.success).toBe(true);
            expect(res.ast).toBeDefined();
        });
    });

    // =========================================================================
    // SECTION 2: CALL GRAPH & SCOPE ATTRIBUTION STRESS
    // =========================================================================
    describe("2. Call Graph & Scope Attribution Stress", () => {
        test("attributes decision points to innermost enclosing function in nested and adjacent scopes", () => {
            const code = `
                export function outer(x) {
                    // Line 3: outer decision
                    if (x > 100) return "big";
                    function inner(y) {
                        // Line 6: inner decision
                        if (y < 0) return 0;
                        return y * 2;
                    }
                    return inner(x);
                }
            `;
            const astRes = analyzeSourceAst(code);
            expect(astRes.decisionPoints.length).toBeGreaterThanOrEqual(2);

            // Scenarios generated from context engineering
            const matrixResult = buildDecisionTableMatrix({
                astMetadata: astRes,
                coverageGaps: {
                    uncoveredBranches: [
                        { line: 3, branchIndex: 0, branchType: "if" },
                        { line: 6, branchIndex: 0, branchType: "if" }
                    ],
                    uncoveredLines: [3, 6],
                    uncoveredFunctions: []
                },
                sourceCode: code,
                filePath: "nested.js"
            });

            const catC = matrixResult.matrixEntries.filter(s => s.category === "C");
            const innerBranch = catC.find(s => s.branchPoint?.line === 6 || s.uncoveredBranchLine === 6 || s.targetLine === 6);
            const outerBranch = catC.find(s => s.branchPoint?.line === 3 || s.uncoveredBranchLine === 3 || s.targetLine === 3);

            if (innerBranch) {
                expect(innerBranch.enclosingFunction || innerBranch.functionName).toBe("inner");
            }
            if (outerBranch) {
                expect(outerBranch.enclosingFunction || outerBranch.functionName).toBe("outer");
            }
        });

        test("single-line functions sharing lines do not throw or corrupt enclosing function lookup", () => {
            const code = "export const fnA = (a) => (a > 0 ? 1 : 0); export const fnB = (b) => (b < 0 ? -1 : 0);";
            const astRes = analyzeSourceAst(code);
            expect(astRes.exportedSymbols.length).toBe(2);

            const matrixResult = buildDecisionTableMatrix({
                astMetadata: astRes,
                coverageGaps: {
                    uncoveredBranches: [{ line: 1, branchIndex: 0, branchType: "ternary" }],
                    uncoveredLines: [1],
                    uncoveredFunctions: []
                },
                sourceCode: code,
                filePath: "singleLine.js"
            });

            expect(Array.isArray(matrixResult.matrixEntries)).toBe(true);
            expect(matrixResult.matrixEntries.length).toBeGreaterThan(0);
        });

        test("unexported helper with 0 callers produces empty callers without fabricating chains", () => {
            const code = `
                export const publicApi = () => "ok";
                function orphanHelper() { return "unused"; }
            `;
            const astRes = analyzeSourceAst(code);
            const strat = buildIndirectTestingStrategy({
                astMetadata: astRes,
                sourceCode: code
            });

            const orphanStrat = strat.indirectStrategies.find(s => s.helperName === "orphanHelper");
            expect(orphanStrat).toBeDefined();
            expect(orphanStrat.exportedCallers).toEqual([]);
            expect(orphanStrat.callChains).toEqual([]);
            expect(strat.indirectGuidancePrompt).toContain("has NO discovered exported caller");
            expect(strat.indirectGuidancePrompt).not.toContain("publicApi -> orphanHelper");
        });

        test("unexported helper called by multiple exports discovers all distinct exported callers", () => {
            const code = `
                export function checkout(cart) { return validateItems(cart); }
                export function quote(cart) { return validateItems(cart); }
                function validateItems(c) { return Boolean(c && c.length); }
            `;
            const astRes = analyzeSourceAst(code);
            const strat = buildIndirectTestingStrategy({
                astMetadata: astRes,
                sourceCode: code
            });

            const helperStrat = strat.indirectStrategies.find(s => s.helperName === "validateItems");
            expect(helperStrat).toBeDefined();
            expect(helperStrat.exportedCallers).toContain("checkout");
            expect(helperStrat.exportedCallers).toContain("quote");
            expect(helperStrat.exportedCallers.length).toBe(2);
        });

        test("deep multi-hop call chain (export -> h1 -> h2 -> h3) correctly constructs full BFS chain", () => {
            const code = `
                export function process(req) { return step1(req); }
                function step1(r) { return step2(r); }
                function step2(r) { return step3(r); }
                function step3(r) { return r ? r.data : null; }
            `;
            const astRes = analyzeSourceAst(code);
            const strat = buildIndirectTestingStrategy({
                astMetadata: astRes,
                sourceCode: code
            });

            const step3Strat = strat.indirectStrategies.find(s => s.helperName === "step3");
            expect(step3Strat).toBeDefined();
            expect(step3Strat.exportedCallers).toContain("process");
            expect(step3Strat.callChains.some(c => c.includes("process -> step1 -> step2 -> step3"))).toBe(true);
        });

        test("circular helper recursion (h1 -> h2 -> h1) terminates BFS safely without loop freeze", () => {
            const code = `
                export function start(x) { return loopA(x); }
                function loopA(n) { if (n <= 0) return 0; return loopB(n - 1); }
                function loopB(n) { return loopA(n); }
            `;
            const astRes = analyzeSourceAst(code);
            const strat = buildIndirectTestingStrategy({
                astMetadata: astRes,
                sourceCode: code
            });

            const loopBStrat = strat.indirectStrategies.find(s => s.helperName === "loopB");
            expect(loopBStrat).toBeDefined();
            expect(loopBStrat.exportedCallers).toContain("start");
            expect(loopBStrat.callChains.length).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // SECTION 3: PROMPT INJECTION & CODE FENCE BREAKAGE
    // =========================================================================
    describe("3. Prompt Injection & Code Fence Breakage", () => {
        test("escapes triple backticks in source code to protect markdown prompt code blocks", () => {
            const maliciousCode = "const text = ````\nconsole.log('injected');\n````;";
            const escaped = escapePromptCode(maliciousCode, 5000);
            expect(escaped).not.toContain("```\n");
            expect(escaped).toContain("\\`\\`\\`");
        });

        test("sanitizes multiline conditionals and pipe delimiters in decision table cells", () => {
            const rawCode = `
                export function check(status, user, flag) {
                    if (status === 'PENDING' \r\n || (user.role === 'ADMIN' | flag === true)) {
                        return "allowed";
                    }
                    return "denied";
                }
            `;
            const astRes = analyzeSourceAst(rawCode);
            const matrixRes = buildDecisionTableMatrix({
                astMetadata: astRes,
                sourceCode: rawCode,
                filePath: "check.js"
            });
            // Every row in the markdown table should be on a single line (no embedded newlines breaking the table)
            const rows = matrixRes.decisionTableMarkdown.split("\n");
            for (const row of rows) {
                if (row.startsWith("|") && !row.includes(":---")) {
                    expect(row).not.toContain("\r");
                    expect(row.endsWith("|")).toBe(true);
                }
            }
        });

        test("AST brace balancing correctly closes unclosed block braces without adding extraneous parentheses", () => {
            const unclosedObjCode = `
                describe("suite", () => {
                    it("tests something", () => {
                        const payload = {
                            a: 1,
                            b: 2
            `;
            const healed = autoHealAstSyntax(unclosedObjCode, { framework: "jest" });
            expect(healed.success).toBe(true);
            expect(healed.code).toContain("describe(");
            // Verify healed code parses cleanly with Babel without syntax errors
            const check = parseJavaScriptCode(healed.code);
            expect(check.success).toBe(true);
        });
    });

    // =========================================================================
    // SECTION 4: PATH TRAVERSAL ATTACKS ON findSourceOnDisk
    // =========================================================================
    describe("4. Path Traversal & Disk Containment: findSourceOnDisk", () => {
        let tempDir;
        let sensitiveFile;

        beforeAll(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-security-test-"));
            const projectDir = path.join(tempDir, "workspace", "src");
            fs.mkdirSync(projectDir, { recursive: true });
            fs.writeFileSync(path.join(projectDir, "service.js"), "export const service = () => 'safe';", "utf8");

            sensitiveFile = path.join(tempDir, "secret.key");
            fs.writeFileSync(sensitiveFile, "SUPER_SECRET_KEY=12345", "utf8");
        });

        afterAll(() => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        });

        test("blocks relative path traversal attempts with ../../../", () => {
            const workspaceRoot = path.join(tempDir, "workspace");
            const result = findSourceOnDisk(workspaceRoot, "../../secret.key");
            expect(result.path).toBeNull();
            expect(result.content).toBe("");
        });

        test("blocks absolute path attacks pointing outside allowed workspace root", () => {
            const workspaceRoot = path.join(tempDir, "workspace");
            const result = findSourceOnDisk(workspaceRoot, sensitiveFile);
            expect(result.path).toBeNull();
            expect(result.content).toBe("");
        });

        test("blocks Windows UNC path traversal attempts", () => {
            const workspaceRoot = path.join(tempDir, "workspace");
            const result = findSourceOnDisk(workspaceRoot, "\\\\localhost\\c$\\Windows\\win.ini");
            expect(result.path).toBeNull();
            expect(result.content).toBe("");
        });

        test("allows legitimate file inside workspace root", () => {
            const workspaceRoot = path.join(tempDir, "workspace");
            const result = findSourceOnDisk(workspaceRoot, "src/service.js");
            expect(result.path).not.toBeNull();
            expect(result.content).toContain("export const service");
        });

        test("blocks traversal attacks with null bytes or encoded path delimiters", () => {
            const workspaceRoot = path.join(tempDir, "workspace");
            const nullByteRes = findSourceOnDisk(workspaceRoot, "src/service.js\0../secret.key");
            expect(nullByteRes.path).toBeNull();

            const encodedRes = findSourceOnDisk(workspaceRoot, "..%2f..%2fsecret.key");
            expect(encodedRes.path).toBeNull();
        });

        test("blocks root-level unix style traversal paths", () => {
            const workspaceRoot = path.join(tempDir, "workspace");
            const result = findSourceOnDisk(workspaceRoot, "/etc/passwd");
            expect(result.path).toBeNull();
            expect(result.content).toBe("");
        });
    });

    // =========================================================================
    // SECTION 5: BATCH SUGGESTION ENDPOINT CONTRACTS
    // =========================================================================
    describe("5. Batch Suggestion Endpoint Contracts & Resilience", () => {
        test("suggestUnitTestcaseAll rejects unauthenticated requests with 401", async () => {
            const req = {
                params: { snapshotId: "invalid-snap-123" },
                body: {},
                user: null
            };
            const res = {
                status: function (code) {
                    this.statusCode = code;
                    return this;
                },
                json: function (payload) {
                    this.body = payload;
                    return this;
                }
            };

            await suggestUnitTestcaseAll(req, res);
            expect(res.statusCode).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain("Unauthorized");
        });

        test("suggestUnitTestcaseAll safely handles non-existent snapshot without server crash", async () => {
            const req = {
                params: { snapshotId: "non-existent-snap-99999" },
                body: { projectId: "non-existent-proj" },
                user: { id: "test-user-id" }
            };
            let capturedStatus = 200;
            let capturedBody = null;
            const res = {
                status: function (code) {
                    capturedStatus = code;
                    return this;
                },
                json: function (payload) {
                    capturedBody = payload;
                    return this;
                }
            };

            await suggestUnitTestcaseAll(req, res);
            // It should return an HTTP error status (400, 404, 409, or 500), not throw an unhandled exception
            expect(capturedStatus).toBeGreaterThanOrEqual(400);
            expect(capturedBody).toBeDefined();
            expect(capturedBody.success).toBe(false);
        });

        test("computeRelativeImportPath calculates clean relative import without absolute leakage", () => {
            const testPath = "tests/unit/order.service.test.js";
            const srcPath = "src/services/order.service.js";
            const relImport = computeRelativeImportPath(testPath, srcPath);
            expect(relImport).toBe("../../src/services/order.service");
            expect(relImport).not.toContain("storage");
            expect(relImport).not.toContain("C:");
            expect(relImport).not.toContain("\\");
        });
    });
});
