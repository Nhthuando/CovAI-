import express from 'express';
import request from 'supertest';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

await jest.unstable_mockModule('../config/prisma.js', () => ({ default: {} }));
const { createAssessmentControllers } = await import('../controllers/systemAssessment.controller.js');
const client = { projectSnapshot: { findFirst: jest.fn() }, systemTestAssessment: { findFirst: jest.fn() }, systemRequirementRevision: { findFirst: jest.fn() }, systemTestProposal: { findFirst: jest.fn() } };
const redis = { set: jest.fn().mockResolvedValue('OK'), eval: jest.fn().mockResolvedValue(1), get: jest.fn() };
const controllers = createAssessmentControllers({ client, queue: async () => ({ jobQueue: { client: Promise.resolve(redis) } }) });
const app = express(); app.use(express.json());
app.use((req, res, next) => { if (!req.headers['x-user']) return res.status(401).end(); req.user = { id: req.headers['x-user'] }; next(); });
app.get('/:snapshotId/assessment/:assessmentId', controllers.get);
app.post('/:snapshotId/requirements/:revisionId/confirm', controllers.confirmRequirements);
app.get('/:snapshotId/proposals/:proposalId', controllers.proposal);
beforeEach(() => { jest.clearAllMocks(); process.env.SYSTEM_ASSESSMENT_ENABLED = 'true'; });
describe('Evidence authorization boundaries', () => {
    it('requires authentication', async () => { expect((await request(app).get('/snapshot/assessment/foreign')).status).toBe(401); });
    it('scopes the parent snapshot to the authenticated owner', async () => {
        client.projectSnapshot.findFirst.mockResolvedValueOnce(null);
        expect((await request(app).get('/snapshot/assessment/foreign').set('x-user', 'owner')).status).toBe(404);
        expect(client.projectSnapshot.findFirst).toHaveBeenCalledWith({ where: { id: 'snapshot', project: { ownerId: 'owner' } } });
        expect(client.systemTestAssessment.findFirst).not.toHaveBeenCalled();
    });
    it('does not disclose assessments or proposals from another snapshot', async () => {
        client.projectSnapshot.findFirst.mockResolvedValue({ id: 'snapshot', rootDir: '/not-used' });
        client.systemTestAssessment.findFirst.mockResolvedValueOnce(null);
        client.systemTestProposal.findFirst.mockResolvedValueOnce(null);
        expect((await request(app).get('/snapshot/assessment/foreign').set('x-user', 'owner')).status).toBe(404);
        expect((await request(app).get('/snapshot/proposals/foreign').set('x-user', 'owner')).status).toBe(404);
        expect(client.systemTestProposal.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', snapshotId: 'snapshot' } });
    });
    it('cannot confirm a foreign revision', async () => {
        client.projectSnapshot.findFirst.mockResolvedValueOnce({ id: 'snapshot' });
        client.systemRequirementRevision.findFirst.mockResolvedValueOnce(null);
        expect((await request(app).post('/snapshot/requirements/foreign/confirm').set('x-user', 'owner').send({ expectedContentHash: 'hash' })).status).toBe(404);
        expect(client.systemRequirementRevision.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', snapshotId: 'snapshot' } });
    });
});
