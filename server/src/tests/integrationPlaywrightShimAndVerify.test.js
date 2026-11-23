import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import babel from '@babel/core';
import {
  prepareExpressEntriesForSupertest,
  adaptPlaywrightApiCodeForJest,
} from '../services/supertestCoverageJob.service.js';
import {
  harvestApiDeepContext,
  buildIntegrationRepairPrompt,
} from '../services/integrationAiTestGenerator.service.js';
import { detectIntegrationFrameworks } from '../services/integrationDetection.service.js';

describe('Integration ESM Express entry prep & Playwright API shim', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-pw-shim-'));
    fs.mkdirSync(path.join(tempRoot, 'server', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'server', 'node_modules', 'supertest'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'tests', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, 'server', 'package.json'),
      JSON.stringify({ name: 'server', type: 'module' }, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempRoot, 'server', 'node_modules', 'supertest', 'index.js'),
      'module.exports = () => ({});\n',
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('exports express app from server/src/index.js even when export { io } already exists, and restores cleanly', async () => {
    const entryPath = path.join(tempRoot, 'server', 'src', 'index.js');
    const originalEntry = [
      'import express from "express";',
      'import http from "http";',
      'const app = express();',
      'const server = http.createServer(app);',
      'const io = { emit() {} };',
      'cleanupHangingSessions();',
      'server.listen(5000, () => {});',
      'export { io };',
    ].join('\n');
    fs.writeFileSync(entryPath, originalEntry, 'utf8');

    const restore = await prepareExpressEntriesForSupertest(tempRoot);
    try {
      const staged = fs.readFileSync(entryPath, 'utf8');
      expect(staged).toContain('export default app;');
      expect(staged).toContain('export { app };');
      expect(staged).toContain('if (!process.env.JEST_WORKER_ID)');
      expect(() => babel.parseSync(staged, { sourceType: 'module' })).not.toThrow();
    } finally {
      restore();
    }

    expect(fs.readFileSync(entryPath, 'utf8')).toBe(originalEntry);
  });

  it('generates an ESM .mjs Playwright API shim resolving server/src/index.js and server/node_modules/supertest', () => {
    const entryPath = path.join(tempRoot, 'server', 'src', 'index.js');
    fs.writeFileSync(entryPath, 'import express from "express"; export default express();\n', 'utf8');

    const testFilePath = path.join(tempRoot, 'tests', 'api', 'api-integration.spec.js');
    const pwCode = `import { test, expect } from '@playwright/test';\ntest('GET /', async ({ request }) => { await request.get('/'); });`;
    const adapted = adaptPlaywrightApiCodeForJest(pwCode, tempRoot, testFilePath);

    const shimPath = path.join(tempRoot, '.covai-temp', 'playwright-api-shim.mjs');
    expect(fs.existsSync(shimPath)).toBe(true);
    expect(adapted).toContain('playwright-api-shim.mjs');

    const shimContent = fs.readFileSync(shimPath, 'utf8');
    expect(shimContent).toContain('../server/src/index.js');
    expect(shimContent).toContain('server/node_modules/supertest');
    expect(shimContent).toContain('export { testFn as test, expectProxy as expect, pwRequest as request };');
  });

  it('harvests full controller snippet and imported service dependencies, and builds repair prompt', () => {
    const sourceCode = [
      {
        path: 'server/src/controllers/ai.controller.js',
        content: [
          'import AIService from "../services/ai.service.js";',
          'export const summarize = async (req, res) => {',
          '  const { content } = req.body;',
          '  if (!content) return res.status(400).json({ error: "Missing" });',
          '  const result = await AIService.summarizeAndClassify(content);',
          '  return res.status(200).json({ summary: result.summary });',
          '};',
        ].join('\n'),
      },
      {
        path: 'server/src/services/ai.service.js',
        content: 'export default { async summarizeAndClassify(text) { return { summary: "ok", topics: ["news"] }; } };',
      },
    ];

    const deepCtx = harvestApiDeepContext({
      endpoint: {
        method: 'POST',
        path: '/summarize',
        controllerFile: 'server/src/controllers/ai.controller.js',
      },
      sourceCode,
    });

    expect(deepCtx.importedModules).toHaveLength(1);
    expect(deepCtx.importedModules[0].filePath).toBe('server/src/services/ai.service.js');

    const repairPrompt = buildIntegrationRepairPrompt({
      code: 'it("works", () => {});',
      failureSummary: 'Expected 200, received 500',
      framework: 'supertest',
      endpoints: [{ method: 'POST', path: '/summarize', controllerFile: 'server/src/controllers/ai.controller.js' }],
      sourceCode,
    });
    expect(repairPrompt).toContain('Expected 200, received 500');
    expect(repairPrompt).toContain('server/src/services/ai.service.js');
  });

  it('detects Supertest from server/package.json even when root package.json has Playwright', async () => {
    fs.writeFileSync(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'monorepo', devDependencies: { '@playwright/test': '^1.40.0' } }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempRoot, 'server', 'package.json'),
      JSON.stringify({
        name: 'server',
        type: 'module',
        devDependencies: { supertest: '^7.0.0', jest: '^30.0.0' },
      }),
      'utf8',
    );
    fs.mkdirSync(path.join(tempRoot, 'server', 'tests', 'integration'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, 'server', 'tests', 'integration', 'health.test.js'),
      `import request from 'supertest';\nimport app from '../../src/index.js';\nit('ok', () => request(app).get('/'));`,
      'utf8',
    );

    const det = await detectIntegrationFrameworks(tempRoot);
    expect(det.primaryFramework).toBe('supertest');
    expect(det.targetFramework).toBe('supertest');
    expect(det.permutationDetails.targetFramework).toBe('supertest');
  });
});
