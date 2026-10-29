import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock Prisma
const prismaMock = {
    projectSnapshot: { findUnique: jest.fn(), findMany: jest.fn() },
    project: { findUnique: jest.fn(), findFirst:jest.fn(async()=>null) },
    job: { findMany: jest.fn(), findUnique: jest.fn() },
    testRun: { findMany: jest.fn(), findUnique: jest.fn() }
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/queue.service.js", () => ({
    jobQueue: { add: jest.fn(), close: jest.fn(), on: jest.fn() },
    addJobToQueue: jest.fn(),
    addSupertestCoveragePipeline: jest.fn()
}));

const {
    normalizeRoutePath,
    getEndpointIdentity,
    hashEndpointEvidence,
    calculateOperationCounters,
    compareEndpointInventories,
    compareTestSuites,
    compareTestRuns,
    archiveVersionArtifact,
    getArchivedVersionArtifact,
    getIntegrationVersionHistoryService,
    compareVersionsService,
    getHistoricalWorkspaceVersionService
} = await import("../services/integrationVersionHistory.service.js");

const {
    getIntegrationHistory,
    getIntegrationVersionHistory,
    compareIntegrationVersions,
    getHistoricalWorkspaceVersion
} = await import("../controllers/coverage.controller.js");

describe("COVAI Phase 3 — Version History, Provenance & Old/New Tracking Regression Suite", () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-version-history-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // 1. Bộ đếm đúng khi có nhiều lần Analyze/Generate/Run Tests
    it("Requirement 1: Calculates accurate operation counters across multiple Analyze, Generate, and Run Tests attempts", () => {
        const jobs = [
            { id: "job-a1", type: "ANALYSIS", status: "SUCCESS" },
            { id: "job-a2", type: "ANALYSIS", status: "FAILED" },
            { id: "job-a3", type: "ANALYSIS", status: "CANCELED" },
            { id: "job-a4", type: "ANALYSIS", status: "RUNNING" },

            { id: "job-g1", type: "AI_TESTS", status: "SUCCESS" },
            { id: "job-g2", type: "AI_TESTS", status: "SUCCESS" },
            { id: "job-g3", type: "AI_TESTS", status: "CANCELED" },

            { id: "job-r1", type: "SUPERTEST_COVERAGE", status: "SUCCESS" },
            { id: "job-r2", type: "RUN_TESTS", status: "FAILED" }
        ];

        const testRuns = [
            { id: "tr-1", status: "PASSED", type: "SUPERTEST" },
            { id: "tr-2", status: "FAILED", type: "SUPERTEST" },
            { id: "tr-3", status: "CANCELED", type: "SUPERTEST" }
        ];

        const counters = calculateOperationCounters(jobs, testRuns);

        // Analyze
        expect(counters.analyze.total).toBe(4);
        expect(counters.analyze.success).toBe(1);
        expect(counters.analyze.failed).toBe(1);
        expect(counters.analyze.canceled).toBe(1);
        expect(counters.analyze.running).toBe(1);

        // Generate
        expect(counters.generate.total).toBe(3);
        expect(counters.generate.success).toBe(2);
        expect(counters.generate.failed).toBe(0);
        expect(counters.generate.canceled).toBe(1);

        // Run Tests: 2 jobs + 3 test runs = 5 total
        expect(counters.runTests.total).toBe(5);
        expect(counters.runTests.success).toBe(2); // job-r1 + tr-1
        expect(counters.runTests.failed).toBe(2); // job-r2 + tr-2
        expect(counters.runTests.canceled).toBe(1); // tr-3
    });

    // 2. Không đếm trùng khi refresh hoặc polling
    it("Requirement 2: Eliminates duplicate counts on refresh, polling, or repeated queries", () => {
        const jobs = [
            { id: "job-1", type: "ANALYSIS", status: "SUCCESS" },
            { id: "job-2", type: "ANALYSIS", status: "SUCCESS" }
        ];
        const testRuns = [];

        const firstCall = calculateOperationCounters(jobs, testRuns);
        const secondCall = calculateOperationCounters(jobs, testRuns);
        const thirdCall = calculateOperationCounters(jobs, testRuns);

        expect(firstCall.analyze.total).toBe(2);
        expect(secondCall.analyze.total).toBe(2);
        expect(thirdCall.analyze.total).toBe(2);
        expect(firstCall).toEqual(secondCall);
        expect(secondCall).toEqual(thirdCall);
    });

    // 3. Phát hiện endpoint NEW, CHANGED, UNCHANGED
    it("Requirement 3: Accurately detects NEW, CHANGED, and UNCHANGED endpoints with field-level diffs", () => {
        const previousEndpoints = [
            {
                method: "GET",
                path: "/api/orders",
                sourceFile: "routes/order.routes.js",
                controllerFile: "controllers/order.controller.js",
                controllerMethod: "listOrders",
                middlewares: ["auth"]
            },
            {
                method: "POST",
                path: "/api/orders",
                sourceFile: "routes/order.routes.js",
                controllerFile: "controllers/order.controller.js",
                controllerMethod: "createOrder",
                middlewares: ["auth"]
            }
        ];

        const currentEndpoints = [
            // UNCHANGED: identical
            {
                method: "GET",
                path: "/api/orders",
                sourceFile: "routes/order.routes.js",
                controllerFile: "controllers/order.controller.js",
                controllerMethod: "listOrders",
                middlewares: ["auth"]
            },
            // CHANGED: controller method and middlewares modified
            {
                method: "POST",
                path: "/api/orders",
                sourceFile: "routes/order.routes.js",
                controllerFile: "controllers/order.controller.js",
                controllerMethod: "createOrderV2",
                middlewares: ["auth", "validateOrderPayload"]
            },
            // NEW: brand new endpoint
            {
                method: "DELETE",
                path: "/api/orders/:id",
                sourceFile: "routes/order.routes.js",
                controllerFile: "controllers/order.controller.js",
                controllerMethod: "deleteOrder",
                middlewares: ["auth", "adminOnly"]
            }
        ];

        const result = compareEndpointInventories(previousEndpoints, currentEndpoints, { isCurrentSuccess: true });

        expect(result.summary.newCount).toBe(1);
        expect(result.summary.changedCount).toBe(1);
        expect(result.summary.unchangedCount).toBe(1);
        expect(result.summary.removedCount).toBe(0);

        const newEp = result.endpoints.find(e => e.diffStatus === "NEW");
        expect(newEp.identity).toBe("DELETE /api/orders/:id");

        const unchangedEp = result.endpoints.find(e => e.diffStatus === "UNCHANGED");
        expect(unchangedEp.identity).toBe("GET /api/orders");

        const changedEp = result.endpoints.find(e => e.diffStatus === "CHANGED");
        expect(changedEp.identity).toBe("POST /api/orders");
        expect(changedEp.changedFields).toContain("controllerMethod");
        expect(changedEp.changedFields).toContain("middlewares");
        expect(changedEp.diffDetails.controllerMethod).toEqual({
            previous: "createOrder",
            current: "createOrderV2"
        });
    });

    // 4. Không đánh dấu REMOVED khi Analyze mới bị hủy hoặc thất bại
    it("Requirement 4: Never marks endpoints as REMOVED if the new Analyze session failed or was canceled", () => {
        const previousEndpoints = [
            { method: "GET", path: "/api/users" },
            { method: "POST", path: "/api/users" }
        ];

        // An incomplete or interrupted analysis only returned one endpoint
        const currentEndpoints = [
            { method: "GET", path: "/api/users" }
        ];

        // If current analysis failed or was canceled (isCurrentSuccess: false)
        const failedResult = compareEndpointInventories(previousEndpoints, currentEndpoints, { isCurrentSuccess: false });
        expect(failedResult.summary.removedCount).toBe(0);
        expect(failedResult.endpoints.some(e => e.diffStatus === "REMOVED")).toBe(false);

        // Only on full completed success (isCurrentSuccess: true) does it confirm REMOVED
        const successResult = compareEndpointInventories(previousEndpoints, currentEndpoints, { isCurrentSuccess: true });
        expect(successResult.summary.removedCount).toBe(1);
        const removedEp = successResult.endpoints.find(e => e.diffStatus === "REMOVED");
        expect(removedEp.identity).toBe("POST /api/users");
    });

    // 5. Phát hiện test file/test case mới, sửa, giữ nguyên và loại bỏ
    it("Requirement 5: Detects new, modified, unchanged, and removed test files and test cases", () => {
        const previousTests = [
            {
                filePath: "tests/order.test.js",
                testName: "GET /api/orders :: returns all orders",
                code: "expect(res.status).toBe(200);"
            },
            {
                filePath: "tests/order.test.js",
                testName: "POST /api/orders :: creates order successfully",
                code: "expect(res.body.success).toBe(true);"
            },
            {
                filePath: "tests/legacy.test.js",
                testName: "GET /api/legacy :: deprecated route",
                code: "expect(res.status).toBe(410);"
            }
        ];

        const currentTests = [
            // UNCHANGED test case
            {
                filePath: "tests/order.test.js",
                testName: "GET /api/orders :: returns all orders",
                code: "expect(res.status).toBe(200);"
            },
            // MODIFIED test case
            {
                filePath: "tests/order.test.js",
                testName: "POST /api/orders :: creates order successfully",
                code: "expect(res.body.success).toBe(true); expect(res.body.orderId).toBeDefined();"
            },
            // NEW test case in NEW test file
            {
                filePath: "tests/payment.test.js",
                testName: "POST /api/payments :: processes credit card",
                code: "expect(res.status).toBe(201);"
            }
        ];

        const diff = compareTestSuites(previousTests, currentTests);

        // File-level diffs
        expect(diff.summary.files.newCount).toBe(1); // payment.test.js
        expect(diff.summary.files.removedCount).toBe(1); // legacy.test.js
        expect(diff.summary.files.modifiedCount).toBe(1); // order.test.js modified

        // Test case-level diffs
        expect(diff.summary.tests.newCount).toBe(1);
        expect(diff.summary.tests.modifiedCount).toBe(1);
        expect(diff.summary.tests.unchangedCount).toBe(1);
        expect(diff.summary.tests.removedCount).toBe(1);
    });

    // 6. Không đưa output Generate chưa hoàn chỉnh thành current version
    it("Requirement 6: Never allows incomplete, failed, or canceled Generate jobs to overwrite current active version", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: "snap-1",
            projectId: "proj-1",
            rootDir: tempDir,
            commitSha: "abc1234"
        });

        prismaMock.job.findMany.mockResolvedValue([
            { id: "job-g-incomplete", type: "AI_TESTS", status: "CANCELED", createdAt: new Date("2026-10-14T10:00:00Z") },
            { id: "job-g-failed", type: "AI_TESTS", status: "FAILED", createdAt: new Date("2026-10-14T09:00:00Z") },
            { id: "job-g-valid", type: "AI_TESTS", status: "SUCCESS", createdAt: new Date("2026-10-14T08:00:00Z"), finishedAt: new Date("2026-10-14T08:05:00Z") }
        ]);

        prismaMock.testRun.findMany.mockResolvedValue([]);

        const history = await getIntegrationVersionHistoryService("snap-1");

        expect(history.currentVersions.generate).not.toBeNull();
        expect(history.currentVersions.generate.jobId).toBe("job-g-valid");
        expect(history.currentVersions.generate.status).toBe("SUCCESS");
    });

    // 7. Mỗi TestRun gắn đúng snapshot và test suite version
    it("Requirement 7: Links each TestRun to snapshot, test suite, and scenarios without losing runtime evidence", () => {
        const runA = {
            id: "run-alpha",
            snapshotId: "snap-1",
            testSuiteVersion: "suite-v1",
            coveragePct: 75.0,
            durationMs: 1200,
            scenarios: [
                { testName: "GET /api/items", status: "PASSED", durationMs: 250 },
                { testName: "POST /api/items", status: "FAILED", durationMs: 310 }
            ]
        };

        const runB = {
            id: "run-beta",
            snapshotId: "snap-1",
            testSuiteVersion: "suite-v2",
            coveragePct: 82.5,
            durationMs: 950,
            scenarios: [
                { testName: "GET /api/items", status: "PASSED", durationMs: 220 },
                { testName: "POST /api/items", status: "PASSED", durationMs: 280 }, // FIX
                { testName: "DELETE /api/items/:id", status: "PASSED", durationMs: 190 } // NEW
            ]
        };

        const comparison = compareTestRuns(runA, runB);

        expect(comparison.runA.id).toBe("run-alpha");
        expect(comparison.runB.id).toBe("run-beta");
        expect(comparison.summary.fixesCount).toBe(1); // POST /api/items became PASSED
        expect(comparison.summary.regressionsCount).toBe(0);
        expect(comparison.summary.passToPassCount).toBe(1); // GET /api/items
        expect(comparison.summary.newTestsCount).toBe(1); // DELETE /api/items/:id
        expect(comparison.summary.coverageDelta).toBe(7.5); // 82.5 - 75.0
        expect(comparison.summary.durationDeltaMs).toBe(-250); // Faster by 250ms
    });

    // 8. Run Tests bị hủy vẫn giữ evidence đã thu được và không bịa kết quả
    it("Requirement 8: Preserves observed runtime evidence when Run Tests is canceled without fabricating passes", () => {
        const canceledRun = {
            id: "run-canceled",
            status: "CANCELED",
            totalTests: 4,
            passedTests: 1,
            failedTests: 1,
            scenarios: [
                { testName: "GET /api/health", status: "PASSED" },
                { testName: "GET /api/users", status: "FAILED" },
                { testName: "POST /api/checkout", status: "UNEXECUTED" },
                { testName: "POST /api/payment", status: "UNEXECUTED" }
            ]
        };

        const activeRun = {
            id: "run-active",
            status: "PASSED",
            totalTests: 4,
            passedTests: 4,
            scenarios: [
                { testName: "GET /api/health", status: "PASSED" },
                { testName: "GET /api/users", status: "PASSED" },
                { testName: "POST /api/checkout", status: "PASSED" },
                { testName: "POST /api/payment", status: "PASSED" }
            ]
        };

        const comparison = compareTestRuns(canceledRun, activeRun);

        // Unexecuted tests in run A are not treated as PASSED
        const checkoutTransition = comparison.transitions.find(t => t.testName === "POST /api/checkout");
        expect(checkoutTransition.statusA).toBe("UNEXECUTED");
        expect(checkoutTransition.statusB).toBe("PASSED");
    });

    // 9. So sánh lịch sử không trộn các snapshot hoặc project
    it("Requirement 9: Enforces strict snapshot isolation; rejects non-existent snapshots", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue(null);

        await expect(getIntegrationVersionHistoryService("non-existent-snap"))
            .rejects
            .toThrow("Snapshot not found");
    });

    // 10. Kết quả phiên trước vẫn truy cập được trong lúc operation mới chạy
    it("Requirement 10: Ensures previous version remains fully readable while a new operation is actively running", async () => {
        // Create an archived version artifact on disk
        const previousJobId = "job-analyze-prev";
        archiveVersionArtifact(tempDir, previousJobId, "ANALYZE", {
            endpoints: [{ method: "GET", path: "/api/health" }]
        });

        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: "snap-active-job",
            projectId: "proj-1",
            rootDir: tempDir
        });

        prismaMock.job.findMany.mockResolvedValue([
            { id: "job-analyze-running", type: "ANALYSIS", status: "RUNNING", createdAt: new Date() },
            { id: previousJobId, type: "ANALYSIS", status: "SUCCESS", createdAt: new Date("2026-10-14T07:00:00Z"), finishedAt: new Date("2026-10-14T07:02:00Z") }
        ]);

        prismaMock.testRun.findMany.mockResolvedValue([]);

        const history = await getIntegrationVersionHistoryService("snap-active-job");

        // The current successful version pointer is still the previous completed job
        expect(history.currentVersions.analyze.jobId).toBe(previousJobId);

        // Historical workspace version artifact is directly retrievable
        const historical = await getHistoricalWorkspaceVersionService("snap-active-job", previousJobId, "ANALYZE");
        expect(historical.targetId).toBe(previousJobId);
        expect(historical.data.endpoints).toHaveLength(1);
    });

    // 11. Quyền truy cập lịch sử và version metadata được kiểm tra
    it("Requirement 11: Validates authorization and project ownership for history and version endpoints", async () => {
        // 1. Unauthorized (no user)
        const reqUnauth = { params: { snapshotId: "snap-1" }, user: null };
        const resUnauth = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getIntegrationVersionHistory(reqUnauth, resUnauth);
        expect(resUnauth.status).toHaveBeenCalledWith(401);

        // 2. Forbidden (user does not own the project)
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: "snap-1",projectId:"proj-1",
            project: { ownerId: "owner-999" }
        });
        const reqForbidden = { params: { snapshotId: "snap-1" }, user: { id: "user-attacker" } };
        const resForbidden = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getIntegrationVersionHistory(reqForbidden, resForbidden);
        expect(resForbidden.status).toHaveBeenCalledWith(404);

        // 3. Compare endpoint query validation
        const reqMissingQuery = {
            params: { snapshotId: "snap-1" },
            query: { versionAId: "vA" }, // missing versionBId
            user: { id: "owner-999" }
        };
        const resMissingQuery = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await compareIntegrationVersions(reqMissingQuery, resMissingQuery);
        expect(resMissingQuery.status).toHaveBeenCalledWith(400);
    });

    // 12. Refresh UI vẫn khôi phục đúng phiên hiện hành và lịch sử
    it("Requirement 12: UI state restoration recovers identical timeline and active versions on reload", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: "snap-refresh",
            projectId: "proj-1",
            rootDir: tempDir
        });

        const timelineJobs = [
            { id: "j1", type: "ANALYSIS", status: "SUCCESS", createdAt: new Date("2026-10-14T01:00:00Z") },
            { id: "j2", type: "AI_TESTS", status: "SUCCESS", createdAt: new Date("2026-10-14T02:00:00Z") }
        ];

        prismaMock.job.findMany.mockResolvedValue(timelineJobs);
        prismaMock.testRun.findMany.mockResolvedValue([]);

        const firstFetch = await getIntegrationVersionHistoryService("snap-refresh");
        const refreshFetch = await getIntegrationVersionHistoryService("snap-refresh");

        expect(refreshFetch.currentVersions).toEqual(firstFetch.currentVersions);
        expect(refreshFetch.timeline.map(t => t.id)).toEqual(firstFetch.timeline.map(t => t.id));
    });

    // 13. Dữ liệu cũ không có đủ metadata được xử lý an toàn, không tự bịa provenance
    it("Requirement 13: Safely handles legacy records without crashing and never invents fake provenance", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: "snap-legacy",
            projectId: "proj-legacy",
            rootDir: null, // No rootDir
            commitSha: null // No git commit
        });

        // Legacy job with null resultJson and computeTimeMs
        prismaMock.job.findMany.mockResolvedValue([
            { id: "legacy-job", type: "ANALYSIS", status: "SUCCESS", resultJson: null, computeTimeMs: null, createdAt: new Date() }
        ]);
        prismaMock.testRun.findMany.mockResolvedValue([]);

        const history = await getIntegrationVersionHistoryService("snap-legacy");

        expect(history.commitSha).toBeNull();
        expect(history.timeline[0].artifactCount).toBeNull();
        expect(history.diffs.analyze).toBeNull(); // Safely null instead of error or fake data
    });

    // 14. Historical artifact inspection falls back gracefully to DB job records when disk artifact is absent
    it("Requirement 14: Historical artifact inspection falls back gracefully to DB job records when disk artifact is absent, retaining read-only guarantees and provenance", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: "snap-disk-missing",
            projectId: "proj-1",
            rootDir: path.join(tempDir, "non_existent_subdir")
        });

        // Job exists in DB with resultJson but file is NOT on disk
        const analysisJob = {
            id: "job-db-only",
            type: "ANALYSIS",
            status: "SUCCESS",
            resultJson: JSON.stringify({
                endpoints: [
                    { method: "GET", path: "/api/products", controllerMethod: "listProducts" }
                ],
                count: 1
            }),
            computeTimeMs: 420,
            createdAt: new Date("2026-10-15T08:00:00Z"),
            finishedAt: new Date("2026-10-15T08:00:01Z")
        };

        prismaMock.job.findUnique.mockResolvedValue(analysisJob);

        const historical = await getHistoricalWorkspaceVersionService("snap-disk-missing", "job-db-only", "ANALYZE");

        expect(historical.targetId).toBe("job-db-only");
        expect(historical.source).toBe("DATABASE_JOB_RECORD");
        expect(historical.isReadOnly).toBe(true);
        expect(historical.data.endpoints).toHaveLength(1);
        expect(historical.data.endpoints[0].path).toBe("/api/products");
        expect(historical.jobMetadata.durationMs).toBe(420);
    });

    // 15. Timeline items accurately expose unified durationMs and artifact evidence counts without synthesizing fake data
    it("Requirement 15: Timeline items accurately expose unified durationMs and artifact evidence counts", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: "snap-timeline-meta",
            projectId: "proj-1",
            rootDir: tempDir,
            commitSha: "sha-12345"
        });

        prismaMock.job.findMany.mockResolvedValue([
            {
                id: "job-with-calc-duration",
                type: "ANALYSIS",
                status: "SUCCESS",
                computeTimeMs: null, // missing computeTimeMs
                startedAt: new Date("2026-10-15T10:00:00Z"),
                finishedAt: new Date("2026-10-15T10:00:05Z"), // 5000ms duration
                resultJson: JSON.stringify({ endpoints: [{ path: "/api/test" }] }),
                createdAt: new Date("2026-10-15T10:00:00Z")
            }
        ]);
        prismaMock.testRun.findMany.mockResolvedValue([]);

        const history = await getIntegrationVersionHistoryService("snap-timeline-meta");
        const item = history.timeline[0];

        expect(item.durationMs).toBe(5000); // accurately calculated from finishedAt - startedAt
        expect(item.artifactCount).toBe(1); // accurately counted from endpoints array
        expect(item.revision).toBe("sha-12345");
        expect(item.isLatestSuccess).toBe(true);
    });
});

