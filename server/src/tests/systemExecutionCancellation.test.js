import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from '@jest/globals';
import { dockerRunner } from '../services/dockerRunner.service.js';
describe('Assessment execution cancellation', () => {
    it('kills a running owned process and rejects without publishing successful results', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-cancel-test-'));
        const controller = new AbortController();
        try {
            fs.writeFileSync(path.join(root, 'wait.mjs'), 'setInterval(()=>{},1000);');
            const pending = dockerRunner.run({ snapshotPath: root, command: `"${process.execPath}" "wait.mjs"`, forceHost: true, timeoutMs: 5000, signal: controller.signal });
            setTimeout(() => controller.abort(), 200);
            await expect(pending).rejects.toMatchObject({ statusCode: 409 });
        } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    });
});
