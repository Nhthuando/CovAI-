import { runSupertest } from '../services/supertestRunner.service.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('supertestCoverage.service', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cov-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should return coverage directory path', async () => {
        // Mock dockerRunner
        const { dockerRunner } = await import('../services/dockerRunner.service.js');
        const originalRun = dockerRunner.run;
        dockerRunner.run = async () => ({ success: true, exitCode: 0 });

        try {
            const result = await runSupertest('job1', tempDir, null, [path.join(tempDir, 'api.test.js')]);
            expect(result.coverageDir).toBe(path.join(tempDir, 'coverage'));
        } finally {
            dockerRunner.run = originalRun;
        }
    }, 15000);
});
