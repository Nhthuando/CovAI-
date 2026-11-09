import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

process.env.PROJECT_STORAGE_DRIVER = "local";

const { autoHealTestFailures } = await import("../services/applyTestSuggestion.service.js");
const { healControllerFixturesWithAst } = await import("../services/testSanitizer.service.js");
const { parseJavaScriptCode } = await import("../services/babelParser.service.js");

describe("Empirical Challenger 2: Diagnostic Error Healing & AST Controller Fixtures", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-chal2-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // -------------------------------------------------------------------------
    // Dimension 1: Diagnostic Error Interception in applyTestSuggestion.service.js
    // -------------------------------------------------------------------------
    describe("Task 1: Diagnostic Error Interception in applyTestSuggestion.service.js", () => {
        test("1.1 Diagnostic Error Interception: autoHealTestFailures executes without ReferenceError and heals fixtures on null req.body destructuring", () => {
            const testFile = path.join(tempDir, "cart.controller.test.js");
            fs.writeFileSync(testFile, `
describe("cartController", () => {
    it("should checkout items", async () => {
        req.body = null;
        await checkout(req, res);
    });
});
            `, "utf8");

            const rawOutput = "TypeError: Cannot destructure property 'items' of 'req.body' as it is null.";

            let caughtError = null;
            let result = false;
            try {
                result = autoHealTestFailures(tempDir, [testFile], null, rawOutput);
            } catch (err) {
                caughtError = err;
            }

            expect(caughtError).toBeNull();
            expect(result).toBe(true);
            const healed = fs.readFileSync(testFile, "utf8");
            expect(healed).not.toContain("req.body = null;");
            expect(healed).toContain("req.body = {};");
            expect(healed).toContain("beforeEach(() => {");
            expect(parseJavaScriptCode(healed).success).toBe(true);
        });

        test("1.2 Diagnostic Error Interception: autoHealTestFailures executes without ReferenceError and heals fixtures on reading 'items' error", () => {
            const testFile = path.join(tempDir, "order.controller.test.js");
            fs.writeFileSync(testFile, `
describe("orderController", () => {
    it("should process order items", async () => {
        req.body = null;
        await processOrder(req, res);
    });
});
            `, "utf8");

            const rawOutput = "TypeError: Cannot read properties of undefined (reading 'items')";

            let caughtError = null;
            let result = false;
            try {
                result = autoHealTestFailures(tempDir, [testFile], null, rawOutput);
            } catch (err) {
                caughtError = err;
            }

            expect(caughtError).toBeNull();
            expect(result).toBe(true);
            const healed = fs.readFileSync(testFile, "utf8");
            expect(healed).not.toContain("req.body = null;");
            expect(healed).toContain("req.body = {};");
            expect(healed).toContain("beforeEach(() => {");
            expect(parseJavaScriptCode(healed).success).toBe(true);
        });

        test("1.3 Specification Requirement: Diagnostic healing triggers healControllerFixturesWithAst (requires fullPath fix)", () => {
            const testFile = path.join(tempDir, "cart.controller.test.js");
            const initialCode = `
describe("cartController", () => {
    it("should checkout items", async () => {
        req.body = null;
        await checkout(req, res);
    });
});
            `;
            fs.writeFileSync(testFile, initialCode, "utf8");

            // When healControllerFixturesWithAst is called directly with fullPath, it successfully repairs the file
            const healedDirectly = healControllerFixturesWithAst(initialCode, testFile);
            expect(healedDirectly).not.toContain("req.body = null;");
            expect(healedDirectly).toContain("req.body = {};");
            expect(healedDirectly).toContain("beforeEach(() => {");
            expect(parseJavaScriptCode(healedDirectly).success).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Dimension 2: healControllerFixturesWithAst direct verification
    // -------------------------------------------------------------------------
    describe("Task 2: healControllerFixturesWithAst AST repair functionality", () => {
        test("2.1 Repairs missing fixtures in standalone describe block with req usage", () => {
            const code = `
describe("authController", () => {
    it("should login", async () => {
        req.body = { email: "user@example.com", password: "secret" };
        await login(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
            `;

            const healed = healControllerFixturesWithAst(code, "src/controllers/authController.test.js");
            expect(healed).toContain("beforeEach(() => {");
            expect(healed).toContain("req = { body: {}, params: {}, query: {}, headers: {}");
            expect(healed).toContain("res = {");
            expect(healed).toContain("status:");
            expect(healed).toContain("json:");
            expect(healed).toContain("next =");
            expect(parseJavaScriptCode(healed).success).toBe(true);
        });

        test("2.2 Repairs rogue req.body = null assignments into req.body = {}", () => {
            const code = `
describe("productController", () => {
    it("should handle null body error branch", async () => {
        req.body = null;
        await createProduct(req, res, next);
    });
});
            `;

            const healed = healControllerFixturesWithAst(code, "src/controllers/productController.test.js");
            expect(healed).not.toContain("req.body = null;");
            expect(healed).toContain("req.body = {};");
            expect(parseJavaScriptCode(healed).success).toBe(true);
        });

        test("2.3 Repairs rogue req.body = undefined assignments into req.body = {}", () => {
            const code = `
describe("productController", () => {
    it("should handle undefined body error branch", async () => {
        req.body = undefined;
        await createProduct(req, res, next);
    });
});
            `;

            const healed = healControllerFixturesWithAst(code, "src/controllers/productController.test.js");
            expect(healed).not.toContain("req.body = undefined;");
            expect(healed).toContain("req.body = {};");
            expect(parseJavaScriptCode(healed).success).toBe(true);
        });

        test("2.4 Repairs rogue object literals with body: null, query: null, params: null", () => {
            const code = `
describe("checkoutController", () => {
    it("handles null payloads", async () => {
        const callerRef = checkout;
        await callerRef({ body: null, query: null, params: null }, res, next);
    });
});
            `;

            const healed = healControllerFixturesWithAst(code, "src/controllers/checkoutController.test.js");
            expect(healed).not.toContain("body: null");
            expect(healed).toContain("body: {}");
            expect(healed).toContain("query: {}");
            expect(healed).toContain("params: {}");
            expect(parseJavaScriptCode(healed).success).toBe(true);
        });

        test("2.5 Top-level sibling describe blocks: heals only the block lacking fixtures", () => {
            const code = `
describe("suite with fixtures", () => {
    beforeEach(() => {
        req = { body: { items: [1] } };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });
    it("works with fixtures", async () => {
        await checkout(req, res);
    });
});

describe("suite WITHOUT fixtures", () => {
    it("uses req without setup", async () => {
        req.body = { items: [2] };
        await checkout(req, res);
    });
});
            `;

            const healed = healControllerFixturesWithAst(code, "src/controllers/cartController.test.js");
            expect(parseJavaScriptCode(healed).success).toBe(true);
            const countBeforeEach = (healed.match(/beforeEach/g) || []).length;
            expect(countBeforeEach).toBe(2);
        });

        test("2.6 Nested describe blocks: outer describe receives fixture when child tests use req", () => {
            const code = `
describe("cartController suite", () => {
    describe("suite with fixtures", () => {
        beforeEach(() => {
            req = { body: { items: [1] } };
            res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        });
        it("works with fixtures", async () => {
            await checkout(req, res);
        });
    });

    describe("suite WITHOUT fixtures", () => {
        it("uses req without setup", async () => {
            req.body = { items: [2] };
            await checkout(req, res);
        });
    });
});
            `;

            const healed = healControllerFixturesWithAst(code, "src/controllers/cartController.test.js");
            expect(parseJavaScriptCode(healed).success).toBe(true);
            const countBeforeEach = (healed.match(/beforeEach/g) || []).length;
            expect(countBeforeEach).toBe(3);
        });

        test("2.7 Non-controller context or file without req is not mutated", () => {
            const code = `
describe("mathUtils", () => {
    it("adds numbers", () => {
        expect(1 + 1).toBe(2);
    });
});
            `;

            const healed = healControllerFixturesWithAst(code, "src/utils/mathUtils.test.js");
            expect(healed).toBe(code);
        });
    });
});
