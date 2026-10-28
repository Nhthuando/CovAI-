import { createHash } from 'node:crypto';

export const canonicalizeOperationInput = value => {
    const active = new WeakSet();
    const encode = item => {
        if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
        if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
        if (!item || typeof item !== 'object' || active.has(item)) throw new TypeError('Operation input must be acyclic JSON');
        active.add(item);
        let result;
        if (Array.isArray(item)) result = `[${item.map(encode).join(',')}]`;
        else {
            if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Operation input must contain plain JSON objects');
            result = `{${Object.keys(item).sort().filter(key=>item[key] !== undefined).map(key=>`${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
        }
        active.delete(item);
        return result;
    };
    return encode(value);
};

export const hashOperationInput = input => createHash('sha256').update(canonicalizeOperationInput(input)).digest('hex');
