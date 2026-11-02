import { fail, getPointer } from './common.js';
import { decodeProjectStream, responseProtocol } from './projectStream.service.js';
import crypto from 'node:crypto';

function answerFrom(body, preferred) {
    const pointers = [...new Set([...(preferred ? [`/${preferred}`] : []), '/answer', '/reply', '/response', '/message', '/message/content', '/text', '/content', '/data/answer', '/data/reply', '/data/message', '/choices/0/message/content'])];
    for (const pointer of pointers) if (typeof getPointer(body, pointer) === 'string') return { answer: getPointer(body, pointer), pointer };
    return null;
}
function bodyFor(field, messages, options = {}, shape, id) {
    const uiMessages = shape === 'AI_SDK_UI_MESSAGES';
    let value = field === 'messages' ? messages : messages.at(-1).content;
    if (field === 'messages' && uiMessages) value = messages.map((message, index) => ({ id: `covai-${index}`, role: message.role, parts: [{ type: 'text', text: message.content }] }));
    return { ...options, ...(uiMessages ? { id: id || crypto.randomUUID() } : {}), [field]: value };
}

/** Probe the actual isolated process; source detection by itself never sets ready=true. */
export async function probeProjectChatbot(runtime, candidate, { signal, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 15 } = {}) {
    const fields = [...new Set([candidate.requestField, 'message', 'messages', 'prompt', 'question'].filter(Boolean))];
    const ports = [...new Set([3000, ...(candidate.portHints || []), 5000, 8000, 8080])].slice(0, 5);
    let lastStatus = null;
    const requestOptions = candidate.inputFields?.includes('stream') && candidate.protocolHints?.includes('HTTP_SSE') ? { stream: true } : {};
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (signal?.aborted) fail('RUN_CANCELED', 'Evaluation canceled', 409);
        for (const port of ports) {
            for (const field of fields) {
                let result;
                try { result = await runtime.request(bodyFor(field, [{ role: 'user', content: 'Hello. Please briefly introduce your capabilities.' }], requestOptions, candidate.requestShape), { port, path: candidate.path, timeoutMs: 60000, signal }); }
                catch (error) { if (error.code === 'LOCAL_CONNECTION_REFUSED') break; throw error; }
                lastStatus = result.status;
                if ([401, 403].includes(result.status)) fail('CHATBOT_AUTH_REQUIRED', 'The imported chatbot requires application authentication before it can be evaluated');
                if (result.status === 429) fail('CHATBOT_RATE_LIMIT', 'The chatbot model provider or application is rate limited');
                if (result.status >= 500) fail('CHATBOT_RUNTIME_ERROR', 'The chatbot route is reachable but failed while generating a response; check required model keys and runtime configuration');
                if (result.status < 200 || result.status >= 300) continue;
                const protocol = responseProtocol(result);
                if (protocol !== 'HTTP_JSON') {
                    const decoded = decodeProjectStream(result.body, protocol);
                    return { ready: true, protocol, requestShape: candidate.requestShape || 'CHAT_MESSAGES', requestOptions, requestField: field, port, path: candidate.path, probe: { status: result.status, answer: decoded.answer, protocolEvidence: decoded.protocolEvidence, provenance: 'COVAI_OBSERVED' } };
                }
                let body;
                try { body = JSON.parse(result.body); } catch { fail('CHATBOT_RESPONSE_UNSUPPORTED', 'Chatbot returned a streaming or non-JSON response; a matching project adapter is required'); }
                const matched = answerFrom(body, candidate.answerField);
                if (!matched || !matched.answer.trim()) fail('CHATBOT_ANSWER_MISSING', 'The route responded but did not return a nonempty chatbot answer in a supported JSON field');
                return { ready: true, protocol, requestShape: candidate.requestShape || 'CHAT_MESSAGES', requestOptions, requestField: field, answerPointer: matched.pointer, port, path: candidate.path, probe: { status: result.status, answer: matched.answer, provenance: 'COVAI_OBSERVED' } };
            }
        }
        await wait(1000);
    }
    fail('CHATBOT_NOT_READY', lastStatus ? `Chatbot did not satisfy a supported request/response contract (last HTTP ${lastStatus})` : 'Chatbot did not start listening before the readiness deadline');
}

export function projectTurnExecutor(runtime, contract) {
    return async (_config, input, { timeoutMs = 60000 } = {}) => {
        if (input.signal?.aborted) fail('RUN_CANCELED', 'Evaluation canceled', 409);
        const start = performance.now();
        const conversationId = contract.requestShape === 'AI_SDK_UI_MESSAGES' ? input.conversationId || crypto.randomUUID() : undefined;
        const response = await runtime.request(bodyFor(contract.requestField, input.messages, contract.requestOptions, contract.requestShape, conversationId), { port: contract.port, path: contract.path, timeoutMs, signal: input.signal });
        if (response.status < 200 || response.status >= 300) fail('CHATBOT_HTTP_ERROR', `Imported chatbot returned HTTP ${response.status}`, 502);
        const protocol = responseProtocol(response);
        if (protocol !== (contract.protocol || 'HTTP_JSON')) fail('CHATBOT_PROTOCOL_CHANGED', 'Chatbot protocol changed after readiness verification');
        if (protocol !== 'HTTP_JSON') return { ...decodeProjectStream(response.body, protocol), ...(conversationId ? { conversationId } : {}), latencyMs: Math.round(performance.now() - start), evidenceAvailability: { usage: { availability: 'UNSUPPORTED', completeness: 'UNKNOWN', provenance: 'TARGET_REPORTED' } } };
        let parsed;
        try { parsed = JSON.parse(response.body); } catch { fail('CHATBOT_INVALID_JSON', 'Imported chatbot response is not valid JSON', 502); }
        const answer = getPointer(parsed, contract.answerPointer);
        if (typeof answer !== 'string') fail('CHATBOT_ANSWER_MISSING', 'Chatbot answer no longer matches the verified contract', 502);
        return { answer, ...(conversationId ? { conversationId } : {}), latencyMs: Math.round(performance.now() - start), evidenceAvailability: { usage: { availability: 'UNSUPPORTED', completeness: 'UNKNOWN', provenance: 'TARGET_REPORTED' } } };
    };
}
