import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest, afterEach, test, expect } from '@jest/globals';

const jobService = {
    markJobRunning: jest.fn(),
    markJobSuccess: jest.fn(),
    markJobFailed: jest.fn(),
    updateJobProgress: jest.fn(),
    getJobById: jest.fn()
};
await jest.unstable_mockModule('../services/job.service.js', () => jobService);
await jest.unstable_mockModule('../config/prisma.js', () => ({ default: {} }));

const { processCodeHygieneJob } = await import('../services/codeHygieneJob.service.js');

let tmp;

afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('publishes the hygiene report with paths relative to the snapshot root', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-hygiene-job-'));
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'a.js'), 'debugger;');
    jobService.getJobById.mockResolvedValueOnce({
        snapshotId: 's1',
        snapshot: { rootDir: tmp }
    });

    await processCodeHygieneJob('j1');

    expect(jobService.markJobFailed).not.toHaveBeenCalled();
    expect(jobService.markJobSuccess).toHaveBeenCalledWith('j1', expect.objectContaining({
        snapshotId: 's1',
        summary: expect.objectContaining({ totalIssues: 1 }),
        issues: [expect.objectContaining({ filePath: 'src/a.js' })]
    }));
});
