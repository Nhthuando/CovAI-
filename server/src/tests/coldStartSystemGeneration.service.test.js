import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, test, expect, jest, afterEach } from '@jest/globals';
import { harvestFrontendContext, collectSystemGenerationContext } from '../services/systemGenerationContext.service.js';
import { extractValidationFacts, buildTestDesignChecklist, formatTestDesignForPrompt } from '../services/systemValidationFacts.service.js';
import { SYSTEM_PROMPT_VERSION, SYSTEM_TEST_DESIGN_RULES, systemTestPromptRules, testDesignPromptSection } from '../services/systemTestPrompt.service.js';
import {
  ensureSystemTestConfig,
  buildColdStartSystemPrompt,
  buildVerifiedSystemPrompt,
  measureTestDesignCoverage,
  generateFallbackColdStartTest,
  generateColdStartSystemTests,
} from '../services/verifiedSystemGeneration.service.js';
import { validateGeneratedTestCode } from '../validators/aiTestCode.validator.js';
import { systemDraftModuleExtension } from '../services/systemGenerationProposal.service.js';

const tempDirs = [];
const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-coldstart-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
});

describe('systemDraftModuleExtension', () => {
  test.each([
    ['CommonJS require', "const { test, expect } = require('@playwright/test');", 'cjs'],
    ['ESM import', "import { test } from '@playwright/test'", 'mjs'],
    ['mixed import and require', "import { test } from '@playwright/test';\nconst fs = require('node:fs');", 'mjs'],
    ['empty source', '', 'mjs'],
  ])('selects the extension for %s', (_label, code, extension) => {
    expect(systemDraftModuleExtension(code)).toBe(extension);
  });
});

describe('Phase 2: Cold-Start AI System Test Generator', () => {
  describe('Validation facts and test design', () => {
    const files = [{ path: 'src/App.jsx', content: 'export default function App() { return <input name="password" minLength={8} />; }' }];
    const makeContext = () => {
      const validationFacts = extractValidationFacts({ files });
      return { sourceCode: files, routes: ['/'], uiActions: [], validationFacts, testDesign: buildTestDesignChecklist({ facts: validationFacts }) };
    };

    test('does not warn when extracting validation facts from package.json', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        extractValidationFacts({ files: [{ path: 'package.json', content: '{\n "name": "x"\n}' }] });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('collects validation facts and a deterministic checklist from a temporary project', () => {
      const dir = createTempDir();
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'validation-app' }));
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, files[0].path), files[0].content);
      const context = collectSystemGenerationContext(dir);
      expect(context.validationFacts.length).toBeGreaterThan(0);
      expect(context.testDesign).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'password' })]));
    });

    it('returns empty fact and checklist arrays when a project has no detected rules', () => {
      const dir = createTempDir();
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-validation-app' }));
      fs.writeFileSync(path.join(dir, 'index.html'), '<h1>Welcome</h1>');
      const context = collectSystemGenerationContext(dir);
      expect(context.validationFacts).toEqual([]);
      expect(context.testDesign).toEqual([]);
    });

    it.each(['playwright', 'cypress'])('includes test-design rules and formatted facts in the %s prompt', (framework) => {
      const context = makeContext();
      expect(context.testDesign.length).toBeGreaterThan(0);
      const prompt = buildColdStartSystemPrompt({ context, framework });
      expect(prompt).toContain(SYSTEM_TEST_DESIGN_RULES);
      expect(prompt).toContain(formatTestDesignForPrompt({ facts: context.validationFacts, checklist: context.testDesign }));
      expect(prompt).toContain('// covers: <checklist id>');
    });

    it('includes the formatted checklist in verified prompts and keeps design rules out of repairs', () => {
      const context = makeContext();
      expect(buildVerifiedSystemPrompt(context, {})).toContain(testDesignPromptSection(context));
      expect(systemTestPromptRules({ repair: true })).not.toContain(SYSTEM_TEST_DESIGN_RULES);
      expect(SYSTEM_PROMPT_VERSION).toBe('system-test-v4');
    });

    it.each(['playwright', 'cypress'])('omits checklist instructions without facts in the %s prompt', (framework) => {
      const context = { sourceCode: [], routes: ['/'], validationFacts: [], testDesign: [] };
      expect(testDesignPromptSection(context)).toBe('');
      expect(testDesignPromptSection()).toBe('');
      const prompt = buildColdStartSystemPrompt({ context, framework });
      expect(prompt).toContain('Test design (plan before writing code):');
      expect(prompt).not.toContain('Implement one test per checklist item');
      expect(prompt).not.toContain('// covers:');
    });
  });

  describe('measureTestDesignCoverage', () => {
    it('handles an empty checklist', () => {
      expect(measureTestDesignCoverage({ code: '// covers: unrelated', checklist: [] })).toEqual({ total: 0, covered: [], missing: [] });
      expect(measureTestDesignCoverage()).toEqual({ total: 0, covered: [], missing: [] });
    });

    it('matches exact case-sensitive IDs with extra spaces and counts repeated markers once', () => {
      const checklist = ['first', 'second', 'third', 'fourth'].map((id) => ({ id }));
      const code = '//   covers :  second\n// covers: first\n// covers: first\n// Covers: third\n// covers: fourth-extra';
      expect(measureTestDesignCoverage({ code, checklist })).toEqual({ total: 4, covered: ['first', 'second'], missing: ['third', 'fourth'] });
    });
  });

  describe('Optional test-design coverage follow-up', () => {
    const checklist = [
      { id: 'password-empty', field: 'password', technique: 'equivalence', input: '', expect: 'reject', message: 'Password is required', source: 'src/App.jsx' },
      { id: 'password-below-min', field: 'password', technique: 'boundary', input: '1234567', expect: 'reject', message: 'Password is too short', source: 'src/App.jsx' },
      { id: 'password-at-min', field: 'password', technique: 'boundary', input: '12345678', expect: 'accept', message: '', source: 'src/App.jsx' },
      { id: 'password-above-min', field: 'password', technique: 'boundary', input: '123456789', expect: 'accept', message: '', source: 'src/App.jsx' },
    ];
    const validCode = `import {test,expect} from '@playwright/test';
test('READ home heading',async({page})=>{
  await test.step('Action: READ - open home',async()=>{await page.goto('/');});
  await test.step('Assert: heading',async()=>{await expect(page.getByRole('heading',{name:'Welcome'})).toBeVisible();});
  await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
});`;
    describe('Cold-start scenario metadata', () => {
      const scenario = {
        id: 'read-home-heading',
        title: 'READ home heading',
        criterionIds: [],
        preconditions: [],
        inputs: [],
        actions: ['Open the home page'],
        expected: ['The Welcome heading is visible'],
        sourceReferences: ['src/App.jsx'],
      };
      const wrongMetadata = JSON.stringify({
        content: validCode,
        scenarios: [scenario, { ...scenario, id: 'extra', title: 'Extra scenario' }],
      });
      const generateFullSystemTests = (generate) => generateColdStartSystemTests({
        rootDir: createTempDir(),
        executionMode: 'full',
        dependencies: {
          generate,
          collect: () => ({
            routes: ['/'],
            sourceCode: [{ path: 'src/App.jsx', content: 'export default () => <h1>Welcome</h1>;' }],
          }),
        },
      });

      test('keeps validated code when both scenario metadata responses have the wrong count', async () => {
        const generate = jest.fn().mockResolvedValue(wrongMetadata);
        const result = await generateFullSystemTests(generate);

        expect(generate).toHaveBeenCalledTimes(2);
        expect(result.generationMetadata.metadataStatus).toBe('CODE_ONLY');
        expect(result.code).toBe(validCode);
      });

      test('keeps validated code when the metadata repair request fails', async () => {
        const generate = jest.fn()
          .mockResolvedValueOnce(wrongMetadata)
          .mockRejectedValueOnce(Object.assign(new Error('[503 Service Unavailable] high demand'), { status: 503 }));
        const result = await generateFullSystemTests(generate);

        expect(generate).toHaveBeenCalledTimes(2);
        expect(result.generationMetadata.metadataStatus).toBe('CODE_ONLY');
        expect(result.code).toBe(validCode);
      });

      test('accepts corrected scenario metadata and includes the exact titles in the repair prompt', async () => {
        const generate = jest.fn()
          .mockResolvedValueOnce(wrongMetadata)
          .mockResolvedValueOnce(JSON.stringify({ content: validCode, scenarios: [scenario] }));
        const result = await generateFullSystemTests(generate);

        expect(result.generationMetadata.metadataStatus).toBe('DRAFT');
        expect(generate.mock.calls[1][0]).toContain(
          'If you include "scenarios", it must contain exactly 1 entries, one per test, whose "title" values are exactly: ["READ home heading"]. Each entry needs non-empty "actions", "expected" and "sourceReferences".',
        );
        expect(generate.mock.calls[1][0]).toContain('The test code itself passed validation; keep it unchanged and fix only "scenarios".');
      });

      test('rejects generation when both code responses have a syntax error', async () => {
        const generate = jest.fn().mockResolvedValue(JSON.stringify({ content: validCode + '\nconst invalid = ;' }));

        await expect(generateFullSystemTests(generate)).rejects.toThrow();
        expect(generate).toHaveBeenCalledTimes(2);
      });
    });

    const additionalTests = checklist.map((item) => `
// covers: ${item.id}
test('Register ${item.expect === 'reject' ? 'rejects' : 'accepts'} a ${item.input.length}-character password',async({page})=>{
  await test.step('Action: VALIDATION - submit password',async()=>{
    await page.goto('/');
    await page.getByLabel('Password').fill(${JSON.stringify(item.input)});
    await page.getByRole('button',{name:'Register'}).click();
  });
  await test.step('Assert: submission outcome',async()=>{
    ${item.expect === 'reject' ? "await expect(page.getByLabel('Password')).toBeFocused();" : "await expect(page.getByRole('heading',{name:'Account created'})).toBeVisible();"}
  });
  await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
});`).join('\n');
    const collect = () => {
      const sourceCode = [{ path: 'src/App.jsx', content: 'export default function App() { return <main><h1>Welcome</h1><form><label>Password<input name="password" required minLength={8}/></label><button>Register</button></form></main>; }' }];
      return { routes: ['/'], sourceCode, validationFacts: extractValidationFacts({ files: sourceCode }), testDesign: checklist };
    };

    it('requests missing items once and returns the validated expanded suite and coverage', async () => {
      const expanded = validCode + additionalTests;
      const generate = jest.fn().mockResolvedValueOnce(JSON.stringify({ content: validCode })).mockResolvedValueOnce(JSON.stringify({ content: expanded }));
      const result = await generateColdStartSystemTests({ rootDir: createTempDir(), dependencies: { collect, generate } });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls[1][0]).toContain('The suite passed validation but does not cover these test design checklist items:');
      expect(generate.mock.calls[1][0]).toContain('keep every existing test unchanged');
      for (const item of checklist) {
        expect(generate.mock.calls[1][0]).toContain(item.id);
        expect(generate.mock.calls[1][0]).toContain(item.technique);
      }
      expect(result.code).toBe(expanded);
      expect(result.generationAttempts).toBe(2);
      expect(result.testDesign).toEqual({ facts: collect().validationFacts.length, checklist: 4, covered: checklist.map((item) => item.id), missing: [] });
      expect(fs.readFileSync(result.fullPath, 'utf8')).toBe(expanded);
    });

    it('keeps expanded code with code-only metadata when follow-up scenarios do not match', async () => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const expanded = validCode + additionalTests;
        const generate = jest.fn()
          .mockResolvedValueOnce(JSON.stringify({ content: validCode }))
          .mockResolvedValueOnce(JSON.stringify({ content: expanded, scenarios: [{ id: 'wrong', title: 'Not a test title' }] }));
        const result = await generateColdStartSystemTests({ rootDir: createTempDir(), dependencies: { collect, generate } });
        expect(generate).toHaveBeenCalledTimes(2);
        expect(result.code).toBe(expanded);
        expect(result.generationMetadata).toEqual({ scenarios: [], metadataStatus: 'CODE_ONLY' });
        expect(result.testDesign.covered).toEqual(checklist.map((item) => item.id));
        expect(result.testDesign.missing).toEqual([]);
        expect(fs.readFileSync(result.fullPath, 'utf8')).toBe(expanded);
        expect(warning).toHaveBeenCalledWith(
          '[verifiedSystemGeneration] Coverage follow-up metadata rejected; keeping code-only metadata:',
          expect.any(String),
        );
      } finally {
        warning.mockRestore();
      }
    });

    it('keeps the original candidate when valid follow-up code covers no more checklist ids', async () => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const followUpCode = validCode.replace('READ home heading', 'READ welcome heading');
        const generate = jest.fn()
          .mockResolvedValueOnce(JSON.stringify({ content: validCode }))
          .mockResolvedValueOnce(JSON.stringify({ content: followUpCode }));
        const result = await generateColdStartSystemTests({ rootDir: createTempDir(), dependencies: { collect, generate } });
        expect(generate).toHaveBeenCalledTimes(2);
        expect(result.code).toBe(validCode);
        expect(result.testDesign.covered).toEqual([]);
        expect(result.testDesign.missing).toEqual(checklist.map((item) => item.id));
        expect(fs.readFileSync(result.fullPath, 'utf8')).toBe(validCode);
        expect(warning).toHaveBeenCalledWith(
          '[verifiedSystemGeneration] Coverage follow-up did not increase checklist coverage; keeping validated candidate',
        );
      } finally {
        warning.mockRestore();
      }
    });

    it.each(['invalid', 'unavailable'])('keeps the original valid candidate when the follow-up is %s', async (failure) => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const generate = jest.fn().mockResolvedValueOnce(JSON.stringify({ content: validCode }));
        if (failure === 'invalid') generate.mockResolvedValueOnce(JSON.stringify({ content: "import {exec} from 'child_process'; exec('bad');" }));
        else generate.mockRejectedValueOnce(new Error('AI budget exhausted'));
        const result = await generateColdStartSystemTests({ rootDir: createTempDir(), dependencies: { collect, generate } });
        expect(generate).toHaveBeenCalledTimes(2);
        expect(result.code).toBe(validCode);
        expect(result.testDesign.covered).toEqual([]);
        expect(result.testDesign.missing).toEqual(checklist.map((item) => item.id));
        expect(fs.readFileSync(result.fullPath, 'utf8')).toBe(validCode);
        expect(warning).toHaveBeenCalled();
      } finally {
        warning.mockRestore();
      }
    });

    it('never requests a second coverage follow-up even if coverage remains low', async () => {
      const generate = jest.fn().mockResolvedValue(JSON.stringify({ content: validCode }));
      const result = await generateColdStartSystemTests({ rootDir: createTempDir(), dependencies: { collect, generate } });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(result.testDesign.covered).toEqual([]);
    });

    it('does not request a follow-up when half the checklist is covered', async () => {
      const code = validCode + additionalTests.split('// covers: password-at-min')[0];
      const generate = jest.fn().mockResolvedValue(JSON.stringify({ content: code }));
      const result = await generateColdStartSystemTests({ rootDir: createTempDir(), dependencies: { collect, generate } });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(result.testDesign.covered).toEqual(['password-empty', 'password-below-min']);
    });

    it('keeps the existing correction attempt before the optional coverage request', async () => {
      const generate = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({ content: validCode.replace('Action: READ - open home', 'Open home') }))
        .mockResolvedValueOnce(JSON.stringify({ content: validCode }))
        .mockResolvedValueOnce(JSON.stringify({ content: validCode + additionalTests }));
      const result = await generateColdStartSystemTests({ rootDir: createTempDir(), dependencies: { collect, generate } });
      expect(generate).toHaveBeenCalledTimes(3);
      expect(generate.mock.calls[1][0]).toContain('The previous candidate failed validation:');
      expect(generate.mock.calls[2][0]).toContain('The suite passed validation');
      expect(result.generationAttempts).toBe(3);
      expect(result.testDesign.missing).toEqual([]);
    });
  });

  describe('Task 2.1: harvestFrontendContext', () => {
    it.each(['index.html','src/Welcome.vue','src/Welcome.svelte'])('discovers UI controls outside React page conventions: %s', filePath => {
      const context=harvestFrontendContext([{path:filePath,content:'<a href="/help">Help</a><button>Save</button><input placeholder="Name">'}]);
      expect(context.routes).toContain('/help');
      expect(context.uiActions[0].buttons).toContain('Save');
      expect(context.uiActions[0].inputs).toContain('Name');
    });
    it('detects React Router routes, Next.js page/app routes, and navigation links', () => {
      const mockFiles = [
        {
          path: 'src/App.jsx',
          content: `
            import { Route, Routes, Link } from 'react-router-dom';
            export default function App() {
              return (
                <div>
                  <Link to="/about">About Us</Link>
                  <a href="/contact">Contact</a>
                  <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                  </Routes>
                </div>
              );
            }
          `,
        },
        {
          path: 'src/pages/Cart.jsx',
          content: `
            import axios from 'axios';
            export default function Cart() {
              const checkout = () => axios.post('/api/checkout');
              return (
                <div>
                  <input name="coupon" placeholder="Discount code" />
                  <button>Apply Coupon</button>
                  <button>Checkout Now</button>
                </div>
              );
            }
          `,
        },
        {
          path: 'pages/products/index.jsx',
          content: 'export default function Products() { return <div>Products</div>; }',
        },
      ];

      const harvested = harvestFrontendContext(mockFiles);

      expect(harvested.routes).toContain('/');
      expect(harvested.routes).toContain('/about');
      expect(harvested.routes).toContain('/contact');
      expect(harvested.routes).toContain('/login');
      expect(harvested.routes).toContain('/dashboard');
      expect(harvested.routes).toContain('/products');

      expect(harvested.clientApiCalls).toContain('/api/checkout');

      expect(harvested.uiActions.length).toBeGreaterThan(0);
      const cartAction = harvested.uiActions.find((a) => a.component === 'Cart.jsx');
      expect(cartAction).toBeDefined();
      expect(cartAction.buttons).toContain('Apply Coupon');
      expect(cartAction.buttons).toContain('Checkout Now');
      expect(cartAction.inputs).toContain('Discount code');
    });

    it('ignores HTML <link> tags and static assets like /favicon.svg', () => {
      const htmlFile = {
        path: 'index.html',
        content: `
          <!doctype html>
          <html>
            <head>
              <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
              <link rel="stylesheet" href="/assets/style.css" />
            </head>
            <body>
              <a href="/logo.png">Download Logo</a>
              <a href="/dashboard">Go to Dashboard</a>
            </body>
          </html>
        `,
      };
      const result = harvestFrontendContext([htmlFile]);
      expect(result.routes).toContain('/dashboard');
      expect(result.routes).not.toContain('/favicon.svg');
      expect(result.routes).not.toContain('/assets/style.css');
      expect(result.routes).not.toContain('/logo.png');
    });
  });

  describe('Task 2.2: ensureSystemTestConfig & buildColdStartSystemPrompt', () => {
    it('creates playwright.config.mjs if no Playwright configuration exists', () => {
      const dir = createTempDir();
      const res = ensureSystemTestConfig({ rootDir: dir, framework: 'playwright', autPort: 5173 });

      expect(res.configCreated).toBe(true);
      expect(res.configPath).toBe('playwright.config.mjs');
      expect(fs.existsSync(path.join(dir, 'playwright.config.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'tests/e2e'))).toBe(true);

      const content = fs.readFileSync(path.join(dir, 'playwright.config.mjs'), 'utf8');
      expect(content).toContain('http://localhost:5173');

      // Second check should detect existing config
      const res2 = ensureSystemTestConfig({ rootDir: dir, framework: 'playwright' });
      expect(res2.configCreated).toBe(false);
    });

    it('creates cypress.config.js if no Cypress configuration exists', () => {
      const dir = createTempDir();
      const res = ensureSystemTestConfig({ rootDir: dir, framework: 'cypress', autPort: 3000 });

      expect(res.configCreated).toBe(true);
      expect(res.configPath).toBe('cypress.config.js');
      expect(fs.existsSync(path.join(dir, 'cypress.config.js'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'cypress/e2e'))).toBe(true);

      const content = fs.readFileSync(path.join(dir, 'cypress.config.js'), 'utf8');
      expect(content).toContain('http://localhost:3000');

      // Second check should detect existing config
      const res2 = ensureSystemTestConfig({ rootDir: dir, framework: 'cypress' });
      expect(res2.configCreated).toBe(false);
    });

    it('builds clear prompt instructions for Playwright and Cypress', () => {
      const mockContext = {
        routes: ['/', '/login', '/products'],
        uiActions: [{ component: 'Login.jsx', buttons: ['Submit'], inputs: ['username'] }],
        clientApiCalls: ['/api/login'],
        backendEndpoints: [],
      };

      const pwPrompt = buildColdStartSystemPrompt({ context: mockContext, framework: 'playwright' });
      expect(pwPrompt).toContain('@playwright/test');
      expect(pwPrompt).toContain('/products');

      const cyPrompt = buildColdStartSystemPrompt({ context: mockContext, framework: 'cypress' });
      expect(cyPrompt).toContain('Cypress');
      expect(cyPrompt).toContain('cy.visit');
      expect(cyPrompt).toContain('/products');
    });

    it('generates valid fallback code that passes Babel AST validation for both frameworks', () => {
      const pwFallback = generateFallbackColdStartTest({
        framework: 'playwright',
        routes: ['/', '/dashboard'],
        uiActions: [{ component: 'Dashboard.jsx', buttons: ['Refresh'] }],
      });
      expect(() => validateGeneratedTestCode(pwFallback)).not.toThrow();
      expect(pwFallback).toContain("import { test, expect } from '@playwright/test';");

      const cyFallback = generateFallbackColdStartTest({
        framework: 'cypress',
        routes: ['/', '/dashboard'],
        uiActions: [{ component: 'Dashboard.jsx', buttons: ['Refresh'] }],
      });
      expect(() => validateGeneratedTestCode(cyFallback)).not.toThrow();
      expect(cyFallback).toContain("describe('Cold-Start Automated E2E Suite (Cypress)'");
    });
  });

  describe('Task 2.3: generateColdStartSystemTests with AST validation and file writing', () => {
    it('refuses low-quality AI cases instead of saving a passing-looking combined scenario',async()=>{
      const dir=createTempDir();
      await expect(generateColdStartSystemTests({rootDir:dir,dependencies:{
        collect:()=>({routes:['/'],uiActions:[],clientApiCalls:[],backendEndpoints:[],sourceCode:[]}),
        generate:async()=>JSON.stringify({content:"import {test,expect} from '@playwright/test';test('add and delete task',async({page})=>{await page.goto('/');await expect(page.locator('body')).toBeVisible();});"}),
      }})).rejects.toThrow(/quality validation/);
      expect(fs.existsSync(path.join(dir,'tests/e2e/covai-generated.spec.js'))).toBe(false);
    });
    it('generates, validates, and writes Playwright tests to tests/e2e', async () => {
      const dir = createTempDir();
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'zero-test-app' }));
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src/App.jsx'),
        `
          export default function App() {
            return (
              <div>
                <a href="/login">Go to Login</a>
                <button>Click Me</button>
              </div>
            );
          }
        `,
      );

      const mockGenerate = jest.fn().mockResolvedValue(
        JSON.stringify({
          content: `
            import { test, expect } from '@playwright/test';

            test.describe('App E2E Verification', () => {
              test('Smoke Test: App loads', async ({ page }) => {
                await test.step('Action: NAVIGATION - open home',async()=>{await page.goto('/');});
                await test.step('Assert: page visible',async()=>{await expect(page.locator('body')).toBeVisible();});
                await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
              });

              test('Navigation Test: Login route opens', async ({ page }) => {
                await test.step('Action: NAVIGATION - open login',async()=>{await page.goto('/login');});
                await test.step('Assert: login URL',async()=>{await expect(page).toHaveURL(/\\/login/);});
                await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
              });
            });
          `,
        }),
      );

      const progressLogs = [];
      const result = await generateColdStartSystemTests({
        rootDir: dir,
        framework: 'playwright',
        onProgress: async (pct, msg) => progressLogs.push({ pct, msg }),
        dependencies: { generate: mockGenerate },
      });

      expect(result.framework).toBe('PLAYWRIGHT');
      expect(result.filePath).toBe('tests/e2e/covai-generated.spec.js');
      expect(result.configCreated).toBe(true);
      expect(result.configPath).toBe('playwright.config.mjs');
      expect(result.suiteCount).toBe(1);
      expect(result.scenarioCount).toBe(2);
      expect(result.scenarios).toEqual(['Smoke Test: App loads', 'Navigation Test: Login route opens']);

      expect(fs.existsSync(path.join(dir, 'tests/e2e/covai-generated.spec.js'))).toBe(true);
      const savedCode = fs.readFileSync(path.join(dir, result.filePath), 'utf8');
      expect(savedCode.match(/test\.step\(/g)).toHaveLength(6);
      expect(savedCode).toBe(result.code);
      expect(mockGenerate.mock.calls[0][0]).toContain('Every test.step label MUST');
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(result.testDesign).toEqual({ facts: 0, checklist: 0, covered: [], missing: [] });
      expect(progressLogs.some((p) => p.pct === 100)).toBe(true);
    });

    it('generates, validates, and writes Cypress tests to cypress/e2e', async () => {
      const dir = createTempDir();
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'zero-test-cypress-app' }));
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src/App.jsx'),
        'export default function App() { return <div>Home</div>; }',
      );

      const mockGenerate = jest.fn().mockResolvedValue(
        JSON.stringify({
          content: `
            describe('Cypress E2E Flow', () => {
              it('Smoke: Loads application root', () => {
                cy.visit('/');
                cy.get('body').should('be.visible');
              });
              it('Action: Performs sample interaction', () => {
                cy.visit('/');
                cy.get('body').should('exist');
              });
            });
          `,
        }),
      );

      const result = await generateColdStartSystemTests({
        rootDir: dir,
        framework: 'cypress',
        dependencies: { generate: mockGenerate },
      });

      expect(result.framework).toBe('CYPRESS');
      expect(result.filePath).toBe('cypress/e2e/covai-generated.cy.js');
      expect(result.configCreated).toBe(true);
      expect(result.configPath).toBe('cypress.config.js');
      expect(result.suiteCount).toBe(1);
      expect(result.scenarioCount).toBe(2);
      expect(fs.existsSync(path.join(dir, 'cypress/e2e/covai-generated.cy.js'))).toBe(true);
    });

    it('rejects unsafe output after one correction without saving a fallback', async () => {
      const dir = createTempDir();
      const generate = jest.fn().mockResolvedValue(JSON.stringify({content: "import { exec } from 'child_process'; test('bad',()=>{exec('ls');});"}));
      await expect(generateColdStartSystemTests({rootDir:dir,dependencies:{
        collect:()=>({routes:['/'],sourceCode:[],uiActions:[]}),generate,
      }})).rejects.toThrow();
      expect(generate).toHaveBeenCalledTimes(2);
      expect(fs.existsSync(path.join(dir,'tests/e2e/covai-generated.spec.js'))).toBe(false);
    });

    it('corrects unlabeled steps and saves only the validated replacement', async () => {
      const dir = createTempDir();
      const valid = `import {test,expect} from '@playwright/test';
      test('READ home heading',async({page})=>{
        await test.step('Action: READ - open home',async()=>{await page.goto('/');});
        await test.step('Assert: heading',async()=>{await expect(page.getByRole('heading',{name:'Welcome'})).toBeVisible();});
        await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
      });`;
      const generate = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({content:valid.replace('Action: READ - open home','Open home')}))
        .mockResolvedValueOnce(JSON.stringify({content:valid}));
      const result = await generateColdStartSystemTests({rootDir:dir,dependencies:{
        collect:()=>({routes:['/'],sourceCode:[{path:'index.html',content:'<h1>Welcome</h1>'}],uiActions:[]}),generate,
      }});
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls[1][0]).toContain('every step must identify');
      expect(generate.mock.calls[0][0]).toContain('<h1>Welcome</h1>');
      expect(fs.readFileSync(path.join(dir,result.filePath),'utf8')).toBe(valid);
      expect(result.fallbackUsed).toBe(false);
    });

    it('propagates provider failure without writing test files', async () => {
      const dir=createTempDir();
      const generate=jest.fn().mockRejectedValue(new Error('AI unavailable'));
      await expect(generateColdStartSystemTests({rootDir:dir,dependencies:{collect:()=>({routes:['/'],sourceCode:[]}),generate}})).rejects.toThrow('AI unavailable');
      expect(generate).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(dir,'tests/e2e/covai-generated.spec.js'))).toBe(false);
    });
  });
});
