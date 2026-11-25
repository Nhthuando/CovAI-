import { canonical, getPointer, same } from './common.js';
import { targetSchema } from './contracts.js';
import { ServiceError } from '../../utils/serviceError.js';

const answerKeys = ['reply', 'answer', 'botReply', 'aiResponse', 'assistantMessage', 'response', 'output', 'completion',
    'generated_text', 'message', 'text', 'content', 'result', 'data', 'body'];
const ignoredKeys = new Set(['error', 'errors', 'id', '_id', 'model', 'role', 'status', 'code', 'type', 'createdAt',
    'updatedAt', 'timestamp', 'sessionId', 'conversationId', 'threadId', 'userId', 'question', 'prompt', 'query', 'input',
    'userMessage', 'history', 'sources', 'citations', 'usage', 'token', '__proto__', 'constructor', 'prototype']);
const questionFields = ['message', 'question', 'prompt', 'query', 'input', 'text', 'content', 'userMessage', 'user_message',
    'userInput', 'msg', 'q', 'chatInput', 'userQuery', 'user_input', 'userPrompt'];
const historyFields = ['history', 'chatHistory', 'chat_history', 'conversationHistory', 'conversation_history',
    'previousMessages', 'pastMessages', 'conversation', 'pastConversation', 'chatLog', 'prevMessages'];
const sessionFields = ['sessionId', 'session_id', 'conversationId', 'conversation_id', 'threadId', 'thread_id', 'chatId', 'chat_id'];
const idFields = [...sessionFields, 'userId', 'user_id', 'user', 'sender'];
const retryableCodes = new Set(['TARGET_HTTP_ERROR', 'INVALID_ANSWER_MAPPING', 'INVALID_TARGET_JSON', 'INVALID_TARGET_SSE',
    'SESSION_UNAVAILABLE', 'TARGET_REJECTED_QUESTION']);
const fieldPattern = new RegExp('\\b(' + [...questionFields, 'messages', 'contents', ...historyFields, ...idFields].join('|') + ')\\b', 'gi');
const requiredPattern = /\b(required|missing|empty|not provided|invalid)\b|please (enter|provide|type|send)/i;
const requiredQuestionPattern = new RegExp('\\b(?:' + [...questionFields, 'messages', 'contents'].join('|')
    + ')\\b.{0,40}\\b(?:required|missing|empty|not provided)\\b|\\b(?:required|missing)\\b.{0,40}\\b(?:'
    + [...questionFields, 'messages', 'contents'].join('|') + ')\\b', 'i');
const statusText = /^(ok|success(ful(ly)?)?|done|.{0,40}success(fully)?\.?)$/i;
const html = value => typeof value === 'string' && /^\s*(?:<!doctype\b|<html\b)/i.test(value);
const usableAnswer = value => typeof value === 'string' && Boolean(value.trim()) && !html(value);
const errorPayload = value => value && typeof value === 'object'
    && (value.success === false || value.ok === false || value.error || /^(error|fail|failed)$/i.test(value.status));
const escapePointer = key => key.replace(/~/g, '~0').replace(/\//g, '~1');

function children(value) {
    if (!Array.isArray(value)) {
        return Object.keys(value).filter(key => !ignoredKeys.has(key));
    }
    const assistant = value.findLastIndex(item => /^(assistant|model|bot|ai)$/i.test(item?.role));
    if (assistant >= 0) return [String(assistant)];
    if (value.length && value.every(item => typeof item?.role === 'string')) return [];
    return value.length > 1 ? ['0', String(value.length - 1)] : value.length ? ['0'] : [];
}

export function findAnswerPointer(raw) {
    if (typeof raw === 'string') return usableAnswer(raw) ? '' : null;
    if (!raw || typeof raw !== 'object' || errorPayload(raw)) return null;
    for (const pointer of ['/choices/0/message/content', '/choices/0/text', '/candidates/0/content/parts/0/text',
        '/content/0/text', '/message/content', '/output_text']) {
        if (usableAnswer(getPointer(raw, pointer))) return pointer;
    }
    let level = [{ value: raw, pointer: '' }];
    const keyed = [];
    const leaves = [];
    for (let depth = 1; level.length && depth <= 5; depth++) {
        const next = [];
        for (const { value, pointer } of level) {
            for (const key of children(value)) {
                const child = value[key];
                const path = pointer + '/' + escapePointer(key);
                if (usableAnswer(child)) {
                    const rank = answerKeys.indexOf(key);
                    if (rank >= 0) keyed.push({ path, pointer, rank, depth, status: key === 'message' && statusText.test(child.trim()) });
                    if (child.trim().length > 1) leaves.push(path);
                } else if (child && typeof child === 'object' && !errorPayload(child)) {
                    next.push({ value: child, pointer: path });
                }
            }
        }
        level = next;
    }
    keyed.sort((a, b) => a.depth - b.depth || a.rank - b.rank);
    const best = keyed[0];
    if (best?.status) {
        const nested = keyed.find(item => ['data', 'result'].some(key => item.path.startsWith(best.pointer + '/' + key + '/')));
        if (nested) return nested.path;
    }
    return best?.path ?? (leaves.length === 1 ? leaves[0] : null);
}

export function looksLikeRejectedQuestion(answer) {
    return typeof answer === 'string' && answer.length < 200
        && /\b(message|question|prompt|query|input|text|content|messages)\b.{0,40}\b(is |are |must |cannot |can't |can not |should )?(required|missing|empty|not provided|be empty|invalid)|please (enter|provide|type|send) (a |your )?(message|question|prompt)|vui lòng nhập|không được (để )?trống/i.test(answer);
}

export function connectionReplyError(result) {
    if (looksLikeRejectedQuestion(result.answer)) {
        const error = new ServiceError('The chatbot rejected the test question', 502, 'TARGET_REJECTED_QUESTION');
        Object.defineProperty(error, 'targetBody', { value: result.answer });
        return error;
    }
    if (!usableAnswer(result.answer) || errorPayload(result.raw)) {
        const error = new ServiceError('The chatbot did not return a usable answer', 502, 'INVALID_ANSWER_MAPPING');
        Object.defineProperty(error, 'targetRaw', { value: result.raw });
        return error;
    }
    return null;
}

const errorText = error => [error?.targetBody, error?.message,
    errorPayload(error?.targetRaw) ? JSON.stringify(error.targetRaw).slice(0, 2000) : null].filter(Boolean).join('\n');
const targetStatus = error => error?.details?.targetStatus ?? error?.targetStatus;

function hintedFields(error) {
    return [...new Set([...errorText(error).matchAll(fieldPattern)].map(([field]) =>
        [...questionFields, 'messages', 'contents', ...historyFields, ...idFields].find(name => name.toLowerCase() === field.toLowerCase())))];
}

export function isTerminalFailure(error) {
    const status = targetStatus(error);
    const text = errorText(error);
    if ([401, 403, 429].includes(status) || !retryableCodes.has(error?.code)) return true;
    if (([400, 422].includes(status) || errorPayload(error?.targetRaw))
        && requiredQuestionPattern.test(text.replace(/"[^"]+"\s*:/g, ''))) return false;
    return /api[ _-]?key|quota|rate.?limit|RESOURCE_EXHAUSTED|PERMISSION_DENIED|unauthori[sz]ed|credential|model .{0,60}(not found|not supported|does not exist|deprecated)|ECONNREFUSED|ENOTFOUND|fetch failed|prisma|sequelize|mongo|database|relation .* does not exist|no such table/i.test(text);
}

const withoutSession = bindings => Object.fromEntries(Object.entries(bindings).filter(([, binding]) => binding !== 'conversationId'));
const bodyKey = ({ bindings, requestTemplate }) => canonical({ bindings, requestTemplate });
const findHistoryPointer = bindings => Object.entries(bindings ?? {}).find(([, binding]) => binding === 'history')?.[0];
const autoFillResponse = (response, autoFill) => ({
    ...response,
    format: autoFill.responseFormat ?? response.format,
    answer: autoFill.responsePointer ?? response.answer,
});

export function bodyCandidates({ config, autoFill, error, historyPointer = findHistoryPointer(autoFill?.bindings)
    ?? findHistoryPointer(config.bindings) ?? '/history' }) {
    const candidates = [];
    const seen = new Set([bodyKey(config)]);
    const fields = hintedFields(error);
    const ids = Object.fromEntries(fields.filter(field => idFields.includes(field)).map(field => ['/' + field, 'generatedConversationId']));
    const history = Object.fromEntries(fields.filter(field => historyFields.includes(field)).map(field => ['/' + field, 'history']));
    const hasHistoryHint = Object.keys(history).length > 0;
    const add = (bindings, requestTemplate = config.requestTemplate, conversationMode = 'messages', historyFormat = config.historyFormat, response) => {
        if (config.mockGateway) {
            bindings = { ...bindings, ...Object.fromEntries(Object.entries(config.bindings).filter(([, binding]) => binding === 'evaluationContext')) };
        }
        const candidate = { bindings, requestTemplate, conversationMode, historyFormat };
        const key = bodyKey(candidate);
        if (seen.has(key)) return;
        seen.add(key);
        if (response) candidate.response = response;
        candidates.push(candidate);
    };
    if (autoFill?.bindings) {
        const session = autoFill.conversationMode === 'session' && (autoFill.responseConversationIdPointer || config.response.conversationId)
            && Object.values(autoFill.bindings).includes('conversationId');
        const response = autoFillResponse(config.response, autoFill);
        if (session) response.conversationId = autoFill.responseConversationIdPointer ?? config.response.conversationId;
        add(autoFill.conversationMode === 'session' && !session ? withoutSession(autoFill.bindings) : autoFill.bindings, { ...config.requestTemplate, ...autoFill.requestTemplate },
            session ? 'session' : 'messages', autoFill.historyFormat ?? config.historyFormat, response);
    }
    for (const field of fields) {
        const binding = field === 'messages' ? 'messages' : field === 'contents' ? 'geminiContents'
            : questionFields.includes(field) ? 'latestUserMessage' : null;
        if (binding === 'latestUserMessage' && !hasHistoryHint) {
            add({ ['/' + field]: 'latestUserMessage', [historyPointer]: 'history', ...ids });
        }
        if (binding) add({ ['/' + field]: binding, ...history, ...ids });
    }
    if (hasHistoryHint || Object.keys(ids).length) {
        add({ ...withoutSession(config.bindings), ...history, ...ids });
    }
    for (const field of questionFields) add({ ['/' + field]: 'latestUserMessage', [historyPointer]: 'history', ...history, ...ids });
    add({ '/messages': 'messages', ...ids });
    add({ '/messages': 'uiMessages', ...ids });
    add({ '/contents': 'geminiContents', ...ids });
    add({ '/message/content': 'latestUserMessage', ...ids });
    add({ '/data/message': 'latestUserMessage', ...ids });
    for (const field of questionFields.slice(0, 6)) add({ ['/' + field]: 'latestUserMessage', ...ids });
    add({ ...Object.fromEntries(questionFields.map(field => ['/' + field, 'latestUserMessage'])), '/messages': 'messages', [historyPointer]: 'history', ...ids });
    return candidates;
}

function resolveReply(candidate, error) {
    const response = { ...candidate.response };
    if (error.code === 'INVALID_ANSWER_MAPPING') {
        const answer = findAnswerPointer(error.targetRaw);
        if (answer !== null) {
            response.answer = answer;
            if (candidate.conversationMode === 'session' && !usableAnswer(getPointer(error.targetRaw, response.conversationId))) {
                return resolveReply({ ...candidate, response }, { code: 'SESSION_UNAVAILABLE', targetRaw: error.targetRaw });
            }
            return {
                config: { ...candidate, response },
                result: { answer: getPointer(error.targetRaw, answer), latencyMs: null, evidenceAvailability: {} },
            };
        }
    }
    if (error.code === 'SESSION_UNAVAILABLE') {
        const conversationId = ['', '/data'].flatMap(base => sessionFields.map(field => base + '/' + field))
            .find(pointer => {
                const value = getPointer(error.targetRaw, pointer);
                return typeof value === 'string' && Boolean(value.trim()) && value.length <= 1000;
            });
        if (conversationId) return { config: { ...candidate, response: { ...response, conversationId } } };
        delete response.conversationId;
        return { config: { ...candidate, response, bindings: withoutSession(candidate.bindings), conversationMode: 'messages' } };
    }
    if (['INVALID_TARGET_JSON', 'INVALID_TARGET_SSE'].includes(error.code) && usableAnswer(error.targetText)) {
        response.format = error.code === 'INVALID_TARGET_JSON'
            && (/text\/event-stream/i.test(error.targetContentType) || /^\s*(event|data|id):/m.test(error.targetText)) ? 'sse' : 'text';
        if (response.format !== candidate.response.format) return { config: { ...candidate, response } };
    }
    return null;
}

export async function discoverWorkingConfig({ config, autoFill, endpoints = [], firstError, execute, deadlineAt, maxAttempts = 36 }) {
    let attempts = 0;
    const tried = new Set();
    const canAttempt = () => attempts < maxAttempts && Date.now() < deadlineAt;
    const checkTerminal = (candidate, error) => {
        if (!isTerminalFailure(error)) return;
        if (['TARGET_HTTP_ERROR', 'TARGET_RATE_LIMIT'].includes(error.code)
            && ![401, 403, 404, 405].includes(targetStatus(error)) && !same(candidate, config)) {
            Object.defineProperty(error, 'discoveredConfig', { value: candidate });
        }
        throw error;
    };
    const accept = (candidate, result) => {
        const error = connectionReplyError(result);
        if (error) return { error };
        return { config: { ...candidate, verifiedMapping: true }, result };
    };
    const probe = async (candidate, error) => {
        while (true) {
            if (!error) {
                const key = canonical(candidate);
                if (!canAttempt() || tried.has(key) || !targetSchema.safeParse(candidate).success) return {};
                tried.add(key);
                attempts++;
                try {
                    const outcome = accept(candidate, await execute(candidate));
                    if (outcome.config) return outcome;
                    error = outcome.error;
                } catch (failure) {
                    error = failure;
                }
            }
            checkTerminal(candidate, error);
            const resolved = resolveReply(candidate, error);
            if (!resolved) return { error };
            if (resolved.result) return accept(resolved.config, resolved.result);
            candidate = resolved.config;
            error = null;
        }
    };
    tried.add(canonical(config));
    let base = config;
    let outcome = await probe(base, firstError);
    if (outcome.config) return { ...outcome, attempts };
    let error = outcome.error ?? firstError;
    const wrongEndpoint = failure => [404, 405].includes(targetStatus(failure));
    if (config.executionMode === 'MANAGED_PROJECT' && wrongEndpoint(error)) {
        const paths = [...new Set(endpoints)].filter(path => typeof path === 'string' && /^\/(?!\/)[\w\-./]*$/.test(path)
            && path.length <= 300 && path !== config.endpointPath).slice(0, 5);
        for (const endpointPath of paths) {
            if (!canAttempt()) break;
            const candidate = { ...config, endpointPath };
            outcome = await probe(candidate);
            if (outcome.config) return { ...outcome, attempts };
            if (outcome.error && !wrongEndpoint(outcome.error)) {
                base = candidate;
                error = outcome.error;
                break;
            }
        }
    }
    let candidates = bodyCandidates({ config: base, autoFill, error });
    const seenHints = new Set(hintedFields(error));
    let hints = errorText(error);
    while (candidates.length && canAttempt()) {
        const body = candidates.shift();
        let response = body.response ?? base.response;
        if (!body.response && autoFill?.responsePointer && config.response.answer !== autoFill.responsePointer) {
            response = autoFillResponse(response, autoFill);
        }
        if (body.conversationMode === 'session' && autoFill?.responseConversationIdPointer) {
            response = { ...response, conversationId: autoFill.responseConversationIdPointer };
        }
        outcome = await probe({ ...base, ...body, response });
        if (outcome.config) return { ...outcome, attempts };
        const nextHints = hintedFields(outcome.error).filter(field => !seenHints.has(field));
        if (nextHints.length && requiredPattern.test(errorText(outcome.error))) {
            for (const field of nextHints) seenHints.add(field);
            hints = errorText(outcome.error) + '\n' + hints;
            candidates = bodyCandidates({ config: base, error: { message: hints }, historyPointer: findHistoryPointer(autoFill?.bindings) });
        }
    }
    return { config: null, result: null, attempts };
}
