import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { createAuthTestDatabase } from "../src/tests/helpers/authTestDatabase.js";

const execFileAsync = promisify(execFile);

process.env.NODE_ENV = "test";
process.env.COVAI_WORKER_ENABLED = "false";
process.env.PROJECT_EDITOR_ENABLED = "false";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "e2e-vcs-jwt-secret-key-2026-32chars";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "e2e-vcs-refresh-secret-key-2026";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "d".repeat(64);
process.env.GITHUB_CLIENT_ID =
  process.env.GITHUB_CLIENT_ID || "e2e-github-client-id";
process.env.GITHUB_CLIENT_SECRET =
  process.env.GITHUB_CLIENT_SECRET || "e2e-github-client-secret";
const PORT = Number(process.env.E2E_API_PORT || 55110);
const CLIENT_URL = process.env.CLIENT_URL || "http://127.0.0.1:55283";
process.env.CLIENT_URL = CLIENT_URL;
process.env.LOGIN_IP_RATE_LIMIT_MAX = "1000";

const MOCK_GH_USER = {
  code: "e2e-gh-vcs",
  token: "gho_e2e_vcs_secret_token_999",
  scope: "read:user,user:email,repo",
  user: {
    id: 990101,
    login: "e2e-vcs-octo",
    name: "E2E GitHub Dev",
    avatar_url: "",
  },
  emails: [{ email: "gh-vcs@covai.test", primary: true, verified: true }],
};

const originalFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const urlStr = String(url);
  if (urlStr === "https://github.com/login/oauth/access_token") {
    const body = JSON.parse(init.body || "{}");
    if (body.code === MOCK_GH_USER.code) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: MOCK_GH_USER.token,
          scope: MOCK_GH_USER.scope,
          token_type: "bearer",
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        error: "bad_verification_code",
        error_description: "Invalid test OAuth code",
      }),
    };
  }

  if (urlStr === "https://api.github.com/user") {
    const auth = init.headers?.Authorization || init.headers?.authorization || "";
    const token = auth.replace(/^(Bearer|token)\s+/i, "").trim();
    const ok = token === MOCK_GH_USER.token;
    return {
      ok,
      status: ok ? 200 : 401,
      headers: {
        get: (h) =>
          String(h).toLowerCase() === "x-oauth-scopes" ? MOCK_GH_USER.scope : null,
      },
      json: async () =>
        ok ? MOCK_GH_USER.user : { message: "Bad credentials" },
    };
  }

  if (urlStr === "https://api.github.com/user/emails") {
    const auth = init.headers?.Authorization || init.headers?.authorization || "";
    const token = auth.replace(/^(Bearer|token)\s+/i, "").trim();
    const ok = token === MOCK_GH_USER.token;
    return {
      ok,
      status: ok ? 200 : 401,
      json: async () => (ok ? MOCK_GH_USER.emails : []),
    };
  }

  if (urlStr.startsWith("https://api.github.com/user/repos")) {
    return {
      ok: true,
      status: 200,
      json: async () => [],
    };
  }

  return originalFetch(url, init);
};

const testDb = await createAuthTestDatabase();

const { default: authRoute } = await import("../src/routes/auth.route.js");
const { default: refreshRoute } = await import("../src/routes/refresh.route.js");
const { default: userRoute } = await import("../src/routes/user.route.js");
const { default: gitRoute } = await import("../src/routes/git.route.js");
const { default: snapshotVcsRoute } = await import(
  "../src/routes/snapshotVcs.route.js"
);
const { default: projectMemberRoutes } = await import(
  "../src/routes/projectMember.route.js"
);
const { default: projectEventRoutes } = await import(
  "../src/routes/projectEvent.route.js"
);
const { authMiddleware } = await import("../src/middlewares/auth.middleware.js");
const { attachProjectSubscriptions, deliverScopedProjectTransport } =
  await import("../src/services/projectSubscription.service.js");
const { subscribeToUserRoom } = await import(
  "../src/utils/socketSubscription.js"
);
const { SnapshotVcsService } = await import(
  "../src/services/snapshotVcs.service.js"
);
const { resolveActiveProjectSnapshot } = await import(
  "../src/services/projectFileVersion.service.js"
);
const { encrypt } = await import("../src/utils/crypto.js");
const { parseGithubScopes, hasGithubRepoWriteScope } = await import(
  "../../shared/versionControlMode.js"
);

const e2eState = {
  tempDirs: new Set(),
  seededProjectIds: new Set(),
  gitRepoDir: null,
  bareRemoteDir: null,
  snapshotWorkDir: null,
  gitProjectId: null,
  snapshotProjectId: null,
};

async function cleanupWorkdirs() {
  for (const dir of e2eState.tempDirs) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  e2eState.tempDirs.clear();

  for (const projectId of e2eState.seededProjectIds) {
    const casDir = path.join(process.cwd(), "storage", "projects", projectId);
    await fsp.rm(casDir, { recursive: true, force: true }).catch(() => {});
  }
  e2eState.seededProjectIds.clear();

  e2eState.gitRepoDir = null;
  e2eState.bareRemoteDir = null;
  e2eState.snapshotWorkDir = null;
  e2eState.gitProjectId = null;
  e2eState.snapshotProjectId = null;
}

async function resetAllTables() {
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
  await testDb.db.projectSnapshot.deleteMany({});
  await testDb.db.projectMember.deleteMany({});
  await testDb.db.projectEvent.deleteMany({});
  await testDb.db.project.deleteMany({});
  await testDb.resetAuthTables();
}

function buildDiskTree(rootDir, currentDir = rootDir) {
  if (!fs.existsSync(currentDir)) return [];
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const folders = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const abs = path.join(currentDir, entry.name);
    const rel = path.relative(rootDir, abs).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      folders.push({
        id: rel,
        name: entry.name,
        path: rel,
        type: "folder",
        children: buildDiskTree(rootDir, abs),
      });
    } else if (entry.isFile()) {
      files.push({
        id: rel,
        name: entry.name,
        path: rel,
        type: "file",
      });
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

function resolveContainedPath(rootDir, relPath) {
  const cleanRel = String(relPath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const realRoot = path.resolve(rootDir);
  const abs = path.resolve(realRoot, cleanRel);
  const rel = path.relative(realRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid file path");
  }
  return { cleanRel, abs };
}

async function resolveProjectRoot(projectId) {
  const active = await resolveActiveProjectSnapshot(testDb.db, projectId);
  return {
    snapshot: active,
    rootDir: active?.storagePath || null,
  };
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, credentials: true },
});
global.io = io;

io.on("connection", (socket) => {
  socket.on("subscribe_notifications", (userId) => {
    subscribeToUserRoom(socket, userId);
  });
});
attachProjectSubscriptions(io);

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => res.json({ success: true }));
app.use("/api/auth", authRoute);
app.use("/api/refresh", refreshRoute);
app.use("/api/users", userRoute);
app.use("/api/projects", projectMemberRoutes);
app.use("/api/projects", projectEventRoutes);
app.use("/api/projects/:projectId/snapshot-vcs", snapshotVcsRoute);
app.use("/api/projects/:projectId/vcs/snapshots", snapshotVcsRoute);
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

// Lightweight GitHub & Dashboard stubs so IDE renders cleanly in isolation
app.get("/api/github/capabilities", authMiddleware, async (req, res) => {
  const user = await testDb.db.user.findUnique({
    where: { id: req.user.id },
    select: {
      githubUserId: true,
      githubLogin: true,
      githubOAuthScopes: true,
      githubAccessTokenEnc: true,
    },
  });
  const scopes = parseGithubScopes(user?.githubOAuthScopes);
  res.json({
    success: true,
    data: {
      connected: Boolean(user?.githubUserId && user?.githubAccessTokenEnc),
      githubLogin: user?.githubLogin || null,
      scopes,
      hasRepoScope: hasGithubRepoWriteScope(scopes),
    },
  });
});

app.get("/api/github/repos", authMiddleware, (_req, res) =>
  res.json({ success: true, data: [] }),
);

app.get("/api/notifications", authMiddleware, (_req, res) =>
  res.json({ success: true, notifications: [] }),
);
app.get("/api/notifications/unread-count", authMiddleware, (_req, res) =>
  res.json({ success: true, unreadCount: 0, count: 0 }),
);
app.get("/api/portfolio/summary", authMiddleware, async (req, res) => {
  const rows = await testDb.db.project.findMany({
    where: { ownerId: req.user.id },
    include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  res.json({
    success: true,
    data: {
      projects: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        repoUrl: p.repoUrl,
        defaultBranch: p.defaultBranch,
        snapshotId: p.activeSnapshotId || p.snapshots?.[0]?.id || null,
      })),
      totals: { projects: rows.length },
    },
  });
});
app.get("/api/portfolio/overview", authMiddleware, async (req, res) => {
  const rows = await testDb.db.project.findMany({
    where: { ownerId: req.user.id },
    orderBy: { updatedAt: "desc" },
    include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  res.json({
    success: true,
    data: {
      projects: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        repoUrl: p.repoUrl,
        defaultBranch: p.defaultBranch,
        lifecycleStatus: p.lifecycleStatus || "NOT_STARTED",
        snapshotId: p.activeSnapshotId || p.snapshots?.[0]?.id || null,
      })),
      totals: { projects: rows.length },
      summary: { totalProjects: rows.length },
    },
  });
});
app.get("/api/job/user", authMiddleware, (_req, res) =>
  res.json({ success: true, jobs: [] }),
);
app.get("/api/job/:projectId/jobs", authMiddleware, (_req, res) =>
  res.json({ success: true, jobs: [] }),
);
app.get("/api/job/projects/:projectId", authMiddleware, (_req, res) =>
  res.json({ success: true, data: [] }),
);
app.get("/api/job/running", authMiddleware, (_req, res) =>
  res.json({ success: true, data: [] }),
);
app.get("/api/coverage/unified-summary/:projectId", authMiddleware, (_req, res) =>
  res.json({ success: true, data: null }),
);
app.get("/api/coverage/:snapshotId/file-coverage", authMiddleware, (_req, res) =>
  res.json({ success: true, data: null }),
);
app.get("/api/ai-agents/profiles", authMiddleware, (_req, res) =>
  res.json({ success: true, data: [] }),
);
app.get("/api/settings/ai-quotas", authMiddleware, (_req, res) =>
  res.json({ success: true, data: { remaining: 50, limit: 50 } }),
);

// Minimal real project/workspace file routes against testDb + temp disk
app.get("/api/projects", authMiddleware, async (req, res) => {
  const projects = await testDb.db.project.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      snapshots: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { snapshots: true } },
    },
  });
  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      repoUrl: p.repoUrl,
      defaultBranch: p.defaultBranch,
      lifecycleStatus: p.lifecycleStatus || "NOT_STARTED",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      snapshotCount: p._count.snapshots,
      latestSnapshotId: p.snapshots?.[0]?.id || null,
      activeSnapshotId: p.activeSnapshotId || p.snapshots?.[0]?.id || null,
    })),
  });
});

app.get("/api/projects/:id", authMiddleware, async (req, res) => {
  const project = await testDb.db.project.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
    include: {
      snapshots: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) {
    return res.status(404).json({ success: false, message: "Project not found" });
  }
  return res.json({ success: true, data: project });
});

app.get("/api/projects/:id/snapshots", authMiddleware, async (req, res) => {
  const snapshots = await testDb.db.projectSnapshot.findMany({
    where: { projectId: req.params.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ success: true, data: snapshots });
});

app.get("/api/projects/:id/tree", authMiddleware, async (req, res) => {
  const { snapshot, rootDir } = await resolveProjectRoot(req.params.id);
  if (!snapshot || !rootDir) {
    return res.status(404).json({ success: false, message: "Workspace not found" });
  }
  const tree = buildDiskTree(rootDir);
  return res.json({
    success: true,
    data: tree,
    snapshotId: snapshot.id,
    workspaceRevision: 1,
  });
});

app.get("/api/projects/:id/file-content", authMiddleware, async (req, res) => {
  const { rootDir } = await resolveProjectRoot(req.params.id);
  if (!rootDir) {
    return res.status(404).json({ success: false, message: "Workspace not found" });
  }
  try {
    const { cleanRel, abs } = resolveContainedPath(rootDir, req.query.path);
    const content = await fsp.readFile(abs, "utf8");
    return res.json({
      success: true,
      data: { path: cleanRel, content, version: Date.now() },
    });
  } catch {
    return res.status(404).json({ success: false, message: "File not found" });
  }
});

app.put("/api/projects/:id/file-content", authMiddleware, async (req, res) => {
  const { rootDir } = await resolveProjectRoot(req.params.id);
  if (!rootDir) {
    return res.status(404).json({ success: false, message: "Workspace not found" });
  }
  try {
    const { cleanRel, abs } = resolveContainedPath(rootDir, req.body?.path);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, String(req.body?.content ?? ""), "utf8");

    await deliverScopedProjectTransport({
      projectId: req.params.id,
      event: "project:event",
      payload: {
        id: `evt-${Date.now()}`,
        projectId: req.params.id,
        type: "FILE_UPDATED",
        resourceId: cleanRel,
        createdAt: new Date().toISOString(),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      data: {
        path: cleanRel,
        content: String(req.body?.content ?? ""),
        version: Date.now(),
      },
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

app.get("/api/projects/:id/structure-analysis", authMiddleware, (_req, res) =>
  res.json({ success: true, data: null }),
);
app.get("/api/projects/:id/detect-frameworks", authMiddleware, (_req, res) =>
  res.json({ success: true, data: { frameworks: [] } }),
);
app.get("/api/projects/:id/missing-test-framework", authMiddleware, (_req, res) =>
  res.json({ success: true, data: { missing: false } }),
);
app.get(
  "/api/projects/:id/test-framework-recommendation",
  authMiddleware,
  (_req, res) => res.json({ success: true, data: null }),
);

// E2E Test Control Endpoints (disposable test harness only)
app.post("/api/__test/reset", async (_req, res) => {
  try {
    await cleanupWorkdirs();
    await resetAllTables();
    res.json({ ok: true });
  } catch (err) {
    console.error("[E2E-VCS] /__test/reset failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/__test/seed-vcs", async (_req, res) => {
  try {
    await cleanupWorkdirs();
    await resetAllTables();

    const ghUser = await testDb.db.user.create({
      data: {
        email: "gh-vcs@covai.test",
        name: "E2E GitHub Dev",
        githubUserId: String(MOCK_GH_USER.user.id),
        githubLogin: MOCK_GH_USER.user.login,
        githubAccessTokenEnc: encrypt(MOCK_GH_USER.token),
        githubOAuthScopes: MOCK_GH_USER.scope,
        lastAuthProvider: "github",
        passwordHash: null,
      },
      select: { id: true, email: true, name: true, githubLogin: true },
    });

    const emailPasswordHash = await bcrypt.hash("ValidPass123!", 4);
    const emailUser = await testDb.db.user.create({
      data: {
        email: "email-vcs@covai.test",
        name: "E2E Email Dev",
        passwordHash: emailPasswordHash,
        githubUserId: null,
        lastAuthProvider: "email",
      },
      select: { id: true, email: true, name: true },
    });

    // 1. Seed real Git repository on branch `develop` + local bare remote
    const gitBaseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-e2e-git-"));
    e2eState.tempDirs.add(gitBaseDir);
    const bareRemoteDir = path.join(gitBaseDir, "remote.git");
    const gitRepoDir = path.join(gitBaseDir, "repo");
    await fsp.mkdir(bareRemoteDir, { recursive: true });
    await fsp.mkdir(path.join(gitRepoDir, "src"), { recursive: true });

    await execFileAsync("git", ["init", "--bare", "--initial-branch=develop"], {
      cwd: bareRemoteDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["init", "--initial-branch=develop"], {
      cwd: gitRepoDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "E2E GitHub Dev"], {
      cwd: gitRepoDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "gh-vcs@covai.test"], {
      cwd: gitRepoDir,
      windowsHide: true,
    });

    await fsp.writeFile(
      path.join(gitRepoDir, "src", "app.js"),
      "export const version = 'v1';\nexport function greet() {\n  return 'hello';\n}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(gitRepoDir, "src", "utils.js"),
      "export const add = (a, b) => a + b;\n",
      "utf8",
    );

    await execFileAsync("git", ["add", "-A"], { cwd: gitRepoDir, windowsHide: true });
    await execFileAsync("git", ["commit", "-m", "chore: initial e2e commit"], {
      cwd: gitRepoDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["remote", "add", "origin", bareRemoteDir], {
      cwd: gitRepoDir,
      windowsHide: true,
    });
    await execFileAsync("git", ["push", "-u", "origin", "develop"], {
      cwd: gitRepoDir,
      windowsHide: true,
    });

    const gitProject = await testDb.db.project.create({
      data: {
        name: "e2e-git-workspace",
        description: "E2E Git Workbench Project",
        repoUrl: "https://github.com/e2e-vcs-octo/e2e-git-workspace",
        defaultBranch: "develop",
        storageBasePath: gitBaseDir,
        ownerId: ghUser.id,
      },
    });
    const gitSnapshot = await testDb.db.projectSnapshot.create({
      data: {
        projectId: gitProject.id,
        label: "Git Workspace Root",
        source: "GITHUB",
        storagePath: gitRepoDir,
        rootDir: gitRepoDir,
        versionNumber: 1,
      },
    });
    await testDb.db.project.update({
      where: { id: gitProject.id },
      data: { activeSnapshotId: gitSnapshot.id },
    });

    // 2. Seed real Snapshot VCS workspace with node_modules preservation fixture
    const snapBaseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-e2e-snap-"));
    e2eState.tempDirs.add(snapBaseDir);
    const snapshotWorkDir = path.join(snapBaseDir, "workspace");
    await fsp.mkdir(path.join(snapshotWorkDir, "src"), { recursive: true });
    await fsp.mkdir(path.join(snapshotWorkDir, "node_modules", "keep-pkg"), {
      recursive: true,
    });

    await fsp.writeFile(
      path.join(snapshotWorkDir, "src", "index.js"),
      "export const appName = 'CovAI-Snapshot-v1';\nexport const port = 3000;\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(snapshotWorkDir, "src", "math.js"),
      "export const multiply = (a, b) => a * b;\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(snapshotWorkDir, "node_modules", "keep-pkg", "index.js"),
      "module.exports = { intact: true };\n",
      "utf8",
    );

    const snapshotProject = await testDb.db.project.create({
      data: {
        name: "e2e-snapshot-workspace",
        description: "E2E Snapshot Mini-GitHub Project",
        defaultBranch: "main",
        storageBasePath: snapBaseDir,
        ownerId: emailUser.id,
      },
    });
    const initialSnap = await testDb.db.projectSnapshot.create({
      data: {
        projectId: snapshotProject.id,
        label: "Initial Ingest",
        commitMessage: "Uploaded initial ZIP archive",
        source: "ZIP",
        storagePath: snapshotWorkDir,
        rootDir: snapshotWorkDir,
        versionNumber: 1,
      },
    });
    await testDb.db.project.update({
      where: { id: snapshotProject.id },
      data: { activeSnapshotId: initialSnap.id },
    });

    // Trigger lazy CAS materialization + default `main` branch creation
    await SnapshotVcsService.getStatus(snapshotProject.id, emailUser.id);

    e2eState.gitRepoDir = gitRepoDir;
    e2eState.bareRemoteDir = bareRemoteDir;
    e2eState.snapshotWorkDir = snapshotWorkDir;
    e2eState.gitProjectId = gitProject.id;
    e2eState.snapshotProjectId = snapshotProject.id;
    e2eState.seededProjectIds.add(gitProject.id);
    e2eState.seededProjectIds.add(snapshotProject.id);

    res.json({
      ok: true,
      githubUser: ghUser,
      emailUser,
      gitProject: { id: gitProject.id, snapshotId: gitSnapshot.id },
      snapshotProject: { id: snapshotProject.id, snapshotId: initialSnap.id },
    });
  } catch (err) {
    console.error("[E2E-VCS] /__test/seed-vcs failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/__test/inspect-git", async (_req, res) => {
  if (!e2eState.gitRepoDir || !e2eState.bareRemoteDir) {
    return res.status(404).json({ ok: false });
  }
  const gitConfig = await fsp.readFile(
    path.join(e2eState.gitRepoDir, ".git", "config"),
    "utf8",
  );
  const { stdout: remoteLog } = await execFileAsync(
    "git",
    ["log", "--all", "--oneline", "-n", "10"],
    { cwd: e2eState.bareRemoteDir, windowsHide: true },
  );
  const { stdout: currentBranch } = await execFileAsync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: e2eState.gitRepoDir, windowsHide: true },
  );
  return res.json({
    ok: true,
    gitConfig,
    remoteLog,
    currentBranch: currentBranch.trim(),
  });
});

app.post("/api/__test/push-peer-commit", async (req, res) => {
  if (!e2eState.bareRemoteDir) {
    return res.status(404).json({ ok: false, error: "Bare remote not seeded" });
  }
  const branch = String(req.body?.branch || "develop").trim() || "develop";
  const tmpClone = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-e2e-peer-"));
  try {
    await execFileAsync(
      "git",
      ["clone", "-b", branch, e2eState.bareRemoteDir, tmpClone],
      { windowsHide: true },
    );
    await execFileAsync("git", ["config", "user.name", "Peer Collaborator"], {
      cwd: tmpClone,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "peer@covai.test"], {
      cwd: tmpClone,
      windowsHide: true,
    });

    await fsp.mkdir(path.join(tmpClone, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(tmpClone, "src", "app.js"),
      "export const version = 'v99-remote-pulled';\nexport function greet() {\n  return 'hello from remote peer';\n}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmpClone, "src", "utils.js"),
      "export const add = (a, b) => Number(a) + Number(b) + 10;\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmpClone, "src", "remote-pulled.js"),
      "export const pulledBanner = 'fresh from origin';\n",
      "utf8",
    );

    await execFileAsync("git", ["add", "-A"], { cwd: tmpClone, windowsHide: true });
    await execFileAsync(
      "git",
      ["commit", "-m", "feat: peer pushed remote update"],
      { cwd: tmpClone, windowsHide: true },
    );
    await execFileAsync("git", ["push", "origin", branch], {
      cwd: tmpClone,
      windowsHide: true,
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  } finally {
    await fsp.rm(tmpClone, { recursive: true, force: true }).catch(() => {});
  }
});

app.get("/api/__test/inspect-snapshot", async (_req, res) => {
  if (!e2eState.snapshotProjectId || !e2eState.snapshotWorkDir) {
    return res.status(404).json({ ok: false });
  }
  const project = await testDb.db.project.findUnique({
    where: { id: e2eState.snapshotProjectId },
    select: { activeSnapshotId: true },
  });
  const indexContent = await fsp.readFile(
    path.join(e2eState.snapshotWorkDir, "src", "index.js"),
    "utf8",
  );
  const nodeModulesPath = path.join(
    e2eState.snapshotWorkDir,
    "node_modules",
    "keep-pkg",
    "index.js",
  );
  const nodeModulesExists = fs.existsSync(nodeModulesPath);
  const nodeModulesContent = nodeModulesExists
    ? await fsp.readFile(nodeModulesPath, "utf8")
    : "";

  return res.json({
    ok: true,
    activeSnapshotId: project?.activeSnapshotId || null,
    indexContent,
    nodeModulesExists,
    nodeModulesContent,
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[E2E-VCS] Ready on http://127.0.0.1:${PORT}`);
});

async function shutdown() {
  httpServer.close();
  await cleanupWorkdirs();
  await testDb.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
