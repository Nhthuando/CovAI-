import { describe, test, expect } from "@jest/globals";
import {
    analyzeSourceAst,
    mapCoverageGaps,
    isBusinessLogicFile
} from "../services/businessLogicAstAnalyzer.service.js";
import {
    extractBranchFlow,
    extractStatementFlow,
    extractFunctionFlow
} from "../services/fileCoverage.service.js";
import {
    extractAstMetadata,
    extractSourceGapsAndDecisions
} from "../services/unitTestSuggestion.service.js";

describe("Phase 1: AST & Coverage Gap Analyzer (Kế hoạch Triển khai Phase 1)", () => {
    describe("1. Public Exported vs Internal Helper Function Classification", () => {
        const sourceCode = `
            // Internal unexported helper 1
            function calculateDiscount(rate, amount) {
                if (rate <= 0) return 0;
                return rate * amount;
            }

            // Internal unexported helper 2 (arrow)
            const validateTaxId = (taxId = "DEFAULT_TAX") => {
                return taxId ? taxId.trim() : null;
            };

            // Public exported function 1: Calls calculateDiscount and validateTaxId
            export async function processPayment(orderId, amount, options = {}) {
                if (!orderId) throw new Error("Order ID required");
                const discount = calculateDiscount(options.rate || 0.1, amount);
                const tax = validateTaxId(options.taxId);
                return { orderId, finalAmount: amount - discount, tax };
            }

            // Public exported function 2
            export const formatSummary = (data) => {
                return data?.orderId ? "Order #" + data.orderId : "N/A";
            };
        `;

        test("extracts exported symbols and details with function signatures", () => {
            const meta = extractAstMetadata(sourceCode);
            expect(meta.exportedSymbols).toContain("processPayment");
            expect(meta.exportedSymbols).toContain("formatSummary");
            expect(meta.exportedSymbols).not.toContain("calculateDiscount");
            expect(meta.exportedSymbols).not.toContain("validateTaxId");

            const procPayment = meta.exportedSymbolDetails.find(s => s.name === "processPayment");
            expect(procPayment).toBeDefined();
            expect(procPayment.type).toBe("function");
            expect(procPayment.params).toEqual(["orderId", "amount", "options"]);
            expect(procPayment.calls).toContain("calculateDiscount");
            expect(procPayment.calls).toContain("validateTaxId");
        });

        test("classifies internal helpers and maps indirect caller linkages for safe testing", () => {
            const meta = extractAstMetadata(sourceCode);
            expect(meta.unexportedFunctions).toContain("calculateDiscount");
            expect(meta.unexportedFunctions).toContain("validateTaxId");

            const discountHelper = meta.internalFunctionDetails.find(f => f.name === "calculateDiscount");
            expect(discountHelper).toBeDefined();
            expect(discountHelper.warning).toContain("DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER");
            expect(discountHelper.callers).toContain("processPayment");

            const taxHelper = meta.internalFunctionDetails.find(f => f.name === "validateTaxId");
            expect(taxHelper).toBeDefined();
            expect(taxHelper.callers).toContain("processPayment");
        });
    });

    describe("2. Comprehensive Decision Points & Exception Points Extraction", () => {
        const complexLogicCode = `
            export function processOrder(order, user) {
                // 1. If statement with else
                if (!order) {
                    throw new Error("Missing order");
                } else if (!order.items || order.items.length === 0) {
                    throw new Error("Order has no items");
                }

                // 2. Short-circuit ??, ||, &&
                const discountRate = order.discountRate ?? 0.05;
                const userRole = user.role || "GUEST";
                const isVip = userRole === "VIP" && order.amount > 1000;

                // 3. Optional chaining ?.
                const couponCode = order?.coupon?.code;

                // 4. Ternary conditional expression
                const fee = isVip ? 0 : 15;

                // 5. Switch-case
                switch (userRole) {
                    case "ADMIN":
                        return { total: 0, status: "WAIVED" };
                    case "VIP":
                        return { total: order.amount * (1 - discountRate), status: "VIP_DISCOUNT" };
                    default:
                        return { total: order.amount + fee, status: "STANDARD" };
                }
            }

            export async function fetchRemoteConfig(url, timeoutMs = 5000) {
                try {
                    return await fetch(url);
                } catch (err) {
                    return Promise.reject(new Error("Fetch failed: " + err.message));
                }
            }
        `;

        test("extracts all branching decision point types accurately", () => {
            const meta = extractAstMetadata(complexLogicCode);
            const { decisionPoints, exceptionPoints } = meta;

            // If statements
            expect(decisionPoints.some(d => d.type === "if")).toBe(true);

            // Ternary
            expect(decisionPoints.some(d => d.type === "ternary")).toBe(true);

            // Switch cases (cases + default)
            expect(decisionPoints.filter(d => d.type === "switch-case").length).toBeGreaterThanOrEqual(3);

            // Logical short-circuit operators (??, ||, &&)
            expect(decisionPoints.some(d => d.type === "logical(??)")).toBe(true);
            expect(decisionPoints.some(d => d.type === "logical(||)")).toBe(true);
            expect(decisionPoints.some(d => d.type === "logical(&&)")).toBe(true);

            // Optional chaining (?.)
            expect(decisionPoints.some(d => d.type === "optional-chaining(?.)")).toBe(true);

            // Default argument (timeoutMs = 5000)
            expect(decisionPoints.some(d => d.type === "default-arg" && d.param === "timeoutMs")).toBe(true);

            // Exceptions: throw, catch, promise-reject
            expect(exceptionPoints.some(e => e.type === "throw")).toBe(true);
            expect(exceptionPoints.some(e => e.type === "catch")).toBe(true);
            expect(exceptionPoints.some(e => e.type === "promise-reject")).toBe(true);
        });
    });

    describe("3. Istanbul Coverage Gap Standardization (fileCoverage.service)", () => {
        const sampleSource = [
            "export function calculateFee(user, baseFee = 20) {", // line 1: default-arg
            "    const rate = user.discount ?? 0.1;",            // line 2: binary-expr (??)
            "    if (user.isVip) {",                              // line 3: if
            "        return baseFee * rate;",                     // line 4: return
            "    }",                                              // line 5
            "    return baseFee;",                                // line 6: return
            "}"                                                   // line 7
        ].join("\n");

        const istanbulData = {
            statementMap: {
                "0": { start: { line: 1, column: 0 }, end: { line: 7, column: 1 } },
                "1": { start: { line: 2, column: 4 }, end: { line: 2, column: 38 } },
                "2": { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                "3": { start: { line: 4, column: 8 }, end: { line: 4, column: 32 } },
                "4": { start: { line: 6, column: 4 }, end: { line: 6, column: 20 } }
            },
            s: { "0": 5, "1": 5, "2": 5, "3": 0, "4": 5 }, // Statement 3 (line 4) uncovered!
            branchMap: {
                "0": {
                    line: 1,
                    type: "default-arg",
                    locations: [
                        { start: { line: 1, column: 36 }, end: { line: 1, column: 48 } },
                        { start: { line: 1, column: 36 }, end: { line: 1, column: 48 } }
                    ]
                },
                "1": {
                    line: 2,
                    type: "binary-expr",
                    locations: [
                        { start: { line: 2, column: 17 }, end: { line: 2, column: 30 } },
                        { start: { line: 2, column: 34 }, end: { line: 2, column: 37 } }
                    ]
                },
                "2": {
                    line: 3,
                    type: "if",
                    locations: [
                        { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } },
                        { start: { line: 3, column: 4 }, end: { line: 5, column: 5 } }
                    ]
                }
            },
            b: {
                "0": [5, 0], // default-arg: 5 times supplied, 0 times default used
                "1": [3, 2], // binary-expr: 3 times left defined, 2 times fallback taken (fully covered)
                "2": [0, 5]  // if: True path missed (0), False path taken (5)
            },
            fnMap: {
                "0": { name: "calculateFee", line: 1, loc: { start: { line: 1 }, end: { line: 7 } } }
            },
            f: { "0": 5 }
        };

        test("extractBranchFlow identifies specific branch types and path labels", () => {
            const branches = extractBranchFlow(istanbulData, sampleSource);
            expect(branches).toHaveLength(3);

            // Default arg branch
            const defaultArgBr = branches.find(b => b.type === "default-arg");
            expect(defaultArgBr).toBeDefined();
            expect(defaultArgBr.status).toBe("partially_covered");
            expect(defaultArgBr.paths[0].label).toContain("Argument supplied");
            expect(defaultArgBr.paths[1].label).toContain("Argument undefined");
            expect(defaultArgBr.paths[1].covered).toBe(false);

            // Binary expr (??) branch
            const binaryBr = branches.find(b => b.type === "binary-expr");
            expect(binaryBr).toBeDefined();
            expect(binaryBr.status).toBe("fully_covered");
            expect(binaryBr.paths[0].label).toContain("Left operand defined");
            expect(binaryBr.paths[1].label).toContain("fallback");

            // If branch
            const ifBr = branches.find(b => b.type === "if");
            expect(ifBr).toBeDefined();
            expect(ifBr.status).toBe("partially_covered");
            expect(ifBr.missedTrue).toBe(true);
            expect(ifBr.missedFalse).toBe(false);
            expect(ifBr.paths[0].covered).toBe(false);
            expect(ifBr.paths[1].covered).toBe(true);
        });

        test("extractStatementFlow classifies statements with covered and uncovered flags", () => {
            const stmts = extractStatementFlow(istanbulData, sampleSource);
            expect(stmts).toHaveLength(5);

            const uncoveredStmt = stmts.find(s => s.startLine === 4);
            expect(uncoveredStmt).toBeDefined();
            expect(uncoveredStmt.covered).toBe(false);
            expect(uncoveredStmt.hits).toBe(0);
            expect(uncoveredStmt.type).toBe("return");

            const conditionStmt = stmts.find(s => s.startLine === 3);
            expect(conditionStmt).toBeDefined();
            expect(conditionStmt.type).toBe("condition");
            expect(conditionStmt.covered).toBe(true);
        });
    });

    describe("4. Integrated Source Gaps & Decision Table Extraction", () => {
        const sourceCode = `
            function sanitizeName(name) {
                if (!name) return "Anonymous";
                return name.trim();
            }

            export function registerUser(username, role = "USER") {
                const cleanName = sanitizeName(username);
                if (cleanName === "Anonymous") {
                    throw new Error("Invalid username");
                }
                return { name: cleanName, role };
            }
        `;

        const coverageData = {
            statementMap: {
                "0": { start: { line: 2 }, end: { line: 4 } },
                "1": { start: { line: 3 }, end: { line: 3 } },
                "2": { start: { line: 4 }, end: { line: 4 } },
                "3": { start: { line: 7 }, end: { line: 13 } },
                "4": { start: { line: 8 }, end: { line: 8 } },
                "5": { start: { line: 9 }, end: { line: 11 } },
                "6": { start: { line: 10 }, end: { line: 10 } },
                "7": { start: { line: 12 }, end: { line: 12 } }
            },
            s: { "0": 1, "1": 0, "2": 1, "3": 1, "4": 1, "5": 1, "6": 0, "7": 1 },
            branchMap: {
                "0": {
                    line: 3,
                    type: "if",
                    locations: [{ start: { line: 3 } }, { start: { line: 4 } }]
                },
                "1": {
                    line: 7,
                    type: "default-arg",
                    locations: [{ start: { line: 7 } }, { start: { line: 7 } }]
                },
                "2": {
                    line: 9,
                    type: "if",
                    locations: [{ start: { line: 9 } }, { start: { line: 11 } }]
                }
            },
            b: {
                "0": [0, 1], // sanitizeName: !name True path missed
                "1": [1, 0], // default-arg: default USER missed
                "2": [0, 1]  // cleanName === "Anonymous" True path missed (error not thrown)
            },
            fnMap: {
                "0": { name: "sanitizeName", line: 2, loc: { start: { line: 2 } } },
                "1": { name: "registerUser", line: 7, loc: { start: { line: 7 } } }
            },
            f: { "0": 1, "1": 1 }
        };

        test("extractSourceGapsAndDecisions combines AST, gaps, and decision table seamlessly", () => {
            const report = extractSourceGapsAndDecisions({
                sourceCode,
                fileCoverageData: coverageData,
                uncoveredLines: [3, 10]
            });

            // 1. AST Metadata checks
            expect(report.astMetadata.exportedSymbols).toContain("registerUser");
            expect(report.astMetadata.unexportedFunctions).toContain("sanitizeName");

            // 2. Coverage Gaps checks
            expect(report.coverageGaps.uncoveredLines).toContain(3);
            expect(report.coverageGaps.uncoveredLines).toContain(10);
            expect(report.coverageGaps.uncoveredBranches.length).toBeGreaterThanOrEqual(2);

            // 3. Decision Table checks
            expect(report.decisionTable).toBeDefined();
            expect(report.decisionTable.rows.length).toBeGreaterThan(0);
            expect(report.decisionTable.categories).toBeDefined();
            expect(report.decisionTable.categories.happyPath).toBeDefined();
            expect(report.decisionTable.categories.exceptions).toBeDefined();

            // 4. Indirect Strategy checks for sanitizeName
            expect(report.indirectStrategy).toBeDefined();
            expect(report.indirectStrategy.recommendations.some(r => r.helper === "sanitizeName")).toBe(true);
        });
    });
});
