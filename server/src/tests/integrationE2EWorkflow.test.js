import './helpers/integrationServiceDoubles.js';
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock external queue and AI before imports
jest.unstable_mockModule("../services/queue.service.js", () => ({
    addJobToQueue: jest.fn().mockResolvedValue(true),
}));

jest.unstable_mockModule("../services/gemini.service.js", () => ({
    generateText: jest.fn().mockResolvedValue(`
describe("Cold-Start Integration Tests", () => {
    it("POST /api/products creates product successfully", async () => {
        const res = await request(app).post("/api/products").send({ name: "Widget", price: 100 });
        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty("id");
    });
    it("POST /api/products rejects invalid price", async () => {
        const res = await request(app).post("/api/products").send({ name: "Widget", price: -5 });
        expect(res.status).toBe(400);
    });
    it("POST /api/products rejects missing auth token", async () => {
        const res = await request(app).post("/api/products");
        expect(res.status).toBe(401);
    });
    it("GET /api/products/:id returns 404 for unknown product", async () => {
        const res = await request(app).get("/api/products/non-existent-id");
        expect(res.status).toBe(404);
    });
});
`),
}));

const {
    detectIntegrationFrameworks,
    installIntegrationDependencies,
} = await import("../services/integrationDetection.service.js");
const {
    traceApiEndpointCoverage,
    diagnoseApiFailureLayer,
    buildApiCoverageReport,
} = await import("../services/apiCoverageTracer.service.js");
const {
    parseUnifiedCoverage,
} = await import("../services/unifiedCoverageEngine.service.js");
const {
    validateIntegrationTestCode,
    buildIntegrationTestPrompt,
} = await import("../services/integrationAiTestGenerator.service.js");
const {
    updateIntegrationScenarioService,
    applyIntegrationTestsService,
} = await import("../services/integrationApiService.service.js");
const { dockerRunner } = await import("../services/dockerRunner.service.js");
const {scenarioArtifactVersion} = await import('../services/scenarioManager.service.js');
const prisma = (await import("../config/prisma.js")).default;

describe("Phase 6.2: Kiểm Thử Luồng Thực Tế (E2E Integration Scenarios)", () => {
    const tmpDirs = [];
    let origDockerRun;

    const createTempRepo = (files = {}) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-e2e-workflow-"));
        tmpDirs.push(dir);
        for (const [relPath, content] of Object.entries(files)) {
            const fullPath = path.join(dir, relPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, "utf8");
        }
        return dir;
    };

    beforeEach(() => {
        jest.spyOn(prisma.project,'update').mockResolvedValue({workspaceRevision:1,eventSequence:1});
        jest.spyOn(prisma.projectEvent,'create').mockResolvedValue({id:'event'});
        origDockerRun = dockerRunner.run;
        dockerRunner.run = async () => ({
            success: true,
            exitCode: 0,
            stdout: "added packages successfully",
            stderr: "",
        });
    });

    afterEach(() => {
        dockerRunner.run = origDockerRun;
        tmpDirs.splice(0).forEach((dir) => {
            try {
                fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
            } catch (_) {}
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Kịch bản 1: Dự án đã có sẵn test API
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Kịch bản 1 (Dự án đã có sẵn test API)", () => {
        it("nhận diện chính xác Supertest có sẵn, chạy kiểm thử và bóc tách độ bao phủ từng API", async () => {
            const rootDir = createTempRepo({
                "package.json": JSON.stringify({
                    name: "sample-ecommerce-api",
                    version: "1.0.0",
                    devDependencies: {
                        supertest: "^6.3.3",
                        jest: "^29.5.0",
                    },
                    scripts: {
                        test: "jest --runInBand",
                    },
                }, null, 2),
                "jest.config.js": "module.exports = { testEnvironment: 'node' };",
                "server/controllers/userController.js": `
                    const users = [{ id: 1, name: 'Alice' }];
                    export const getUsers = (req, res) => {
                        return res.status(200).json({ success: true, data: users });
                    };
                    export const createUser = (req, res) => {
                        const { name } = req.body;
                        if (!name) return res.status(400).json({ error: 'Name is required' });
                        const user = { id: users.length + 1, name };
                        users.push(user);
                        return res.status(201).json({ success: true, data: user });
                    };
                `,
                "tests/integration/users.test.js": `
                    const request = require('supertest');
                    const app = require('../../server/app');
                    describe('User API Integration Tests', () => {
                        it('GET /api/users returns 200 with user list', async () => {
                            const res = await request(app).get('/api/users');
                            expect(res.status).toBe(200);
                        });
                    });
                `,
            });

            // 1. Detection Phase
            const detection = await detectIntegrationFrameworks(rootDir);
            expect(detection.detected).toBe(true);
            expect(detection.primaryFramework).toBe("supertest");
            expect(detection.permutation).toBe("HAS_TESTS_AND_DEPS");
            expect(detection.permutationDetails.readyForExecution).toBe(true);
            expect(detection.permutationDetails.needsInstall).toBe(false);
            expect(detection.supertestFiles).toHaveLength(1);
            expect(detection.supertestFiles[0]).toContain("users.test.js");

            // 2. Simulated Istanbul line coverage & Traceability
            const mockEndpoints = [
                {
                    method: "GET",
                    path: "/api/users",
                    controllerFile: "server/controllers/userController.js",
                    controllerLineStart: 3,
                    controllerLineEnd: 5,
                    middlewares: [],
                },
                {
                    method: "POST",
                    path: "/api/users",
                    controllerFile: "server/controllers/userController.js",
                    controllerLineStart: 6,
                    controllerLineEnd: 12,
                    middlewares: [],
                },
            ];

            const mockFileCoverageMap = {
                "server/controllers/userController.js": {
                    path: "server/controllers/userController.js",
                    lineHits: {
                        3: 2, 4: 2, 5: 2, // GET was executed
                        6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, // POST was NOT executed
                    },
                    lines: { total: 10, covered: 3, pct: 30.0 },
                    statements: { total: 10, covered: 3, pct: 30.0 },
                    branches: { total: 2, covered: 0, pct: 0 },
                    functions: { total: 2, covered: 1, pct: 50.0 },
                },
            };

            const traceResult = traceApiEndpointCoverage({
                endpoints: mockEndpoints,
                fileCoverageMap: mockFileCoverageMap,
            });

            expect(traceResult.summary.totalEndpoints).toBe(2);
            expect(traceResult.summary.coveredEndpoints).toBe(1);
            expect(traceResult.summary.uncoveredEndpoints).toBe(1);
            expect(traceResult.summary.endpointCoveragePct).toBe(50);

            const getEndpoint = traceResult.endpointsTraceability.find((e) => e.method === "GET");
            expect(getEndpoint.status).toBe("COVERED");
            expect(getEndpoint.coveragePct).toBe(100);

            const postEndpoint = traceResult.endpointsTraceability.find((e) => e.method === "POST");
            expect(postEndpoint.status).toBe("UNCOVERED");
            expect(postEndpoint.coveragePct).toBe(0);

            // 3. Build API Coverage Report
            const report = buildApiCoverageReport({
                traceabilityResult: traceResult,
                scenarios: [
                    { title: "GET /api/users returns 200 with user list", status: "passed" },
                ],
                testFramework: "SUPERTEST",
            });

            expect(report.metrics.coveragePct).toBe(50);
            expect(report.uncoveredList).toHaveLength(1);
            expect(report.uncoveredList[0].path).toBe("/api/users");
            expect(report.routeMatrix).toHaveLength(2);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Kịch bản 2: Dự án sạch chưa có test
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Kịch bản 2 (Dự án sạch chưa có test)", () => {
        it("hiển thị tùy chọn Supertest/Playwright, sinh test bằng AI đa kịch bản và ra report bao phủ toàn diện", async () => {
            const rootDir = createTempRepo({
                "package.json": JSON.stringify({
                    name: "clean-inventory-service",
                    version: "1.0.0",
                    dependencies: {
                        express: "^4.18.2",
                    },
                }, null, 2),
                "server/controllers/product.controller.js": `
                    export const createProduct = (req, res) => {
                        if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
                        const { name, price } = req.body;
                        if (!name || price <= 0) return res.status(400).json({ error: 'Invalid name or price' });
                        return res.status(201).json({ id: 'prod-123', name, price });
                    };
                    export const getProductById = (req, res) => {
                        const { id } = req.params;
                        if (id !== 'prod-123') return res.status(404).json({ error: 'Product not found' });
                        return res.status(200).json({ id, name: 'Sample' });
                    };
                `,
            });

            // 1. Detection Phase: Zero-test detection
            const detection = await detectIntegrationFrameworks(rootDir);
            expect(detection.detected).toBe(false);
            expect(detection.permutation).toBe("ZERO_TESTS_NO_DEPS");
            expect(detection.permutationDetails.isZeroTestProject).toBe(true);
            expect(detection.permutationDetails.needsUserSelection).toBe(true);
            expect(detection.permutationDetails.proposedFrameworks.map((f) => f.id)).toEqual(["supertest", "playwright"]);

            // 2. User chooses framework Supertest -> Cold-start prompt generation
            const mockEndpoints = [
                {
                    method: "POST",
                    path: "/api/products",
                    controllerFile: "server/controllers/product.controller.js",
                    controllerLineStart: 2,
                    controllerLineEnd: 8,
                },
                {
                    method: "GET",
                    path: "/api/products/:id",
                    controllerFile: "server/controllers/product.controller.js",
                    controllerLineStart: 9,
                    controllerLineEnd: 14,
                },
            ];

            const prompt = buildIntegrationTestPrompt({
                endpoints: mockEndpoints,
                sourceCode: [
                    {
                        filePath: "server/controllers/product.controller.js",
                        content: fs.readFileSync(path.join(rootDir, "server/controllers/product.controller.js"), "utf8"),
                    },
                ],
                framework: "supertest",
            });

            expect(prompt).toContain("/api/products");
            expect(prompt).toContain("200");
            expect(prompt).toContain("400");
            expect(prompt).toContain("401");
            expect(prompt).toContain("404");

            // 3. Simulated AI Test Code Validation
            const simulatedAiGeneratedCode = `
                const request = require("supertest");
                const app = require("../app");

                describe("Product API Comprehensive Tests", () => {
                    it("POST /api/products creates product successfully (201)", async () => {
                        const res = await request(app)
                            .post("/api/products")
                            .set("Authorization", "Bearer valid-token")
                            .send({ name: "Gadget", price: 99.9 });
                        expect(res.status).toBe(201);
                    });

                    it("POST /api/products returns 400 when price is invalid", async () => {
                        const res = await request(app)
                            .post("/api/products")
                            .set("Authorization", "Bearer valid-token")
                            .send({ name: "Gadget", price: -10 });
                        expect(res.status).toBe(400);
                    });

                    it("POST /api/products returns 401 when token is missing", async () => {
                        const res = await request(app)
                            .post("/api/products")
                            .send({ name: "Gadget", price: 50 });
                        expect(res.status).toBe(401);
                    });

                    it("GET /api/products/:id returns 404 for unknown product", async () => {
                        const res = await request(app).get("/api/products/unknown-id");
                        expect(res.status).toBe(404);
                    });
                });
            `;

            expect(() => validateIntegrationTestCode(simulatedAiGeneratedCode, "supertest")).not.toThrow();

            // 4. Execution & Unified Report showing 100% coverage
            const fullCoverageMap = {
                "server/controllers/product.controller.js": {
                    path: "server/controllers/product.controller.js",
                    lineHits: {
                        2: 3, 3: 3, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1,
                        9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 1,
                    },
                    lines: { total: 13, covered: 13, pct: 100.0 },
                    statements: { total: 13, covered: 13, pct: 100.0 },
                    branches: { total: 4, covered: 4, pct: 100.0 },
                    functions: { total: 2, covered: 2, pct: 100.0 },
                },
            };

            const fullTrace = traceApiEndpointCoverage({
                endpoints: mockEndpoints,
                fileCoverageMap: fullCoverageMap,
            });

            expect(fullTrace.summary.endpointCoveragePct).toBe(100);
            expect(fullTrace.summary.uncoveredEndpoints).toBe(0);

            const finalReport = buildApiCoverageReport({
                traceabilityResult: fullTrace,
                scenarios: [
                    { title: "POST /api/products creates product successfully (201)", status: "passed" },
                    { title: "POST /api/products returns 400 when price is invalid", status: "passed" },
                    { title: "POST /api/products returns 401 when token is missing", status: "passed" },
                    { title: "GET /api/products/:id returns 404 for unknown product", status: "passed" },
                ],
                testFramework: "SUPERTEST",
            });

            expect(finalReport.metrics.coveragePct).toBe(100);
            expect(finalReport.uncoveredList).toHaveLength(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Kịch bản 3: Dự án có test nhưng thiếu thư viện trong package.json
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Kịch bản 3 (Dự án có test nhưng thiếu thư viện)", () => {
        it("phát hiện thiếu dependency, cảnh báo người dùng, tự động cài đặt và chuyển sang trạng thái sẵn sàng", async () => {
            const rootDir = createTempRepo({
                "package.json": JSON.stringify({
                    name: "uninstalled-deps-api",
                    version: "1.0.0",
                    dependencies: {
                        express: "^4.18.2",
                    },
                }, null, 2),
                "tests/integration/orders.test.js": `
                    const request = require('supertest');
                    const app = require('../../app');
                    test('GET /api/orders returns list', async () => {
                        const res = await request(app).get('/api/orders');
                        expect(res.status).toBe(200);
                    });
                `,
            });

            // 1. Detection Phase: Detects test files but missing libraries
            const initialDetection = await detectIntegrationFrameworks(rootDir);
            expect(initialDetection.permutation).toBe("HAS_TESTS_NO_DEPS");
            expect(initialDetection.permutationDetails.needsInstall).toBe(true);
            expect(initialDetection.permutationDetails.inferredFramework).toBe("supertest");
            expect(initialDetection.permutationDetails.missingPackages).toContain("supertest");
            expect(initialDetection.permutationDetails.missingPackages).toContain("jest");
            expect(initialDetection.permutationDetails.installCommand).toBe("npm install --save-dev supertest jest");

            // 2. User confirms install -> installIntegrationDependencies runs
            const installRes = await installIntegrationDependencies({
                rootDir,
                packages: initialDetection.permutationDetails.missingPackages,
                framework: "supertest",
            });

            expect(installRes.success).toBe(true);
            expect(installRes.packages).toEqual(["supertest", "jest"]);

            // Verify package.json devDependencies are now populated on disk
            const updatedPkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
            expect(updatedPkg.devDependencies).toBeDefined();
            expect(updatedPkg.devDependencies.supertest).toBeDefined();
            expect(updatedPkg.devDependencies.jest).toBeDefined();

            // 3. Re-run detection: Permutation transitions to HAS_TESTS_AND_DEPS
            const postInstallDetection = await detectIntegrationFrameworks(rootDir);
            expect(postInstallDetection.permutation).toBe("HAS_TESTS_AND_DEPS");
            expect(postInstallDetection.permutationDetails.readyForExecution).toBe(true);
            expect(postInstallDetection.permutationDetails.needsInstall).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Kịch bản 4: Biên tập & Apply test vào mã nguồn dự án
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Kịch bản 4 (Biên tập & Apply test)", () => {
        it("cho phép biên tập kịch bản trong editor, áp dụng vào repo và kích hoạt gợi ý chạy lại phân tích độ bao phủ", async () => {
            const rootDir = createTempRepo({
                "package.json": JSON.stringify({
                    name: "apply-test-service",
                    main: "server/app.js",
                    devDependencies: {
                        supertest: "^6.3.3",
                        jest: "^29.5.0",
                    },
                }, null, 2),
                "server/app.js": "const express = require('express'); const app = express(); module.exports = app;",
            });

            const mockSnapshotId = "snapshot-e2e-apply-1";
            const mockUserId = "user-e2e-1";

            jest.spyOn(prisma.projectSnapshot, "findUnique").mockResolvedValue({
                id: mockSnapshotId,
                rootDir,
                projectId:"proj-1", project: { id:"proj-1", workspaceRevision:0, ownerId: mockUserId, rootDir },
            });

            const initialAiTest = {
                id: "aitest-apply-test-1",
                projectId: "proj-1",
                snapshotId: mockSnapshotId,
                filePath: "tests/integration/products.test.js",
                content: `
                    const request = require("supertest");
                    const app = require("../../server/app.js");

                    describe("Draft Products Test", () => {
                        it("POST /api/products returns 201", async () => {
                            const res = await request(app).post("/api/products").send({ name: "Draft Item" });
                            expect(res.status).toBe(201);
                        });
                    });
                `,
                metaJson: JSON.stringify({
                    framework: "SUPERTEST",
                    status: "DRAFT",
                    requests: [
                        {
                            scenarioId: "sc-prod-create",
                            testName: "POST /api/products returns 201",
                            expectedStatus: 201,
                            payload: { name: "Draft Item" },
                        },
                    ],
                }),
            };

            jest.spyOn(prisma.aiTest, "findMany").mockResolvedValue([initialAiTest]);
            let currentAiTestRecord = { ...initialAiTest };
            jest.spyOn(prisma.aiTest, "update").mockImplementation(async ({ data }) => {
                currentAiTestRecord = { ...currentAiTestRecord, ...data };
                return currentAiTestRecord;
            });

            jest.spyOn(prisma.aiTest,'findUnique').mockImplementation(async()=>currentAiTestRecord);
            // 1. User edits scenario in editor (changes expectedStatus to 201, modifies payload)
            const updateResult = await updateIntegrationScenarioService({
                snapshotId: mockSnapshotId,
                scenarioId: "sc-prod-create",
                userId: mockUserId,
                updates: {
                    expectedVersion:scenarioArtifactVersion(currentAiTestRecord),
                    title: "POST /api/products - creates custom branded item",
                    expectedStatus: 201,
                    payload: { name: "Branded Widget", category: "Hardware" },
                },
            });

            expect(updateResult.success).toBe(true);
            const parsedMeta = JSON.parse(currentAiTestRecord.metaJson);
            expect(parsedMeta.requests[0].testName).toBe("POST /api/products - creates custom branded item");
            expect(parsedMeta.requests[0].userEdited).toBe(true);
            expect(parsedMeta.requests[0].payload).toEqual({ name: "Branded Widget", category: "Hardware" });

            // 2. User selects custom target path in directory picker and clicks "Lưu & Apply vào mã nguồn"
            const customTargetPath = "tests/integration/custom-products.test.js";
            const applyResult = await applyIntegrationTestsService({
                snapshotId: mockSnapshotId,
                userId: mockUserId,
                testIds: ["aitest-apply-test-1"],
                targetFilePath: customTargetPath,
            });

            expect(applyResult.success).toBe(true);
            expect(applyResult.suggestRerun).toBe(true);
            expect(applyResult.appliedFiles).toContain(customTargetPath);

            // 3. Verify file on disk
            const diskFilePath = path.join(rootDir, customTargetPath);
            expect(fs.existsSync(diskFilePath)).toBe(true);
            const fileContentOnDisk = fs.readFileSync(diskFilePath, "utf8");
            expect(fileContentOnDisk).toContain("supertest");
            expect(() => validateIntegrationTestCode(fileContentOnDisk, "supertest")).not.toThrow();

            // 4. Trigger rerun: After apply, system triggers re-analysis
            const detectionAfterApply = await detectIntegrationFrameworks(rootDir);
            expect(detectionAfterApply.permutation).toBe("HAS_TESTS_AND_DEPS");
            expect(detectionAfterApply.supertestFiles.some((f) => f.includes("custom-products.test.js"))).toBe(true);
        });
    });
});
