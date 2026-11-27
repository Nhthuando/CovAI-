import { test, expect } from '@jest/globals';
import { evaluateProbeAnswerAgainstKnowledge, probeChatbotKnowledgeReadiness } from '../services/aiEvaluation/chatbotRuntime.service.js';

const canned = 'I cannot confirm this from approved store information. Please contact store support.';

test('a "cannot confirm" fallback is a refusal, not knowledge', () => {
    expect(evaluateProbeAnswerAgainstKnowledge(canned, ['Shipping addresses cannot be edited after order creation; cancel it and place a new order with the corrected address.']).matched).toBe(false);
    expect(evaluateProbeAnswerAgainstKnowledge('Standard US shipping is $0.00 in demo mode.', ['Standard US test-market shipping is currently $0.00 in demo mode.']).matched).toBe(true);
});

test('the same reply to different questions stops the run before grading', async () => {
    const sources = [];
    const caseRows = [
        { definition: { caseKey: 'a', taskType: 'HAPPY_PATH', turns: [{ content: 'Shipping rate?' }], expectedFacts: ['Shipping for orders is free in demo mode'] } },
        { definition: { caseKey: 'b', taskType: 'HAPPY_PATH', turns: [{ content: 'Edit address?' }], expectedFacts: ['Order shipping addresses cannot be edited'] } },
    ];
    const turnExecutor = async () => ({ answer: 'For orders and shipping, please contact store support today.', latencyMs: 1 });
    await expect(probeChatbotKnowledgeReadiness({ targetConfig: {}, caseRows, sources, turnExecutor }))
        .rejects.toMatchObject({ code: 'KNOWLEDGE_NOT_READY' });
});
