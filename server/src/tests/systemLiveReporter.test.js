import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from '@jest/globals';
import { prepareSystemPlaywright } from '../services/systemTestEvidence.service.js';

describe('managed live Playwright reporter', () => {
    it('records a real scenario and step while preserving JSON report output', () => {
        const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
        const scratch = path.join(serverRoot, '.covai-temp');
        fs.mkdirSync(scratch, { recursive: true });
        const rootDir = fs.mkdtempSync(path.join(scratch, 'live-reporter-'));
        try {
            fs.mkdirSync(path.join(rootDir, 'tests'), { recursive: true });
            fs.writeFileSync(path.join(rootDir, 'tests', 'one.spec.js'), "import {test} from '@playwright/test'; test('live event',async()=>{await test.step('business step',async()=>{});});");
            const managed = prepareSystemPlaywright({ rootDir, execution: { testDirectory: 'tests' }, executionMode: 'frontend', frontendPort: 4173, runKey: 'run' });
            const reporter = path.join(managed.directory, 'live-reporter.cjs');
            const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(serverRoot, '.covai-temp', 'playwright-browsers') }; delete env.JEST_WORKER_ID;
            const result = spawnSync(process.execPath, [path.join(serverRoot, 'node_modules/playwright/cli.js'), 'test', '--config', path.join(managed.directory, 'playwright.config.mjs'), `--reporter=json,${reporter}`], { cwd: rootDir, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
            if (result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);
            const report = JSON.parse(result.stdout);
            const events = fs.readFileSync(managed.eventPath, 'utf8').trim().split('\n').map(JSON.parse);
            expect(report.stats.expected).toBe(1);
            expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['SCENARIO_STARTED', 'STEP_STARTED', 'STEP_ENDED', 'SCENARIO_ENDED']));
        } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
    }, 35000);
});
