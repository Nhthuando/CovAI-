import https from 'node:https';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { fail, getPointer, safeJson, setPointer } from './common.js';
import { parse, targetSchema } from './contracts.js';

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
export async function requestPublicJson({ endpoint, body, headers = {}, signal, timeoutMs = 60000 }) {
    const { url, address } = await resolvePublic(endpoint);
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 1024 * 1024) fail('REQUEST_TOO_LARGE', 'Target request exceeds 1 MiB');
    return new Promise((resolve, reject) => {
        const error = (code, message) => { try { fail(code, message, 502); } catch (e) { return e; } };
        const request = https.request(url, { method: 'POST', agent: false, signal, rejectUnauthorized: true,
            lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'identity', ...headers, 'Content-Length': Buffer.byteLength(payload) },
        }, response => {
            if (response.statusCode < 200 || response.statusCode >= 300) { request.destroy(error(response.statusCode === 429 ? 'TARGET_RATE_LIMIT' : 'TARGET_HTTP_ERROR', `Target returned HTTP ${response.statusCode}; redirects are not followed`)); return; }
            let size = 0; const chunks = [];
            response.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(error('RESPONSE_TOO_LARGE', 'Target response exceeds 1 MiB')); else chunks.push(chunk); });
            response.on('error', () => reject(error('TARGET_CONNECTION_ERROR', 'Target response was interrupted')));
            response.on('end', () => { try { resolve(safeJson(JSON.parse(Buffer.concat(chunks).toString('utf8')))); } catch { reject(error('INVALID_TARGET_JSON', 'Target response must be valid JSON')); } });
        });
        const timer = setTimeout(() => request.destroy(error('TARGET_TIMEOUT', 'Target request timed out')), timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.on('error', e => reject(e.statusCode ? e : error(signal?.aborted ? 'REQUEST_ABORTED' : 'TARGET_CONNECTION_ERROR', signal?.aborted ? 'Target request was canceled' : 'Unable to connect to target')));
        request.end(payload);
    });
}
export async function executeTurn(configInput, input, { credential, transport = requestPublicJson, timeoutMs = 60000 } = {}) {
    const config = parse(targetSchema, configInput);
    let body = structuredClone(config.requestTemplate);
    for (const [pointer, binding] of Object.entries(config.bindings)) if (input[binding] !== undefined) body = setPointer(body, pointer, input[binding]);
    const headers = {};
    if (config.auth.type !== 'none') {
        if (!credential) fail('CREDENTIAL_REQUIRED', 'Configure an active target credential');
        headers[config.auth.type === 'bearer' ? 'Authorization' : config.auth.header] = config.auth.type === 'bearer' ? `Bearer ${credential}` : credential;
    }
    const start = performance.now();
    const raw = await transport({ endpoint: config.endpoint, body, headers, signal: input.signal, timeoutMs });
    const answer = getPointer(raw, config.response.answer);
    if (typeof answer !== 'string') fail('INVALID_ANSWER_MAPPING', 'Response answer mapping must resolve to a string', 502);
    const result = { answer, latencyMs: Math.round(performance.now() - start), evidenceAvailability: {} };
    for (const key of ['conversationId', 'citations', 'retrievedContext', 'toolTrace', 'usage', 'metadata']) {
        const value = config.response[key] === undefined ? undefined : getPointer(raw, config.response[key]);
        const valid = key === 'conversationId' ? typeof value === 'string' && value.length <= 1000 : ['citations', 'retrievedContext', 'toolTrace'].includes(key) ? Array.isArray(value) : value !== null && typeof value === 'object' && !Array.isArray(value);
        result.evidenceAvailability[key] = { availability: config.response[key] === undefined ? 'UNSUPPORTED' : value === undefined ? 'MISSING' : valid ? 'AVAILABLE' : 'INVALID', completeness: 'UNKNOWN', provenance: 'TARGET_REPORTED' };
        if (valid) result[key] = value;
    }
    if (config.conversationMode === 'session' && !result.conversationId) fail('SESSION_UNAVAILABLE', 'Target did not return a valid conversation ID', 502);
    return result;
}
