import fs from "node:fs";
import fsp from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { createAuthTestDatabase } from "../src/tests/helpers/authTestDatabase.js";

process.env.NODE_ENV = "test";
process.env.COVAI_WORKER_ENABLED = "false";
process.env.DISABLE_DOCKER_RUNNER = "true";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "e2e-portfolio-jwt-secret-2026-32ch";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "e2e-portfolio-refresh-secret-2026";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "c".repeat(64);
process.env.GITHUB_CLIENT_ID =
  process.env.GITHUB_CLIENT_ID || "e2e-github-client-id";
process.env.GITHUB_CLIENT_SECRET =
  process.env.GITHUB_CLIENT_SECRET || "e2e-github-client-secret";
const PORT = Number(process.env.E2E_API_PORT || 55120);
const CLIENT_URL = process.env.CLIENT_URL || "http://127.0.0.1:55293";
process.env.CLIENT_URL = CLIENT_URL;
process.env.LOGIN_IP_RATE_LIMIT_MAX = "1000";

const testDb = await createAuthTestDatabase();

const { default: authRoute } = await import("../src/routes/auth.route.js");
const { default: refreshRoute } = await import("../src/routes/refresh.route.js");
const { default: userRoute } = await import("../src/routes/user.route.js");
const { default: portfolioRoute } = await import("../src/routes/portfolio.route.js");
const { default: projectRoute } = await import("../src/routes/project.route.js");
const { default: projectMemberRoutes } = await import(
  "../src/routes/projectMember.route.js"
);
const { default: projectEventRoutes } = await import(
  "../src/routes/projectEvent.route.js"
);
const { default: snapshotVcsRoute } = await import(
  "../src/routes/snapshotVcs.route.js"
);
const { authMiddleware } = await import("../src/middlewares/auth.middleware.js");
const { attachProjectSubscriptions } = await import(
  "../src/services/projectSubscription.service.js"
);
const { subscribeToUserRoom } = await import(
  "../src/utils/socketSubscription.js"
);
const { invalidatePortfolioCache } = await import(
  "../src/services/portfolioDashboard.service.js"
);

const e2eState = {
  tempDirs: new Set(),
  seededProjectIds: new Set(),
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
}

async function resetAllTables() {
  invalidatePortfolioCache();
  await testDb.db.project.updateMany({
    data: { activeSnapshotId: null, activeVcsBranchId: null },
  });
  await testDb.db.testScenario.deleteMany({});
  await testDb.db.aiTestResult.deleteMany({});
  await testDb.db.aiTest.deleteMany({});
  await testDb.db.testRun.deleteMany({});
  await testDb.db.coverageFile.deleteMany({});
  await testDb.db.coverageSummary.deleteMany({});
  await testDb.db.projectStructureAnalysis.deleteMany({});
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
  invalidatePortfolioCache();
}

async function createSampleWorkspaceDir(fileName, content) {
  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-e2e-port-"));
  e2eState.tempDirs.add(baseDir);
  const workDir = path.join(baseDir, "workspace");
  await fsp.mkdir(path.join(workDir, "src"), { recursive: true });
  await fsp.writeFile(path.join(workDir, "src", fileName), content, "utf8");
  return { baseDir, workDir };
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
app.use("/api/portfolio", portfolioRoute);

// Secondary lightweight stubs so Portfolio & Workspace Settings load with 0 404 console errors
app.get("/api/github/capabilities", authMiddleware, (_req, res) =>
  res.json({ success: true, data: { connected: false, githubLogin: null, scopes: [], hasRepoScope: false } }),
);
app.get("/api/github/repos", authMiddleware, (_req, res) =>
  res.json({ success: true, data: [] }),
);
app.get("/api/notifications", authMiddleware, (_req, res) =>
  res.json({ success: true, notifications: [] }),
);
app.get("/api/notifications/unread-count", authMiddleware, (_req, res) =>
  res.json({ success: true, unreadCount: 0, count: 0 }),
);
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
app.get("/api/ai-agents/profiles", authMiddleware, (_req, res) =>
  res.json({ success: true, data: [] }),
);
app.get("/api/settings/ai-quotas", authMiddleware, (_req, res) =>
  res.json({ success: true, data: { remaining: 50, limit: 50 } }),
);
app.get("/api/git/status", authMiddleware, (_req, res) =>
  res.json({ success: true, data: { hasGit: false, branch: null } }),
);

// Real Project, Member & Snapshot VCS routes bound to PGlite testDb
app.use("/api/projects", projectMemberRoutes);
app.use("/api/projects", projectEventRoutes);
app.use("/api/projects/:projectId/snapshot-vcs", snapshotVcsRoute);
app.use("/api/projects/:projectId/vcs/snapshots", snapshotVcsRoute);
app.use("/api/projects", projectRoute);

// Test Control Endpoints
app.post("/api/__test/reset", async (_req, res) => {
  try {
    await cleanupWorkdirs();
    await resetAllTables();
    res.json({ ok: true });
  } catch (err) {
    console.error("[E2E-PORTFOLIO] /__test/reset failed:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/__test/seed-portfolio", async (_req, res) => {
  try {
    await cleanupWorkdirs();
    await resetAllTables();

    const passwordHash = await bcrypt.hash("ValidPass123!", 4);
    const ownerUser = await testDb.db.user.create({
      data: {
        email: "owner@covai.test",
        name: "Trần Hữu Thuận",
        passwordHash,
        lastAuthProvider: "email",
      },
      select: { id: true, email: true, name: true },
    });
    const editorUser = await testDb.db.user.create({
      data: {
        email: "editor@covai.test",
        name: "Portfolio Editor",
        passwordHash,
        lastAuthProvider: "email",
      },
      select: { id: true, email: true, name: true },
    });
    const viewerUser = await testDb.db.user.create({
      data: {
        email: "viewer@covai.test",
        name: "Portfolio Viewer",
        passwordHash,
        lastAuthProvider: "email",
      },
      select: { id: true, email: true, name: true },
    });
    const outsiderUser = await testDb.db.user.create({
      data: {
        email: "outsider@covai.test",
        name: "Outsider User",
        passwordHash,
        lastAuthProvider: "email",
      },
      select: { id: true, email: true, name: true },
    });

    const now = new Date();
    const runStart = new Date(now.getTime() - 5000);
    const runEnd = new Date(now.getTime() - 2000);

    // 1. Active DOING VCS Project (Vietnamese name, custom Snapshot VCS branch feat/vn-checkout, Unit + API tests)
    const dir1 = await createSampleWorkspaceDir(
      "payment.js",
      "export function pay(amount) { return amount > 0; }\n",
    );
    const pActiveVcs = await testDb.db.project.create({
      data: {
        name: "Hệ thống Thanh toán VNPay",
        description: "Vietnamese payment gateway with real Snapshot VCS branch",
        defaultBranch: "main",
        storageBasePath: dir1.baseDir,
        ownerId: ownerUser.id,
        lifecycleStatus: "DOING",
        lifecycleUpdatedAt: now,
        hasJest: true,
      },
    });
    const snap1 = await testDb.db.projectSnapshot.create({
      data: {
        projectId: pActiveVcs.id,
        label: "v1.4 Checkout Flow",
        commitMessage: "feat: checkout coverage",
        source: "ZIP",
        storagePath: dir1.workDir,
        rootDir: dir1.workDir,
        versionNumber: 1,
      },
    });
    const branch1 = await testDb.db.snapshotVcsBranch.create({
      data: {
        projectId: pActiveVcs.id,
        name: "feat/vn-checkout",
        description: "Checkout feature branch",
        headSnapshotId: snap1.id,
        baseSnapshotId: snap1.id,
        isDefault: false,
        createdById: ownerUser.id,
      },
    });
    await testDb.db.projectSnapshot.update({
      where: { id: snap1.id },
      data: { vcsBranchId: branch1.id },
    });
    await testDb.db.project.update({
      where: { id: pActiveVcs.id },
      data: { activeSnapshotId: snap1.id, activeVcsBranchId: branch1.id },
    });

    await testDb.db.coverageSummary.create({
      data: {
        snapshotId: snap1.id,
        linesPct: 86,
        branchesPct: 82,
        funcsPct: 85,
        stmtsPct: 86,
      },
    });
    await testDb.db.testRun.create({
      data: {
        snapshotId: snap1.id,
        type: "JEST",
        totalTests: 20,
        passedTests: 20,
        failedTests: 0,
        skippedTests: 0,
        durationMs: 1800,
        status: "PASSED",
        startedAt: runStart,
        finishedAt: runEnd,
        coverageLinesPct: 86,
        coverageBranchesPct: 82,
      },
    });
    const apiRun = await testDb.db.testRun.create({
      data: {
        snapshotId: snap1.id,
        type: "SUPERTEST",
        totalTests: 6,
        passedTests: 6,
        failedTests: 0,
        skippedTests: 0,
        durationMs: 2400,
        status: "PASSED",
        startedAt: runStart,
        finishedAt: runEnd,
      },
    });
    await testDb.db.testScenario.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        testRunId: apiRun.id,
        title: `GET /api/pay/${i + 1}`,
        status: "PASSED",
        targetEndpoint: `GET /api/pay/${i + 1}`,
      })),
    });
    await testDb.db.projectStructureAnalysis.create({
      data: {
        snapshotId: snap1.id,
        schemaVersion: 1,
        resultJson: JSON.stringify({
          integrationScan: {
            discoveredEndpoints: Array.from({ length: 8 }, (_, i) => ({
              method: "GET",
              path: `/api/pay/${i + 1}`,
            })),
          },
        }),
      },
    });
    await testDb.db.aiTest.create({
      data: {
        projectId: pActiveVcs.id,
        snapshotId: snap1.id,
        mode: "FULL",
        status: "VERIFIED",
        content: "// generated + repaired specs",
        metaJson: JSON.stringify({
          requests: [
            { origin: "AI_GENERATED" },
            { origin: "AI_GENERATED" },
            { origin: "AI_GENERATED" },
            { origin: "AI_GENERATED", repaired: true },
          ],
        }),
      },
    });

    // 2. Active DOING Untested Project (tests Risk Quadrant isolation & 1/2 measured counts)
    const dir2 = await createSampleWorkspaceDir("worker.js", "export const ok = true;\n");
    const pUntestedDoing = await testDb.db.project.create({
      data: {
        name: "Worker Notification Service",
        description: "Background queue notifier awaiting initial tests",
        repoUrl: "https://github.com/covai-e2e/worker-notify",
        defaultBranch: "release/v1.2",
        storageBasePath: dir2.baseDir,
        ownerId: ownerUser.id,
        lifecycleStatus: "DOING",
        lifecycleUpdatedAt: now,
      },
    });
    const snap2 = await testDb.db.projectSnapshot.create({
      data: {
        projectId: pUntestedDoing.id,
        label: "v1.0",
        source: "GITHUB",
        storagePath: dir2.workDir,
        rootDir: dir2.workDir,
        versionNumber: 1,
      },
    });
    await testDb.db.project.update({
      where: { id: pUntestedDoing.id },
      data: { activeSnapshotId: snap2.id },
    });

    // 3. NOT_STARTED Backlog Project (0 activity -> allowed to stay/transition freely)
    const dir3 = await createSampleWorkspaceDir("backlog.js", "export const todo = 1;\n");
    const pBacklog = await testDb.db.project.create({
      data: {
        name: "Fresh Onboarding Backlog",
        description: "Newly imported backlog repository",
        defaultBranch: "develop",
        storageBasePath: dir3.baseDir,
        ownerId: ownerUser.id,
        lifecycleStatus: "NOT_STARTED",
        lifecycleUpdatedAt: now,
      },
    });
    const snap3 = await testDb.db.projectSnapshot.create({
      data: {
        projectId: pBacklog.id,
        label: "v0.1",
        source: "ZIP",
        storagePath: dir3.workDir,
        rootDir: dir3.workDir,
        versionNumber: 1,
      },
    });
    await testDb.db.project.update({
      where: { id: pBacklog.id },
      data: { activeSnapshotId: snap3.id },
    });

    // 4. Isolated COMPLETED Project with formula-like name/branch (tests KPI isolation & CSV formula defense)
    const dir4 = await createSampleWorkspaceDir("legacy.js", "export const legacy = 1;\n");
    const pIsolatedCompleted = await testDb.db.project.create({
      data: {
        name: '=CMD("calc") Legacy Archive',
        description: "Completed repository isolated from Portfolio KPIs",
        repoUrl: "https://github.com/covai-e2e/legacy-archive",
        defaultBranch: "+malicious-branch",
        storageBasePath: dir4.baseDir,
        ownerId: ownerUser.id,
        lifecycleStatus: "COMPLETED",
        lifecycleUpdatedAt: now,
        hasJest: true,
      },
    });
    const snap4 = await testDb.db.projectSnapshot.create({
      data: {
        projectId: pIsolatedCompleted.id,
        label: "v2.0 Final",
        source: "ZIP",
        storagePath: dir4.workDir,
        rootDir: dir4.workDir,
        versionNumber: 1,
      },
    });
    await testDb.db.project.update({
      where: { id: pIsolatedCompleted.id },
      data: { activeSnapshotId: snap4.id },
    });
    await testDb.db.coverageSummary.create({
      data: {
        snapshotId: snap4.id,
        linesPct: 99,
        branchesPct: 95,
        funcsPct: 98,
        stmtsPct: 99,
      },
    });
    await testDb.db.testRun.create({
      data: {
        snapshotId: snap4.id,
        type: "JEST",
        totalTests: 50,
        passedTests: 50,
        failedTests: 0,
        skippedTests: 0,
        durationMs: 1200,
        status: "PASSED",
        startedAt: runStart,
        finishedAt: runEnd,
        coverageLinesPct: 99,
      },
    });

    // 5. Foreign Project owned by outsider (tests strict IDOR guard)
    const dir5 = await createSampleWorkspaceDir("secret.js", "export const secret = true;\n");
    const pForeignSecret = await testDb.db.project.create({
      data: {
        name: "Outsider Secret Project",
        description: "Should never appear in owner exports",
        defaultBranch: "main",
        storageBasePath: dir5.baseDir,
        ownerId: outsiderUser.id,
        lifecycleStatus: "DOING",
        lifecycleUpdatedAt: now,
      },
    });
    const snap5 = await testDb.db.projectSnapshot.create({
      data: {
        projectId: pForeignSecret.id,
        label: "v1",
        source: "ZIP",
        storagePath: dir5.workDir,
        rootDir: dir5.workDir,
        versionNumber: 1,
      },
    });
    await testDb.db.project.update({
      where: { id: pForeignSecret.id },
      data: { activeSnapshotId: snap5.id },
    });

    // RBAC Memberships
    await testDb.db.projectMember.createMany({
      data: [
        { projectId: pActiveVcs.id, userId: editorUser.id, role: "EDITOR" },
        { projectId: pBacklog.id, userId: editorUser.id, role: "EDITOR" },
        { projectId: pActiveVcs.id, userId: viewerUser.id, role: "VIEWER" },
      ],
    });

    for (const pid of [
      pActiveVcs.id,
      pUntestedDoing.id,
      pBacklog.id,
      pIsolatedCompleted.id,
      pForeignSecret.id,
    ]) {
      e2eState.seededProjectIds.add(pid);
    }

    invalidatePortfolioCache();

    return res.json({
      ok: true,
      users: {
        owner: ownerUser,
        editor: editorUser,
        viewer: viewerUser,
        outsider: outsiderUser,
      },
      projects: {
        activeVcs: { id: pActiveVcs.id, name: pActiveVcs.name, branch: "feat/vn-checkout", snapshotId: snap1.id },
        untestedDoing: { id: pUntestedDoing.id, name: pUntestedDoing.name, branch: "release/v1.2", snapshotId: snap2.id },
        backlog: { id: pBacklog.id, name: pBacklog.name, branch: "develop", snapshotId: snap3.id },
        isolatedCompleted: { id: pIsolatedCompleted.id, name: pIsolatedCompleted.name, snapshotId: snap4.id },
        foreignSecret: { id: pForeignSecret.id, name: pForeignSecret.name, snapshotId: snap5.id },
      },
    });
  } catch (err) {
    console.error("[E2E-PORTFOLIO] /__test/seed-portfolio failed:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Centralized Error Handler
app.use((err, _req, res, _next) => {
  const status = err?.statusCode || err?.status || 500;
  res.status(status).json({
    success: false,
    code: err?.code,
    message: err?.message || "Internal server error",
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[E2E-PORTFOLIO] Ready on http://127.0.0.1:${PORT}`);
});

async function shutdown() {
  httpServer.close();
  await cleanupWorkdirs();
  await testDb.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
