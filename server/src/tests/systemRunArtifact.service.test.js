import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from '@jest/globals';
import { inspectRunArtifact, readOwnedRunArtifact } from '../services/systemRunArtifact.service.js';

describe('System Test owned artifacts', () => {
    it('accepts a bounded PNG and detects later tampering', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-artifact-'));
        try {
            const relativePath = '.covai-system-test/evidence/one.png';
            const file = path.join(rootDir, relativePath);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
            const artifact = { kind: 'SCREENSHOT', ...inspectRunArtifact({ rootDir, relativePath, kind: 'SCREENSHOT' }) };
            expect(readOwnedRunArtifact({ rootDir, artifact }).bytes.length).toBe(9);
            fs.appendFileSync(file, Buffer.from([1]));
            expect(() => readOwnedRunArtifact({ rootDir, artifact })).toThrow(/hash mismatch/i);
            expect(() => inspectRunArtifact({ rootDir, relativePath: '../other.png', kind: 'SCREENSHOT' })).toThrow(/Unsupported/);
        } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
    });
});
