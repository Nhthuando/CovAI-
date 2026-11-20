import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
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
        findUnique: jest.fn(),
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
const { cleanupProjectRunnerContainers } = await import("../services/dockerRunner.service.js");
const { clearManifestCache, loadManifest, getUnitTestVersions, switchUnitTestVersion, saveUnitTestFileVersions } = await import("../services/unitTestVersion.service.js");
const { deleteProject } = await import("../services/project.service.js");

describe("Challenger 2 Empirical Stress Harness: Requirement R2 (Complete Project Deletion)", () => {
    let baseDir;
    const projectId = "proj-stress-test-101";
    const userId = "user-stress-evaluator";

    const exists = async (rel) => {
        try {
            await fs.access(path.join(baseDir, rel));
            return true;
        } catch {
            return false;
        }
    };

    const writeFile = async (rel, content = "stress content") => {
        const full = path.join(baseDir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, "utf8");
        return full;
    };

    beforeEach(async () => {
        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "covai-challenger2-"));
        jest.clearAllMocks();
        mockBucket.getFiles.mockResolvedValue([[]]);
    });

    afterEach(async () => {
        try {
            // Restore write permissions recursively so temp cleanup succeeds
            const makeWritable = async (dir) => {
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            await fs.chmod(full, 0o777).catch(() => {});
                            await makeWritable(full);
                        } else {
                            await fs.chmod(full, 0o666).catch(() => {});
                        }
                    }
                } catch (_) {}
            };
            await makeWritable(baseDir);
            await fs.rm(baseDir, { recursive: true, force: true });
        } catch (_) { }
    });

    describe("Adversarial Dimension 1: Windows Read-Only Files & Deep Directory Nesting", () => {
        it("successfully purges deep 12-level nested node_modules with read-only attributes on Windows", async () => {
            const snapId = "snap-deep-nest";
            const deepRelDir = `storage/projects/${projectId}/node_modules/@pkg/level1/level2/level3/level4/level5/level6/level7/level8/level9/level10/dist`;
            
            const file1 = await writeFile(`${deepRelDir}/bundle.min.js`, "/* read only bundle */");
            const file2 = await writeFile(`${deepRelDir}/bundle.min.js.map`, "/* map */");
            const file3 = await writeFile(`storage/projects/${projectId}/node_modules/.bin/cli`, "#!/usr/bin/env node");
            const snapFile = await writeFile(`uploads/snapshots/${snapId}/src/app.js`, "const x = 1;");

            // Mark files read-only via fs.chmod (0o444)
            await fs.chmod(file1, 0o444);
            await fs.chmod(file2, 0o444);
            await fs.chmod(file3, 0o444);

            // On Windows, explicitly apply the OS read-only attribute flag via attrib +r
            if (process.platform === "win32") {
                try {
                    execSync(`attrib +r "${file1}"`);
                    execSync(`attrib +r "${file2}"`);
                } catch (_) {}
            }

            // Also test directory with restricted permissions
            const restrictedDir = path.dirname(file1);
            await fs.chmod(restrictedDir, 0o555).catch(() => {});

            // Run storage cleanup
            await cleanupProjectStorageAsync(projectId, [{ id: snapId }], { baseDir });

            // Assert entire storage directory and nested files are purged
            expect(await exists(`storage/projects/${projectId}`)).toBe(false);
            expect(await exists(deepRelDir)).toBe(false);
            expect(await exists(`uploads/snapshots/${snapId}`)).toBe(false);
        });

        it("handles empty subdirectories and locked directory trees gracefully", async () => {
            const snapId = "snap-empty-dirs";
            await writeFile(`storage/projects/${projectId}/empty1/empty2/empty3/file.txt`, "data");
            await writeFile(`storage/projects/${projectId}/node_modules/razorpay/LICENSE`, "MIT");

            const licFile = path.join(baseDir, `storage/projects/${projectId}/node_modules/razorpay/LICENSE`);
            await fs.chmod(licFile, 0o444);

            await cleanupProjectStorageAsync(projectId, [{ id: snapId }], { baseDir });

            expect(await exists(`storage/projects/${projectId}`)).toBe(false);
            expect(await exists(`storage/projects/${projectId}/empty1`)).toBe(false);
        });
    });

    describe("Adversarial Dimension 2: Temporary Collaboration Workspaces (.covai-temp/collaboration-operations)", () => {
        it("purges collaboration operations workspaces associated with the project and snapshots", async () => {
            const snapId = "snap-collab-1";
            const opId1 = "op-proj-direct";
            const opId2 = "op-snap-associated";
            const opOther = "op-unrelated-project";

            await writeFile(`storage/projects/${projectId}/package.json`, "{}");
            await writeFile(`uploads/snapshots/${snapId}/package.json`, "{}");
            await writeFile(`.covai-temp/collaboration-operations/${opId1}/workspace.js`, "op1 code");
            await writeFile(`.covai-temp/collaboration-operations/${opId2}/workspace.js`, "op2 code");
            await writeFile(`.covai-temp/collaboration-operations/${opOther}/workspace.js`, "other project code");

            // Mock DB resolution of project operations
            mockPrisma.projectOperation.findMany.mockResolvedValueOnce([
                { id: opId1 },
                { id: opId2 }
            ]);

            await cleanupProjectStorageAsync(projectId, [{ id: snapId }], { baseDir });

            // Project-associated operations are deleted
            expect(await exists(`.covai-temp/collaboration-operations/${opId1}`)).toBe(false);
            expect(await exists(`.covai-temp/collaboration-operations/${opId2}`)).toBe(false);

            // Unrelated project operation is strictly isolated and preserved
            expect(await exists(`.covai-temp/collaboration-operations/${opOther}`)).toBe(true);
        });

        it("handles explicit operationIds parameter without querying Prisma", async () => {
            const opExplicit = "op-explicit-99";
            await writeFile(`.covai-temp/collaboration-operations/${opExplicit}/index.js`, "test");

            await cleanupProjectStorageAsync(projectId, [], {
                baseDir,
                operationIds: [opExplicit]
            });

            expect(await exists(`.covai-temp/collaboration-operations/${opExplicit}`)).toBe(false);
        });

        it("survives missing .covai-temp/collaboration-operations directory without errors", async () => {
            // When .covai-temp does not exist on disk
            await expect(
                cleanupProjectStorageAsync(projectId, [], { baseDir })
            ).resolves.toBeUndefined();
        });
    });

    describe("Adversarial Dimension 3: Docker Runner Containers (Running, Exited, Label Filtering)", () => {
        it("identifies and force-removes all containers matching covai.projectId", async () => {
            const mockSpawnSync = jest.fn();

            // First call: docker ps query returns running container and exited container
            mockSpawnSync.mockReturnValueOnce({
                status: 0,
                stdout: "runner-container-running-1\nrunner-container-exited-2\n"
            });
            // Subsequent calls: docker rm -f succeeds
            mockSpawnSync.mockReturnValue({
                status: 0,
                stdout: ""
            });

            const res = await cleanupProjectRunnerContainers(projectId, mockSpawnSync);

            expect(res.success).toBe(true);
            expect(res.removedCount).toBe(2);

            expect(mockSpawnSync).toHaveBeenNthCalledWith(
                1,
                "docker",
                ["ps", "-a", "--filter", `label=covai.projectId=${projectId}`, "--format", "{{.ID}}"],
                expect.any(Object)
            );
            expect(mockSpawnSync).toHaveBeenNthCalledWith(
                2,
                "docker",
                ["rm", "-f", "runner-container-running-1"],
                expect.any(Object)
            );
            expect(mockSpawnSync).toHaveBeenNthCalledWith(
                3,
                "docker",
                ["rm", "-f", "runner-container-exited-2"],
                expect.any(Object)
            );
        });

        it("returns removedCount 0 when no containers match the project label", async () => {
            const mockSpawnSync = jest.fn().mockReturnValueOnce({
                status: 0,
                stdout: ""
            });

            const res = await cleanupProjectRunnerContainers(projectId, mockSpawnSync);
            expect(res.success).toBe(true);
            expect(res.removedCount).toBe(0);
            expect(mockSpawnSync).toHaveBeenCalledTimes(1);
        });
    });

    describe("Adversarial Dimension 4: Docker Daemon Unresponsive / Missing / Error Resilience", () => {
        it("handles Docker daemon connection failure gracefully without throwing", async () => {
            const mockSpawnSync = jest.fn().mockReturnValueOnce({
                status: 1,
                stdout: "",
                stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
            });

            const res = await cleanupProjectRunnerContainers(projectId, mockSpawnSync);
            expect(res.success).toBe(true);
            expect(res.removedCount).toBe(0);
        });

        it("handles Docker CLI missing (ENOENT) gracefully without crashing", async () => {
            const mockSpawnSync = jest.fn().mockImplementationOnce(() => {
                const err = new Error("spawnSync docker ENOENT");
                err.code = "ENOENT";
                throw err;
            });

            const res = await cleanupProjectRunnerContainers(projectId, mockSpawnSync);
            expect(res.success).toBe(false);
            expect(res.error).toContain("ENOENT");
            expect(res.removedCount).toBe(0);
        });

        it("handles individual container rm failure while continuing with remaining containers", async () => {
            const mockSpawnSync = jest.fn();
            // Discovered 2 containers
            mockSpawnSync.mockReturnValueOnce({
                status: 0,
                stdout: "container-locked-1\ncontainer-normal-2\n"
            });
            // First container rm fails (e.g. removal already in progress)
            mockSpawnSync.mockImplementationOnce(() => {
                throw new Error("removal of container is already in progress");
            });
            // Second container rm succeeds
            mockSpawnSync.mockReturnValueOnce({
                status: 0,
                stdout: ""
            });

            const res = await cleanupProjectRunnerContainers(projectId, mockSpawnSync);
            // Must not abort; both containers attempted
            expect(mockSpawnSync).toHaveBeenCalledTimes(3);
            expect(res.success).toBe(true);
            expect(res.removedCount).toBe(2);
        });

        it("deleteProject service proceeds and completes even if Docker container cleanup encounters errors", async () => {
            mockPrisma.project.findUnique.mockResolvedValue({
                id: projectId,
                ownerId: userId
            });
            mockPrisma.projectSnapshot.findMany.mockResolvedValue([]);
            mockPrisma.aiEvaluationProjectRun.findMany.mockResolvedValue([]);
            mockPrisma.project.delete.mockResolvedValue({ id: projectId });

            // Even if Docker fails internally, deleteProject must not reject
            await expect(deleteProject(projectId, userId)).resolves.toBeUndefined();
            expect(mockPrisma.project.delete).toHaveBeenCalledWith({ where: { id: projectId } });
        });
    });

    describe("Adversarial Dimension 5: In-Memory Manifest Cache Post-Deletion Access", () => {
        it("invalidates in-memory manifest cache and guarantees safe null/empty responses post-deletion", async () => {
            const snapId = "snap-manifest-cache-stress";
            const projectRoot = path.join(baseDir, `storage/projects/${projectId}`);
            await fs.mkdir(projectRoot, { recursive: true });

            // 1. Populate manifest cache
            saveUnitTestFileVersions({
                snapshotId: snapId,
                rootDir: projectRoot,
                projectId,
                sourceFile: "src/calc.js",
                testFile: "src/calc.test.js",
                originalContent: "test('a', () => {});",
                updatedContent: "test('a', () => {}); test('b', () => {});",
                framework: "jest",
                status: "APPLIED"
            });

            // 2. Verify cache hit prior to deletion
            const cachedManifest = loadManifest({ snapshotId: snapId, rootDir: projectRoot });
            expect(cachedManifest).toBeDefined();
            expect(cachedManifest.files["src/calc.test.js"]).toBeDefined();

            // 3. Purge storage and clear cache via cleanupProjectStorageAsync
            await cleanupProjectStorageAsync(projectId, [{ id: snapId }], { baseDir });

            // 4. Post-deletion: loadManifest must return null (not stale cached object)
            const postDeleteManifest = loadManifest({ snapshotId: snapId, rootDir: projectRoot });
            expect(postDeleteManifest).toBeNull();

            // 5. Post-deletion: getUnitTestVersions must return {} without throwing
            const versions = getUnitTestVersions({ snapshotId: snapId, rootDir: projectRoot });
            expect(versions).toEqual({});

            // 6. Post-deletion: switchUnitTestVersion must throw 404
            mockPrisma.projectSnapshot.findUnique.mockResolvedValueOnce(null);
            await expect(
                switchUnitTestVersion({
                    snapshotId: snapId,
                    projectId,
                    userId,
                    allFiles: true
                })
            ).rejects.toMatchObject({ statusCode: 404 });
        });
    });

    describe("Adversarial Dimension 6: Database Cascade Fallback with Missing/Undefined Models", () => {
        it("resiliently cascades deletes even when optional Prisma models are undefined", async () => {
            mockPrisma.project.findUnique.mockResolvedValue({
                id: projectId,
                ownerId: userId
            });
            mockPrisma.projectSnapshot.findMany.mockResolvedValue([]);
            mockPrisma.aiEvaluationProjectRun.findMany.mockResolvedValue([]);

            const txFailing = {
                ...mockPrisma,
                project: {
                    findFirst: jest.fn().mockResolvedValue({ id: projectId, ownerId: userId, workspaceRevision: 0 }),
                    findUnique: jest.fn().mockResolvedValue({ id: projectId, ownerId: userId, workspaceRevision: 0 }),
                    delete: jest.fn().mockRejectedValue(Object.assign(new Error("FK violation"), { code: "P2003" }))
                }
            };

            // Create a tx mock where some optional models are null/undefined
            const txFallbackMock = {
                ...mockPrisma,
                systemRunArtifact: undefined, // Missing optional model
                aiEvaluationEvidence: undefined, // Missing optional model
                projectOperationRequest: undefined, // Missing optional model
                project: {
                    findFirst: jest.fn().mockResolvedValue({ id: projectId, ownerId: userId, workspaceRevision: 0 }),
                    findUnique: jest.fn().mockResolvedValue({ id: projectId, ownerId: userId, workspaceRevision: 0 }),
                    delete: jest.fn().mockResolvedValue({ id: projectId })
                }
            };

            // First call (direct delete): rejects with P2003
            // Second call (fallback cascade): runs txFallbackMock
            mockPrisma.$transaction
                .mockImplementationOnce(async fn => fn(txFailing))
                .mockImplementationOnce(async fn => fn(txFallbackMock));

            await expect(deleteProject(projectId, userId)).resolves.toBeUndefined();

            // Fallback transaction was triggered
            expect(mockPrisma.$transaction).toHaveBeenCalled();
            // Valid child models were cleaned up
            expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({ where: { projectId } });
            expect(mockPrisma.projectSnapshot.deleteMany).toHaveBeenCalledWith({ where: { projectId } });
        });
    });
});
