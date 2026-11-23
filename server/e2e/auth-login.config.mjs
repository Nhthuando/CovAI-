import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "auth-login.spec.mjs",
  outputDir: "../.covai-temp/playwright-auth-results",
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:55273",
    headless: true,
    channel: "msedge",
    viewport: { width: 1280, height: 850 },
    actionTimeout: 10000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
