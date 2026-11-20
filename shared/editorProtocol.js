export const EDITOR_LIMITS = Object.freeze({ fileBytes: 1024 * 1024, stateBytes: 8 * 1024 * 1024, updateBytes: 2 * 1024 * 1024, lines: 20000, awarenessBytes: 4096, batchMs: 40, heartbeatMs: 15000, expiryMs: 45000 });
export const EDITOR_NAMESPACE = '/editor';
// Socket.IO delivers ArrayBuffer in browsers and Buffer/Uint8Array in Node.
export function editorBinaryBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new Error('Invalid editor binary message.');
}
// Live editing is on unless explicitly disabled (PROJECT_EDITOR_ENABLED=false), so a rewritten .env cannot silently turn it off.
export const editorEnabled = () => typeof process !== 'undefined' && String(process.env.PROJECT_EDITOR_ENABLED ?? '').trim().toLowerCase() !== 'false';
