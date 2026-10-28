import { jest, beforeEach, describe, expect, it } from "@jest/globals";
import path from "node:path";

const run = jest.fn();
const prepareDependencies=jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: { run } }));
await jest.unstable_mockModule('../services/projectDependencies.service.js',()=>({prepareProjectDependencies:prepareDependencies}));

const fsMock = {
  mkdirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  writeFileSync: jest.fn(),
  symlinkSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
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

const { runSystemTests, preparePlaywrightBrowsers } = await import("../services/systemTestRunner.service.js");

describe("runSystemTests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fsMock.existsSync.mockReturnValue(false);
    run.mockResolvedValue({ success: true, exitCode: 0 });
    prepareDependencies.mockReset().mockResolvedValue({manager:'npm',command:'npm'});
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

  it("installs dependencies before executing a config-owned web server even with partial node_modules", async () => {
    const rootDir = "C:/snapshot";
    fsMock.existsSync.mockImplementation(file => file === path.join(rootDir, "package.json") || file === path.join(rootDir, "node_modules"));
    fsMock.readFileSync.mockReturnValue("export default { webServer: { command: 'npm run dev' } }");
    await runSystemTests({ jobId: "web-server-job", rootDir,
      execution: { runner: "playwright", configPath: "playwright.config.ts", command: "npx playwright test", reportDirectory: "C:/snapshot/.covai-system-test" } });
    expect(run).toHaveBeenCalledTimes(2);
    expect(prepareDependencies).toHaveBeenCalledWith({directory:rootDir,repositoryRoot:rootDir,jobId:'web-server-job'});
    expect(run.mock.calls[0][0].command).toMatch(/cli\.js" install$/);
    expect(run.mock.calls[1][0].command).toContain('--config=".covai-system-test/playwright.config.mjs"');
    const wrapper = fsMock.writeFileSync.mock.calls.find(([file]) => file === path.join(rootDir, ".covai-system-test", "playwright.config.mjs"))[1];
    expect(wrapper).toContain("screenshot: 'on'");
    expect(wrapper).toContain("cwd: path.resolve(root, item.cwd || '.')");
    expect(wrapper).toContain("const managedServer = false");
    expect(run.mock.calls[1][0].env.PLAYWRIGHT_BROWSERS_PATH).toBe(run.mock.calls[0][0].env.PLAYWRIGHT_BROWSERS_PATH);
    expect(startAutServer).not.toHaveBeenCalled();
  });

  it("stops before Playwright when web server dependencies cannot be installed", async () => {
    fsMock.existsSync.mockImplementation(file => file === path.join("C:/snapshot", "package.json"));
    fsMock.readFileSync.mockReturnValue("export default { webServer: {} }");
    prepareDependencies.mockRejectedValueOnce(new Error('Application dependency installation failed'));
    await expect(runSystemTests({ rootDir: "C:/snapshot",
      execution: { runner: "playwright", configPath: "playwright.config.ts", command: "npx playwright test", reportDirectory: "C:/snapshot/.covai-system-test" } })).rejects.toThrow("Application dependency installation failed");
    expect(run).not.toHaveBeenCalled();
    expect(startAutServer).not.toHaveBeenCalled();
  });
  it("filters a config-owned frontend run to the explicitly selected spec", async () => {
    const rootDir = path.resolve('snapshot/client');
    fsMock.readFileSync.mockReturnValue("export default { webServer: {} }");
    await runSystemTests({ rootDir, execution: { runner: 'playwright', configPath: 'playwright.config.ts',
      testFile: path.join(rootDir, 'e2e/home.spec.ts'), command: 'npx playwright test > results.json', reportDirectory: path.join(rootDir, '.covai-system-test') } });
    const command = run.mock.calls.at(-1)[0].command;
    expect(command).toContain('"e2e/home\\.spec\\.ts"');
    expect(command.indexOf('"e2e/home\\.spec\\.ts"')).toBeLessThan(command.indexOf(' > results.json'));
  });

  it("uses the snapshot Playwright version to install browsers", async () => {
    const rootDir = "C:/snapshot";
    const cli = path.join(rootDir, "node_modules", "playwright", "cli.js");
    fsMock.existsSync.mockImplementation(file => file === cli);
    const env = await preparePlaywrightBrowsers(rootDir, "browser-job");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshotPath: rootDir, jobId: "browser-job", forceHost: true,
      command: `"${process.execPath}" "${cli}" install`, env,
    }));
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBeTruthy();
  });

  it("reports browser installation errors before running tests and cleans up the AUT", async () => {
    run.mockResolvedValueOnce({ success: false, exitCode: 1, stderr: "Browser download failed" });
    await expect(runSystemTests({ rootDir: "C:/snapshot", jobId: "browser-job",
      execution: { runner: "playwright", command: "npx playwright test", reportDirectory: "C:/snapshot/.covai-system-test" },
    })).rejects.toThrow("Playwright browser installation failed (exit 1): Browser download failed");
    expect(run).toHaveBeenCalledTimes(1);
    expect(stopAutServer).toHaveBeenCalledWith(12345, 4173, "browser-job");
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
    expect(startAutServer).toHaveBeenCalledWith({ snapshotDir: "C:/snapshot", repositoryRoot:'C:/snapshot', port: 4173, jobId: "job-1", requireHealthy: true });
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
