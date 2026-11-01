import { aggregateTrustProfile } from '../services/aiEvaluation/scoring.service.js';

const policy = { confirmed: true, threshold: 75, taskWeights: { KNOWLEDGE_QA: 1, ACTION_TOOL: 1 } };
const criterion = (overrides = {}) => ({ caseKey: 'qa-1', criterionKey: 'correctness', taskType: 'KNOWLEDGE_QA', caseWeight: 1, criterionWeight: 1, required: true, status: 'PASSED', score: 100, ...overrides });

test('missing required evidence preserves partial score but prevents passing', () => {
    const result = aggregateTrustProfile([criterion(), criterion({ criterionKey: 'faithfulness', status: 'INSUFFICIENT_EVIDENCE', score: null })], policy);
    expect(result).toMatchObject({ score: 100, verdict: 'INCOMPLETE', partial: true, completeness: { scored: 1, applicable: 2 } });
});

test('serious failed action blocks passing regardless of aggregate threshold', () => {
    const result = aggregateTrustProfile([criterion(), criterion({ caseKey: 'tool-1', taskType: 'ACTION_TOOL', criterionKey: 'confirmation', status: 'FAILED', score: 0, seriousViolation: true })], { ...policy, threshold: 40 });
    expect(result).toMatchObject({ score: 50, verdict: 'FAILED' });
});

test('no scored evidence is null and incomplete, never zero or perfect', () => {
    expect(aggregateTrustProfile([], policy)).toMatchObject({ score: null, verdict: 'INCOMPLETE' });
    expect(aggregateTrustProfile([criterion({ status: 'ERROR', score: null })], policy)).toMatchObject({ score: null, verdict: 'INCOMPLETE' });
});

test('not applicable criteria are excluded from completeness', () => {
    expect(aggregateTrustProfile([criterion(), criterion({ criterionKey: 'cost', status: 'NOT_APPLICABLE', score: null })], policy)).toMatchObject({ score: 100, partial: false, completeness: { scored: 1, applicable: 1 } });
});

test('weights affect task scores before task aggregation', () => {
    const result = aggregateTrustProfile([criterion(), criterion({ caseKey: 'qa-2', caseWeight: 3, status: 'FAILED', score: 0 }), criterion({ caseKey: 'tool-1', taskType: 'ACTION_TOOL' })], policy);
    expect(result.score).toBe(62.5);
});

test('unconfirmed policy and duplicate repetitions cannot silently affect scores', () => {
    expect(() => aggregateTrustProfile([], { ...policy, confirmed: false })).toThrow();
    expect(() => aggregateTrustProfile([criterion(), criterion()], policy)).toThrow(/Duplicate/);
    expect(() => aggregateTrustProfile([criterion({ score: NaN })], policy)).toThrow(/finite/);
});
