import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { z } from 'zod';
import { dispatchValidatedGeminiJson, parseModelJsonWithRepair } from '../services/aiEvaluation/judge.service.js';

const schema = z.object({ scenarios: z.array(z.object({ a: z.string() })) });
const request = {
    selectedModel: 'gemini-3.5-flash-lite',
    purpose: 'scenario_suite',
    systemInstruction: 'Return a JSON object.',
    basePrompt: { task: 'Generate scenarios' },
    schema,
};

afterEach(() => {
    jest.restoreAllMocks();
});

describe('AI question generation diagnostics', () => {
    test('wraps a bare array for a single array field', () => {
        expect(parseModelJsonWithRepair('[{"a":"x"}]', schema)).toEqual({ scenarios: [{ a: 'x' }] });
    });

    test('still rejects primitive output', () => {
        expect(() => parseModelJsonWithRepair('"hello"', schema)).toThrow('Structured output must be a JSON object');
    });

    test('stops after one format attempt when the provider is busy', async () => {
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const original = Object.assign(new Error('[503 Service Unavailable] high demand'), { status: 503 });
        const provider = jest.fn(async () => { throw original; });
        const callsBefore = provider.mock.calls.length;

        await expect(dispatchValidatedGeminiJson({ ...request, provider })).rejects.toMatchObject({
            code: 'AI_PROVIDER_BUSY',
            cause: original,
        });

        expect(provider.mock.calls.length - callsBefore).toBeGreaterThan(0);
        expect(provider.mock.calls.length - callsBefore).toBeLessThanOrEqual(2);
        for (const [payload, meta] of provider.mock.calls) {
            expect(payload).not.toHaveProperty('formatRepair');
            expect(meta.formatAttempt).toBe(0);
        }
        // runGeminiRequest also warns about its own transport retry; count only the new diagnostic line.
        expect(warning.mock.calls.filter(([line]) => String(line).includes('provider error'))).toHaveLength(1);
    });

    test('reports truncated output and requests a shorter retry', async () => {
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const provider = jest.fn(async () => ({
            text: '{"scenarios":[{"a":',
            finishReason: 'MAX_TOKENS',
        }));

        await expect(dispatchValidatedGeminiJson({ ...request, provider })).rejects.toMatchObject({
            code: 'JUDGE_OUTPUT_TRUNCATED',
        });

        expect(provider).toHaveBeenCalledTimes(2);
        expect(provider.mock.calls[1][0].formatRepair).toMatch(/cut off/i);
        expect(warning).toHaveBeenCalledTimes(2);
        expect(warning.mock.calls[0][0]).toContain('finishReason=MAX_TOKENS');
    });
});
