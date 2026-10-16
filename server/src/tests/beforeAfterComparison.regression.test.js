import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock Prisma
const prismaMock = {
    projectSnapshot: { findUnique: jest.fn(), findMany: jest.fn() },
    project: { findUnique: jest.fn() },
    job: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    testRun: { findMany: jest.fn(), findUnique: jest.fn() },
    aiTest: { findMany: jest.fn() },
    projectStructureAnalysis: { findUnique: jest.fn() }
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/queue.service.js", () => ({
    jobQueue: { add: jest.fn(), close: jest.fn(), on: jest.fn() },
    addJobToQueue: jest.fn(),
    addSupertestCoveragePipeline: jest.fn()
}));

const {
    computeLineDiff,
    isPathExcluded,
    scanSourceDirectory,
    compareSourceCodeService,
    getSourceFileDiffService,
    categorizeScenario,
    detectTestAnomalies,
    compareEndpointCoverageDetailed,
    generateComparisonConclusions,
    getBeforeAfterComparisonService
} = await import("../services/comparison.service.js");

const {
    getBeforeAfterComparison,
    getSourceFileDiff
} = await import("../controllers/coverage.controller.js");

const {
    archiveVersionArtifact,
    getArchivedVersionArtifact,
    compareTestSuites,
    compareTestRuns
} = await import("../services/integrationVersionHistory.service.js");

describe("COVAI Phase 4 — Before/After Comparison & Quality Analysis Regression Suite", () => {
    let tempDirA;
    let tempDirB;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDirA = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase4-snapA-"));
        tempDirB = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase4-snapB-"));
    });

    afterEach(() => {
        for (const dir of [tempDirA, tempDirB]) {
            if (dir && fs.existsSync(dir)) {
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                } catch (_) {}
            }
        }
    });

    // 1. Source diff nhận diện đúng file thêm/sửa/xóa
    it("Requirement 1: Source diff accurately identifies added, modified, deleted, and unchanged files", async () => {
        // Setup snapA: file1.js, file2.js
        fs.writeFileSync(path.join(tempDirA, "file1.js"), "console.log('original 1');\nline2\n", "utf8");
        fs.writeFileSync(path.join(tempDirA, "file2.js"), "function keep() { return true; }\n", "utf8");

        // Setup snapB: file1.js deleted, file2.js modified, file3.js added
        fs.writeFileSync(path.join(tempDirB, "file2.js"), "function keep() { return false; }\n", "utf8");
        fs.writeFileSync(path.join(tempDirB, "file3.js"), "export const newlyAdded = 42;\n", "utf8");

        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        prismaMock.projectSnapshot.findUnique
            .mockResolvedValueOnce({ id: "snap-a", projectId: "proj-1", rootDir: tempDirA, commitSha: "sha-a" })
            .mockResolvedValueOnce({ id: "snap-b", projectId: "proj-1", rootDir: tempDirB, commitSha: "sha-b" });

        const result = await compareSourceCodeService({
            projectId: "proj-1",
            baselineSnapshotId: "snap-a",
            currentSnapshotId: "snap-b",
            userId: "user-1"
        });

        expect(result.comparisonAvailable).toBe(true);
        expect(result.status).toBe("SOURCE_CHANGED");
        expect(result.sourceChanged).toBe(true);
        expect(result.summary.newFilesCount).toBe(1);
        expect(result.summary.modifiedFilesCount).toBe(1);
        expect(result.summary.deletedFilesCount).toBe(1);

        const newFile = result.files.find(f => f.filePath === "file3.js");
        expect(newFile).toBeDefined();
        expect(newFile.status).toBe("NEW");

        const modFile = result.files.find(f => f.filePath === "file2.js");
        expect(modFile).toBeDefined();
        expect(modFile.status).toBe("MODIFIED");

        const delFile = result.files.find(f => f.filePath === "file1.js");
        expect(delFile).toBeDefined();
        expect(delFile.status).toBe("DELETED");
    });

    // 2. Hai revision có source giống nhau cho kết quả NO SOURCE CODE CHANGES
    it("Requirement 2: Revisions with identical source tree produce NO SOURCE CODE CHANGES", async () => {
        const fileContent = "const x = 1;\nconsole.log(x);\n";
        fs.writeFileSync(path.join(tempDirA, "app.js"), fileContent, "utf8");
        fs.writeFileSync(path.join(tempDirB, "app.js"), fileContent, "utf8");

        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        prismaMock.projectSnapshot.findUnique
            .mockResolvedValueOnce({ id: "snap-a", projectId: "proj-1", rootDir: tempDirA, commitSha: "sha-a" })
            .mockResolvedValueOnce({ id: "snap-b", projectId: "proj-1", rootDir: tempDirB, commitSha: "sha-b" });

        const result = await compareSourceCodeService({
            projectId: "proj-1",
            baselineSnapshotId: "snap-a",
            currentSnapshotId: "snap-b",
            userId: "user-1"
        });

        expect(result.comparisonAvailable).toBe(true);
        expect(result.status).toBe("NO_SOURCE_CODE_CHANGES");
        expect(result.sourceChanged).toBe(false);
        expect(result.summary.newFilesCount).toBe(0);
        expect(result.summary.modifiedFilesCount).toBe(0);
        expect(result.summary.deletedFilesCount).toBe(0);
        expect(result.summary.unchangedFilesCount).toBe(1);
        expect(result.files.length).toBe(0);
    });

    // 3. Không đưa generated artifacts vào source diff một cách mặc định
    it("Requirement 3: Generated artifacts (.covai-temp, node_modules, dist, coverage) are strictly excluded by default", () => {
        expect(isPathExcluded(".covai-temp/versions/job-1.json")).toBe(true);
        expect(isPathExcluded("node_modules/express/index.js")).toBe(true);
        expect(isPathExcluded(".git/HEAD")).toBe(true);
        expect(isPathExcluded("coverage/lcov-report/index.html")).toBe(true);
        expect(isPathExcluded("dist/bundle.js")).toBe(true);
        expect(isPathExcluded("src/controllers/auth.controller.js")).toBe(false);

        // Put excluded directory inside tempDirA
        const tempSubdir = path.join(tempDirA, ".covai-temp", "versions");
        fs.mkdirSync(tempSubdir, { recursive: true });
        fs.writeFileSync(path.join(tempSubdir, "job-xyz.json"), "{}", "utf8");
        fs.writeFileSync(path.join(tempDirA, "actualSource.js"), "module.exports = {};", "utf8");

        const scan = scanSourceDirectory(tempDirA);
        expect(scan.filesMap.has("actualSource.js")).toBe(true);
        expect(scan.filesMap.has(".covai-temp/versions/job-xyz.json")).toBe(false);
        expect(scan.excludedFiles.some(f => f.includes(".covai-temp"))).toBe(true);
    });

    // 4. Test suite diff phát hiện file/test mới, sửa, giữ nguyên và loại bỏ
    it("Requirement 4: Test suite diff detects new, modified, unchanged, and removed test cases", () => {
        const testsA = [
            { id: "t1", name: "GET /api/users returns 200", code: "test('t1', () => expect(res.status).toBe(200));" },
            { id: "t2", name: "POST /api/login fails with bad pass", code: "test('t2', () => expect(res.status).toBe(401));" },
            { id: "t3", name: "GET /api/ping responds pong", code: "test('t3', () => expect(res.status).toBe(200));" }
        ];

        const testsB = [
            // t1 removed
            // t2 modified
            { id: "t2", name: "POST /api/login fails with bad pass", code: "test('t2', () => { expect(res.status).toBe(401); expect(res.body.error).toBeDefined(); });" },
            // t3 unchanged
            { id: "t3", name: "GET /api/ping responds pong", code: "test('t3', () => expect(res.status).toBe(200));" },
            // t4 added
            { id: "t4", name: "GET /api/profile requires token", code: "test('t4', () => expect(res.status).toBe(401));" }
        ];

        const diff = compareTestSuites(testsA, testsB);

        expect(diff.summary.newTestsCount).toBe(1);
        expect(diff.summary.modifiedTestsCount).toBe(1);
        expect(diff.summary.unchangedTestsCount).toBe(1);
        expect(diff.summary.removedTestsCount).toBe(1);

        const newT = diff.tests.find(t => t.testName === "GET /api/profile requires token");
        expect(newT.diffStatus).toBe("NEW");

        const modT = diff.tests.find(t => t.testName === "POST /api/login fails with bad pass");
        expect(modT.diffStatus).toBe("MODIFIED");

        const remT = diff.tests.find(t => t.testName === "GET /api/users returns 200");
        expect(remT.diffStatus).toBe("REMOVED");
    });

    // 5. Không kết luận coverage tăng chỉ dựa vào tổng số test
    it("Requirement 5: Does NOT conclude test coverage increased just because total test count increased", () => {
        const endpointsA = [
            { method: "GET", path: "/api/users" },
            { method: "POST", path: "/api/orders" }
        ];
        const endpointsB = [
            { method: "GET", path: "/api/users" },
            { method: "POST", path: "/api/orders" }
        ];

        // Version A has 1 test on /api/users -> 1/2 endpoints covered = 50%
        const testsA = [
            { id: "t1", method: "GET", path: "/api/users", code: "expect(200)" }
        ];

        // Version B has 10 tests, but ALL 10 tests still only target /api/users!
        // /api/orders is still untested -> 1/2 endpoints covered = 50%
        const testsB = Array.from({ length: 10 }, (_, i) => ({
            id: `t_${i}`,
            method: "GET",
            path: "/api/users",
            code: `expect(200); // variation ${i}`
        }));

        const coverageDiff = compareEndpointCoverageDetailed(endpointsA, endpointsB, testsA, testsB);

        expect(coverageDiff.metrics.testCount.baseline).toBe(1);
        expect(coverageDiff.metrics.testCount.current).toBe(10);
        expect(coverageDiff.metrics.testCount.delta).toBe(9); // +9 tests

        expect(coverageDiff.metrics.endpointCoverage.baseline.covered).toBe(1);
        expect(coverageDiff.metrics.endpointCoverage.current.covered).toBe(1);
        expect(coverageDiff.metrics.endpointCoverage.deltaPct).toBe(0); // Coverage pct unchanged!

        const conclusions = generateComparisonConclusions({
            coverageDiff
        });

        // Must be TEST_COVERAGE_UNCHANGED, NOT TEST_COVERAGE_INCREASED
        expect(conclusions.testCoverageStatus).toBe("TEST_COVERAGE_UNCHANGED");
        expect(conclusions.testCoverageStatus).not.toBe("TEST_COVERAGE_INCREASED");
    });

    // 6. Runtime diff phát hiện đúng PASS->FAIL và FAIL->PASS
    it("Requirement 6: Runtime diff correctly detects regressions (PASS->FAIL) and fixes (FAIL->PASS)", () => {
        const runA = {
            id: "run-a",
            status: "SUCCESS",
            scenarios: [
                { testName: "User Registration", status: "PASSED" },
                { testName: "Order Checkout", status: "FAILED" },
                { testName: "Health Check", status: "PASSED" }
            ]
        };

        const runB = {
            id: "run-b",
            status: "FAILED",
            scenarios: [
                { testName: "User Registration", status: "FAILED" }, // Regression!
                { testName: "Order Checkout", status: "PASSED" },    // Fix!
                { testName: "Health Check", status: "PASSED" }       // Stable
            ]
        };

        const runtimeDiff = compareTestRuns(runA, runB);
        expect(runtimeDiff.summary.regressionsCount).toBe(1);
        expect(runtimeDiff.summary.fixesCount).toBe(1);
        expect(runtimeDiff.summary.stablePassCount).toBe(1);

        const conclusions = generateComparisonConclusions({ runtimeDiff });
        expect(conclusions.runtimeStatus).toBe("RUNTIME_REGRESSION_DETECTED");
        expect(conclusions.hasRegressions).toBe(true);
    });

    // 7. Test chưa chạy không bị tính là PASS
    it("Requirement 7: Unexecuted, skipped, or cancelled tests are NOT counted as PASS", () => {
        const scenario1 = { testName: "Skip Me", status: "SKIPPED" };
        const scenario2 = { testName: "Cancel Me", status: "CANCELLED" };
        const scenario3 = { testName: "Pending Me", status: "RUNNING" };

        const runA = { id: "ra", scenarios: [] };
        const runB = { id: "rb", scenarios: [scenario1, scenario2, scenario3] };

        const runtimeDiff = compareTestRuns(runA, runB);
        expect(runtimeDiff.summary.stablePassCount).toBe(0);
        expect(runtimeDiff.summary.fixesCount).toBe(0);
    });

    // 8. Không trộn dữ liệu hai snapshot/project
    it("Requirement 8: Enforces project and snapshot isolation; rejects cross-project snapshot comparison", async () => {
        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        // snapA belongs to proj-1, but snapB belongs to proj-999
        prismaMock.projectSnapshot.findUnique
            .mockResolvedValueOnce({ id: "snap-a", projectId: "proj-1", rootDir: tempDirA })
            .mockResolvedValueOnce({ id: "snap-b", projectId: "proj-999", rootDir: tempDirB });

        await expect(compareSourceCodeService({
            projectId: "proj-1",
            baselineSnapshotId: "snap-a",
            currentSnapshotId: "snap-b",
            userId: "user-1"
        })).rejects.toThrow("Snapshots do not belong to the specified project");
    });

    // 9. Cảnh báo khi source revision hoặc test suite version khác nhau
    it("Requirement 9: Emits explicit comparability warnings when TestRuns have different revisions or suite versions", () => {
        const runtimeDiff = {
            runA: { id: "ra", snapshotId: "snap-1", testSuiteVersion: 1 },
            runB: { id: "rb", snapshotId: "snap-2", testSuiteVersion: 2 },
            summary: { totalCompared: 5, regressionsCount: 0, fixesCount: 0 }
        };

        const conclusions = generateComparisonConclusions({ runtimeDiff });
        expect(conclusions.warnings.length).toBe(2);
        expect(conclusions.warnings[0]).toContain("different snapshot source revisions");
        expect(conclusions.warnings[1]).toContain("different test suite versions");
    });

    // 10. Thiếu artifact lịch sử được xử lý rõ ràng, không dựng dữ liệu giả
    it("Requirement 10: Safely handles missing historical directory/artifact with INSUFFICIENT_EVIDENCE", async () => {
        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        // Non-existent directory
        prismaMock.projectSnapshot.findUnique
            .mockResolvedValueOnce({ id: "snap-a", projectId: "proj-1", rootDir: "/non/existent/dir/a" })
            .mockResolvedValueOnce({ id: "snap-b", projectId: "proj-1", rootDir: tempDirB });

        const result = await compareSourceCodeService({
            projectId: "proj-1",
            baselineSnapshotId: "snap-a",
            currentSnapshotId: "snap-b",
            userId: "user-1"
        });

        expect(result.comparisonAvailable).toBe(false);
        expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
        expect(result.reason).toContain("unavailable on disk");
    });

    // 11. Quyền truy cập khi tải source và history comparison được kiểm tra
    it("Requirement 11: Access authorization verified (401/403/404) for comparison endpoints", async () => {
        // 1. Controller without auth
        const reqUnauth = { params: { projectId: "proj-1" }, user: null };
        const resUnauth = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getBeforeAfterComparison(reqUnauth, resUnauth);
        expect(resUnauth.status).toHaveBeenCalledWith(401);

        // 2. Forbidden user
        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1", ownerId: "user-owner" });
        const reqForbidden = { params: { projectId: "proj-1" }, user: { id: "user-attacker" }, query: {} };
        const resForbidden = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getBeforeAfterComparison(reqForbidden, resForbidden);
        expect(resForbidden.status).toHaveBeenCalledWith(403);
    });

    // 12. Hủy hoặc chạy Job mới không ghi đè các phiên bản dùng làm baseline
    it("Requirement 12: Archiving a new or cancelled Job version does NOT overwrite baseline version files", () => {
        const job1Data = { tests: [{ name: "t1" }], endpoints: [{ path: "/p1" }] };
        const job2Data = { tests: [{ name: "t2" }], endpoints: [{ path: "/p2" }] };

        // Save baseline job-1
        archiveVersionArtifact(tempDirA, "job-1", "AI_TESTS", job1Data);

        // Baseline exists and has job1Data
        const baselineArtifact = getArchivedVersionArtifact(tempDirA, "job-1");
        expect(baselineArtifact.data.tests[0].name).toBe("t1");

        // Save job-2 (e.g. cancelled or second run)
        archiveVersionArtifact(tempDirA, "job-2", "AI_TESTS", job2Data);

        // Baseline job-1 remains completely intact
        const baselineAfter = getArchivedVersionArtifact(tempDirA, "job-1");
        expect(baselineAfter.data.tests[0].name).toBe("t1");

        // Job-2 has its own isolated file
        const job2Artifact = getArchivedVersionArtifact(tempDirA, "job-2");
        expect(job2Artifact.data.tests[0].name).toBe("t2");
    });

    // 13. getSourceFileDiffService produces accurate line-by-line diff between baseline and current
    it("Requirement 13: getSourceFileDiffService produces line-by-line diff with additions and deletions", async () => {
        fs.writeFileSync(path.join(tempDirA, "server.js"), "const a = 1;\nconst b = 2;\n", "utf8");
        fs.writeFileSync(path.join(tempDirB, "server.js"), "const a = 1;\nconst b = 99;\nconst c = 3;\n", "utf8");

        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        prismaMock.projectSnapshot.findUnique
            .mockResolvedValueOnce({ id: "snap-a", storagePath: tempDirA, rootDir: tempDirA })
            .mockResolvedValueOnce({ id: "snap-b", storagePath: tempDirB, rootDir: tempDirB });

        const diffResult = await getSourceFileDiffService({
            projectId: "proj-1",
            baselineSnapshotId: "snap-a",
            currentSnapshotId: "snap-b",
            filePath: "server.js",
            userId: "user-1"
        });

        expect(diffResult.filePath).toBe("server.js");
        expect(diffResult.existsInBaseline).toBe(true);
        expect(diffResult.existsInCurrent).toBe(true);
        expect(diffResult.diff.additions).toBeGreaterThan(0);
        expect(diffResult.diff.deletions).toBeGreaterThan(0);
    });

    // 14. Full integration flow of getBeforeAfterComparisonService across two different snapshots
    it("Requirement 14: Full integration flow of getBeforeAfterComparisonService across two different snapshots", async () => {
        // Source files in Snap A
        fs.writeFileSync(path.join(tempDirA, "auth.js"), "const login = () => true;\n", "utf8");
        fs.writeFileSync(path.join(tempDirA, "user.js"), "const user = () => 'user';\n", "utf8");

        // Source files in Snap B (auth modified, user deleted, order new)
        fs.writeFileSync(path.join(tempDirB, "auth.js"), "const login = () => {\n  validate();\n  return true;\n};\n", "utf8");
        fs.writeFileSync(path.join(tempDirB, "order.js"), "const order = () => 'order';\n", "utf8");

        // Mock snapshots
        prismaMock.project.findUnique.mockResolvedValue({ id: "proj-1", ownerId: "user-1" });
        prismaMock.projectSnapshot.findUnique.mockImplementation(({ where }) => {
            if (where.id === "snap-a") {
                return Promise.resolve({ id: "snap-a", projectId: "proj-1", rootDir: tempDirA, commitSha: "sha-a" });
            }
            if (where.id === "snap-b") {
                return Promise.resolve({ id: "snap-b", projectId: "proj-1", rootDir: tempDirB, commitSha: "sha-b" });
            }
            return Promise.resolve(null);
        });

        // Archive test suite artifacts
        archiveVersionArtifact(tempDirA, "job-gen-a", "AI_TESTS", {
            tests: [
                { id: "t1", name: "User Registration", method: "GET", path: "/api/users", code: "expect(200)" },
                { id: "t2", name: "User Login", method: "POST", path: "/api/login", code: "expect(200)" }
            ],
            endpoints: [
                { method: "GET", path: "/api/users" },
                { method: "POST", path: "/api/login" }
            ]
        });

        archiveVersionArtifact(tempDirB, "job-gen-b", "AI_TESTS", {
            tests: [
                { id: "t2", name: "User Login", method: "POST", path: "/api/login", code: "expect(200); expect(res.body.token)" },
                { id: "t3", name: "Create Order", method: "POST", path: "/api/orders", code: "expect(201)" }
            ],
            endpoints: [
                { method: "POST", path: "/api/login" },
                { method: "POST", path: "/api/orders" }
            ]
        });

        // Mock jobs for artifact discovery
        prismaMock.job.findFirst.mockImplementation(({ where }) => {
            if (where.snapshotId === "snap-a") return Promise.resolve({ id: "job-gen-a" });
            if (where.snapshotId === "snap-b") return Promise.resolve({ id: "job-gen-b" });
            return Promise.resolve(null);
        });

        // Mock test runs
        prismaMock.testRun.findUnique.mockImplementation(({ where }) => {
            if (where.id === "run-a") {
                return Promise.resolve({
                    id: "run-a",
                    snapshotId: "snap-a",
                    status: "SUCCESS",
                    scenarios: [
                        { testName: "User Registration", status: "PASSED" },
                        { testName: "User Login", status: "FAILED" }
                    ]
                });
            }
            if (where.id === "run-b") {
                return Promise.resolve({
                    id: "run-b",
                    snapshotId: "snap-b",
                    status: "FAILED",
                    scenarios: [
                        { testName: "User Registration", status: "FAILED" }, // REGRESSION
                        { testName: "User Login", status: "PASSED" }         // FIX
                    ]
                });
            }
            return Promise.resolve(null);
        });

        const comparison = await getBeforeAfterComparisonService({
            projectId: "proj-1",
            baselineSnapshotId: "snap-a",
            currentSnapshotId: "snap-b",
            baselineRunId: "run-a",
            currentRunId: "run-b",
            userId: "user-1"
        });

        // 1. Source Diff assertions
        expect(comparison.sourceDiff.status).toBe("SOURCE_CHANGED");
        expect(comparison.sourceDiff.sourceChanged).toBe(true);
        expect(comparison.sourceDiff.summary.newFilesCount).toBe(1);
        expect(comparison.sourceDiff.summary.modifiedFilesCount).toBe(1);
        expect(comparison.sourceDiff.summary.deletedFilesCount).toBe(1);
        expect(comparison.sourceDiff.summary.totalAdditions).toBeGreaterThan(0);
        expect(comparison.sourceDiff.summary.totalDeletions).toBeGreaterThan(0);

        // 2. Test Suite Diff assertions
        expect(comparison.testDiff.summary.newTestsCount).toBe(1);
        expect(comparison.testDiff.summary.modifiedTestsCount).toBe(1);
        expect(comparison.testDiff.summary.removedTestsCount).toBe(1);

        // 3. Runtime Diff assertions
        expect(comparison.runtimeDiff.summary.regressionsCount).toBe(1);
        expect(comparison.runtimeDiff.summary.fixesCount).toBe(1);
        expect(comparison.runtimeDiff.summary.passToPassCount).toBe(0);

        // 4. Evidence-based conclusions
        expect(comparison.conclusions.sourceStatus).toBe("SOURCE_CHANGED");
        expect(comparison.conclusions.runtimeStatus).toBe("RUNTIME_REGRESSION_DETECTED");
        expect(comparison.conclusions.hasRegressions).toBe(true);
        expect(comparison.conclusions.hasImprovements).toBe(true);
        expect(comparison.conclusions.warnings.length).toBeGreaterThan(0);
        expect(comparison.conclusions.warnings[0]).toContain("different snapshot source revisions");
    });
});
