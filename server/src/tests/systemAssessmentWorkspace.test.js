import { describe, expect, it, jest } from '@jest/globals';
import { acquireSnapshotLease } from '../services/systemAssessmentWorkspace.service.js';
describe('Snapshot lease ownership', () => {
    it('rejects concurrent acquisition and cannot delete a successor lease', async () => {
        let value = null;
        const redis = {
            set: jest.fn(async (_key, token) => { if (value) return null; value = token; return 'OK'; }),
            get: jest.fn(async () => value),
            eval: jest.fn(async (script, _n, _key, token) => { if (value !== token) return 0; if (script.includes("'del'")) value = null; return 1; }),
        };
        const first = await acquireSnapshotLease({ redis, snapshotId: 'snapshot' });
        await expect(acquireSnapshotLease({ redis, snapshotId: 'snapshot' })).rejects.toMatchObject({ statusCode: 409 });
        value = 'successor';
        await expect(first.assertHeld()).rejects.toMatchObject({ statusCode: 409 });
        await first.release();
        expect(value).toBe('successor');
    });

    it('copies sibling frontend into workspace when snapshot rootDir is a backend package in a repo', async () => {
        const { createAssessmentWorkspace } = await import('../services/systemAssessmentWorkspace.service.js');
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-sibling-repo-'));
        try {
            fs.mkdirSync(path.join(repo, '.git'));
            fs.mkdirSync(path.join(repo, 'server'));
            fs.writeFileSync(path.join(repo, 'server', 'package.json'), JSON.stringify({ name: 'server', scripts: { dev: 'node index.js' } }));
            fs.writeFileSync(path.join(repo, 'server', 'index.js'), 'console.log("server");');
            fs.mkdirSync(path.join(repo, 'client', 'src'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'client', 'package.json'), JSON.stringify({ name: 'client', scripts: { dev: 'vite' } }));
            fs.writeFileSync(path.join(repo, 'client', 'src', 'App.jsx'), 'export default () => "app";');

            const { resolveFrontendAutDirectory } = await import('../services/systemTestRunner.service.js');
            const ws = createAssessmentWorkspace({ rootDir: path.join(repo, 'server') });
            try {
                expect(fs.existsSync(path.join(ws.rootDir, 'package.json'))).toBe(true);
                expect(fs.existsSync(path.join(ws.rootDir, 'client', 'package.json'))).toBe(true);
                expect(fs.existsSync(path.join(ws.rootDir, 'client', 'src', 'App.jsx'))).toBe(true);
                expect(ws.files.some(f => f.path === 'client/src/App.jsx')).toBe(true);
                expect(resolveFrontendAutDirectory(ws.rootDir)).toBe(path.join(ws.rootDir, 'client'));
            } finally {
                ws.release();
            }
        } finally {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
});
