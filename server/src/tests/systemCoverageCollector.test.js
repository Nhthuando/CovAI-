import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from '@jest/globals';
import { createAssessmentWorkspace, snapshotIdentity } from '../services/systemAssessmentWorkspace.service.js';
import { prepareSystemCoverage } from '../services/systemCoverageInstrumentation.service.js';
import { collectSystemCoverage } from '../services/systemCoverageCollector.service.js';
import { analyzeSystemTestFile, preserveTestIntent } from '../services/systemTestStaticAnalysis.service.js';

describe('Real instrumentation and run attribution', () => {
    it('keeps unvisited source in the denominator and counts lines independently from statements', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-coverage-fixture-'));
        let workspace;
        try {
            fs.mkdirSync(path.join(root, 'server/src'), { recursive: true });
            fs.writeFileSync(path.join(root, 'server/package.json'), '{"scripts":{"start":"node src/app.cjs"}}');
            fs.writeFileSync(path.join(root, 'server/src/app.cjs'), 'function check(x) { if (x > 0) { return 1; } return 0; }\ncheck(1);');
            fs.writeFileSync(path.join(root, 'server/src/unvisited.cjs'), 'function unused() { return 7; }\nunused();');
            fs.writeFileSync(path.join(root, '.env'), 'SECRET=excluded');
            const before = snapshotIdentity(root);
            workspace = createAssessmentWorkspace({ rootDir: root });
            expect(fs.existsSync(path.join(workspace.rootDir, '.env'))).toBe(false);
            const preparation = prepareSystemCoverage({ workspace, coverageScope: { backend: { root: 'server', sourceDirectory: 'src' } }, measurementId: 'measurement-a' });
            const context = {}; context.globalThis = context;
            vm.runInNewContext(fs.readFileSync(path.join(workspace.rootDir, 'server/src/app.cjs'), 'utf8'), context);
            const result = collectSystemCoverage({ preparation, runtimeArtifacts: [{ tier: 'backend', measurementId: 'measurement-a', sourceHash: workspace.sourceHash, coverage: context.__coverage__ }] });
            expect(result.tiers.backend.status).toBe('MEASURED');
            expect(result.tiers.backend.scope.eligibleFiles).toBe(2);
            expect(result.tiers.backend.counters.lines.pct).toBeLessThan(100);
            expect(result.tiers.backend.counters.statements.total).toBeGreaterThan(result.tiers.backend.counters.lines.total);
            expect(result.tiers.backend.files.find(file => file.filePath.endsWith('unvisited.cjs')).counters.lines.covered).toBe(0);
            const unvisited=result.tiers.backend.files.find(file=>file.filePath.endsWith('unvisited.cjs'));
            expect(unvisited.uncoveredFunctions).toEqual([expect.objectContaining({line:1})]);
            expect(unvisited.uncoveredStatements.length).toBeGreaterThan(0);
            expect(result.tiers.backend.files.find(file=>file.filePath.endsWith('app.cjs')).uncoveredBranches).toEqual([expect.objectContaining({line:1})]);
            const stale = collectSystemCoverage({ preparation, runtimeArtifacts: [{ tier: 'backend', measurementId: 'old', sourceHash: workspace.sourceHash, coverage: context.__coverage__ }] });
            expect(stale.tiers.backend.status).toBe('INVALID');
            expect(snapshotIdentity(root)).toEqual(before);
        } finally { workspace?.release(); fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('resolves sibling frontend package with Vite when workspace root is a backend directory', () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-sibling-cov-'));
        let workspace;
        try {
            fs.mkdirSync(path.join(repo, '.git'));
            fs.mkdirSync(path.join(repo, 'server/src'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'server/package.json'), '{"scripts":{"start":"node src/index.js"}}');
            fs.writeFileSync(path.join(repo, 'server/src/index.js'), 'console.log("server");');
            fs.mkdirSync(path.join(repo, 'client/src'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'client/package.json'), '{"dependencies":{"vite":"^5.0.0"},"scripts":{"dev":"vite"}}');
            fs.writeFileSync(path.join(repo, 'client/src/App.jsx'), 'export default function App() { return <h1>Hello</h1>; }');

            workspace = createAssessmentWorkspace({ rootDir: path.join(repo, 'server') });
            const preparation = prepareSystemCoverage({
                workspace,
                coverageScope: { frontend: { root: '.', sourceDirectory: '.' } },
                measurementId: 'measurement-frontend-1',
            });

            expect(preparation.tiers.frontend.status).toBeUndefined();
            expect(preparation.tiers.frontend.inventory).toContain('client/src/App.jsx');
            expect(Object.keys(preparation.tiers.frontend.zeroMaps)).toContain('client/src/App.jsx');
        } finally {
            workspace?.release();
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
    it('flags smoke assertions without declaring a business quality score', () => {
        const content = "import {test,expect} from '@playwright/test'; test('smoke',async({page})=>{await expect(page.locator('body')).toBeVisible();});";
        const result = analyzeSystemTestFile({ content, filePath: 'tests/smoke.spec.js' });
        expect(result.findings.map(f => f.rule)).toContain('SMOKE_ASSERTION');
        expect(result.assertionSites[0].supported).toBe(false);
        expect(() => preserveTestIntent(content, content.replace('toBeVisible()', 'toBeAttached()'), 'tests/smoke.spec.js')).toThrow('assertion');
    });
});
