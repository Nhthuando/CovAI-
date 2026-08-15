import { jest } from '@jest/globals';
import { runSupertest } from '../services/supertestRunner.service.js';
import { dockerRunner } from '../services/dockerRunner.service.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('supertestRunner.service', () => {
    let tempDir;
    const originalRun = dockerRunner.run;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supertest-runner-'));
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'api.test.js'), "import request from 'supertest';");
    });

    afterEach(() => {
        dockerRunner.run = originalRun;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('executes supertest in CI with coverage and the detected file list', async () => {
        dockerRunner.run = jest.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

        const file = path.join(tempDir, 'src', 'api.test.js');
        const result = await runSupertest('job1', tempDir, null, [file]);

        expect(result.exitCode).toBe(0);
        expect(dockerRunner.run).toHaveBeenCalledTimes(1);
        const command = dockerRunner.run.mock.calls[0][0].command;
        expect(command).toContain('CI=true NODE_ENV=test');
        expect(command).toContain('--runInBand');
        expect(command).toContain('--coverage');
        expect(command).toContain('--coverageReporters=json-summary');
        expect(command).toContain('src/api.test.js');
    });

    test('invokes Jest with Node ESM support for module-based projects', async () => {
        dockerRunner.run = jest.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));

        const file = path.join(tempDir, 'src', 'api.test.js');
        await runSupertest('job1', tempDir, null, [file]);

        const command = dockerRunner.run.mock.calls[0][0].command;
        expect(command).toContain('node --experimental-vm-modules');
        expect(command).toContain('./node_modules/jest/bin/jest.js');
    });

    test('rejects missing or invalid project roots', async () => {
        await expect(runSupertest('job1', '', null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('Project root');
        await expect(runSupertest('job1', path.join(tempDir, 'missing-root'), null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('Project root');
    });

    test('rejects path traversal attempts and empty file lists', async () => {
        await expect(runSupertest('job1', tempDir, null, [])).rejects.toThrow('No Supertest test files');
        await expect(runSupertest('job1', tempDir, null, [path.join(tempDir, '..', 'outside.test.js')])).rejects.toThrow('outside the project root');
    });

    test('throws when the Docker runner reports a failed test run', async () => {
        dockerRunner.run = jest.fn().mockResolvedValue({ success: false, exitCode: 1, stdout: 'failed', stderr: '' });

        await expect(runSupertest('job1', tempDir, null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('Integration tests failed');
    });

    test('surfaces timeout and docker errors from the runner', async () => {
        dockerRunner.run = jest.fn().mockRejectedValue(new Error('Execution timed out after 300000ms'));
        await expect(runSupertest('job1', tempDir, null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('timed out');
    });
});
