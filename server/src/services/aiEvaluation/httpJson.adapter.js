import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { fail, getPointer, safeJson, setPointer } from './common.js';
import { parse, targetSchema } from './contracts.js';

const MANAGED_LOOPBACK_CAP = Symbol('covai.managedLoopbackLease');

export function targetErrorSnippet(text) {
    let snippet = text;
    try {
        const body = JSON.parse(text);
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            snippet = [typeof body.error === 'object' ? body.error?.message : body.error, body.message, body.details, body.detail]
                .filter(value => typeof value === 'string' && value.trim()).join(' — ');
        }
    } catch { /* Plain text responses are useful too. */ }
    snippet = snippet.replace(/\s+/g, ' ').trim();
    return snippet.length > 200 ? `${snippet.slice(0, 200)}…` : snippet;
}

function readTargetHttpError(response, reject) {
    const status = response.statusCode;
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (withSnippet = false) => {
        if (settled) return;
        settled = true;
        const body = Buffer.concat(chunks).toString('utf8');
        const snippet = withSnippet ? targetErrorSnippet(body) : '';
        try {
            fail(status === 429 ? 'TARGET_RATE_LIMIT' : 'TARGET_HTTP_ERROR', `Your chatbot returned HTTP ${status}${snippet ? `: ${snippet}` : ''}`, 502);
        } catch (error) {
            error.details = { targetStatus: status };
            Object.defineProperty(error, 'targetBody', { value: body });
            reject(error);
        }
    };
    response.on('data', chunk => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(bytes.subarray(0, 4096 - size));
        size += Math.min(bytes.length, 4096 - size);
        if (size === 4096) {
            finish(true);
            response.destroy();
        }
    });
    response.once('end', () => finish(true));
    response.once('error', () => finish());
    response.once('aborted', () => finish());
    response.once('close', () => finish());
    return () => finish();
}

const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(ip, prefix, 'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::', 3, 'ipv6');
for (const [ip, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blocked.addSubnet(ip, prefix, 'ipv6');
export const isPublicAddress = address => isIP(address) === 4 ? !blocked.check(address, 'ipv4') : isIP(address) === 6 && global6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
export function validateEndpoint(endpoint) {
    let url; try { url = new URL(endpoint); } catch { fail('INVALID_ENDPOINT', 'Enter a valid HTTPS endpoint'); }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || /(^localhost$|\.(localhost|local|internal)$)/i.test(host) || (isIP(host) && !isPublicAddress(host))) fail('UNSAFE_ENDPOINT', 'Use a public HTTPS endpoint on port 443 without embedded credentials');
    if ([...url.searchParams.keys()].some(key => /token|key|secret|password|credential/i.test(key))) fail('UNSAFE_ENDPOINT', 'Store credentials in the credential field, not the endpoint URL');
    return url;
}
export async function resolvePublic(endpoint, lookup = dns.lookup) {
    const url = validateEndpoint(endpoint);
    let timer;
    try {
        const addresses = await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 5000); })]);
        if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) fail('UNSAFE_ENDPOINT', 'Target DNS must resolve exclusively to public addresses');
        return { url, address: addresses[0] };
    } catch (error) { if (error.statusCode) throw error; fail('TARGET_DNS_ERROR', 'Target DNS could not be resolved', 502); }
    finally { clearTimeout(timer); }
}

export function createManagedLoopbackLease({ port, pid, isProcessAlive = () => true }) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail('INVALID_LOOPBACK_LEASE', 'Managed loopback lease requires a valid TCP port (1-65535)', 500);
    }
    if (!Number.isInteger(pid) || pid <= 0) {
        fail('INVALID_LOOPBACK_LEASE', 'Managed loopback lease requires a valid child process PID', 500);
    }
    let revoked = false;
    return Object.freeze({
        [MANAGED_LOOPBACK_CAP]: true,
        host: '127.0.0.1',
        port,
        pid,
        isActive: () => !revoked && Boolean(isProcessAlive()),
        revoke: () => { revoked = true; },
    });
}

export function isManagedLoopbackLeaseValid(lease) {
    return Boolean(
        lease &&
        typeof lease === 'object' &&
        lease[MANAGED_LOOPBACK_CAP] === true &&
        lease.host === '127.0.0.1' &&
        Number.isInteger(lease.port) &&
        lease.port >= 1 &&
        lease.port <= 65535 &&
        typeof lease.isActive === 'function' &&
        lease.isActive() === true,
    );
}

function withTargetText(error, text, contentType) {
    Object.defineProperty(error, 'targetText', { value: Buffer.from(text).subarray(0, 64 * 1024).toString('utf8') });
    Object.defineProperty(error, 'targetContentType', { value: contentType });
    return error;
}

function failWithRaw(code, message, raw) {
    try { fail(code, message, 502); } catch (error) {
        Object.defineProperty(error, 'targetRaw', { value: raw });
        throw error;
    }
}

function parseSseBody(rawText, answerPointer = '/answer') {
    const tokens = [];
    let finalObject = null;
    for (const line of rawText.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
            const parsed = safeJson(JSON.parse(payload));
            if (typeof parsed === 'string') {
                tokens.push(parsed);
            } else if (parsed && typeof parsed === 'object') {
                const pointed = getPointer(parsed, answerPointer);
                const delta = parsed.choices?.[0]?.delta?.content ?? parsed.delta ?? parsed.token ?? parsed.text ?? parsed.content;
                if (typeof pointed === 'string') tokens.push(pointed);
                else if (typeof delta === 'string') tokens.push(delta);
                finalObject = parsed;
            }
        } catch {
            tokens.push(payload);
        }
    }
    const combined = tokens.join('');
    if (finalObject && typeof finalObject === 'object' && !Array.isArray(finalObject)) {
        try {
            return setPointer(structuredClone(finalObject), answerPointer || '/answer', combined);
        } catch {
            return { ...finalObject, answer: combined };
        }
    }
    return setPointer({}, answerPointer || '/answer', combined);
}

export async function requestManagedLoopbackJson({
    lease,
    endpointPath = '/api/chat',
    endpoint,
    targetHost,
    targetPort,
    responseFormat = 'json',
    answerPointer = '/answer',
    body,
    headers = {},
    signal,
    timeoutMs = 60000,
}) {
    if (!isManagedLoopbackLeaseValid(lease)) {
        fail('LOOPBACK_LEASE_INVALID', 'Managed chatbot loopback lease is missing, expired, or has been revoked', 502);
    }
    if (targetHost !== undefined && targetHost !== '127.0.0.1') {
        fail('LOOPBACK_PORT_MISMATCH', `Managed loopback adapter can only call http://127.0.0.1:${lease.port}`, 403);
    }
    if (targetPort !== undefined && Number(targetPort) !== lease.port) {
        fail('LOOPBACK_PORT_MISMATCH', `Managed loopback adapter can only call http://127.0.0.1:${lease.port}`, 403);
    }

    let resolvedPath = endpointPath || '/api/chat';
    if (endpoint !== undefined) {
        let parsedUrl;
        try {
            parsedUrl = new URL(endpoint);
        } catch {
            fail('INVALID_ENDPOINT', 'Invalid managed loopback endpoint URL', 400);
        }
        if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1' || Number(parsedUrl.port) !== lease.port || parsedUrl.username || parsedUrl.password) {
            fail('LOOPBACK_PORT_MISMATCH', `Managed loopback adapter can only call http://127.0.0.1:${lease.port}`, 403);
        }
        resolvedPath = `${parsedUrl.pathname}${parsedUrl.search}`;
    }

    if (typeof resolvedPath !== 'string' || !/^\/(?!\/)[^\r\n\0]*$/.test(resolvedPath)) {
        fail('INVALID_ENDPOINT_PATH', 'Managed loopback path must start with a single "/" and contain no control characters', 400);
    }

    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 1024 * 1024) fail('REQUEST_TOO_LARGE', 'Target request exceeds 1 MiB');

    return new Promise((resolve, reject) => {
        let rejectHttpError = null;
        const error = (code, message, status = 502) => {
            try { fail(code, message, status); } catch (e) { return e; }
        };
        const req = http.request(
            {
                protocol: 'http:',
                hostname: '127.0.0.1',
                port: lease.port,
                path: resolvedPath,
                method: 'POST',
                agent: false,
                signal,
                headers: {
                    Host: `127.0.0.1:${lease.port}`,
                    'Content-Type': 'application/json',
                    Accept: responseFormat === 'sse' ? 'text/event-stream, application/json' : 'application/json',
                    'Accept-Encoding': 'identity',
                    ...headers,
                    'Content-Length': Buffer.byteLength(payload),
                },
            },
            response => {
                if (response.statusCode >= 300 && response.statusCode < 400) {
                    req.destroy(error('TARGET_REDIRECT_BLOCKED', `Managed target returned HTTP ${response.statusCode}; redirects from managed loopback targets are forbidden`));
                    return;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    rejectHttpError = readTargetHttpError(response, reject);
                    return;
                }
                let size = 0;
                const chunks = [];
                response.on('data', chunk => {
                    size += chunk.length;
                    if (size > 1024 * 1024) req.destroy(error('RESPONSE_TOO_LARGE', 'Target response exceeds 1 MiB'));
                    else chunks.push(chunk);
                });
                response.on('error', () => reject(error('TARGET_CONNECTION_ERROR', 'Target response was interrupted')));
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    const contentType = String(response.headers['content-type'] || '').toLowerCase();
                    if (responseFormat === 'text') { resolve(text); return; }
                    if (responseFormat === 'sse' || contentType.includes('text/event-stream')) {
                        try {
                            resolve(parseSseBody(text, answerPointer));
                        } catch {
                            reject(withTargetText(error('INVALID_TARGET_SSE', 'Target SSE stream could not be parsed'), text, contentType));
                        }
                        return;
                    }
                    try {
                        resolve(safeJson(JSON.parse(text)));
                    } catch {
                        if (contentType.startsWith('text/plain')) resolve(text);
                        else reject(withTargetText(error('INVALID_TARGET_JSON', 'Target response must be valid JSON'), text, contentType));
                    }
                });
            },
        );
        const timer = setTimeout(() => req.destroy(error('TARGET_TIMEOUT', `Your chatbot did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
        req.on('close', () => clearTimeout(timer));
        req.on('error', e => rejectHttpError ? rejectHttpError() : reject(e.statusCode ? e : error(signal?.aborted ? 'REQUEST_ABORTED' : 'TARGET_CONNECTION_ERROR', signal?.aborted ? 'Target request was canceled' : 'Unable to connect to managed chatbot target')));
        req.end(payload);
    });
}

export async function requestPublicJson({ endpoint, responseFormat = 'json', answerPointer = '/answer', body, headers = {}, signal, timeoutMs = 60000 }) {
    const { url, address } = await resolvePublic(endpoint);
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 1024 * 1024) fail('REQUEST_TOO_LARGE', 'Target request exceeds 1 MiB');
    return new Promise((resolve, reject) => {
        let rejectHttpError = null;
        const error = (code, message) => { try { fail(code, message, 502); } catch (e) { return e; } };
        const request = https.request(url, { method: 'POST', agent: false, signal, rejectUnauthorized: true,
            lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
            headers: { 'Content-Type': 'application/json', 'Accept': responseFormat === 'sse' ? 'text/event-stream, application/json' : 'application/json', 'Accept-Encoding': 'identity', ...headers, 'Content-Length': Buffer.byteLength(payload) },
        }, response => {
            if (response.statusCode < 200 || response.statusCode >= 300) { rejectHttpError = readTargetHttpError(response, reject); return; }
            let size = 0; const chunks = [];
            response.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(error('RESPONSE_TOO_LARGE', 'Target response exceeds 1 MiB')); else chunks.push(chunk); });
            response.on('error', () => reject(error('TARGET_CONNECTION_ERROR', 'Target response was interrupted')));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                const contentType = String(response.headers['content-type'] || '').toLowerCase();
                if (responseFormat === 'text') { resolve(text); return; }
                if (responseFormat === 'sse' || contentType.includes('text/event-stream')) {
                    try { resolve(parseSseBody(text, answerPointer)); } catch { reject(withTargetText(error('INVALID_TARGET_SSE', 'Target SSE stream could not be parsed'), text, contentType)); }
                    return;
                }
                try { resolve(safeJson(JSON.parse(text))); } catch {
                    if (contentType.startsWith('text/plain')) resolve(text);
                    else reject(withTargetText(error('INVALID_TARGET_JSON', 'Target response must be valid JSON'), text, contentType));
                }
            });
        });
        const timer = setTimeout(() => request.destroy(error('TARGET_TIMEOUT', `Your chatbot did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.on('error', e => rejectHttpError ? rejectHttpError() : reject(e.statusCode ? e : error(signal?.aborted ? 'REQUEST_ABORTED' : 'TARGET_CONNECTION_ERROR', signal?.aborted ? 'Target request was canceled' : 'Unable to connect to target')));
        request.end(payload);
    });
}
const modelRole = role => role === 'assistant' ? 'model' : role;
const geminiMessages = messages => messages.filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));

function formatHistory(messages, format) {
    if (!messages) return undefined;
    if (format === 'gemini') return geminiMessages(messages);
    if (format === 'strings') return messages.map(m => m.content);
    return messages.map(m => ({ role: format === 'model' ? modelRole(m.role) : m.role, content: m.content, text: m.content }));
}

export async function executeTurn(configInput, input, { credential, lease = null, transport, timeoutMs = 60000 } = {}) {
    const config = parse(targetSchema, configInput);
    const messages = Array.isArray(input.messages) ? input.messages : undefined;
    const lastUserIndex = messages?.findLastIndex(m => m?.role === 'user') ?? -1;
    const resolvedInput = {
        ...input,
        latestUserMessage: input.latestUserMessage ?? input.messages?.filter(m => m?.role === 'user').at(-1)?.content,
        // Prior turns for targets that take { message, history }; "text" mirrors "content" for bots that read either field.
        history: formatHistory(messages?.slice(0, Math.max(lastUserIndex, 0)), config.historyFormat),
        generatedConversationId: input.conversationKey ?? input.requestId,
        uiMessages: messages?.map((m, index) => ({
            id: `m${index}`, role: m.role, content: m.content, parts: [{ type: 'text', text: m.content }],
        })),
        geminiContents: messages ? geminiMessages(messages) : undefined,
    };
    let body = structuredClone(config.requestTemplate);
    for (const [pointer, binding] of Object.entries(config.bindings)) if (resolvedInput[binding] !== undefined) body = setPointer(body, pointer, resolvedInput[binding]);
    const headers = {};
    if (config.auth.type !== 'none') {
        if (!credential) fail('CREDENTIAL_REQUIRED', 'Configure an active target credential');
        headers[config.auth.type === 'bearer' ? 'Authorization' : config.auth.header] = config.auth.type === 'bearer' ? `Bearer ${credential}` : credential;
    }
    const start = performance.now();
    const activeTransport = transport || (config.executionMode === 'MANAGED_PROJECT' ? requestManagedLoopbackJson : requestPublicJson);
    const raw = config.executionMode === 'MANAGED_PROJECT'
        ? await activeTransport({
            lease,
            endpointPath: config.endpointPath,
            endpoint: config.endpoint,
            responseFormat: config.response.format,
            answerPointer: config.response.answer,
            body,
            headers,
            signal: input.signal,
            timeoutMs,
        })
        : await activeTransport({
            endpoint: config.endpoint,
            responseFormat: config.response.format,
            answerPointer: config.response.answer,
            body,
            headers,
            signal: input.signal,
            timeoutMs,
        });
    const answer = typeof raw === 'string' ? raw : getPointer(raw, config.response.answer);
    if (typeof answer !== 'string') failWithRaw('INVALID_ANSWER_MAPPING', 'Response answer mapping must resolve to a string', raw);
    const result = { answer, latencyMs: Math.round(performance.now() - start), evidenceAvailability: {} };
    for (const key of ['conversationId', 'citations', 'retrievedContext', 'toolTrace', 'usage', 'metadata']) {
        const value = typeof raw === 'string' || config.response[key] === undefined ? undefined : getPointer(raw, config.response[key]);
        const valid = key === 'conversationId' ? typeof value === 'string' && value.length <= 1000 : ['citations', 'retrievedContext', 'toolTrace'].includes(key) ? Array.isArray(value) : value !== null && typeof value === 'object' && !Array.isArray(value);
        result.evidenceAvailability[key] = { availability: config.response[key] === undefined ? 'UNSUPPORTED' : value === undefined ? 'MISSING' : valid ? 'AVAILABLE' : 'INVALID', completeness: 'UNKNOWN', provenance: 'TARGET_REPORTED' };
        if (valid) result[key] = value;
    }
    if (config.conversationMode === 'session' && !result.conversationId) failWithRaw('SESSION_UNAVAILABLE', 'Target did not return a valid conversation ID', raw);
    Object.defineProperty(result, 'raw', { value: raw });
    return result;
}
