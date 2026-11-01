import crypto from 'node:crypto';
import { ServiceError } from '../../utils/serviceError.js';

export const VERSIONS = Object.freeze({ adapter: 'http-json-v1', rules: 'rules-v1', mock: 'mock-v1', judge: 'judge-v1' });
export const TASKS = ['KNOWLEDGE_QA', 'USAGE_GUIDANCE', 'ACTION_TOOL'];
export const TERMINAL = ['COMPLETED', 'ERROR', 'CANCELED', 'INDETERMINATE'];
export const fail = (code, message, status = 422) => { throw new ServiceError(message, status, code); };
export const enabled = () => process.env.AI_EVALUATION_ENABLED === 'true';
export const requireEnabled = () => { if (!enabled()) fail('FEATURE_DISABLED', 'AI evaluation is disabled. Enable AI_EVALUATION_ENABLED on the server.', 503); };
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
export const same = (a, b) => canonical(a) === canonical(b);
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
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(token|tokenHash|ciphertext|authorization|password|secret|apiKey|api_key)$/i.test(key) ? '[REDACTED]' : redact(item, secrets)]));
    return value;
}
export async function serial(db, operation) {
    for (let attempt = 0; ; attempt++) {
        try { return await db.$transaction(operation, { isolationLevel: 'Serializable', timeout: 20000 }); }
        catch (error) { if (error.code !== 'P2034' || attempt >= 3) throw error; }
    }
}
export const safeError = error => ({ code: error?.statusCode ? error.code || 'EVALUATION_ERROR' : 'INTERNAL_ERROR', message: error?.statusCode ? error.message : 'Evaluation could not complete. Check server configuration and retry.' });
