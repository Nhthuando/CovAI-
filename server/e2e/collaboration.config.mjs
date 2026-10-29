import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: '.', testMatch: 'collaboration-*.spec.mjs', workers: 1, fullyParallel: false,
    timeout: 300000, expect: { timeout: 20000 },
    outputDir: '../../tmp/collaboration-evidence/browser',
    reporter: [['list'], ['json', { outputFile: '../../tmp/collaboration-evidence/browser-results.json' }]],
    use: { baseURL: 'http://127.0.0.1:55173', headless: true, channel: 'chrome',
        viewport: { width: 1440, height: 900 }, actionTimeout: 15000,
        trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
