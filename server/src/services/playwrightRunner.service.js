import { addJobLog } from "./job.service.js";
import { dockerRunner } from "./dockerRunner.service.js";
import { ServiceError } from "../utils/serviceError.js";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút cho npm install
const PLAYWRIGHT_TIMEOUT_MS = 10 * 60 * 1000; // 10 phút cho test

/**
 * Cài đặt dependencies cho Playwright
 */
export const installPlaywrightDeps = async (jobId, rootDir) => {
  await addJobLog(
    jobId,
    "INFO",
    "Bắt đầu cài đặt dependencies (Playwright)...",
  ).catch(() => { });

  // Sử dụng image playwright để đảm bảo có đủ trình duyệt
  const result = await dockerRunner.run({
    snapshotPath: rootDir,
    command: "npm install && npx playwright install --with-deps",
    timeoutMs: INSTALL_TIMEOUT_MS,
    jobId,
  });

  if (!result.success) {
    throw new Error(`Cài đặt Playwright thất bại: ${result.stderr}`);
  }
};

/**
 * Chạy Playwright test
 */
export const runPlaywrightTests = async (jobId, rootDir, testDirectory) => {
  // Config lệnh chạy để đáp ứng toàn bộ Jira Requirements
  // --browser=chromium (Configure browser)
  // --reporter=json (Capture test results)
  // (Lưu ý: Playwright mặc định chạy headless trên Docker)

  const targetDir = testDirectory ? ` ${testDirectory}` : "";
  const testCmd = `npx playwright test${targetDir} --browser=chromium --reporter=json`;

  await addJobLog(jobId, "INFO", `Chạy lệnh: ${testCmd}`).catch(() => { });

  const result = await dockerRunner.run({
    snapshotPath: rootDir,
    command: testCmd,
    timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
    jobId,
  });

  return result;
};

