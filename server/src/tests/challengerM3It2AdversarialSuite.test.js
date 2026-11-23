import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

process.env.PROJECT_STORAGE_DRIVER = "local";

// Services under test
const unitTestSuggestionModule = await import("../services/unitTestSuggestion.service.js");
const {
    suggestUnitTestcases,
    generateFallbackUnitTests
} = unitTestSuggestionModule;
const generateUnitTestBatch = unitTestSuggestionModule.generateUnitTestBatch || generateFallbackUnitTests;

const {
    buildIsolationMockContracts
} = await import("../services/unitTestContextEngineering.service.js");

const {
    healControllerFixturesWithAst
} = await import("../services/testSanitizer.service.js");

const {
    autoHealTestFailures
} = await import("../services/applyTestSuggestion.service.js");

describe("Empirical Challenger 1 - Milestone M3 Iteration 2 Adversarial Stress Suite", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-chal1-m3-it2-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // =========================================================================
    // Dimension 1: Adversarial Controller Destructuring & Parameter Extraction
    // =========================================================================
    describe("Dimension 1: Parameter Extraction & Destructuring with Default Values", () => {
        test("1.1 Extracts body keys when destructuring contains default assignments", () => {
            const controllerSource = `
                export const processOrder = async (req, res) => {
                    const { items = [], filter = 'all', limit = 50 } = req.body;
                    return res.json({ count: items.length, filter, limit });
                };
            `;

            const generated = generateUnitTestBatch({
                framework: "jest",
                sourceFile: "src/controllers/order.controller.js",
                baseName: "order.controller",
                sourceCode: controllerSource,
                existingContent: ""
            });

            const code = generated.fullUpdatedContent;

            // In Category A: items should be populated with an array fixture
            expect(code).toContain('"items": [');
            expect(code).toContain('"filter":');
            expect(code).toContain('"limit":');

            // In Category B (boundary): items should be empty array []
            expect(code).toContain('"items": []');

            // In Category D: req.body MUST NOT be null
            expect(code).not.toMatch(/\bbody:\s*null\b/);
            expect(code).toContain('body: {}');
        });

        test("1.2 Extracts body keys when destructuring combines property aliasing and default assignments", () => {
            const controllerSource = `
                export const updateCart = async (req, res) => {
                    const { items: cartItems = [], totalPaid: amount = 100 } = req.body;
                    return res.json({ count: cartItems.length, amount });
                };
            `;

            const generated = generateUnitTestBatch({
                framework: "jest",
                sourceFile: "src/controllers/cart.controller.js",
                baseName: "cart.controller",
                sourceCode: controllerSource,
                existingContent: ""
            });

            const code = generated.fullUpdatedContent;

            // items and totalPaid should be recognized as source keys
            expect(code).toContain('"items": [');
            expect(code).toContain('"totalPaid":');
            expect(code).toContain('"items": []');
        });

        test("1.3 Extracts query and params keys with default assignments", () => {
            const controllerSource = `
                export const searchItems = async (req, res) => {
                    const { page = 1, limit = 20, sort = 'desc' } = req.query;
                    const { categoryId = '0', regionId = 'us' } = req.params;
                    return res.json({ page, limit, sort, categoryId, regionId });
                };
            `;

            const generated = generateUnitTestBatch({
                framework: "jest",
                sourceFile: "src/controllers/search.controller.js",
                baseName: "search.controller",
                sourceCode: controllerSource,
                existingContent: ""
            });

            const code = generated.fullUpdatedContent;

            expect(code).toContain('"page":');
            expect(code).toContain('"limit":');
            expect(code).toContain('"categoryId":');
            expect(code).toContain('"regionId":');
        });

        test("1.4 Multiple and multi-line destructuring statements", () => {
            const controllerSource = `
                export const multiStep = async (req, res) => {
                    const {
                        items = [],
                        records = []
                    } = req.body;
                    const {
                        paymentIntentId,
                        totalCost = 0
                    } = req.body;
                    return res.json({ itemsCount: items.length, recordsCount: records.length, paymentIntentId, totalCost });
                };
            `;

            const generated = generateUnitTestBatch({
                framework: "jest",
                sourceFile: "src/controllers/multiStep.controller.js",
                baseName: "multiStep.controller",
                sourceCode: controllerSource,
                existingContent: ""
            });

            const code = generated.fullUpdatedContent;

            expect(code).toContain('"items": [');
            expect(code).toContain('"records": [');
            expect(code).toContain('"items": []');
            expect(code).toContain('"records": []');
            expect(code).not.toMatch(/\bbody:\s*null\b/);
        });
    });

    // =========================================================================
    // Dimension 2: Category D Strict Non-Null Guarantee Across All Paradigms
    // =========================================================================
    describe("Dimension 2: Category D Strict Invariant Checks", () => {
        const paradigms = [
            {
                name: "Async arrow controller with destructuring",
                source: "export const act = async (req, res) => { const { items } = req.body; return res.json(items.length); };"
            },
            {
                name: "Sync traditional function controller",
                source: "export function handle(req, res, next) { return res.send(req.body.name); }"
            },
            {
                name: "CommonJS module.exports object",
                source: "module.exports = { execute: async (req, res) => { const { list = [] } = req.body; res.json(list); } };"
            },
            {
                name: "Class method controller",
                source: "export class OrderController { static async checkout(req, res) { const { items } = req.body; return res.json(items); } }"
            },
            {
                name: "Empty / minimal ping controller",
                source: "export const ping = (req, res) => res.json({ status: 'ok' });"
            },
            {
                name: "Controller with multiple exported action methods",
                source: `
                    export const getItems = (req, res) => res.json([]);
                    export const createItem = (req, res) => { const { items, id } = req.body; return res.json({ id }); };
                    export const deleteItem = (req, res) => res.json({ deleted: true });
                `
            }
        ];

        paradigms.forEach(({ name, source }) => {
            test(`2.1 Invariant holds for: ${name}`, () => {
                const generated = generateUnitTestBatch({
                    framework: "jest",
                    sourceFile: "src/controllers/paradigmController.js",
                    baseName: "paradigmController",
                    sourceCode: source,
                    existingContent: ""
                });

                const code = generated.fullUpdatedContent;

                // Category D presence check
                expect(code).toContain("[Category D: Error Handling]");

                // 1. Strictly NO body: null
                expect(code).not.toMatch(/\bbody:\s*null\b/);
                // 2. Strictly NO { body: null }
                expect(code).not.toMatch(/\{\s*body:\s*null\s*\}/);
                // 3. Category D MUST provision body: {}
                expect(code).toMatch(/body:\s*\{\s*\}/);
            });
        });
    });

    // =========================================================================
    // Dimension 3: Empirical Execution Oracles (Executing Handlers with Payloads)
    // =========================================================================
    describe("Dimension 3: Empirical Controller Execution Harness", () => {
        const createMockRes = () => {
            const res = {};
            res.status = jest.fn().mockReturnValue(res);
            res.json = jest.fn().mockReturnValue(res);
            res.send = jest.fn().mockReturnValue(res);
            res.cookie = jest.fn().mockReturnValue(res);
            res.clearCookie = jest.fn().mockReturnValue(res);
            res.setHeader = jest.fn().mockReturnValue(res);
            res.sendStatus = jest.fn().mockReturnValue(res);
            return res;
        };

        test("3.1 Unguarded items.map executes cleanly with Category A and Category B payloads", async () => {
            // A controller that does NOT check if items is null/undefined before calling .map
            const controller = async (req, res) => {
                const { items, paymentIntentId, totalPaid } = req.body;
                const mapped = items.map(i => ({ id: i.id, double: (i.id || 0) * 2 }));
                return res.status(200).json({ count: mapped.length, mapped, paymentIntentId, totalPaid });
            };

            // Category A payload
            const reqA = {
                body: { items: [{ id: 10, name: "Sample" }], paymentIntentId: "pi_123", totalPaid: 100 }
            };
            const resA = createMockRes();
            await expect(controller(reqA, resA)).resolves.not.toThrow();
            expect(resA.status).toHaveBeenCalledWith(200);
            expect(resA.json).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));

            // Category B payload (boundary: empty items array)
            const reqB = {
                body: { items: [], paymentIntentId: "0", totalPaid: 0 }
            };
            const resB = createMockRes();
            await expect(controller(reqB, resB)).resolves.not.toThrow();
            expect(resB.status).toHaveBeenCalledWith(200);
            expect(resB.json).toHaveBeenCalledWith(expect.objectContaining({ count: 0, mapped: [] }));
        });

        test("3.2 Destructuring req.body under Category D does not throw TypeError: Cannot destructure property ... as it is null", async () => {
            const controllerWithDestructuring = async (req, res) => {
                // If req.body is null, this throws verbatim:
                // TypeError: Cannot destructure property 'items' of 'req.body' as it is null.
                const { items, totalPaid, user } = req.body;
                if (!items) {
                    return res.status(400).json({ error: "Missing items" });
                }
                return res.json({ count: items.length });
            };

            // Category D payload: body: {}
            const reqD = { body: {}, query: {}, params: {}, headers: {}, file: null, user: null };
            const resD = createMockRes();

            await expect(controllerWithDestructuring(reqD, resD)).resolves.not.toThrow();
            expect(resD.status).toHaveBeenCalledWith(400);
            expect(resD.json).toHaveBeenCalledWith({ error: "Missing items" });
        });

        test("3.3 Controller with default destructuring { items = [] } runs cleanly even under Category D", async () => {
            const controllerWithDefault = async (req, res) => {
                const { items = [], total = 0 } = req.body;
                const mapped = items.map(x => x.id);
                return res.status(200).json({ count: mapped.length, total });
            };

            // Category D payload: body: {}
            const reqD = { body: {}, query: {}, params: {}, headers: {}, file: null, user: null };
            const resD = createMockRes();

            await expect(controllerWithDefault(reqD, resD)).resolves.not.toThrow();
            expect(resD.status).toHaveBeenCalledWith(200);
            expect(resD.json).toHaveBeenCalledWith({ count: 0, total: 0 });
        });
    });

    // =========================================================================
    // Dimension 4: Diagnostic Healing & autoHealTestFailures with fullPath
    // =========================================================================
    describe("Dimension 4: Diagnostic Healing & autoHealTestFailures Validation", () => {
        test("4.1 autoHealTestFailures executes without ReferenceError and heals fixtures", () => {
            const testFilePath = path.join(tempDir, "sample.controller.test.js");
            const testCodeWithNull = `
                describe("OrderController", () => {
                    it("should fail gracefully when body is null", async () => {
                        req.body = null;
                        await checkout(req, res);
                    });
                });
            `;
            fs.writeFileSync(testFilePath, testCodeWithNull, "utf8");

            const rawOutput = "TypeError: Cannot destructure property 'items' of 'req.body' as it is null.";

            let caughtError = null;
            let result = false;
            try {
                result = autoHealTestFailures(tempDir, [testFilePath], null, rawOutput);
            } catch (err) {
                caughtError = err;
            }

            expect(caughtError).toBeNull();
            expect(result).toBe(true);

            const modifiedContent = fs.readFileSync(testFilePath, "utf8");
            expect(modifiedContent).not.toContain("req.body = null");
            expect(modifiedContent).toContain("req.body = {}");
            expect(modifiedContent).toContain("beforeEach(() => {");
        });

        test("4.2 autoHealTestFailures intercepts reading 'items' error and heals fixtures", () => {
            const testFilePath = path.join(tempDir, "items.controller.test.js");
            const testCodeWithNull = `
                describe("ItemsController", () => {
                    it("should handle empty cart", async () => {
                        const customReq = { body: null };
                        await getItems(customReq, res);
                    });
                });
            `;
            fs.writeFileSync(testFilePath, testCodeWithNull, "utf8");

            const rawOutput = "TypeError: Cannot read properties of null (reading 'items')";

            let caughtError = null;
            let result = false;
            try {
                result = autoHealTestFailures(tempDir, [testFilePath], null, rawOutput);
            } catch (err) {
                caughtError = err;
            }

            expect(caughtError).toBeNull();
            expect(result).toBe(true);

            const modifiedContent = fs.readFileSync(testFilePath, "utf8");
            expect(modifiedContent).not.toContain("body: null");
            expect(modifiedContent).toContain("body: {}");
        });
    });

    // =========================================================================
    // Dimension 5: AST Fixture Sanitizer (healControllerFixturesWithAst)
    // =========================================================================
    describe("Dimension 5: healControllerFixturesWithAst Deep Edge Cases", () => {
        test("5.1 Rewrites req.body = undefined to req.body = {}", () => {
            const code = `
                describe("TestController", () => {
                    it("assigns undefined", async () => {
                        req.body = undefined;
                        await doSomething(req, res);
                    });
                });
            `;
            const healed = healControllerFixturesWithAst(code, "src/controllers/test.controller.js");
            expect(healed).not.toContain("req.body = undefined");
            expect(healed).toContain("req.body = {}");
        });

        test("5.2 Preserves pre-existing beforeEach and safely appends missing req/res", () => {
            const code = `
                describe("ExistingBeforeEachController", () => {
                    beforeEach(() => {
                        jest.clearAllMocks();
                    });
                    it("tests handler", async () => {
                        await doSomething(req, res);
                    });
                });
            `;
            const healed = healControllerFixturesWithAst(code, "src/controllers/test.controller.js");
            expect(healed).toContain("jest.clearAllMocks();");
            expect(healed).toContain("req = { body: {}, params: {}, query: {}, headers: {}, file: null");
            expect(healed).toContain("res = {");
            expect(healed).toContain("next =");
        });

        test("5.3 Multi-level nested describe blocks receive outer beforeEach", () => {
            const code = `
                describe("OuterController", () => {
                    describe("InnerActions", () => {
                        it("performs sub-action", async () => {
                            await action(req, res);
                        });
                    });
                });
            `;
            const healed = healControllerFixturesWithAst(code, "src/controllers/nested.controller.js");
            expect(healed).toContain("beforeEach(() => {");
            expect(healed).toContain("req = { body: {}, params: {}, query: {}, headers: {}, file: null");
        });
    });

    // =========================================================================
    // Dimension 6: Controller Mock Contract & Response Chaining in Preamble
    // =========================================================================
    describe("Dimension 6: Controller Mock Contract & Response Chaining", () => {
        test("6.1 createMockReqResNext supports full method chaining and safe body fallback", () => {
            const preambleResult = buildIsolationMockContracts({
                sourceCode: "export const handler = async (req, res, next) => res.status(200).json({});",
                framework: "jest"
            });

            expect(preambleResult.detectedDependencies).toContain("express-controller");
            expect(preambleResult.mockPreambleCode).toContain("createMockReqResNext");

            const factory = new Function("jest", `
                ${preambleResult.mockPreambleCode};
                return createMockReqResNext;
            `);
            const createMock = factory(jest);

            // Test 1: Full chained response
            const { req, res, next } = createMock();
            const chained = res
                .status(200)
                .cookie("token", "xyz")
                .clearCookie("old")
                .setHeader("Content-Type", "application/json")
                .json({ ok: true });

            expect(chained).toBe(res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.cookie).toHaveBeenCalledWith("token", "xyz");
            expect(res.clearCookie).toHaveBeenCalledWith("old");
            expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
            expect(res.json).toHaveBeenCalledWith({ ok: true });

            // Test 2: Safe body defaults
            expect(req.body).toEqual({ items: [] });

            // Test 3: Null body override
            const nullOverride = createMock({ body: null });
            expect(nullOverride.req.body).toEqual({ items: [] });

            // Test 4: Custom body override preserves items default if not provided
            const customOverride = createMock({ body: { name: "test" } });
            expect(customOverride.req.body).toEqual({ items: [], name: "test" });
        });
    });
});
