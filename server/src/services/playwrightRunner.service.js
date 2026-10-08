import { addJobLog } from "./job.service.js";
import { dockerRunner } from "./dockerRunner.service.js";
import { ServiceError } from "../utils/serviceError.js";

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000; // 15 mins for npm install
const PLAYWRIGHT_TIMEOUT_MS = 15 * 60 * 1000; // 15 mins for tests

/**
 * Install Playwright dependencies
 */
export const installPlaywrightDeps = async (jobId, rootDir) => {
  await addJobLog(
    jobId,
    "INFO",
    "Starting dependency installation (Playwright)...",
  ).catch(() => { });

  // Use playwright image to guarantee browser presence
  const result = await dockerRunner.run({
    snapshotPath: rootDir,
    command: "npm install && npx playwright install --with-deps",
    timeoutMs: INSTALL_TIMEOUT_MS,
    jobId,
  });

  if (!result.success) {
    throw new Error(`Playwright installation failed: ${result.stderr}`);
  }
};

/**
 * Execute Playwright tests
 */
export const runPlaywrightTests = async (jobId, rootDir, testDirectory) => {
  // Configure run command per Jira requirements
  // --browser=chromium (Configure browser)
  // --reporter=json (Capture test results)
  // (Note: Playwright defaults to headless in Docker)

  const targetDir = testDirectory ? ` ${testDirectory}` : "";
  // Ensure Playwright outputs JSON to a specific file instead of stdout
  const testCmd = `PLAYWRIGHT_JSON_OUTPUT_NAME=playwright-results.json npx playwright test${targetDir} --browser=chromium --reporter=json`;

  await addJobLog(jobId, "INFO", `Running command: ${testCmd}`).catch(() => { });

  const result = await dockerRunner.run({
    snapshotPath: rootDir,
    command: testCmd,
    timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
    jobId,
  });

  return result;
};

