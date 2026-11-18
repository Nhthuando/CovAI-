import { afterAll, describe, expect, it, jest } from '@jest/globals';

const generateContent = jest.fn().mockResolvedValue({
  response: {
    text: () => 'ok',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
  },
});
const incrementTokenUsage = jest.fn().mockResolvedValue(undefined);

await jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent }; }
  },
}));
await jest.unstable_mockModule('../services/geminiRequestPolicy.service.js', () => ({
  runGeminiRequest: jest.fn(async request => request({ signal: new AbortController().signal })),
  isDailyQuotaError: () => false,
}));
await jest.unstable_mockModule('../services/aiJobBudget.service.js', () => ({
  currentAiJobBudget: () => undefined,
}));
await jest.unstable_mockModule('../services/geminiTokenTracker.service.js', () => ({
  withGeminiChannel: jest.fn((channel, callback) => callback()),
  getCurrentGeminiChannel: () => 'integration',
  recordGeminiTokenUsage: jest.fn(),
  recordGeminiRateLimit: jest.fn(),
}));
await jest.unstable_mockModule('../services/aiQuota.service.js', () => ({
  incrementTokenUsage,
}));

const previousKey = process.env.GEMINI_API_KEY;
const previousMode = process.env.AI_PROVIDER_MODE;
process.env.GEMINI_API_KEY = 'test';
process.env.AI_PROVIDER_MODE = 'live';
const { generateText, generateTextWithTelemetry } = await import('../services/gemini.service.js');

afterAll(() => {
  if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKey;
  if (previousMode === undefined) delete process.env.AI_PROVIDER_MODE;
  else process.env.AI_PROVIDER_MODE = previousMode;
});

describe('Gemini provider configuration', () => {
  it.each([
    ['generateText', generateText],
    ['generateTextWithTelemetry', generateTextWithTelemetry],
  ])('%s keeps internal fields out of the provider request', async (name, generate) => {
    const result = await generate('prompt', null, null, { temperature: 0.2, userId: 'u1' });
    const config = generateContent.mock.calls.at(-1)[0].generationConfig;

    expect(config.temperature).toBe(0.2);
    expect(config).not.toHaveProperty('returnTelemetry');
    expect(config).not.toHaveProperty('userId');
    if (name === 'generateTextWithTelemetry') {
      expect(result).toMatchObject({ text: 'ok', telemetry: { tokens: { total: 12 } } });
    } else {
      expect(result).toBe('ok');
    }
  });
});
