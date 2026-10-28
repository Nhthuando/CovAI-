import { describe, test, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import {
    isBusinessLogicFile,
    classifyBusinessLogicFiles,
    analyzeSourceAst,
    mapCoverageGaps,
    normalizeRelativePath
} from "../services/businessLogicAstAnalyzer.service.js";

describe("Business Logic AST Analyzer Service - Phase 1 Verification", () => {
    describe("1.1 File Classification & Target Recognition (isBusinessLogicFile)", () => {
        test("correctly recognizes business logic files across standard layers", () => {
            // Services
            expect(isBusinessLogicFile("src/services/billing.service.js")).toBe(true);
            expect(isBusinessLogicFile("backend/services/payment.service.ts")).toBe(true);
            expect(isBusinessLogicFile("src/services/userCalculation.js")).toBe(true);

            // Handlers
            expect(isBusinessLogicFile("src/handlers/get-quickbooks-ledger.handler.ts")).toBe(true);
            expect(isBusinessLogicFile("src/handlers/order-pipeline.step.js")).toBe(true);

            // Controllers
            expect(isBusinessLogicFile("src/controllers/auth.controller.js")).toBe(true);
            expect(isBusinessLogicFile("src/controllers/product.controller.ts")).toBe(true);

            // Utils & Helpers & Lib
            expect(isBusinessLogicFile("src/utils/taxSanitizer.js")).toBe(true);
            expect(isBusinessLogicFile("src/helpers/dateFormatter.ts")).toBe(true);
            expect(isBusinessLogicFile("src/lib/calculator.js")).toBe(true);

            // Models & Middlewares
            expect(isBusinessLogicFile("src/models/user.model.js")).toBe(true);
            expect(isBusinessLogicFile("src/middlewares/auth.middleware.ts")).toBe(true);
            expect(isBusinessLogicFile("src/middlewares/permissionGuard.js")).toBe(true);
        });

        test("strictly excludes test files", () => {
            expect(isBusinessLogicFile("src/services/billing.service.test.js")).toBe(false);
            expect(isBusinessLogicFile("src/controllers/auth.spec.ts")).toBe(false);
            expect(isBusinessLogicFile("tests/unit/calculator.test.js")).toBe(false);
            expect(isBusinessLogicFile("src/handlers/__tests__/order.js")).toBe(false);
            expect(isBusinessLogicFile("specs/feature.spec.js")).toBe(false);
            expect(isBusinessLogicFile("tests/e2e/login.steps.js")).toBe(false);
            expect(isBusinessLogicFile("src/services/user.testcase.js")).toBe(false);
        });

        test("strictly excludes mocks, fixtures, and runner configs", () => {
            expect(isBusinessLogicFile("__mocks__/axios.js")).toBe(false);
            expect(isBusinessLogicFile("src/services/__mocks__/billing.js")).toBe(false);
            expect(isBusinessLogicFile("mocks/dbClient.mock.js")).toBe(false);
            expect(isBusinessLogicFile("fixtures/sampleUser.fixture.js")).toBe(false);
            expect(isBusinessLogicFile("setupTests.js")).toBe(false);
            expect(isBusinessLogicFile("jest.config.js")).toBe(false);
            expect(isBusinessLogicFile("vite.config.ts")).toBe(false);
            expect(isBusinessLogicFile("tsconfig.json")).toBe(false);
        });

        test("strictly excludes node_modules, builds, and frontend UI", () => {
            expect(isBusinessLogicFile("node_modules/express/index.js")).toBe(false);
            expect(isBusinessLogicFile("dist/bundle.js")).toBe(false);
            expect(isBusinessLogicFile("coverage/lcov.js")).toBe(false);
            expect(isBusinessLogicFile("client/src/App.jsx")).toBe(false);
            expect(isBusinessLogicFile("frontend/components/Navbar.tsx")).toBe(false);
            expect(isBusinessLogicFile("src/components/Sidebar.js")).toBe(false);
            expect(isBusinessLogicFile("src/views/HomeView.js")).toBe(false);
        });

        test("strictly excludes route and server entry files (reserved for integration/system testing)", () => {
            expect(isBusinessLogicFile("src/routes/auth.routes.js")).toBe(false);
            expect(isBusinessLogicFile("src/routes/api.js")).toBe(false);
            expect(isBusinessLogicFile("src/endpoints/user.js")).toBe(false);
            expect(isBusinessLogicFile("app.js")).toBe(false);
            expect(isBusinessLogicFile("server.js")).toBe(false);
            expect(isBusinessLogicFile("src/app.js")).toBe(false);
            expect(isBusinessLogicFile("src/server.js")).toBe(false);
            expect(isBusinessLogicFile("src/index.js")).toBe(false);
            expect(isBusinessLogicFile("index.js")).toBe(false);
        });

        test("classifyBusinessLogicFiles scans and categorizes directory accurately", () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-classify-test-"));
            try {
                fs.mkdirSync(path.join(tempDir, "src", "services"), { recursive: true });
                fs.mkdirSync(path.join(tempDir, "src", "controllers"), { recursive: true });
                fs.mkdirSync(path.join(tempDir, "src", "utils"), { recursive: true });
                fs.mkdirSync(path.join(tempDir, "src", "routes"), { recursive: true });
                fs.mkdirSync(path.join(tempDir, "node_modules", "pkg"), { recursive: true });

                fs.writeFileSync(path.join(tempDir, "src", "services", "payment.service.js"), "export const pay = () => {};");
                fs.writeFileSync(path.join(tempDir, "src", "services", "payment.service.test.js"), "test('pay', () => {});");
                fs.writeFileSync(path.join(tempDir, "src", "controllers", "order.controller.js"), "export const createOrder = () => {};");
                fs.writeFileSync(path.join(tempDir, "src", "utils", "math.js"), "export function add(a, b) { return a + b; }");
                fs.writeFileSync(path.join(tempDir, "src", "routes", "order.routes.js"), "router.post('/order');");
                fs.writeFileSync(path.join(tempDir, "node_modules", "pkg", "index.js"), "module.exports = {};");

                const result = classifyBusinessLogicFiles(tempDir);
                expect(result.services).toEqual(["src/services/payment.service.js"]);
                expect(result.controllers).toEqual(["src/controllers/order.controller.js"]);
                expect(result.utils).toEqual(["src/utils/math.js"]);
                expect(result.all).toHaveLength(3);
                expect(result.all).not.toContain("src/routes/order.routes.js");
                expect(result.all).not.toContain("src/services/payment.service.test.js");
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });

    describe("1.2 AST Analysis with Babel Parser (analyzeSourceAst)", () => {
        test("extracts ESM exported symbols, unexported internal functions, and decision/exception points", () => {
            const sourceCode = `
import axios from 'axios';

// Internal helper 1: unexported function
function calculateDiscount(rate, amount) {
    if (rate <= 0) {
        return 0;
    }
    return rate * amount;
}

// Internal helper 2: unexported arrow function
const validateTaxId = (id) => {
    return id ? id.trim() : null;
};

// Exported public symbol 1
export async function processPayment(orderId, amount, options = {}) {
    const status = options.priority ? "HIGH" : "NORMAL";

    if (!orderId) {
        throw new Error("Missing orderId");
    }

    const discount = calculateDiscount(options.rate || 0.1, amount);
    const finalAmount = amount - discount;

    const taxId = validateTaxId(options?.taxId);

    switch (status) {
        case "HIGH":
            console.log("High priority payment");
            break;
        default:
            console.log("Default payment");
    }

    try {
        const response = await axios.post('/pay', { finalAmount, taxId });
        return response.data;
    } catch (err) {
        return Promise.reject(err);
    }
}

// Exported constant
export const PAYMENT_GATEWAY = "STRIPE";
`;

            const result = analyzeSourceAst(sourceCode);

            // 1. Exported Symbols
            expect(result.exportedSymbols.some(s => s.name === "processPayment" && s.type === "function")).toBe(true);
            expect(result.exportedSymbols.some(s => s.name === "PAYMENT_GATEWAY" && s.type === "constant")).toBe(true);
            expect(result.exportedSymbolNames).toContain("processPayment");
            expect(result.exportedSymbolNames).toContain("PAYMENT_GATEWAY");

            // 2. Internal / Private Functions (Strictly flagged with warning)
            expect(result.internalFunctions.some(f => f.name === "calculateDiscount")).toBe(true);
            expect(result.internalFunctions.some(f => f.name === "validateTaxId")).toBe(true);
            const discountFn = result.internalFunctions.find(f => f.name === "calculateDiscount");
            expect(discountFn.warning).toContain("DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER");
            expect(result.unexportedFunctions).toContain("calculateDiscount");
            expect(result.unexportedFunctions).toContain("validateTaxId");

            // 3. Decision Points (If, Ternary, SwitchCase, Logical, Optional Chaining)
            const ifDecisions = result.decisionPoints.filter(d => d.type === "if");
            expect(ifDecisions.length).toBeGreaterThanOrEqual(2);

            const ternaryDecisions = result.decisionPoints.filter(d => d.type === "ternary");
            expect(ternaryDecisions.length).toBeGreaterThanOrEqual(2);

            const switchDecisions = result.decisionPoints.filter(d => d.type === "switch-case");
            expect(switchDecisions.length).toBeGreaterThanOrEqual(2); // case "HIGH" and default

            const logicalDecisions = result.decisionPoints.filter(d => d.type.startsWith("logical"));
            expect(logicalDecisions.some(d => d.operator === "||")).toBe(true);

            const optChainingDecisions = result.decisionPoints.filter(d => d.type.startsWith("optional-chaining"));
            expect(optChainingDecisions.length).toBeGreaterThanOrEqual(1);

            // 4. Exception Points (Throw, Catch, Promise.reject)
            expect(result.exceptionPoints.some(e => e.type === "throw")).toBe(true);
            expect(result.exceptionPoints.some(e => e.type === "catch" && e.param === "err")).toBe(true);
            expect(result.exceptionPoints.some(e => e.type === "promise-reject")).toBe(true);
        });

        test("extracts CommonJS exported and internal functions cleanly", () => {
            const cjsCode = `
const fs = require('fs');

function formatCurrency(val) {
    return '$' + val.toFixed(2);
}

function computeInvoice(items) {
    if (!items || items.length === 0) {
        throw new Error("No items");
    }
    const total = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
    return formatCurrency(total);
}

module.exports = {
    computeInvoice
};
`;
            const result = analyzeSourceAst(cjsCode);
            expect(result.exportedSymbols.some(s => s.name === "computeInvoice")).toBe(true);
            expect(result.internalFunctions.some(f => f.name === "formatCurrency")).toBe(true);
            expect(result.unexportedFunctions).toContain("formatCurrency");

            // Nullish coalescing (??)
            expect(result.decisionPoints.some(d => d.operator === "??")).toBe(true);
        });
    });

    describe("1.3 Coverage Gap Mapping (mapCoverageGaps)", () => {
        test("accurately bridges Istanbul coverage data to AST decision points and lines", () => {
            const sourceCode = `
export function evaluateUser(user) {
    if (user.isAdmin) {
        return "ADMIN";
    } else {
        return "REGULAR";
    }
}

export function handleFailure(err) {
    if (!err) {
        return false;
    }
    throw new Error(err.message);
}
`;
            const astMeta = analyzeSourceAst(sourceCode);

            // Simulate Istanbul coverage-final.json format:
            // evaluateUser was executed, but only the TRUE branch (ADMIN) was taken; FALSE was missed.
            // handleFailure was NEVER called (lines 10-15 completely uncovered).
            const fileCoverageData = {
                statementMap: {
                    "0": { start: { line: 2 }, end: { line: 7 } },
                    "1": { start: { line: 3 }, end: { line: 5 } },
                    "2": { start: { line: 4 }, end: { line: 4 } },
                    "3": { start: { line: 6 }, end: { line: 6 } },
                    "4": { start: { line: 10 }, end: { line: 15 } },
                    "5": { start: { line: 11 }, end: { line: 13 } },
                    "6": { start: { line: 12 }, end: { line: 12 } },
                    "7": { start: { line: 14 }, end: { line: 14 } }
                },
                s: {
                    "0": 1,
                    "1": 1,
                    "2": 1,
                    "3": 0, // line 6 uncovered (REGULAR return)
                    "4": 0, // line 10 uncovered
                    "5": 0, // line 11 uncovered
                    "6": 0, // line 12 uncovered
                    "7": 0  // line 14 uncovered
                },
                branchMap: {
                    "0": {
                        line: 3,
                        type: "if",
                        locations: [
                            { start: { line: 3 }, end: { line: 5 } },
                            { start: { line: 5 }, end: { line: 7 } }
                        ]
                    },
                    "1": {
                        line: 11,
                        type: "if",
                        locations: [
                            { start: { line: 11 }, end: { line: 13 } },
                            { start: { line: 13 }, end: { line: 15 } }
                        ]
                    }
                },
                b: {
                    "0": [1, 0], // Branch 0: True path taken 1 time, False path missed (0)
                    "1": [0, 0]  // Branch 1: Entirely uncovered
                },
                fnMap: {
                    "0": { name: "evaluateUser", line: 2, loc: { start: { line: 2 }, end: { line: 7 } } },
                    "1": { name: "handleFailure", line: 10, loc: { start: { line: 10 }, end: { line: 15 } } }
                },
                f: {
                    "0": 1,
                    "1": 0 // handleFailure never called
                }
            };

            const gapReport = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData,
                sourceCode
            });

            // 1. Uncovered lines
            expect(gapReport.uncoveredLines).toContain(6);
            expect(gapReport.uncoveredLines).toContain(10);
            expect(gapReport.uncoveredLines).toContain(14);

            // 2. Uncovered branches
            expect(gapReport.uncoveredBranches).toHaveLength(2);
            const branch0 = gapReport.uncoveredBranches.find(b => b.branchId === "0");
            expect(branch0.missedTrue).toBe(false);
            expect(branch0.missedFalse).toBe(true);
            expect(branch0.status).toBe("partially_uncovered");

            const branch1 = gapReport.uncoveredBranches.find(b => b.branchId === "1");
            expect(branch1.missedTrue).toBe(true);
            expect(branch1.missedFalse).toBe(true);
            expect(branch1.status).toBe("entirely_uncovered");

            // 3. Uncovered functions
            expect(gapReport.uncoveredFunctions).toHaveLength(1);
            expect(gapReport.uncoveredFunctions[0].name).toBe("handleFailure");
            expect(gapReport.uncoveredFunctions[0].hits).toBe(0);

            // 4. Targeted Guidance Summary
            expect(gapReport.guidanceSummary).toContain("Line 3 [IF]");
            expect(gapReport.guidanceSummary).toContain("Missing FALSE path");
            expect(gapReport.guidanceSummary).toContain("Line 14 [THROW]");
            expect(gapReport.guidanceSummary).toContain("Exception path not triggered");
        });

        test("works seamlessly with formatted coverage array objects from fileCoverage.service", () => {
            const astMeta = {
                decisionPoints: [
                    { line: 5, type: "if", text: "if (x > 10)" }
                ],
                exceptionPoints: []
            };

            const formattedCoverage = {
                branches: [
                    {
                        id: "b-1",
                        line: 5,
                        type: "if",
                        status: "partially_covered",
                        paths: [
                            { type: "Branch 1", covered: true },
                            { type: "Branch 2", covered: false }
                        ]
                    }
                ],
                functions: [
                    { id: "f-1", line: 20, realName: "processJob", hits: 0, covered: false }
                ]
            };

            const report = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData: formattedCoverage,
                sourceCode: "if (x > 10) { return true; }",
                uncoveredLinesList: [6, 7]
            });

            expect(report.uncoveredBranches).toHaveLength(1);
            expect(report.uncoveredBranches[0].missedFalse).toBe(true);
            expect(report.uncoveredFunctions).toHaveLength(1);
            expect(report.uncoveredFunctions[0].name).toBe("processJob");
            expect(report.uncoveredLines).toEqual([6, 7]);
        });
    });
});
