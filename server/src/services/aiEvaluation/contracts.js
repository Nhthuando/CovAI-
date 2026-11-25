import { z } from 'zod';
import Ajv from 'ajv/dist/2020.js';
import { GEMINI_MODEL_IDS } from '../../../../shared/aiModels.js';
import { DEFAULT_EVALUATION_CONFIG, fail, pointerParts, safeJson, SCENARIO_CATEGORIES, TASKS } from './common.js';

const id = z.string().regex(/^[\w-]{1,128}$/);
const text = z.string().trim().min(1).max(10000);
const object = z.record(z.string(), z.unknown());
const pointer = z.string().max(512).refine(value => { try { pointerParts(value); return true; } catch { return false; } }, 'Invalid JSON Pointer');

export function normalizeModelComparisonKey(modelId = '') {
    return String(modelId || '')
        .trim()
        .toLowerCase()
        .replace(/^models\//, '');
}

export function assertDistinctGeneratorAndJudgeModels(judgeConfig = {}) {
    if (!judgeConfig || typeof judgeConfig !== 'object') return;
    const rawGenerator = judgeConfig.generatorModel ?? DEFAULT_EVALUATION_CONFIG.generatorModel;
    const rawJudge = judgeConfig.model ?? DEFAULT_EVALUATION_CONFIG.judgeModel;
    const generatorKey = normalizeModelComparisonKey(rawGenerator);
    const judgeKey = normalizeModelComparisonKey(rawJudge);
    if (generatorKey && judgeKey && generatorKey === judgeKey) {
        fail(
            'SAME_MODEL_NOT_ALLOWED',
            `Generator model and Judge model must be distinct to mitigate self-preference bias (both resolve to "${generatorKey}").`,
            400,
        );
    }
}

export function parse(schema, value) {
    safeJson(value);
    const result = schema.safeParse(value);
    if (!result.success) fail('INVALID_INPUT', result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).slice(0, 8).join('; '));
    if (result.data?.judge) assertDistinctGeneratorAndJudgeModels(result.data.judge);
    if (result.data?.definition?.judge) assertDistinctGeneratorAndJudgeModels(result.data.definition.judge);
    return result.data;
}

export const targetSchema = z.object({
    executionMode: z.enum(['MANAGED_PROJECT', 'EXTERNAL_URL']).default('EXTERNAL_URL'),
    endpoint: z.string().url().max(2000).optional(),
    endpointPath: z.string().regex(/^\/[\w\-./]*$/).max(300).default('/api/chat'),
    auth: z.object({
        type: z.enum(['none', 'bearer', 'apiKey']).default('none'),
        header: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/).default('X-API-Key'),
    }).default({ type: 'none', header: 'X-API-Key' }),
    requestTemplate: object.default({}),
    bindings: z.record(pointer, z.enum(['messages', 'latestUserMessage', 'history', 'conversationId', 'requestId', 'evaluationContext', 'generatedConversationId', 'uiMessages', 'geminiContents']))
        .default({ '/messages': 'messages', '/conversationId': 'conversationId', '/requestId': 'requestId', '/evaluationContext': 'evaluationContext' }),
    response: z.object({
        format: z.enum(['json', 'sse', 'text']).default('json'),
        answer: pointer.default('/answer'),
        conversationId: pointer.optional(),
        citations: pointer.optional(),
        retrievedContext: pointer.optional(),
        toolTrace: pointer.optional(),
        usage: pointer.optional(),
        metadata: pointer.optional(),
    }).default({ format: 'json', answer: '/answer' }),
    conversationMode: z.enum(['messages', 'session']).default('messages'),
    historyFormat: z.enum(['chat', 'model', 'gemini', 'strings']).optional(),
    verifiedMapping: z.boolean().optional(),
    llmEnvVars: z.array(z.string().regex(/^[A-Za-z_]\w{0,127}$/)).max(12).default([]),
    environment: z.record(z.string().regex(/^[A-Za-z_]\w{0,127}$/), z.string().max(500).regex(/^[^\r\n\0]*$/)).default({}),
    mockGateway: z.boolean().default(false),
    testEnvironmentConfirmed: z.boolean().default(false),
    targetVersion: text.default('unspecified'),
}).strict().superRefine((config, ctx) => {
    const settings = Object.keys(config.environment);
    const llmNames = new Set(config.llmEnvVars.map(name => name.toUpperCase()));
    for (const [index, name] of settings.entries()) {
        const issue = message => ctx.addIssue({ code: 'custom', path: ['environment', name], message });
        if (index >= 20) issue('Use at most 20 extra settings');
        if (config.executionMode === 'EXTERNAL_URL') issue('Extra settings only apply when CovAI starts your chatbot');
        if (llmNames.has(name.toUpperCase())) issue('Enter the API key in the key field, not as a setting');
        if (/(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)/i.test(name)) issue('Settings are stored in plain text; do not put secrets here');
        if (/^(PORT|HOST|HOSTNAME|NODE_OPTIONS|PATH|NODE_PATH)$/i.test(name) || /^COVAI_/i.test(name)) issue('CovAI sets this variable itself');
    }
    const checkTemplate = value => {
        if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
            if (/^(authorization|password|secret|token|apiKey|api_key|llmApiKey)$/i.test(key)) {
                ctx.addIssue({ code: 'custom', message: 'Store authentication secrets in the dedicated credential field' });
            }
            checkTemplate(child);
        }
    };
    checkTemplate(config.requestTemplate);
    if (config.executionMode === 'EXTERNAL_URL' && !config.endpoint) {
        ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'External URL mode requires a valid HTTPS endpoint' });
    }
    const bindings = Object.values(config.bindings);
    if (!['messages', 'latestUserMessage', 'uiMessages', 'geminiContents'].some(binding => bindings.includes(binding))) {
        ctx.addIssue({ code: 'custom', message: 'A messages or latestUserMessage binding is required' });
    }
    if (config.mockGateway && !bindings.includes('evaluationContext')) {
        ctx.addIssue({ code: 'custom', message: 'Gateway targets require an evaluationContext binding' });
    }
    if (config.conversationMode === 'session' && (!config.response.conversationId || !bindings.includes('conversationId'))) {
        ctx.addIssue({ code: 'custom', message: 'Session mode requires conversationId input and output mappings' });
    }
    if (/^(host|cookie|content-length|content-type|connection|transfer-encoding|proxy-authorization)$/i.test(config.auth.header)) {
        ctx.addIssue({ code: 'custom', message: 'Reserved authentication header' });
    }
});

const condition = z.object({ source: z.enum(['args', 'state']), path: pointer, op: z.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'exists']), value: z.unknown().optional() }).strict();

export const toolSchema = z.object({
    name: id, description: text, inputSchema: object, outputSchema: object,
    requiresConfirmation: z.boolean().default(false), forbidden: z.boolean().default(false), duplicateKey: z.array(pointer).max(10).default([]),
    branches: z.array(z.object({ when: z.array(condition).max(30).default([]), result: z.unknown(), error: z.object({ code: id, message: text }).optional(), effects: z.array(z.object({ op: z.enum(['set', 'delete', 'increment', 'append']), path: pointer, value: z.unknown().optional() }).strict()).max(30).default([]) }).strict()).min(1).max(30),
}).strict();

export const ruleSchema = z.object({
    type: z.enum(['equals', 'containsAll', 'orderedSteps', 'forbiddenText', 'secretDisclosure', 'jsonValue', 'latency', 'cost', 'consistency', 'sourceSupport', 'retrievalRecall', 'toolSelection', 'toolParameters', 'confirmation', 'forbiddenActions', 'duplicates', 'toolResult', 'state']),
    expected: z.unknown().optional(), path: pointer.optional(), toolName: id.optional(), max: z.number().nonnegative().optional(), currency: z.string().max(12).optional(),
}).strict();

export const criterionSchema = z.object({
    key: id, method: z.enum(['rule', 'semantic']).default('rule'), enabled: z.boolean().default(true), required: z.boolean().default(true), blocking: z.boolean().default(false),
    weight: z.number().positive().max(1000).default(1), rule: ruleSchema.optional(), rubric: text.optional(), threshold: z.number().min(0).max(100).optional(),
    groundTruth: text.optional(), expectedFacts: z.array(text).max(20).optional(), sourceQuote: z.string().max(10000).optional(), sourceIds: z.array(id).max(30).default([]),
}).strict();

export const caseSchema = z.object({
    caseKey: id, title: text, taskType: z.enum(TASKS), turns: z.array(z.object({ content: text }).strict()).min(1).max(10),
    context: z.string().max(20000).default(''), expectedBehavior: z.string().max(20000).default(''),
    expectedFacts: z.array(text).max(20).default([]), sourceQuote: z.string().max(10000).default(''),
    referenceUnverified: z.boolean().default(false),
    risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'), weight: z.number().positive().max(1000).default(1),
    repetitions: z.number().int().min(1).max(3).optional(),
    initialState: object.default({}), confirmationScript: z.array(z.object({ toolName: id, arguments: object, decision: z.enum(['APPROVED', 'DENIED']) }).strict()).max(20).default([]),
    criteria: z.array(criterionSchema).min(1).max(30),
}).strict().transform(item => ({
    ...item,
    repetitions: item.repetitions ?? (SCENARIO_CATEGORIES.includes(item.taskType) ? DEFAULT_EVALUATION_CONFIG.repetitions : 1),
}));

const defaultTaskWeights = Object.fromEntries(TASKS.map(t => [t, 1]));

export const definitionSchema = z.object({
    sourceIds: z.array(id).max(30).default([]),
    rules: z.string().max(30000).default(''),
    tools: z.array(toolSchema).max(30).default([]),
    scenarioCount: z.number().int().min(4).max(60).default(DEFAULT_EVALUATION_CONFIG.scenarioCount),
    repetitions: z.number().int().min(1).max(3).default(DEFAULT_EVALUATION_CONFIG.repetitions),
    limits: z.object({
        requestMs: z.number().int().min(1000).max(120000).default(60000),
        caseMs: z.number().int().min(1000).max(600000).default(180000),
        delayMs: z.number().int().min(0).max(30000).default(DEFAULT_EVALUATION_CONFIG.delayMs),
        latencySlaMs: z.number().int().min(100).max(120000).default(DEFAULT_EVALUATION_CONFIG.latencySlaMs),
        maxToolCalls: z.number().int().min(1).max(20).default(20),
    }).default({
        requestMs: 60000,
        caseMs: 180000,
        delayMs: DEFAULT_EVALUATION_CONFIG.delayMs,
        latencySlaMs: DEFAULT_EVALUATION_CONFIG.latencySlaMs,
        maxToolCalls: 20,
    }),
    scoring: z.object({
        confirmed: z.boolean().default(false),
        threshold: z.number().min(0).max(100).nullable().default(null),
        taskWeights: z.record(z.enum(TASKS), z.number().positive().max(1000)).default(defaultTaskWeights),
    }).transform(scoring => ({
        ...scoring,
        taskWeights: { ...defaultTaskWeights, ...scoring.taskWeights },
    })).default({ confirmed: false, threshold: null, taskWeights: defaultTaskWeights }),
    judge: z.object({
        enabled: z.boolean().default(false),
        generatorModel: z.string().max(100).default(DEFAULT_EVALUATION_CONFIG.generatorModel),
        model: z.string().max(100).default(DEFAULT_EVALUATION_CONFIG.judgeModel),
        generationConsent: z.boolean().default(false),
        judgingConsent: z.boolean().default(false),
    }).superRefine((judge, ctx) => {
        const genNormalized = normalizeModelComparisonKey(judge.generatorModel);
        if (judge.generatorModel && !GEMINI_MODEL_IDS.includes(genNormalized) && !/^gemini-[a-z0-9.-]+$/.test(genNormalized)) {
            ctx.addIssue({ code: 'custom', path: ['generatorModel'], message: 'Select a supported Gemini generator model' });
        }
        const judgeNormalized = normalizeModelComparisonKey(judge.model);
        if (judge.model && !GEMINI_MODEL_IDS.includes(judgeNormalized) && !/^gemini-[a-z0-9.-]+$/.test(judgeNormalized)) {
            ctx.addIssue({ code: 'custom', path: ['model'], message: 'Select a supported Gemini judge model' });
        }
    }).default({
        enabled: false,
        generatorModel: DEFAULT_EVALUATION_CONFIG.generatorModel,
        model: DEFAULT_EVALUATION_CONFIG.judgeModel,
        generationConsent: false,
        judgingConsent: false,
    }),
}).strict();

export const profileInputSchema = z.object({ revision: z.number().int().nonnegative().optional(), definition: definitionSchema, cases: z.array(caseSchema).max(200) }).strict();
export const callSchema = z.object({ callId: id, toolName: id, arguments: object, confirmationGrantId: id.optional() }).strict();
export const confirmationSchema = z.object({ requestId: id, toolName: id, arguments: object, prompt: text }).strict();
export const runSchema = z.object({
    targetVersionId: id,
    profileVersionId: id,
    snapshotId: id.nullable().optional(),
    idempotencyKey: id,
    llmApiKey: z.string().min(1).max(4096).optional(),
    targetAuthToken: z.string().min(1).max(4096).optional(),
    skipKnowledgeProbe: z.boolean().default(false),
}).strict();
export const reviewSchema = z.object({
    verdict: z.enum(['PASSED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE']),
    score: z.number().min(0).max(100).nullable(),
    rationale: text,
}).strict();

const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: false });
export function compileSchema(schema) {
    safeJson(schema);
    const inspect = value => { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (['$ref', '$dynamicRef', 'pattern', 'patternProperties', 'format'].includes(key)) fail('UNSAFE_SCHEMA', 'Remote references, formats and regex are not supported'); inspect(child); } };
    inspect(schema);
    try { return ajv.compile(schema); } catch { fail('INVALID_SCHEMA', 'Invalid mock JSON schema'); }
}

export function validateApproval(definition, cases) {
    if (definition.scoring.threshold === null) fail('SCORING_THRESHOLD_REQUIRED', 'Set a pass mark (0-100) before approving.');
    if (!definition.scoring.confirmed) fail('SCORING_UNCONFIRMED', 'Confirm the scoring weights and pass mark before approving.');
    if (!cases.length) fail('EMPTY_BENCHMARK', 'Add at least one benchmark case');
    if (new Set(cases.map(c => c.caseKey)).size !== cases.length) fail('DUPLICATE_CASE', 'Case keys must be unique');
    if (new Set(definition.tools.map(t => t.name)).size !== definition.tools.length) fail('DUPLICATE_TOOL', 'Tool names must be unique');
    for (const tool of definition.tools) { compileSchema(tool.inputSchema); compileSchema(tool.outputSchema); }
    assertDistinctGeneratorAndJudgeModels(definition.judge);
    if (definition.judge.enabled && (!definition.judge.judgingConsent || !definition.judge.model)) fail('JUDGE_CONSENT', 'Choose a model and confirm semantic evaluation data sharing');
    for (const c of cases) {
        if (new Set(c.criteria.map(r => r.key)).size !== c.criteria.length) fail('DUPLICATE_CRITERION', 'Criterion keys must be unique per case');
        if (!c.criteria.some(r => r.required && r.enabled)) fail('REQUIRED_CRITERION', 'Every case needs an enabled required criterion');
        for (const r of c.criteria) {
            if (r.sourceIds.some(sid => !definition.sourceIds.includes(sid))) fail('SOURCE_SCOPE', 'Criterion sources must belong to the profile');
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
            for (const type of ['confirmation', 'forbiddenActions', 'duplicates']) {
                if (!c.criteria.some(r => r.enabled && r.required && r.blocking && r.method === 'rule' && r.rule.type === type)) {
                    fail('SAFETY_GATE_REQUIRED', `Action cases require an enabled, required, blocking ${type} rule`);
                }
            }
        }
    }
}
