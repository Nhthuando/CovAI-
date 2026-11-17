import { describe, it, expect, beforeEach } from '@jest/globals';
import { getGeminiApiKey, getGeminiClient } from '../services/gemini.service.js';

describe('Gemini Modular API Key Provider & Factory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GEMINI_KEY_UNIT_TEST = 'key-unit-123';
    process.env.GEMINI_KEY_INTEGRATION_TEST = 'key-integration-456';
    process.env.GEMINI_KEY_E2E_TEST = 'key-e2e-789';
    process.env.GEMINI_KEY_CHATBOX = 'key-chatbox-012';
    process.env.GEMINI_API_KEY = 'key-default-fallback';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('resolves correct dedicated key for integration test module', () => {
    expect(getGeminiApiKey('integration')).toBe('key-integration-456');
    expect(getGeminiApiKey('supertest')).toBe('key-integration-456');
  });

  it('resolves correct dedicated key for unit test module', () => {
    expect(getGeminiApiKey('unit')).toBe('key-unit-123');
    expect(getGeminiApiKey('unit-test')).toBe('key-unit-123');
  });

  it('resolves correct dedicated key for e2e / system test module', () => {
    expect(getGeminiApiKey('e2e')).toBe('key-e2e-789');
    expect(getGeminiApiKey('system')).toBe('key-e2e-789');
  });

  it('resolves correct dedicated key for chatbox module', () => {
    expect(getGeminiApiKey('chatbox')).toBe('key-chatbox-012');
    expect(getGeminiApiKey('chat')).toBe('key-chatbox-012');
  });

  it('falls back to GEMINI_API_KEY when dedicated key is not defined', () => {
    delete process.env.GEMINI_KEY_INTEGRATION_TEST;
    expect(getGeminiApiKey('integration')).toBe('key-default-fallback');
  });

  it('instantiates and caches GoogleGenerativeAI client instance', () => {
    const client1 = getGeminiClient('integration');
    const client2 = getGeminiClient('integration');
    expect(client1).toBeDefined();
    expect(client1).toBe(client2);
  });
});

