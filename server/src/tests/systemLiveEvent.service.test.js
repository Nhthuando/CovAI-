import { describe, it, expect, jest } from '@jest/globals';
import { createSystemEventPublisher, replaySystemEvents } from '../services/systemLiveEvent.service.js';

describe('System Test live event persistence', () => {
    it('persists increasing sequences before broadcasting a redacted event', async () => {
        const rows = [];
        const client = { systemRunEvent: { findFirst: jest.fn().mockResolvedValue({ sequence: 7 }), create: jest.fn(async ({ data }) => { rows.push(data); return { id: String(data.sequence), ...data }; }), findMany: jest.fn(async ({ where }) => rows.filter(row => row.sequence > where.sequence.gt)) } };
        const emit = jest.fn(), io = { to: jest.fn(() => ({ emit })) };
        const publish = await createSystemEventPublisher({ client, assessmentId: 'assessment', snapshotId: 'snapshot', userId: 'owner', io });
        await publish({ runIndex: 1, type: 'STEP_STARTED', payload: { stepTitle: 'Checkout', authorization: 'secret', cookie: 'secret' } });
        await publish({ runIndex: 1, type: 'STEP_ENDED', payload: { status: 'PASSED' } });
        expect(rows.map(row => row.sequence)).toEqual([8, 9]);
        expect(JSON.stringify(rows)).not.toContain('secret');
        expect(io.to).toHaveBeenCalledWith('user:owner');
        expect(emit).toHaveBeenCalledTimes(2);
        const replay = await replaySystemEvents({ client, assessmentId: 'assessment', after: 8 });
        expect(replay.map(row => row.sequence)).toEqual([9]);
    });
});
