import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= fileURLToPath(new URL('../.covai-temp/playwright-browsers', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: 'system-automatic.spec.mjs',
  workers: 1,
  timeout: 45000,
  expect: {timeout: 15000},
  outputDir: '../../temp/system-automatic-browser',
  reporter: 'list',
  use: {
    headless: true,
    viewport: {width: 1365, height: 950},
    screenshot: 'only-on-failure',
  },
});
