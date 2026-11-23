import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { z } from 'zod';
import { createOpenAiCaller, dispatchValidatedGeminiJson, judgeCaseCriteria, readEvaluatorFallbackConfig, resetGeminiBreaker } from '../services/aiEvaluation/judge.service.js';

const apiKey = 'test-openai-key';
const openAiConfig = { model: 'test-model', baseUrl: 'https://api.openai.com/v1', apiKey };
const systemInstruction = 'Return a JSON object.';

describe('readEvaluatorFallbackConfig', () => {
    test('requires the OpenAI provider and a key', () => {
        expect(readEvaluatorFallbackConfig({ AI_EVALUATION_FALLBACK_PROVIDER: 'openai' })).toBeNull();
        expect(readEvaluatorFallbackConfig({ AI_EVALUATION_FALLBACK_PROVIDER: 'gemini', OPENAI_API_KEY: apiKey })).toBeNull();
    });

    test('defaults the model and base URL', () => {
        expect(readEvaluatorFallbackConfig({ AI_EVALUATION_FALLBACK_PROVIDER: 'OpenAI', OPENAI_API_KEY: apiKey })).toEqual({
            provider: 'openai', model: 'gpt-6.2-sol', baseUrl: openAiConfig.baseUrl, apiKey, reasoningEffort: 'low',
        });
    });

    test('trims overrides and removes trailing slashes', () => {
        expect(readEvaluatorFallbackConfig({
            AI_EVALUATION_FALLBACK_PROVIDER: 'openai',
            AI_EVALUATION_FALLBACK_MODEL: ' test-model ',
            AI_EVALUATION_FALLBACK_REASONING_EFFORT: ' none ',
            OPENAI_BASE_URL: ' https://example.org/v1/// ',
            OPENAI_API_KEY: apiKey,
        })).toMatchObject({ model: 'test-model', baseUrl: 'https://example.org/v1', reasoningEffort: 'none' });
    });
});

describe('dispatchValidatedGeminiJson fallback', () => {
    const request = {
        selectedModel: 'gemini-3.8-flash',
        purpose: 'scenario_suite',
        systemInstruction,
        basePrompt: { task: 'Generate scenarios' },
        schema: z.object({ ok: z.boolean() }),
    };
    const busy = Object.assign(new Error('[503 Service Unavailable] high demand'), { status: 503 });
    const provider = async () => { throw busy; };
    const quotaError = Object.assign(new Error('quota'), { code: 'AI_APP_QUOTA_EXCEEDED' });
    const quotaProvider = async () => { throw quotaError; };

    beforeEach(() => {
        resetGeminiBreaker();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('validates and returns the fallback result with evaluator metadata', async () => {
        const signal = new AbortController().signal;
        const postValidate = jest.fn();
        const fallbackProvider = jest.fn(async () => ({ text: '{"ok":true}', actualModel: 'openai/test-model', usage: null }));

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallbackProvider, postValidate, signal })).resolves.toMatchObject({
            result: { ok: true },
            evaluator: {
                requestedModel: request.selectedModel,
                actualModel: 'openai/test-model',
                fallbackFrom: request.selectedModel,
                fallbackProvider: 'openai',
                attemptsUsed: 1,
            },
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(1);
        expect(fallbackProvider).toHaveBeenCalledWith({ ...request.basePrompt, model: request.selectedModel, purpose: request.purpose }, { signal });
        expect(postValidate).toHaveBeenCalledWith({ ok: true });
    });

    test('skips Gemini after a 503 until the breaker is reset', async () => {
        const geminiProvider = jest.fn(provider);
        const fallbackProvider = jest.fn().mockResolvedValue({ text: '{"ok":true}' });
        const options = { ...request, provider: geminiProvider, fallbackProvider };

        await expect(dispatchValidatedGeminiJson(options)).resolves.toMatchObject({ result: { ok: true } });
        expect(geminiProvider).toHaveBeenCalledTimes(1);
        expect(fallbackProvider).toHaveBeenCalledTimes(1);

        await expect(dispatchValidatedGeminiJson(options)).resolves.toMatchObject({ result: { ok: true } });
        expect(geminiProvider).toHaveBeenCalledTimes(1);
        expect(fallbackProvider).toHaveBeenCalledTimes(2);
        const openingMessage = `[AI Evaluation] ${request.selectedModel} is overloaded; using openai/injected for the next 5 minutes`;
        expect(console.warn.mock.calls.filter(([message]) => message === openingMessage)).toHaveLength(1);

        resetGeminiBreaker();
        await expect(dispatchValidatedGeminiJson(options)).resolves.toMatchObject({ result: { ok: true } });
        expect(geminiProvider).toHaveBeenCalledTimes(2);
        expect(fallbackProvider).toHaveBeenCalledTimes(3);
    });

    test('still calls Gemini without a fallback while the breaker is open', async () => {
        const geminiProvider = jest.fn(provider);
        const fallbackProvider = jest.fn().mockResolvedValue({ text: '{"ok":true}' });

        await dispatchValidatedGeminiJson({ ...request, provider: geminiProvider, fallbackProvider });
        geminiProvider.mockClear();
        await expect(dispatchValidatedGeminiJson({ ...request, provider: geminiProvider })).rejects.toMatchObject({
            code: 'AI_PROVIDER_BUSY', cause: busy,
        });
        expect(geminiProvider).toHaveBeenCalledTimes(2);
        expect(fallbackProvider).toHaveBeenCalledTimes(1);
    });

    test('uses OpenAI when the Gemini daily quota is exhausted', async () => {
        const fallbackProvider = jest.fn().mockResolvedValue({ text: '{"ok":true}' });

        await expect(dispatchValidatedGeminiJson({ ...request, provider: quotaProvider, fallbackProvider })).resolves.toMatchObject({
            result: { ok: true },
            evaluator: { fallbackFrom: request.selectedModel },
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith('[AI Evaluation] scenario_suite Gemini daily quota reached; using openai/injected');
    });

    test('keeps the quota error without a fallback', async () => {
        await expect(dispatchValidatedGeminiJson({ ...request, provider: quotaProvider })).rejects.toBe(quotaError);
    });

    test('keeps the quota error when the fallback fails', async () => {
        const fallbackProvider = jest.fn().mockRejectedValue({ status: 401 });

        await expect(dispatchValidatedGeminiJson({ ...request, provider: quotaProvider, fallbackProvider })).rejects.toBe(quotaError);
    });

    test('keeps the Gemini error when the fallback throws', async () => {
        const fallbackProvider = jest.fn(async () => { throw new Error(`Rejected key ${apiKey}`); });

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallback: openAiConfig, fallbackProvider })).rejects.toMatchObject({
            code: 'AI_PROVIDER_BUSY', cause: busy,
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith('[AI Evaluation] scenario_suite fallback failed (attempt 1/3): Rejected key [redacted]');
    });

    test('keeps the Gemini error when the fallback output fails validation', async () => {
        const fallbackProvider = jest.fn(async () => ({ text: '{"ok":"invalid"}' }));

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallbackProvider })).rejects.toMatchObject({
            code: 'AI_PROVIDER_BUSY', cause: busy,
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(3);
    });

    test('retries invalid fallback JSON with a format repair instruction', async () => {
        const fallbackProvider = jest.fn()
            .mockResolvedValueOnce({ text: 'not json' })
            .mockResolvedValueOnce({ text: '{"ok":true}' });

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallbackProvider })).resolves.toMatchObject({
            result: { ok: true },
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(2);
        expect(fallbackProvider).toHaveBeenNthCalledWith(2, {
            ...fallbackProvider.mock.calls[0][0],
            formatRepair: expect.stringContaining('Cite only evidence IDs listed in the data.'),
        }, { signal: undefined });
    });

    test('retries a rate-limited fallback with the original payload', async () => {
        const fallbackProvider = jest.fn()
            .mockRejectedValueOnce({ status: 429 })
            .mockResolvedValueOnce({ text: '{"ok":true}' });

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallbackProvider })).resolves.toMatchObject({
            result: { ok: true },
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(2);
        expect(fallbackProvider.mock.calls[1]).toEqual(fallbackProvider.mock.calls[0]);
    });

    test('retries two fallback network errors and succeeds on the third attempt', async () => {
        const fallbackProvider = jest.fn()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce({ text: '{"ok":true}' });

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallbackProvider })).resolves.toMatchObject({
            result: { ok: true },
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(3);
    });

    test('keeps the Gemini error after three fallback network errors', async () => {
        const fallbackProvider = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallbackProvider })).rejects.toMatchObject({
            code: 'AI_PROVIDER_BUSY', cause: busy,
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(3);
    });

    test('stops after an unauthorized fallback request', async () => {
        const fallbackProvider = jest.fn().mockRejectedValue({ status: 401 });

        await expect(dispatchValidatedGeminiJson({ ...request, provider, fallbackProvider })).rejects.toMatchObject({
            code: 'AI_PROVIDER_BUSY', cause: busy,
        });
        expect(fallbackProvider).toHaveBeenCalledTimes(1);
    });

    test('keeps the Gemini error without a fallback', async () => {
        await expect(dispatchValidatedGeminiJson({ ...request, provider })).rejects.toMatchObject({
            code: 'AI_PROVIDER_BUSY', cause: busy,
        });
    });
});

describe('judgeCaseCriteria evidence references', () => {
    const config = { enabled: true, judgingConsent: true };
    const input = {
        testCase: { caseKey: 'c1', taskType: 'HAPPY_PATH', turns: [{ content: 'Hi' }] },
        criteria: [{ key: 'appropriateRefusal' }],
        sources: [{ id: 'source-x', content: 'Source material' }],
        observations: [{ responses: [] }],
        evidence: [{ id: 'valid-1', payload: 'Conversation evidence' }],
    };
    const providerWithRefs = evidenceRefs => async () => ({
        text: JSON.stringify({ criteria: { appropriateRefusal: { reason: 'Reason', repetitionScores: [1], evidenceRefs } } }),
    });

    test('keeps only valid references when a criterion also cites a source ID', async () => {
        const provider = providerWithRefs(['valid-1', 'source-x']);

        await expect(judgeCaseCriteria(config, input, { provider })).resolves.toMatchObject({
            result: { criteria: { appropriateRefusal: { evidenceRefs: ['valid-1'] } } },
        });
    });

    test('rejects a criterion whose references are all invalid', async () => {
        const provider = providerWithRefs(['source-x']);

        await expect(judgeCaseCriteria(config, input, { provider })).rejects.toMatchObject({
            code: 'JUDGE_INVALID_JSON',
            message: expect.stringContaining('Criterion "appropriateRefusal" cited no valid evidence ID'),
        });
    });
});

describe('createOpenAiCaller', () => {
    test('requests a JSON object and maps the response', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                model: 'resolved-model',
                choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'length' }],
                usage: { total_tokens: 42 },
            }),
        }));
        const config = readEvaluatorFallbackConfig({
            AI_EVALUATION_FALLBACK_PROVIDER: 'openai', AI_EVALUATION_FALLBACK_MODEL: openAiConfig.model, OPENAI_API_KEY: apiKey,
        });
        const call = createOpenAiCaller(config, systemInstruction, 128, fetchImpl);
        const prompt = { task: 'Generate scenarios' };

        await expect(call(prompt, {})).resolves.toEqual({
            text: '{"ok":true}', actualModel: 'openai/resolved-model', usage: { totalTokenCount: 42 }, finishReason: 'MAX_TOKENS',
        });
        const [[url, options]] = fetchImpl.mock.calls;
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(options).toMatchObject({
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            signal: expect.any(AbortSignal),
        });
        expect(JSON.parse(options.body)).toEqual({
            model: 'test-model',
            messages: [
                { role: 'system', content: `${systemInstruction}\nReturn only one JSON object.` },
                { role: 'user', content: JSON.stringify(prompt) },
            ],
            response_format: { type: 'json_object' },
            max_completion_tokens: 128,
            reasoning_effort: 'low',
        });
    });

    test('omits reasoning effort when configured as none', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
        })));
        const call = createOpenAiCaller({ ...openAiConfig, reasoningEffort: 'none' }, systemInstruction, 128, fetchImpl);

        await call({}, {});

        expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');
    });

    test('retries a reasoning effort rejection once and remembers it for the model', async () => {
        const unsupported = () => new Response(JSON.stringify({
            error: { message: 'Unsupported parameter: reasoning_effort' },
        }), { status: 400 });
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(unsupported())
            .mockResolvedValueOnce(unsupported())
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
            })));
        const config = { ...openAiConfig, model: 'model-without-reasoning-effort', reasoningEffort: 'low' };
        const call = createOpenAiCaller(config, systemInstruction, 128, fetchImpl);

        await expect(call({}, {})).rejects.toMatchObject({ status: 400 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const [original, retry] = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
        expect(original).toEqual({ ...retry, reasoning_effort: 'low' });
        expect(retry).not.toHaveProperty('reasoning_effort');

        const nextCall = createOpenAiCaller(config, systemInstruction, 128, fetchImpl);
        await expect(nextCall({}, {})).resolves.toMatchObject({ text: '{}' });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual(retry);
    });

    test('reports HTTP errors with the API key redacted', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: false,
            status: 429,
            text: async () => JSON.stringify({ error: { message: `Rate limited for ${apiKey}` } }),
        }));
        const call = createOpenAiCaller(openAiConfig, systemInstruction, 4096, fetchImpl);
        const result = call({}, {});

        await expect(result).rejects.toMatchObject({ status: 429, message: 'OpenAI fallback HTTP 429: Rate limited for [redacted]' });
        await expect(result).rejects.not.toThrow(apiKey);
    });
});
