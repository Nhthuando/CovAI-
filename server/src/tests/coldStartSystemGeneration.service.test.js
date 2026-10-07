import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { harvestFrontendContext } from '../services/systemGenerationContext.service.js';
import {
  ensureSystemTestConfig,
  buildColdStartSystemPrompt,
  generateFallbackColdStartTest,
  generateColdStartSystemTests,
} from '../services/verifiedSystemGeneration.service.js';
import { validateGeneratedTestCode } from '../validators/aiTestCode.validator.js';

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

describe('Phase 2: Cold-Start AI System Test Generator', () => {
  describe('Task 2.1: harvestFrontendContext', () => {
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
                await page.goto('/');
                await expect(page.locator('body')).toBeVisible();
              });

              test('Navigation Test: Login route opens', async ({ page }) => {
                await page.goto('/login');
                await expect(page).toHaveURL(/\\/login/);
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

    it('falls back to safe template if AI output has syntax errors or dangerous code', async () => {
      const dir = createTempDir();
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'malformed-ai-app' }));
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src/App.jsx'),
        'export default function App() { return <div>Hello</div>; }',
      );

      // AI outputs forbidden child_process or broken syntax
      const mockGenerate = jest.fn().mockResolvedValue(
        JSON.stringify({
          content: `
            import { exec } from 'child_process';
            test('bad', () => { exec('ls'); });
          `,
        }),
      );

      const result = await generateColdStartSystemTests({
        rootDir: dir,
        framework: 'playwright',
        dependencies: { generate: mockGenerate },
      });

      // Should automatically fallback to safe template and still succeed!
      expect(result.framework).toBe('PLAYWRIGHT');
      expect(result.scenarioCount).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(dir, 'tests/e2e/covai-generated.spec.js'))).toBe(true);
      const savedCode = fs.readFileSync(path.join(dir, 'tests/e2e/covai-generated.spec.js'), 'utf8');
      expect(savedCode).not.toContain('child_process');
      expect(savedCode).toContain('@playwright/test');
    });
  });
});

