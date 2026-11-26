import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const prisma = {
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  project: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  projectMember: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  projectSnapshot: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  projectFileVersion: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  projectMutation: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  projectEditorDocument: { findMany: jest.fn(), updateMany: jest.fn() },
  projectOperation: { findUnique: jest.fn() },
  projectEvent: { create: jest.fn() },
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prisma }));
jest.unstable_mockModule("../config/firebase.js", () => ({ getBucket: jest.fn() }));
jest.unstable_mockModule("../services/job.service.js", () => ({
  createAnalysisJob: jest.fn(),
  createSnapshotIngestJob: jest.fn(),
  createRunTestsJob: jest.fn(),
  addJobLog: jest.fn(),
}));
jest.unstable_mockModule("../services/jestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/vitestDetection.service.js", () => ({ detectAndSaveProject: jest.fn() }));
jest.unstable_mockModule("../services/testDetection.service.js", () => ({ detectFrameworks: jest.fn() }));
jest.unstable_mockModule("../services/cypressDetection.service.js", () => ({ detectCypressMetadata: jest.fn() }));
jest.unstable_mockModule("../middlewares/upload.middleware.js", () => ({ scanArchiveBomb: jest.fn() }));
jest.unstable_mockModule("../services/github.service.js", () => ({ GitHubRepositoryAccessService: {} }));
jest.unstable_mockModule("../services/projectSubscription.service.js", () => ({
  revokeProjectSubscriptions: jest.fn(async () => {}),
  deliverToProjectSubscribers: jest.fn(async () => {}),
}));

const service = await import("../services/project.service.js");
const { leaveProject } = await import("../services/projectMember.service.js");
const { captureWorkspaceFiles, publishPreparedWorkspace } = await import("../services/projectWorkspacePublish.service.js");
const { invalidateProjectAccessCache } = await import("../services/projectAccess.service.js");

describe("getProjectTree performance & security", () => {
  let root;

  beforeEach(() => {
    jest.clearAllMocks();
    service.clearProjectTreeCache();
    invalidateProjectAccessCache();

    root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-tree-perf-"));
    fs.mkdirSync(path.join(root, "src", "utils"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.mkdirSync(path.join(root, ".covai_test_versions"), { recursive: true });

    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.writeFileSync(path.join(root, "src", "index.js"), "console.log(1);");
    fs.writeFileSync(path.join(root, "src", "utils", "math.test.js"), "test('ok',()=>{});");
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "ignored.js"), "");
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(root, ".covai_test_versions", "manifest.json"), "{}");

    prisma.project.findFirst.mockResolvedValue({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: 4,
      eventSequence: 2,
    });
    prisma.projectSnapshot.findFirst.mockResolvedValue({
      id: "snap-tree-1",
      source: "ZIP",
      storagePath: root,
      rootDir: root,
    });
  });

  afterEach(() => {
    service.clearProjectTreeCache();
    invalidateProjectAccessCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses select projection on snapshot query and returns sorted tree excluding ignored dirs", async () => {
    const result = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });

    expect(result.snapshotId).toBe("snap-tree-1");
    expect(result.workspaceRevision).toBe(4);
    expect(result.tree.map((n) => n.name)).toEqual(["src", "package.json"]);
    expect(result.tree[0].children.map((n) => n.name)).toEqual(["utils", "index.js"]);
    expect(result.tree[0].children[0].children[0]).toMatchObject({
      id: "src/utils/math.test.js",
      name: "math.test.js",
      type: "file",
      lang: "test",
    });

    expect(prisma.projectSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          rootDir: true,
          storagePath: true,
          source: true,
        },
      }),
    );
  });

  it("checks project ownership before querying snapshots", async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(service.getProjectTree("proj-tree-1", "intruder")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.projectSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent in-flight requests and caches tree across immediate reads", async () => {
    const [r1, r2] = await Promise.all([
      service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true }),
      service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true }),
    ]);

    expect(r1).toEqual(r2);
    expect(prisma.projectSnapshot.findFirst).toHaveBeenCalledTimes(1);

    const r3 = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    expect(r3).toEqual(r1);
    expect(prisma.projectSnapshot.findFirst).toHaveBeenCalledTimes(1);
  });

  it("invalidates project tree metadata cache when activateProjectSnapshot changes workspaceRevision", async () => {
    const first = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    expect(first.workspaceRevision).toBe(4);

    prisma.project.update.mockResolvedValue({ id: "proj-tree-1", activeSnapshotId: "snap-tree-1", workspaceRevision: 5 });
    prisma.project.findFirst.mockResolvedValue({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: 5,
      eventSequence: 3,
    });

    await service.activateProjectSnapshot({
      projectId: "proj-tree-1",
      snapshotId: "snap-tree-1",
      userId: "user-1",
    });

    const second = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    expect(second.workspaceRevision).toBe(5);
  });

  it("invalidates project tree metadata cache when invalidateProjectAccessCache bumps invalidation version", async () => {
    const first = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    expect(first.workspaceRevision).toBe(4);

    invalidateProjectAccessCache("proj-tree-1");
    prisma.project.findFirst.mockResolvedValue({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: 9,
      eventSequence: 4,
    });

    const second = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    expect(second.workspaceRevision).toBe(9);
  });

  it("does not poison projectTreeMetaCache when invalidateProjectAccessCache occurs mid-flight", async () => {
    let releaseSnapshotQuery;
    prisma.projectSnapshot.findFirst.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSnapshotQuery = resolve;
        }),
    );

    const firstPromise = service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });

    // Yield until snapshot query is awaiting, then simulate a concurrent mutation invalidating the project
    await new Promise((resolve) => setTimeout(resolve, 10));
    invalidateProjectAccessCache("proj-tree-1");
    prisma.project.findFirst.mockResolvedValue({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: 10,
      eventSequence: 5,
    });

    releaseSnapshotQuery({
      id: "snap-tree-1",
      source: "ZIP",
      storagePath: root,
      rootDir: root,
    });

    const first = await firstPromise;
    expect(first.workspaceRevision).toBe(4);

    // Subsequent call must NOT hit stale cached metadata from the superseded in-flight read
    const second = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    expect(second.workspaceRevision).toBe(10);
  });

  it("evicts departed member from projectTreeMetaCache on leaveProject", async () => {
    prisma.project.findFirst.mockImplementation(async ({ where }) => {
      if (where?.OR?.some((clause) => clause?.members?.some?.userId === "departing-member")) {
        return {
          id: "proj-tree-1",
          ownerId: "user-1",
          workspaceRevision: 4,
          accessRevision: 1,
          eventSequence: 2,
        };
      }
      return {
        id: "proj-tree-1",
        ownerId: "user-1",
        workspaceRevision: 4,
        accessRevision: 1,
        eventSequence: 2,
      };
    });
    prisma.projectMember.findUnique.mockResolvedValue({
      id: "mem-1",
      projectId: "proj-tree-1",
      userId: "departing-member",
      role: "EDITOR",
      disciplineRole: "DEVELOPER",
      revision: 1,
    });
    prisma.$transaction.mockImplementation(async (run) => run(prisma));
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.projectMember.delete.mockResolvedValue({ id: "mem-1" });
    prisma.project.update.mockResolvedValue({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: 4,
      accessRevision: 2,
      eventSequence: 3,
    });
    prisma.projectEvent.create.mockResolvedValue({
      id: "evt-leave",
      projectId: "proj-tree-1",
      sequence: 3,
      type: "member.removed",
      createdAt: new Date(),
    });

    const beforeLeave = await service.getProjectTree("proj-tree-1", "departing-member", { withMetadata: true });
    expect(beforeLeave.snapshotId).toBe("snap-tree-1");

    await leaveProject({ projectId: "proj-tree-1", userId: "departing-member" });

    // Departed member no longer exists in DB
    prisma.project.findFirst.mockResolvedValue(null);
    prisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(
      service.getProjectTree("proj-tree-1", "departing-member", { withMetadata: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not allow a mid-transaction getProjectTree to poison projectTreeMetaCache after createProjectFile commits", async () => {
    let currentRevision = 4;
    let releaseMutationTx;
    let signalMutationInsideTx;
    const mutationInsideTx = new Promise((resolve) => {
      signalMutationInsideTx = resolve;
    });

    prisma.project.findFirst.mockImplementation(async () => ({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: currentRevision,
      eventSequence: 2,
    }));
    prisma.project.findUnique.mockImplementation(async () => ({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: currentRevision,
      eventSequence: 2,
    }));
    prisma.projectMutation.findUnique.mockResolvedValue(null);
    prisma.projectMutation.create.mockResolvedValue({ id: "mut-1", state: "PREPARED" });
    prisma.projectMutation.update.mockResolvedValue({ id: "mut-1", state: "APPLIED" });
    prisma.projectFileVersion.findUnique.mockResolvedValue(null);
    prisma.projectFileVersion.upsert.mockResolvedValue({ id: "fv-1", revision: 1, sha256: "abc" });
    prisma.projectEditorDocument.findMany.mockResolvedValue([]);
    prisma.projectEvent.create.mockResolvedValue({
      id: "evt-mut",
      projectId: "proj-tree-1",
      sequence: 3,
      type: "workspace.changed",
      createdAt: new Date(),
    });
    prisma.project.update.mockImplementation(async () => {
      currentRevision = 5;
      return { id: "proj-tree-1", ownerId: "user-1", workspaceRevision: 5, eventSequence: 3 };
    });
    prisma.$transaction.mockImplementation(async (run) => {
      const txResult = await run(prisma);
      signalMutationInsideTx();
      await new Promise((resolve) => {
        releaseMutationTx = resolve;
      });
      return txResult;
    });

    const createPromise = service.createProjectFile("proj-tree-1", "user-1", "src/created.js", "export const x = 1;");
    await mutationInsideTx;

    // Concurrent getProjectTree starts BEFORE transaction commits (sees workspaceRevision 4)
    prisma.project.findFirst.mockResolvedValueOnce({
      id: "proj-tree-1",
      ownerId: "user-1",
      workspaceRevision: 4,
      eventSequence: 2,
    });
    let releaseTreeSnapshot;
    prisma.projectSnapshot.findFirst.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseTreeSnapshot = resolve;
        }),
    );

    const concurrentTreePromise = service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now commit the file creation transaction
    releaseMutationTx();
    await createPromise;

    // Release the concurrent tree read that saw pre-commit state
    releaseTreeSnapshot({
      id: "snap-tree-1",
      source: "ZIP",
      storagePath: root,
      rootDir: root,
    });
    const concurrentResult = await concurrentTreePromise;
    expect(concurrentResult.workspaceRevision).toBe(4);

    // Subsequent read must NOT hit stale cached workspaceRevision 4
    const afterCommit = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
    expect(afterCommit.workspaceRevision).toBe(5);
  });

  it("invalidates projectTreeMetaCache after publishPreparedWorkspace (standard and fastCheckpoint)", async () => {
    const preparedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-prep-"));
    try {
      fs.mkdirSync(path.join(preparedRoot, "src"), { recursive: true });
      fs.writeFileSync(path.join(preparedRoot, "package.json"), "{}");
      fs.writeFileSync(path.join(preparedRoot, "src", "index.js"), "console.log(1);");
      const beforeFiles = await captureWorkspaceFiles(root);
      fs.writeFileSync(path.join(preparedRoot, "src", "added.js"), "export const a = 1;");

      // Prime projectTreeMetaCache at workspaceRevision 4
      const initial = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
      expect(initial.workspaceRevision).toBe(4);

      let currentRevision = 4;
      prisma.project.findFirst.mockImplementation(async () => ({
        id: "proj-tree-1",
        ownerId: "user-1",
        workspaceRevision: currentRevision,
        eventSequence: 2,
      }));
      prisma.projectMutation.create.mockResolvedValue({ id: "mut-pub", state: "PREPARED" });
      prisma.projectMutation.update.mockResolvedValue({ id: "mut-pub", state: "APPLIED" });
      prisma.projectFileVersion.upsert.mockResolvedValue({ id: "fv-pub", revision: 1 });
      prisma.projectEditorDocument.findMany.mockResolvedValue([]);
      prisma.projectEvent.create.mockResolvedValue({
        id: "evt-pub",
        projectId: "proj-tree-1",
        sequence: 3,
        type: "workspace.changed",
        createdAt: new Date(),
      });
      prisma.project.update.mockImplementation(async () => {
        currentRevision = 5;
        return { id: "proj-tree-1", workspaceRevision: 5, eventSequence: 3 };
      });
      prisma.$transaction.mockImplementation(async (run) => run(prisma));
      prisma.$executeRaw.mockResolvedValue(1);

      await publishPreparedWorkspace({
        projectId: "proj-tree-1",
        snapshotId: "snap-tree-1",
        userId: "user-1",
        expectedWorkspaceRevision: 4,
        beforeFiles,
        preparedRoot,
      });

      const afterStandard = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
      expect(afterStandard.workspaceRevision).toBe(5);
      expect(afterStandard.tree[0].children.map((n) => n.name)).toContain("added.js");

      // Also verify fastCheckpoint path invalidates projectTreeMetaCache
      const beforeCheckpointFiles = await captureWorkspaceFiles(root);
      fs.writeFileSync(path.join(preparedRoot, "src", "checkpointed.js"), "export const c = 2;");
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            id: "proj-tree-1",
            ownerId: "user-1",
            workspaceRevision: 5,
            accessRole: "OWNER",
            checkpointSnapshot: { id: "snap-tree-1", projectId: "proj-tree-1", source: "ZIP", rootDir: root, storagePath: root },
            latestSnapshotId: "snap-tree-1",
            checkpointCurrent: [],
          },
        ])
        .mockResolvedValueOnce([
          {
            count: 1,
            event: { id: "evt-cp", projectId: "proj-tree-1", sequence: 4, type: "workspace.changed", revision: 6 },
          },
        ]);
      currentRevision = 6;

      await publishPreparedWorkspace({
        projectId: "proj-tree-1",
        snapshotId: "snap-tree-1",
        userId: "user-1",
        expectedWorkspaceRevision: 5,
        beforeFiles: beforeCheckpointFiles,
        preparedRoot,
        editorCheckpoint: true,
        checkpointRows: [{ id: "doc-1", relativePath: "src/checkpointed.js", revision: 1, lineAttributionJson: null }],
        checkpointDocumentIds: ["doc-1"],
      });

      const afterCheckpoint = await service.getProjectTree("proj-tree-1", "user-1", { withMetadata: true });
      expect(afterCheckpoint.workspaceRevision).toBe(6);
      expect(afterCheckpoint.tree[0].children.map((n) => n.name)).toContain("checkpointed.js");
    } finally {
      fs.rmSync(preparedRoot, { recursive: true, force: true });
    }
  });
});
