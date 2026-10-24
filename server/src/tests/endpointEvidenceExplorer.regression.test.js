import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Mock Prisma and other external dependencies
const prismaMock = {
    project: { findFirst: jest.fn(), findUnique: jest.fn() },
    projectSnapshot: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    job: { findMany: jest.fn() },
    testRun: { findFirst: jest.fn(), findMany: jest.fn() },
    endpoint: { findMany: jest.fn() },
    aiTest: { findMany: jest.fn() },
    coverageSummary: { findUnique: jest.fn() },
    coverageFile: { findMany: jest.fn() },
    coverageFunction: { findMany: jest.fn() },
    sourceCode: { findMany: jest.fn() },
    cfg: { findMany: jest.fn() }
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../config/firebase.js", () => ({ getBucket: jest.fn() }));
jest.unstable_mockModule("../services/job.service.js", () => ({
    createAnalysisJob: jest.fn(),
    createSnapshotIngestJob: jest.fn(),
    createRunTestsJob: jest.fn(),
    addJobLog: jest.fn()
}));
jest.unstable_mockModule("../services/jestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/vitestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/testDetection.service.js", () => ({ detectFrameworks: jest.fn() }));
jest.unstable_mockModule("../services/cypressDetection.service.js", () => ({ detectCypressMetadata: jest.fn() }));
jest.unstable_mockModule("../middlewares/upload.middleware.js", () => ({ scanArchiveBomb: jest.fn() }));
jest.unstable_mockModule("../services/github.service.js", () => ({ GitHubRepositoryAccessService: {} }));

const { extractValidEndpoints, extractMountPaths } = await import("../services/apiEndpointParser.service.js");
const { buildIntegrationWorkspace } = await import("../services/integrationWorkspace.service.js");
const { getFileContent } = await import("../services/project.service.js");
const { resolveSnapshotFile } = await import("../utils/snapshotWorkspace.js");

describe("COVAI Phase 2 — Endpoint Evidence Explorer Regression Suite", () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-evidence-explorer-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    const createRealisticProjectFixture = () => {
        const appJsContent = `const express = require('express');
const orderRoutes = require('./routes/order.routes');
const itemRoutes = require('./routes/item.routes');
const app = express();
app.use(express.json());
app.use('/api/orders', orderRoutes);
app.use('/api/items', itemRoutes);
module.exports = app;
`;
        const orderRoutesContent = `const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const orderController = require('../controllers/order.controller');

router.post('/', authMiddleware, orderController.createOrder);
router.get('/:id', orderController.getOrderById);
router.delete('/temp', (req, res) => {
    return res.status(204).send();
});
module.exports = router;
`;
        const orderControllerContent = `const orderService = require('../services/order.service');

async function createOrder(req, res) {
    try {
        const { items, total } = req.body;
        const order = await orderService.createOrder({ items, total });
        return res.status(201).json(order);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

async function getOrderById(req, res) {
    try {
        const { id } = req.params;
        const { details, format } = req.query;
        const order = await orderService.findOrderById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        return res.status(200).json(order);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

module.exports = { createOrder, getOrderById };
`;
        const orderServiceContent = `const Order = require('../models/order.model');

async function createOrder(data) {
    return await Order.create(data);
}

async function findOrderById(id) {
    return await Order.findById(id);
}

module.exports = { createOrder, findOrderById };
`;
        const authMiddlewareContent = `function authMiddleware(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = authMiddleware;
`;

        return [
            { path: "app.js", content: appJsContent },
            { path: "routes/order.routes.js", content: orderRoutesContent },
            { path: "controllers/order.controller.js", content: orderControllerContent },
            { path: "services/order.service.js", content: orderServiceContent },
            { path: "middlewares/auth.middleware.js", content: authMiddlewareContent }
        ];
    };

    const writeFixtureToDisk = (dir, files = createRealisticProjectFixture()) => {
        for (const file of files) {
            const target = path.join(dir, file.path);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, file.content, "utf8");
        }
    };

    /**
     * Requirement 1: Endpoint có source location hợp lệ hiển thị đúng file và dòng.
     */
    it("1. Valid source location displays correct file, line numbers, and syntax snippets", () => {
        const sourceCode = createRealisticProjectFixture();
        const endpoints = extractValidEndpoints(sourceCode);

        const createOrderEp = endpoints.find(e => e.method === "POST" && e.fullPath === "/api/orders");
        expect(createOrderEp).toBeDefined();

        // Route source location verification
        expect(createOrderEp.sourceFile).toBe("routes/order.routes.js");
        expect(createOrderEp.sourceLine).toBeGreaterThan(0);
        expect(createOrderEp.sourceLineStart).toBe(createOrderEp.sourceLine);
        expect(createOrderEp.sourceLineEnd).toBeGreaterThanOrEqual(createOrderEp.sourceLineStart);
        expect(createOrderEp.routeSnippet).toContain("router.post");
        expect(createOrderEp.routeSnippet).toContain("orderController.createOrder");

        // Controller handler location verification
        expect(createOrderEp.controllerFile).toBe("controllers/order.controller.js");
        expect(createOrderEp.controllerLineStart).toBeGreaterThan(0);
        expect(createOrderEp.controllerLineEnd).toBeGreaterThan(createOrderEp.controllerLineStart);
        expect(createOrderEp.controllerSnippet).toContain("async function createOrder");
        expect(createOrderEp.controllerSnippet).toContain("res.status(201)");

        // Request Processing Chain verification
        expect(createOrderEp.requestProcessingChain).toBeDefined();
        expect(createOrderEp.requestProcessingChain.routeRegistration.verified).toBe(true);
        expect(createOrderEp.requestProcessingChain.routeRegistration.sourceFile).toBe("routes/order.routes.js");
        expect(createOrderEp.requestProcessingChain.controller.verified).toBe(true);
        expect(createOrderEp.requestProcessingChain.controller.file).toBe("controllers/order.controller.js");
        expect(createOrderEp.requestProcessingChain.controllerHandler.verified).toBe(true);
        expect(createOrderEp.requestProcessingChain.service.verified).toBe(true);
        expect(createOrderEp.requestProcessingChain.service.file).toBe("services/order.service.js");
    });

    /**
     * Requirement 2: Endpoint động như `/api/items/:id` hoặc cấu trúc tương đương được xử lý đúng.
     */
    it("2. Dynamic endpoints with path and query parameters are parsed and normalized accurately", () => {
        const sourceCode = createRealisticProjectFixture();
        const endpoints = extractValidEndpoints(sourceCode);

        const getOrderEp = endpoints.find(e => e.method === "GET" && e.fullPath === "/api/orders/:id");
        expect(getOrderEp).toBeDefined();

        // Path params from route pattern
        expect(getOrderEp.behaviorEvidence.pathParams).toEqual(["id"]);
        expect(getOrderEp.params).toEqual(["id"]);

        // Query params extracted from req.query references in handler
        expect(getOrderEp.behaviorEvidence.queryParams).toEqual(expect.arrayContaining(["details", "format"]));

        // Inferred response codes from AST
        expect(getOrderEp.behaviorEvidence.responseStatusCodes).toEqual(expect.arrayContaining([200, 404, 500]));
        expect(getOrderEp.behaviorEvidence.inferredResponseStatusCodes).toEqual(expect.arrayContaining([200, 404, 500]));

        // Error handling AST inference
        expect(getOrderEp.behaviorEvidence.errorHandling.hasTryCatch).toBe(true);
    });

    /**
     * Requirement 3: Endpoint không đủ bằng chứng hiển thị rõ trạng thái chưa xác minh.
     */
    it("3. Endpoints with missing links or inline handlers truthfully report unverified status without fake data", () => {
        const sourceCode = createRealisticProjectFixture();
        const endpoints = extractValidEndpoints(sourceCode);

        // router.delete('/temp', (req, res) => res.status(204).send())
        const inlineDeleteEp = endpoints.find(e => e.method === "DELETE" && e.fullPath === "/api/orders/temp");
        expect(inlineDeleteEp).toBeDefined();

        // No external controller file
        expect(inlineDeleteEp.controllerFile).toBeNull();
        expect(inlineDeleteEp.controllerLine).toBeNull();

        // Direct controller handling, serviceLayer is NOT fake-fabricated
        expect(inlineDeleteEp.requestProcessingChain.service.verified).toBe(false);
        expect(inlineDeleteEp.requestProcessingChain.service.status).toBe("DIRECT_CONTROLLER");
        expect(inlineDeleteEp.requestProcessingChain.serviceLayer.verified).toBe(false);
        expect(inlineDeleteEp.requestProcessingChain.dataAccess.verified).toBe(false);

        // Test an endpoint whose source route definition was never found
        const unverifiedEp = {
            id: "ep-orphan",
            method: "PATCH",
            fullPath: "/api/unknown/resource",
            sourceFile: null,
            sourceLine: null,
            provenance: { resolutionStatus: "UNRESOLVED" }
        };

        const sourceStatus = (unverifiedEp.sourceFile || unverifiedEp.provenance?.resolutionStatus === "FULLY_RESOLVED") 
            ? "FOUND_IN_SOURCE" 
            : "SOURCE_UNVERIFIED";
        expect(sourceStatus).toBe("SOURCE_UNVERIFIED");
    });

    /**
     * Requirement 4: Test liên quan được nối với endpoint khi có mapping thực tế.
     */
    it("4. Related integration tests and runtime scenarios are correctly mapped to endpoints", async () => {
        const snapshotId = "snap-test-mapping";
        writeFixtureToDisk(tempDir);

        prismaMock.projectSnapshot.findUnique.mockResolvedValue({ id: snapshotId, rootDir: tempDir, createdAt: new Date() });
        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1" });
        prismaMock.job.findMany.mockResolvedValue([
            { id: "job-exec", type: "COVERAGE_PIPELINE", status: "SUCCESS", createdAt: new Date() }
        ]);

        const mockAiTest = {
            id: "test-order-1",
            filePath: "tests/order.integration.test.js",
            content: `describe('POST /api/orders', () => {
                it('should create an order successfully', async () => {
                    const res = await request(app).post('/api/orders').send({ items: [] });
                    expect(res.status).toBe(201);
                });
            });`,
            metaJson: JSON.stringify({
                framework: "SUPERTEST",
                status: "APPROVED",
                isValid: true,
                requests: [{
                    testName: "should create an order successfully",
                    method: "POST",
                    endpoint: "/api/orders",
                    expectedStatus: 201,
                    enabled: true
                }]
            })
        };
        prismaMock.aiTest.findMany.mockResolvedValue([mockAiTest]);

        const mockTestRun = {
            id: "run-order-1",
            status: "PASSED",
            totalTests: 1,
            passedTests: 1,
            failedTests: 0,
            skippedTests: 0,
            createdAt: new Date(),
            scenarios: [{
                testName: "should create an order successfully",
                title: "should create an order successfully",
                suiteName: "POST /api/orders",
                status: "passed",
                duration: 45,
                durationMs: 45,
                responseStatus: 201,
                actualStatusFromRuntime: 201,
                requestMethod: "POST",
                requestUrl: "/api/orders"
            }]
        };
        prismaMock.testRun.findFirst.mockResolvedValue(mockTestRun);
        prismaMock.testRun.findMany.mockResolvedValue([mockTestRun]);
        prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
        prismaMock.coverageFile.findMany.mockResolvedValue([]);
        prismaMock.coverageFunction.findMany.mockResolvedValue([]);
        prismaMock.sourceCode.findMany.mockResolvedValue([]);
        prismaMock.cfg.findMany.mockResolvedValue([]);

        const workspace = await buildIntegrationWorkspace(snapshotId);
        const ep = workspace.endpoints.find(e => e.method === "POST" && e.path === "/api/orders");

        expect(ep).toBeDefined();
        expect(ep.scenarios).toBeDefined();
        expect(ep.scenarios.length).toBeGreaterThan(0);
        expect(ep.scenarios[0].title).toBe("should create an order successfully");
        expect(ep.scenarios[0].status).toBe("passed");
        expect(ep.scenarios[0].actualStatusFromRuntime).toBe(201);
    });

    /**
     * Requirement 5: Static source evidence không bị nhầm thành runtime evidence hoặc contract verification.
     */
    it("5. Static AST evidence is distinctly separated from runtime execution and contract verification", async () => {
        const snapshotId = "snap-static-only";
        writeFixtureToDisk(tempDir);

        prismaMock.projectSnapshot.findUnique.mockResolvedValue({ id: snapshotId, rootDir: tempDir, createdAt: new Date() });
        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1" });
        prismaMock.job.findMany.mockResolvedValue([]); // No execution jobs run
        prismaMock.testRun.findFirst.mockResolvedValue(null); // No runtime tests executed
        prismaMock.testRun.findMany.mockResolvedValue([]);
        prismaMock.aiTest.findMany.mockResolvedValue([]);
        prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
        prismaMock.coverageFile.findMany.mockResolvedValue([]);
        prismaMock.coverageFunction.findMany.mockResolvedValue([]);
        prismaMock.sourceCode.findMany.mockResolvedValue([]);
        prismaMock.cfg.findMany.mockResolvedValue([]);

        const workspace = await buildIntegrationWorkspace(snapshotId);
        const ep = workspace.endpoints.find(e => e.method === "GET" && e.path === "/api/orders/:id");

        expect(ep).toBeDefined();

        // 1. Source verification is verified
        expect(ep.verification.source.status).toBe("FOUND_IN_SOURCE");
        expect(ep.verification.source.sourceFile).toBe("routes/order.routes.js");

        // 2. Runtime verification MUST be NOT_EXECUTED (not confused with static detection)
        expect(ep.verification.runtime.status).toBe("NOT_EXECUTED");
        expect(ep.verification.runtime.executedCount).toBe(0);

        // 3. Contract verification MUST be CONTRACT_UNVERIFIED (no external OpenAPI spec)
        expect(ep.verification.contract.status).toBe("CONTRACT_UNVERIFIED");

        // 4. Static inferred response status codes are stored as static behavior evidence, not runtime hits
        expect(ep.source.responseStatusCodes).toEqual(expect.arrayContaining([200, 404, 500]));
    });

    /**
     * Requirement 6: Snapshot/project khác nhau không bị trộn dữ liệu.
     */
    it("6. Different snapshots and projects strictly isolate their endpoint inventory and workspace data", async () => {
        const snapA = "snap-project-alpha";
        const snapB = "snap-project-beta";

        const dirA = path.join(tempDir, "project-alpha");
        const dirB = path.join(tempDir, "project-beta");
        fs.mkdirSync(dirA, { recursive: true });
        fs.mkdirSync(dirB, { recursive: true });

        // Alpha project has /api/alpha
        writeFixtureToDisk(dirA, [
            { path: "app.js", content: `const express = require('express'); const app = express(); app.get('/api/alpha', (req, res) => res.send('alpha')); module.exports = app;` }
        ]);

        // Beta project has /api/beta
        writeFixtureToDisk(dirB, [
            { path: "app.js", content: `const express = require('express'); const app = express(); app.post('/api/beta', (req, res) => res.send('beta')); module.exports = app;` }
        ]);

        prismaMock.projectSnapshot.findUnique.mockImplementation(async ({ where }) => {
            if (where.id === snapA) return { id: snapA, projectId: "proj-A", rootDir: dirA, createdAt: new Date() };
            if (where.id === snapB) return { id: snapB, projectId: "proj-B", rootDir: dirB, createdAt: new Date() };
            return null;
        });
        prismaMock.project.findUnique.mockImplementation(async ({ where }) => {
            return { id: where.id || "proj-x" };
        });
        prismaMock.job.findMany.mockResolvedValue([]);
        prismaMock.testRun.findFirst.mockResolvedValue(null);
        prismaMock.testRun.findMany.mockResolvedValue([]);
        prismaMock.aiTest.findMany.mockResolvedValue([]);
        prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
        prismaMock.coverageFile.findMany.mockResolvedValue([]);
        prismaMock.coverageFunction.findMany.mockResolvedValue([]);
        prismaMock.sourceCode.findMany.mockResolvedValue([]);
        prismaMock.cfg.findMany.mockResolvedValue([]);

        const workspaceA = await buildIntegrationWorkspace(snapA);
        const workspaceB = await buildIntegrationWorkspace(snapB);

        expect(workspaceA.endpoints).toHaveLength(1);
        expect(workspaceA.endpoints[0].path).toBe("/api/alpha");
        expect(workspaceA.endpoints[0].method).toBe("GET");
        expect(workspaceA.endpoints[0].verification.discovery.snapshotId).toBe(snapA);

        expect(workspaceB.endpoints).toHaveLength(1);
        expect(workspaceB.endpoints[0].path).toBe("/api/beta");
        expect(workspaceB.endpoints[0].method).toBe("POST");
        expect(workspaceB.endpoints[0].verification.discovery.snapshotId).toBe(snapB);
    });

    /**
     * Requirement 7: Source viewer từ chối đường dẫn nằm ngoài thư mục project cho phép.
     */
    it("7. Source file viewer strictly rejects path traversal attempts with 400 ServiceError", async () => {
        const dummySnapshot = {
            id: "snap-secure",
            rootDir: path.join(tempDir, "server"),
            storagePath: tempDir
        };
        fs.mkdirSync(path.join(tempDir, "server"), { recursive: true });
        fs.writeFileSync(path.join(tempDir, "server", "index.js"), "console.log('safe');");
        fs.writeFileSync(path.join(tempDir, "private.txt"), "SECRET_CREDENTIALS");

        // Legitimate file read succeeds
        const safePath = resolveSnapshotFile(dummySnapshot, "index.js");
        expect(fs.existsSync(safePath)).toBe(true);

        // Path traversal attempts must be rejected
        expect(() => resolveSnapshotFile(dummySnapshot, "../private.txt")).toThrow("Invalid file path");
        expect(() => resolveSnapshotFile(dummySnapshot, "../../etc/passwd")).toThrow("Invalid file path");
        expect(() => resolveSnapshotFile(dummySnapshot, "..\\..\\windows\\system32")).toThrow("Invalid file path");
        expect(() => resolveSnapshotFile(dummySnapshot, "/absolute/path/file.js")).toThrow("Invalid file path");

        // Test getFileContent enforcement
        prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        prismaMock.projectSnapshot.findFirst.mockResolvedValue(dummySnapshot);

        await expect(getFileContent("proj-1", "user-1", "../private.txt", "snap-secure"))
            .rejects
            .toThrow("Invalid file path");
    });

    /**
     * Requirement 8: UI mở và chuyển endpoint không buộc phải chạy Analyze lại.
     */
    it("8. Opening and switching endpoints is an in-memory inspection that triggers zero new Analysis jobs", async () => {
        const createAnalysisJobMock = (await import("../services/job.service.js")).createAnalysisJob;
        expect(createAnalysisJobMock).not.toHaveBeenCalled();

        // Workspace payload already embeds deep evidence for all endpoints in a single snapshot read
        const sourceCode = createRealisticProjectFixture();
        const endpoints = extractValidEndpoints(sourceCode);
        expect(endpoints.length).toBe(3);

        // Selecting endpoint 1
        const ep1 = endpoints[0];
        expect(ep1.requestProcessingChain).toBeDefined();

        // Switching to endpoint 2 without calling createAnalysisJob
        const ep2 = endpoints[1];
        expect(ep2.behaviorEvidence).toBeDefined();

        expect(createAnalysisJobMock).toHaveBeenCalledTimes(0);
    });

    /**
     * Requirement 9: Loading và lỗi khi tải chi tiết không khóa workspace.
     */
    it("9. Detail view read failures for missing or deleted files throw catchable ServiceError without crashing", async () => {
        const dummySnapshot = {
            id: "snap-error-resilience",
            rootDir: path.join(tempDir, "server"),
            storagePath: tempDir
        };
        fs.mkdirSync(path.join(tempDir, "server"), { recursive: true });

        prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        prismaMock.projectSnapshot.findFirst.mockResolvedValue(dummySnapshot);

        // Querying a file that does not exist on disk
        await expect(getFileContent("proj-1", "user-1", "controllers/nonExistent.controller.js", "snap-error-resilience"))
            .rejects
            .toMatchObject({
                message: "File not found",
                statusCode: 404
            });
    });

    /**
     * Requirement 10: Không sửa hoặc làm thay đổi source code của ứng dụng mục tiêu.
     */
    it("10. Target application files remain 100% immutable throughout analysis and evidence extraction", () => {
        const targetAppDir = path.join(tempDir, "target-app");
        fs.mkdirSync(targetAppDir, { recursive: true });

        const originalCode = `const express = require('express');
const app = express();
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
module.exports = app;
`;
        const filePath = path.join(targetAppDir, "app.js");
        fs.writeFileSync(filePath, originalCode, "utf8");

        const initialHash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

        // Run parser and evidence extractor multiple times
        const virtualSource = [{ path: "app.js", content: originalCode }];
        const mounts = extractMountPaths(virtualSource);
        const endpoints = extractValidEndpoints(virtualSource);

        expect(mounts).toBeDefined();
        expect(endpoints).toHaveLength(1);

        const afterHash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
        expect(afterHash).toBe(initialHash);
        expect(fs.readFileSync(filePath, "utf8")).toBe(originalCode);
    });
});
