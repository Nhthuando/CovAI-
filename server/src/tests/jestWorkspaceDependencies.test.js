import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';

const run = jest.fn();
await jest.unstable_mockModule('../services/dockerRunner.service.js', () => ({ dockerRunner: { run } }));
const { ensureMountedProjectDependencies, installPackageInWorkspace } = await import('../services/dependencyResolution.service.js');

const lock = '{"name":"fixture","lockfileVersion":3,"packages":{}}\n';
let rootDir;
let lockFile;

beforeEach(() => {
    const parent = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(parent, { recursive: true });
    rootDir = fs.mkdtempSync(path.join(parent, 'jest-lock-repair-'));
    fs.mkdirSync(path.join(rootDir, 'server'));
    fs.writeFileSync(path.join(rootDir, 'server/package.json'), '{"name":"fixture","dependencies":{"@prisma/client":"6.19.0"}}');
    lockFile = path.join(rootDir, 'server/package-lock.json');
    fs.writeFileSync(lockFile, lock);
    run.mockReset();
});

afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

test.each([true, false])('recovers from a stale npm lock and restores its bytes (retry success: %s)', async success => {
    run.mockResolvedValueOnce({
        success: false,
        stderr: 'npm error code EUSAGE\nnpm error Missing: @emnapi/core@1.11.3 from lock file',
    }).mockImplementationOnce(async ({ snapshotPath }) => {
        fs.writeFileSync(lockFile, '{"regenerated":true}\n');
        if (success) {
            const packageDir = path.join(snapshotPath, 'node_modules/@prisma/client');
            fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'package.json'), '{"name":"@prisma/client","version":"6.19.0"}');
        }
        return { success, stderr: success ? '' : 'npm error network connection failed' };
    });

    const restore = ensureMountedProjectDependencies({ rootDir, packageDirs: ['server'] });
    if (success) await expect(restore).resolves.toBeUndefined();
    else await expect(restore).rejects.toMatchObject({ code: 'JEST_WORKSPACE_DEPENDENCIES_UNAVAILABLE' });
    expect(run.mock.calls.map(([options]) => options.command.split(' ').slice(0, 2).join(' ')))
        .toEqual(['npm ci', 'npm install']);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(lock);
});

test('does not retry unrelated npm errors', async () => {
    run.mockResolvedValueOnce({ success: false, stderr: 'npm error code E401' });
    await expect(ensureMountedProjectDependencies({ rootDir, packageDirs: ['server'] }))
        .rejects.toMatchObject({ code: 'JEST_WORKSPACE_DEPENDENCIES_UNAVAILABLE' });
    expect(run).toHaveBeenCalledTimes(1);
});

test('leaves a lock mismatch for review outside runner dependency preparation', async () => {
    run.mockResolvedValueOnce({
        success: false,
        stderr: 'npm error code EUSAGE\nnpm error Missing: @emnapi/runtime@1.11.3 from lock file',
    });
    await expect(installPackageInWorkspace({ rootDir, importedFrom: 'server/package.json', packageName: '@prisma/client' }))
        .resolves.toMatchObject({ success: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(lock);
});
