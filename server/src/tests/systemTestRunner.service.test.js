import { jest, beforeEach, describe, expect, it } from "@jest/globals";

const run = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: { run } }));

const fsMock = { mkdirSync: jest.fn() };
await jest.unstable_mockModule("fs", () => ({ default: fsMock, ...fsMock }));

const { runSystemTests } = await import("../services/systemTestRunner.service.js");

describe("runSystemTests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    run.mockResolvedValue({ success: true, exitCode: 0 });
  });

  it("creates the report folder and uses the Playwright browser image", async () => {
    await runSystemTests({
      jobId: "job-1",
      rootDir: "C:/snapshot",
      execution: { runner: "playwright", command: "npx playwright test", reportDirectory: "C:/snapshot/.covai-system-test" },
    });
    expect(fsMock.mkdirSync).toHaveBeenCalledWith("C:/snapshot/.covai-system-test", { recursive: true });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshotPath: "C:/snapshot", jobId: "job-1", image: expect.stringContaining("mcr.microsoft.com/playwright"),
    }));
  });

  it("uses the Cypress browser image for Cypress", async () => {
    await runSystemTests({
      jobId: "job-1",
      rootDir: "C:/snapshot",
      execution: { runner: "cypress", command: "npx cypress run", reportDirectory: "C:/snapshot/.covai-system-test" },
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ image: expect.stringContaining("cypress/browsers") }));
  });
});
