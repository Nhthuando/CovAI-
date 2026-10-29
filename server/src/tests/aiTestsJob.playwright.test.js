import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

const lifecycle = {
  getJobById: jest.fn(),
  addJobLog: jest.fn(),
};

const jobUpdate = {
  updateJobStatus: jest.fn(),
};

const aiContextBuilder = {
  buildAiPayload: jest.fn(),
  loadSourceCode:jest.fn(async()=>[]),
};

const geminiService = {
  generateText: jest.fn(),
};

const dockerRunnerMock = {
  run: jest.fn(),
};

const notificationMock = {
  createJobFinishedNotification: jest.fn(),
};

const prismaMock = {
  project: { findUnique: jest.fn(), findFirst: jest.fn(async () => ({ id: "proj-1", ownerId: "owner", workspaceRevision: 0 })) },
  projectOperation: { findUnique: jest.fn(async () => null) },
  job: { updateMany: jest.fn(async () => ({ count: 1 })) },
  projectSnapshot: { findUnique: jest.fn() },
  aiTest: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
};
let activeWorkspace = null;
let rejectPublication = false;
const preparedRoots = [];
const assertActive = async () => {
  if (activeWorkspace?.revoked) throw Object.assign(new Error("Access revoked"), { statusCode: 403 });
};
const stage = async action => {
  if (activeWorkspace) { activeWorkspace.preparedPublications.push(action); return null; }
  return action(prismaMock);
};
await jest.unstable_mockModule("../services/projectOperationWorkspace.service.js", () => ({
  deferPreparedCommit: jest.fn(),
    currentProjectOperation: () => activeWorkspace,
  operationSnapshot: snapshot => activeWorkspace && snapshot?.id === activeWorkspace.snapshotId ? { ...snapshot, rootDir: activeWorkspace.rootDir } : snapshot,
  stagePreparedValue: async (action,placeholder) => { if(activeWorkspace){await stage(action);return placeholder;}return action(prismaMock); },
  stagePreparedPublication: stage, assertProjectOperationActive: assertActive,
  withOperationPublishGuard: action => action(prismaMock),
  beginPreparedPublications: () => {}, flushPreparedPublications: async () => {},
  withOperationWorkspace: async (_id, action) => action(activeWorkspace), runJobInOperationWorkspace: async (_id, action) => action(),
}));
await jest.unstable_mockModule("../services/projectWorkspacePreparation.service.js", () => ({
  withPreparedProjectWorkspace: async (options, action) => {
    const storedJob = await lifecycle.getJobById(options.primaryJobId);
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-ai-prepared-"));
    preparedRoots.push(rootDir);
    fs.cpSync(storedJob.snapshot.rootDir, rootDir, { recursive: true });
    activeWorkspace = { rootDir, snapshotId: options.snapshotId, analysisRelative: "", workspaceRevision: 0, preparedPublications: [] };
    try {
      const result = await action(activeWorkspace);
      await assertActive();
      if (rejectPublication) throw Object.assign(new Error("Publication blocked"), { statusCode: 409 });
      const publish = typeof options.publish === "function" ? options.publish(result) : options.publish !== false;
      if (publish) fs.cpSync(rootDir, storedJob.snapshot.rootDir, { recursive: true });
      for (const pending of activeWorkspace.preparedPublications) await pending(prismaMock);
      return { ...result, workspaceRevision: publish ? 1 : 0 };
    } finally { activeWorkspace = null; }
  },
}));

await jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
await jest.unstable_mockModule("../services/job.service.js", () => lifecycle);
await jest.unstable_mockModule("../services/jobUpdate.service.js", () => jobUpdate);
await jest.unstable_mockModule("../services/aiContextBuilder.service.js", () => aiContextBuilder);
await jest.unstable_mockModule("../services/gemini.service.js", () => geminiService);
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: dockerRunnerMock }));
await jest.unstable_mockModule("../services/notification.service.js", () => ({ notificationService: notificationMock }));

const { processAiTestsJob } = await import("../services/aiTestsJob.service.js");

describe("processAiTestsJob - PLAYWRIGHT_E2E mode", () => {
  let tempRoot;

  beforeEach(() => {
    jest.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-playwright-ai-"));
    rejectPublication = false;

    prismaMock.project.findUnique.mockResolvedValue({ hasJest: false, hasVitest: false });
    prismaMock.projectSnapshot.findUnique.mockResolvedValue({ id: "snap-1", rootDir: tempRoot });
    aiContextBuilder.buildAiPayload.mockResolvedValue({
      payload: {
        sourceCode: [{ path: "src/App.jsx", content: "export default function App() {}" }],
      },
    });
  });
  afterEach(() => {
    for (const root of [tempRoot, ...preparedRoots.splice(0)]) {
      if (root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("completes full flow on passing dry-run and stores VERIFIED AiTest", async () => {
    const job = {
      id: "job-p1",
      snapshotId: "snap-1",
      projectId: "proj-1", userId: "owner",
      payloadJson: JSON.stringify({ mode: "PLAYWRIGHT_E2E" }),
      snapshot: { rootDir: tempRoot },
    };
    lifecycle.getJobById.mockResolvedValue(job);

    const generatedJs = `
      import { test, expect } from '@playwright/test';
      test('homepage smoke test', async ({ page }) => {
        await test.step('Action: NAVIGATION - open homepage', async()=>{await page.goto('/');});
        await test.step('Assert: heading visible', async()=>{await expect(page.getByRole('heading')).toBeVisible();});
        await test.step('Evidence: verified outcome', async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
      });
    `;

    geminiService.generateText.mockResolvedValue(`\`\`\`json
    {
      "tests": [
        {
          "filePath": "tests/e2e/ai-generated.spec.js",
          "content": ${JSON.stringify(generatedJs)}
        }
      ]
    }
    \`\`\``);

    dockerRunnerMock.run.mockResolvedValue({ success: true, exitCode: 0, stdout: "1 passed", stderr: "" });

    const result = await processAiTestsJob("job-p1");

    expect(result.success).toBe(true);
    expect(result.dryRunPassed).toBe(true);

    // Verify file written to tests/e2e/ai-generated.spec.js
    const savedPath = path.join(tempRoot, "tests/e2e/ai-generated.spec.js");
    expect(fs.existsSync(savedPath)).toBe(true);
    const savedCode = fs.readFileSync(savedPath, "utf8");
    expect(savedCode).toContain("await test.step('Action: NAVIGATION - open homepage'");
    expect(savedCode).toContain("await test.step('Assert: heading visible'");
    expect(savedCode).toContain("page.goto('/')");
    expect(savedCode).toContain("expect(page.getByRole('heading')).toBeVisible()");

    // Verify AiTest created in DB with VERIFIED status
    expect(prismaMock.aiTest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "proj-1",
        snapshotId: "snap-1",
        mode: "PLAYWRIGHT_E2E",
        status: "VERIFIED",
        content: savedCode,
        filePath: "tests/e2e/ai-generated.spec.js",
      }),
    });

    // Verify temporary dryrun file is cleaned up
    expect(fs.existsSync(path.join(tempRoot, ".covai-temp/dryrun.spec.js"))).toBe(false);
  });

  it("handles failing dry-run gracefully without saving to test directory and records FAILED status", async () => {
    const job = {
      id: "job-p2",
      snapshotId: "snap-1",
      projectId: "proj-1", userId: "owner",
      payloadJson: JSON.stringify({ mode: "PLAYWRIGHT_E2E" }),
      snapshot: { rootDir: tempRoot },
    };
    lifecycle.getJobById.mockResolvedValue(job);

    const generatedJs = `
      import { test, expect } from '@playwright/test';
      test('button click test', async ({ page }) => {
        await test.step('Setup: open homepage', async()=>{await page.goto('/');});
        await test.step('Action: OTHER - click control', async()=>{await page.getByRole('button', { name: 'nonexistent' }).click();});
        await test.step('Assert: heading visible', async()=>{await expect(page.getByRole('heading')).toBeVisible();});
        await test.step('Evidence: verified outcome', async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
      });
    `;

    geminiService.generateText.mockResolvedValue(generatedJs);
    dockerRunnerMock.run.mockResolvedValue({
      success: false,
      exitCode: 1,
      stderr: "Error: Timed out 15000ms waiting for getByRole('button', { name: 'nonexistent' })",
    });

    const result = await processAiTestsJob("job-p2");

    expect(result.success).toBe(false);
    expect(result.dryRunPassed).toBe(false);

    // Verify file is NOT written to tests/e2e/
    const savedPath = path.join(tempRoot, "tests/e2e/ai-generated.spec.js");
    expect(fs.existsSync(savedPath)).toBe(false);

    // Verify AiTest is recorded as FAILED with error message
    expect(prismaMock.aiTest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "proj-1",
        snapshotId: "snap-1",
        mode: "PLAYWRIGHT_E2E",
        status: "FAILED",
        metaJson: expect.stringContaining("Timed out 15000ms"),
      }),
    });

    // Verify temporary dryrun file is cleaned up
    expect(fs.existsSync(path.join(tempRoot, ".covai-temp/dryrun.spec.js"))).toBe(false);
  });

  it("rejects code with syntax or security violation before running dry-run", async () => {
    const job = {
      id: "job-p3",
      snapshotId: "snap-1",
      projectId: "proj-1", userId: "owner",
      payloadJson: JSON.stringify({ mode: "PLAYWRIGHT_E2E" }),
      snapshot: { rootDir: tempRoot },
    };
    lifecycle.getJobById.mockResolvedValue(job);

    const maliciousJs = `
      import { exec } from 'child_process';
      test('exploit', () => exec('whoami'));
    `;
    geminiService.generateText.mockResolvedValue(maliciousJs);

    const result = await processAiTestsJob("job-p3");

    expect(result.success).toBe(false);
    expect(result.error).toContain("child_process");

    // Ensure dockerRunner was NOT even called
    expect(dockerRunnerMock.run).not.toHaveBeenCalled();

    // Verify recorded in DB as FAILED
    expect(prismaMock.aiTest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mode: "PLAYWRIGHT_E2E",
        status: "FAILED",
      }),
    });
  });
  it.each(["publication conflict", "revoked during verification"])("does not publish files or AiTest metadata after %s", async failure => {
    lifecycle.getJobById.mockResolvedValue({ id: "job-fenced", projectId: "proj-1", snapshotId: "snap-1", userId: "owner",
      payloadJson: JSON.stringify({ mode: "PLAYWRIGHT_E2E" }), snapshot: { id: "snap-1", rootDir: tempRoot } });
    geminiService.generateText.mockResolvedValue(`import { test, expect } from '@playwright/test';
test('opens home', async ({ page }) => {
 await test.step('Action: NAVIGATION - open home', async()=>{await page.goto('/');});
 await test.step('Assert: heading visible', async()=>{await expect(page.getByRole('heading')).toBeVisible();});
 await test.step('Evidence: outcome', async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
});`);
    rejectPublication = failure === "publication conflict";
    dockerRunnerMock.run.mockImplementation(async () => {
      if (failure === "revoked during verification") activeWorkspace.revoked = true;
      return { success: true, exitCode: 0, stdout: "1 passed", stderr: "" };
    });
    await expect(processAiTestsJob("job-fenced")).rejects.toMatchObject({ statusCode: failure === "publication conflict" ? 409 : 403 });
    expect(fs.existsSync(path.join(tempRoot, "tests/e2e/ai-generated.spec.js"))).toBe(false);
    expect(prismaMock.aiTest.create).not.toHaveBeenCalled();
    expect(jobUpdate.updateJobStatus.mock.calls.some(([input]) => input.status === "SUCCESS")).toBe(false);
    expect(notificationMock.createJobFinishedNotification).not.toHaveBeenCalled();
  });
});
