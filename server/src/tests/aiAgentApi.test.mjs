import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'agent-api-fixture-key';
const { createAiAgentRouter } = await import('../routes/aiAgent.route.js');
const app = express(); app.use('/api/ai-agents', createAiAgentRouter());
const token = jwt.sign({ userId: 'fixture-user' }, process.env.JWT_SECRET, { expiresIn: '1m' });

test('agent catalog requires authentication and exposes exactly four separate profiles', async () => {
    assert.equal((await request(app).get('/api/ai-agents')).status, 401);
    const response = await request(app).get('/api/ai-agents').auth(token, { type: 'bearer' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.map(item => item.id), ['unit-test', 'integration-test', 'system-test', 'chatbot-trustworthiness']);
    for (const item of response.body.data) {
        const detail = await request(app).get(`/api/ai-agents/${item.id}`).auth(token, { type: 'bearer' });
        assert.equal(detail.status, 200); assert.ok(detail.body.data.examples.length >= 2);
        assert.equal(detail.body.data.manifest.benchmarkHash, item.benchmarkHash);
        assert.equal(detail.body.data.manifest.strategy, 'BENCHMARK_FEW_SHOT');
    }
    assert.equal((await request(app).get('/api/ai-agents/unknown').auth(token, { type: 'bearer' })).status, 404);
});
