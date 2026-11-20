import { test, expect } from '@jest/globals';
import { protectLlmBaseUrls } from '../services/aiEvaluation/chatbotRuntime.service.js';

const ownUrl = 'http://127.0.0.1:5555';

test('removes audited and known provider URLs while keeping app settings', () => {
    const env = { BASE_URL: ownUrl, OPENAI_BASE_URL: ownUrl, CLIENT_URL: ownUrl, PORT: '5555' };
    const removed = protectLlmBaseUrls(env, { auditNames: ['BASE_URL'], userEnv: {}, ownUrls: [ownUrl] });
    expect(removed).toEqual(['BASE_URL', 'OPENAI_BASE_URL']);
    expect(env).toEqual({ CLIENT_URL: ownUrl, PORT: '5555' });
});

test('preserves explicitly configured provider URLs', () => {
    const env = { BASE_URL: ownUrl };
    const removed = protectLlmBaseUrls(env, {
        auditNames: ['BASE_URL'],
        userEnv: { BASE_URL: 'https://openrouter.ai/api/v1' },
        ownUrls: [ownUrl],
    });
    expect(env.BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(removed).toEqual([]);
});

test('removes provider-pattern self URLs with trailing slashes and keeps generic backend URLs', () => {
    const env = { LLM_API_URL: `${ownUrl}/`, API_URL: ownUrl };
    expect(protectLlmBaseUrls(env, { ownUrls: [ownUrl] })).toEqual(['LLM_API_URL']);
    expect(env).toEqual({ API_URL: ownUrl });
});

test('honors case-sensitive own user settings for known and provider-pattern URLs', () => {
    const userEnv = Object.assign(Object.create({ OPENAI_BASE_URL: 'https://inherited.example' }), {
        LLM_API_URL: `${ownUrl}/`,
        base_url: 'https://different-case.example',
    });
    const env = { BASE_URL: ownUrl, OPENAI_BASE_URL: ownUrl, LLM_API_URL: ownUrl };
    expect(protectLlmBaseUrls(env, { auditNames: ['BASE_URL'], userEnv, ownUrls: [`${ownUrl}/`] }))
        .toEqual(['BASE_URL', 'OPENAI_BASE_URL']);
    expect(env).toEqual({ LLM_API_URL: `${ownUrl}/` });
});
