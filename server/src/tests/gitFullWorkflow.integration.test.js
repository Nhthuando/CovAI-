import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAuthTestDatabase } from "./helpers/authTestDatabase.js";
import { encrypt } from "../utils/crypto.js";

const execFileAsync = promisify(execFile);
jest.setTimeout(60000);
const testDb = await createAuthTestDatabase();

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: testDb.db,
}));

jest.unstable_mockModule("../services/gemini.service.js", () => ({
  generateText: jest.fn(async () =>
    JSON.stringify({
      type: "feat",
      scope: "cart",
      subject: "add quantity validation",
      body: "- guard against negative quantities",
    }),
  ),
}));

let GitService;
let gitRoute;
let AUTH_PROVIDERS;
let AUTH_ERROR_CODES;

try {
  ({ GitService } = await import("../services/git.service.js"));
  ({ default: gitRoute } = await import("../routes/git.route.js"));
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
  app.use("/api/git", gitRoute);
  app.use(
    "/api/projects/:projectId/git",
    (req, _res, next) => {
      if (req.method === "GET" || req.method === "HEAD") {
        req.query = { ...req.query, projectId: req.params.projectId };
      } else {
        req.body = { ...(req.body || {}), projectId: req.params.projectId };
      }
      next();
    },
    gitRoute,
  );
  return app;
}

describe("Phase 1 Full Git & GitHub Workflow Integration", () => {
  const origEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  };
  const origFetch = global.fetch;

  let app;
  let owner;
  let editor;
  let viewer;
  let emailUser;
  let project;
  let snapshot;
  let repoRoot;
  let bareRemoteDir;
  let peerCloneDir;

  beforeAll(() => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || "phase1_test_jwt_secret_1234567890";
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || "0123456789abcdef".repeat(4);
    app = buildApp();
  });

  beforeEach(async () => {
    global.fetch = origFetch;
    await testDb.db.project.deleteMany({});
    await testDb.resetAuthTables();

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-git-wf-repo-"));
    bareRemoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-git-wf-bare-"));
    peerCloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-git-wf-peer-"));

    await execFileAsync("git", ["init", "--bare", "--initial-branch=main"], {
      cwd: bareRemoteDir,
      windowsHide: true,
    }).catch(async () => {
      await execFileAsync("git", ["init", "--bare"], {
        cwd: bareRemoteDir,
        windowsHide: true,
      });
    });

    owner = await testDb.db.user.create({
      data: {
        email: "owner@gh.dev",
        name: "Owner Octo",
        githubUserId: "gh-owner-1",
        githubLogin: "owner-octo",
        githubOAuthScopes: "repo,read:user,user:email",
        githubAccessTokenEnc: encrypt("gho_owner_secret_token_12345"),
        lastAuthProvider: "github",
      },
    });
    editor = await testDb.db.user.create({
      data: {
        email: "editor@gh.dev",
        name: "Editor Octo",
        githubUserId: "gh-editor-2",
        githubLogin: "editor-octo",
        githubOAuthScopes: "repo,read:user,user:email",
        lastAuthProvider: "github",
      },
    });
    viewer = await testDb.db.user.create({
      data: {
        email: "viewer@gh.dev",
        name: "Viewer Octo",
        githubUserId: "gh-viewer-3",
        lastAuthProvider: "github",
      },
    });
    emailUser = await testDb.db.user.create({
      data: {
        email: "emailonly@covai.dev",
        name: "Email Only",
        passwordHash: "hashed",
        lastAuthProvider: "email",
      },
    });

    fs.writeFileSync(
      path.join(repoRoot, "index.js"),
      "export function greet() { return 'hello'; }\n",
      "utf8",
    );

    project = await testDb.db.project.create({
      data: {
        name: "Full Git App",
        ownerId: owner.id,
        defaultBranch: "main",
      },
    });
    snapshot = await testDb.db.projectSnapshot.create({
      data: {
        projectId: project.id,
        source: "ZIP",
        storagePath: repoRoot,
        rootDir: repoRoot,
      },
    });
    await testDb.db.project.update({
      where: { id: project.id },
      data: { activeSnapshotId: snapshot.id },
    });
    await testDb.db.projectMember.createMany({
      data: [
        { projectId: project.id, userId: editor.id, role: "EDITOR" },
        { projectId: project.id, userId: viewer.id, role: "VIEWER" },
      ],
    });
  });

  afterEach(async () => {
    global.fetch = origFetch;
    if (project) {
      const operations = await testDb.db.projectOperation.findMany({
        where: { projectId: project.id },
        select: { id: true },
      });
      await testDb.db.project.deleteMany({ where: { id: project.id } });
      const opParent = path.resolve(".covai-temp/collaboration-operations");
      for (const op of operations) {
        await fsp.rm(path.join(opParent, op.id), { recursive: true, force: true });
      }
    }
    await testDb.resetAuthTables();
    for (const dir of [repoRoot, bareRemoteDir, peerCloneDir]) {
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  afterAll(async () => {
    Object.entries(origEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    await testDb.close();
  });

  it("blocks Email session with 403 AUTH_PROVIDER_MISMATCH on /api/git/* & /api/projects/:id/git/*", async () => {
    const emailJwt = makeJwt(emailUser, AUTH_PROVIDERS.EMAIL);
    const res1 = await request(app)
      .get(`/api/git/status?projectId=${project.id}`)
      .set("Authorization", `Bearer ${emailJwt}`);
    expect(res1.status).toBe(403);
    expect(res1.body).toMatchObject({
      success: false,
      code: AUTH_ERROR_CODES.AUTH_PROVIDER_MISMATCH,
    });

    const res2 = await request(app)
      .post(`/api/projects/${project.id}/git/init`)
      .set("Authorization", `Bearer ${emailJwt}`)
      .send({});
    expect(res2.status).toBe(403);
    expect(res2.body.code).toBe(AUTH_ERROR_CODES.AUTH_PROVIDER_MISMATCH);
  });

  it("runs complete local workflow: init ZIP project, excludes artifacts, EDITOR commits with own identity, amend, undo, diff-pair, stashes, tags", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.GITHUB);
    const editorJwt = makeJwt(editor, AUTH_PROVIDERS.GITHUB);
    const viewerJwt = makeJwt(viewer, AUTH_PROVIDERS.GITHUB);

    // 1. Before init: status reports canInitialize=true instead of 403
    const preStatus = await request(app)
      .get(`/api/git/status?projectId=${project.id}`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(preStatus.status).toBe(200);
    expect(preStatus.body.data.hasGit).toBe(false);
    expect(preStatus.body.data.canInitialize).toBe(true);

    // 2. Owner initializes repo; test runner artifacts in coverage/ & test-results/ are ignored without dirtying .gitignore
    const initRes = await request(app)
      .post(`/api/projects/${project.id}/git/init`)
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ defaultBranch: "main", createInitialCommit: true });
    expect(initRes.status).toBe(200);
    expect(initRes.body.data.hasGit).toBe(true);
    expect(initRes.body.data.branch).toBe("main");

    fs.mkdirSync(path.join(repoRoot, "coverage"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "coverage", "lcov.info"), "ignored");
    fs.mkdirSync(path.join(repoRoot, "test-results"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "test-results", "run.json"), "ignored");

    // 3. Add untracked file & check diff-pair + status
    fs.writeFileSync(path.join(repoRoot, "helper.js"), "export const add = (a, b) => a + b;\n");
    const statusWithNew = await request(app)
      .get(`/api/git/status?projectId=${project.id}&includeTracked=true`)
      .set("Authorization", `Bearer ${editorJwt}`);
    expect(statusWithNew.status).toBe(200);
    expect(statusWithNew.body.data.untracked.map((f) => f.path)).toEqual(["helper.js"]);
    expect(statusWithNew.body.data.unchangedCount).toBeGreaterThanOrEqual(1);

    const untrackedDiff = await request(app)
      .get(`/api/git/diff-pair?projectId=${project.id}&filePath=helper.js&mode=working`)
      .set("Authorization", `Bearer ${editorJwt}`);
    expect(untrackedDiff.status).toBe(200);
    expect(untrackedDiff.body.data).toMatchObject({
      filePath: "helper.js",
      originalContent: "",
      modifiedContent: "export const add = (a, b) => a + b;\n",
      stats: { insertions: 1, deletions: 0 },
    });

    // 4. VIEWER blocked on vcs.local
    const viewerStage = await request(app)
      .post("/api/git/stage")
      .set("Authorization", `Bearer ${viewerJwt}`)
      .send({ projectId: project.id, files: ["helper.js"] });
    expect(viewerStage.status).toBe(403);

    // 5. EDITOR stages and uses AI commit message, then commits as EDITOR identity (NOT Owner!)
    const editorStage = await request(app)
      .post("/api/git/stage")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id, files: ["helper.js"] });
    expect(editorStage.status).toBe(200);
    expect(editorStage.body.data.staged.map((f) => f.path)).toContain("helper.js");

    const aiMsg = await request(app)
      .post("/api/git/ai-commit-message")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id });
    expect(aiMsg.status).toBe(200);
    expect(aiMsg.body.data.subject).toContain("feat(cart):");

    // EDITOR cannot use pushAfter
    const editorPushCommit = await request(app)
      .post("/api/git/commit")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id, message: "feat: editor local commit", pushAfter: true });
    expect(editorPushCommit.status).toBe(403);

    // EDITOR local commit succeeds with EDITOR author
    const editorCommit = await request(app)
      .post("/api/git/commit")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({
        projectId: project.id,
        message: "feat: editor local commit",
        stageAll: false,
      });
    expect(editorCommit.status).toBe(200);

    const logRes = await request(app)
      .get(`/api/git/log?projectId=${project.id}&limit=10`)
      .set("Authorization", `Bearer ${editorJwt}`);
    expect(logRes.status).toBe(200);
    expect(logRes.body.data[0]).toMatchObject({
      author: "Editor Octo",
      email: "editor@gh.dev",
      subject: "feat: editor local commit",
    });

    // Snapshot commitSha updated in DB
    const refreshedSnap = await testDb.db.projectSnapshot.findUnique({
      where: { id: snapshot.id },
      select: { commitSha: true },
    });
    expect(refreshedSnap.commitSha).toBe(logRes.body.data[0].hash);

    // 6. Amend & undo commit
    fs.writeFileSync(path.join(repoRoot, "helper.js"), "export const add = (a, b) => Number(a) + Number(b);\n");
    const amendRes = await request(app)
      .post("/api/git/commit")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({
        projectId: project.id,
        message: "feat: amended commit message",
        amend: true,
        stageAll: true,
      });
    expect(amendRes.status).toBe(200);

    const logAfterAmend = await request(app)
      .get(`/api/git/log?projectId=${project.id}&limit=10`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(logAfterAmend.body.data[0].subject).toBe("feat: amended commit message");

    const undoRes = await request(app)
      .post("/api/git/undo-commit")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id });
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.data.staged.map((f) => f.path)).toContain("helper.js");

    // Re-commit, test stash + tag lifecycle
    await request(app)
      .post("/api/git/commit")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, message: "feat: finalize helper" });

    fs.writeFileSync(path.join(repoRoot, "wip.txt"), "work in progress\n");
    const stashPush = await request(app)
      .post("/api/git/stashes")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id, message: "save wip", includeUntracked: true });
    expect(stashPush.status).toBe(200);
    expect(stashPush.body.data.stashes).toHaveLength(1);
    expect(fs.existsSync(path.join(repoRoot, "wip.txt"))).toBe(false);

    const stashPop = await request(app)
      .post("/api/git/stashes/0/pop")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id });
    expect(stashPop.status).toBe(200);
    expect(fs.existsSync(path.join(repoRoot, "wip.txt"))).toBe(true);

    // Tag create + delete
    const tagRes = await request(app)
      .post("/api/git/tags")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, name: "v1.0.0", message: "Initial release" });
    expect(tagRes.status).toBe(200);
    expect(tagRes.body.data.tags.map((t) => t.name)).toContain("v1.0.0");

    const delTag = await request(app)
      .delete(`/api/git/tags/v1.0.0?projectId=${project.id}`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(delTag.status).toBe(200);
    expect(delTag.body.data.tags).toEqual([]);
  });

  it("supports bare remote push/fetch/pull/sync, branch merge, 3-way conflict resolution, and activeSnapshotId alignment", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.GITHUB);

    await GitService.initRepo(project.id, owner.id, {
      defaultBranch: "main",
      createInitialCommit: true,
    });
    await GitService.runCommand(repoRoot, ["remote", "add", "origin", bareRemoteDir]);

    // 1. Push main to bare remote (token never written to .git/config!)
    const pushRes = await request(app)
      .post("/api/git/push")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, branch: "main" });
    expect(pushRes.status).toBe(200);
    expect(pushRes.body.data.status.tracking).toBe("origin/main");

    const gitConfigText = fs.readFileSync(path.join(repoRoot, ".git", "config"), "utf8");
    expect(gitConfigText).not.toContain("x-access-token");
    expect(gitConfigText).not.toContain("gho_");

    // 2. Peer clones bare remote and pushes a new commit -> fetch + pull + sync picks it up
    await execFileAsync("git", ["clone", bareRemoteDir, peerCloneDir], {
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Peer Dev"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "peer@covai.test"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    fs.writeFileSync(path.join(peerCloneDir, "remote-file.js"), "export const r = 1;\n");
    await execFileAsync("git", ["add", "remote-file.js"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["commit", "-m", "feat: remote commit"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["push", "origin", "main"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });

    const fetchRes = await request(app)
      .post("/api/git/fetch")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id });
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.data.status.behind).toBe(1);

    const syncRes = await request(app)
      .post("/api/git/sync")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id });
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.data.status.behind).toBe(0);
    expect(fs.existsSync(path.join(repoRoot, "remote-file.js"))).toBe(true);

    // 3. Create branch -> divergent edit -> merge conflict -> getConflicts -> resolveConflict -> mergeContinue
    await request(app)
      .post("/api/git/checkout")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, branch: "feat/conflict", createNew: true });
    fs.writeFileSync(path.join(repoRoot, "index.js"), "export const v = 'theirs';\n");
    await request(app)
      .post("/api/git/commit")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, message: "feat: branch change" });

    await request(app)
      .post("/api/git/checkout")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, branch: "main" });
    fs.writeFileSync(path.join(repoRoot, "index.js"), "export const v = 'ours';\n");
    await request(app)
      .post("/api/git/commit")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, message: "fix: main change" });

    const mergeConflict = await request(app)
      .post("/api/git/merge")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, sourceBranch: "feat/conflict" });
    expect(mergeConflict.status).toBe(200);
    expect(mergeConflict.body.data.conflicted).toBe(true);
    expect(mergeConflict.body.data.conflicts.map((c) => c.path)).toContain("index.js");

    const conflictsList = await request(app)
      .get(`/api/git/conflicts?projectId=${project.id}`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(conflictsList.status).toBe(200);
    expect(conflictsList.body.data.conflicts[0]).toMatchObject({
      path: "index.js",
      ours: expect.stringContaining("ours"),
      theirs: expect.stringContaining("theirs"),
    });

    const resolveRes = await request(app)
      .post("/api/git/conflicts/resolve")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({
        projectId: project.id,
        filePath: "index.js",
        resolution: "manual",
        manualContent: "export const v = 'resolved';\n",
      });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.data.conflicts).toHaveLength(0);

    const mergeComplete = await request(app)
      .post("/api/git/merge/continue")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id });
    expect(mergeComplete.status).toBe(200);
    expect(mergeComplete.body.data.operationState).toBe("IDLE");
    expect(fs.readFileSync(path.join(repoRoot, "index.js"), "utf8")).toBe(
      "export const v = 'resolved';\n",
    );

    // 4. Bug H1 regression: activating older snapshot works instead of newest-only createdAt
    const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-snap2-"));
    try {
      fs.writeFileSync(path.join(secondDir, "index.js"), "newer dir");
      await testDb.db.projectSnapshot.create({
        data: {
          projectId: project.id,
          source: "ZIP",
          storagePath: secondDir,
          rootDir: secondDir,
          createdAt: new Date(Date.now() + 60_000),
        },
      });
      // activeSnapshotId still points to `snapshot` (repoRoot)
      const resolved = await GitService.getRepoPath(project.id, owner.id);
      expect(resolved.snapshot.id).toBe(snapshot.id);
      expect(resolved.rootDir).toBe(repoRoot);
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("handles mocked GitHub API PRs, commit checks, and EDITOR remote token isolation", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.GITHUB);
    const editorJwt = makeJwt(editor, AUTH_PROVIDERS.GITHUB);

    await testDb.db.project.update({
      where: { id: project.id },
      data: { repoUrl: "https://github.com/owner-octo/demo-app" },
    });

    global.fetch = jest.fn(async (url, init) => {
      const target = String(url);
      if (target.includes("/pulls") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 10,
              number: 42,
              title: "feat: vcs upgrade",
              state: "open",
              draft: false,
              html_url: "https://github.com/owner-octo/demo-app/pull/42",
              head: { ref: "feat/vcs" },
              base: { ref: "main" },
              user: { login: "owner-octo", avatar_url: null },
              created_at: "2026-11-26T00:00:00Z",
              updated_at: "2026-11-26T01:00:00Z",
            },
          ],
        };
      }
      if (target.includes("/pulls") && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 11,
            number: 43,
            title: "feat: open PR",
            state: "open",
            draft: false,
            html_url: "https://github.com/owner-octo/demo-app/pull/43",
            head: { ref: "feat/vcs" },
            base: { ref: "main" },
            created_at: "2026-11-26T01:05:00Z",
          }),
        };
      }
      if (target.includes("/commits/") && target.endsWith("/status")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ state: "success", statuses: [] }),
        };
      }
      if (target.includes("/commits/") && target.endsWith("/check-runs")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            check_runs: [
              { id: 1, name: "CI Tests", status: "completed", conclusion: "success" },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });

    const prs = await request(app)
      .get(`/api/git/github/pulls?projectId=${project.id}`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(prs.status).toBe(200);
    expect(prs.body.data[0].number).toBe(42);

    // EDITOR cannot create PR (integrations.write = OWNER only) and never borrows OWNER token
    const editorPr = await request(app)
      .post("/api/git/github/pulls")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({
        projectId: project.id,
        title: "feat: unauthorized pr",
        head: "feat/vcs",
        base: "main",
      });
    expect(editorPr.status).toBe(403);

    const createdPr = await request(app)
      .post("/api/git/github/pulls")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({
        projectId: project.id,
        title: "feat: open PR",
        head: "feat/vcs",
        base: "main",
      });
    expect(createdPr.status).toBe(201);
    expect(createdPr.body.data.number).toBe(43);

    const checks = await request(app)
      .get(`/api/git/github/checks?projectId=${project.id}&ref=main`)
      .set("Authorization", `Bearer ${ownerJwt}`);
    expect(checks.status).toBe(200);
    expect(checks.body.data.overallState).toBe("success");
    expect(checks.body.data.checkRuns[0].name).toBe("CI Tests");
  });

  it("preserves tracked .env.example templates and existing core.autocrlf across stage & commit", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.GITHUB);

    fs.writeFileSync(
      path.join(repoRoot, ".env.example"),
      "DATABASE_URL=postgresql://localhost:5432/demo\n",
      "utf8",
    );
    fs.mkdirSync(path.join(repoRoot, ".agents"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, ".agents", "guide.md"),
      "# Agent Guidelines\n",
      "utf8",
    );
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# Demo Repo\n", "utf8");

    await GitService.initRepo(project.id, owner.id, {
      defaultBranch: "main",
      createInitialCommit: true,
    });

    // Simulate a repo that explicitly uses core.autocrlf=true prior to CovAI staging
    await execFileAsync("git", ["config", "core.autocrlf", "true"], {
      cwd: repoRoot,
      windowsHide: true,
    });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# Demo Repo\nAdded line\n", "utf8");

    const stageRes = await request(app)
      .post("/api/git/stage")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, files: "all" });
    expect(stageRes.status).toBe(200);

    const stagedPaths = stageRes.body.data.staged.map((f) => `${f.status}:${f.path}`);
    expect(stagedPaths).toContain("M:README.md");
    expect(stagedPaths).not.toContain("D:.env.example");
    expect(stagedPaths).not.toContain("D:.agents/guide.md");
    expect(fs.existsSync(path.join(repoRoot, ".env.example"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, ".agents", "guide.md"))).toBe(true);

    // Standard Git mutations execute directly inside repoRoot under per-project VCS lock without sandbox copies
    const ops = await testDb.db.projectOperation.findMany({
      where: { projectId: project.id },
      select: { id: true },
    });
    expect(ops).toHaveLength(0);

    const { stdout: autocrlfOut } = await execFileAsync(
      "git",
      ["config", "--local", "core.autocrlf"],
      { cwd: repoRoot, windowsHide: true },
    );
    expect(autocrlfOut.trim()).toBe("true");
  });

  it("Smart Git Console parses CLI commands, executes real git pull against bare remote, enforces RBAC, and blocks shell/destructive injection", async () => {
    const ownerJwt = makeJwt(owner, AUTH_PROVIDERS.GITHUB);
    const editorJwt = makeJwt(editor, AUTH_PROVIDERS.GITHUB);
    const viewerJwt = makeJwt(viewer, AUTH_PROVIDERS.GITHUB);

    await GitService.initRepo(project.id, owner.id, {
      defaultBranch: "main",
      createInitialCommit: true,
    });
    await execFileAsync("git", ["remote", "add", "origin", bareRemoteDir], {
      cwd: repoRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["push", "-u", "origin", "main"], {
      cwd: repoRoot,
      windowsHide: true,
    });

    // Peer pushes a new commit to the bare remote
    await execFileAsync("git", ["clone", bareRemoteDir, peerCloneDir], {
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Peer Dev"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "peer@covai.dev"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    fs.writeFileSync(path.join(peerCloneDir, "from-remote.txt"), "synced via smart console\n", "utf8");
    await execFileAsync("git", ["add", "from-remote.txt"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["commit", "-m", "feat: peer remote commit"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["push", "origin", "main"], {
      cwd: peerCloneDir,
      windowsHide: true,
    });

    // 1. Read-only console commands (with or without leading "git ")
    const statusCmd = await request(app)
      .post("/api/git/command")
      .set("Authorization", `Bearer ${viewerJwt}`)
      .send({ projectId: project.id, input: "status -s -b" });
    expect(statusCmd.status).toBe(200);
    expect(statusCmd.body.data.mutated).toBe(false);
    expect(statusCmd.body.result).toContain("main");

    const logCmd = await request(app)
      .post("/api/git/command")
      .set("Authorization", `Bearer ${viewerJwt}`)
      .send({ projectId: project.id, input: "git log -n 3 --oneline" });
    expect(logCmd.status).toBe(200);
    expect(logCmd.body.result).toContain("initial");

    const remoteCmd = await request(app)
      .post("/api/git/command")
      .set("Authorization", `Bearer ${viewerJwt}`)
      .send({ projectId: project.id, input: "git remote -v" });
    expect(remoteCmd.status).toBe(200);
    expect(remoteCmd.body.result).toContain("origin");

    // 2. EDITOR cannot run remote or branch commands via console
    for (const blockedForEditor of [
      "git pull origin main",
      "git push origin main",
      "git checkout -b hack",
      "git branch hack",
    ]) {
      const denied = await request(app)
        .post("/api/git/command")
        .set("Authorization", `Bearer ${editorJwt}`)
        .send({ projectId: project.id, input: blockedForEditor });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("CAPABILITY_DENIED");
    }

    // 3. OWNER executes real `git pull origin main` from console -> updates workspace & returns mutated=true + status
    const pullCmd = await request(app)
      .post("/api/git/command")
      .set("Authorization", `Bearer ${ownerJwt}`)
      .send({ projectId: project.id, input: "git pull origin main" });
    expect(pullCmd.status).toBe(200);
    expect(pullCmd.body.data).toMatchObject({
      command: "git pull origin main",
      mutated: true,
      syncWorkspace: true,
      conflicted: false,
    });
    expect(pullCmd.body.data.status.hasGit).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, "from-remote.txt"), "utf8")).toBe(
      "synced via smart console\n",
    );

    // 4. EDITOR can stage & commit locally via console using EDITOR identity; VIEWER is blocked
    fs.writeFileSync(path.join(repoRoot, "console-note.md"), "# Console test\n", "utf8");

    const viewerAdd = await request(app)
      .post("/api/git/command")
      .set("Authorization", `Bearer ${viewerJwt}`)
      .send({ projectId: project.id, input: "git add ." });
    expect(viewerAdd.status).toBe(403);

    const editorAdd = await request(app)
      .post("/api/git/command")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id, input: "git add console-note.md" });
    expect(editorAdd.status).toBe(200);
    expect(editorAdd.body.data.mutated).toBe(true);
    expect(editorAdd.body.data.status.staged.map((f) => f.path)).toContain("console-note.md");

    const editorCommit = await request(app)
      .post("/api/git/command")
      .set("Authorization", `Bearer ${editorJwt}`)
      .send({ projectId: project.id, input: 'git commit -m "feat: console commit"' });
    expect(editorCommit.status).toBe(200);
    expect(editorCommit.body.data.mutated).toBe(true);
    expect(editorCommit.body.data.syncWorkspace).toBe(true);
    expect(editorCommit.body.data.status.clean).toBe(true);

    const logAfterCommit = await request(app)
      .get(`/api/git/log?projectId=${project.id}&limit=5`)
      .set("Authorization", `Bearer ${editorJwt}`);
    expect(logAfterCommit.body.data[0]).toMatchObject({
      author: "Editor Octo",
      email: "editor@gh.dev",
      subject: "feat: console commit",
    });

    // 5. Blocked/malicious/unsupported commands fail clearly and NEVER fall back to `git status`
    for (const [badCmd, expectedStatuses] of [
      ["git status; echo pwned", [403]],
      ["git log | cat", [403]],
      ["git status && ls", [403]],
      ["git log $(whoami)", [403]],
      ["git diff --ext-diff", [403]],
      ["git -c core.sshCommand=bad status", [403]],
      ["git reset --hard HEAD~1", [403]],
      ["git push --force origin main", [403]],
      ["git branch -D main", [403]],
      ["git config user.name evil", [403]],
      ["git foobar", [400]],
    ]) {
      const badRes = await request(app)
        .post("/api/git/command")
        .set("Authorization", `Bearer ${ownerJwt}`)
        .send({ projectId: project.id, input: badCmd });
      expect(expectedStatuses).toContain(badRes.status);
      expect(badRes.body.success).toBe(false);
    }
  });
});
