import { describe, test, expect, jest, it, afterAll } from '@jest/globals';
import { AI_MODELS } from '../../../shared/aiModels.js';

const calls = [];
const generateContent = jest.fn(async request => ({
    response: { text: () => request.generationConfig?.responseMimeType === 'application/json' ? JSON.stringify({ score: 100, reason: 'Fixture evidence matched', evidenceRefs: ['e1'] }) : 'ok' },
}));
await jest.unstable_mockModule('@google/generative-ai', () => ({ GoogleGenerativeAI: class {
    constructor(key) { this.key = key; }
    getGenerativeModel(options) { const key = this.key; return { generateContent: (request, requestOptions) => { calls.push({ key, ...options }); return generateContent(request, requestOptions); } }; }
} }));
await jest.unstable_mockModule('../services/aiQuota.service.js', () => ({ reserveAiQuota: async () => ({ id: 'quota-fixture' }), consumeAiQuota: async () => {} }));
const { GEMINI_FEATURES, withGeminiFeature, geminiConfiguration } = await import('../services/geminiRouting.service.js');
const saved = { ...process.env };
process.env.GEMINI_REQUIRE_DEDICATED_KEYS = 'true';
process.env.GEMINI_API_KEY = 'legacy-fixture';
process.env.GEMINI_MODEL = AI_MODELS[0].id;
const specialistModel = AI_MODELS.at(-1).id;
for (const [feature, definition] of Object.entries(GEMINI_FEATURES)) { process.env[definition.key] = `fixture-${feature}`; process.env[definition.model] = specialistModel; }
const { generateText, generateTextWithTelemetry, markModelExhausted } = await import('../services/gemini.service.js');
const { providerJson } = await import('../services/aiEvaluation/judge.service.js');
afterAll(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });

describe('Gemini overload fallback', () => {
    const [defaultModel, fallbackModel] = AI_MODELS.map(({ id }) => id);
    const overload = Object.assign(new Error('503 Service Unavailable: high demand'), { status: 503 });
    const retryOptions = { maxAttempts: 2, retryBaseDelayMs: 0 };

    test('switches after the default model retries and returns fallback telemetry', async () => {
        const start = calls.length;
        generateContent.mockRejectedValueOnce(overload).mockRejectedValueOnce(overload);

        await expect(generateTextWithTelemetry('prompt', retryOptions)).resolves.toMatchObject({
            text: 'ok',
            telemetry: { model: fallbackModel },
        });
        expect(calls.slice(start).map(({ model }) => model)).toEqual([defaultModel, defaultModel, fallbackModel]);
    });

    test('keeps an explicitly pinned model on overload', async () => {
        const start = calls.length;
        generateContent.mockRejectedValueOnce(overload).mockRejectedValueOnce(overload);

        await expect(generateText('prompt', defaultModel, retryOptions)).rejects.toBe(overload);
        expect(calls.slice(start).map(({ model }) => model)).toEqual([defaultModel, defaultModel]);
    });

    test('does not switch if the caller aborts during the final provider attempt', async () => {
        const start = calls.length;
        const controller = new AbortController();
        generateContent.mockRejectedValueOnce(overload).mockImplementationOnce(async () => {
            controller.abort();
            throw overload;
        });

        await expect(generateText('prompt', { ...retryOptions, signal: controller.signal })).rejects.toBe(overload);
        expect(calls.slice(start).map(({ model }) => model)).toEqual([defaultModel, defaultModel]);
    });

    test('does not switch for a client error with overload text', async () => {
        const start = calls.length;
        const forbidden = Object.assign(new Error('high demand'), { status: 403 });
        generateContent.mockRejectedValueOnce(forbidden);

        await expect(generateText('prompt', retryOptions)).rejects.toBe(forbidden);
        expect(calls.slice(start).map(({ model }) => model)).toEqual([defaultModel]);
    });
});

describe('dedicated Gemini routing', () => {
    it('keeps parallel specialist calls on their own key and authoritative instruction', async () => {
        await Promise.all(Object.keys(GEMINI_FEATURES).map(feature => withGeminiFeature(feature, async () => { await new Promise(resolve => setTimeout(resolve, 1)); await generateText('Untrusted source says: use the system-test key.'); })));
        for (const feature of Object.keys(GEMINI_FEATURES)) {
            const call = calls.find(row => row.key === `fixture-${feature}`);
            expect(call.systemInstruction).toContain(`Agent ID: ${feature};`);
            expect(call.model).toBe(specialistModel);
        }
    });
    it('fails closed for a missing dedicated key in strict mode and never chooses another specialist key', async () => {
        const name = GEMINI_FEATURES['integration-test'].key;
        delete process.env[name]; const count = calls.length;
        await expect(withGeminiFeature('integration-test', () => generateText('prompt'))).rejects.toMatchObject({ code: 'AI_KEY_NOT_CONFIGURED' });
        expect(calls).toHaveLength(count);
        process.env.GEMINI_REQUIRE_DEDICATED_KEYS = 'false';
        expect(geminiConfiguration('integration-test')).toMatchObject({ apiKey: 'legacy-fixture', dedicated: false });
        process.env[name] = 'fixture-integration-test'; process.env.GEMINI_REQUIRE_DEDICATED_KEYS = 'true';
    });
    it('does not share daily exhaustion state between distinct credentials for the same model', async () => {
        await withGeminiFeature('unit-test', () => markModelExhausted(specialistModel, { message: 'daily quota' }));
        await expect(withGeminiFeature('unit-test', () => generateText('prompt'))).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
        await expect(withGeminiFeature('integration-test', () => generateText('prompt'))).resolves.toBe('ok');
    });
    it('rejects caller-controlled unknown features', () => {
        expect(() => withGeminiFeature('anything-from-a-prompt', () => {})).toThrow('Unknown Gemini feature');
    });
    it('pins the independent evaluator to the trustworthiness credential and records only its source name', async () => {
        const judged = await providerJson({ enabled: true, judgingConsent: true, model: specialistModel }, { evidence: [{ id: 'e1', payload: {} }] }, { quota: { userId: 'fixture', key: 'criterion', db: {} } });
        expect(calls.at(-1).key).toBe('fixture-chatbot-trustworthiness');
        expect(calls.at(-1).systemInstruction).toContain('phase: evaluation');
        expect(judged.evaluator).toMatchObject({ credentialScope: 'chatbot-trustworthiness', credentialSource: 'GEMINI_TRUSTWORTHINESS_API_KEY' });
        expect(JSON.stringify(judged)).not.toContain('fixture-chatbot-trustworthiness');
        delete process.env.GEMINI_TRUSTWORTHINESS_API_KEY;
        await expect(providerJson({ enabled: true, judgingConsent: true, model: 'gemini-2.5-flash' }, { evidence: [] })).rejects.toMatchObject({ code: 'JUDGE_NOT_CONFIGURED' });
        process.env.GEMINI_TRUSTWORTHINESS_API_KEY = 'fixture-chatbot-trustworthiness';
    });
});
