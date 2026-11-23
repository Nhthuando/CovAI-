import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dockerRunner } from './dockerRunner.service.js';
import { preparePlaywrightBrowsers } from './systemTestRunner.service.js';
import { redactSystemTestSecrets } from './systemTestSecrets.service.js';

export const selectSnapshotRoutes = (routes = [], targetRoutes = []) => {
    const candidates = Array.isArray(targetRoutes) && targetRoutes.length ? targetRoutes : routes;
    const unique = new Set(candidates
        .filter(route => typeof route === 'string' && route.startsWith('/') &&
            !route.startsWith('//') && !/[:*(\[?]/.test(route))
        .map(route => route.replace(/\/+$/, '') || '/'));
    const hasRoot = unique.delete('/');
    return (hasRoot ? ['/', ...unique] : [...unique]).slice(0, 6);
};

const playwrightEsm = new URL('../../node_modules/playwright/index.mjs', import.meta.url);
const playwrightCjs = new URL('../../node_modules/playwright/index.js', import.meta.url);

const snapshotScript = () => `
import fs from 'node:fs';
${fs.existsSync(playwrightEsm)
    ? `import { chromium } from ${JSON.stringify(pathToFileURL(fileURLToPath(playwrightEsm)).href)};`
    : `import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(${JSON.stringify(fileURLToPath(playwrightCjs))});`}

const [inputPath, outputPath] = process.argv.slice(2);
const { baseURL, routes } = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const browser = await chromium.launch({ headless: true });
const snapshots = [];
try {
    const page = await browser.newPage();
    for (const route of routes) {
        try {
            await page.goto(baseURL + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            const title = await page.title();
            const snapshot = await page.locator('body').ariaSnapshot({ timeout: 5000 });
            snapshots.push({ route, title, snapshot });
        } catch (error) {
            snapshots.push({ route, error: error.message });
        }
    }
    fs.writeFileSync(outputPath, JSON.stringify(snapshots));
} finally {
    await browser.close();
}
`;

export const captureLivePageSnapshots = async ({ rootDir, stack, routes, signal, dependencies = {} }) => {
    try {
        signal?.throwIfAborted();
        if (!routes.length) return [];
        const tempDir = fs.mkdtempSync(path.join(path.resolve(rootDir), '.covai-snapshot-'));
        try {
            const script = path.join(tempDir, 'capture.mjs');
            const inputPath = path.join(tempDir, 'input.json');
            const outputPath = path.join(tempDir, 'snapshots.json');
            const baseURL = `http://127.0.0.1:${stack.frontendPort}`;
            fs.writeFileSync(script, snapshotScript());
            fs.writeFileSync(inputPath, JSON.stringify({ baseURL, routes }));
            const browserEnv = await (dependencies.prepareBrowsers || preparePlaywrightBrowsers)(rootDir, null, { signal });
            signal?.throwIfAborted();
            const result = await (dependencies.run || dockerRunner.run)({
                snapshotPath: rootDir,
                command: `"${process.execPath}" "${script}" "${inputPath}" "${outputPath}"`,
                timeoutMs: 120000,
                jobId: null,
                forceHost: true,
                isolatedEnv: true,
                signal,
                env: browserEnv,
            });
            signal?.throwIfAborted();
            if (result?.success === false) {
                throw new Error(result.stderr || `Snapshot command failed (exit ${result.exitCode})`);
            }
            const snapshots = [];
            let total = 0;
            for (const { route, error, title, snapshot } of JSON.parse(fs.readFileSync(outputPath, 'utf8'))) {
                if (error) continue;
                const redactedSnapshot = redactSystemTestSecrets(snapshot).slice(0, 5000);
                const redactedTitle = redactSystemTestSecrets(title);
                total += redactedSnapshot.length + redactedTitle.length;
                if (total > 24000) break;
                snapshots.push({ route, title: redactedTitle, snapshot: redactedSnapshot });
            }
            return snapshots;
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    } catch (error) {
        signal?.throwIfAborted();
        console.warn(redactSystemTestSecrets(`[livePageSnapshot] Capture failed: ${error?.message || error}`));
        return [];
    }
};
