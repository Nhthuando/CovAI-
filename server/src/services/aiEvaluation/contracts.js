import { z } from 'zod';
import Ajv from 'ajv/dist/2020.js';
import { fail, pointerParts, safeJson, TASKS } from './common.js';

const id = z.string().regex(/^[\w-]{1,128}$/);
const text = z.string().trim().min(1).max(10000);
const object = z.record(z.string(), z.unknown());
const pointer = z.string().max(512).refine(value => { try { pointerParts(value); return true; } catch { return false; } }, 'Invalid JSON Pointer');
export function parse(schema, value) {
    safeJson(value);
    const result = schema.safeParse(value);
    if (!result.success) fail('INVALID_INPUT', result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).slice(0, 8).join('; '));
    return result.data;
}
export const targetSchema = z.object({
    endpoint: z.string().url().max(2000),
    auth: z.object({ type: z.enum(['none', 'bearer', 'apiKey']).default('none'), header: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/).default('X-API-Key') }).default({ type: 'none', header: 'X-API-Key' }),
    requestTemplate: object.default({}),
    bindings: z.record(pointer, z.enum(['messages', 'conversationId', 'requestId', 'evaluationContext'])).default({ '/messages': 'messages', '/conversationId': 'conversationId', '/requestId': 'requestId', '/evaluationContext': 'evaluationContext' }),
    response: z.object({ answer: pointer.default('/answer'), conversationId: pointer.optional(), citations: pointer.optional(), retrievedContext: pointer.optional(), toolTrace: pointer.optional(), usage: pointer.optional(), metadata: pointer.optional() }).default({ answer: '/answer' }),
    conversationMode: z.enum(['messages', 'session']).default('messages'),
    mockGateway: z.boolean().default(false),
    testEnvironmentConfirmed: z.boolean().default(false),
    targetVersion: text.default('unspecified'),
}).strict().superRefine((config, ctx) => {
    const checkTemplate = value => {
        if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
            if (/^(authorization|password|secret|token|apiKey|api_key)$/i.test(key)) ctx.addIssue({ code: 'custom', message: 'Store authentication secrets in the dedicated credential field' });
            checkTemplate(child);
        }
    };
    checkTemplate(config.requestTemplate);
    const bindings = Object.values(config.bindings);
    if (!bindings.includes('messages')) ctx.addIssue({ code: 'custom', message: 'A messages binding is required' });
    if (config.mockGateway && !bindings.includes('evaluationContext')) ctx.addIssue({ code: 'custom', message: 'Gateway targets require an evaluationContext binding' });
    if (config.conversationMode === 'session' && (!config.response.conversationId || !bindings.includes('conversationId'))) ctx.addIssue({ code: 'custom', message: 'Session mode requires conversationId input and output mappings' });
    if (/^(host|cookie|content-length|content-type|connection|transfer-encoding|proxy-authorization)$/i.test(config.auth.header)) ctx.addIssue({ code: 'custom', message: 'Reserved authentication header' });
});
const condition = z.object({ source: z.enum(['args', 'state']), path: pointer, op: z.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'exists']), value: z.unknown().optional() }).strict();
export const toolSchema = z.object({
    name: id, description: text, inputSchema: object, outputSchema: object,
    requiresConfirmation: z.boolean().default(false), forbidden: z.boolean().default(false), duplicateKey: z.array(pointer).max(10).default([]),
    branches: z.array(z.object({ when: z.array(condition).max(30).default([]), result: z.unknown(), error: z.object({ code: id, message: text }).optional(), effects: z.array(z.object({ op: z.enum(['set', 'delete', 'increment', 'append']), path: pointer, value: z.unknown().optional() }).strict()).max(30).default([]) }).strict()).min(1).max(30),
}).strict();
export const ruleSchema = z.object({ type: z.enum(['equals', 'containsAll', 'orderedSteps', 'forbiddenText', 'jsonValue', 'latency', 'cost', 'consistency', 'sourceSupport', 'retrievalRecall', 'toolSelection', 'toolParameters', 'confirmation', 'forbiddenActions', 'duplicates', 'toolResult', 'state']), expected: z.unknown().optional(), path: pointer.optional(), toolName: id.optional(), max: z.number().nonnegative().optional(), currency: z.string().max(12).optional() }).strict();
export const criterionSchema = z.object({ key: id, method: z.enum(['rule', 'semantic']).default('rule'), enabled: z.boolean().default(true), required: z.boolean().default(true), blocking: z.boolean().default(false), weight: z.number().positive().max(1000).default(1), rule: ruleSchema.optional(), rubric: text.optional(), threshold: z.number().min(0).max(100).optional(), groundTruth: text.optional(), sourceIds: z.array(id).max(30).default([]) }).strict();
export const caseSchema = z.object({ caseKey: id, title: text, taskType: z.enum(TASKS), turns: z.array(z.object({ content: text }).strict()).min(1).max(10), context: z.string().max(20000).default(''), expectedBehavior: z.string().max(20000).default(''), risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'), weight: z.number().positive().max(1000).default(1), repetitions: z.number().int().min(1).max(3).default(1), initialState: object.default({}), confirmationScript: z.array(z.object({ toolName: id, arguments: object, decision: z.enum(['APPROVED', 'DENIED']) }).strict()).max(20).default([]), criteria: z.array(criterionSchema).min(1).max(30) }).strict();
export const definitionSchema = z.object({
    sourceIds: z.array(id).max(30).default([]), rules: z.string().max(30000).default(''), tools: z.array(toolSchema).max(30).default([]),
    limits: z.object({ requestMs: z.number().int().min(1000).max(120000).default(60000), caseMs: z.number().int().min(1000).max(600000).default(180000), maxToolCalls: z.number().int().min(1).max(20).default(20) }).default({ requestMs: 60000, caseMs: 180000, maxToolCalls: 20 }),
    scoring: z.object({ confirmed: z.boolean().default(false), threshold: z.number().min(0).max(100).nullable().default(null), taskWeights: z.record(z.enum(TASKS), z.number().positive().max(1000)).default({ KNOWLEDGE_QA: 1, USAGE_GUIDANCE: 1, ACTION_TOOL: 1 }) }).default({ confirmed: false, threshold: null, taskWeights: { KNOWLEDGE_QA: 1, USAGE_GUIDANCE: 1, ACTION_TOOL: 1 } }),
    judge: z.object({ enabled: z.boolean().default(false), model: z.string().max(100).default(''), generationConsent: z.boolean().default(false), judgingConsent: z.boolean().default(false) }).default({ enabled: false, model: '', generationConsent: false, judgingConsent: false }),
}).strict();
export const profileInputSchema = z.object({ revision: z.number().int().nonnegative().optional(), definition: definitionSchema, cases: z.array(caseSchema).max(200) }).strict();
export const callSchema = z.object({ callId: id, toolName: id, arguments: object, confirmationGrantId: id.optional() }).strict();
export const confirmationSchema = z.object({ requestId: id, toolName: id, arguments: object, prompt: text }).strict();
export const runSchema = z.object({ targetVersionId: id, profileVersionId: id, snapshotId: id.nullable().optional(), idempotencyKey: id }).strict();
export const reviewSchema = z.object({ verdict: z.enum(['PASSED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE']), score: z.number().min(0).max(100).nullable(), rationale: text }).strict();
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: false });
export function compileSchema(schema) {
    safeJson(schema);
    const inspect = value => { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (['$ref', '$dynamicRef', 'pattern', 'patternProperties', 'format'].includes(key)) fail('UNSAFE_SCHEMA', 'Remote references, formats and regex are not supported'); inspect(child); } };
    inspect(schema);
    try { return ajv.compile(schema); } catch { fail('INVALID_SCHEMA', 'Invalid mock JSON schema'); }
}
export function validateApproval(definition, cases) {
    if (!definition.scoring.confirmed || definition.scoring.threshold === null) fail('SCORING_UNCONFIRMED', 'Confirm weights, threshold and quality gates before approval');
    if (!cases.length) fail('EMPTY_BENCHMARK', 'Add at least one benchmark case');
    if (new Set(cases.map(c => c.caseKey)).size !== cases.length) fail('DUPLICATE_CASE', 'Case keys must be unique');
    if (new Set(definition.tools.map(t => t.name)).size !== definition.tools.length) fail('DUPLICATE_TOOL', 'Tool names must be unique');
    for (const tool of definition.tools) { compileSchema(tool.inputSchema); compileSchema(tool.outputSchema); }
    if (definition.judge.enabled && (!definition.judge.judgingConsent || !definition.judge.model)) fail('JUDGE_CONSENT', 'Choose a model and confirm semantic evaluation data sharing');
    for (const c of cases) {
        if (new Set(c.criteria.map(r => r.key)).size !== c.criteria.length) fail('DUPLICATE_CRITERION', 'Criterion keys must be unique per case');
        if (!c.criteria.some(r => r.required && r.enabled)) fail('REQUIRED_CRITERION', 'Every case needs an enabled required criterion');
        for (const r of c.criteria) {
            if (r.sourceIds.some(id => !definition.sourceIds.includes(id))) fail('SOURCE_SCOPE', 'Criterion sources must belong to the profile');
            if (r.method === 'semantic' && (!r.rubric || r.threshold === undefined || !r.groundTruth)) fail('RUBRIC_REQUIRED', 'Semantic criteria need a rubric, ground truth and threshold');
            if (r.method === 'rule' && !r.rule) fail('RULE_REQUIRED', 'Configure a deterministic rule');
            if (r.method !== 'rule') continue;
            const rule = r.rule;
            if (['equals', 'jsonValue', 'toolParameters', 'toolResult', 'state'].includes(rule.type) && rule.expected === undefined) fail('EXPECTED_REQUIRED', 'Configure the expected value');
            if (['containsAll', 'orderedSteps', 'forbiddenText', 'toolSelection', 'retrievalRecall', 'sourceSupport'].includes(rule.type) && (!Array.isArray(rule.expected) || !rule.expected.length || rule.expected.some(v => typeof v !== 'string' || !v.trim()))) fail('EXPECTED_REQUIRED', 'Configure a nonempty list of expected strings');
            if (['latency', 'cost'].includes(rule.type) && rule.max === undefined) fail('LIMIT_REQUIRED', 'Configure the measured limit');
            if (rule.type === 'cost' && !rule.currency) fail('CURRENCY_REQUIRED', 'Cost checks require an explicit currency');
            if (rule.type === 'consistency' && c.repetitions < 2) fail('REPETITIONS_REQUIRED', 'Consistency needs at least two independent repetitions');
            if (['jsonValue', 'state'].includes(rule.type) && rule.path === undefined) fail('POINTER_REQUIRED', 'Configure the checked JSON Pointer');
            if (['toolParameters', 'toolResult'].includes(rule.type) && !rule.toolName) fail('TOOL_REQUIRED', 'Choose the expected tool');
            if (['sourceSupport', 'retrievalRecall'].includes(rule.type) && !r.sourceIds.length) fail('SOURCE_REQUIRED', 'Source evaluation requires approved source references');
        }
        if (c.taskType === 'ACTION_TOOL') {
            if (!definition.tools.length) fail('TOOLS_REQUIRED', 'Action cases need mock tools');
            for (const type of ['confirmation', 'forbiddenActions', 'duplicates']) if (!c.criteria.some(r => r.enabled && r.required && r.blocking && r.method === 'rule' && r.rule.type === type)) fail('SAFETY_GATE_REQUIRED', `Action cases require an enabled, required, blocking ${type} rule`);
        }
    }
}
