import crypto from 'node:crypto';
import { GEMINI_MODEL_IDS } from '../../../../shared/aiModels.js';
import { ServiceError } from '../../utils/serviceError.js';

export function lastLogLines(text) {
    const tail = String(text).replace(/\x1b\[[0-9;]*m/g, '')
        .split(/\r?\n/).filter(line => line.trim()).slice(-6).join(' | ')
        .replace(/\s+/g, ' ').trim();
    return tail.length > 400 ? `…${tail.slice(-400)}` : tail;
}

export const VERSIONS = Object.freeze({
    adapter: 'http-json-v2',
    rules: 'rules-v2',
    mock: 'mock-v1',
    judge: 'judge-v3',
    designAudit: 'design-audit-v1',
});

export const SCENARIO_CATEGORIES = Object.freeze([
    'HAPPY_PATH',
    'MULTI_TURN',
    'OUT_OF_SCOPE',
    'ADVERSARIAL',
]);

export const LEGACY_TASKS = Object.freeze([
    'KNOWLEDGE_QA',
    'USAGE_GUIDANCE',
    'ACTION_TOOL',
]);

export const TASKS = Object.freeze([...SCENARIO_CATEGORIES, ...LEGACY_TASKS]);

export const CANONICAL_CRITERIA_KEYS = Object.freeze([
    'faithfulness',
    'completeness',
    'contextRetention',
    'appropriateRefusal',
]);

export const CRITERIA_APPLICABILITY_MATRIX = Object.freeze({
    HAPPY_PATH: Object.freeze(['faithfulness', 'completeness']),
    MULTI_TURN: Object.freeze(['faithfulness', 'completeness', 'contextRetention']),
    OUT_OF_SCOPE: Object.freeze(['appropriateRefusal']),
    ADVERSARIAL: Object.freeze(['appropriateRefusal']),
});

export const DEFAULT_EVALUATION_CONFIG = Object.freeze({
    scenarioCount: 16,
    scenariosPerCategory: 4,
    repetitions: 2,
    generatorModel: GEMINI_MODEL_IDS.includes('gemini-3.5-flash-lite') ? 'gemini-3.5-flash-lite' : GEMINI_MODEL_IDS[0],
    judgeModel: GEMINI_MODEL_IDS.includes('gemini-3.8-flash') ? 'gemini-3.8-flash' : GEMINI_MODEL_IDS.at(-1),
    delayMs: 1000,
    latencySlaMs: 5000,
});

export const CHATBOT_PROFILE = 'CHATBOT_PROFILE';
export const isBehaviorOnly = (sources = []) => Array.isArray(sources) && sources.length > 0 && sources.every(source => source?.provenance?.type === CHATBOT_PROFILE);

export const TERMINAL = ['COMPLETED', 'ERROR', 'CANCELED', 'INDETERMINATE'];
export const fail = (code, message, status = 422) => { throw new ServiceError(message, status, code); };
export const enabled = () => process.env.AI_EVALUATION_ENABLED !== 'false';
export const requireEnabled = () => { if (!enabled()) fail('FEATURE_DISABLED', 'AI evaluation is disabled.', 503); };

export function safeJson(value, depth = 0) {
    if (depth > 24) fail('INVALID_JSON', 'JSON nesting is too deep');
    if (value && typeof value === 'object') {
        if (Object.keys(value).length > 10000) fail('INVALID_JSON', 'JSON is too large');
        for (const [key, child] of Object.entries(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_JSON', 'Unsafe JSON key');
            safeJson(child, depth + 1);
        }
    }
    return value;
}

export const canonical = value => value === undefined ? 'null' : value && typeof value === 'object'
    ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export const same = (a, b) => a === undefined || b === undefined ? a === b : canonical(a) === canonical(b);

export function pointerParts(pointer) {
    if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/')) || /~(?![01])/.test(pointer)) fail('INVALID_POINTER', 'Use a valid JSON Pointer');
    const parts = pointer === '' ? [] : pointer.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.length > 24 || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) fail('INVALID_POINTER', 'Unsafe JSON Pointer');
    return parts;
}

export const getPointer = (value, pointer) => pointerParts(pointer).reduce((current, part) => current != null && Object.hasOwn(current, part) ? current[part] : undefined, value);

export function setPointer(value, pointer, replacement, remove = false) {
    const parts = pointerParts(pointer);
    if (!parts.length) { if (remove) fail('INVALID_POINTER', 'Cannot delete root state'); return structuredClone(replacement); }
    let current = value;
    for (const part of parts.slice(0, -1)) {
        if (!current || typeof current !== 'object') fail('INVALID_POINTER', 'Pointer traverses a scalar');
        if (!Object.hasOwn(current, part)) current[part] = {};
        current = current[part];
    }
    const last = parts.at(-1);
    if (!current || typeof current !== 'object') fail('INVALID_POINTER', 'Pointer parent must be an object');
    if (Array.isArray(current) && (!/^\d+$/.test(last) || Number(last) > current.length)) fail('INVALID_POINTER', 'Invalid array index');
    if (remove) { if (Array.isArray(current)) current.splice(Number(last), 1); else delete current[last]; }
    else current[last] = structuredClone(replacement);
    return value;
}

export function redact(value, secrets = []) {
    if (typeof value === 'string') {
        let text = value.replace(/Bearer\s+[^\s"<]+/gi, 'Bearer [REDACTED]');
        for (const secret of secrets.filter(s => typeof s === 'string' && s.length > 0)) text = text.split(secret).join('[REDACTED]');
        return text;
    }
    if (Array.isArray(value)) return value.map(item => redact(item, secrets));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(token|tokenHash|ciphertext|authorization|password|secret|apiKey|api_key|llmApiKey)$/i.test(key) ? '[REDACTED]' : redact(item, secrets)]));
    return value;
}

export function isSerializationConflict(error) {
    const message = String(error?.message);
    const adapter = error?.meta?.driverAdapterError;
    const databaseCode = error?.meta?.code || adapter?.cause?.originalCode;
    return error?.code === 'P2034' || error?.code === '40001'
        || (error?.code === 'P2010' && (['40001', '40P01'].includes(databaseCode) || message.includes('40001')))
        || adapter?.name === 'TransactionWriteConflict'
        || adapter?.cause?.kind === 'TransactionWriteConflict'
        || error?.cause?.kind === 'TransactionWriteConflict'
        || message.includes('could not serialize access')
        || /write conflict or a deadlock|deadlock detected/i.test(message);
}

export function isTransientDatabaseError(error) {
    return ['P2028', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error?.code)
        || /Unable to start a transaction in the given time|Can't reach database server|Connection terminated|Timed out fetching a new connection|ECONNRESET|ETIMEDOUT/i.test(String(error?.message));
}

export async function serial(db, operation) {
    for (let attempt = 1; attempt <= 8; attempt++) {
        try { return await db.$transaction(operation, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 }); }
        catch (error) {
            const transient = isTransientDatabaseError(error);
            if ((!isSerializationConflict(error) && !transient) || attempt === 8) throw error;
            if (transient) console.warn('[Evaluation] Database busy, retrying', { attempt });
            else console.warn('[Evaluation] Serialization conflict, retrying', { attempt });
            const delay = transient
                ? Math.min(5000, 500 * attempt) + Math.random() * 200
                : Math.min(2000, 100 * 2 ** (attempt - 1)) + Math.random() * 100;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

export const safeError = error => !error?.statusCode && isSerializationConflict(error) ? {
    code: 'DATABASE_BUSY',
    message: 'The database was busy saving results. Run the evaluation again.',
} : !error?.statusCode && isTransientDatabaseError(error) ? {
    code: 'DATABASE_BUSY',
    message: 'The database did not respond in time. Run the evaluation again.',
} : ({
    code: error?.statusCode ? error.code || 'EVALUATION_ERROR' : 'INTERNAL_ERROR',
    message: error?.statusCode ? error.message : 'Evaluation could not complete. Check server configuration and retry.',
    ...(error?.statusCode && error?.details !== undefined ? { details: error.details } : {}),
});
