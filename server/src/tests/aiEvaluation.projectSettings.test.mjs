import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { evaluationDatabase } from './helpers/aiEvaluationDatabase.mjs';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test'; process.env.AI_EVALUATION_ENABLED = 'true'; process.env.ENCRYPTION_KEY = '44'.repeat(32);
const { getProjectSettings, saveProjectSettings, storedEnvironment } = await import('../services/aiEvaluation/projectSettings.service.js');
const { startProjectEvaluation, cancelProjectEvaluation, deleteProjectEvaluation } = await import('../services/aiEvaluation/projectEvaluation.service.js');
const { createEvaluationRouter } = await import('../routes/aiEvaluation.route.js');

test('project settings persist encrypted secrets, reuse without disclosure, support replacement/removal and enforce owner/revision scope', { timeout: 120000 }, async () => {
    const database = await evaluationDatabase(); const db = database.db;
    try {
        const owner = await db.user.create({ data: { email: 'settings@evaluation.invalid' } });
        const stranger = await db.user.create({ data: { email: 'stranger-settings@evaluation.invalid' } });
        const project = await db.project.create({ data: { name: 'Settings fixture', ownerId: owner.id } });
        const snapshot = await db.projectSnapshot.create({ data: { projectId: project.id, source: 'GITHUB', storagePath: '/fixture', rootDir: '/fixture' } });
        const app = express(); app.use(express.json()); app.use('/api/projects/:projectId/ai-evaluations', createEvaluationRouter({ db, auth: (req, _res, next) => { req.user = { id: req.headers['x-test-user'] || owner.id }; next(); } }));
        const url = `/api/projects/${project.id}/ai-evaluations/project-settings`;
        const saved = await request(app).put(url).send({ revision: 0, snapshotId: snapshot.id, judgeConsent: true, environment: { MODEL_KEY: 'fixture-private-key', FEATURE: 'on' } });
        assert.equal(saved.status, 200); assert.equal(saved.body.data.revision, 1);
        assert.ok(!JSON.stringify(saved.body).includes('fixture-private-key'));
        const stored = await db.aiEvaluationProjectSettings.findUnique({ where: { projectId: project.id } });
        assert.ok(!stored.encryptedEnvironment.includes('fixture-private-key'));
        assert.equal(storedEnvironment(stored).MODEL_KEY, 'fixture-private-key');
        const refreshed = await request(app).get(url); assert.equal(refreshed.status, 200);
        assert.deepEqual(refreshed.body.data.environmentNames, ['FEATURE', 'MODEL_KEY']); assert.equal(refreshed.body.data.judgeConsent, true);
        assert.equal((await request(app).get(url).set('x-test-user', stranger.id)).status, 404);
        assert.equal((await request(app).put(url).set('x-test-user', stranger.id).send({ revision: 1 })).status, 404);
        await assert.rejects(saveProjectSettings(db, project.id, { revision: 0 }), { code: 'SETTINGS_CONFLICT' });
        const run = await startProjectEvaluation(db, project.id, owner.id, { idempotencyKey: 'reuse-settings' }, { enqueue: async () => {} });
        const internal = await db.aiEvaluationProjectRun.findUnique({ where: { id: run.id } });
        assert.equal(storedEnvironment(internal).MODEL_KEY, 'fixture-private-key');
        assert.equal(run.configuration.judgeConsent, true);
        assert.ok(!JSON.stringify(run).includes('fixture-private-key'));
        await cancelProjectEvaluation(db, project.id, run.id); await deleteProjectEvaluation(db, project.id, run.id);
        let current = await getProjectSettings(db, project.id); assert.equal(current.environmentNames.length, 2);
        current = await saveProjectSettings(db, project.id, { revision: current.revision, snapshotId: null, environment: { MODEL_KEY: 'replacement-private-key' }, removeEnvironmentNames: ['FEATURE'] });
        assert.deepEqual(current.environmentNames, ['MODEL_KEY']);
        const row = await db.aiEvaluationProjectSettings.findUnique({ where: { projectId: project.id } }); assert.equal(storedEnvironment(row).MODEL_KEY, 'replacement-private-key');
        await db.project.delete({ where: { id: project.id } }); assert.equal(await db.aiEvaluationProjectSettings.count({ where: { projectId: project.id } }), 0);
    } finally { await database.close(); }
});
