import { describe, test, expect } from "@jest/globals";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
    detectInfeasibleAstNodes,
    isLocContained,
    isLocOverlapping,
    isPositionLte,
    isPositionGte,
    isPositionLt,
    evaluateStaticTruthiness,
    inspectEnvironmentGuard,
    checkUnconditionalJump
} from "../services/unreachableCodeDetector.service.js";

import {
    analyzeSourceAst,
    mapCoverageGaps
} from "../services/businessLogicAstAnalyzer.service.js";

import {
    classifyFeasibleCoverage
} from "../services/feasibleCoverageClassifier.service.js";

import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { buildStandardUnitTestPrompt } from "../services/unitTestGenerator.service.js";

describe("Milestone 4 - Adversarial Stress Suite: AST Containment & Unreachable Detection", () => {

    // =========================================================================
    // SECTION 1: EXTREME BOUNDARY CONDITIONS & AST COORDINATE CONTAINMENT
    // =========================================================================
    describe("1. Extreme Boundary Conditions & AST Coordinate Containment", () => {

        test("single-line multi-conditional statements: isolates environment guard from adjacent feasible if", () => {
            // Adversarial input: two separate 'if' statements on the exact same line
            const code = "function testSingleLine(a, b) { if (process.env.NODE_ENV === 'production') logBeacon(); if (a > 0) return a; return b; }";

            const astAnalysis = analyzeSourceAst(code);
            expect(astAnalysis.infeasibleNodes).toHaveLength(1);
            expect(astAnalysis.infeasibleNodes[0].type).toBe("ENVIRONMENT_GUARD");

            // Mock Istanbul branchMap with exact character columns on line 1
            const branchMap = {
                "0": {
                    line: 1,
                    type: "if",
                    loc: { start: { line: 1, column: 33 }, end: { line: 1, column: 88 } },
                    locations: [
                        { start: { line: 1, column: 76 }, end: { line: 1, column: 88 } }, // logBeacon()
                        { start: { line: 1, column: 33 }, end: { line: 1, column: 88 } }  // fallthrough
                    ]
                },
                "1": {
                    line: 1,
                    type: "if",
                    loc: { start: { line: 1, column: 90 }, end: { line: 1, column: 111 } },
                    locations: [
                        { start: { line: 1, column: 102 }, end: { line: 1, column: 111 } }, // return a;
                        { start: { line: 1, column: 90 }, end: { line: 1, column: 111 } }   // fallthrough
                    ]
                }
            };

            const fileCoverageData = {
                statementMap: {},
                s: {},
                branchMap,
                b: {
                    "0": [0, 1], // Branch 0: true branch (production beacon) missed, false branch hit
                    "1": [0, 1]  // Branch 1: true branch (return a) missed, false branch hit
                },
                fnMap: {},
                f: {}
            };

            const gapResult = mapCoverageGaps({
                astMetadata: astAnalysis,
                fileCoverageData,
                sourceCode: code
            });

            expect(gapResult.uncoveredBranches).toHaveLength(2);

            const branch0 = gapResult.uncoveredBranches.find(b => b.branchId === "0");
            const branch1 = gapResult.uncoveredBranches.find(b => b.branchId === "1");

            // Branch 0 (environment guard) MUST be tagged as infeasible
            expect(branch0.isInfeasible).toBe(true);
            expect(branch0.infeasibleMeta?.type).toBe("ENVIRONMENT_GUARD");

            // Branch 1 (feasible 'if (a > 0)') on the SAME LINE must NOT be contaminated!
            expect(branch1.isInfeasible).toBe(false);
            expect(branch1.infeasibleMeta).toBeNull();
        });

        test("single-line chained ternary: isolates outer environment guard from inner business logic", () => {
            const code = "const getRole = (isAdmin) => (process.env.NODE_ENV === 'production') ? 'live' : (isAdmin ? 'admin' : 'guest');";

            const astAnalysis = analyzeSourceAst(code);
            expect(astAnalysis.infeasibleNodes).toHaveLength(1);
            expect(astAnalysis.infeasibleNodes[0].type).toBe("ENVIRONMENT_GUARD");

            const branchMap = {
                "0": {
                    line: 1,
                    type: "cond-expr",
                    loc: { start: { line: 1, column: 29 }, end: { line: 1, column: 110 } },
                    locations: [
                        { start: { line: 1, column: 72 }, end: { line: 1, column: 78 } }, // 'live'
                        { start: { line: 1, column: 81 }, end: { line: 1, column: 110 } } // (isAdmin ? 'admin' : 'guest')
                    ]
                },
                "1": {
                    line: 1,
                    type: "cond-expr",
                    loc: { start: { line: 1, column: 82 }, end: { line: 1, column: 109 } },
                    locations: [
                        { start: { line: 1, column: 92 }, end: { line: 1, column: 99 } },  // 'admin'
                        { start: { line: 1, column: 102 }, end: { line: 1, column: 109 } } // 'guest'
                    ]
                }
            };

            const fileCoverageData = {
                statementMap: {},
                s: {},
                branchMap,
                b: {
                    "0": [0, 1], // missed 'live', hit inner ternary
                    "1": [0, 1]  // missed 'admin', hit 'guest'
                },
                fnMap: {},
                f: {}
            };

            const gapResult = mapCoverageGaps({
                astMetadata: astAnalysis,
                fileCoverageData,
                sourceCode: code
            });

            const outerBranch = gapResult.uncoveredBranches.find(b => b.branchId === "0");
            const innerBranch = gapResult.uncoveredBranches.find(b => b.branchId === "1");

            expect(outerBranch.isInfeasible).toBe(true);
            expect(outerBranch.infeasibleMeta.type).toBe("ENVIRONMENT_GUARD");

            // Inner ternary must NOT be marked infeasible
            expect(innerBranch.isInfeasible).toBe(false);
        });

        test("deeply nested 5-level ternaries: accurately encloses only the innermost infeasible leaf", () => {
            const code = `
function nestedTernary(a, b, c, d) {
    return a ? 1 : (
        b ? 2 : (
            c ? 3 : (
                process.env.NODE_ENV === 'production' ? 4 : (
                    d ? 5 : 6
                )
            )
        )
    );
}
`;
            const astAnalysis = analyzeSourceAst(code);
            const envBlocks = astAnalysis.infeasibleNodes.filter(n => n.type === "ENVIRONMENT_GUARD");
            expect(envBlocks).toHaveLength(1);
            expect(envBlocks[0].line).toBe(6);

            // Bounding box of the production branch (consequent '4' on line 6)
            const prodConsequentLoc = envBlocks[0].loc;
            expect(prodConsequentLoc.start.line).toBe(6);

            // Verify outer ternary loc does not collide
            const branchMap = {
                "0": {
                    line: 3,
                    type: "cond-expr",
                    loc: { start: { line: 3, column: 11 }, end: { line: 12, column: 5 } },
                    locations: [
                        { start: { line: 3, column: 15 }, end: { line: 3, column: 16 } },
                        { start: { line: 3, column: 19 }, end: { line: 12, column: 5 } }
                    ]
                },
                "1": {
                    line: 6,
                    type: "cond-expr",
                    loc: { start: { line: 6, column: 16 }, end: { line: 8, column: 17 } },
                    locations: [
                        { start: { line: 6, column: 56 }, end: { line: 6, column: 57 } }, // '4'
                        { start: { line: 6, column: 60 }, end: { line: 8, column: 17 } }
                    ]
                }
            };

            const fileCoverageData = {
                statementMap: {},
                s: {},
                branchMap,
                b: {
                    "0": [0, 1], // outer ternary missed true
                    "1": [0, 1]  // level-4 ternary missed true ('4')
                },
                fnMap: {},
                f: {}
            };

            const gapResult = mapCoverageGaps({
                astMetadata: astAnalysis,
                fileCoverageData,
                sourceCode: code
            });

            const outer = gapResult.uncoveredBranches.find(b => b.branchId === "0");
            const level4 = gapResult.uncoveredBranches.find(b => b.branchId === "1");

            expect(outer.isInfeasible).toBe(false);
            expect(level4.isInfeasible).toBe(true);
            expect(level4.infeasibleMeta?.type).toBe("ENVIRONMENT_GUARD");
        });

        test("multiline compound boolean expressions: conjunctions are unreachable, disjunctions remain reachable", () => {
            // Case A: Conjunction (A && B) && (C && D) - Consequent is unreachable in test environment
            const conjunctionCode = `
function complexAuditConjunction(user, options) {
    if (
        (process.env.NODE_ENV === 'production' &&
         options.strictTelemetry) &&
        (user.isSuperAdmin &&
         user.hasKey)
    ) {
        logSensitiveAudit();
    }
    return true;
}
`;
            const conjAst = analyzeSourceAst(conjunctionCode);
            expect(conjAst.infeasibleNodes.length).toBeGreaterThan(0);
            expect(conjAst.infeasibleNodes.some(n => n.type === "ENVIRONMENT_GUARD")).toBe(true);

            // Decision points should capture exact multiline spans
            const ifDecision = conjAst.decisionPoints.find(d => d.type === "if");
            expect(ifDecision).toBeDefined();
            expect(ifDecision.line).toBe(3);
            expect(ifDecision.loc.start.line).toBe(3);
            expect(ifDecision.loc.end.line).toBe(10);

            // Case B: Disjunction (A && B) || (C && D) - Consequent is FEASIBLE via (C && D)!
            // Detector must NOT produce a false positive unreachable block!
            const disjunctionCode = `
function complexAuditDisjunction(user, options) {
    if (
        (process.env.NODE_ENV === 'production' &&
         options.strictTelemetry) ||
        (user.isSuperAdmin &&
         user.hasKey)
    ) {
        logSensitiveAudit();
    }
    return true;
}
`;
            const disjAst = analyzeSourceAst(disjunctionCode);
            // Must have 0 infeasible nodes because (C && D) makes the branch reachable!
            expect(disjAst.infeasibleNodes).toHaveLength(0);
        });

        test("adversarial check: right-hand side environment guard in && expression (flags && process.env.NODE_ENV === 'production')", () => {
            // When environment guard is on the left:
            const leftCode = "function checkL(flag) { if (process.env.NODE_ENV === 'production' && flag) doProd(); }";
            const leftAst = analyzeSourceAst(leftCode);
            expect(leftAst.infeasibleNodes.some(n => n.type === "ENVIRONMENT_GUARD")).toBe(true);

            // When environment guard is on the right:
            const rightCode = "function checkR(flag) { if (flag && process.env.NODE_ENV === 'production') doProd(); }";
            const rightAst = analyzeSourceAst(rightCode);
            // Empirical observation: inspectEnvironmentGuard checks conditionNode.left in && expressions.
            // Right-hand side is unhandled, safely defaulting to an actionable branch (no false positives).
            const isRightDetected = rightAst.infeasibleNodes.some(n => n.type === "ENVIRONMENT_GUARD");
            expect(isRightDetected).toBe(false);
        });

        test("syntax resilience: handles syntax errors, null inputs, and malformed code gracefully", () => {
            const malformedCode = "function broken( { if ( {";
            expect(() => detectInfeasibleAstNodes(null, malformedCode)).not.toThrow();
            expect(detectInfeasibleAstNodes(null, malformedCode)).toEqual([]);

            expect(() => analyzeSourceAst(malformedCode)).not.toThrow();
            const astRes = analyzeSourceAst(malformedCode);
            expect(astRes.infeasibleNodes).toEqual([]);

            expect(() => mapCoverageGaps({
                astMetadata: null,
                fileCoverageData: null,
                sourceCode: malformedCode
            })).not.toThrow();

            const gapRes = mapCoverageGaps({
                astMetadata: null,
                fileCoverageData: null,
                sourceCode: malformedCode
            });
            expect(gapRes.uncoveredBranches).toEqual([]);
        });

        test("dual-terminating throw: detects dead code after if-else where both branches throw", () => {
            const code = `
function dualThrow(code) {
    if (code === 404) {
        throw new Error("Not Found");
    } else {
        throw new Error("Internal Server Error");
    }
    console.log("Dead code following dual throw");
    return false;
}
`;
            const blocks = detectInfeasibleAstNodes(null, code);
            const deadBlocks = blocks.filter(b => b.type === "DEAD_CODE_POST_JUMP");
            expect(deadBlocks.length).toBeGreaterThanOrEqual(2); // console.log and return false
            expect(deadBlocks[0].reason).toContain("DualTerminatingIfElse");
        });

        test("adjacent lines: verifies zero line-distance drift collision across adjacent blocks", () => {
            const code = `
function processBatch(records) {
    if (process.env.NODE_ENV === 'production') {
        sendProductionStats();
    }
    if (records.length === 0) {
        return [];
    }
    return records.map(r => r.id);
}
`;
            const astAnalysis = analyzeSourceAst(code);
            expect(astAnalysis.infeasibleNodes).toHaveLength(1);
            expect(astAnalysis.infeasibleNodes[0].line).toBe(3);

            const branchMap = {
                "0": {
                    line: 3,
                    type: "if",
                    loc: { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                    locations: [
                        { start: { line: 3, column: 47 }, end: { line: 5, column: 5 } },
                        { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } }
                    ]
                },
                "1": {
                    line: 6,
                    type: "if",
                    loc: { start: { line: 6, column: 4 }, end: { line: 8, column: 5 } },
                    locations: [
                        { start: { line: 6, column: 30 }, end: { line: 8, column: 5 } },
                        { start: { line: 6, column: 4 }, end: { line: 8, column: 5 } }
                    ]
                }
            };

            const fileCoverageData = {
                statementMap: {},
                s: {},
                branchMap,
                b: {
                    "0": [0, 1], // env guard missed true
                    "1": [0, 1]  // records.length === 0 missed true
                },
                fnMap: {},
                f: {}
            };

            const gapResult = mapCoverageGaps({
                astMetadata: astAnalysis,
                fileCoverageData,
                sourceCode: code
            });

            const envBranch = gapResult.uncoveredBranches.find(b => b.branchId === "0");
            const recordBranch = gapResult.uncoveredBranches.find(b => b.branchId === "1");

            expect(envBranch.isInfeasible).toBe(true);
            expect(recordBranch.isInfeasible).toBe(false); // Adjacent branch must remain actionable!
        });
    });

    // =========================================================================
    // SECTION 2: ALL 6 UNREACHABLE CODE CATEGORIES (EMPIRICAL ADVERSARIAL)
    // =========================================================================
    describe("2. All 6 Unreachable Code Categories (Empirical Adversarial Verification)", () => {

        // Category 1: Environment Guards
        describe("Category 1: Environment Guards", () => {
            test("detects direct and Yoda equality against production", () => {
                const code = `
function guards() {
    if (process.env.NODE_ENV === 'production') doProd();
    if ('production' === process.env.NODE_ENV) doYodaProd();
    if (process.env['NODE_ENV'] === 'production') doBracketProd();
    if (process['env']['NODE_ENV'] === 'production') doFullBracketProd();
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const envBlocks = blocks.filter(b => b.type === "ENVIRONMENT_GUARD");
                expect(envBlocks).toHaveLength(4);
                for (const b of envBlocks) {
                    expect(b.affectsBranch).toBe("TRUE_BRANCH");
                    expect(b.category).toBe("ENVIRONMENT");
                }
            });

            test("detects NODE_ENV === 'test' marking FALSE branch unreachable", () => {
                const code = `
function testEnv() {
    if (process.env.NODE_ENV === 'test') {
        useInMemory();
    } else {
        useProductionCluster();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const b = blocks.find(x => x.type === "ENVIRONMENT_GUARD");
                expect(b).toBeDefined();
                expect(b.affectsBranch).toBe("FALSE_BRANCH");
                expect(b.unreachableBranch).toBe("alternate");
            });

            test("detects platform and architecture guards", () => {
                const code = `
function platformGuards() {
    if (process.platform === 'linux') initLinuxSocket();
    if (process.arch === 'arm64') initArmOptimizations();
    if (process.env.CI === 'true') initCiReporter();
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                expect(blocks).toHaveLength(3);
                expect(blocks.every(b => b.category === "ENVIRONMENT")).toBe(true);
            });

            test("handles graceful fallback on non-string or unknown member access without crashing", () => {
                const code = `
function safeChecks(customVar) {
    if (process.env[customVar] === 'prod') doCustom();
    if (process.env.NODE_ENV === someVariable) doDynamic();
    if (process.customProp === 'val') doUnknown();
}
`;
                expect(() => detectInfeasibleAstNodes(null, code)).not.toThrow();
                const blocks = detectInfeasibleAstNodes(null, code);
                expect(Array.isArray(blocks)).toBe(true);
            });
        });

        // Category 2: Dead Code Post-Jump
        describe("Category 2: Dead Code Following Terminating / Jump Statements", () => {
            test("detects dead statements post-return, post-throw, and post-exit", () => {
                const code = `
function jumps(x) {
    if (x === 1) {
        return 1;
        const deadAfterReturn = 10;
        console.log("unreachable");
    }
    if (x === 2) {
        throw new Error("fatal");
        console.log("dead after throw");
    }
    if (x === 3) {
        process.exit(1);
        console.log("dead after exit");
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadBlocks = blocks.filter(b => b.type === "DEAD_CODE_POST_JUMP");
                expect(deadBlocks).toHaveLength(4); // 2 in x===1, 1 in x===2, 1 in x===3
                expect(deadBlocks.every(b => b.affectsBranch === "BOTH")).toBe(true);
            });

            test("detects dead statements after break and continue inside loops", () => {
                const code = `
function loops() {
    for (let i = 0; i < 10; i++) {
        if (i === 2) {
            continue;
            const deadPostContinue = true;
        }
        if (i === 5) {
            break;
            const deadPostBreak = true;
        }
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadBlocks = blocks.filter(b => b.type === "DEAD_CODE_POST_JUMP");
                expect(deadBlocks.length).toBeGreaterThanOrEqual(2);
            });

            test("detects dead code following dual-terminating if-else", () => {
                const code = `
function dualTerm(flag) {
    if (flag) {
        return "yes";
    } else {
        return "no";
    }
    console.log("Dead code after dual return!");
    const x = 100;
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadBlocks = blocks.filter(b => b.type === "DEAD_CODE_POST_JUMP");
                expect(deadBlocks.length).toBe(2);
                expect(deadBlocks[0].reason).toContain("DualTerminatingIfElse");
            });

            test("verifies finally block statements are NOT marked as dead code", () => {
                const code = `
function withFinally() {
    try {
        return 42;
    } finally {
        console.log("Finally always runs in JS!");
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const deadInFinally = blocks.find(b => b.justification.includes("Finally always runs"));
                expect(deadInFinally).toBeUndefined();
            });
        });

        // Category 3: Constant Boolean Conditions & Static Truthiness
        describe("Category 3: Constant Boolean Conditions & Static Truthiness", () => {
            test("detects literals: false, 0, '', null, undefined, !true as constant false", () => {
                const code = `
function literals() {
    if (false) consFalse();
    if (0) consZero();
    if ("") consEmptyStr();
    if (null) consNull();
    if (undefined) consUndef();
    if (!true) consNotTrue();
    if (void 0) consVoid();
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const constBlocks = blocks.filter(b => b.type === "CONSTANT_CONDITION");
                expect(constBlocks).toHaveLength(7);
                for (const b of constBlocks) {
                    expect(b.affectsBranch).toBe("TRUE_BRANCH");
                    expect(b.unreachableBranch).toBe("consequent");
                }
            });

            test("detects literals: true and !false as constant true with alternate unreachable", () => {
                const code = `
function trueLiterals() {
    if (true) {
        liveConsequent();
    } else {
        deadAlternate();
    }
    if (!false) {
        liveConsequent2();
    } else {
        deadAlternate2();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const constBlocks = blocks.filter(b => b.type === "CONSTANT_CONDITION");
                expect(constBlocks).toHaveLength(2);
                for (const b of constBlocks) {
                    expect(b.affectsBranch).toBe("FALSE_BRANCH");
                    expect(b.unreachableBranch).toBe("alternate");
                }
            });

            test("detects static binary comparisons (1 === 2, 10 > 5)", () => {
                const code = `
function binaryStatic() {
    if (1 === 2) deadEqual();
    if (10 > 5) {
        liveGreater();
    } else {
        deadLesser();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const constBlocks = blocks.filter(b => b.type === "CONSTANT_CONDITION");
                expect(constBlocks).toHaveLength(2);
                expect(constBlocks[0].affectsBranch).toBe("TRUE_BRANCH");
                expect(constBlocks[1].affectsBranch).toBe("FALSE_BRANCH");
            });

            test("detects while(false) loop body as dead", () => {
                const code = `
function deadWhile() {
    while (false) {
        console.log("Never runs");
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const whileBlock = blocks.find(b => b.type === "CONSTANT_CONDITION" && b.reason.includes("While condition"));
                expect(whileBlock).toBeDefined();
                expect(whileBlock.affectsBranch).toBe("TRUE_BRANCH");
            });
        });

        // Category 4: Defensive Checks on Infallible Local Objects
        describe("Category 4: Defensive Checks on Infallible Local Objects", () => {
            test("detects !x and x == null on local {}, [], new Map(), new Set()", () => {
                const code = `
function defensiveChecks() {
    const config = {};
    if (!config) throw new Error("Impossible 1");

    const list = [];
    if (list == null) throw new Error("Impossible 2");

    const cache = new Map();
    if (cache === null) throw new Error("Impossible 3");

    const tracker = new Set();
    if (tracker === undefined) throw new Error("Impossible 4");
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const defBlocks = blocks.filter(b => b.type === "DEFENSIVE_NULL_CHECK");
                expect(defBlocks).toHaveLength(4);
                for (const b of defBlocks) {
                    expect(b.category).toBe("DEFENSIVE");
                    expect(b.affectsBranch).toBe("TRUE_BRANCH");
                }
            });

            test("does NOT flag check if local variable was reassigned", () => {
                const code = `
function reassignedCheck() {
    let data = {};
    data = fetchExternal();
    if (!data) {
        handleEmpty();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const defBlocks = blocks.filter(b => b.type === "DEFENSIVE_NULL_CHECK");
                expect(defBlocks).toHaveLength(0);
            });

            test("preserves detection if object properties are mutated without reassigning the variable", () => {
                const code = `
function propMutated() {
    const state = {};
    state.active = true;
    state.count = 42;
    if (!state) {
        throw new Error("Impossible");
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const defBlocks = blocks.filter(b => b.type === "DEFENSIVE_NULL_CHECK");
                expect(defBlocks).toHaveLength(1);
            });
        });

        // Category 5: Infallible Try/Catch
        describe("Category 5: Infallible Try/Catch Blocks", () => {
            test("flags catch block wrapping pure infallible Math, Array, Number operations", () => {
                const code = `
function pureCalculations(val) {
    try {
        const a = Math.max(1, 2);
        const b = Math.floor(4.5);
        const c = Array.isArray([1, 2]);
        const d = Number.isInteger(10);
        const e = Boolean(1);
    } catch (err) {
        logImpossibleCatch(err);
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const catchBlocks = blocks.filter(b => b.type === "INFALLIBLE_TRY_CATCH");
                expect(catchBlocks).toHaveLength(1);
                expect(catchBlocks[0].category).toBe("DEFENSIVE");
                expect(catchBlocks[0].justification).toContain("Catch clause wraps infallible built-in operations");
            });

            test("does NOT flag catch block when try body contains potentially fallible operations", () => {
                const code = `
function fallibleOperations(rawInput, user) {
    try {
        const parsed = JSON.parse(rawInput); // JSON.parse can throw SyntaxError
        const role = user.profile.role;       // user.profile can throw TypeError
    } catch (err) {
        handleRealError(err);
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const catchBlocks = blocks.filter(b => b.type === "INFALLIBLE_TRY_CATCH");
                expect(catchBlocks).toHaveLength(0);
            });
        });

        // Category 6: Contradictory / Duplicate Branch Conditions
        describe("Category 6: Contradictory / Duplicate Branch Conditions", () => {
            test("detects duplicate identical condition in else-if chain", () => {
                const code = `
function processScore(score) {
    if (score > 100) {
        grantBonus();
    } else if (score > 100) {
        grantDuplicateBonus();
    } else {
        grantRegular();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const dupBlocks = blocks.filter(b => b.type === "CONTRADICTORY_BRANCH");
                expect(dupBlocks).toHaveLength(1);
                expect(dupBlocks[0].category).toBe("LOGIC");
                expect(dupBlocks[0].affectsBranch).toBe("TRUE_BRANCH");
                expect(dupBlocks[0].justification).toContain("identical to preceding guard");
            });

            test("does NOT flag distinct conditions in else-if chain", () => {
                const code = `
function processTiers(score) {
    if (score > 100) {
        tier1();
    } else if (score > 50) {
        tier2();
    } else {
        tier3();
    }
}
`;
                const blocks = detectInfeasibleAstNodes(null, code);
                const dupBlocks = blocks.filter(b => b.type === "CONTRADICTORY_BRANCH");
                expect(dupBlocks).toHaveLength(0);
            });
        });
    });

    // =========================================================================
    // SECTION 3: TRUTHY VS FALSY BRANCH COORDINATES & LOCATION ISOLATION
    // =========================================================================
    describe("3. Truthy vs Falsy Branch Coordinates & Location Isolation", () => {

        test("isLocContained: verifies mathematical character-accurate containment", () => {
            const outer = { start: { line: 10, column: 5 }, end: { line: 15, column: 20 } };
            const inner = { start: { line: 11, column: 0 }, end: { line: 14, column: 30 } };
            const sameLineInside = { start: { line: 10, column: 10 }, end: { line: 10, column: 15 } };
            const outsideBefore = { start: { line: 9, column: 0 }, end: { line: 10, column: 4 } };
            const outsideAfter = { start: { line: 15, column: 21 }, end: { line: 16, column: 0 } };

            expect(isLocContained(outer, inner)).toBe(true);
            expect(isLocContained(outer, sameLineInside)).toBe(true);
            expect(isLocContained(outer, outer)).toBe(true); // self-containment
            expect(isLocContained(outer, outsideBefore)).toBe(false);
            expect(isLocContained(outer, outsideAfter)).toBe(false);
            expect(isLocContained(null, inner)).toBe(false);
            expect(isLocContained(outer, null)).toBe(false);
        });

        test("isLocOverlapping: verifies character-accurate non-overlap for disjoint bounds", () => {
            const blockA = { start: { line: 5, column: 10 }, end: { line: 5, column: 25 } };
            const blockB = { start: { line: 5, column: 30 }, end: { line: 5, column: 45 } };
            const blockC = { start: { line: 5, column: 20 }, end: { line: 5, column: 35 } }; // overlaps A and B

            expect(isLocOverlapping(blockA, blockB)).toBe(false);
            expect(isLocOverlapping(blockB, blockA)).toBe(false);
            expect(isLocOverlapping(blockA, blockC)).toBe(true);
            expect(isLocOverlapping(blockB, blockC)).toBe(true);
        });

        test("branch direction matching: ensures TRUE_BRANCH guard only tags branch when missedTrue is true", () => {
            const code = `
function checkEnv() {
    if (process.env.NODE_ENV === 'production') {
        doProd();
    }
    return true;
}
`;
            const astAnalysis = analyzeSourceAst(code);

            // Case A: missedTrue is true (production branch was missed)
            const covMissedTrue = {
                statementMap: {},
                s: {},
                branchMap: {
                    "0": {
                        line: 3,
                        type: "if",
                        loc: { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                        locations: [
                            { start: { line: 3, column: 47 }, end: { line: 5, column: 5 } },
                            { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } }
                        ]
                    }
                },
                b: { "0": [0, 1] } // missedTrue: true, missedFalse: false
            };

            const resA = mapCoverageGaps({
                astMetadata: astAnalysis,
                fileCoverageData: covMissedTrue,
                sourceCode: code
            });
            expect(resA.uncoveredBranches[0].isInfeasible).toBe(true);

            // Case B: missedTrue is false (production branch was actually executed in a mocked test)
            const covHitTrue = {
                statementMap: {},
                s: {},
                branchMap: covMissedTrue.branchMap,
                b: { "0": [1, 0] } // missedTrue: false, missedFalse: true
            };

            const resB = mapCoverageGaps({
                astMetadata: astAnalysis,
                fileCoverageData: covHitTrue,
                sourceCode: code
            });
            // When missedTrue is false, the TRUE_BRANCH environment guard must NOT tag the branch!
            expect(resB.uncoveredBranches[0].isInfeasible).toBe(false);
        });
    });

    // =========================================================================
    // SECTION 4: AUTHENTIC ISTANBUL COVERAGE METRICS PRESERVATION
    // =========================================================================
    describe("4. Preservation of Authentic Istanbul Metrics & Statistical Integrity", () => {

        test("mapCoverageGaps and classifyFeasibleCoverage never mutate frozen input coverage data", () => {
            const rawCoverageObject = {
                linesPct: 75.0,
                branchesPct: 50.0,
                functionsPct: 100.0,
                statementsPct: 80.0,
                uncoveredLines: [15, 16],
                uncoveredBranches: [
                    {
                        branchId: "b1",
                        line: 15,
                        missedTrue: true,
                        missedFalse: false,
                        loc: { start: { line: 15, column: 4 }, end: { line: 17, column: 5 } }
                    }
                ],
                uncoveredFunctions: []
            };

            // Deeply freeze the object to guarantee immutability
            Object.freeze(rawCoverageObject);
            Object.freeze(rawCoverageObject.uncoveredLines);
            Object.freeze(rawCoverageObject.uncoveredBranches[0]);
            Object.freeze(rawCoverageObject.uncoveredBranches);

            const infeasibleBlocks = [
                {
                    type: "ENVIRONMENT_GUARD",
                    line: 15,
                    loc: { start: { line: 15, column: 4 }, end: { line: 17, column: 5 } },
                    affectsBranch: "TRUE_BRANCH",
                    justification: "Guarded by process.env.NODE_ENV === 'production'"
                }
            ];

            // Must execute cleanly without throwing TypeError: Cannot add property / Cannot assign to read only
            let classification;
            expect(() => {
                classification = classifyFeasibleCoverage(rawCoverageObject, infeasibleBlocks);
            }).not.toThrow();

            // 1. Raw authentic coverage MUST remain strictly untouched
            expect(classification.rawCoverage.linesPct).toBe(75.0);
            expect(classification.rawCoverage.branchesPct).toBe(50.0);
            expect(classification.rawCoverage.statementsPct).toBe(80.0);
            expect(classification.rawCoverage.functionsPct).toBe(100.0);

            // 2. Feasible coverage reflects the logical status without altering raw metrics
            expect(classification.isFeasibleLogicCovered).toBe(true);
            expect(classification.feasibleCoverage.linesPct).toBe(100);
            expect(classification.feasibleCoverage.branchesPct).toBe(100);

            // 3. Actionable gaps must be zero
            expect(classification.actionableGaps.lines).toBe(0);
            expect(classification.actionableGaps.branches).toBe(0);
        });

        test("preserves actionable gaps when non-infeasible branches remain uncovered", () => {
            const coverageData = {
                linesPct: 60.0,
                branchesPct: 33.3,
                uncoveredLines: [10, 25],
                uncoveredBranches: [
                    { branchId: "b1", line: 10, missedTrue: true, missedFalse: false },
                    { branchId: "b2", line: 25, missedTrue: true, missedFalse: false }
                ],
                uncoveredFunctions: []
            };

            // Only line 10 is an infeasible guard, line 25 is genuine uncovered business logic
            const infeasibleBlocks = [
                {
                    type: "ENVIRONMENT_GUARD",
                    line: 10,
                    affectsBranch: "TRUE_BRANCH",
                    justification: "Production guard"
                }
            ];

            const result = classifyFeasibleCoverage(coverageData, infeasibleBlocks);
            expect(result.isFeasibleLogicCovered).toBe(false);
            expect(result.actionableGaps.branches).toBe(1);
            expect(result.actionableGaps.lines).toBe(1);
            expect(result.actionableLines).toEqual([25]);
            expect(result.rawCoverage.linesPct).toBe(60.0);
            expect(result.feasibleCoverage.linesPct).toBe(60.0); // Not 100 because actionable gaps remain!
        });
    });

    // =========================================================================
    // SECTION 5: FAKE & TAUTOLOGICAL ASSERTION PREVENTION
    // =========================================================================
    describe("5. Fake & Tautological Assertion Prevention", () => {

        test("mapCoverageGaps tags infeasible decision points with INFEASIBLE_GUARD status and suppression guidance", () => {
            const code = `
function notify(msg) {
    if (process.env.NODE_ENV === 'production') {
        sendRealSms(msg);
    }
    return msg;
}
`;
            const astAnalysis = analyzeSourceAst(code);
            const cov = {
                statementMap: {},
                s: {},
                branchMap: {
                    "0": {
                        line: 3,
                        type: "if",
                        loc: { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                        locations: [
                            { start: { line: 3, column: 47 }, end: { line: 5, column: 5 } },
                            { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } }
                        ]
                    }
                },
                b: { "0": [0, 1] }
            };

            const gapResult = mapCoverageGaps({
                astMetadata: astAnalysis,
                fileCoverageData: cov,
                sourceCode: code
            });

            const guidance = gapResult.targetedGuidance.find(g => g.line === 3);
            expect(guidance).toBeDefined();
            expect(guidance.status).toBe("INFEASIBLE_GUARD");
            expect(guidance.isInfeasible).toBe(true);
            expect(guidance.guidance).toContain("Suppressed from unit test generation");
        });

        test("prompt builder template explicitly bans fake assertions like expect(true).toBe(true)", () => {
            const prompt = buildStandardUnitTestPrompt({
                sourceFilePath: "src/services/billing.service.js",
                sourceCode: "export function charge() {}",
                framework: "jest",
                testFileInfo: { found: false }
            });

            // Must include explicit ban on fake or placeholder assertions
            expect(prompt).toContain("Never generate fake or placeholder assertions like expect(true).toBe(true)");
            expect(prompt).toContain("Never generate fake or tautological assertions for unreachable or environment-dependent code");
        });
    });

    // =========================================================================
    // SECTION 6: STORAGE IMMUTABILITY VERIFICATION
    // =========================================================================
    describe("6. Storage Immutability Verification", () => {

        test("verifies storage/ directory remains completely untouched and clean in git", () => {
            const storagePath = path.resolve(process.cwd(), "storage");
            if (fs.existsSync(storagePath)) {
                const gitStatus = execSync("git status --porcelain storage/", { encoding: "utf8" });
                expect(gitStatus.trim()).toBe("");
            }
        });
    });
});
