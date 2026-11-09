import test from 'node:test';
import assert from 'node:assert/strict';
import { chatGreeting, normalizeChatScreenContext, chatErrorMessage } from './chatScreenContext.js';

test('greets the active file and each testing workspace in English', () => {
  assert.equal(chatGreeting({ activity: 'explorer', filePath: 'package.json' }), 'How can I help with the file package.json?');
  for (const [testType, title] of Object.entries({ unit: 'Unit Test', integration: 'Integration Test', system: 'System Test' })) {
    assert.equal(chatGreeting({ activity: 'coverage', testType }), `How can I help with ${title}?`);
  }
});
test('public chat errors are English and never expose provider names or key configuration', () => {
  for (const code of ['AI_KEY_NOT_CONFIGURED', 'AI_AUTH_ERROR', 'AI_QUOTA_EXCEEDED', 'AI_MODEL_UNAVAILABLE', 'AI_PROVIDER_UNAVAILABLE', 'AI_REQUEST_TIMEOUT', 'UNKNOWN']) {
    const message = chatErrorMessage({ code, message: 'Gemini GEMINI_CHATBOX_API_KEY secret-provider-error' });
    assert.doesNotMatch(message, /gemini|api[_ ]?key|secret-provider/i);
    assert.match(message, /project assistant/);
  }
});
test('drops unverified frontend metrics and legacy pseudo test types from network context', () => {
  assert.deepEqual(normalizeChatScreenContext({ activity: 'overview', testType: 'overview', unifiedSummary: { linesPct: 99 } }), { contextVersion: 1, activity: 'overview' });
  assert.deepEqual(normalizeChatScreenContext({ activity: 'projects-portfolio', testType: 'portfolio' }), { contextVersion: 1, activity: 'projects-portfolio' });
  assert.deepEqual(normalizeChatScreenContext({ activity: 'coverage', testType: 'unit', testRunId: 'r1' }), { contextVersion: 1, activity: 'coverage', testType: 'unit', testRunId: 'r1' });
});
