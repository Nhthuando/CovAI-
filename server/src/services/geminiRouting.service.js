import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { ServiceError } from '../utils/serviceError.js';

export const GEMINI_FEATURES = Object.freeze({
    'chatbox': { key: 'GEMINI_CHATBOX_API_KEY', model: 'GEMINI_CHATBOX_MODEL' },
    'unit-test': { key: 'GEMINI_UNIT_TEST_API_KEY', model: 'GEMINI_UNIT_TEST_MODEL' },
    'integration-test': { key: 'GEMINI_INTEGRATION_TEST_API_KEY', model: 'GEMINI_INTEGRATION_TEST_MODEL' },
    'system-test': { key: 'GEMINI_SYSTEM_TEST_API_KEY', model: 'GEMINI_SYSTEM_TEST_MODEL' },
    'chatbot-trustworthiness': { key: 'GEMINI_TRUSTWORTHINESS_API_KEY', model: 'AI_EVALUATION_JUDGE_MODEL' },
});
const scope = new AsyncLocalStorage();
export const currentGeminiFeature = () => scope.getStore() || 'general';
export function withGeminiFeature(feature, operation) {
    if (!GEMINI_FEATURES[feature]) throw new ServiceError('Unknown Gemini feature', 400, 'INVALID_AI_FEATURE');
    return scope.run(feature, operation);
}
export function geminiConfiguration(feature = currentGeminiFeature(), { required = false } = {}) {
    const definition = GEMINI_FEATURES[feature];
    if (feature !== 'general' && !definition) throw new ServiceError('Unknown Gemini feature', 400, 'INVALID_AI_FEATURE');
    const dedicated = definition ? process.env[definition.key]?.trim() : null;
    const allowLegacy = feature !== 'chatbox' && (feature === 'general' || process.env.GEMINI_REQUIRE_DEDICATED_KEYS !== 'true');
    const apiKey = dedicated || (allowLegacy ? process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() : '') || '';
    const keyEnv = dedicated ? definition.key : definition && !allowLegacy ? definition.key : process.env.GEMINI_API_KEY?.trim() ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY';
    if (required && !apiKey) throw new ServiceError(`${definition?.key || 'GEMINI_API_KEY'} is not configured for ${feature}`, 503, 'AI_KEY_NOT_CONFIGURED');
    return { feature, apiKey, keyEnv, dedicated: Boolean(dedicated), configured: Boolean(apiKey), model: definition && process.env[definition.model]?.trim() || process.env.GEMINI_MODEL?.trim() || '', credentialId: apiKey ? createHash('sha256').update(apiKey).digest('hex') : 'unconfigured' };
}
