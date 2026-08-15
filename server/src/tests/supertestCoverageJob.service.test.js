import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

const markJobRunning = jest.fn();
const markJobSuccess = jest.fn();
const markJobFailed = jest.fn();
const updateJobProgress = jest.fn();
const getJobById = jest.fn();
const addJobLog = jest.fn();
const saveJobOutput = jest.fn();
const runSupertest = jest.fn();
const parseCoverageSummary = jest.fn();
const storeCoverageOutputs = jest.fn();
const parseCoverageFilesForSnapshot = jest.fn();
const parseCoverageFunctionsForSnapshot = jest.fn();

await jest.unstable_mockModule('../services/job.service.js', () => ({
    markJobRunning, markJobSuccess, markJobFailed, updateJobProgress, getJobById, addJobLog,
}));
await jest.unstable_mockModule('../services/jobOutput.service.js', () => ({ saveJobOutput }));
await jest.unstable_mockModule('../services/supertestRunner.service.js', () => ({ runSupertest }));
await jest.unstable_mockModule('../services/coverageSummaryParser.service.js', () => ({ parseCoverageSummary }));
await jest.unstable_mockModule('../services/coverageStorage.service.js', () => ({ storeCoverageOutputs }));
await jest.unstable_mockModule('../services/coverageFileParser.service.js', () => ({ parseCoverageFilesForSnapshot }));
await jest.unstable_mockModule('../services/coverageFunctionParser.service.js', () => ({ parseCoverageFunctionsForSnapshot }));

const { processSupertestCoverageJob } = await import('../services/supertestCoverageJob.service.js');

describe('supertestCoverageJob.service', () => {
    let rootDir;

    beforeEach(() => {
        jest.clearAllMocks();
        markJobRunning.mockResolvedValue(undefined);
        markJobSuccess.mockResolvedValue(undefined);
        markJobFailed.mockResolvedValue(undefined);
        updateJobProgress.mockResolvedValue(undefined);
        addJobLog.mockResolvedValue(undefined);
        saveJobOutput.mockResolvedValue(undefined);
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supertest-job-'));
        fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ devDependencies: { supertest: '^7.0.0' } }));
        fs.writeFileSync(path.join(rootDir, 'api.test.js'), "import request from 'supertest';");
        getJobById.mockResolvedValue({
            snapshot: { rootDir, jestConfigPath: null }, snapshotId: 'snap1', projectId: 'proj1', userId: 'user1',
        });
        runSupertest.mockResolvedValue({ coverageDir: path.join(rootDir, 'coverage') });
        parseCoverageSummary.mockResolvedValue({
            total: { lines: { pct: 80 }, branches: { pct: 80 }, functions: { pct: 80 }, statements: { pct: 80 } },
        });
        storeCoverageOutputs.mockResolvedValue({ baseStoragePath: 'path/to/storage' });
        parseCoverageFilesForSnapshot.mockResolvedValue(undefined);
        parseCoverageFunctionsForSnapshot.mockResolvedValue(undefined);
        fs.mkdirSync(path.join(rootDir, 'coverage'));
        fs.writeFileSync(path.join(rootDir, 'coverage', 'coverage-summary.json'), JSON.stringify({ total: {} }));
        fs.writeFileSync(path.join(rootDir, 'coverage', 'coverage-final.json'), JSON.stringify({}));
    });

    afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

    test('runs only detected Supertest files and stores its coverage result', async () => {
        await processSupertestCoverageJob('job123');

        expect(markJobRunning).toHaveBeenCalledWith('job123');
        expect(runSupertest).toHaveBeenCalledWith('job123', rootDir, null, [path.join(rootDir, 'api.test.js')]);
        expect(markJobSuccess).toHaveBeenCalledWith('job123', expect.objectContaining({
            coverage: expect.objectContaining({ lines: 80 }),
        }));
        expect(markJobFailed).not.toHaveBeenCalled();
    });


});
