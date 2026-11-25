import { describe, expect, jest, test } from '@jest/globals';
import { classifyTargetFailure, createTargetPacer } from '../services/aiEvaluation/targetRateLimit.js';
import { representativeScore } from '../services/aiEvaluation/scoring.service.js';

function targetHttpError(status, message, body) {
    const error = Object.assign(new Error(message), {
        code: status === 429 ? 'TARGET_RATE_LIMIT' : 'TARGET_HTTP_ERROR',
        details: { targetStatus: status },
    });
    return Object.defineProperty(error, 'targetBody', { value: body });
}

const googleRateLimit = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. ... [{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"x","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"15"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37s"}]';

describe('classifyTargetFailure', () => {
    const googleFetchFailure = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent: fetch failed';

    test.each([
        [500, googleFetchFailure, 'TRANSIENT'],
        [502, 'socket hang up', 'TRANSIENT'],
        [400, googleFetchFailure, 'OTHER'],
        [500, '429 Too Many Requests: fetch failed', 'RATE_LIMIT'],
    ])('classifies HTTP %i with body %s as %s', (status, body, kind) => {
        const error = targetHttpError(status, `Your chatbot returned HTTP ${status}`, body);
        expect(classifyTargetFailure(error)).toEqual({ kind, retryAfterMs: null, intervalMs: null });
    });

    test('reads Google retry and quota metadata from an HTTP 500 body', () => {
        const body = JSON.stringify({ success: false, error: googleRateLimit });
        const expected = { kind: 'RATE_LIMIT', retryAfterMs: 37_000, intervalMs: 4600 };
        expect(classifyTargetFailure(targetHttpError(500, 'Your chatbot returned HTTP 500', body))).toEqual(expected);
        expect(classifyTargetFailure(targetHttpError(500, 'Your chatbot returned HTTP 500', JSON.stringify(body)))).toEqual(expected);
    });

    test.each([
        ['PerDay', 'DAILY_QUOTA'],
        ['PerMinute and PerDay', 'DAILY_QUOTA'],
        ['PerMinute, limit: 0', 'RATE_LIMIT'],
    ])('classifies Google quota marker %s', (marker, kind) => {
        const body = JSON.stringify({ success: false, error: googleRateLimit.replace('PerMinute', marker) });
        expect(classifyTargetFailure(targetHttpError(500, 'Your chatbot returned HTTP 500', body)).kind).toBe(kind);
    });

    test.each([
        [429, 'Rate limit reached. Please try again in 20s', 'RATE_LIMIT', 20_000],
        [429, 'Rate limit reached. Please try again in 1.5m', 'RATE_LIMIT', 90_000],
        [429, 'Rate limit reached. Please try again in 20ms', 'RATE_LIMIT', 20],
        [500, 'RESOURCE_EXHAUSTED, retry in 3.5 s', 'RATE_LIMIT', 3500],
        [429, 'insufficient_quota', 'DAILY_QUOTA', null],
        [503, 'high demand', 'TRANSIENT', null],
        [400, 'message required', 'OTHER', null],
    ])('classifies HTTP %i with %s', (status, message, kind, retryAfterMs) => {
        expect(classifyTargetFailure(targetHttpError(status, message))).toEqual({ kind, retryAfterMs, intervalMs: null });
    });
});

describe('createTargetPacer', () => {
    const noHint = { retryAfterMs: null, intervalMs: null };

    function fakeClock(options) {
        let time = 0;
        const pending = [];
        const sleep = jest.fn((ms, signal) => new Promise(resolve => {
            pending.push({ until: time + ms, resolve });
            signal?.addEventListener('abort', resolve, { once: true });
        }));
        return {
            sleep,
            pacer: createTargetPacer({ ...options, sleep, now: () => time }),
            advanceTo(target) {
                time = target;
                while (pending[0]?.until <= time) pending.shift().resolve();
            },
        };
    }

    test('starts unpaced and spaces parallel requests after the shared cooldown', async () => {
        const { pacer, sleep, advanceTo } = fakeClock();
        await Promise.all([pacer.beforeRequest(), pacer.beforeRequest()]);
        expect(sleep).not.toHaveBeenCalled();

        const hint = { retryAfterMs: 37_000, intervalMs: 4600 };
        expect(pacer.onRateLimit(hint, 0)).toBe(true);
        expect(pacer.onRateLimit(hint, 0)).toBe(true);
        expect(pacer.totalWaitMs).toBe(38_500);
        expect(pacer.waitingUntil).toBe(38_500);

        const first = pacer.beforeRequest();
        const second = pacer.beforeRequest();
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([38_500, 43_100]);
        advanceTo(38_500);
        await first;
        advanceTo(43_100);
        await second;
    });

    test('extends an existing wait and charges only the additional cooldown', async () => {
        const { pacer, sleep, advanceTo } = fakeClock();
        expect(pacer.onRateLimit(noHint, 0)).toBe(true);
        const request = pacer.beforeRequest();
        advanceTo(1000);
        expect(pacer.onRateLimit(noHint, 1)).toBe(true);
        expect(pacer.totalWaitMs).toBe(41_000);
        advanceTo(20_000);
        await Promise.resolve();
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([20_000, 21_000]);
        advanceTo(41_000);
        await request;
    });

    test('rejects a new cooldown when it would exceed the total budget', () => {
        const { pacer, advanceTo } = fakeClock({ maxTotalWaitMs: 30_000 });
        expect(pacer.onRateLimit(noHint, 0)).toBe(true);
        advanceTo(20_000);
        expect(pacer.onRateLimit(noHint, 0)).toBe(false);
        expect(pacer.totalWaitMs).toBe(20_000);
    });

    test('daily quota interrupts pending waits and rejects later requests with the same error', async () => {
        const { pacer } = fakeClock();
        pacer.onRateLimit(noHint, 0);
        const request = pacer.beforeRequest();
        const error = new Error('Daily quota exhausted');
        pacer.onDailyQuota(error);
        expect(pacer.dailyQuotaError).toBe(error);
        await expect(request).rejects.toBe(error);
        await expect(pacer.beforeRequest()).rejects.toBe(error);
    });

    test('aborting the request ends its wait', async () => {
        const { pacer } = fakeClock();
        const controller = new AbortController();
        pacer.onRateLimit(noHint, 0);
        const request = pacer.beforeRequest(controller.signal);
        const reason = new Error('Canceled');
        controller.abort(reason);
        await expect(request).rejects.toBe(reason);
    });
});

describe('representativeScore', () => {
    test('hides a partial score when only 11 of 28 checks were graded', () => {
        expect(representativeScore({
            score: 91.67,
            partial: true,
            completeness: { scored: 11, applicable: 28 },
            tasks: [
                { taskType: 'KNOWLEDGE_QA', score: 91.67, applicable: 16 },
                { taskType: 'MULTI_TURN', score: null, applicable: 12 },
            ],
        })).toEqual({ value: null, partial: true, scored: 11, applicable: 28, hidden: true });
    });

    test.each([
        { scored: 7, applicable: 10, partial: true, tasks: [], hidden: true },
        { scored: 8, applicable: 10, partial: true, tasks: [], hidden: false },
        { scored: 9, applicable: 10, partial: true, tasks: [{ score: null, applicable: 1 }], hidden: true },
        { scored: 9, applicable: 10, partial: true, tasks: [{ score: null, applicable: 0 }], hidden: false },
        { scored: 7, applicable: 10, partial: false, tasks: [], hidden: false },
        { scored: 10, applicable: 10, partial: false, tasks: [], hidden: false },
        { scored: 0, applicable: 0, partial: true, tasks: [], hidden: false },
        { scored: 0, applicable: 10, partial: true, tasks: undefined, hidden: false },
    ])('returns hidden=$hidden for $scored/$applicable checks with summary.partial=$partial', ({
        scored, applicable, partial, tasks, hidden,
    }) => {
        expect(representativeScore({ score: 90, partial, completeness: { scored, applicable }, tasks }))
            .toEqual({ value: hidden ? null : 90, partial: scored < applicable, scored, applicable, hidden });
    });

    test('tolerates missing summary and completeness', () => {
        const empty = { value: null, partial: false, scored: 0, applicable: 0, hidden: false };
        expect(representativeScore()).toEqual(empty);
        expect(representativeScore({ score: 0, partial: true, tasks: [{ score: null, applicable: 1 }] }))
            .toEqual({ ...empty, value: 0 });
    });
});
