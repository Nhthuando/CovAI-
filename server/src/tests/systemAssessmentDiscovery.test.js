import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from '@jest/globals';
import { discoverSystemAssessment } from '../services/systemAssessmentDiscovery.service.js';
import { createAssessmentWorkspace } from '../services/systemAssessmentWorkspace.service.js';
import { prepareSystemCoverage } from '../services/systemCoverageInstrumentation.service.js';
import { readAssessmentTestEnvironment } from '../services/fullSystemRuntime.service.js';
const roots = [];
const fixture = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-discovery-')); roots.push(root); return root; };
const write = (root, file, content) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('Automatic system assessment discovery', () => {
    it('reads explicit test environment from the original without copying credential files', () => {
        const root = fixture(); write(root, 'server/.env', 'PRIVATE_SETTING=production'); write(root, 'server/.env.test', 'STRIPE_SECRET_KEY=test-fixture-value\nDATABASE_URL=unused-remote-url');
        const workspace = createAssessmentWorkspace({rootDir:root});
        try {
            expect(fs.existsSync(path.join(workspace.rootDir,'server/.env.test'))).toBe(false);
            expect(readAssessmentTestEnvironment(path.join(workspace.originalRoot,'server'))).toEqual({STRIPE_SECRET_KEY:'test-fixture-value',DATABASE_URL:'unused-remote-url'});
        } finally { workspace.release(); }
    });
    it('discovers repository tests and frontend source without including run artifacts', () => {
        const root = fixture(); write(root, 'client/package.json', '{}'); write(root, 'client/src/main.jsx', 'export const app = true;');
        write(root, 'tests/system/cart.spec.js', "import {test} from '@playwright/test'; test('cart',()=>{});");
        write(root, '.covai-system-test/runs/old.spec.js', "import {test} from '@playwright/test'; test('old',()=>{});");
        expect(discoverSystemAssessment({rootDir:root})).toMatchObject({testFiles:['tests/system/cart.spec.js'],repeatRuns:2,coverageScope:{frontend:{root:'client',sourceDirectory:'src'}}});
    });
    it('includes direct backend modules when the package has no src directory', () => {
        const root = fixture(); write(root, 'client/package.json', '{}'); write(root, 'server/package.json', '{}'); write(root, 'server/index.js', 'console.log(1);');
        write(root, 'tests/system/cart.spec.js', "import {test} from '@playwright/test'; test('cart',()=>{});");
        write(root, '.covai/schema.sql', 'select 1;'); write(root, '.covai/system-test.json', JSON.stringify({frontend:{directory:'client'},backend:{directory:'server',healthPath:'/'},database:{engine:'mysql',initSql:'.covai/schema.sql'}}));
        write(root, 'client/e2e/mock.spec.js', "import {test} from '@playwright/test'; test('mock',async({page})=>{await page.route('**/api/**',()=>{});});");
        const full = discoverSystemAssessment({rootDir:root,executionMode:'full'});
        expect(full.coverageScope.backend).toEqual({root:'server',sourceDirectory:'.'});
        expect(full.testFiles).toEqual(['tests/system/cart.spec.js']);
        expect(full.excludedTests).toEqual([{filePath:'client/e2e/mock.spec.js',reason:'Mocked or intercepted API: run this file in Frontend mode'}]);
        expect(discoverSystemAssessment({rootDir:root}).testFiles).toContain('client/e2e/mock.spec.js');
    });
    it('rejects ambiguous packages instead of silently measuring one', () => {
        const root = fixture(); write(root, 'client/package.json', '{}'); write(root, 'frontend/package.json', '{}'); write(root, 'tests/system/cart.spec.js', "import {test} from '@playwright/test'; test('cart',()=>{});");
        expect(()=>discoverSystemAssessment({rootDir:root})).toThrow('ambiguous');
    });
    it('instruments unloaded package-root modules and excludes test infrastructure', () => {
        const root = fixture(); write(root, 'server/package.json', '{}'); write(root, 'server/index.js', 'export const value=1;'); write(root, 'server/unused.js', 'export const unused=2;');
        write(root, 'server/tests/helper.js', 'export const helper=3;'); write(root, 'server/jest.config.js', 'export default {};');
        const workspace = createAssessmentWorkspace({rootDir:root});
        try {
            const preparation = prepareSystemCoverage({workspace,coverageScope:{backend:{root:'server',sourceDirectory:'.'}},measurementId:'root-scope'});
            expect(Object.keys(preparation.tiers.backend.zeroMaps).sort()).toEqual(['server/index.js','server/unused.js']);
        } finally { workspace.release(); }
    });
});
