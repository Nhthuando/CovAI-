import { jest } from '@jest/globals';
import { versionWithPreparation } from '../services/aiEvaluation/management.service.js';

const projectId = 'project-1';
const versionId = 'cmwnjffrn0004787k6j9rdc3i';
const jobId = 'job-1';

function fakeDb({ versionStatus = 'DRAFT', jobStatus = 'SUCCESS', jobRevision = 1 } = {}) {
    return {
        aiEvaluationProfileVersion: {
            findFirst: jest.fn().mockResolvedValue({ id: versionId, status: versionStatus, revision: 1, cases: [] }),
        },
        job: {
            findFirst: jest.fn().mockResolvedValue({
                id: jobId,
                status: jobStatus,
                payloadJson: JSON.stringify({ profileVersionId: versionId, revision: jobRevision }),
            }),
        },
    };
}

test('returns the successful preparation for the current draft revision', async () => {
    const version = await versionWithPreparation(fakeDb(), projectId, versionId);

    expect(version.latestPreparation).toEqual({ id: jobId, status: 'SUCCESS' });
});

test('ignores a successful preparation for a stale revision', async () => {
    const version = await versionWithPreparation(fakeDb({ jobRevision: 0 }), projectId, versionId);

    expect(version.latestPreparation).toBeNull();
});

test('ignores a failed preparation', async () => {
    const version = await versionWithPreparation(fakeDb({ jobStatus: 'FAILED' }), projectId, versionId);

    expect(version.latestPreparation).toBeNull();
});

test('skips the preparation lookup for an approved version', async () => {
    const db = fakeDb({ versionStatus: 'APPROVED' });
    const version = await versionWithPreparation(db, projectId, versionId);

    expect(version.latestPreparation).toBeNull();
    expect(db.job.findFirst).not.toHaveBeenCalled();
});
