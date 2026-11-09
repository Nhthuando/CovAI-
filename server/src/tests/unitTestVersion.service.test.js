import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";

const mockPrisma = {
    projectSnapshot: {
        findUnique: jest.fn()
    }
};

const mockCreateRunTestsJob = jest.fn().mockResolvedValue({ id: "job_test_123" });
const mockAddJobToQueue = jest.fn().mockResolvedValue(true);

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma
}));

await jest.unstable_mockModule("../services/job.service.js", () => ({
    createRunTestsJob: mockCreateRunTestsJob
}));

await jest.unstable_mockModule("../services/queue.service.js", () => ({
    addJobToQueue: mockAddJobToQueue
}));

const {
    saveUnitTestFileVersions,
    getUnitTestVersions,
    switchUnitTestVersion,
    clearManifestCache
} = await import("../services/unitTestVersion.service.js");

describe("unitTestVersion.service", () => {
    let tempDir;
    const snapshotId = "test_snapshot_ver_01";
    const projectId = "test_proj_01";
    const userId = "test_user_01";

    beforeEach(() => {
        clearManifestCache();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-ver-test-"));
        jest.clearAllMocks();

        mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
            id: snapshotId,
            projectId,
            rootDir: tempDir
        });
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    describe("saveUnitTestFileVersions", () => {
        it("creates Version 1 (Baseline) and Version 2 (Suggested) for a new test file", () => {
            const result = saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/auth.js",
                testFile: "tests/auth.test.js",
                originalContent: "",
                updatedContent: "describe('auth', () => { it('works', () => {}); });",
                framework: "jest",
                summary: "Initial unit tests",
                isExisting: false,
                status: "GENERATED"
            });

            expect(result).toBeDefined();
            expect(result.currentVersion).toBe(2);
            expect(result.isNewFile).toBe(true);
            expect(result.versions).toHaveLength(2);

            const [v1, v2] = result.versions;
            expect(v1.version).toBe(1);
            expect(v1.status).toBe("BASELINE");
            expect(v1.content).toBe("");
            expect(v1.isActive).toBe(false);

            expect(v2.version).toBe(2);
            expect(v2.status).toBe("GENERATED");
            expect(v2.content).toContain("describe('auth'");
            expect(v2.isActive).toBe(true);
        });

        it("creates Version 1 with existing content for an existing test file", () => {
            const original = "describe('old', () => { it('baseline', () => {}); });";
            const updated = "describe('new', () => { it('enhanced', () => {}); });";

            const result = saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/calculator.js",
                testFile: "tests/calculator.test.js",
                originalContent: original,
                updatedContent: updated,
                framework: "vitest",
                summary: "Branch tests added",
                isExisting: true,
                status: "APPLIED"
            });

            expect(result.isNewFile).toBe(false);
            expect(result.currentVersion).toBe(2);
            expect(result.versions[0].content).toBe(original);
            expect(result.versions[0].status).toBe("BASELINE");
            expect(result.versions[1].content).toBe(updated);
            expect(result.versions[1].status).toBe("APPLIED");
            expect(result.versions[1].isActive).toBe(true);
        });

        it("updates status without creating redundant version if content is identical", () => {
            const content = "describe('same', () => {});";

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/util.js",
                testFile: "tests/util.test.js",
                originalContent: "",
                updatedContent: content,
                status: "GENERATED"
            });

            // Second save with exact same content, but applied status
            const result = saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/util.js",
                testFile: "tests/util.test.js",
                originalContent: "",
                updatedContent: content,
                status: "APPLIED"
            });

            expect(result.versions).toHaveLength(2); // Still v1 and v2
            expect(result.versions[1].status).toBe("APPLIED");
        });

        it("creates incremental Version 3 when content changes on continuous suggestion", () => {
            const v2Content = "test v2";
            const v3Content = "test v3 with branches";

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/order.js",
                testFile: "tests/order.test.js",
                originalContent: "test v1",
                updatedContent: v2Content,
                isExisting: true,
                status: "APPLIED"
            });

            const result = saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/order.js",
                testFile: "tests/order.test.js",
                updatedContent: v3Content,
                status: "APPLIED"
            });

            expect(result.versions).toHaveLength(3);
            expect(result.currentVersion).toBe(3);
            expect(result.versions[0].isActive).toBe(false);
            expect(result.versions[1].isActive).toBe(false);
            expect(result.versions[2].isActive).toBe(true);
            expect(result.versions[2].content).toBe(v3Content);
        });
    });

    describe("getUnitTestVersions", () => {
        it("retrieves all file records and queries by specific filePath", () => {
            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/user.js",
                testFile: "tests/user.test.js",
                originalContent: "old user test",
                updatedContent: "new user test",
                isExisting: true
            });

            const all = getUnitTestVersions({ snapshotId, rootDir: tempDir });
            expect(all["tests/user.test.js"]).toBeDefined();

            const byTest = getUnitTestVersions({ snapshotId, rootDir: tempDir, filePath: "tests/user.test.js" });
            expect(byTest).toBeDefined();
            expect(byTest.testFile).toBe("tests/user.test.js");

            const bySource = getUnitTestVersions({ snapshotId, rootDir: tempDir, filePath: "src/user.js" });
            expect(bySource).toBeDefined();
            expect(bySource.sourceFile).toBe("src/user.js");

            const nonExistent = getUnitTestVersions({ snapshotId, rootDir: tempDir, filePath: "src/missing.js" });
            expect(nonExistent).toBeNull();
        });
    });

    describe("switchUnitTestVersion", () => {
        it("reverts an existing file to Version 1 (Baseline) on disk and triggers tests", async () => {
            const original = "// Original test code v1";
            const updated = "// AI updated test code v2";

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/math.js",
                testFile: "tests/math.test.js",
                originalContent: original,
                updatedContent: updated,
                isExisting: true,
                status: "APPLIED"
            });

            // Write v2 on disk initially
            const diskPath = path.join(tempDir, "tests/math.test.js");
            fs.mkdirSync(path.dirname(diskPath), { recursive: true });
            fs.writeFileSync(diskPath, updated, "utf8");

            // Rollback to Version 1
            const switchResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                filePath: "tests/math.test.js",
                targetVersion: 1,
                runTests: true
            });

            expect(switchResult.success).toBe(true);
            expect(switchResult.switchedCount).toBe(1);
            expect(switchResult.backgroundJob).toBeDefined();

            // Verify content on disk is restored to v1
            const restoredContent = fs.readFileSync(diskPath, "utf8");
            expect(restoredContent).toBe(original);

            // Verify active status in manifest
            const currentVersions = getUnitTestVersions({ snapshotId, rootDir: tempDir, filePath: "tests/math.test.js" });
            expect(currentVersions.currentVersion).toBe(1);
            expect(currentVersions.versions[0].isActive).toBe(true);
            expect(currentVersions.versions[1].isActive).toBe(false);
        });

        it("cleans up disk file when reverting a newly created test file to Version 1", async () => {
            const newContent = "// AI generated new test";

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/newFeature.js",
                testFile: "tests/newFeature.test.js",
                originalContent: "",
                updatedContent: newContent,
                isExisting: false,
                status: "APPLIED"
            });

            const diskPath = path.join(tempDir, "tests/newFeature.test.js");
            fs.mkdirSync(path.dirname(diskPath), { recursive: true });
            fs.writeFileSync(diskPath, newContent, "utf8");
            expect(fs.existsSync(diskPath)).toBe(true);

            // Rollback to Version 1 (empty new file)
            const switchResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                filePath: "tests/newFeature.test.js",
                targetVersion: 1,
                runTests: false
            });

            expect(switchResult.success).toBe(true);
            // File should be unlinked so test runner doesn't fail on empty suite
            expect(fs.existsSync(diskPath)).toBe(false);

            // Fast-forward back to Version 2
            const ffResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                filePath: "tests/newFeature.test.js",
                targetVersion: 2,
                runTests: false
            });

            expect(ffResult.success).toBe(true);
            expect(fs.existsSync(diskPath)).toBe(true);
            expect(fs.readFileSync(diskPath, "utf8")).toBe(newContent);
        });

        it("switches all files across snapshot with allFiles: true", async () => {
            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/a.js",
                testFile: "tests/a.test.js",
                originalContent: "a v1",
                updatedContent: "a v2",
                isExisting: true
            });

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/b.js",
                testFile: "tests/b.test.js",
                originalContent: "b v1",
                updatedContent: "b v2",
                isExisting: true
            });

            const switchAll = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1,
                runTests: false
            });

            expect(switchAll.success).toBe(true);
            expect(switchAll.switchedCount).toBe(2);

            const fileA = path.join(tempDir, "tests/a.test.js");
            const fileB = path.join(tempDir, "tests/b.test.js");
            expect(fs.readFileSync(fileA, "utf8")).toBe("a v1");
            expect(fs.readFileSync(fileB, "utf8")).toBe("b v1");
        });

        it("unlinks newly created test file in monorepo subpackage when reverting to Version 1", async () => {
            const serverSubdir = path.join(tempDir, "server");
            fs.mkdirSync(serverSubdir, { recursive: true });

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "server/src/db.js",
                testFile: "server/tests/db.test.js",
                originalContent: "",
                updatedContent: "describe('db tests', () => {});",
                isExisting: false,
                status: "APPLIED"
            });

            const testDiskPath = path.join(serverSubdir, "tests/db.test.js");
            fs.mkdirSync(path.dirname(testDiskPath), { recursive: true });
            fs.writeFileSync(testDiskPath, "describe('db tests', () => {});", "utf8");
            expect(fs.existsSync(testDiskPath)).toBe(true);

            // Revert to Version 1
            const revertRes = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                filePath: "server/tests/db.test.js",
                targetVersion: 1,
                runTests: false
            });

            expect(revertRes.success).toBe(true);
            expect(fs.existsSync(testDiskPath)).toBe(false);
            // Verify empty tests directory was cleaned up
            expect(fs.existsSync(path.dirname(testDiskPath))).toBe(false);
        });

        it("supports bulk rollback to Version 1 with filePath omitted or empty string when allFiles is true", async () => {
            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/user.js",
                testFile: "tests/user.test.js",
                originalContent: "// User v1 baseline",
                updatedContent: "// User v2 updated",
                isExisting: true,
                status: "APPLIED"
            });

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/order.js",
                testFile: "tests/order.test.js",
                originalContent: "",
                updatedContent: "// Order v2 new",
                isExisting: false,
                status: "APPLIED"
            });

            fs.mkdirSync(path.join(tempDir, "tests"), { recursive: true });
            const userPath = path.join(tempDir, "tests/user.test.js");
            const orderPath = path.join(tempDir, "tests/order.test.js");
            fs.writeFileSync(userPath, "// User v2 updated", "utf8");
            fs.writeFileSync(orderPath, "// Order v2 new", "utf8");

            // Bulk revert with filePath passed as empty string ""
            const res = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                filePath: "",
                allFiles: true,
                targetVersion: 1,
                runTests: false
            });

            expect(res.success).toBe(true);
            expect(res.switchedCount).toBe(2);
            expect(res.targetVersion).toBe(1);

            // User restored to baseline, Order deleted
            expect(fs.readFileSync(userPath, "utf8")).toBe("// User v1 baseline");
            expect(fs.existsSync(orderPath)).toBe(false);
        });
    });
});
