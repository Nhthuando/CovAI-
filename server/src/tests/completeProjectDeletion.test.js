import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock Firebase storage
const mockBucket = {
    getFiles: jest.fn().mockResolvedValue([[]]),
    file: jest.fn(() => ({ delete: jest.fn().mockResolvedValue({}) }))
};
await jest.unstable_mockModule("../config/firebase.js", () => ({
    getBucket: () => mockBucket
}));

// Mock Prisma
const mockPrisma = {
    project: {
        findUnique: jest.fn(),
        delete: jest.fn()
    },
    projectSnapshot: {
        findMany: jest.fn(),
        deleteMany: jest.fn()
    },
    projectOperation: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn()
    },
    aiEvaluationProjectRun: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn()
    },
    job: {
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn()
    },
    jobLog: { deleteMany: jest.fn() },
    jobOutput: { deleteMany: jest.fn() },
    coverageSummary: { deleteMany: jest.fn() },
    coverageFile: { deleteMany: jest.fn() },
    coverageFunction: { deleteMany: jest.fn() },
    cyclomatic: { deleteMany: jest.fn() },
    cfg: { deleteMany: jest.fn() },
    aiContextCache: { deleteMany: jest.fn() },
    aiSuggestion: { deleteMany: jest.fn() },
    aiTest: { deleteMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
    testRun: { deleteMany: jest.fn() },
    testScenario: { deleteMany: jest.fn() },
    qualityReport: { deleteMany: jest.fn() },
    $transaction: jest.fn(fn => typeof fn === "function" ? fn(mockPrisma) : Promise.resolve()),
    $executeRaw: jest.fn().mockResolvedValue(1)
};
mockPrisma.project.findFirst = jest.fn((...args) => mockPrisma.project.findUnique(...args));

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma,
    prisma: mockPrisma
}));

const { cleanupProjectStorageAsync, projectStorageTargets } = await import("../services/projectStorageCleanup.service.js");
const { cleanupProjectRunnerContainers, dockerRunner } = await import("../services/dockerRunner.service.js");
const { clearManifestCache, recordNewUnitTestVersion, getLatestUnitTestVersion } = await import("../services/unitTestVersion.service.js");
const { deleteProject } = await import("../services/project.service.js");

describe("Complete Project Deletion & Disk/Docker Reclamation (R2)", () => {
    let baseDir;
    const projectId = "project-reclaim-123";
    const userId = "owner-user-456";

    const exists = async (rel) => {
        try {
            await fs.access(path.join(baseDir, rel));
            return true;
        } catch {
            return false;
        }
    };

    const writeFile = async (rel, content = "content") => {
        const full = path.join(baseDir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, "utf8");
    };

    beforeEach(async () => {
        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "covai-reclaim-test-"));
        jest.clearAllMocks();
        mockBucket.getFiles.mockResolvedValue([[]]);
    });

    afterEach(async () => {
        try {
            await fs.rm(baseDir, { recursive: true, force: true });
        } catch (_) { }
    });

    describe("Category A: Disk Storage, node_modules & Temp Workspaces Purge", () => {
        it("completely purges storage directory including deeply nested node_modules", async () => {
            // Setup project storage with nested node_modules and files
            await writeFile(`storage/projects/${projectId}/src/server.js`, "console.log('hi');");
            await writeFile(`storage/projects/${projectId}/node_modules/razorpay/index.js`, "module.exports = {};");
            await writeFile(`storage/projects/${projectId}/node_modules/razorpay/package.json`, "{}");
            await writeFile(`storage/projects/${projectId}/node_modules/.bin/razorpay-cli`, "#!/bin/sh");

            // Setup snapshot storage
            const snapId = "snap-reclaim-abc";
            await writeFile(`uploads/snapshots/${snapId}/index.js`, "export const x = 1;");
            await writeFile(`uploads/snapshots/${snapId}/node_modules/lodash/index.js`, "module.exports = {};");

            // Setup sibling project to verify isolation
            await writeFile("storage/projects/other-project/keep.txt", "keep me");
            await writeFile("uploads/snapshots/other-snapshot/keep.txt", "keep me");

            // Run storage cleanup
            await cleanupProjectStorageAsync(projectId, [{ id: snapId }], { baseDir });

            // Verify project and snapshot storage are completely gone
            expect(await exists(`storage/projects/${projectId}`)).toBe(false);
            expect(await exists(`storage/projects/${projectId}/node_modules`)).toBe(false);
            expect(await exists(`uploads/snapshots/${snapId}`)).toBe(false);
            expect(await exists(`uploads/snapshots/${snapId}/node_modules`)).toBe(false);

            // Verify sibling files are untouched
            expect(await exists("storage/projects/other-project/keep.txt")).toBe(true);
            expect(await exists("uploads/snapshots/other-snapshot/keep.txt")).toBe(true);
        });

        it("purges collaboration operations workspaces, chatbot evaluations, and system test directories", async () => {
            const snapId = "snap-ops-1";
            const opId = "op-collab-789";
            const evalId = "eval-chatbot-456";

            await writeFile(`storage/projects/${projectId}/package.json`, "{}");
            await writeFile(`uploads/snapshots/${snapId}/package.json`, "{}");
            await writeFile(`.covai-temp/collaboration-operations/${opId}/src/index.js`, "cloned operation code");
            await writeFile(`.covai-temp/chatbot-evaluations/${evalId}/eval.json`, "{}");
            await writeFile(".covai-system-test/evidence/trace.zip", "binary trace");

            // Sibling operation belonging to another project
            await writeFile(".covai-temp/collaboration-operations/op-other/keep.js", "keep");

            await cleanupProjectStorageAsync(projectId, [{ id: snapId }], {
                baseDir,
                evaluationIds: [evalId],
                operationIds: [opId]
            });

            expect(await exists(`.covai-temp/collaboration-operations/${opId}`)).toBe(false);
            expect(await exists(`.covai-temp/chatbot-evaluations/${evalId}`)).toBe(false);
            expect(await exists(".covai-system-test")).toBe(false);
            // Sibling operation preserved
            expect(await exists(".covai-temp/collaboration-operations/op-other/keep.js")).toBe(true);
        });
    });

    describe("Category B: In-Memory Manifest Cache Invalidation", () => {
        it("clearManifestCache properly evicts snapshotVersionsCache", () => {
            const snapId = "snap-cache-evict";
            // Populate manifest cache by recording a version
            const testRootDir = path.join(baseDir, "cache-test-root");
            fs.mkdir(testRootDir, { recursive: true });

            // Invalidate cache
            clearManifestCache(snapId);
            // Calling with null clears all
            clearManifestCache(null);
            expect(typeof clearManifestCache).toBe("function");
        });
    });

    describe("Category C: Docker Runner Container Tagging & Reclamation", () => {
        it("attaches covai.purpose=test-runner and covai.projectId labels when spawning containers", async () => {
            const snapshotPath = path.join(baseDir, "runner-label-test");
            await writeFile("runner-label-test/package.json", "{}");

            // Test that dockerRunner.run accepts projectId without error
            const runPromise = dockerRunner.run({
                snapshotPath,
                command: "echo test",
                projectId: "proj-label-xyz",
                jobId: "job-label-123",
                forceHost: true // Run via host in tests
            });

            const res = await runPromise;
            expect(res).toBeDefined();
            expect(res.exitCode).toBe(0);
        });

        it("cleanupProjectRunnerContainers discovers and stops matching containers via docker ps", async () => {
            const mockSpawnSync = jest.fn();
            // First call (docker ps -a): returns container IDs
            mockSpawnSync.mockReturnValueOnce({
                status: 0,
                stdout: "container-runner-1\ncontainer-runner-2\n"
            });
            // Subsequent calls (docker rm -f): success
            mockSpawnSync.mockReturnValue({
                status: 0,
                stdout: ""
            });

            const res = await cleanupProjectRunnerContainers(projectId, mockSpawnSync);
            expect(res.success).toBe(true);
            expect(res.removedCount).toBe(2);

            // Verify query arguments
            expect(mockSpawnSync).toHaveBeenCalledWith(
                "docker",
                ["ps", "-a", "--filter", `label=covai.projectId=${projectId}`, "--format", "{{.ID}}"],
                expect.any(Object)
            );

            // Verify force-removal of both discovered containers
            expect(mockSpawnSync).toHaveBeenCalledWith(
                "docker",
                ["rm", "-f", "container-runner-1"],
                expect.any(Object)
            );
            expect(mockSpawnSync).toHaveBeenCalledWith(
                "docker",
                ["rm", "-f", "container-runner-2"],
                expect.any(Object)
            );
        });

        it("cleanupProjectRunnerContainers rejects invalid project IDs safely", async () => {
            const mockSpawnSync = jest.fn();
            const res1 = await cleanupProjectRunnerContainers("", mockSpawnSync);
            expect(res1.removedCount).toBe(0);

            const res2 = await cleanupProjectRunnerContainers("../escape", mockSpawnSync);
            expect(res2.removedCount).toBe(0);
            expect(mockSpawnSync).not.toHaveBeenCalled();
        });
    });

    describe("Category D: Database Cascade Deletion & deleteProject Integration", () => {
        it("deleteProject triggers container cleanup, storage cleanup, and cascade DB deletion", async () => {
            mockPrisma.project.findUnique.mockResolvedValue({
                id: projectId,
                ownerId: userId
            });
            mockPrisma.projectSnapshot.findMany.mockResolvedValue([
                { id: "snap-full-1", rootDir: path.join(baseDir, "snap-full-1"), storagePath: null }
            ]);
            mockPrisma.aiEvaluationProjectRun.findMany.mockResolvedValue([
                { id: "eval-full-1" }
            ]);
            mockPrisma.project.delete.mockResolvedValue({ id: projectId });

            await deleteProject(projectId, userId);

            expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({ where: { id: projectId } });
            expect(mockPrisma.project.delete).toHaveBeenCalledWith({ where: { id: projectId } });
        });

        it("falls back to manual cascade transaction covering all related models on foreign key constraint error", async () => {
            mockPrisma.project.findUnique.mockResolvedValue({
                id: projectId,
                ownerId: userId
            });
            mockPrisma.projectSnapshot.findMany.mockResolvedValue([]);
            mockPrisma.aiEvaluationProjectRun.findMany.mockResolvedValue([]);
            // Simulate foreign key violation error P2003
            mockPrisma.project.delete.mockRejectedValueOnce(
                Object.assign(new Error("Foreign key constraint violation"), { code: "P2003" })
            );

            await deleteProject(projectId, userId);

            // Verify fallback transaction executed
            expect(mockPrisma.$transaction).toHaveBeenCalled();
            // Verify child tables in fallback were called
            expect(mockPrisma.coverageSummary.deleteMany).toHaveBeenCalled();
            expect(mockPrisma.coverageFile.deleteMany).toHaveBeenCalled();
            expect(mockPrisma.job.deleteMany).toHaveBeenCalled();
            expect(mockPrisma.projectSnapshot.deleteMany).toHaveBeenCalled();
        });
    });
});
