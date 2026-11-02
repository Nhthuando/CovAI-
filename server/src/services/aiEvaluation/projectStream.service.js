import { fail } from './common.js';

export const STREAM_PARSER_VERSION = 'project-stream-v1';

/** Bounded, closed dialects. Never treats tool arguments, reasoning or arbitrary JSON as an answer. */
export function decodeProjectStream(body, protocol) {
    if (typeof body !== 'string' || Buffer.byteLength(body) > 1024 * 1024) fail('CHATBOT_RESPONSE_LIMIT', 'Chatbot stream exceeds its response limit');
    const frames = protocol === 'HTTP_SSE' ? body.replace(/\r\n?/g, '\n').split('\n\n').slice(0, -1).map(block => {
        const lines = block.split('\n');
        return { event: lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message', data: lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n') };
    }) : protocol === 'HTTP_NDJSON' ? body.split(/\r?\n/).map(data => ({ event: 'message', data })) : [];
    if (frames.length > 20000) fail('CHATBOT_EVENT_LIMIT', 'Chatbot stream contains too many events');
    let answer = '', completed = false, events = 0;
    for (const frame of frames) {
        const data = frame.data.trim();
        if (!data) continue;
        events++;
        if (data === '[DONE]') { completed = true; continue; }
        let value;
        try { value = JSON.parse(data); } catch { fail('CHATBOT_INVALID_STREAM', 'Chatbot stream contains invalid JSON events'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CHATBOT_INVALID_STREAM', 'Unsupported stream event');
        if (frame.event === 'error' || value.error || value.type === 'error') fail('CHATBOT_STREAM_ERROR', 'Chatbot reported an error during streaming');
        const choice = value.choices?.[0];
        const terminal = ['done', 'complete', 'message_stop'].includes(frame.event) || value.done === true || ['finish', 'message_stop'].includes(value.type) || (choice?.finish_reason != null);
        let delta, snapshot;
        if (typeof choice?.delta?.content === 'string') delta = choice.delta.content;
        else if (typeof choice?.message?.content === 'string') snapshot = choice.message.content;
        else if (value.type === 'content_block_start' && value.content_block?.type === 'text' && typeof value.content_block.text === 'string') delta = value.content_block.text;
        else if (value.type === 'content_block_delta' && typeof value.delta?.text === 'string') delta = value.delta.text;
        else if (value.type === 'text-delta' && typeof value.delta === 'string') delta = value.delta;
        else if (protocol === 'HTTP_NDJSON' && (!value.message?.role || value.message.role === 'assistant') && typeof value.message?.content === 'string') delta = value.message.content;
        else if (protocol === 'HTTP_NDJSON' && typeof value.response === 'string') delta = value.response;
        else if (!value.type || ['token', 'delta', 'message', 'answer', 'done', 'complete'].includes(value.type)) {
            if (typeof value.token === 'string') delta = value.token;
            else if (typeof value.delta === 'string') delta = value.delta;
            else if (typeof value.answer === 'string') snapshot = value.answer;
        }
        if (completed && (delta || snapshot)) fail('CHATBOT_INVALID_STREAM', 'Answer data arrived after stream completion');
        if (delta !== undefined) answer += delta;
        if (snapshot !== undefined) answer = snapshot;
        if (Buffer.byteLength(answer) > 1024 * 1024) fail('CHATBOT_RESPONSE_LIMIT', 'Chatbot answer exceeds its response limit');
        if (terminal) completed = true;
    }
    if (!completed) fail('CHATBOT_STREAM_INCOMPLETE', 'Stream ended without a supported completion event; the partial answer was not scored');
    if (!answer.trim()) fail('CHATBOT_ANSWER_MISSING', 'Completed stream contains no assistant answer');
    return { answer, protocolEvidence: { protocol, parserVersion: STREAM_PARSER_VERSION, events, completed } };
}

export function responseProtocol(response) {
    const type = String(response.contentType || '').split(';')[0].trim().toLowerCase();
    if (type === 'text/event-stream') return 'HTTP_SSE';
    if (['application/x-ndjson', 'application/ndjson'].includes(type)) return 'HTTP_NDJSON';
    if (!type || type === 'application/json' || type.endsWith('+json')) return 'HTTP_JSON';
    fail('CHATBOT_RESPONSE_UNSUPPORTED', 'No adapter is available for the observed response Content-Type');
}
