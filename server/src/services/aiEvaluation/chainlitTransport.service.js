import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fail } from './common.js';

/** Trusted helper runs inside the network-isolated container; no ports are published. */
export function chainlitTransport(container, { spawnProcess = spawn } = {}) {
    if (!/^covai-chatbot-[a-f0-9]{20}$/.test(container)) fail('INVALID_SANDBOX_RESOURCE', 'Invalid Chainlit container');
    const child = spawnProcess('docker', ['exec', '-i', container, 'python', '-I', '-u', '/covai/chainlit_client.py'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', closed = false, pending;
    child.stdout.setEncoding('utf8');
    const reject = code => { if (pending) { const row = pending; pending = null; row.cleanup(); row.reject(Object.assign(new Error(code), { code, statusCode: 502 })); } };
    child.stdin.on('error', () => reject('CHAINLIT_CONNECTION_ERROR'));
    child.stderr.on('data', () => {}); // Never forward dependency logs/auth data into evidence.
    child.on('error', () => { reject('CHAINLIT_CONNECTION_ERROR'); closed = true; });
    child.on('close', () => { reject('CHAINLIT_DISCONNECTED'); closed = true; });
    child.stdout.on('data', chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { reject('CHAINLIT_RESPONSE_LIMIT'); child.stdin.end(); child.kill(); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            let result;
            try { result = JSON.parse(line); } catch { reject('CHAINLIT_PROTOCOL_ERROR'); child.stdin.end(); child.kill(); return; }
            if (!pending || result.id !== pending.id) continue;
            const row = pending; pending = null; row.cleanup();
            if (!result.ok) row.reject(Object.assign(new Error(result.code || 'CHAINLIT_PROTOCOL_ERROR'), { code: result.code || 'CHAINLIT_PROTOCOL_ERROR', statusCode: 502 }));
            else row.resolve(result);
        }
    });
    const close = async () => {
        if (closed) return; closed = true; reject('CHAINLIT_SESSION_CLOSED');
        child.stdin.end(JSON.stringify({ id: crypto.randomUUID(), op: 'close' }) + '\n');
        const kill = setTimeout(() => child.kill(), 1000); kill.unref();
        child.once('close', () => clearTimeout(kill));
    };
    const request = (command, { signal, timeoutMs = 65000 } = {}) => new Promise((resolve, rejectRequest) => {
        if (closed || signal?.aborted) return rejectRequest(Object.assign(new Error('Chainlit session is closed or canceled'), { code: 'CHAINLIT_SESSION_CLOSED', statusCode: 409 }));
        if (pending) return rejectRequest(Object.assign(new Error('Concurrent Chainlit turns are not supported'), { code: 'CHAINLIT_CONCURRENT_TURN', statusCode: 409 }));
        const id = crypto.randomUUID();
        const abort = () => { reject('RUN_CANCELED'); close(); };
        const timer = setTimeout(() => { reject('CHAINLIT_TIMEOUT'); close(); }, timeoutMs);
        pending = { id, resolve, reject: rejectRequest, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
        signal?.addEventListener('abort', abort, { once: true });
        child.stdin.write(JSON.stringify({ ...command, id }) + '\n');
    });
    return { request, close };
}

export async function probeChainlitChatbot(runtime, candidate, { signal, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        signal?.throwIfAborted();
        try {
            const response = await runtime.request({}, { path: candidate.path.replace(/\/$/, '') + '/', method: 'GET', timeoutMs: 2000, signal });
            if (response.status === 200) { ready = true; break; }
        } catch { /* Startup polling only; no conversation is dispatched here. */ }
        await wait(500);
    }
    if (!ready) {
        const logs = await runtime.logs?.() || '';
        const missing = /KeyError:\s*['"]([A-Z][A-Z0-9_]*)['"]/.exec(logs);
        if (missing) fail('CHATBOT_CONFIGURATION_REQUIRED', `Chatbot source requires variable ${missing[1]}. Provide a test value for this variable and rerun.`);
        if (/ModuleNotFoundError|ImportError/.test(logs)) fail('CHATBOT_DEPENDENCY_ERROR', 'Chatbot failed to start due to dependency/import errors. Verify the Python manifest matches project requirements.');
        fail('CHATBOT_NOT_READY', 'Chainlit did not start and listen within the verification timeout.');
    }
    const session = await runtime.openChainlitSession({ signal });
    try {
        const response = await session.turn('Hello. Please briefly introduce your capabilities.', { signal, timeoutMs: 60000 });
        return { ready: true, protocol: 'CHAINLIT_SOCKET_IO', requestField: 'messages', path: candidate.path, port: 3000, probe: { status: 200, answer: response.answer.slice(0, 2000), provenance: 'COVAI_OBSERVED' } };
    } finally { await session.close(); }
}

export function chainlitTurnExecutor(runtime) {
    const conversations = new Map();
    const execute = async (_config, input, { timeoutMs = 60000 } = {}) => {
        let id = input.conversationId;
        if (!id) { id = crypto.randomUUID(); conversations.set(id, await runtime.openChainlitSession({ signal: input.signal })); }
        const session = conversations.get(id);
        if (!session) fail('CHAINLIT_SESSION_CLOSED', 'Chainlit session is closed; no request was replayed');
        const started = performance.now();
        let result;
        try { result = await session.turn(input.messages.at(-1).content, { signal: input.signal, timeoutMs }); }
        catch (error) { conversations.delete(id); await session.close(); throw error; }
        return { answer: result.answer, conversationId: id, latencyMs: Math.round(performance.now() - started), protocolEvidence: result.trace, evidenceAvailability: { usage: { availability: 'UNSUPPORTED', completeness: 'UNKNOWN', provenance: 'TARGET_REPORTED' } } };
    };
    execute.closeConversation = async id => { const session = conversations.get(id); conversations.delete(id); await session?.close(); };
    return execute;
}
