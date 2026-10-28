import { describe, expect, it } from '@jest/globals';
import { EXECUTION_LIMITS, normalizeExecutionDetails, remapExecutionLocations } from '../services/systemTestExecutionDetails.service.js';

const normalize = test => normalizeExecutionDetails({ runner: 'playwright', test, rootDir: 'D:/private/repo' });
describe('execution report details', () => {
    it('preserves failed retries, expected outcomes, real timing and nested steps', () => {
        const result = normalize({ expectedStatus: 'failed', status: 'flaky', results: [
            { retry: 0, status: 'failed', startTime: '2026-10-12T00:00:01Z', duration: 500, error: { message: 'timeout' }, steps: [
                { title: 'Login', duration: 300, steps: [{ title: 'Submit', duration: 0, error: { message: 'missing button' } }] },
            ] },
            { retry: 1, status: 'passed', startTime: '2026-10-12T00:00:02Z', duration: 100 },
        ] });
        expect(result).toMatchObject({ version: 1, expectedStatus: 'failed', outcome: 'flaky', truncated: false });
        expect(result.attempts.map(a => a.status)).toEqual(['failed', 'passed']);
        expect(result.attempts[0]).toMatchObject({ startTime: '2026-10-12T00:00:01.000Z', durationMs: 500, timingSource: 'runner' });
        expect(result.attempts[0].steps[0].steps[0]).toMatchObject({ status: 'failed', durationMs: 0, error: 'missing button' });
    });
    it('keeps zero, skipped and unavailable timing without inventing steps', () => {
        const result = normalize({ results: [{ status: 'skipped', duration: 0 }, { status: 'passed', startTime: 'bad', duration: -3 }, null] });
        expect(result.attempts[0]).toMatchObject({ status: 'skipped', durationMs: 0, startTime: null, steps: [] });
        expect(result.attempts[1]).toMatchObject({ durationMs: null, startTime: null, timingSource: 'unavailable' });
        expect(result.attempts[2].status).toBe('unknown');
    });
    it('accepts Cypress attempt timing only when actually reported', () => {
        const result = normalizeExecutionDetails({ runner: 'cypress', test: { state: 'passed', attempts: [
            { state: 'failed', wallClockStartedAt: '2026-10-12T00:00:00Z', wallClockDuration: 42 },
            { state: 'passed', duration: 0 },
        ] } });
        expect(result.attempts[0]).toMatchObject({ status: 'failed', durationMs: 42, timingSource: 'runner' });
        expect(result.attempts[1]).toMatchObject({ status: 'passed', durationMs: 0, startTime: null });
        expect(normalizeExecutionDetails({ runner: 'cypress', test: { state: 'passed' } }).attempts).toEqual([]);
    });
    it('bounds attempts, total steps, recursive depth, text and excludes attachments', () => {
        let nested = { title: 'end', duration: 0 };
        for (let i = 0; i < 30; i++) nested = { title: 'nested', steps: [nested] };
        const result = normalize({ results: Array.from({ length: 30 }, () => ({
            status: 'passed', attachments: [{ body: 'SECRET' }], stdout: ['SECRET'],
            steps: [nested, ...Array.from({ length: 500 }, () => ({ title: 'x'.repeat(10000), error: { message: 'y'.repeat(10000) } }))],
        })) });
        const count = steps => steps.reduce((n, step) => n + 1 + count(step.steps), 0);
        expect(result.attempts).toHaveLength(EXECUTION_LIMITS.attempts);
        expect(result.attempts.reduce((n, a) => n + count(a.steps), 0)).toBeLessThanOrEqual(EXECUTION_LIMITS.steps);
        expect(result.truncated).toBe(true);
        expect(result.attempts[0].steps.at(-1).status).toBe('failed');
        expect(JSON.stringify(result)).not.toContain('SECRET');
        expect(JSON.stringify(result).length).toBeLessThan(130000);
    });
    it('redacts credentials and host paths and remaps generated spec locations', () => {
        const result = normalize({ results: [{ error: { message: 'token=abc Bearer xyz mysql://user:pwd@host D:/private/repo/tests/a.js C:/Users/private/b.js' }, steps: [
            { title: 'password=secret', location: { file: 'D:/private/repo/.covai-system-test/specs/uuid.spec.js', line: 7 } },
            { title: 'external', location: { file: '/home/private/file.js' } },
        ] }] });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toMatch(/abc|xyz|pwd|Users|private|password=secret/);
        expect(result.attempts[0].steps[1].location.file).toBe('file.js');
        const remapped = remapExecutionLocations(result, 'D:/private/repo', { 'uuid.spec.js': 'tests/e2e/login.spec.js' });
        expect(remapped.attempts[0].steps[0].location).toMatchObject({ file: 'tests/e2e/login.spec.js', line: 7 });
    });
});
