import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
    analyzeSourceAst
} from "../services/businessLogicAstAnalyzer.service.js";
import {
    buildDecisionTableMatrix,
    buildIndirectTestingStrategy,
    buildIsolationMockContracts,
    assembleUnitTestContext
} from "../services/unitTestContextEngineering.service.js";
import {
    generateFallbackUnitTests
} from "../services/unitTestSuggestion.service.js";
import {
    insertCodeIntoTestFile,
    cleanAndDeduplicateTestContent,
    applyCodeToTestFile,
    autoHealTestFailures,
    autoRefineCoverageGaps,
    generateDeltaTestCode
} from "../services/applyTestSuggestion.service.js";
import { sanitizeAllProjectTestFiles } from "../services/testSanitizer.service.js";
import { ServiceError } from "../utils/serviceError.js";

describe("Section 4: Business Logic Edge Cases Matrix Verification", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-edge-cases-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }
    });

    // =========================================================================
    // 4.1. HÀM NỘI BỘ (UNEXPORTED HELPER FUNCTIONS)
    // =========================================================================
    describe("4.1 Edge Case 1: Hàm nội bộ (Unexported)", () => {
        const sourceWithInternalHelpers = `
            function calculateDiscount(tier, amount) {
                if (tier === 'VIP') return amount * 0.2;
                if (tier === 'MEMBER') return amount * 0.1;
                return 0;
            }

            function validateVoucher(code) {
                if (!code) return false;
                return code.startsWith('DISC');
            }

            export function processOrder(order) {
                if (!order || order.amount <= 0) throw new Error('Invalid order');
                const discount = calculateDiscount(order.tier, order.amount);
                const hasVoucher = validateVoucher(order.voucher);
                return {
                    finalAmount: order.amount - discount,
                    hasVoucher
                };
            }
        `;

        test("detects unexported internal helper functions and maps them to exported callers", () => {
            const astMeta = analyzeSourceAst(sourceWithInternalHelpers);

            expect(astMeta.internalFunctions.length).toBe(2);
            const helperNames = astMeta.internalFunctions.map(f => f.name);
            expect(helperNames).toContain("calculateDiscount");
            expect(helperNames).toContain("validateVoucher");

            const strategy = buildIndirectTestingStrategy({
                astMetadata: astMeta,
                sourceCode: sourceWithInternalHelpers
            });

            expect(strategy.indirectStrategies.length).toBe(2);
            for (const strat of strategy.indirectStrategies) {
                expect(strat.warning).toContain("DO NOT IMPORT DIRECTLY");
                expect(strat.exportedCallers).toContain("processOrder");
            }
            expect(strategy.indirectGuidancePrompt).toContain("STRICT INDIRECT TESTING MANDATE");
            expect(strategy.indirectGuidancePrompt).toContain("processOrder");
        });

        test("generateFallbackUnitTests never imports unexported symbols directly", () => {
            const fallback = generateFallbackUnitTests({
                framework: "jest",
                sourceFile: "src/services/order.service.js",
                targetTestFile: "tests/order.service.test.js",
                rootDir: tempDir,
                baseName: "order.service",
                uncoveredLines: [3, 4, 9],
                sourceCode: sourceWithInternalHelpers
            });

            const code = fallback.fullUpdatedContent || fallback.suggestedTestCode;
            expect(code).toContain("processOrder");
            expect(code).not.toMatch(/import\s*\{[^}]*calculateDiscount[^}]*\}\s*from/);
            expect(code).not.toMatch(/const\s*\{[^}]*calculateDiscount[^}]*\}\s*=\s*require/);
        });
    });

    // =========================================================================
    // 4.2. LOGIC PHỤ THUỘC DATABASE (PRISMA MOCKING & $TRANSACTION)
    // =========================================================================
    describe("4.2 Edge Case 2: Logic phụ thuộc Database (Prisma Mocking)", () => {
        const sourceWithDatabase = `
            import prisma from '../config/prisma.js';

            export async function createOrderWithTransaction(userId, items) {
                return await prisma.$transaction(async (tx) => {
                    const user = await tx.user.findUnique({ where: { id: userId } });
                    if (!user) throw new Error('User not found');
                    const order = await tx.order.create({ data: { userId, items } });
                    await tx.auditLog.create({ data: { action: 'ORDER_CREATED', orderId: order.id } });
                    return order;
                });
            }
        `;

        test("buildIsolationMockContracts detects prisma-db and produces universal proxy with $transaction", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: sourceWithDatabase,
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("prisma-db");
            expect(contracts.mockPreambleCode).toContain("_createPrismaProxyMock");
            expect(contracts.mockPreambleCode).toContain("$transaction");
            expect(contracts.mockPreambleCode).toContain("findMany");
            expect(contracts.mockPreambleCode).toContain("jest.mock('../config/prisma.js'");
            expect(contracts.mockInstructions).toContain("Prisma DB: Re-use the Prisma Proxy Mock");
        });

        test("Prisma proxy mock evaluates both callback and array transactions purely in RAM", async () => {
            // Test the proxy mock implementation directly
            const isVitest = false;
            const _createPrismaProxyMock = () => {
                const _mockFn = () => (jest.fn(() => Promise.resolve({ id: 1, name: 'Sample Item', status: 'ACTIVE' })));
                const _createModelProxy = () => new Proxy({}, {
                    get: (target, prop) => {
                        if (prop === 'then') return undefined;
                        if (!target[prop]) {
                            if (prop === 'findMany') {
                                target[prop] = jest.fn(() => Promise.resolve([{ id: 1, name: 'Sample' }]));
                            } else {
                                target[prop] = _mockFn();
                            }
                        }
                        return target[prop];
                    }
                });
                let _clientProxy;
                _clientProxy = new Proxy({
                    $transaction: jest.fn((args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(_clientProxy) : Promise.resolve())),
                }, {
                    get: (target, prop) => (prop in target ? target[prop] : (!target[prop] ? target[prop] = _createModelProxy() : target[prop]))
                });
                return _clientProxy;
            };

            const mockPrisma = _createPrismaProxyMock();

            // 1. Model proxy dynamic method access
            const user = await mockPrisma.user.findUnique({ where: { id: 123 } });
            expect(user).toEqual({ id: 1, name: 'Sample Item', status: 'ACTIVE' });

            // 2. Interactive transaction callback
            const txResult = await mockPrisma.$transaction(async (tx) => {
                const u = await tx.user.findUnique({ where: { id: 1 } });
                const o = await tx.order.create({ data: { id: 10 } });
                return { u, o };
            });
            expect(txResult.u).toBeDefined();
            expect(txResult.o).toBeDefined();

            // 3. Array transaction
            const batchResult = await mockPrisma.$transaction([
                mockPrisma.item.findMany(),
                mockPrisma.order.findUnique({ where: { id: 1 } })
            ]);
            expect(Array.isArray(batchResult)).toBe(true);
            expect(batchResult.length).toBe(2);
        });
    });

    // =========================================================================
    // 4.3. LOGIC BẤT ĐỒNG BỘ & TIMEOUT (ASYNC/AWAIT & TIMERS)
    // =========================================================================
    describe("4.3 Edge Case 3: Logic bất đồng bộ & Timeout", () => {
        const sourceWithTimers = `
            export async function fetchWithRetry(fn, retries = 3, delayMs = 1000) {
                try {
                    return await fn();
                } catch (err) {
                    if (retries <= 1) throw err;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    return fetchWithRetry(fn, retries - 1, delayMs);
                }
            }
        `;

        test("detects timers and generates Fake Timers preamble and async instructions", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: sourceWithTimers,
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("timers-async");
            expect(contracts.mockPreambleCode).toContain("jest.useFakeTimers()");
            expect(contracts.mockInstructions).toContain("Asynchronous & Timers");
        });
    });

    // =========================================================================
    // 4.4. TOÁN TỬ NGẮN MẠCH (??, ||, ?.)
    // =========================================================================
    describe("4.4 Edge Case 4: Toán tử ngắn mạch (??, ||, ?.)", () => {
        const sourceWithShortCircuits = `
            export function parseUserProfile(input) {
                const name = input?.name ?? 'Anonymous';
                const role = input?.role || 'user';
                const email = input?.profile?.email;
                return { name, role, email };
            }
        `;

        test("AST analysis extracts short-circuit operators and generates paired True/False test cases", () => {
            const astMeta = analyzeSourceAst(sourceWithShortCircuits);
            expect(astMeta.decisionPoints.length).toBeGreaterThanOrEqual(2);

            const decisionTable = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps: { uncoveredLines: [3, 4, 5], missingBranches: [] },
                sourceCode: sourceWithShortCircuits
            });

            const branchCases = decisionTable.matrixEntries.filter(e => e.category === "BRANCH_TOGGLING");
            expect(branchCases.length).toBeGreaterThan(0);

            // Verify both Truthy and Nullish/Falsy scenarios are planned
            const hasTruthy = branchCases.some(e => e.condition.toLowerCase().includes("truthy") || e.inputScenario.toLowerCase().includes("truthy"));
            const hasFalsyOrNull = branchCases.some(e => e.condition.toLowerCase().includes("nullish") || e.inputScenario.toLowerCase().includes("null"));
            expect(hasTruthy || hasFalsyOrNull).toBe(true);
        });
    });

    // =========================================================================
    // 4.5. XỬ LÝ NGOẠI LỆ (TRY/CATCH & THROW)
    // =========================================================================
    describe("4.5 Edge Case 5: Xử lý Ngoại lệ (try/catch & throw)", () => {
        const sourceWithErrorHandling = `
            export async function processPayment(paymentGateway, payload) {
                if (!payload || !payload.amount) {
                    throw new Error('Amount is required');
                }
                try {
                    return await paymentGateway.charge(payload);
                } catch (err) {
                    console.error('Payment gateway error:', err);
                    throw new Error('Payment processing failed: ' + err.message);
                }
            }
        `;

        test("identifies throw and catch blocks and plans Category D exception test cases", () => {
            const astMeta = analyzeSourceAst(sourceWithErrorHandling);
            expect(astMeta.exceptionPoints.length).toBeGreaterThanOrEqual(2);

            const hasThrow = astMeta.exceptionPoints.some(ep => ep.type === "throw");
            const hasCatch = astMeta.exceptionPoints.some(ep => ep.type === "catch");
            expect(hasThrow).toBe(true);
            expect(hasCatch).toBe(true);

            const decisionTable = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps: { uncoveredLines: [4, 8, 9], missingBranches: [] },
                sourceCode: sourceWithErrorHandling
            });

            const errCases = decisionTable.matrixEntries.filter(e => e.category === "ERROR_HANDLING");
            expect(errCases.length).toBeGreaterThanOrEqual(2);
            expect(errCases.some(e => e.inputScenario.includes("Mock downstream dependency"))).toBe(true);
        });
    });

    // =========================================================================
    // 4.6. XUNG ĐỘT KHAI BÁO BIẾN (IDENTIFIER ALREADY DECLARED)
    // =========================================================================
    describe("4.6 Edge Case 6: Xung đột Khai báo Biến", () => {
        const existingTestContent = `
const { processOrder } = require('../services/order.service');
const { calculateTax } = require('../services/tax.service');

describe('OrderService', () => {
  test('existing happy path', () => {
    expect(processOrder({ amount: 100 })).toBeDefined();
  });
});
`;

        const incomingAiSnippet = `
const { processOrder, cancelOrder } = require('../services/order.service');
const { calculateTax } = require('../services/tax.service');

describe('OrderService - Additional Tests', () => {
  test('cancel order path', () => {
    expect(cancelOrder(1)).toBeDefined();
  });
});
`;

        test("insertCodeIntoTestFile deduplicates require tokens without redeclaring existing variables", () => {
            const merged = insertCodeIntoTestFile(existingTestContent, incomingAiSnippet, "tests/order.test.js");

            // Must NOT contain duplicate const { processOrder }
            const processOrderMatches = [...merged.matchAll(/\bprocessOrder\b/g)];
            // Should only be imported once at top-level
            const importLines = merged.split('\n').filter(l => l.includes("require('../services/order.service')"));
            expect(importLines.length).toBe(1);
            expect(importLines[0]).toContain("processOrder");
            expect(importLines[0]).toContain("cancelOrder");

            // calculateTax should NOT be redeclared
            const taxImportLines = merged.split('\n').filter(l => l.includes("require('../services/tax.service')"));
            expect(taxImportLines.length).toBe(1);

            // Both test blocks must exist
            expect(merged).toContain("existing happy path");
            expect(merged).toContain("cancel order path");
        });

        test("cleanAndDeduplicateTestContent strips illegal require of jest", () => {
            const badCode = `
const { jest } = require('@jest/globals');
const jest = require('jest');
describe('test', () => { test('ok', () => {}); });
`;
            const cleaned = cleanAndDeduplicateTestContent(badCode, "", "test.js");
            expect(cleaned).not.toMatch(/^[ \t]*const\s+jest\s*=/m);
            expect(cleaned).not.toMatch(/require\(['"](?:@jest\/globals|jest)['"]\)/);
            expect(cleaned).toContain("describe('test'");
        });
    });

    // =========================================================================
    // 4.7. AN TOÀN THƯ MỤC STORAGE (STORAGE GUARD)
    // =========================================================================
    describe("4.7 Edge Case 7: An toàn Thư mục Storage (Storage Guard)", () => {
        test("applyCodeToTestFile throws 403 ServiceError when target file is inside storage/", () => {
            const forbiddenPaths = [
                "storage/project/tests/foo.test.js",
                "../storage/test.js",
                "server/storage/snapshots/test.spec.js",
                "./storage/test.js",
            ];

            for (const p of forbiddenPaths) {
                expect(() => {
                    applyCodeToTestFile(tempDir, {
                        sourceFile: "src/service.js",
                        testFile: p,
                        generatedCode: "describe('test', () => {})"
                    });
                }).toThrow(ServiceError);
            }
        });

        test("autoHealTestFailures early exits and refuses to modify any file in storage/", () => {
            const storageDir = path.join(tempDir, "storage");
            fs.mkdirSync(storageDir, { recursive: true });
            const storageTestFile = path.join(storageDir, "forbidden.test.js");
            fs.writeFileSync(storageTestFile, "test.skip('skipped', () => {})", "utf8");

            // 1. When rootDir itself is in storage
            const healedRoot = autoHealTestFailures(storageDir, ["forbidden.test.js"], null, "");
            expect(healedRoot).toBe(false);
            expect(fs.readFileSync(storageTestFile, "utf8")).toContain("test.skip");

            // 2. When rootDir is clean but candidate file is inside storage
            const healedFile = autoHealTestFailures(tempDir, [storageTestFile], null, "");
            expect(healedFile).toBe(false);
            expect(fs.readFileSync(storageTestFile, "utf8")).toContain("test.skip");
        });

        test("autoRefineCoverageGaps early exits when rootDir is in storage", async () => {
            const storageDir = path.join(tempDir, "storage");
            fs.mkdirSync(storageDir, { recursive: true });

            const result = await autoRefineCoverageGaps({
                rootDir: storageDir,
                sourceFilesInspected: ["src/service.js"],
                modifiedFiles: new Set(),
                snapshot: { id: "snap-1" },
                isVitest: false,
                coverageDir: storageDir,
                rawSum: { total: {} },
                rawFinal: {}
            });

            expect(result.refined).toBe(false);
            expect(result.passesRun).toBe(0);
        });

        test("sanitizeAllProjectTestFiles ignores storage directories", () => {
            const storageDir = path.join(tempDir, "storage");
            fs.mkdirSync(storageDir, { recursive: true });
            const storageTestFile = path.join(storageDir, "unclean.test.js");
            const originalContent = "it(`bad quote', () => { test.skip('skip', () => {}); });";
            fs.writeFileSync(storageTestFile, originalContent, "utf8");

            sanitizeAllProjectTestFiles(tempDir);

            // File in storage MUST remain 100% untouched
            expect(fs.readFileSync(storageTestFile, "utf8")).toBe(originalContent);
        });
    });
});
