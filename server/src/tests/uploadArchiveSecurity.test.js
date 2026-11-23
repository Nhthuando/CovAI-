import { describe, test, expect, afterAll, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import syncFs from 'fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
    scanArchiveBomb,
    isDisallowedSecretFile,
    purgeDisallowedSecretFiles,
} from '../middlewares/upload.middleware.js';

function createZipBuffer(filesMap) {
    const zip = new AdmZip();
    for (const [entryName, body] of Object.entries(filesMap)) {
        zip.addFile(entryName, Buffer.from(body, 'utf8'));
    }
    return zip.toBuffer();
}

describe('Archive Upload & GitHub Import Secret File Blacklist (.env, .env.*, .pem, .key)', () => {
    const tempDirs = [];

    afterAll(async () => {
        for (const dir of tempDirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
    });

    test('blocks .env, sub/.env, .env.local, .env.production, .pem, and .key in ZIP archives', async () => {
        for (const blockedPath of ['.env', 'sub/.env', '.env.local', 'backend/.env.production', 'certs/cert.pem', 'keys/id_rsa.key']) {
            const zipBuf = createZipBuffer({
                [blockedPath]: 'SENSITIVE_VALUE=12345\n',
                'package.json': '{"name":"sample"}\n',
            });
            await expect(scanArchiveBomb(zipBuf, 'project.zip')).rejects.toThrow(
                `Disallowed file detected: ${blockedPath}`,
            );
        }
    });

    test('allows .env.example, .env.sample, and .env.template at root and subdirectories', async () => {
        const zipBuf = createZipBuffer({
            '.env.example': 'GEMINI_API_KEY=\n',
            'server/.env.sample': 'DATABASE_URL=\n',
            'client/.env.template': 'VITE_API_URL=\n',
            'src/env.js': 'export const port = 3000;\n',
        });
        await expect(scanArchiveBomb(zipBuf, 'safe-project.zip')).resolves.toBeUndefined();
    });

    test('throws when a disallowed secret file cannot be removed', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-purge-failure-'));
        tempDirs.push(workspace);
        await fs.writeFile(path.join(workspace, '.env'), 'SECRET=1');
        const originalRm = syncFs.rmSync;
        const spy = jest.spyOn(syncFs, 'rmSync').mockImplementation((file, options) => {
            if (path.basename(file) === '.env') throw new Error('Permission denied');
            return originalRm(file, options);
        });
        try {
            expect(() => purgeDisallowedSecretFiles(workspace)).toThrow('Could not remove disallowed secret file: .env');
        } finally {
            spy.mockRestore();
        }
    });

    test('applies identical basename rules to Windows backslash paths and cloned GitHub workspaces', async () => {
        expect(isDisallowedSecretFile('apps\\server\\.env')).toBe(true);
        expect(isDisallowedSecretFile('apps\\server\\.env.local')).toBe(true);
        expect(isDisallowedSecretFile('apps\\server\\.env.example')).toBe(false);

        const cloneWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-upload-sec-'));
        tempDirs.push(cloneWorkspace);
        await fs.mkdir(path.join(cloneWorkspace, 'sub'), { recursive: true });
        await fs.writeFile(path.join(cloneWorkspace, '.env'), 'SECRET=1');
        await fs.writeFile(path.join(cloneWorkspace, 'sub/.env'), 'SECRET=2');
        await fs.writeFile(path.join(cloneWorkspace, '.env.local'), 'SECRET=3');
        await fs.writeFile(path.join(cloneWorkspace, '.env.example'), 'SECRET=');

        const purged = purgeDisallowedSecretFiles(cloneWorkspace);
        expect(purged).toHaveLength(3);
        await expect(fs.access(path.join(cloneWorkspace, '.env'))).rejects.toThrow();
        await expect(fs.access(path.join(cloneWorkspace, 'sub/.env'))).rejects.toThrow();
        await expect(fs.access(path.join(cloneWorkspace, '.env.local'))).rejects.toThrow();
        await expect(fs.access(path.join(cloneWorkspace, '.env.example'))).resolves.toBeUndefined();
    });
});
