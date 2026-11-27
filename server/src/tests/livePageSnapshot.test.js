import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { captureLivePageSnapshots, selectSnapshotRoutes } from '../services/livePageSnapshot.service.js';
import { __clearAllSystemTestSecretsForTest, storeSystemTestSecrets } from '../services/systemTestSecrets.service.js';

describe('selectSnapshotRoutes', () => {
    it('keeps up to ten unique static routes with the root first', () => {
        expect(selectSnapshotRoutes([
            '/one/', '/one', '/:id', '/files/*', '/(group)', '/[id]', '/search?q=1',
            '//another-host', 'relative', null, '/two', '/three', '/four', '/five', '/six',
            '/seven', '/eight', '/nine', '/ten', '/eleven', '/',
        ])).toEqual(['/', '/one', '/two', '/three', '/four', '/five', '/six', '/seven', '/eight', '/nine']);
    });

    it('uses target routes when supplied', () => {
        expect(selectSnapshotRoutes(['/', '/other'], ['/cart/', '/orders/:id'])).toEqual(['/cart']);
    });
});

describe('captureLivePageSnapshots', () => {
    let rootDir;

    beforeEach(() => {
        __clearAllSystemTestSecretsForTest();
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-live-snapshots-'));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        __clearAllSystemTestSecretsForTest();
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it('reads successful snapshots, redacts secrets, and enforces both size limits', async () => {
        const secret = 'snapshot-secret-fixture';
        storeSystemTestSecrets(rootDir, { TOKEN: secret });
        const routes = ['/', '/broken', '/a', '/b', '/c', '/d'];
        const browserEnv = { PLAYWRIGHT_BROWSERS_PATH: 'test-browser-path' };
        const prepareBrowsers = jest.fn().mockResolvedValue(browserEnv);
        const signal = new AbortController().signal;
        const run = jest.fn(({ command }) => {
            const [, , inputPath, outputPath] = Array.from(command.matchAll(/"([^"]+)"/g), match => match[1]);
            expect(JSON.parse(fs.readFileSync(inputPath, 'utf8'))).toEqual({
                baseURL: 'http://127.0.0.1:3001', routes,
            });
            fs.writeFileSync(outputPath, JSON.stringify(routes.map(route => route === '/broken'
                ? { route, error: 'Navigation failed' }
                : { route, title: secret, snapshot: secret + 'x'.repeat(6000) })));
            return { success: true };
        });

        const snapshots = await captureLivePageSnapshots({
            rootDir, stack: { frontendPort: 3001 }, routes, signal, dependencies: { prepareBrowsers, run },
        });

        expect(prepareBrowsers).toHaveBeenCalledWith(rootDir, null, { signal });
        expect(run).toHaveBeenCalledWith(expect.objectContaining({
            snapshotPath: rootDir, forceHost: true, isolatedEnv: true, env: browserEnv, signal,
        }));
        expect(snapshots).toEqual(['/', '/a', '/b', '/c'].map(route => ({
            route, title: '***', snapshot: '***' + 'x'.repeat(4997),
        })));
        expect(fs.readdirSync(rootDir)).toEqual([]);
    });

    it('returns no snapshots and logs a redacted warning when the host runner throws', async () => {
        const secret = 'snapshot-error-fixture';
        storeSystemTestSecrets(rootDir, { TOKEN: secret });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const run = jest.fn().mockRejectedValue(new Error(secret));
        const prepareBrowsers = jest.fn().mockResolvedValue({});

        await expect(captureLivePageSnapshots({
            rootDir, stack: { frontendPort: 3001 }, routes: ['/'], dependencies: { run, prepareBrowsers },
        })).resolves.toEqual([]);
        expect(warn).toHaveBeenCalledWith('[livePageSnapshot] Capture failed: ***');
        expect(fs.readdirSync(rootDir)).toEqual([]);
    });
});
