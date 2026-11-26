import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { jest } from "@jest/globals";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createAuthTestDatabase } from "./helpers/authTestDatabase.js";

jest.setTimeout(30000);
const testDb = await createAuthTestDatabase();

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: testDb.db,
}));

jest.unstable_mockModule("../services/gemini.service.js", () => ({
  generateText: jest.fn(async () =>
    JSON.stringify({
      label: "feat: harden cart quantity bounds",
      message: "- Guard negative quantities\n- Add tax rounding helper",
      suggestedTag: "v1.1.0",
    }),
  ),
}));

let snapshotVcsRoute;
let readVersionedProjectFile;
let mutateProjectWorkspace;
let AUTH_PROVIDERS;
let AUTH_ERROR_CODES;

try {
  ({ default: snapshotVcsRoute } = await import("../routes/snapshotVcs.route.js"));
  ({ readVersionedProjectFile } = await import("../services/projectFileVersion.service.js"));
  ({ mutateProjectWorkspace } = await import("../services/projectMutation.service.js"));
  ({ AUTH_PROVIDERS } = await import("../../../shared/versionControlMode.js"));
  ({ AUTH_ERROR_CODES } = await import("../../../shared/authValidation.js"));
} catch (error) {
  await testDb.close().catch(() => {});
  throw error;
}

function makeJwt(user, authProvider) {
  return jwt.sign(
    {
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      authProvider,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/projects/:projectId/snapshot-vcs", snapshotVcsRoute);
  app.use("/api/projects/:projectId/vcs/snapshots", snapshotVcsRoute);
  return app;
}

describe("Phase 2 Snapshot & Checkpoints Mini-GitHub Integration", () => {
  const origJwt = process.env.JWT_SECRET;
  const createdProjectIds = new Set();

  let app;
  let owner;
  let editor;
  let viewer;
  let githubUser;
  let project;
  let v1Snapshot;
  let workspaceRoot;
  let tempDir;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "phase2-snapshot-vcs-secret-key-32ch";
    app = buildApp();
  });

  beforeEach(async () => {
    await testDb.db.project.updateMany({
      data: { activeSnapshotId: null, activeVcsBranchId: null },
    });
    await testDb.db.snapshotVcsTag.deleteMany({});
    await testDb.db.snapshotVcsStaging.deleteMany({});
    await testDb.db.snapshotVcsBlobRef.deleteMany({});
    await testDb.db.snapshotVcsEntry.deleteMany({});
    await testDb.db.snapshotVcsBranch.deleteMany({});
    await testDb.db.projectSnapshot.updateMany({
      data: { parentSnapshotId: null, restoredFromSnapshotId: null, vcsBranchId: null },
    });
    await testDb.db.project.deleteMany({});
    await testDb.resetAuthTables();
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-snapvcs-int-"));
    workspaceRoot = path.join(tempDir, "workspace");

    await fsp.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fsp.mkdir(path.join(workspaceRoot, "node_modules", "keep-me"), { recursive: true });
    await fsp.mkdir(path.join(workspaceRoot, "coverage"), { recursive: true });

    await fsp.writeFile(
      path.join(workspaceRoot, "src", "app.js"),
      "line1: initial\nline2: keep\nline3: keep\nline4: keep\nline5: footer\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "src", "rename-me.js"),
      "export const stableHelper = () => 42;\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "src", "delete-me.js"),
      "export const deprecated = true;\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "node_modules", "keep-me", "index.js"),
      "module.exports = { keep: true };\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "coverage", "lcov.info"),
      "SF:src/app.js\nend_of_record\n",
      "utf8",
    );

    owner = await testDb.db.user.create({
      data: {
        email: "owner-email@covai.local",
        name: "Email Owner",
        passwordHash: "hash",
        lastAuthProvider: AUTH_PROVIDERS.EMAIL,
      },
    });
    editor = await testDb.db.user.create({
      data: {
        email: "editor-email@covai.local",
        name: "Email Editor",
        passwordHash: "hash",
        lastAuthProvider: AUTH_PROVIDERS.EMAIL,
      },
    });
    viewer = await testDb.db.user.create({
      data: {
        email: "viewer-email@covai.local",
        name: "Email Viewer",
        passwordHash: "hash",
        lastAuthProvider: AUTH_PROVIDERS.EMAIL,
      },
    });
    githubUser = await testDb.db.user.create({
      data: {
        email: "gh-user@users.noreply.github.com",
        name: "GitHub User",
        passwordHash: "hash",
        lastAuthProvider: AUTH_PROVIDERS.GITHUB,
        githubUserId: "998877",
        githubLogin: "gh-tester",
      },
    });

    project = await testDb.db.project.create({
      data: {
        name: "MiniGitHub Demo",
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: editor.id, role: "EDITOR" },
            { userId: viewer.id, role: "VIEWER" },
            { userId: githubUser.id, role: "OWNER" },
          ],
        },
      },
    });
    createdProjectIds.add(project.id);

    v1Snapshot = await testDb.db.projectSnapshot.create({
      data: {
        projectId: project.id,
        source: "ZIP",
        checksum: "v1_initial_zip_checksum",
        label: "Initial Ingest",
        versionNumber: 1,
        commitMessage: "Uploaded initial ZIP archive",
        authorId: owner.id,
        storagePath: workspaceRoot,
        rootDir: workspaceRoot,
        casMaterialized: false,
      },
    });
    await testDb.db.project.update({
      where: { id: project.id },
      data: { activeSnapshotId: v1Snapshot.id },
    });
  });

  afterEach(async () => {
    for (const pid of createdProjectIds) {
      const casDir = path.resolve(process.cwd(), "storage", "projects", pid);
      if (fs.existsSync(casDir)) {
        await fsp.rm(casDir, { recursive: true, force: true });
      }
      const tempMutDir = path.resolve(process.cwd(), ".covai-temp");
      // Only remove per-project journal artifacts if created under test project IDs
      const journalDir = path.join(tempMutDir, "mutations", pid);
      if (fs.existsSync(journalDir)) {
        await fsp.rm(journalDir, { recursive: true, force: true });
      }
    }
    createdProjectIds.clear();

    if (tempDir && fs.existsSync(tempDir)) {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    if (origJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = origJwt;
    await testDb.close();
  });

  it("1. enforces email-only provider isolation across snapshot-vcs and alias routes", async () => {
    const ghJwt = makeJwt(githubUser, AUTH_PROVIDERS.GITHUB);
    const emailJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);

    const deniedPrimary = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${ghJwt}`);
    expect(deniedPrimary.status).toBe(403);
    expect(deniedPrimary.body.code).toBe(AUTH_ERROR_CODES.AUTH_PROVIDER_MISMATCH);

    const deniedAlias = await request(app)
      .get(`/api/projects/${project.id}/vcs/snapshots/checkpoints`)
      .set("Authorization", `Bearer ${ghJwt}`);
    expect(deniedAlias.status).toBe(403);
    expect(deniedAlias.body.code).toBe(AUTH_ERROR_CODES.AUTH_PROVIDER_MISMATCH);

    const allowed = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status?includeUnchanged=true`)
      .set("Authorization", `Bearer ${emailJwt}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.initialized).toBe(true);
    expect(allowed.body.data.activeBranch.name).toBe("main");
    expect(allowed.body.data.clean).toBe(true);
    expect(allowed.body.data.unchangedCount).toBe(3);
  });

  it("2. lazily freezes Initial Ingest in immutable CAS before editor mutation (fixes Bug C2)", async () => {
    const emailJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);

    // Before first mutation, casMaterialized is false
    const preSnap = await testDb.db.projectSnapshot.findUnique({
      where: { id: v1Snapshot.id },
      select: { casMaterialized: true },
    });
    expect(preSnap.casMaterialized).toBe(false);

    // Read file & edit via workspace mutation service (triggers lazy CAS freeze BEFORE overwriting file)
    const fileRes = await readVersionedProjectFile({
      projectId: project.id,
      snapshotId: v1Snapshot.id,
      userId: owner.id,
      path: "src/app.js",
      db: testDb.db,
    });
    await mutateProjectWorkspace({
      projectId: project.id,
      snapshotId: v1Snapshot.id,
      userId: owner.id,
      kind: "WRITE_FILE",
      path: "src/app.js",
      content: "line1: mutated live!\nline2: keep\nline3: keep\nline4: keep\nline5: footer\n",
      expectedVersion: fileRes.version,
      db: testDb.db,
    });

    // Live status sees M on src/app.js against frozen v1 CAS baseline
    const statusRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${emailJwt}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.clean).toBe(false);
    expect(statusRes.body.data.unstaged.map((c) => `${c.status}:${c.path}`)).toEqual(["M:src/app.js"]);

    // Diff pair compares frozen CAS Initial Ingest vs Working Tree
    const diffRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/diff-pair`)
      .query({ filePath: "src/app.js" })
      .set("Authorization", `Bearer ${emailJwt}`);
    expect(diffRes.status).toBe(200);
    expect(diffRes.body.data.originalContent).toContain("line1: initial");
    expect(diffRes.body.data.modifiedContent).toContain("line1: mutated live!");

    // Bug C2 verification: v1 historical checkpoint read returns UNTOUCHED initial bytes!
    const v1FileRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v1Snapshot.id}/file`)
      .query({ path: "src/app.js" })
      .set("Authorization", `Bearer ${emailJwt}`);
    expect(v1FileRes.status).toBe(200);
    expect(v1FileRes.body.data.content).toContain("line1: initial");
    expect(v1FileRes.body.data.content).not.toContain("mutated live");
  });

  it("3. supports M/A/D/R detection, partial staging, AI summary, EDITOR commit ownership, and discard", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);
    const editorJwt = makeJwt(editor, AUTH_PROVIDERS.EMAIL);

    // Bootstrap CAS baseline first
    await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${ownerJwt}`);

    // Make dirty changes: Modify app.js, Add added.js, Rename rename-me.js -> renamed.js, Delete delete-me.js
    await fsp.writeFile(
      path.join(workspaceRoot, "src", "app.js"),
      "line1: v2 update\nline2: keep\nline3: keep\nline4: keep\nline5: footer\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "src", "added.js"),
      "export const added = 1;\n",
      "utf8",
    );
    await fsp.rename(
      path.join(workspaceRoot, "src", "rename-me.js"),
      path.join(workspaceRoot, "src", "renamed.js"),
    );
    await fsp.rm(path.join(workspaceRoot, "src", "delete-me.js"));

    const stRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${editorJwt}`);
    expect(stRes.status).toBe(200);
    expect(stRes.body.data.stats).toEqual({
      added: 1,
      modified: 1,
      deleted: 1,
      renamed: 1,
      unchanged: 0,
    });
    expect(stRes.body.data.unstaged.find((c) => c.path === "src/renamed.js")).toMatchObject({
      status: "R",
      origPath: "src/rename-me.js",
    });

    // Partial stage: stage only app.js and renamed.js, leaving added.js & delete-me.js unstaged
    const stageRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/stage`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ files: ["src/app.js", "src/renamed.js"] });
    expect(stageRes.status).toBe(200);
    expect(stageRes.body.data.staged.map((c) => c.path).sort()).toEqual([
      "src/app.js",
      "src/renamed.js",
    ]);
    expect(stageRes.body.data.unstaged.map((c) => c.path).sort()).toEqual([
      "src/added.js",
      "src/delete-me.js",
    ]);

    // Generate AI summary on staged changes
    const aiRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/ai-summary`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({});
    expect(aiRes.status).toBe(200);
    expect(aiRes.body.data.label).toContain("cart");
    expect(aiRes.body.data.suggestedTag).toBe("v1.1.0");

    // EDITOR captures partial checkpoint (authorId recorded as editor.id)
    const capRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({
        label: "v2: partial app & rename",
        message: "Committed by editor",
        tag: "v1.1.0",
        stageAll: false,
      });
    expect(capRes.status).toBe(201);
    expect(capRes.body.data.checkpoint.versionNumber).toBe(2);
    expect(capRes.body.data.checkpoint.author.id).toBe(editor.id);
    // Remaining unstaged edits stay dirty in workspace!
    expect(capRes.body.data.status.clean).toBe(false);
    expect(capRes.body.data.status.unstaged.map((c) => c.path).sort()).toEqual([
      "src/added.js",
      "src/delete-me.js",
    ]);

    // Check rename completed cleanly in v2 tree (rename-me.js removed, renamed.js present)
    const v2Id = capRes.body.data.checkpoint.id;
    const treeRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v2Id}/tree`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(treeRes.status).toBe(200);
    expect(treeRes.body.data.files.map((f) => f.relativePath).sort()).toEqual([
      "src/app.js",
      "src/delete-me.js",
      "src/renamed.js",
    ]);

    // Discard added.js individually, then discard remaining changes
    const discardOne = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/discard`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ files: ["src/added.js"] });
    expect(discardOne.status).toBe(200);
    expect(fs.existsSync(path.join(workspaceRoot, "src", "added.js"))).toBe(false);
    expect(discardOne.body.data.unstaged.map((c) => c.path)).toEqual(["src/delete-me.js"]);

    const discardAll = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/discard`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ files: "all" });
    expect(discardAll.status).toBe(200);
    expect(discardAll.body.data.clean).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "src", "delete-me.js"))).toBe(true);

    // Capturing cleanly without changes returns 409 SNAPSHOT_UNCHANGED
    const emptyCap = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ label: "should fail" });
    expect(emptyCap.status).toBe(409);
    expect(emptyCap.body.code).toBe("SNAPSHOT_UNCHANGED");
  });

  it("4. enforces RBAC: VIEWER denied mutations, EDITOR allowed local ops & denied destructive/branch checkout ops", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);
    const editorJwt = makeJwt(editor, AUTH_PROVIDERS.EMAIL);
    const viewerJwt = makeJwt(viewer, AUTH_PROVIDERS.EMAIL);

    const statusV = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${viewerJwt}`);
    expect(statusV.status).toBe(200);

    // VIEWER cannot stage or capture
    const stageV = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/stage`)
      .set("Authorization", `Bearer ${viewerJwt}`)
      .send({ files: "all" });
    expect(stageV.status).toBe(403);

    // EDITOR can create branch without checkout & tag checkpoint
    const branchEd = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ name: "editor-draft", checkout: false });
    expect(branchEd.status).toBe(201);
    const draftBranchId = branchEd.body.data.branches.find((b) => b.name === "editor-draft").id;

    const tagEd = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v1Snapshot.id}/tags`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ name: "editor-tag" });
    expect(tagEd.status).toBe(201);

    // EDITOR denied destructive / branch-switching / GC operations
    const checkoutEd = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${draftBranchId}/checkout`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({});
    expect(checkoutEd.status).toBe(403);

    const createCheckoutEd = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ name: "ed-checkout", checkout: true });
    expect(createCheckoutEd.status).toBe(403);

    const restoreEd = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v1Snapshot.id}/restore`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({});
    expect(restoreEd.status).toBe(403);

    const mergeEd = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/merge`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ sourceBranchId: draftBranchId });
    expect(mergeEd.status).toBe(403);

    const gcEd = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/gc`)
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ graceWindowMs: 0 });
    expect(gcEd.status).toBe(403);

    // OWNER can delete tag & run GC
    const delTagOw = await request(app)
      .delete(`/api/projects/${project.id}/snapshot-vcs/tags/${tagEd.body.data.id}`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(delTagOw.status).toBe(200);
  });

  it("5. protects dirty workspaces on branch checkout and preserves node_modules + coverage on disk", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);

    // Bootstrap and capture v2 on main modifying app.js
    await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${ownerJwt}`);

    await fsp.writeFile(path.join(workspaceRoot, "src", "main-only.js"), "export const m = 1;\n");
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "main v2", stageAll: true });

    // Create & checkout branch 'feature' from v1Snapshot
    const featRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ name: "feature", fromSnapshotId: v1Snapshot.id, checkout: true });
    expect(featRes.status).toBe(201);
    const mainBranchId = featRes.body.data.branches.find((b) => b.name === "main").id;
    const featureBranchId = featRes.body.data.branches.find((b) => b.name === "feature").id;

    // On feature, main-only.js is absent, while node_modules & coverage are strictly preserved!
    expect(fs.existsSync(path.join(workspaceRoot, "src", "main-only.js"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, "node_modules", "keep-me", "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "coverage", "lcov.info"))).toBe(true);

    // Make dirty uncommitted edit on feature
    await fsp.writeFile(path.join(workspaceRoot, "src", "wip.js"), "export const wip = true;\n");

    // Checkout back to main with FAIL_IF_DIRTY -> 409 DIRTY_WORKSPACE
    const blocked = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${mainBranchId}/checkout`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ dirtyPolicy: "FAIL_IF_DIRTY" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("DIRTY_WORKSPACE");

    // Checkout back to main with AUTO_BACKUP -> creates safety checkpoint on feature branch
    const backedUp = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${mainBranchId}/checkout`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ dirtyPolicy: "AUTO_BACKUP" });
    expect(backedUp.status).toBe(200);
    expect(backedUp.body.data.backupCheckpoint).toBeTruthy();
    expect(backedUp.body.data.backupCheckpoint.isAutoBackup).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "src", "main-only.js"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "src", "wip.js"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, "node_modules", "keep-me", "index.js"))).toBe(true);

    // Switching back to feature brings wip.js back from the auto-backup checkpoint
    const backToFeat = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${featureBranchId}/checkout`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({});
    expect(backToFeat.status).toBe(200);
    expect(fs.existsSync(path.join(workspaceRoot, "src", "wip.js"))).toBe(true);
  });

  it("6. executes LCA 3-way auto-merge and conflict resolution between diverged branches", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);

    // Bootstrap CAS and create feature branch at v1
    await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${ownerJwt}`);

    const featCreate = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ name: "feat-merge", fromSnapshotId: v1Snapshot.id, checkout: true });
    expect(featCreate.status).toBe(201);
    const mainBranchId = featCreate.body.data.branches.find((b) => b.name === "main").id;
    const featBranchId = featCreate.body.data.branches.find((b) => b.name === "feat-merge").id;

    // On feat-merge: modify line5 (non-overlapping with main's future line1 edit) + shared-conflict line
    await fsp.writeFile(
      path.join(workspaceRoot, "src", "app.js"),
      "line1: initial\nline2: keep\nline3: keep\nline4: keep\nline5: feat-footer\n",
      "utf8",
    );
    await fsp.writeFile(path.join(workspaceRoot, "src", "feat-file.js"), "feat-only\n", "utf8");
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "feat clean edit", stageAll: true });

    // Switch to main and edit line1 (non-overlapping)
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${mainBranchId}/checkout`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({});

    await fsp.writeFile(
      path.join(workspaceRoot, "src", "app.js"),
      "line1: main-header\nline2: keep\nline3: keep\nline4: keep\nline5: footer\n",
      "utf8",
    );
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "main non-overlapping edit", stageAll: true });

    // Auto-merge feat-merge into main cleanly!
    const cleanMerge = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/merge`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ sourceBranchId: featBranchId });
    expect(cleanMerge.status).toBe(200);
    expect(cleanMerge.body.data.merged).toBe(true);
    expect(cleanMerge.body.data.conflicted).toBe(false);
    const mergedApp = await fsp.readFile(path.join(workspaceRoot, "src", "app.js"), "utf8");
    expect(mergedApp).toBe(
      "line1: main-header\nline2: keep\nline3: keep\nline4: keep\nline5: feat-footer\n",
    );
    expect(fs.existsSync(path.join(workspaceRoot, "src", "feat-file.js"))).toBe(true);

    // Now force an overlapping conflict on line1 across main and feat-merge
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${featBranchId}/checkout`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({});
    await fsp.writeFile(
      path.join(workspaceRoot, "src", "app.js"),
      "line1: feat-conflict\nline2: keep\nline3: keep\nline4: keep\nline5: feat-footer\n",
      "utf8",
    );
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "feat conflicting line1", stageAll: true });

    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${mainBranchId}/checkout`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({});
    await fsp.writeFile(
      path.join(workspaceRoot, "src", "app.js"),
      "line1: main-conflict\nline2: keep\nline3: keep\nline4: keep\nline5: feat-footer\n",
      "utf8",
    );
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "main conflicting line1", stageAll: true });

    const conflictRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/merge`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ sourceBranchId: featBranchId });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.code).toBe("SNAPSHOT_MERGE_CONFLICT");
    expect(conflictRes.body.details.conflicts).toHaveLength(1);
    expect(conflictRes.body.details.conflicts[0]).toMatchObject({
      path: "src/app.js",
      ours: expect.stringContaining("main-conflict"),
      theirs: expect.stringContaining("feat-conflict"),
    });

    // Resolve conflict manually and complete merge
    const resolveRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/merge/resolve`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({
        sourceBranchId: featBranchId,
        resolutions: {
          "src/app.js": {
            resolution: "manual",
            manualContent: "line1: resolved-combined\nline2: keep\n",
          },
        },
      });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.data.merged).toBe(true);
    expect(await fsp.readFile(path.join(workspaceRoot, "src", "app.js"), "utf8")).toBe(
      "line1: resolved-combined\nline2: keep\n",
    );
  });

  it("7. supports compare, single-file restore, full rollback (Bug C3 activeSnapshotId), pin protection, ZIP export & CAS GC", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);

    // Bootstrap v1 & capture v2 and v3
    await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${ownerJwt}`);

    await fsp.writeFile(path.join(workspaceRoot, "src", "app.js"), "v2-app-content\n");
    const v2Res = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "v2 unique blob", stageAll: true });
    const v2Id = v2Res.body.data.checkpoint.id;

    await fsp.writeFile(path.join(workspaceRoot, "src", "app.js"), "v3-app-content\n");
    await fsp.writeFile(path.join(workspaceRoot, "src", "extra.js"), "v3-extra\n");
    const v3Res = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "v3 release", stageAll: true });
    const v3Id = v3Res.body.data.checkpoint.id;

    // Compare v1 vs v3
    const cmpRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/compare`)
      .query({ baseSnapshotId: v1Snapshot.id, targetSnapshotId: v3Id })
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(cmpRes.status).toBe(200);
    expect(cmpRes.body.data.stats.modified).toBe(1);
    expect(cmpRes.body.data.stats.added).toBe(1);

    // Pin v2 so deletion is blocked
    await request(app)
      .patch(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v2Id}`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ isPinned: true });
    const delPinned = await request(app)
      .delete(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v2Id}`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(delPinned.status).toBe(409);
    expect(delPinned.body.code).toBe("CHECKPOINT_PINNED");

    // Unpin v2 & delete it -> orphaned v2-app-content blob becomes GC-eligible
    await request(app)
      .patch(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v2Id}`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ isPinned: false });
    const delUnpinned = await request(app)
      .delete(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v2Id}`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(delUnpinned.status).toBe(200);

    // Single-file restore of src/app.js back from v1 into working tree
    const singleRestore = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v1Snapshot.id}/restore-file`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ filePath: "src/app.js" });
    expect(singleRestore.status).toBe(200);
    expect(await fsp.readFile(path.join(workspaceRoot, "src", "app.js"), "utf8")).toContain(
      "line1: initial",
    );
    // extra.js from v3 stays until full rollback
    expect(fs.existsSync(path.join(workspaceRoot, "src", "extra.js"))).toBe(true);

    // Full Rollback to v1 with autoBackup -> verifies Bug C3 (Project.activeSnapshotId updated!)
    const rollbackRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v1Snapshot.id}/restore`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ autoBackup: true });
    expect(rollbackRes.status).toBe(200);
    expect(rollbackRes.body.data.backupCheckpoint).toBeTruthy();
    const restoredId = rollbackRes.body.data.restoredCheckpoint.id;
    expect(rollbackRes.body.data.restoredCheckpoint.restoredFromSnapshotId).toBe(v1Snapshot.id);
    expect(fs.existsSync(path.join(workspaceRoot, "src", "extra.js"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, "node_modules", "keep-me", "index.js"))).toBe(true);

    const dbProjectAfterRollback = await testDb.db.project.findUnique({
      where: { id: project.id },
      select: { activeSnapshotId: true },
    });
    expect(dbProjectAfterRollback.activeSnapshotId).toBe(restoredId);

    // Export historical checkpoint v3 as ZIP directly from CAS
    const zipRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v3Id}/export-zip`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers["content-type"]).toContain("application/zip");
    const zip = new AdmZip(zipRes.body);
    const zipEntries = zip.getEntries().map((e) => e.entryName).sort();
    expect(zipEntries).toContain("src/extra.js");
    expect(zip.readAsText("src/app.js")).toBe("v3-app-content\n");

    // CAS GC with graceWindowMs: 0 deletes v2's orphaned blob without touching v1 or v3 blobs
    const gcRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/gc`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ graceWindowMs: 0 });
    expect(gcRes.status).toBe(200);
    expect(gcRes.body.data.deletedCount).toBeGreaterThanOrEqual(1);
    expect(gcRes.body.data.freedBytes).toBeGreaterThan(0);

    // v3 export still works after GC!
    const v3Check = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/checkpoints/${v3Id}/file`)
      .query({ path: "src/app.js" })
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(v3Check.status).toBe(200);
    expect(v3Check.body.data.content).toBe("v3-app-content\n");
  });

  it("8. guards dirty workspace on mergeBranch, maps duplicate branch rename to 409, and stores merge secondParentSnapshotId", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.EMAIL);

    // Bootstrap CAS baseline
    await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/status`)
      .set("Authorization", `Bearer ${ownerJwt}`);

    // Create branch A and branch B
    const bCreate = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ name: "branch-b", fromSnapshotId: v1Snapshot.id, checkout: true });
    expect(bCreate.status).toBe(201);
    const mainId = bCreate.body.data.branches.find((b) => b.name === "main").id;
    const branchBId = bCreate.body.data.branches.find((b) => b.name === "branch-b").id;

    // Renaming branch-b to 'main' must return 409 BRANCH_ALREADY_EXISTS instead of 500
    const dupRename = await request(app)
      .patch(`/api/projects/${project.id}/snapshot-vcs/branches/${branchBId}`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ name: "main" });
    expect(dupRename.status).toBe(409);
    expect(dupRename.body.code).toBe("BRANCH_ALREADY_EXISTS");

    // Capture a clean checkpoint on branch-b
    await fsp.writeFile(path.join(workspaceRoot, "src", "b-feature.js"), "export const b = 1;\n");
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ label: "branch-b work", stageAll: true });

    // Switch to main and make uncommitted working tree edits
    await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/${mainId}/checkout`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({});
    await fsp.writeFile(path.join(workspaceRoot, "src", "dirty-local.js"), "export const dirty = true;\n");

    // Merging branch-b into active dirty main defaults to 409 DIRTY_WORKSPACE (never silently overwrites!)
    const dirtyBlocked = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/merge`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ sourceBranchId: branchBId });
    expect(dirtyBlocked.status).toBe(409);
    expect(dirtyBlocked.body.code).toBe("DIRTY_WORKSPACE");
    expect(fs.existsSync(path.join(workspaceRoot, "src", "dirty-local.js"))).toBe(true);

    // Merging with AUTO_BACKUP backs up uncommitted edits into main and merges cleanly preserving both files
    const mergedRes = await request(app)
      .post(`/api/projects/${project.id}/snapshot-vcs/branches/merge`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ sourceBranchId: branchBId, dirtyPolicy: "AUTO_BACKUP" });
    expect(mergedRes.status).toBe(200);
    expect(mergedRes.body.data.merged).toBe(true);
    expect(mergedRes.body.data.backupCheckpoint).toBeTruthy();
    expect(fs.existsSync(path.join(workspaceRoot, "src", "dirty-local.js"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "src", "b-feature.js"))).toBe(true);

    // Merged checkpoint exposes secondParentSnapshotId + 2-parent DAG array
    const listRes = await request(app)
      .get(`/api/projects/${project.id}/snapshot-vcs/checkpoints`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    const mergeCp = listRes.body.data.checkpoints.find(
      (c) => c.id === mergedRes.body.data.checkpointId,
    );
    expect(mergeCp.secondParentSnapshotId).toBeTruthy();
    expect(mergeCp.parents.length).toBe(2);
  });
});
