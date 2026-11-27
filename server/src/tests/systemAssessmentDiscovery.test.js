import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, test, expect, afterEach } from '@jest/globals';
import { discoverSystemAssessment } from '../services/systemAssessmentDiscovery.service.js';
import { createAssessmentWorkspace } from '../services/systemAssessmentWorkspace.service.js';
import { prepareSystemCoverage } from '../services/systemCoverageInstrumentation.service.js';
import { readAssessmentTestEnvironment } from '../services/fullSystemRuntime.service.js';
const roots = [];
const fixture = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-discovery-')); roots.push(root); return root; };
const write = (root, file, content) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
const fullStackFixture = () => {
    const root = fixture();
    write(root, 'client/package.json', '{}');
    write(root, 'server/package.json', '{}');
    write(root, '.covai/schema.sql', 'select 1;');
    write(root, '.covai/system-test.json', JSON.stringify({
        frontend: { directory: 'client' },
        backend: { directory: 'server', healthPath: '/' },
        database: { engine: 'mysql', initSql: '.covai/schema.sql' }
    }));
    return root;
};
const specWithTypeScriptCast = "import {test} from '@playwright/test';\ntest('reads an input', ({page}) => page.locator('input').evaluate(node => (node as HTMLInputElement).value));";
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('Automatic system assessment discovery', () => {
    it('resolves custom monorepo directories before a setup file has been applied',()=>{
        const root=fixture();
        write(root,'package.json',JSON.stringify({workspaces:['apps/*'],scripts:{dev:'turbo run dev'}}));
        write(root,'apps/shop/package.json',JSON.stringify({scripts:{dev:'vite'},devDependencies:{vite:'7'}}));
        write(root,'apps/orders/package.json',JSON.stringify({scripts:{start:'node index.js'},dependencies:{express:'5'}}));
        write(root,'apps/orders/index.js',"import http from 'node:http';");
        write(root,'tests/system/order.spec.js',"import {test,expect} from '@playwright/test';test('orders',()=>{expect(true).toBe(true);});");
        expect(discoverSystemAssessment({rootDir:root,executionMode:'full'}).coverageScope).toEqual({frontend:{root:'apps/shop',sourceDirectory:'.'},backend:{root:'apps/orders',sourceDirectory:'.'}});
        expect(fs.existsSync(path.join(root,'.covai/system-test.json'))).toBe(false);
    });
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
        expect(full.excludedTests).toEqual([{filePath:'client/e2e/mock.spec.js',reason:'Uses API mocks (frontend-only test)'}]);
        expect(discoverSystemAssessment({rootDir:root}).testFiles).toContain('client/e2e/mock.spec.js');
    });
    test('excludes a JavaScript spec with a TypeScript cast and selects the valid spec', () => {
        const root = fullStackFixture();
        write(root, 'tests/e2e/cart.spec.js', "import {test} from '@playwright/test'; test('cart',()=>{});");
        write(root, 'tests/e2e/input.spec.mjs', specWithTypeScriptCast);
        const result = discoverSystemAssessment({ rootDir: root, executionMode: 'full' });
        expect(result.testFiles).toEqual(['tests/e2e/cart.spec.js']);
        expect(result.excludedTests).toEqual([{
            filePath: 'tests/e2e/input.spec.mjs',
            reason: expect.stringMatching(/^invalid JavaScript syntax \(2:\d+\): Unexpected token/)
        }]);
    });
    test('reports a 422 with the parser error when the only spec has invalid JavaScript', () => {
        const root = fullStackFixture();
        write(root, 'tests/e2e/input.spec.mjs', specWithTypeScriptCast);
        expect(() => discoverSystemAssessment({ rootDir: root, executionMode: 'full' })).toThrow(
            expect.objectContaining({
                statusCode: 422,
                message: expect.stringMatching(/^Test file tests\/e2e\/input\.spec\.mjs has invalid JavaScript syntax \(line 2:\d+\): Unexpected token.*Regenerate or fix it\.$/)
            })
        );
    });
    test('selects a TypeScript spec containing a cast', () => {
        const root = fullStackFixture();
        write(root, 'tests/e2e/input.spec.ts', specWithTypeScriptCast);
        const result = discoverSystemAssessment({ rootDir: root, executionMode: 'full' });
        expect(result.testFiles).toEqual(['tests/e2e/input.spec.ts']);
        expect(result.excludedTests).toEqual([]);
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
