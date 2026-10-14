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
});
