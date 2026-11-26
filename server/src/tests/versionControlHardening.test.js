import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockCloneRepository = jest.fn();
const mockDeliverTransport = jest.fn(async () => {});
const mockCreateAnalysisJob = jest.fn(async () => ({ id: "job-analysis-1" }));
const mockCreateNotification = jest.fn(async () => ({ id: "notif-1" }));

const mockPrisma = {
  project: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  projectSnapshot: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  snapshotVcsEntry: {
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

await jest.unstable_mockModule("../config/prisma.js", () => ({ default: mockPrisma }));
await jest.unstable_mockModule("../services/githubClone.service.js", () => ({
  GitHubCloneService: { cloneRepository: mockCloneRepository },
}));
await jest.unstable_mockModule("../services/projectSubscription.service.js", () => ({
  deliverScopedProjectTransport: mockDeliverTransport,
}));
await jest.unstable_mockModule("../services/job.service.js", () => ({
  STALE_JOB_TIMEOUT_MS: 25 * 60 * 1000,
  addJobLog: jest.fn(async () => ({})),
  cleanupStaleJobsForProject: jest.fn(async () => {}),
  cleanupAllStaleJobs: jest.fn(async () => {}),
  createInstallDepsJob: jest.fn(async () => ({ id: "job-inst" })),
  createRunTestsJob: jest.fn(async () => ({ id: "job-tests-1" })),
  createVitestJob: jest.fn(async () => ({ id: "job-vit" })),
  createSystemTestAnalysisJob: jest.fn(async () => ({ id: "job-sys" })),
  createVitestCoverageJob: jest.fn(async () => ({ id: "job-vcov" })),
  createSupertestCoverageJob: jest.fn(async () => ({ id: "job-st" })),
  createCypressSystemCoverageJob: jest.fn(async () => ({ id: "job-cycov" })),
  createCypressSystemTestJob: jest.fn(async () => ({ id: "job-cy" })),
  createBuildCfgJob: jest.fn(async () => ({ id: "job-cfg" })),
  createPerformanceAnalysisJob: jest.fn(async () => ({ id: "job-perf" })),
  createAiSuggestJob: jest.fn(async () => ({ id: "job-ais" })),
  createCodeHygieneJob: jest.fn(async () => ({ id: "job-hyg" })),
  createAiTestsJob: jest.fn(async () => ({ id: "job-ait" })),
  createAnalysisJob: mockCreateAnalysisJob,
  createSnapshotIngestJob: jest.fn(async () => ({ id: "job-ing" })),
  createIngestJobForSnapshot: jest.fn(async () => ({ id: "job-ing2" })),
  autoTransitionProjectToDoingIfNeeded: jest.fn(async () => {}),
  createSnapshotJob: jest.fn(async () => ({ id: "job-snap" })),
  updateJobProgress: jest.fn(async () => ({})),
  invalidateAllDashboardCaches: jest.fn(async () => {}),
  markJobRunning: jest.fn(async () => ({})),
  markJobSuccess: jest.fn(async () => ({})),
  markJobFailed: jest.fn(async () => ({})),
  markQueuedJobFailed: jest.fn(async () => ({})),
  cancelJob: jest.fn(async () => ({})),
  retryJob: jest.fn(async () => ({})),
  getJobById: jest.fn(async () => null),
  getProjectJobs: jest.fn(async () => []),
  getRunningJobs: jest.fn(async () => []),
  getJobStats: jest.fn(async () => ({})),
  createPlaywrightJob: jest.fn(async () => ({ id: "job-pw" })),
  createPlaywrightSystemCoverageJob: jest.fn(async () => ({ id: "job-pwcov" })),
}));
await jest.unstable_mockModule("../services/notification.service.js", () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

const {
  findLowestCommonAncestor,
  resolveConflictMarkersKeepBoth,
} = await import("../services/snapshotDiff3.service.js");
const {
  clearWorkingTreeStatCache,
  scanWorkingTree,
} = await import("../services/snapshotCas.service.js");
const { withProjectVcsLock } = await import("../services/vcsLock.service.js");
const { cleanupStaleOperationWorkspaces } = await import(
  "../services/projectOperationWorkspace.service.js"
);
const {
  normalizeWebhookRepoUrl,
  verifyGithubWebhookSignature,
  webhookService,
} = await import("../services/webhook.service.js");
const { SnapshotVcsService } = await import("../services/snapshotVcs.service.js");

const ORIG_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

describe("Version Control Deep Audit Hardening", () => {
  let tempDir;

  beforeEach(async () => {
    jest.clearAllMocks();
    clearWorkingTreeStatCache();
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-vcs-hardening-"));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    clearWorkingTreeStatCache();
    if (ORIG_ENCRYPTION_KEY === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = ORIG_ENCRYPTION_KEY;
    if (tempDir && fs.existsSync(tempDir)) {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("P0-4: resolveConflictMarkersKeepBoth combines only conflicted blocks without duplicating the whole file", () => {
    const conflicted = [
      "import a from './a';",
      "import b from './b';",
      "",
      "<<<<<<< main",
      "const rate = 0.1;",
      "=======",
      "const rate = 0.25;",
      ">>>>>>> feat",
      "",
      "export function calc(x) {",
      "<<<<<<< main",
      "  return x * 1;",
      "||||||| base",
      "  return x;",
      "=======",
      "  return x * 2;",
      ">>>>>>> feat",
      "}",
      "",
    ].join("\n");

    const resolved = resolveConflictMarkersKeepBoth(conflicted);
    expect(resolved).toBe(
      [
        "import a from './a';",
        "import b from './b';",
        "",
        "const rate = 0.1;",
        "const rate = 0.25;",
        "",
        "export function calc(x) {",
        "  return x * 1;",
        "  return x * 2;",
        "}",
        "",
      ].join("\n"),
    );
    expect(resolved.match(/import a from/g)).toHaveLength(1);
  });

  it("P1-3: scanWorkingTree hits stat-cache for aged unchanged files and bypasses racy-stat recent writes", async () => {
    const stableFile = path.join(tempDir, "stable.js");
    const freshFile = path.join(tempDir, "fresh.js");
    await fsp.writeFile(stableFile, "export const stable = 1;\n", "utf8");
    await fsp.writeFile(freshFile, "export const fresh = 1;\n", "utf8");

    const oldSec = (Date.now() - 10_000) / 1000;
    await fsp.utimes(stableFile, oldSec, oldSec);

    const firstScan = scanWorkingTree(tempDir);
    expect(firstScan.get("stable.js")?.sha256).toBeTruthy();
    expect(firstScan.get("fresh.js")?.sha256).toBeTruthy();

    const readSpy = jest.spyOn(fs, "readFileSync");
    const secondScan = scanWorkingTree(tempDir);

    // stable.js (mtime > 1s old) is served from stat-cache; fresh.js (< 1s old) is re-read defensively
    expect(secondScan.get("stable.js")?.sha256).toBe(firstScan.get("stable.js")?.sha256);
    const readPaths = readSpy.mock.calls.map((c) => path.resolve(String(c[0])));
    expect(readPaths).not.toContain(path.resolve(stableFile));
    expect(readPaths).toContain(path.resolve(freshFile));
  });

  it("P1-6: withProjectVcsLock fails cleanly with 409 VCS_LOCK_TIMEOUT without deadlocking later waiters", async () => {
    let releaseBlocker;
    const blockerDone = new Promise((resolve) => {
      releaseBlocker = resolve;
    });

    const p1 = withProjectVcsLock("proj-lock-test", () => blockerDone);
    await expect(
      withProjectVcsLock("proj-lock-test", async () => "never", { timeoutMs: 30 }),
    ).rejects.toMatchObject({ statusCode: 409, code: "VCS_LOCK_TIMEOUT" });

    releaseBlocker();
    await p1;

    const afterResult = await withProjectVcsLock(
      "proj-lock-test",
      async () => "recovered",
      { timeoutMs: 200 },
    );
    expect(afterResult).toBe("recovered");
  });

  it("P0-1: cleanupStaleOperationWorkspaces removes expired temp directories while keeping fresh ones", async () => {
    const staleDir = path.join(tempDir, "op-stale-1");
    const freshDir = path.join(tempDir, "op-fresh-2");
    await fsp.mkdir(staleDir, { recursive: true });
    await fsp.mkdir(freshDir, { recursive: true });
    await fsp.writeFile(path.join(staleDir, "junk.txt"), "old");

    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    await fsp.utimes(staleDir, twoHoursAgo, twoHoursAgo);

    const removed = await cleanupStaleOperationWorkspaces(tempDir, 60 * 60 * 1000);
    expect(removed).toBe(1);
    expect(fs.existsSync(staleDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });

  it("P0-6: webhook.service verifies signatures safely, uses utils/crypto, and handles push events post-Phase-0", async () => {
    const payloadStr = JSON.stringify({ ok: true });
    const secret = "super-webhook-secret";
    const expectedSig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(payloadStr, "utf8").digest("hex");

    expect(verifyGithubWebhookSignature(payloadStr, expectedSig, secret)).toBe(true);
    expect(verifyGithubWebhookSignature(payloadStr, "sha256=short", secret)).toBe(false);
    expect(normalizeWebhookRepoUrl("HTTPS://GitHub.com/Org/Repo.git/")).toBe(
      "https://github.com/org/repo",
    );

    mockPrisma.project.findFirst.mockResolvedValue({
      id: "proj-wh",
      webhookEnabled: false,
    });
    mockPrisma.project.update.mockResolvedValue({
      id: "proj-wh",
      name: "Webhook Repo",
      webhookEnabled: true,
      webhookBranch: "main",
    });

    const enabled = await webhookService.enableWebhook("proj-wh", "user-1", "main");
    const updateArg = mockPrisma.project.update.mock.calls[0][0];
    expect(webhookService.decryptWebhookSecret(updateArg.data.webhookSecretEnc)).toBe(
      enabled.secret,
    );

    const cloneDir = path.join(tempDir, "cloned");
    await fsp.mkdir(cloneDir, { recursive: true });
    await fsp.writeFile(
      path.join(cloneDir, "package.json"),
      JSON.stringify({ name: "demo", devDependencies: { jest: "^29.0.0" } }),
      "utf8",
    );
    mockPrisma.project.findMany.mockResolvedValue([
      {
        id: "proj-wh",
        repoUrl: "https://github.com/acme/covai-demo",
        defaultBranch: "main",
      },
    ]);
    mockPrisma.projectSnapshot.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      githubAccessTokenEnc: "enc-tok",
      email: "dev@acme.test",
    });
    mockCloneRepository.mockResolvedValue({
      localPath: cloneDir,
      commitSha: "abcdef1234567890",
    });
    mockPrisma.projectSnapshot.create.mockResolvedValue({
      id: "snap-wh-1",
      commitSha: "abcdef1234567890",
      rootDir: cloneDir,
      storagePath: cloneDir,
    });
    mockPrisma.project.update.mockResolvedValue({ id: "proj-wh" });

    const pushRes = await webhookService.handleGithubPushEvent(
      {
        ref: "refs/heads/main",
        repository: {
          name: "covai-demo",
          html_url: "https://github.com/acme/covai-demo",
          clone_url: "https://github.com/acme/covai-demo.git",
          owner: { login: "acme" },
        },
        head_commit: { id: "abcdef1234567890", message: "feat: webhook push" },
      },
      "user-1",
    );

    expect(pushRes.snapshot.id).toBe("snap-wh-1");
    expect(mockCloneRepository).toHaveBeenCalledWith(
      "user-1",
      "proj-wh",
      "acme",
      "covai-demo",
      true,
    );
    expect(mockPrisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proj-wh" },
        data: expect.objectContaining({
          activeSnapshotId: "snap-wh-1",
          lastAnalyzedCommit: "abcdef1234567890",
        }),
      }),
    );
    expect(mockDeliverTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-wh",
        payload: expect.objectContaining({ reason: "github_webhook_push" }),
      }),
    );
  });

  it("P1-7: exportCheckpointZip rejects archives exceeding the 200 MiB uncompressed budget", async () => {
    jest.spyOn(SnapshotVcsService, "_ensureProjectContext").mockResolvedValue({
      project: { id: "proj-big", name: "BigRepo" },
    });
    mockPrisma.projectSnapshot.findFirst.mockResolvedValue({
      id: "snap-big",
      label: "Huge",
      versionNumber: 2,
      casMaterialized: true,
    });
    mockPrisma.snapshotVcsEntry.findMany.mockResolvedValue([
      { relativePath: "bundle.bin", blobSha256: "a".repeat(64), byteSize: 210 * 1024 * 1024 },
    ]);

    await expect(
      SnapshotVcsService.exportCheckpointZip("proj-big", "user-1", "snap-big"),
    ).rejects.toMatchObject({
      statusCode: 413,
      code: "EXPORT_SIZE_LIMIT_EXCEEDED",
    });
  });

  it("P1-9: findLowestCommonAncestor traverses multi-parent merge DAG metadata", () => {
    const dag = new Map([
      ["v1", { id: "v1", parentSnapshotId: null, statsJson: null }],
      ["f1", { id: "f1", parentSnapshotId: "v1", statsJson: null }],
      ["m1", { id: "m1", parentSnapshotId: "v1", statsJson: null }],
      ["merge", { id: "merge", parentSnapshotId: "m1", statsJson: { secondParentSnapshotId: "f1" } }],
      ["f2", { id: "f2", parentSnapshotId: "f1", statsJson: null }],
    ]);
    expect(findLowestCommonAncestor(dag, "merge", "f2")).toBe("f1");
  });
});
