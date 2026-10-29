import {
    harvestBranchConditions,
    extractDatabaseSchemaConstraints,
    harvestApiDeepContext,
    buildIntegrationTestPrompt,
    validateIntegrationTestCode,
    buildFaultyTestFixPrompt,
} from "../services/integrationAiTestGenerator.service.js";

describe("Phase 2: Integration AI Test Generator (Cold-Start & Booster LLM)", () => {
    describe("Task 2.1: Deep Context Harvesting & Branch Analysis", () => {
        const sampleController = `
export const createOrder = async (req, res) => {
    const { items, total } = req.body;
    if (!items || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }
    if (!req.headers.authorization) {
        return res.status(401).json({ error: "Unauthorized token" });
    }
    const order = await db.orders.create({ data: { items, total } });
    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }
    return res.status(201).json(order);
};
`;

        test("should harvest branch conditions and classify them into validation, auth, and not-found tiers", () => {
            const branches = harvestBranchConditions(sampleController);

            expect(branches.length).toBeGreaterThanOrEqual(2);

            const validationBranch = branches.find((b) => b.category === "VALIDATION_CHECK" || b.suggestedStatus === 400);
            expect(validationBranch).toBeDefined();

            const authBranch = branches.find((b) => b.category === "AUTH_OR_PERMISSION" || b.suggestedStatus === 401);
            expect(authBranch).toBeDefined();
            expect(authBranch.suggestedStatus).toBe(401);

            const notFoundBranch = branches.find((b) => b.category === "RESOURCE_NOT_FOUND" || b.suggestedStatus === 404);
            expect(notFoundBranch).toBeDefined();
            expect(notFoundBranch.suggestedStatus).toBe(404);
        });

        test("should extract database schema models and non-nullable required fields", () => {
            const prismaSource = [
                {
                    path: "prisma/schema.prisma",
                    content: `
model Order {
  id        String   @id @default(cuid())
  userId    String
  total     Float
  status    String   @default("PENDING")
  note      String?
  createdAt DateTime @default(now())
}
`,
                },
            ];

            const models = extractDatabaseSchemaConstraints(prismaSource);
            expect(models).toHaveLength(1);
            expect(models[0].modelName).toBe("Order");

            const reqFieldNames = models[0].requiredFields.map((f) => f.name);
            expect(reqFieldNames).toContain("userId");
            expect(reqFieldNames).toContain("total");
            expect(reqFieldNames).not.toContain("status"); // has @default
            expect(reqFieldNames).not.toContain("note");   // nullable
        });

        test("should harvest deep context combining controller, branch conditions, DB models, and callers", () => {
            const sourceCode = [
                {
                    path: "src/controllers/order.controller.js",
                    content: sampleController,
                },
                {
                    path: "client/src/services/api.js",
                    content: "export const makeOrder = (items) => axios.post('/api/orders', { items });",
                },
                {
                    path: "prisma/schema.prisma",
                    content: "model Order { id String @id userId String total Float }",
                },
            ];

            const endpoint = {
                method: "POST",
                path: "/api/orders",
                controllerFile: "src/controllers/order.controller.js",
                controllerLineStart: 2,
                controllerLineEnd: 15,
                databaseModels: ["Order"],
                middlewares: [{ name: "authGuard" }],
            };

            const deepCtx = harvestApiDeepContext({ endpoint, sourceCode });

            expect(deepCtx.method).toBe("POST");
            expect(deepCtx.path).toBe("/api/orders");
            expect(deepCtx.branchConditions.length).toBeGreaterThan(0);
            expect(deepCtx.relatedModels.length).toBeGreaterThan(0);
            expect(deepCtx.frontendCallers.length).toBe(1);
            expect(deepCtx.middlewares).toHaveLength(1);
        });
    });

    describe("Task 2.2: Multi-Scenario Prompt Generation (Supertest & Playwright)", () => {
        const endpoints = [
            {
                method: "POST",
                path: "/api/orders",
                controllerFile: "src/controllers/order.controller.js",
                controllerSnippet: "export const createOrder = async (req, res) => res.status(201).json({});",
            },
        ];

        test("should build prompt with 5-tier strategy for Supertest", () => {
            const prompt = buildIntegrationTestPrompt({
                endpoints,
                framework: "supertest",
            });

            expect(prompt).toContain("Supertest + Jest");
            expect(prompt).toContain("Tier 1 — Happy Path (200 / 201)");
            expect(prompt).toContain("Tier 2 — Negative Validation (400 Bad Request)");
            expect(prompt).toContain("Tier 3 — Authentication & Authorization");
            expect(prompt).toContain("Tier 4 — Not Found & Conflicts");
            expect(prompt).toContain("Tier 5 — Edge Cases & Boundary Limits");
            expect(prompt).toContain("tests/integration/");
            expect(prompt).toContain("request(app)");
        });

        test("should build prompt with 5-tier strategy for Playwright API", () => {
            const prompt = buildIntegrationTestPrompt({
                endpoints,
                framework: "playwright",
            });

            expect(prompt).toContain("Playwright API Testing");
            expect(prompt).toContain("@playwright/test");
            expect(prompt).toContain("tests/api/");
            expect(prompt).toContain("request.post");
            expect(prompt).toContain("Tier 1 — Happy Path");
        });
    });

    describe("Task 2.3: Safety Validator & AI Faulty Test Repair", () => {
        test("should validate safe generated test code with Babel AST", () => {
            const safeCode = `
import request from 'supertest';
import app from '../../src/app.js';

describe('Order API', () => {
  it('happy path: returns 201', async () => {
    const res = await request(app).post('/api/orders').send({ total: 100 });
    expect(res.status).toBe(201);
  });
});
`;
            const result = validateIntegrationTestCode(safeCode, "supertest");
            expect(result.valid).toBe(true);
            expect(result.ast).toBeDefined();
        });

        test("should reject code containing forbidden modules like child_process", () => {
            const maliciousCode = `
import { exec } from 'child_process';
describe('Hack', () => { it('runs', () => { exec('whoami'); }); });
`;
            expect(() => validateIntegrationTestCode(maliciousCode)).toThrow(/forbidden module import/i);
        });

        test("should reject code containing eval or process.exit", () => {
            const evalCode = `
const app = require('../../app');
eval('console.log(1)');
`;
            expect(() => validateIntegrationTestCode(evalCode)).toThrow(/forbidden call/i);
        });

        test("should build targeted repair prompt for faulty existing tests based on failure layer", () => {
            const failureReport = {
                failureLayer: "ASSERTION_FAILED",
                explanation: "Request returned status 201, but test asserted 200",
                failingComponent: "Test Assertion / Contract",
                lastExecutedLine: { line: 12, filePath: "src/controllers/order.controller.js", codeSnippet: "res.status(201).json(order)" },
                suggestedFix: "Change expectation from 200 to 201",
            };

            const faultyCode = `
test('create order', async () => {
  const res = await request(app).post('/api/orders').send({ items: [] });
  expect(res.status).toBe(200);
});
`;

            const prompt = buildFaultyTestFixPrompt({
                testFileContent: faultyCode,
                testFilePath: "tests/integration/orders.test.js",
                failureReport,
                endpoint: { controllerSnippet: "res.status(201).json({ id: 1 })" },
            });

            expect(prompt).toContain("ASSERTION_FAILED");
            expect(prompt).toContain("Line 12");
            expect(prompt).toContain("Change expectation from 200 to 201");
            expect(prompt).toContain("res.status(201).json(order)");
            expect(prompt).toContain("fixedContent");
        });
    });
});

