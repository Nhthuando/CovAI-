import { beforeEach, afterEach, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotWorkspaceRoot, resolveSnapshotFile } from "../utils/snapshotWorkspace.js";

const prisma = { project: { findFirst: jest.fn() }, projectSnapshot: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() } };
jest.unstable_mockModule("../config/prisma.js", () => ({ default: prisma }));
jest.unstable_mockModule("../config/firebase.js", () => ({ getBucket: jest.fn() }));
jest.unstable_mockModule("../services/job.service.js", () => ({ createAnalysisJob: jest.fn(), createSnapshotIngestJob: jest.fn(), createRunTestsJob: jest.fn() }));
jest.unstable_mockModule("../services/jestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/vitestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/testDetection.service.js", () => ({ detectFrameworks: jest.fn() }));
jest.unstable_mockModule("../services/cypressDetection.service.js", () => ({ detectCypressMetadata: jest.fn() }));
jest.unstable_mockModule("../middlewares/upload.middleware.js", () => ({ scanArchiveBomb: jest.fn() }));
jest.unstable_mockModule("../services/github.service.js", () => ({ GitHubRepositoryAccessService: {} }));
const service = await import("../services/project.service.js");
const { GitService } = await import("../services/git.service.js");
let root, snapshot, checkpoint;
beforeEach(() => {
    jest.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-workspace-"));
    for (const folder of ["client", "server"]) fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, "client", "App.jsx"), "client source");
    fs.writeFileSync(path.join(root, "server", "index.js"), "server source");
    fs.writeFileSync(path.join(root, "server", "package.json"), '{}');
    snapshot = { id: "snapshot-1", source: "GITHUB", storagePath: root, rootDir: path.join(root, "server") };
    prisma.project.findFirst.mockResolvedValue({ id: "workspace-test-project" });
    prisma.projectSnapshot.findFirst.mockResolvedValue(snapshot);
    prisma.projectSnapshot.create.mockImplementation(async ({ data }) => { checkpoint = data.storagePath; return { id: "checkpoint", ...data }; });
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (checkpoint) fs.rmSync(checkpoint, { recursive: true, force: true });
    checkpoint = undefined;
});
it("shows both packages and reads workspace and legacy analysis paths", async () => {
    expect(snapshotWorkspaceRoot(snapshot)).toBe(root);
    expect((await service.getProjectTree("workspace-test-project", "owner")).map(row => row.name)).toEqual(["client", "server"]);
    expect((await service.getFileContent("workspace-test-project", "owner", "client/App.jsx")).content).toBe("client source");
    expect((await service.getFileContent("workspace-test-project", "owner", "index.js")).content).toBe("server source");
    await service.updateFileContent("workspace-test-project", "owner", "server/index.js", "changed");
    expect(fs.readFileSync(path.join(root, "server", "index.js"), "utf8")).toBe("changed");
});
it("checks ownership before exposing repository contents", async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.getProjectTree("workspace-test-project", "other")).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.projectSnapshot.findFirst).not.toHaveBeenCalled();
});
it("uses the same full repository root for Git and Explorer", async () => {
    expect((await GitService.getRepoPath("workspace-test-project", "owner")).rootDir).toBe(root);
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "workspace-test-project", ownerId: "owner" } }));
});
it("rejects traversal and unrelated storage directories", () => {
    expect(() => resolveSnapshotFile(snapshot, "../private.txt")).toThrow("Invalid file path");
    expect(snapshotWorkspaceRoot({ ...snapshot, storagePath: path.join(root, "client") })).toBe(snapshot.rootDir);
    expect(snapshotWorkspaceRoot({ ...snapshot, source: "ZIP" })).toBe(snapshot.rootDir);
});
it("checkpoints both packages while retaining the backend analysis root", async () => {
    await service.createProjectCheckpoint({ projectId: "workspace-test-project", userId: "owner", label: "Both packages" });
    const data = prisma.projectSnapshot.create.mock.calls[0][0].data;
    expect(fs.existsSync(path.join(data.storagePath, "client", "App.jsx"))).toBe(true);
    expect(data.rootDir).toBe(path.join(data.storagePath, "server"));
    expect(fs.existsSync(path.join(data.rootDir, "index.js"))).toBe(true);
});
it("restores the active monorepo without losing either package", async () => {
    snapshot.createdAt = new Date();
    await service.restoreProjectCheckpoint({ projectId: "workspace-test-project", snapshotId: snapshot.id, userId: "owner" });
    const data = prisma.projectSnapshot.create.mock.calls[0][0].data;
    expect(data.rootDir).toBe(path.join(data.storagePath, "server"));
    for (const relative of ["client/App.jsx", "server/index.js"]) {
        expect(fs.existsSync(path.join(data.storagePath, relative))).toBe(true);
        expect(fs.existsSync(path.join(root, relative))).toBe(true);
    }
});
