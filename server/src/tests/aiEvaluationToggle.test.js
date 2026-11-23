import { describe, test, expect, afterEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const { createEvaluationRouter } = await import('../routes/aiEvaluation.route.js');

function createToggleDb() {
  const settingsStore = new Map();
  return {
    project: {
      findFirst: jest.fn(async ({ where }) => ({
        id: where.id,
        name: 'Demo Project',
        ownerId: 'user-owner',
      })),
    },
    projectMember: {
      findUnique: jest.fn(async () => null),
    },
    user: {
      findUnique: jest.fn(async ({ where }) => ({
        id: where.id,
        aiUsageDate: null,
        aiUsageCount: 0,
      })),
    },
    aiEvaluationProjectSettings: {
      findUnique: jest.fn(async ({ where }) => settingsStore.get(where.projectId) || null),
      upsert: jest.fn(async ({ where, create, update }) => {
        const existing = settingsStore.get(where.projectId);
        const next = existing
          ? { ...existing, settings: update.settings, revision: (existing.revision || 1) + 1 }
          : { projectId: where.projectId, revision: 1, settings: create.settings };
        settingsStore.set(where.projectId, next);
        return next;
      }),
    },
  };
}

function buildApp(db, roleUserId = 'user-owner') {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/ai-evaluations', createEvaluationRouter({
    db,
    auth: (req, _res, next) => {
      req.user = { id: roleUserId };
      next();
    },
  }));
  return app;
}

describe('Chatbot Evaluation project ON/OFF toggle', () => {
  const prevEnv = process.env.AI_EVALUATION_ENABLED;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.AI_EVALUATION_ENABLED;
    else process.env.AI_EVALUATION_ENABLED = prevEnv;
  });

  test('allows turning ON in UI tab even when AI_EVALUATION_ENABLED is unset in .env', async () => {
    delete process.env.AI_EVALUATION_ENABLED;
    const db = createToggleDb();
    const app = buildApp(db);

    const initialCaps = await request(app).get('/api/projects/proj-1/ai-evaluations/capabilities');
    expect(initialCaps.status).toBe(200);
    expect(initialCaps.body.data.enabled).toBe(true);
    expect(initialCaps.body.data.projectEnabled).toBe(false);

    const blockedWhileOff = await request(app).get('/api/projects/proj-1/ai-evaluations/targets');
    expect(blockedWhileOff.status).toBe(503);
    expect(blockedWhileOff.body.code).toBe('FEATURE_DISABLED');

    const turnOn = await request(app)
      .patch('/api/projects/proj-1/ai-evaluations/settings/toggle')
      .send({ enabled: true });
    expect(turnOn.status).toBe(200);
    expect(turnOn.body.data.projectEnabled).toBe(true);

    const capsAfterOn = await request(app).get('/api/projects/proj-1/ai-evaluations/capabilities');
    expect(capsAfterOn.status).toBe(200);
    expect(capsAfterOn.body.data.projectEnabled).toBe(true);
  });

  test('defaults projectEnabled to true when AI_EVALUATION_ENABLED=true and persists OFF/ON toggles', async () => {
    process.env.AI_EVALUATION_ENABLED = 'true';
    const db = createToggleDb();
    const app = buildApp(db);

    const initialCaps = await request(app).get('/api/projects/proj-2/ai-evaluations/capabilities');
    expect(initialCaps.status).toBe(200);
    expect(initialCaps.body.data.enabled).toBe(true);
    expect(initialCaps.body.data.projectEnabled).toBe(true);

    const turnOff = await request(app)
      .patch('/api/projects/proj-2/ai-evaluations/settings/toggle')
      .send({ enabled: false });
    expect(turnOff.status).toBe(200);
    expect(turnOff.body.data.projectEnabled).toBe(false);

    const badPayload = await request(app)
      .patch('/api/projects/proj-2/ai-evaluations/settings/toggle')
      .send({ enabled: 'yes' });
    expect(badPayload.status).toBe(400);
  });
});
