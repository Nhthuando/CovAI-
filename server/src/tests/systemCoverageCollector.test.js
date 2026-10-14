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
            const stale = collectSystemCoverage({ preparation, runtimeArtifacts: [{ tier: 'backend', measurementId: 'old', sourceHash: workspace.sourceHash, coverage: context.__coverage__ }] });
            expect(stale.tiers.backend.status).toBe('INVALID');
            expect(snapshotIdentity(root)).toEqual(before);
        } finally { workspace?.release(); fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('flags smoke assertions without declaring a business quality score', () => {
        const content = "import {test,expect} from '@playwright/test'; test('smoke',async({page})=>{await expect(page.locator('body')).toBeVisible();});";
        const result = analyzeSystemTestFile({ content, filePath: 'tests/smoke.spec.js' });
        expect(result.findings.map(f => f.rule)).toContain('SMOKE_ASSERTION');
        expect(result.assertionSites[0].supported).toBe(false);
        expect(() => preserveTestIntent(content, content.replace('toBeVisible()', 'toBeAttached()'), 'tests/smoke.spec.js')).toThrow('assertion');
    });
});
