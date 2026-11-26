import { defineConfig } from "@playwright/test";
import fs from "node:fs";

function resolveBrowserChannel() {
  if (process.env.PLAYWRIGHT_CHANNEL) {
    return process.env.PLAYWRIGHT_CHANNEL;
  }
  if (process.platform === "win32") {
    const edgePaths = [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    if (edgePaths.some((p) => fs.existsSync(p))) {
      return "msedge";
    }
    const chromePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    if (chromePaths.some((p) => fs.existsSync(p))) {
      return "chrome";
    }
  }
  return undefined;
}

const channel = resolveBrowserChannel();

export default defineConfig({
  testDir: ".",
  testMatch: "version-control.spec.mjs",
  // Keep artifacts strictly inside .covai-temp so server/test-results/ is never touched
  outputDir: "../.covai-temp/playwright-vcs-results",
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 20000 },
  use: {
    baseURL: "http://127.0.0.1:55283",
    headless: true,
    ...(channel ? { channel } : {}),
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
