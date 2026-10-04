import { jest, beforeEach, describe, expect, it } from "@jest/globals";

const run = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: { run } }));

const fsMock = {
  mkdirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  writeFileSync: jest.fn(),
  symlinkSync: jest.fn(),
  unlinkSync: jest.fn(),
};
await jest.unstable_mockModule("fs", () => ({ default: fsMock, ...fsMock }));

const prepareAutEnvironment = jest.fn();
const runSeedDataIfPresent = jest.fn();
const detectAutPort = jest.fn().mockReturnValue(4173);
const resolveAvailableAutPort = jest.fn().mockResolvedValue(4173);
const startAutServer = jest.fn();
const stopAutServer = jest.fn();

await jest.unstable_mockModule("../services/autLifecycle.service.js", () => ({
  prepareAutEnvironment,
  runSeedDataIfPresent,
  detectAutPort,
  resolveAvailableAutPort,
  startAutServer,
  stopAutServer,
}));

const { runSystemTests } = await import("../services/systemTestRunner.service.js");

describe("runSystemTests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fsMock.existsSync.mockReturnValue(false);
    run.mockResolvedValue({ success: true, exitCode: 0 });
    prepareAutEnvironment.mockResolvedValue({ created: true });
    runSeedDataIfPresent.mockResolvedValue({ executed: false });
    startAutServer.mockResolvedValue({ started: true, pid: 12345, port: 4173 });
    stopAutServer.mockResolvedValue();
  });

  it("removes the previous report before execution so a crash cannot reuse old results", async () => {
    const reportPath = "C:/snapshot/.covai-system-test/playwright-results.json";
    fsMock.existsSync.mockImplementation((file) => file === reportPath);
    await runSystemTests({
      rootDir: "C:/snapshot",
      execution: { runner: "playwright", command: "npx playwright test", reportPath, reportDirectory: "C:/snapshot/.covai-system-test" },
    });
    expect(fsMock.unlinkSync).toHaveBeenCalledWith(reportPath);
    expect(fsMock.unlinkSync.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
  });

  it("creates the report folder, manages AUT lifecycle, and uses the Playwright browser image", async () => {
    await runSystemTests({
      jobId: "job-1",
      rootDir: "C:/snapshot",
      execution: { runner: "playwright", command: "npx playwright test", reportDirectory: "C:/snapshot/.covai-system-test" },
    });

    expect(fsMock.mkdirSync).toHaveBeenCalledWith("C:/snapshot/.covai-system-test", { recursive: true });
    expect(prepareAutEnvironment).toHaveBeenCalledWith("C:/snapshot", 4173, "job-1");
    expect(runSeedDataIfPresent).toHaveBeenCalledWith({ snapshotDir: "C:/snapshot", jobId: "job-1" });
    expect(startAutServer).toHaveBeenCalledWith({ snapshotDir: "C:/snapshot", port: 4173, jobId: "job-1" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshotPath: "C:/snapshot",
      jobId: "job-1",
      image: expect.stringContaining("mcr.microsoft.com/playwright"),
      env: expect.objectContaining({
        PLAYWRIGHT_BASE_URL: "http://localhost:4173",
      }),
    }));
    expect(stopAutServer).toHaveBeenCalledWith(12345, 4173, "job-1");
  });

  it("uses the Cypress browser image for Cypress and cleans up AUT in finally block", async () => {
    await runSystemTests({
      jobId: "job-2",
      rootDir: "C:/snapshot",
      execution: { runner: "cypress", command: "npx cypress run", reportDirectory: "C:/snapshot/.covai-system-test" },
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      image: expect.stringContaining("cypress/browsers"),
      env: expect.objectContaining({
        CYPRESS_BASE_URL: "http://localhost:4173",
      }),
    }));
    expect(stopAutServer).toHaveBeenCalledWith(12345, 4173, "job-2");
  });

  it("ensures stopAutServer is invoked even if dockerRunner throws an error", async () => {
    run.mockRejectedValueOnce(new Error("Container execution failed"));

    await expect(runSystemTests({
      jobId: "job-3",
      rootDir: "C:/snapshot",
      execution: { runner: "playwright", command: "npx playwright test", reportDirectory: "C:/snapshot/.covai-system-test" },
    })).rejects.toThrow("Container execution failed");

    expect(stopAutServer).toHaveBeenCalledWith(12345, 4173, "job-3");
  });
});
