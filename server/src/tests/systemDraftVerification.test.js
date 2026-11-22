import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test, expect, jest } from '@jest/globals';
import {
    collectPlaywrightOutcomes,
    removePlaywrightTests,
    verifyAndRepairSystemDraft,
} from '../services/verifiedSystemGeneration.service.js';

const titleA = 'A shows tasks';
const titleB = 'B opens the delete dialog';
const code = `import {test,expect} from '@playwright/test';
test('${titleA}',async({page})=>{
    await test.step('Action: NAVIGATION - open homepage',async()=>{await page.goto('/');});
    await test.step('Assert: task heading is visible',async()=>{await expect(page.getByRole('heading')).toBeVisible();});
    await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
});
test('${titleB}',async({page})=>{
    await test.step('Action: NAVIGATION - open homepage',async()=>{await page.goto('/');});
    await test.step('Action: CLICK - open delete dialog',async()=>{await page.getByText('Delete draft').click();});
    await test.step('Assert: delete dialog is visible',async()=>{await expect(page.getByRole('dialog')).toBeVisible();});
    await test.step('Evidence: verified outcome',async()=>{await test.info().attach('evidence',{body:await page.screenshot(),contentType:'image/png'});});
});
`;
const oldLocator = "getByText('Delete draft')";
const newLocator = "getByRole('button', { name: 'Delete draft' })";
const finalLocator = "getByRole('button', { name: 'Delete draft', exact: true })";
const patch = (old, replacement) => JSON.stringify({ replacements: [{ old, new: replacement }] });
const timeout = 'Timed out waiting for the delete button';
const directories = [];

afterEach(() => {
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const makeRun = () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-draft-verification-'));
    directories.push(rootDir);
    const generate = jest.fn();
    const run = jest.fn();
    const report = (failed = [], blocked = []) => ({ execution }) => {
        const testStart = index => Date.UTC(2026, 0, 1, 0, 0, index * 10);
        const specs = [titleA, titleB].map((title, index) => ({
            title,
            tests: [{ results: [failed.includes(title)
                ? { status: 'timedOut', startTime: new Date(testStart(index)).toISOString(), duration: 100,
                    errors: [{ message: blocked.includes(title) ? 'Backend connection reset' : timeout }] }
                : { status: 'passed' }] }],
        }));
        const reportPath = path.join(path.dirname(execution.testFile), 'results.json');
        fs.writeFileSync(reportPath, JSON.stringify({ suites: [{ specs }] }));
        const egressLogPath = path.join(path.dirname(execution.testFile), 'egress.jsonl');
        fs.writeFileSync(egressLogPath, [titleA, titleB].flatMap((title, index) => blocked.includes(title) ? [
            { id: title, t: testStart(index), event: 'start', host: 'api.stripe.com', method: 'POST' },
            { id: title, t: testStart(index) + 10, event: 'end', status: 401 },
        ] : []).map(event => JSON.stringify(event)).join('\n'));
        return { success: !failed.length, reportPath, egressLogPath };
    };
    const verify = () => verifyAndRepairSystemDraft({
        rootDir, code, generate, deadlineAt: Date.now() + 420000, dependencies: { run },
    });
    return { rootDir, generate, run, report, verify };
};

describe('Playwright draft verification', () => {
    test('verifies the first run and cleans up the candidate', async () => {
        const { rootDir, generate, run, report, verify } = makeRun();
        run.mockImplementation(({ execution, jobId, executionMode }) => {
            expect(jobId).toBeNull();
            expect(executionMode).toBe('full');
            expect(execution).toMatchObject({ runner: 'playwright', rootDir, testDirectory: 'tests/system' });
            expect(execution.testFile).toMatch(/\.spec\.mjs$/);
            expect(fs.readFileSync(execution.testFile, 'utf8')).toBe(code);
            return report()({ execution });
        });

        await expect(verify()).resolves.toEqual({ code, verificationStatus: 'VERIFIED', droppedScenarios: [], runs: 1 });
        expect(generate).not.toHaveBeenCalled();
        expect(fs.readdirSync(rootDir)).toEqual([]);
    });

    test('verifies a repaired selector on the second run', async () => {
        const { generate, run, report, verify } = makeRun();
        run.mockImplementationOnce(report([titleB])).mockImplementationOnce(report());
        generate.mockResolvedValueOnce(patch(oldLocator, newLocator));

        const result = await verify();
        expect(result).toMatchObject({ verificationStatus: 'VERIFIED', droppedScenarios: [], runs: 2 });
        expect(result.code).toContain(newLocator);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][0]).toContain(timeout);
    });

    test('keeps an externally blocked scenario without calling repair', async () => {
        const { generate, run, report, verify } = makeRun();
        run.mockImplementationOnce(report([titleB], [titleB]));

        expect(await verify()).toEqual({
            code, verificationStatus: 'NEEDS_EXTERNAL_CONFIG', droppedScenarios: [], runs: 1,
            externalRequirements: [{ id: 'stripe', label: 'Stripe', variables: ['STRIPE_SECRET_KEY'], scenarios: [titleB] }],
        });
        expect(generate).not.toHaveBeenCalled();
    });

    test('keeps the selector repair alongside an externally blocked scenario', async () => {
        const { generate, run, report, verify } = makeRun();
        run.mockImplementationOnce(report([titleA, titleB], [titleA])).mockImplementationOnce(report([titleA], [titleA]));
        generate.mockResolvedValueOnce(patch(oldLocator, newLocator));

        const result = await verify();
        expect(result).toMatchObject({
            verificationStatus: 'NEEDS_EXTERNAL_CONFIG', droppedScenarios: [], runs: 2,
            externalRequirements: [{ id: 'stripe', label: 'Stripe', variables: ['STRIPE_SECRET_KEY'], scenarios: [titleA] }],
        });
        expect(result.code).toContain(newLocator);
        expect(result.code).toContain(titleA);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][0]).not.toContain('Backend connection reset');
    });

    test('drops a scenario that still fails after two repairs', async () => {
        const { generate, run, report, verify } = makeRun();
        run.mockImplementation(report([titleB]));
        generate.mockResolvedValueOnce(patch(oldLocator, newLocator))
            .mockResolvedValueOnce(patch(newLocator, finalLocator));

        const result = await verify();
        expect(result).toMatchObject({
            verificationStatus: 'PARTIAL',
            droppedScenarios: [{ title: titleB, error: timeout }],
            runs: 3,
        });
        expect(result.code).toContain(titleA);
        expect(result.code).not.toContain(titleB);
        expect(generate).toHaveBeenCalledTimes(2);
    });

    test('fails verification when every scenario fails', async () => {
        const { generate, run, report, verify } = makeRun();
        run.mockImplementation(report([titleA, titleB]));
        generate.mockResolvedValueOnce(patch(oldLocator, newLocator))
            .mockResolvedValueOnce(patch(newLocator, finalLocator));

        await expect(verify()).resolves.toEqual({
            code,
            verificationStatus: 'FAILED',
            droppedScenarios: [{ title: titleA, error: timeout }, { title: titleB, error: timeout }],
            runs: 3,
        });
    });

    test('keeps the original code when the runner throws', async () => {
        const { rootDir, generate, run, verify } = makeRun();
        run.mockRejectedValue(new Error('Docker unavailable'));

        await expect(verify()).resolves.toEqual({
            code,
            verificationStatus: 'NOT_VERIFIED',
            verificationError: 'Docker unavailable',
            droppedScenarios: [],
            runs: 1,
        });
        expect(generate).not.toHaveBeenCalled();
        expect(fs.readdirSync(rootDir)).toEqual([]);
    });

    test('removes nested string and template title declarations by AST', () => {
        const source = "test.describe('Tasks', () => {\r\n"
            + "test('remove string', () => {});\r\n"
            + "test.only(`remove template`, () => {});\r\n"
            + "test('keep', () => { console.log('remove string'); });\r\n"
            + "});\r\n";
        expect(removePlaywrightTests(source, ['remove string', 'remove template'])).toBe(
            "test.describe('Tasks', () => {\r\ntest('keep', () => { console.log('remove string'); });\r\n});\r\n",
        );
    });

    test('collects final outcomes from nested suites and cleans error text', () => {
        const report = { suites: [{ suites: [{ specs: [
            { title: titleA, tests: [{ results: [{ status: 'failed' }, { status: 'passed' }] }] },
            { title: titleB, tests: [{ results: [{
                status: 'timedOut', errors: [{ message: `\u001b[31m${'x'.repeat(1600)}\u001b[0m` }, { message: 'ignored' }],
            }] }] },
        ] }] }] };
        expect(collectPlaywrightOutcomes(report)).toEqual([
            { title: titleA, status: 'passed', error: '' },
            { title: titleB, status: 'timedOut', error: 'x'.repeat(1500) },
        ]);
    });
});
