import { getPointer, setPointer, same, fail, safeJson } from './common.js';
import { compileSchema } from './contracts.js';

function valueOf(value, args, state) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && Object.hasOwn(value, '$from') && Object.hasOwn(value, 'path')) {
        if (!['args', 'state'].includes(value.$from)) fail('INVALID_BINDING', 'Unknown mock binding');
        const result = getPointer(value.$from === 'args' ? args : state, value.path);
        if (result === undefined) fail('MISSING_BINDING', 'Mock binding has no value');
        return structuredClone(result);
    }
    if (Array.isArray(value)) return value.map(item => valueOf(item, args, state));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, valueOf(child, args, state)]));
    return value;
}
export function conditionMatches(condition, args, state) {
    const actual = getPointer(condition.source === 'args' ? args : state, condition.path);
    const expected = condition.value;
    if (condition.op === 'exists') return (actual !== undefined) === (expected !== false);
    if (actual === undefined) return false;
    if (condition.op === 'eq') return same(actual, expected);
    if (condition.op === 'ne') return !same(actual, expected);
    if (condition.op === 'in') return Array.isArray(expected) && expected.some(v => same(v, actual));
    if (typeof actual !== 'number' || typeof expected !== 'number') return false;
    return { gt: actual > expected, gte: actual >= expected, lt: actual < expected, lte: actual <= expected }[condition.op] === true;
}
export function executeMock(tool, args, previousState) {
    safeJson(args); safeJson(previousState);
    const unchanged = (status, result) => ({ status, result, state: previousState });
    if (!compileSchema(tool.inputSchema)(args)) return unchanged('INVALID_ARGUMENTS', { error: 'Arguments do not match the approved input schema' });
    const branch = tool.branches.find(b => b.when.every(c => conditionMatches(c, args, previousState)));
    if (!branch) return unchanged('MOCK_ERROR', { error: 'No mock branch matched' });
    if (branch.error) return unchanged('TOOL_ERROR', branch.error);
    try {
        let state = structuredClone(previousState);
        for (const effect of branch.effects) {
            let next = valueOf(effect.value, args, state);
            const current = getPointer(state, effect.path);
            if (effect.op === 'increment') { if (!Number.isFinite(current) || !Number.isFinite(next) || !Number.isFinite(current + next)) fail('MOCK_ERROR', 'Increment requires finite numbers'); next += current; }
            if (effect.op === 'append') { if (!Array.isArray(current) || current.length >= 5000) fail('MOCK_ERROR', 'Append requires a bounded array'); next = [...current, next]; }
            state = setPointer(state, effect.path, next, effect.op === 'delete');
        }
        const result = valueOf(branch.result, args, state);
        if (!compileSchema(tool.outputSchema)(result)) return unchanged('MOCK_ERROR', { error: 'Mock output does not match the approved schema' });
        if (Buffer.byteLength(JSON.stringify({ state, result })) > 512 * 1024) return unchanged('MOCK_ERROR', { error: 'Mock state/output is too large' });
        return { status: 'EXECUTED', result, state };
    } catch { return unchanged('MOCK_ERROR', { error: 'Mock transition could not be applied' }); }
}
