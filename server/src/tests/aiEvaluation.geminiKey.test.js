import { expect, jest, test } from '@jest/globals';
import { z } from 'zod';

const topicMap = {
    language: 'en',
    domainSummary: 'x',
    coveredTopics: ['a'],
    adjacentOutOfScopeTopics: ['b'],
};
const constructorKeys = [];

jest.unstable_mockModule('@google/generative-ai', () => ({
    GoogleGenerativeAI: class {
        constructor(key) {
            constructorKeys.push(key);
        }

        getGenerativeModel() {
            return {
                generateContent: async () => ({
                    response: {
                        text: () => JSON.stringify(topicMap),
                        usageMetadata: null,
                        modelVersion: 'm',
                        candidates: [],
                    },
                }),
            };
        }
    },
}));

jest.unstable_mockModule('../services/aiQuota.service.js', () => ({
    reserveAiQuota: async () => ({ id: 'r' }),
    consumeAiQuota: async () => {},
}));

const { dispatchValidatedGeminiJson } = await import('../services/aiEvaluation/judge.service.js');

test('uses the chatbox Gemini key for topic maps', async () => {
    const previousKey = process.env.GEMINI_KEY_CHATBOX;
    process.env.GEMINI_KEY_CHATBOX = 'test-chatbox-key';

    try {
        await expect(dispatchValidatedGeminiJson({
            selectedModel: 'gemini-2.5-flash',
            purpose: 'topic_map',
            basePrompt: {},
            schema: z.object({
                language: z.string(),
                domainSummary: z.string(),
                coveredTopics: z.array(z.string()),
                adjacentOutOfScopeTopics: z.array(z.string()),
            }),
            provider: undefined,
            quota: { userId: 'user', key: 'topic-map', db: {} },
            fallback: null,
        })).resolves.toMatchObject({ result: topicMap });

        expect(constructorKeys).toEqual(['test-chatbox-key']);
    } finally {
        if (previousKey === undefined) {
            delete process.env.GEMINI_KEY_CHATBOX;
        } else {
            process.env.GEMINI_KEY_CHATBOX = previousKey;
        }
    }
});
