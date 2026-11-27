import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.unstable_mockModule('../services/job.service.js', () => ({
    addJobLog: jest.fn().mockResolvedValue({}),
}));

const { runSupertest } = await import('../services/supertestRunner.service.js');
const { dockerRunner } = await import('../services/dockerRunner.service.js');

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

    test('executes supertest in CI with coverage, setup file, and the detected file list', async () => {
        dockerRunner.run = jest.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

        const file = path.join(tempDir, 'src', 'api.test.js');
        const result = await runSupertest('job1', tempDir, null, [file]);

        expect(result.exitCode).toBe(0);
        expect(dockerRunner.run).toHaveBeenCalledTimes(1);
        const runOptions = dockerRunner.run.mock.calls[0][0];
        expect(runOptions.env).toEqual(expect.objectContaining({ CI: 'true', NODE_ENV: 'test' }));
        expect(runOptions.command).toContain('--runInBand');
        expect(runOptions.command).toContain('--coverage');
        expect(runOptions.command).toContain('--coverageReporters=json-summary');
        expect(runOptions.command).toContain('--setupFilesAfterEnv=');
        expect(runOptions.command).toContain('src/api.test.js');
    });

    test('invokes Jest with Node ESM support for module-based projects', async () => {
        dockerRunner.run = jest.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));

        const file = path.join(tempDir, 'src', 'api.test.js');
        await runSupertest('job1', tempDir, null, [file]);

        const runOptions = dockerRunner.run.mock.calls[0][0];
        expect(runOptions.env.NODE_OPTIONS).toContain('--experimental-vm-modules');
        expect(runOptions.command).toContain('npx --no-install jest');
        expect(runOptions.command).not.toMatch(/node(?:\.exe)?["']?\s+--experimental-vm-modules\s+npx/);
    });

    test('rejects missing or invalid project roots', async () => {
        await expect(runSupertest('job1', '', null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('Project root');
        await expect(runSupertest('job1', path.join(tempDir, 'missing-root'), null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('Project root');
    });

    test('rejects path traversal attempts and empty file lists', async () => {
        await expect(runSupertest('job1', tempDir, null, [])).rejects.toThrow('No Supertest test files');
        await expect(runSupertest('job1', tempDir, null, [path.join(tempDir, '..', 'outside.test.js')])).rejects.toThrow('outside the project root');
    });

    test('throws when the Docker runner process terminates unexpectedly', async () => {
        dockerRunner.run = jest.fn().mockResolvedValue({ success: false, exitCode: null, stdout: '', stderr: 'terminated' });

        await expect(runSupertest('job1', tempDir, null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('Integration tests failed');
    });

    test('returns execution details with non-zero exit code when assertions fail', async () => {
        dockerRunner.run = jest.fn().mockResolvedValue({ success: false, exitCode: 1, stdout: 'failed', stderr: '' });

        const result = await runSupertest('job1', tempDir, null, [path.join(tempDir, 'src', 'api.test.js')]);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe('failed');
    });

    test('surfaces timeout and docker errors from the runner', async () => {
        dockerRunner.run = jest.fn().mockRejectedValue(new Error('Execution timed out after 300000ms'));
        await expect(runSupertest('job1', tempDir, null, [path.join(tempDir, 'src', 'api.test.js')])).rejects.toThrow('timed out');
    });

    test('does not leak host process.env.DATABASE_URL into project runner env when no DB is provisioned', async () => {
        const origDbUrl = process.env.DATABASE_URL;
        process.env.DATABASE_URL = 'postgresql://prod:secret@railway.internal:5432/covai';
        dockerRunner.run = jest.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });
        try {
            await runSupertest('job1', tempDir, null, [path.join(tempDir, 'src', 'api.test.js')]);
            const runOptions = dockerRunner.run.mock.calls[0][0];
            expect(runOptions.env.DATABASE_URL).toBeUndefined();
        } finally {
            if (origDbUrl === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = origDbUrl;
        }
    });

    test('supports monorepo ESM subpackages (server/) with cross-directory tests, modulePaths, and cleans ESM markers', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'mono-root' }));
        fs.mkdirSync(path.join(tempDir, 'server', 'node_modules', 'jest', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'server', 'node_modules', 'jest', 'bin', 'jest.js'), '// mock jest');
        fs.writeFileSync(path.join(tempDir, 'server', 'package.json'), JSON.stringify({ type: 'module' }));
        fs.writeFileSync(path.join(tempDir, 'server', 'jest.config.js'), 'export default { testEnvironment: "node" };');
        fs.mkdirSync(path.join(tempDir, 'server', 'tests', 'integration'), { recursive: true });
        fs.writeFileSync(
            path.join(tempDir, 'server', 'tests', 'integration', 'events.test.js'),
            "import request from 'supertest';",
        );
        fs.mkdirSync(path.join(tempDir, 'tests', 'integration'), { recursive: true });
        const rootAiTest = path.join(tempDir, 'tests', 'integration', 'ai.test.js');
        fs.writeFileSync(rootAiTest, "import request from 'supertest';");

        let markerExistedDuringRun = false;
        dockerRunner.run = jest.fn().mockImplementation(async () => {
            markerExistedDuringRun = fs.existsSync(path.join(tempDir, 'tests', 'integration', 'package.json'));
            return { success: true, exitCode: 0, stdout: '', stderr: '' };
        });

        await runSupertest('job-mono', tempDir, null, [
            rootAiTest,
            path.join(tempDir, 'server', 'tests', 'integration', 'events.test.js'),
        ]);

        const runOptions = dockerRunner.run.mock.calls[0][0];
        expect(runOptions.env.NODE_OPTIONS).toContain('--experimental-vm-modules');
        expect(runOptions.command).toContain('--experimental-vm-modules server/node_modules/jest/bin/jest.js');
        expect(runOptions.command).toContain('--config=server/jest.config.js');
        expect(runOptions.command).toContain('--roots=');
        expect(runOptions.command).toContain('--modulePaths=');
        expect(markerExistedDuringRun).toBe(true);
        expect(fs.existsSync(path.join(tempDir, 'tests', 'integration', 'package.json'))).toBe(false);
    });

    test('injects mock AI keys and sets COVAI_SKIP_STRIPE_MOCK when tests mock stripe explicitly', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
        fs.mkdirSync(path.join(tempDir, 'tests', 'integration'), { recursive: true });
        const testFile = path.join(tempDir, 'tests', 'integration', 'payments.test.js');
        fs.writeFileSync(
            testFile,
            "import { jest } from '@jest/globals';\njest.unstable_mockModule('stripe', () => ({ default: jest.fn() }));\n",
        );

        dockerRunner.run = jest.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '' });

        await runSupertest('job-stripe-mock', tempDir, null, [testFile]);

        const runOptions = dockerRunner.run.mock.calls[0][0];
        expect(runOptions.env.GEMINI_API_KEY).toBeTruthy();
        expect(runOptions.env.GOOGLE_API_KEY).toBeTruthy();
        expect(runOptions.env.COVAI_SKIP_STRIPE_MOCK).toBe('true');
    });
});
