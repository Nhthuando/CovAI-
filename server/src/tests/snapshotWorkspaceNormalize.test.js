import { describe, test, expect, jest, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('snapshotWorkspace normalizeDiskPath', () => {
    const origPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        jest.restoreAllMocks();
        jest.resetModules();
    });

    test('resolves container /app/storage/projects/... path to server/storage/projects/... on Windows even if phantom E:\\app\\storage exists', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((target) => {
            const norm = String(target).replace(/\\/g, '/');
            // Simulate phantom /app/storage/... or server/storage/projects/...
            if (norm === '/app/storage/projects/p1/github/123/repo') return true;
            if (norm.endsWith('/server/storage/projects/p1/github/123/repo')) return true;
            return false;
        });

        const { normalizeDiskPath } = await import('../utils/snapshotWorkspace.js');
        const resolved = normalizeDiskPath('/app/storage/projects/p1/github/123/repo');

        expect(resolved.replace(/\\/g, '/')).toMatch(/\/server\/storage\/projects\/p1\/github\/123\/repo$/);
        // Should not short-circuit on '/app/storage/...'
        expect(existsSpy).not.toHaveBeenCalledWith('/app/storage/projects/p1/github/123/repo');
    });

    test('resolveSnapshotRootDir resolves Windows container E:\\app\\storage\\projects\\... to real server/storage/projects/...', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        jest.spyOn(fs, 'existsSync').mockImplementation((target) => {
            const norm = String(target).replace(/\\/g, '/');
            if (norm === 'E:/app/storage/projects/p1/github/123/repo') return true; // phantom empty dir
            if (norm.endsWith('/server/storage/projects/p1/github/123/repo')) return true;
            if (norm.endsWith('/server/storage/projects/p1/github/123/repo/package.json')) return true;
            return false;
        });
        jest.spyOn(fs, 'statSync').mockImplementation((target) => ({
            isDirectory: () => !String(target).endsWith('package.json'),
            isFile: () => String(target).endsWith('package.json'),
        }));

        const { resolveSnapshotRootDir } = await import('../utils/projectRootResolver.js');
        const resolved = resolveSnapshotRootDir('E:\\app\\storage\\projects\\p1\\github\\123\\repo');
        expect(resolved.replace(/\\/g, '/')).toMatch(/\/server\/storage\/projects\/p1\/github\/123\/repo$/);
    });
});
