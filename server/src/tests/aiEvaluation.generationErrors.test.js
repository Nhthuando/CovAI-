import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { z } from 'zod';
import { classifyProviderError, dispatchValidatedGeminiJson } from '../services/aiEvaluation/judge.service.js';
import { definitionSchema, parse, validateApproval } from '../services/aiEvaluation/contracts.js';

const model = 'gemini-2.5-flash';
const unavailableMessage = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [404 Not Found] This model models/gemini-2.5-flash is no longer available to new users.';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('provider error classification', () => {
    test('reports an unavailable model from the Google error text', () => {
        expect(classifyProviderError(new Error(unavailableMessage), model)).toEqual({
            code: 'AI_MODEL_UNAVAILABLE',
            status: 502,
            message: `The AI model "${model}" is not available for this API key. Pick another model in the test set settings.`,
        });
    });

    test.each([401, 403])('reports a rejected key for HTTP %s', status => {
        expect(classifyProviderError({ status }, model)).toEqual({
            code: 'AI_KEY_REJECTED', status: 502,
            message: `The AI provider rejected the API key (HTTP ${status}). Check the key and its permissions.`,
        });
    });

    test('keeps the request rejection detail and collapses whitespace', () => {
        expect(classifyProviderError(new Error('[400 Bad Request] Invalid\n  generation config'), model)).toEqual({
            code: 'AI_PROVIDER_REJECTED', status: 502,
            message: 'The AI provider rejected the request (HTTP 400): Invalid generation config',
        });
    });

    test('limits request rejection detail to 160 characters', () => {
        expect(classifyProviderError(new Error(`[400 Bad Request] ${'x'.repeat(200)}`), model).message)
            .toBe(`The AI provider rejected the request (HTTP 400): ${'x'.repeat(160)}`);
    });

    test('uses the numeric status before a message status and defaults the model name', () => {
        expect(classifyProviderError({ status: 404, message: '[403 Forbidden]' }).message)
            .toContain('"selected"');
    });

    test.each([
        { status: 429 },
        { status: 503 },
        new Error('[429 Too Many Requests] Try later'),
        new Error('[503 Service Unavailable] Try later'),
        new Error('bad json'),
        Object.assign(new Error('Timed out'), { code: 'AI_REQUEST_TIMEOUT' }),
    ])('leaves transient and parsing errors to existing handling: %p', error => {
        expect(classifyProviderError(error, model)).toBeNull();
    });
});

test('generation stops after one unavailable-model response', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = jest.fn().mockRejectedValue(new Error(unavailableMessage));

    await expect(dispatchValidatedGeminiJson({
        selectedModel: model,
        purpose: 'scenario_suite',
        systemInstruction: 'Return a JSON object.',
        basePrompt: { task: 'Generate scenarios' },
        schema: z.object({ scenarios: z.array(z.object({ a: z.string() })) }),
        provider,
    })).rejects.toMatchObject({ code: 'AI_MODEL_UNAVAILABLE', statusCode: 502 });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('provider error'));
});

describe('approval scoring errors', () => {
    test.each([
        [null, true, 'SCORING_THRESHOLD_REQUIRED', 'Set a pass mark (0-100) before approving.'],
        [null, false, 'SCORING_THRESHOLD_REQUIRED', 'Set a pass mark (0-100) before approving.'],
        [70, false, 'SCORING_UNCONFIRMED', 'Confirm the scoring weights and pass mark before approving.'],
    ])('reports threshold=%s confirmed=%s', (threshold, confirmed, code, message) => {
        const definition = parse(definitionSchema, { scoring: { threshold, confirmed } });
        expect(() => validateApproval(definition, [])).toThrow(expect.objectContaining({ code, message }));
    });
});
