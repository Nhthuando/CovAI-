import { describe, test, expect } from "@jest/globals";
import {
    detectInfeasibleAstNodes,
    isLocContained,
    isLocOverlapping,
    isPositionLte,
    isPositionGte,
    evaluateStaticTruthiness,
    inspectEnvironmentGuard,
    checkUnconditionalJump
} from "../services/unreachableCodeDetector.service.js";
import {
    analyzeSourceAst,
    mapCoverageGaps
} from "../services/businessLogicAstAnalyzer.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";

describe("AST & Istanbul Gap Reconciliation Service - Milestone 1 Verification", () => {
    describe("1. Static Unreachable & Infeasible Code Detection (unreachableCodeDetector)", () => {
        // -------------------------------------------------------------------------
        // Category 1: Environment-Dependent Guards
        // -------------------------------------------------------------------------
        describe("Category 1: Environment-Dependent Guards", () => {
            test("detects process.env.NODE_ENV === 'production' and marks TRUE_BRANCH unreachable in test suite", () => {
                const code = `
function configureLogging() {
    if (process.env.NODE_ENV === 'production') {
        enableDatadogLogger();
    }
    return true;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const envGuard = blocks.find(b => b.type === "ENVIRONMENT_GUARD");
                expect(envGuard).toBeDefined();
                expect(envGuard.category).toBe("ENVIRONMENT");
                expect(envGuard.affectsBranch).toBe("TRUE_BRANCH");
                expect(envGuard.unreachableBranch).toBe("consequent");
                expect(envGuard.justification).toContain("NODE_ENV === 'production'");
                expect(envGuard.justification).toContain("hermetically in NODE_ENV='test'");
            });

            test("detects process.env.NODE_ENV !== 'test' as true branch unreachable", () => {
                const code = `
function initializeWorker() {
    if (process.env.NODE_ENV !== 'test') {
        startBackgroundCron();
    }
    return 1;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const envGuard = blocks.find(b => b.type === "ENVIRONMENT_GUARD");
                expect(envGuard).toBeDefined();
                expect(envGuard.affectsBranch).toBe("TRUE_BRANCH");
                expect(envGuard.justification).toContain("NODE_ENV !== 'test'");
            });

            test("detects process.env.NODE_ENV === 'test' and marks FALSE_BRANCH (alternate) unreachable", () => {
                const code = `
function getCacheStore() {
    if (process.env.NODE_ENV === 'test') {
        return new MemoryCache();
    } else {
        return new RedisCache();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const envGuard = blocks.find(b => b.type === "ENVIRONMENT_GUARD");
                expect(envGuard).toBeDefined();
                expect(envGuard.affectsBranch).toBe("FALSE_BRANCH");
                expect(envGuard.unreachableBranch).toBe("alternate");
                expect(envGuard.justification).toContain("always true in hermetic unit test environments");
            });

            test("detects CI environment check (process.env.CI === 'true')", () => {
                const code = `
function setupArtifacts() {
    if (process.env.CI === 'true') {
        uploadToS3();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const ciGuard = blocks.find(b => b.justification.includes("CI"));
                expect(ciGuard).toBeDefined();
                expect(ciGuard.category).toBe("ENVIRONMENT");
                expect(ciGuard.affectsBranch).toBe("TRUE_BRANCH");
            });

            test("detects platform-specific check (process.platform === 'win32')", () => {
                const code = `
function getBinaryPath() {
    if (process.platform === 'win32') {
        return 'bin\\\\tool.exe';
    }
    return 'bin/tool';
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const platGuard = blocks.find(b => b.type === "ENVIRONMENT_GUARD");
                expect(platGuard).toBeDefined();
                expect(platGuard.justification).toContain("platform-specific");
                expect(platGuard.affectsBranch).toBe("TRUE_BRANCH");
            });

            test("detects architecture check (process.arch === 'x64')", () => {
                const code = `
function getArchModule() {
    if (process.arch === 'x64') {
        return load64BitLibrary();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const archGuard = blocks.find(b => b.type === "ENVIRONMENT_GUARD");
                expect(archGuard).toBeDefined();
                expect(archGuard.justification).toContain("architecture-specific");
            });

            test("detects compound logical expression with environment guard (process.env.NODE_ENV === 'production' && isEnabled)", () => {
                const code = `
function triggerMonitoring(isEnabled) {
    if (process.env.NODE_ENV === 'production' && isEnabled) {
        startTelemetry();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                expect(blocks.some(b => b.type === "ENVIRONMENT_GUARD")).toBe(true);
            });
        });

        // -------------------------------------------------------------------------
        // Category 2: Dead Code Following Terminating / Jump Statements
        // -------------------------------------------------------------------------
        describe("Category 2: Dead Code Following Terminating / Jump Statements", () => {
            test("detects statements following unconditional return statement", () => {
                const code = `
function calculateDiscount(rate) {
    if (rate <= 0) {
        return 0;
        console.log("Unreachable 1");
    }
    return rate * 0.9;
    console.log("Unreachable 2");
    const deadVar = 42;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadCodeBlocks = blocks.filter(b => b.type === "DEAD_CODE_POST_JUMP");
                expect(deadCodeBlocks.length).toBeGreaterThanOrEqual(2);
                expect(deadCodeBlocks[0].category).toBe("DEAD_CODE");
                expect(deadCodeBlocks[0].affectsBranch).toBe("BOTH");
                expect(deadCodeBlocks[0].justification).toContain("ReturnStatement");
            });

            test("detects statements following unconditional throw statement", () => {
                const code = `
function validateOrder(order) {
    if (!order) {
        throw new Error("Order required");
        cleanupPending();
    }
    return true;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadCode = blocks.find(b => b.type === "DEAD_CODE_POST_JUMP");
                expect(deadCode).toBeDefined();
                expect(deadCode.justification).toContain("ThrowStatement");
            });

            test("detects statements following process.exit()", () => {
                const code = `
function handleFatalError() {
    process.exit(1);
    console.log("After exit");
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadCode = blocks.find(b => b.type === "DEAD_CODE_POST_JUMP");
                expect(deadCode).toBeDefined();
                expect(deadCode.justification).toContain("ProcessExit");
            });

            test("detects dead code following dual-terminating if-else block", () => {
                const code = `
function processStatus(isAdmin) {
    if (isAdmin) {
        return "admin";
    } else {
        throw new Error("Unauthorized");
    }
    console.log("Unreachable post-dual-return");
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadCode = blocks.find(b => b.type === "DEAD_CODE_POST_JUMP");
                expect(deadCode).toBeDefined();
                expect(deadCode.justification).toContain("DualTerminatingIfElse");
            });
        });

        // -------------------------------------------------------------------------
        // Category 3: Constant Boolean Conditions & Static Truthiness
        // -------------------------------------------------------------------------
        describe("Category 3: Constant Boolean Conditions & Static Truthiness", () => {
            test("detects if (false) and marks consequent branch unreachable", () => {
                const code = `
function debugRoutine() {
    if (false) {
        executeDeadDiagnostics();
    }
    return true;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const constCond = blocks.find(b => b.type === "CONSTANT_CONDITION");
                expect(constCond).toBeDefined();
                expect(constCond.category).toBe("LOGIC");
                expect(constCond.affectsBranch).toBe("TRUE_BRANCH");
                expect(constCond.unreachableBranch).toBe("consequent");
                expect(constCond.justification).toContain("compile-time constant false");
            });

            test("detects if (true) and marks alternate/fallthrough branch unreachable", () => {
                const code = `
function enforceSecurity() {
    if (true) {
        applyStrictMode();
    } else {
        applyPermissiveMode();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const constCond = blocks.find(b => b.type === "CONSTANT_CONDITION");
                expect(constCond).toBeDefined();
                expect(constCond.affectsBranch).toBe("FALSE_BRANCH");
                expect(constCond.unreachableBranch).toBe("alternate");
                expect(constCond.justification).toContain("compile-time constant true");
            });

            test("detects while (false) loop as dead body", () => {
                const code = `
function loopForever() {
    while (false) {
        doImpossibleWork();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const constCond = blocks.find(b => b.type === "CONSTANT_CONDITION");
                expect(constCond).toBeDefined();
                expect(constCond.affectsBranch).toBe("TRUE_BRANCH");
                expect(constCond.justification).toContain("While loop condition is compile-time constant false");
            });

            test("detects compile-time static ternary conditionals", () => {
                const code = `
const a = false ? "unreachableTrue" : "reachableFalse";
const b = true ? "reachableTrue" : "unreachableFalse";
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const ternaryBlocks = blocks.filter(b => b.type === "CONSTANT_CONDITION");
                expect(ternaryBlocks.length).toBe(2);

                const falseTernary = ternaryBlocks.find(b => b.affectsBranch === "TRUE_BRANCH");
                const trueTernary = ternaryBlocks.find(b => b.affectsBranch === "FALSE_BRANCH");
                expect(falseTernary).toBeDefined();
                expect(trueTernary).toBeDefined();
            });

            test("evaluates static truthiness of primitives (0, '', null, undefined, !true)", () => {
                expect(evaluateStaticTruthiness({ type: "NumericLiteral", value: 0 }).value).toBe(false);
                expect(evaluateStaticTruthiness({ type: "NumericLiteral", value: 1 }).value).toBe(true);
                expect(evaluateStaticTruthiness({ type: "StringLiteral", value: "" }).value).toBe(false);
                expect(evaluateStaticTruthiness({ type: "StringLiteral", value: "hello" }).value).toBe(true);
                expect(evaluateStaticTruthiness({ type: "NullLiteral" }).value).toBe(false);
                expect(evaluateStaticTruthiness({ type: "Identifier", name: "undefined" }).value).toBe(false);
            });
        });

        // -------------------------------------------------------------------------
        // Category 4: Defensive Non-Null Checks on Infallible Local Objects
        // -------------------------------------------------------------------------
        describe("Category 4: Defensive Non-Null Checks on Infallible Local Objects", () => {
            test("detects if (!x) when x was just allocated as an object literal {}", () => {
                const code = `
function buildConfig() {
    const config = {};
    if (!config) {
        return fallbackConfig();
    }
    return config;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const defCheck = blocks.find(b => b.type === "DEFENSIVE_NULL_CHECK");
                expect(defCheck).toBeDefined();
                expect(defCheck.category).toBe("DEFENSIVE");
                expect(defCheck.affectsBranch).toBe("TRUE_BRANCH");
                expect(defCheck.justification).toContain("locally instantiated object ('config')");
                expect(defCheck.justification).toContain("mathematically unreachable");
            });

            test("detects if (arr == null) when arr was just allocated as an array literal []", () => {
                const code = `
function processItems() {
    const items = [];
    if (items == null) {
        return 0;
    }
    return items.length;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const defCheck = blocks.find(b => b.type === "DEFENSIVE_NULL_CHECK");
                expect(defCheck).toBeDefined();
                expect(defCheck.justification).toContain("locally instantiated array ('items')");
            });

            test("detects if (cache === null) when cache was allocated with new Map()", () => {
                const code = `
function setupCache() {
    const cache = new Map();
    if (cache === null) {
        throw new Error("Impossible");
    }
    return cache;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const defCheck = blocks.find(b => b.type === "DEFENSIVE_NULL_CHECK");
                expect(defCheck).toBeDefined();
                expect(defCheck.justification).toContain("Map");
            });

            test("does NOT flag if variable was reassigned before the null check", () => {
                const code = `
function fetchMaybeNull(provider) {
    let result = {};
    result = provider.getData(); // Reassigned!
    if (!result) {
        return null;
    }
    return result;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const defCheck = blocks.find(b => b.type === "DEFENSIVE_NULL_CHECK");
                expect(defCheck).toBeUndefined();
            });
        });

        // -------------------------------------------------------------------------
        // Category 5: Infallible Try/Catch Exception Blocks
        // -------------------------------------------------------------------------
        describe("Category 5: Infallible Try/Catch Exception Blocks", () => {
            test("detects try/catch wrapping only infallible Math and Array operations", () => {
                const code = `
function computeBounds(a, b) {
    try {
        const minVal = Math.min(a || 0, 100);
        const maxVal = Math.max(minVal, 0);
        const isArr = Array.isArray([]);
        return maxVal;
    } catch (err) {
        return 0;
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const infCatch = blocks.find(b => b.type === "INFALLIBLE_TRY_CATCH");
                expect(infCatch).toBeDefined();
                expect(infCatch.category).toBe("DEFENSIVE");
                expect(infCatch.affectsBranch).toBe("TRUE_BRANCH");
                expect(infCatch.justification).toContain("infallible built-in operations");
            });

            test("does NOT flag try/catch when try body contains potentially fallible operations", () => {
                const code = `
function parseInput(jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        return data;
    } catch (err) {
        return null;
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const infCatch = blocks.find(b => b.type === "INFALLIBLE_TRY_CATCH");
                expect(infCatch).toBeUndefined();
            });
        });

        // -------------------------------------------------------------------------
        // Category 6: Contradictory / Subsumed Branch Conditions
        // -------------------------------------------------------------------------
        describe("Category 6: Contradictory / Subsumed Branch Conditions", () => {
            test("detects identical duplicate condition in else if chain", () => {
                const code = `
function checkValue(x) {
    if (x > 10) {
        return "first";
    } else if (x > 10) {
        return "second";
    }
    return "other";
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const duplicateBranch = blocks.find(b => b.type === "CONTRADICTORY_BRANCH");
                expect(duplicateBranch).toBeDefined();
                expect(duplicateBranch.category).toBe("LOGIC");
                expect(duplicateBranch.justification).toContain("identical to preceding guard");
            });
        });

        // -------------------------------------------------------------------------
        // Coordinate Containment & Position Helpers
        // -------------------------------------------------------------------------
        describe("Coordinate Containment & Position Mathematics", () => {
            test("isLocContained accurately validates sub-expression containment", () => {
                const outer = {
                    start: { line: 5, column: 2 },
                    end: { line: 10, column: 20 }
                };
                const inner = {
                    start: { line: 6, column: 4 },
                    end: { line: 8, column: 10 }
                };
                const outside = {
                    start: { line: 11, column: 0 },
                    end: { line: 12, column: 5 }
                };

                expect(isLocContained(outer, inner)).toBe(true);
                expect(isLocContained(outer, outside)).toBe(false);
                expect(isLocContained(inner, outer)).toBe(false);
            });

            test("isLocOverlapping correctly identifies multiline overlap vs disjoint bounds", () => {
                const spanA = { start: { line: 4, column: 0 }, end: { line: 8, column: 10 } };
                const spanB = { start: { line: 6, column: 2 }, end: { line: 12, column: 0 } };
                const spanC = { start: { line: 15, column: 0 }, end: { line: 20, column: 0 } };

                expect(isLocOverlapping(spanA, spanB)).toBe(true);
                expect(isLocOverlapping(spanA, spanC)).toBe(false);
            });

            test("isPositionLte and isPositionGte handle identical lines with column ordering", () => {
                const p1 = { line: 5, column: 10 };
                const p2 = { line: 5, column: 20 };
                const p3 = { line: 6, column: 0 };

                expect(isPositionLte(p1, p2)).toBe(true);
                expect(isPositionLte(p2, p1)).toBe(false);
                expect(isPositionLte(p1, p3)).toBe(true);
                expect(isPositionGte(p3, p1)).toBe(true);
            });
        });
    });

    // -----------------------------------------------------------------------------
    // 2. Integration with businessLogicAstAnalyzer.service (mapCoverageGaps)
    // -----------------------------------------------------------------------------
    describe("2. AST Coverage Gap Reconciliation with Exact Containment (mapCoverageGaps)", () => {
        test("reconciles multiline conditionals via exact coordinate containment without line-number drift", () => {
            const sourceCode = `
export function processTransaction(tx) {
    if (
        tx &&
        tx.amount > 0 &&
        tx.currency === "USD"
    ) {
        return tx.amount * 1.05;
    }
    return 0;
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            expect(astMeta.decisionPoints.length).toBeGreaterThanOrEqual(1);
            expect(astMeta.decisionPoints[0].loc).toBeDefined();

            // Istanbul representation where branch spans lines 3-7
            const fileCoverageData = {
                statementMap: {
                    "0": { start: { line: 3, column: 4 }, end: { line: 9, column: 5 } },
                    "1": { start: { line: 8, column: 8 }, end: { line: 8, column: 33 } },
                    "2": { start: { line: 10, column: 4 }, end: { line: 10, column: 13 } }
                },
                s: { "0": 1, "1": 0, "2": 1 },
                branchMap: {
                    "0": {
                        loc: { start: { line: 3, column: 4 }, end: { line: 9, column: 5 } },
                        type: "if",
                        locations: [
                            { start: { line: 8, column: 8 }, end: { line: 8, column: 33 } },
                            { start: { line: 10, column: 4 }, end: { line: 10, column: 13 } }
                        ],
                        line: 3
                    }
                },
                b: {
                    "0": [0, 1] // True path missed, False path taken
                },
                fnMap: {
                    "0": { name: "processTransaction", line: 2, loc: { start: { line: 2, column: 0 }, end: { line: 11, column: 1 } } }
                },
                f: { "0": 1 }
            };

            const report = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData,
                sourceCode
            });

            expect(report.uncoveredBranches).toHaveLength(1);
            expect(report.uncoveredBranches[0].missedTrue).toBe(true);
            expect(report.uncoveredBranches[0].missedFalse).toBe(false);
            expect(report.uncoveredStatements.some(s => s.line === 8)).toBe(true);

            // Verified targeted guidance correctly maps the decision point via exact coordinate containment
            expect(report.targetedGuidance.length).toBeGreaterThanOrEqual(1);
            expect(report.targetedGuidance[0].guidance).toContain("Missing TRUE path");
        });

        test("tags uncovered environment guard branch with isInfeasible: true and actionable justification", () => {
            const sourceCode = `
export function initTelemetry() {
    if (process.env.NODE_ENV === 'production') {
        startTelemetryDaemon();
    }
    return true;
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            expect(astMeta.infeasibleNodes).toHaveLength(1);

            const fileCoverageData = {
                statementMap: {
                    "0": { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                    "1": { start: { line: 4, column: 8 }, end: { line: 4, column: 31 } },
                    "2": { start: { line: 6, column: 4 }, end: { line: 6, column: 16 } }
                },
                s: { "0": 1, "1": 0, "2": 1 },
                branchMap: {
                    "0": {
                        loc: { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                        type: "if",
                        locations: [
                            { start: { line: 4, column: 8 }, end: { line: 4, column: 31 } },
                            { start: { line: 6, column: 4 }, end: { line: 6, column: 16 } }
                        ],
                        line: 3
                    }
                },
                b: {
                    "0": [0, 1] // True branch missed (0 hits) because NODE_ENV === 'test'
                },
                fnMap: {
                    "0": { name: "initTelemetry", line: 2, loc: { start: { line: 2, column: 0 }, end: { line: 7, column: 1 } } }
                },
                f: { "0": 1 }
            };

            const report = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData,
                sourceCode
            });

            // 1. Authentic Istanbul metrics are NOT corrupted
            expect(report.uncoveredBranches).toHaveLength(1);
            expect(report.uncoveredBranches[0].missedTrue).toBe(true);

            // 2. Branch is tagged with isInfeasible: true and actionable metadata
            expect(report.uncoveredBranches[0].isInfeasible).toBe(true);
            expect(report.uncoveredBranches[0].infeasibleMeta).toBeDefined();
            expect(report.uncoveredBranches[0].infeasibleMeta.type).toBe("ENVIRONMENT_GUARD");
            expect(report.uncoveredBranches[0].infeasibleMeta.category).toBe("ENVIRONMENT");
            expect(report.uncoveredBranches[0].infeasibleMeta.justification).toContain("hermetically in NODE_ENV='test'");

            // 3. Statement inside the guard is tagged infeasible
            const stmt4 = report.uncoveredStatements.find(s => s.line === 4);
            expect(stmt4).toBeDefined();
            expect(stmt4.isInfeasible).toBe(true);

            // 4. Targeted guidance marks branch as INFEASIBLE_GUARD to prevent fake assertions
            const guide = report.targetedGuidance.find(g => g.line === 3);
            expect(guide).toBeDefined();
            expect(guide.status).toBe("INFEASIBLE_GUARD");
            expect(guide.guidance).toContain("Suppressed from unit test generation");
        });

        test("tags dead code post-return with isInfeasible: true in uncovered statements", () => {
            const sourceCode = `
export function computeValue(n) {
    return n * 2;
    console.log("Unreachable post-return");
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            const fileCoverageData = {
                statementMap: {
                    "0": { start: { line: 3, column: 4 }, end: { line: 3, column: 17 } },
                    "1": { start: { line: 4, column: 4 }, end: { line: 4, column: 43 } }
                },
                s: { "0": 1, "1": 0 },
                branchMap: {},
                b: {},
                fnMap: {
                    "0": { name: "computeValue", line: 2, loc: { start: { line: 2, column: 0 }, end: { line: 5, column: 1 } } }
                },
                f: { "0": 1 }
            };

            const report = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData,
                sourceCode
            });

            const deadStmt = report.uncoveredStatements.find(s => s.line === 4);
            expect(deadStmt).toBeDefined();
            expect(deadStmt.isInfeasible).toBe(true);
            expect(deadStmt.infeasibleMeta.type).toBe("DEAD_CODE_POST_JUMP");
            expect(deadStmt.infeasibleMeta.category).toBe("DEAD_CODE");
        });

        test("preserves authentic Istanbul metrics for feasible branches (no false positive infeasible tagging)", () => {
            const sourceCode = `
export function applyCoupon(code, total) {
    if (code === "SAVE10") {
        return total * 0.9;
    }
    return total;
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            const fileCoverageData = {
                statementMap: {
                    "0": { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                    "1": { start: { line: 4, column: 8 }, end: { line: 4, column: 27 } },
                    "2": { start: { line: 6, column: 4 }, end: { line: 6, column: 17 } }
                },
                s: { "0": 1, "1": 0, "2": 1 },
                branchMap: {
                    "0": {
                        loc: { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                        type: "if",
                        locations: [
                            { start: { line: 4, column: 8 }, end: { line: 4, column: 27 } },
                            { start: { line: 6, column: 4 }, end: { line: 6, column: 17 } }
                        ],
                        line: 3
                    }
                },
                b: {
                    "0": [0, 1] // True branch not yet tested, but fully feasible
                },
                fnMap: {
                    "0": { name: "applyCoupon", line: 2, loc: { start: { line: 2, column: 0 }, end: { line: 7, column: 1 } } }
                },
                f: { "0": 1 }
            };

            const report = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData,
                sourceCode
            });

            expect(report.uncoveredBranches).toHaveLength(1);
            expect(report.uncoveredBranches[0].missedTrue).toBe(true);
            // Feasible code must NOT be flagged as infeasible
            expect(report.uncoveredBranches[0].isInfeasible).toBe(false);
            expect(report.uncoveredBranches[0].infeasibleMeta).toBeNull();

            // Guidance instructs developer/LLM to write a test input
            const guide = report.targetedGuidance.find(g => g.line === 3);
            expect(guide.status).toBe("UNCOVERED");
            expect(guide.guidance).toContain("Craft test inputs to toggle this branch!");
        });

        test("reconciles nested ternary expressions with exact sub-expression coordinate containment", () => {
            const sourceCode = `
export const categorize = (age) => age < 13 ? "child" : (age < 20 ? "teen" : "adult");
`;
            const astMeta = analyzeSourceAst(sourceCode);
            expect(astMeta.decisionPoints.filter(d => d.type === "ternary").length).toBe(2);

            const fileCoverageData = {
                statementMap: {
                    "0": { start: { line: 2, column: 35 }, end: { line: 2, column: 86 } }
                },
                s: { "0": 1 },
                branchMap: {
                    "0": {
                        loc: { start: { line: 2, column: 35 }, end: { line: 2, column: 86 } },
                        type: "cond-expr",
                        locations: [
                            { start: { line: 2, column: 46 }, end: { line: 2, column: 53 } },
                            { start: { line: 2, column: 56 }, end: { line: 2, column: 86 } }
                        ],
                        line: 2
                    },
                    "1": {
                        loc: { start: { line: 2, column: 57 }, end: { line: 2, column: 85 } },
                        type: "cond-expr",
                        locations: [
                            { start: { line: 2, column: 69 }, end: { line: 2, column: 75 } },
                            { start: { line: 2, column: 78 }, end: { line: 2, column: 85 } }
                        ],
                        line: 2
                    }
                },
                b: {
                    "0": [1, 1], // Outer ternary fully covered
                    "1": [1, 0]  // Inner ternary: 'adult' path (False) missed
                },
                fnMap: {
                    "0": { name: "categorize", line: 2, loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 87 } } }
                },
                f: { "0": 1 }
            };

            const report = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData,
                sourceCode
            });

            expect(report.uncoveredBranches).toHaveLength(1);
            expect(report.uncoveredBranches[0].branchId).toBe("1");
            expect(report.uncoveredBranches[0].missedFalse).toBe(true);
            expect(report.uncoveredBranches[0].missedTrue).toBe(false);
        });
    });
});
