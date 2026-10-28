import { beforeEach, afterEach, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotWorkspaceRoot, resolveSnapshotFile } from "../utils/snapshotWorkspace.js";

const prisma = { $transaction:jest.fn(),$executeRaw:jest.fn(),
    project: { findFirst: jest.fn(),update:jest.fn() },
    projectFileVersion:{findUnique:jest.fn(),create:jest.fn(),update:jest.fn(),upsert:jest.fn()},
    projectMutation:{findUnique:jest.fn(),create:jest.fn(),update:jest.fn()},
    projectEvent:{create:jest.fn()},
    projectSnapshot: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() } };
jest.unstable_mockModule("../config/prisma.js", () => ({ default: prisma }));
jest.unstable_mockModule("../config/firebase.js", () => ({ getBucket: jest.fn() }));
jest.unstable_mockModule("../services/job.service.js", () => ({ createAnalysisJob: jest.fn(), createSnapshotIngestJob: jest.fn(), createRunTestsJob: jest.fn(), addJobLog: jest.fn() }));
jest.unstable_mockModule("../services/jestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/vitestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/testDetection.service.js", () => ({ detectFrameworks: jest.fn() }));
jest.unstable_mockModule("../services/cypressDetection.service.js", () => ({ detectCypressMetadata: jest.fn() }));
jest.unstable_mockModule("../middlewares/upload.middleware.js", () => ({ scanArchiveBomb: jest.fn() }));
jest.unstable_mockModule("../services/github.service.js", () => ({ GitHubRepositoryAccessService: {} }));
const service = await import("../services/project.service.js");
const { GitService } = await import("../services/git.service.js");
let root, snapshot, checkpoint;
let versions;
let project;
beforeEach(() => {
    jest.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-workspace-"));
    for (const folder of ["client", "server"]) fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, "client", "App.jsx"), "client source");
    fs.writeFileSync(path.join(root, "server", "index.js"), "server source");
    fs.writeFileSync(path.join(root, "server", "package.json"), '{}');
    snapshot = { id: "snapshot-1", source: "GITHUB", storagePath: root, rootDir: path.join(root, "server") };
    project = {id:'workspace-test-project',ownerId:'owner',workspaceRevision:0,eventSequence:0};
    versions = new Map();
    prisma.$transaction.mockImplementation(run=>run(prisma));
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.project.findFirst.mockImplementation(async ()=>({...project}));
    prisma.project.update.mockImplementation(async ({data})=> {
        if(data.workspaceRevision?.increment) project.workspaceRevision += data.workspaceRevision.increment;
        if(data.eventSequence?.increment) project.eventSequence += data.eventSequence.increment;
        return {...project};
    });
    prisma.projectFileVersion.findUnique.mockImplementation(async ({where})=>versions.get(where.snapshotId_relativePath.relativePath) || null);
    prisma.projectFileVersion.create.mockImplementation(async ({data})=> {const row={id:'version',...data};versions.set(data.relativePath,row);return row;});
    prisma.projectFileVersion.upsert.mockImplementation(async ({where,create,update})=> {
        const old=versions.get(where.snapshotId_relativePath.relativePath);
        const row=old ? {...old,...update,revision:old.revision + update.revision.increment} : create;
        versions.set(where.snapshotId_relativePath.relativePath,row);return row;
    });
    prisma.projectMutation.findUnique.mockResolvedValue(null);
    prisma.projectMutation.create.mockImplementation(async ({data})=>({id:'mutation',...data}));
    prisma.projectMutation.update.mockResolvedValue({id:'mutation',state:'APPLIED'});
    prisma.projectEvent.create.mockImplementation(async ({data})=>({id:'event',...data}));
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
    const base = await service.getFileContent('workspace-test-project','owner','server/index.js');
    await service.updateFileContent("workspace-test-project", "owner", "server/index.js", "changed",{snapshotId:snapshot.id,expectedVersion:base.version});
    expect(fs.readFileSync(path.join(root, "server", "index.js"), "utf8")).toBe("changed");
});
it("checks ownership before exposing repository contents", async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.getProjectTree("workspace-test-project", "other")).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.projectSnapshot.findFirst).not.toHaveBeenCalled();
});
it("uses the same full repository root for Git and Explorer", async () => {
    expect((await GitService.getRepoPath("workspace-test-project", "owner")).rootDir).toBe(root);
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where:expect.objectContaining({id:'workspace-test-project'}) }));
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
it('requires an actual actor before preparing a checkpoint', async () => {
    await expect(service.createProjectCheckpoint({ projectId: 'workspace-test-project' })).rejects.toMatchObject({ statusCode: 401 });
    expect(prisma.projectSnapshot.findFirst).not.toHaveBeenCalled();
    expect(prisma.projectSnapshot.create).not.toHaveBeenCalled();
});
it('restores absolute runner configurations inside the new workspace', async () => {
    snapshot.jestConfigPath = path.join(root, 'server', 'jest.config.cjs');
    snapshot.playwrightConfigPath = path.join(root, 'client', 'playwright.config.js');
    snapshot.playwrightTestDir = path.join(root, 'client', 'tests');
    fs.writeFileSync(snapshot.jestConfigPath, 'module.exports = {};');
    fs.writeFileSync(snapshot.playwrightConfigPath, 'export default {};');
    await service.restoreProjectCheckpoint({ projectId: 'workspace-test-project', snapshotId: snapshot.id, userId: 'owner' });
    const restored = prisma.projectSnapshot.create.mock.calls[0][0].data;
    expect(restored.jestConfigPath).toBe(path.join(restored.rootDir, 'jest.config.cjs'));
    expect(restored.playwrightConfigPath).toBe(path.join(restored.storagePath, 'client', 'playwright.config.js'));
    expect(restored.playwrightTestDir).toBe(path.join(restored.storagePath, 'client', 'tests'));
    expect(fs.readFileSync(restored.jestConfigPath, 'utf8')).toBe('module.exports = {};');
    expect(fs.readFileSync(snapshot.jestConfigPath, 'utf8')).toBe('module.exports = {};');
});
