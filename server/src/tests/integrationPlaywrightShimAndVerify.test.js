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
  buildIntegrationTestPrompt,
  buildIntegrationRepairPrompt,
} from '../services/integrationAiTestGenerator.service.js';
import { detectIntegrationFrameworks } from '../services/integrationDetection.service.js';
import {
  resolveAppImportPath,
  resolveRelativeProjectImports,
} from '../services/aiTestStorage.service.js';

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

  it('rewrites broken relative ESM imports and jest.unstable_mockModule paths in monorepos to server/src/...', () => {
    fs.mkdirSync(path.join(tempRoot, 'server', 'src', 'config'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'server', 'src', 'services'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'server', 'src', 'index.js'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'server', 'src', 'config', 'prisma.js'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'server', 'src', 'services', 'ai.service.js'), 'export default {};\n', 'utf8');

    const testCode = [
      'import { jest } from "@jest/globals";',
      'await jest.unstable_mockModule("../../src/config/prisma.js", () => ({ default: {} }));',
      'await jest.unstable_mockModule("../../src/services/ai.service.js", () => ({ default: {} }));',
      'const { default: app } = await import("../../src/index.js");',
    ].join('\n');

    const rootTestPath = path.join(tempRoot, 'tests', 'integration', 'api-integration.test.js');
    const resolvedFromRoot = resolveAppImportPath(testCode, tempRoot, rootTestPath);
    expect(resolvedFromRoot).toContain('../../server/src/config/prisma.js');
    expect(resolvedFromRoot).toContain('../../server/src/services/ai.service.js');
    expect(resolvedFromRoot).toContain('../../server/src/index.js');

    const serverTestPath = path.join(tempRoot, 'server', 'tests', 'integration', 'api-integration.test.js');
    const resolvedFromServer = resolveRelativeProjectImports(testCode, tempRoot, serverTestPath);
    expect(resolvedFromServer).toContain('../../src/config/prisma.js');
    expect(resolvedFromServer).toContain('../../src/services/ai.service.js');
  });

  it('embeds monorepo targetFilePath in both generation and repair prompts', () => {
    const endpoints = [{ method: 'GET', path: '/', controllerFile: 'server/src/index.js' }];
    const genPrompt = buildIntegrationTestPrompt({
      endpoints,
      framework: 'supertest',
      targetFilePath: 'server/tests/integration/api-integration.test.js',
    });
    expect(genPrompt).toContain('server/tests/integration/api-integration.test.js');

    const repairPrompt = buildIntegrationRepairPrompt({
      code: 'it("works", () => {});',
      failureSummary: 'Module not found',
      framework: 'supertest',
      endpoints,
      targetFilePath: 'server/tests/integration/api-integration.test.js',
    });
    expect(repairPrompt).toContain('server/tests/integration/api-integration.test.js');
  });

  it('includes Express entry file, route definitions, and 2-hop imported services in generation and repair prompts', () => {
    const sourceCode = [
      {
        path: 'server/src/index.js',
        content: 'import express from "express";\nimport aiRoutes from "./routes/ai.routes.js";\nconst app = express();\napp.use(aiRoutes);\n',
      },
      {
        path: 'server/src/routes/ai.routes.js',
        content: 'import express from "express";\nimport AIController from "../controllers/ai.controller.js";\nconst r = express.Router();\nr.post("/summarize", AIController.summarize);\nexport default r;\n',
      },
      {
        path: 'server/src/controllers/ai.controller.js',
        content: 'import AIService from "../services/ai.service.js";\nexport default { async summarize(req, res) { const x = await AIService.run(); return res.status(200).json(x); } };',
      },
      {
        path: 'server/src/services/ai.service.js',
        content: 'import helper from "../utils/text.util.js";\nexport default { async run() { return helper.clean(); } };',
      },
      {
        path: 'server/src/utils/text.util.js',
        content: 'export default { clean() { return { summary: "ok" }; } };',
      },
    ];
    const endpoints = [
      {
        method: 'POST',
        path: '/summarize',
        fullPath: '/summarize',
        sourceFile: 'server/src/routes/ai.routes.js',
        controllerFile: 'server/src/controllers/ai.controller.js',
      },
    ];

    const deepCtx = harvestApiDeepContext({ endpoint: endpoints[0], sourceCode });
    expect(deepCtx.importedModules.map((m) => m.filePath)).toContain('server/src/services/ai.service.js');
    expect(deepCtx.importedModules.map((m) => m.filePath)).toContain('server/src/utils/text.util.js');

    const genPrompt = buildIntegrationTestPrompt({
      endpoints,
      sourceCode,
      framework: 'supertest',
      targetFilePath: 'server/tests/integration/api-integration.test.js',
    });
    expect(genPrompt).toContain('server/src/index.js');
    expect(genPrompt).toContain('app.use(aiRoutes)');
    expect(genPrompt).toContain('POST /summarize');

    const repairPrompt = buildIntegrationRepairPrompt({
      code: 'it("POST /api/summarize", () => {});',
      failureSummary: 'Expected 200, got 404',
      framework: 'supertest',
      endpoints,
      sourceCode,
      targetFilePath: 'server/tests/integration/api-integration.test.js',
      missingCases: [{ method: 'POST', path: '/summarize', missingLabels: ['Happy Path (200/201)'] }],
      unexpectedPaths: [{ method: 'POST', path: '/api/summarize', testName: 'POST /api/summarize' }],
    });
    expect(repairPrompt).toContain('server/src/index.js');
    expect(repairPrompt).toContain('MISSING REQUIRED ENDPOINTS/CASES');
    expect(repairPrompt).toContain('POST /api/summarize');
  });
});
