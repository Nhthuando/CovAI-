import { describe, it, expect, jest } from '@jest/globals';

await jest.unstable_mockModule('../config/prisma.js', () => ({ default: {} }));
const { createAssessmentControllers } = await import('../controllers/systemAssessment.controller.js');

const response = () => ({ statusCode: 200, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; }, send(body) { this.body = body; return this; } });

describe('System Test workflow endpoint ownership', () => {
    it('rejects a foreign catalog before reading any scenario', async () => {
        const client = { projectSnapshot: { findFirst: jest.fn().mockResolvedValue(null) }, systemScenario: { findMany: jest.fn() } };
        const controllers = createAssessmentControllers({ client });
        const res = response();
        await controllers.catalog({ params: { snapshotId: 'foreign' }, user: { id: 'owner' } }, res);
        expect(res.statusCode).toBe(404);
        expect(client.systemScenario.findMany).not.toHaveBeenCalled();
    });

    it('replays only events belonging to an owned assessment', async () => {
        const client = { projectSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: 'snapshot' }) }, systemTestAssessment: { findFirst: jest.fn().mockResolvedValue(null) }, systemRunEvent: { findMany: jest.fn() } };
        const controllers = createAssessmentControllers({ client });
        const res = response();
        await controllers.events({ params: { snapshotId: 'snapshot', assessmentId: 'foreign' }, query: { after: '0' }, user: { id: 'owner' } }, res);
        expect(res.statusCode).toBe(404);
        expect(client.systemRunEvent.findMany).not.toHaveBeenCalled();
    });

    it('requires a completed owned assessment for PDF export', async () => {
        const client = { projectSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: 'snapshot' }) }, systemTestAssessment: { findFirst: jest.fn().mockResolvedValue(null) }, systemRunArtifact: { findMany: jest.fn() } };
        const controllers = createAssessmentControllers({ client });
        const res = response();
        await controllers.reportPdf({ params: { snapshotId: 'snapshot', assessmentId: 'unfinished' }, user: { id: 'owner' } }, res);
        expect(res.statusCode).toBe(404);
        expect(client.systemRunArtifact.findMany).not.toHaveBeenCalled();
    });
});
