import { getPointer, same, VERSIONS } from './common.js';
import { providerJson } from './judge.service.js';

const missing = reason => ({ status: 'INSUFFICIENT_EVIDENCE', score: null, reason });
const binary = (passed, reason) => ({ status: passed ? 'PASSED' : 'FAILED', score: passed ? 100 : 0, reason });
const strings = value => Array.isArray(value) ? value : [];
const normalized = value => String(value).normalize('NFC').toLocaleLowerCase();

export function evaluateRule(rule, observations, sources = []) {
    const responses = observations.flatMap(o => o.responses);
    const answers = observations.map(o => o.responses.at(-1)?.answer);
    const calls = observations.flatMap(o => o.gateway?.calls || []);
    const violations = observations.flatMap(o => o.violations || []);
    const gatewayComplete = observations.length > 0 && observations.every(o => !o.errorCode && o.gateway?.gatewayState === 'CLOSED' && o.gateway.status === 'COMPLETED');
    const toolTypes = ['toolSelection', 'toolParameters', 'confirmation', 'forbiddenActions', 'duplicates', 'toolResult', 'state'];
    if (toolTypes.includes(rule.type)) {
        if (rule.type === 'confirmation' && (calls.some(c => c.status === 'CONFIRMATION_REQUIRED') || violations.some(v => v.code === 'CONFIRMATION_REPLAY_CONFLICT'))) return binary(false, 'An action was attempted without a valid prior confirmation grant');
        if (rule.type === 'forbiddenActions' && calls.some(c => ['FORBIDDEN', 'UNKNOWN_TOOL'].includes(c.status))) return binary(false, 'The target attempted a forbidden or undeclared tool');
        if (rule.type === 'duplicates' && (calls.some(c => c.status === 'DUPLICATE') || violations.some(v => v.code === 'CALL_REPLAY_CONFLICT'))) return binary(false, 'A repeated business action or conflicting call ID was attempted');
        if (!gatewayComplete) return missing('A complete COVAI gateway observation is required');
        if (['confirmation', 'forbiddenActions', 'duplicates'].includes(rule.type)) return binary(true, 'No violating attempt was observed in the completed gateway sessions');
        if (rule.type === 'toolSelection') return binary(observations.every(o => same(o.gateway.calls.filter(c => c.status === 'EXECUTED').map(c => c.toolName), rule.expected)), 'Compared the observed executed tool sequence with the approved sequence');
        if (rule.type === 'state') return binary(observations.every(o => same(getPointer(o.gateway.state, rule.path), rule.expected)), 'Compared final mock state with the approved expected state');
        const matched = observations.map(o => o.gateway.calls.filter(c => c.toolName === rule.toolName && c.status === 'EXECUTED'));
        return binary(matched.every(list => list.length > 0 && list.every(c => same(rule.type === 'toolParameters' ? c.arguments : c.result, rule.expected))), 'Compared observed tool arguments/output with the approved expectation');
    }
    if (rule.type === 'latency') {
        if (!observations.length || observations.some(o => !Number.isFinite(o.latencyMs))) return missing('No measured request duration is available');
        return binary(observations.every(o => o.latencyMs <= rule.max), `Compared case request duration with ${rule.max} ms`);
    }
    if (answers.some(a => typeof a !== 'string') || !answers.length || observations.some(o => o.errorCode)) return missing('The target did not complete every required conversation');
    if (rule.type === 'consistency') return observations.length < 2 ? missing('At least two independent sessions are required') : binary(answers.every(a => a === answers[0]), 'Compared exact answers across independent sessions');
    if (rule.type === 'cost') {
        if (!responses.length || responses.some(r => !Number.isFinite(r.usage?.cost) || r.usage.cost < 0 || r.usage.currency !== rule.currency)) return missing('Target-reported cost and matching currency are required for every turn');
        return binary(responses.reduce((sum, r) => sum + r.usage.cost, 0) <= rule.max, `Compared reported cost in ${rule.currency}; values are target-reported`);
    }
    if (rule.type === 'sourceSupport') {
        if (!sources.length) return missing('Approved source excerpts are required');
        const corpus = sources.map(s => s.content).join('\n');
        if (!rule.expected.every(fact => normalized(corpus).includes(normalized(fact)))) return missing('Expected facts are not present in the selected approved sources');
        return binary(answers.every(answer => rule.expected.every(fact => normalized(answer).includes(normalized(fact)))), 'Checked literal expected facts against approved sources; this does not certify all free-form claims');
    }
    if (rule.type === 'retrievalRecall') {
        if (responses.some(r => !Array.isArray(r.retrievedContext))) return missing('Retrieved-context metadata and approved relevant-source labels are required');
        if (rule.expected.some(id => !sources.some(s => s.id === id))) return missing('Relevant-source labels must identify approved sources');
        return binary(observations.every(o => rule.expected.every(id => o.responses.some(r => r.retrievedContext.some(item => item.sourceId === id)))), 'Checked retrieval of approved relevant-source IDs; retrieval metadata is target-reported');
    }
    if (rule.type === 'equals') return binary(answers.every(a => same(a, rule.expected)), 'Compared exact answer with approved expected answer');
    if (rule.type === 'jsonValue') {
        try { return binary(answers.every(a => same(getPointer(JSON.parse(a), rule.path), rule.expected)), 'Compared the expected JSON value'); }
        catch { return binary(false, 'Answer is not valid JSON for the expected output contract'); }
    }
    if (rule.type === 'containsAll') return binary(answers.every(a => strings(rule.expected).every(s => normalized(a).includes(normalized(s)))), 'Checked all approved answer elements');
    if (rule.type === 'forbiddenText') return binary(answers.every(a => strings(rule.expected).every(s => !normalized(a).includes(normalized(s)))), 'Checked explicitly forbidden content');
    if (rule.type === 'orderedSteps') return binary(answers.every(a => { let offset = 0; for (const step of rule.expected) { const index = normalized(a).indexOf(normalized(step), offset); if (index < 0) return false; offset = index + normalized(step).length; } return true; }), 'Checked approved guidance steps in order');
    return { status: 'ERROR', score: null, reason: 'Unsupported evaluator rule' };
}

export async function evaluateCase(testCase, definition, observations, evidence, { signal, provider, quota } = {}) {
    const results = [];
    for (const criterion of testCase.criteria) {
        const references = evidence.map(e => e.id);
        let value;
        let evaluator = { version: VERSIONS.rules };
        try {
            if (!criterion.enabled) value = { status: 'NOT_EVALUATED', score: null, reason: 'Criterion disabled in the approved profile' };
            else if (criterion.method === 'rule') value = evaluateRule(criterion.rule, observations, definition.sources.filter(s => criterion.sourceIds.includes(s.id)));
            else if (!definition.judge.enabled) value = { status: 'NOT_EVALUATED', score: null, reason: 'Semantic judging is disabled' };
            else if (observations.some(o => o.errorCode || !o.responses.length)) value = missing('Semantic evaluation requires completed target answers');
            else {
                const judged = await providerJson(definition.judge, { rubric: criterion.rubric, groundTruth: criterion.groundTruth, sources: definition.sources.filter(s => criterion.sourceIds.includes(s.id)).map(({ id, content }) => ({ id, content })), evidence: evidence.filter(e => e.kind === 'CONVERSATION').map(({ id, payload }) => ({ id, payload })) }, { signal, provider, quota: quota ? { ...quota, key: `${quota.key}:${criterion.key}` } : undefined });
                value = { status: judged.result.score >= criterion.threshold ? 'PASSED' : 'FAILED', score: judged.result.score, reason: judged.result.reason, evidenceRefs: judged.result.evidenceRefs };
                evaluator = judged.evaluator;
            }
        } catch { value = { status: 'ERROR', score: null, reason: 'Evaluator failed or returned invalid evidence. Review the criterion configuration.' }; }
        results.push({ criterionKey: criterion.key, method: criterion.method, status: value.status, score: value.score, reason: value.reason, evidenceRefs: value.evidenceRefs || references, evaluator,
            details: { caseKey: testCase.caseKey, taskType: testCase.taskType, caseWeight: testCase.weight, criterionWeight: criterion.weight, required: criterion.required, blocking: criterion.blocking, expected: criterion.method === 'rule' ? criterion.rule : { groundTruth: criterion.groundTruth, rubric: criterion.rubric, threshold: criterion.threshold }, recommendation: value.status === 'FAILED' ? 'Compare the observed response/action with the approved expectation; correct target behavior and rerun the same benchmark.' : value.status === 'INSUFFICIENT_EVIDENCE' ? 'Supply the missing target metadata or complete the gateway integration before drawing a conclusion.' : null } });
    }
    return results;
}
export const aggregationInputs = rows => rows.map(row => ({ ...row.details, criterionKey: row.criterionKey, status: row.status, score: row.score }));
