import { describe, it, expect, jest, afterAll, beforeEach } from '@jest/globals';

const generateContent = jest.fn();
const getGenerativeModel = jest.fn(() => ({ generateContent }));

await jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(...args) {
      return getGenerativeModel(...args);
    }
  },
}));

const previousKey = process.env.GEMINI_API_KEY;
const previousModel = process.env.GEMINI_MODEL;
process.env.GEMINI_API_KEY = 'unit-test-key';
process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';

const { generateText } = await import('../services/gemini.service.js');

afterAll(() => {
  if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKey;
  if (previousModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = previousModel;
});

beforeEach(() => {
  generateContent.mockReset();
  getGenerativeModel.mockClear();
});

describe('Gemini 503 multi-model overload failover', () => {
  it('cascades through AI_MODELS when primary and secondary models return 503', async () => {
    const busyError = (model) =>
      Object.assign(new Error(`[503 Service Unavailable] ${model} overloaded`), { status: 503 });

    generateContent
      .mockRejectedValueOnce(busyError('gemini-3.5-flash-lite'))
      .mockRejectedValueOnce(busyError('gemini-3.5-flash-lite'))
      .mockRejectedValueOnce(busyError('gemini-3.1-flash-lite'))
      .mockResolvedValueOnce({
        response: {
          text: () => '{"ok":true}',
          candidates: [],
        },
      });

    const result = await generateText('generate integration suite', null, {
      maxAttempts: 2,
      retryBaseDelayMs: 0,
      returnTelemetry: true,
    });

    expect(result.text).toBe('{"ok":true}');
    expect(result.telemetry.model).toBe('gemini-3.8-flash');
    expect(getGenerativeModel.mock.calls.map(([opts]) => opts.model)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
    ]);
  });

  it('fails over on 503 even when caller passed default modelName unless strictModel is true', async () => {
    const busy = Object.assign(new Error('[503 Service Unavailable] high demand'), { status: 503 });

    generateContent
      .mockRejectedValueOnce(busy)
      .mockResolvedValueOnce({
        response: {
          text: () => 'recovered',
          candidates: [],
        },
      });

    const recovered = await generateText('prompt', 'gemini-3.5-flash-lite', {
      maxAttempts: 1,
      retryBaseDelayMs: 0,
    });
    expect(recovered).toBe('recovered');
    expect(getGenerativeModel.mock.calls.map(([opts]) => opts.model)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ]);

    getGenerativeModel.mockClear();
    generateContent.mockRejectedValueOnce(busy);

    await expect(
      generateText('prompt', 'gemini-3.5-flash-lite', {
        maxAttempts: 1,
        retryBaseDelayMs: 0,
        strictModel: true,
      }),
    ).rejects.toThrow('503 Service Unavailable');
    expect(getGenerativeModel.mock.calls.map(([opts]) => opts.model)).toEqual([
      'gemini-3.5-flash-lite',
    ]);
  });
});
