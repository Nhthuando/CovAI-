import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const getJobById = jest.fn();
const updateJobStatus = jest.fn();
const qualityAi = jest.fn();
const localScan = jest.fn();
const aiScan = jest.fn();
const qualityWrite = jest.fn();
const removeFindings = jest.fn();
const createFindings = jest.fn();
const pending = [];
let root, preparedRoot, canonicalRoot;
const prisma = {
    projectSnapshot: { findUnique: jest.fn() },
    coverageSummary: { findUnique: jest.fn(async () => null) },
    cyclomatic: { findMany: jest.fn(async () => [{ filePath: 'app.js', value: 8 }, { filePath: '../outside.js', value: 9 }]) },
    coverageFunction: { findMany: jest.fn(async () => []) },
    projectStructureAnalysis: { findUnique: jest.fn(async () => null) },
    qualityReport: { upsert: qualityWrite },
    vulnerability: { deleteMany: removeFindings, createMany: createFindings },
};
await jest.unstable_mockModule('../config/prisma.js', () => ({ default: prisma }));
await jest.unstable_mockModule('../services/job.service.js', () => ({ getJobById, addJobLog: jest.fn() }));
await jest.unstable_mockModule('../services/jobUpdate.service.js', () => ({ updateJobStatus }));
await jest.unstable_mockModule('../services/qualityAiAnalysis.service.js', () => ({ runQualityAiAnalysis: qualityAi }));
await jest.unstable_mockModule('../services/securityScanner.service.js', () => ({ scanLocalVulnerabilities: localScan, scanAiVulnerabilities: aiScan }));
await jest.unstable_mockModule('../services/projectOperationWorkspace.service.js', () => ({
    operationSnapshot: snapshot => ({ ...snapshot, rootDir: preparedRoot }),
    stagePreparedPublication: async run => { pending.push(run); },
}));
const { processQualityAnalysisJob } = await import('../services/qualityAnalysisJob.service.js');
const { processSecurityAnalysisJob } = await import('../services/securityScanJob.service.js');

describe('quality/security computation before guarded publication', () => {
    beforeEach(() => {
        jest.clearAllMocks(); pending.length = 0;
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-static-publication-'));
        preparedRoot = path.join(root, 'prepared'); canonicalRoot = path.join(root, 'canonical');
        fs.mkdirSync(preparedRoot); fs.mkdirSync(canonicalRoot);
        fs.writeFileSync(path.join(preparedRoot, 'app.js'), 'const privateSource = 1;');
        fs.writeFileSync(path.join(canonicalRoot, 'app.js'), 'const canonicalSource = 2;');
        fs.writeFileSync(path.join(root, 'outside.js'), 'PRIVATE_HOST_SECRET');
        getJobById.mockResolvedValue({ id: 'job', snapshotId: 'snapshot', projectId: 'project', userId: 'actor' });
        prisma.projectSnapshot.findUnique.mockResolvedValue({ id: 'snapshot', rootDir: canonicalRoot });
        qualityAi.mockResolvedValue({ securityScore: 80, securityDetails: {}, debugReport: {}, recommendations: [], aiAvailable: true, aiError: null });
        localScan.mockReturnValue([{ type: 'UNSAFE_CALL', severity: 'HIGH', file: 'app.js', line: 1, description: 'fixture' }]);
        aiScan.mockResolvedValue([]);
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('quality reads the captured workspace and excludes paths outside it; report is deferred', async () => {
        await processQualityAnalysisJob('job');
        expect(qualityAi.mock.calls[0][0].sourceFiles).toEqual([{ path: 'app.js', content: 'const privateSource = 1;' }]);
        expect(qualityWrite).not.toHaveBeenCalled();
        expect(pending).toHaveLength(1);
        await pending[0](prisma);
        expect(qualityWrite).toHaveBeenCalledWith(expect.objectContaining({ where: { snapshotId: 'snapshot' } }));
    });

    test('security reads the captured workspace and replaces findings only on publication', async () => {
        await processSecurityAnalysisJob('job');
        expect(localScan).toHaveBeenCalledWith([{ path: 'app.js', content: 'const privateSource = 1;' }]);
        expect(removeFindings).not.toHaveBeenCalled();
        expect(createFindings).not.toHaveBeenCalled();
        expect(pending).toHaveLength(1);
        await pending[0](prisma);
        expect(removeFindings).toHaveBeenCalledWith({ where: { snapshotId: 'snapshot' } });
        expect(createFindings).toHaveBeenCalledWith({ data: [expect.objectContaining({ snapshotId: 'snapshot', type: 'UNSAFE_CALL' })] });
    });
});
