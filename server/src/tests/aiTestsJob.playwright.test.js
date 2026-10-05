import { describe, expect, it, jest, beforeEach } from "@jest/globals";
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
  project: { findUnique: jest.fn() },
  projectSnapshot: { findUnique: jest.fn() },
  aiTest: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
};

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

    prismaMock.project.findUnique.mockResolvedValue({ hasJest: false, hasVitest: false });
    prismaMock.projectSnapshot.findUnique.mockResolvedValue({ rootDir: tempRoot });
    aiContextBuilder.buildAiPayload.mockResolvedValue({
      payload: {
        sourceCode: [{ path: "src/App.jsx", content: "export default function App() {}" }],
      },
    });
  });

  it("completes full flow on passing dry-run and stores VERIFIED AiTest", async () => {
    const job = {
      id: "job-p1",
      snapshotId: "snap-1",
      projectId: "proj-1",
      payloadJson: JSON.stringify({ mode: "PLAYWRIGHT_E2E" }),
      snapshot: { rootDir: tempRoot },
    };
    lifecycle.getJobById.mockResolvedValue(job);

    const generatedJs = `
      import { test, expect } from '@playwright/test';
      test('homepage smoke test', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading')).toBeVisible();
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
    expect(fs.readFileSync(savedPath, "utf8")).toBe(generatedJs);

    // Verify AiTest created in DB with VERIFIED status
    expect(prismaMock.aiTest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "proj-1",
        snapshotId: "snap-1",
        mode: "PLAYWRIGHT_E2E",
        status: "VERIFIED",
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
      projectId: "proj-1",
      payloadJson: JSON.stringify({ mode: "PLAYWRIGHT_E2E" }),
      snapshot: { rootDir: tempRoot },
    };
    lifecycle.getJobById.mockResolvedValue(job);

    const generatedJs = `
      import { test, expect } from '@playwright/test';
      test('button click test', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'nonexistent' }).click();
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
      projectId: "proj-1",
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
});
