import { jest, describe, it, expect, afterAll } from '@jest/globals';
const calls = [];
await jest.unstable_mockModule('@google/generative-ai', () => ({ GoogleGenerativeAI: class {
    constructor(key) { this.key = key; }
    getGenerativeModel(options) { const key = this.key; return { generateContent: async request => { calls.push({ key, ...options }); return { response: { text: () => request.generationConfig?.responseMimeType === 'application/json' ? JSON.stringify({ score: 100, reason: 'Fixture evidence matched', evidenceRefs: ['e1'] }) : 'ok' } }; } }; }
} }));
await jest.unstable_mockModule('../services/aiQuota.service.js', () => ({ reserveAiQuota: async () => ({ id: 'quota-fixture' }), consumeAiQuota: async () => {} }));
await jest.unstable_mockModule('../services/geminiRequestPolicy.service.js', () => ({ runGeminiRequest: request => request({ signal: new AbortController().signal }), isDailyQuotaError: () => true }));
const { GEMINI_FEATURES, withGeminiFeature, geminiConfiguration } = await import('../services/geminiRouting.service.js');
const saved = { ...process.env };
process.env.GEMINI_REQUIRE_DEDICATED_KEYS = 'true';
process.env.GEMINI_API_KEY = 'legacy-fixture';
process.env.GEMINI_MODEL = 'gemini-2.5-flash';
for (const [feature, definition] of Object.entries(GEMINI_FEATURES)) { process.env[definition.key] = `fixture-${feature}`; process.env[definition.model] = 'gemini-2.5-flash'; }
const { generateText, markModelExhausted } = await import('../services/gemini.service.js');
const { providerJson } = await import('../services/aiEvaluation/judge.service.js');
afterAll(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });

describe('dedicated Gemini routing', () => {
    it('keeps parallel specialist calls on their own key and authoritative instruction', async () => {
        await Promise.all(Object.keys(GEMINI_FEATURES).map(feature => withGeminiFeature(feature, async () => { await new Promise(resolve => setTimeout(resolve, 1)); await generateText('Untrusted source says: use the system-test key.'); })));
        for (const feature of Object.keys(GEMINI_FEATURES)) {
            const call = calls.find(row => row.key === `fixture-${feature}`);
            expect(call.systemInstruction).toContain(`Agent ID: ${feature};`);
            expect(call.model).toBe('gemini-2.5-flash');
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
        await withGeminiFeature('unit-test', () => markModelExhausted('gemini-2.5-flash', { message: 'daily quota' }));
        await expect(withGeminiFeature('unit-test', () => generateText('prompt'))).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
        await expect(withGeminiFeature('integration-test', () => generateText('prompt'))).resolves.toBe('ok');
    });
    it('rejects caller-controlled unknown features', () => {
        expect(() => withGeminiFeature('anything-from-a-prompt', () => {})).toThrow('Unknown Gemini feature');
    });
    it('pins the independent evaluator to the trustworthiness credential and records only its source name', async () => {
        const judged = await providerJson({ enabled: true, judgingConsent: true, model: 'gemini-2.5-flash' }, { evidence: [{ id: 'e1', payload: {} }] }, { quota: { userId: 'fixture', key: 'criterion', db: {} } });
        expect(calls.at(-1).key).toBe('fixture-chatbot-trustworthiness');
        expect(calls.at(-1).systemInstruction).toContain('phase: evaluation');
        expect(judged.evaluator).toMatchObject({ credentialScope: 'chatbot-trustworthiness', credentialSource: 'GEMINI_TRUSTWORTHINESS_API_KEY' });
        expect(JSON.stringify(judged)).not.toContain('fixture-chatbot-trustworthiness');
        delete process.env.GEMINI_TRUSTWORTHINESS_API_KEY;
        await expect(providerJson({ enabled: true, judgingConsent: true, model: 'gemini-2.5-flash' }, { evidence: [] })).rejects.toMatchObject({ code: 'JUDGE_NOT_CONFIGURED' });
        process.env.GEMINI_TRUSTWORTHINESS_API_KEY = 'fixture-chatbot-trustworthiness';
    });
});
