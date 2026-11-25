import { describe, expect, test } from '@jest/globals';
import { discoverWorkingConfig, findAnswerPointer } from '../services/aiEvaluation/connectionDiscovery.js';
import { executeTurn } from '../services/aiEvaluation/httpJson.adapter.js';

const config = {
    executionMode: 'MANAGED_PROJECT',
    endpointPath: '/api/chat',
    bindings: { '/initialField': 'latestUserMessage' },
    requestTemplate: {},
    conversationMode: 'messages',
    response: { format: 'json', answer: '/answer' },
};
const input = {
    requestId: 'request-1',
    conversationKey: 'conversation-1',
    messages: [{ role: 'user', content: 'Connection test' }],
};

function httpError(status, body) {
    const error = Object.assign(new Error('Your chatbot returned HTTP ' + status), {
        code: 'TARGET_HTTP_ERROR',
        details: { targetStatus: status },
    });
    Object.defineProperty(error, 'targetBody', { value: body });
    return error;
}

async function discover(bot, overrides = {}) {
    const execute = candidate => executeTurn(candidate, input, { transport: bot });
    let firstError;
    try {
        await execute(config);
    } catch (error) {
        firstError = error;
    }
    expect(firstError).toBeDefined();
    return discoverWorkingConfig({ config, firstError, execute, deadlineAt: Date.now() + 10000, ...overrides });
}

describe('findAnswerPointer', () => {
    test.each([
        [{ success: true, data: { reply: 'x' } }, '/data/reply'],
        [{ success: true, message: 'Success', data: { reply: 'x' } }, '/data/reply'],
        [{ choices: [{ message: { content: 'OpenAI reply' } }] }, '/choices/0/message/content'],
        [{ candidates: [{ content: { parts: [{ text: 'Gemini reply' }] } }] }, '/candidates/0/content/parts/0/text'],
        [[{ recipient_id: 'u', text: 'hi' }], '/0/text'],
        [{ messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q2' }] }, '/messages/1/content'],
        [{ success: false, error: 'x' }, null],
        [{ status: 'ok', id: '1', foo: 'only text' }, '/foo'],
        ['plain text', ''],
    ])('maps %j to %s', (raw, pointer) => {
        expect(findAnswerPointer(raw)).toBe(pointer);
    });
});

const bots = [
    { name: 'message and history', accepts: body => body.message && Array.isArray(body.history), reply: { data: { reply: 'OK' } }, answer: '/data/reply', field: '/message' },
    { name: 'question', accepts: body => body.question, field: '/question' },
    { name: 'Zod required path', accepts: body => body.userPrompt, status: 422, error: '{"errors":[{"path":["userPrompt"],"message":"Required"}]}', field: '/userPrompt' },
    { name: 'server error caused by missing prompt', accepts: body => body.prompt, status: 500, error: "Cannot read properties of undefined (reading 'trim')", field: '/prompt' },
    { name: 'OpenAI messages', accepts: body => body.messages?.[0]?.role === 'user', reply: { choices: [{ message: { content: 'OK' } }] }, answer: '/choices/0/message/content', field: '/messages' },
    { name: 'session and message', accepts: body => body.message && body.sessionId === input.conversationKey, error: 'sessionId is required', field: '/message', extra: { '/sessionId': 'generatedConversationId' } },
    { name: 'UI messages', accepts: body => body.messages?.[0]?.parts?.[0]?.text, field: '/messages', extra: { '/messages': 'uiMessages' } },
    { name: 'successful HTTP response rejecting the question', accepts: body => body.msg, rejection: { reply: 'Please enter a message' }, field: '/msg' },
    { name: 'Gemini contents', accepts: body => body.contents?.[0]?.parts?.[0]?.text, field: '/contents', extra: { '/contents': 'geminiContents' } },
    { name: 'strict query schema', accepts: body => Object.keys(body).length === 1 && body.query, field: '/query' },
];

describe('discoverWorkingConfig', () => {
    test.each(bots)('discovers $name', async ({ accepts, reply, answer, field, extra, rejection, status, error }) => {
        let acceptedCalls = 0;
        const discovery = await discover(({ body }) => {
            if (accepts(body)) {
                acceptedCalls++;
                return reply || { answer: 'OK' };
            }
            if (rejection) return rejection;
            throw httpError(status || 400, error || 'Invalid payload');
        });
        expect(discovery.config?.verifiedMapping).toBe(true);
        expect(discovery.config.bindings[field]).toBeDefined();
        if (extra) expect(discovery.config.bindings).toMatchObject(extra);
        expect(discovery.config.response.answer).toBe(answer || '/answer');
        expect(discovery.result.answer).toBe('OK');
        expect(acceptedCalls).toBe(1);
    });

    test('uses another managed POST endpoint with the saved body', async () => {
        const discovery = await discover(({ endpointPath, body }) => {
            if (endpointPath !== '/api/ask') throw httpError(404, 'Not found');
            expect(body).toEqual({ initialField: 'Connection test' });
            return { answer: 'OK' };
        }, { endpoints: ['/api/chat', '/api/ask'] });
        expect(discovery.config.endpointPath).toBe('/api/ask');
        expect(discovery.attempts).toBe(1);
    });

    test.each([[400, 'API key not valid'], [401, 'Unauthorized']])('stops on HTTP %s', async (status, body) => {
        const error = httpError(status, body);
        let calls = 0;
        await expect(discover(() => {
            calls++;
            throw error;
        })).rejects.toBe(error);
        expect(calls).toBe(1);
    });

    test('stops on an API key error in a successful HTTP response', async () => {
        const reply = { success: false, error: 'API key not valid' };
        let calls = 0;
        await expect(discover(() => {
            calls++;
            return reply;
        })).rejects.toMatchObject({ code: 'INVALID_ANSWER_MAPPING', targetRaw: reply });
        expect(calls).toBe(1);
    });

    test('keeps history when a hinted message field is accepted', async () => {
        const discovery = await discover(({ body }) => {
            if (!body.message) throw httpError(400, 'Message cannot be empty.');
            return { answer: 'OK' };
        });
        expect(discovery.config.bindings).toMatchObject({ '/message': 'latestUserMessage', '/history': 'history' });
    });

    test('keeps the autofill history pointer when a new message hint arrives', async () => {
        const discovery = await discover(({ body }) => {
            if (body.initialField) throw httpError(400, 'Invalid payload');
            if (!body.message) throw httpError(400, 'Message cannot be empty.');
            return { answer: 'OK' };
        }, { autoFill: { bindings: { '/query': 'latestUserMessage', '/chatHistory': 'history' } } });
        expect(discovery.config.bindings).toMatchObject({ '/message': 'latestUserMessage', '/chatHistory': 'history' });
    });

    test('rethrows a timeout on the second call without an adapted shape', async () => {
        const timeout = Object.assign(new Error('The connection test reached its time limit'), { code: 'TARGET_TIMEOUT' });
        let calls = 0;
        const execute = async () => {
            if (++calls === 2) throw timeout;
            throw httpError(400, 'Message is required');
        };
        const firstError = await execute(config).catch(error => error);
        await expect(discoverWorkingConfig({ config, firstError, execute, deadlineAt: Date.now() + 10000 })).rejects.toBe(timeout);
        expect(timeout).not.toHaveProperty('discoveredConfig');
    });

    test('attaches the adapted shape to a terminal failure', async () => {
        const error = httpError(400, 'API key not valid');
        await expect(discover(({ body }) => {
            if (body.message) throw error;
            throw httpError(400, 'Message is required');
        })).rejects.toBe(error);
        expect(error.discoveredConfig.bindings['/message']).toBe('latestUserMessage');
        expect(Object.keys(error)).not.toContain('discoveredConfig');
    });

    test.each(['/message', '/initialField'])('keeps the autofill answer pointer on terminal failure with autofill binding %s', async pointer => {
        const error = httpError(500, 'API key not valid');
        await expect(discover(({ body }) => {
            if (!body.message) throw httpError(400, 'Message cannot be empty.');
            throw error;
        }, { autoFill: { bindings: { [pointer]: 'latestUserMessage' }, responsePointer: '/data/reply' } })).rejects.toBe(error);
        expect(error.discoveredConfig.response.answer).toBe('/data/reply');
        expect(error.discoveredConfig.verifiedMapping).toBeUndefined();
    });

    test('returns no config when no request format works', async () => {
        const discovery = await discover(() => { throw httpError(400, 'Invalid payload'); });
        expect(discovery.config).toBeNull();
        expect(discovery.attempts).toBeGreaterThan(0);
        expect(discovery.attempts).toBeLessThanOrEqual(36);
    });
});

describe('executeTurn connection formats', () => {
    const messages = [
        { role: 'system', content: 'instructions' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
    ];
    test.each([
        ['chat', messages.slice(0, -1).map(message => ({ ...message, text: message.content }))],
        ['model', [
            { role: 'system', content: 'instructions', text: 'instructions' },
            { role: 'user', content: 'first', text: 'first' },
            { role: 'model', content: 'reply', text: 'reply' },
        ]],
        ['gemini', [{ role: 'user', parts: [{ text: 'first' }] }, { role: 'model', parts: [{ text: 'reply' }] }]],
        ['strings', ['instructions', 'first', 'reply']],
    ])('sends %s history and keeps the conversation ID stable', async (historyFormat, history) => {
        const candidate = {
            ...config,
            historyFormat,
            bindings: { '/message': 'latestUserMessage', '/history': 'history', '/sessionId': 'generatedConversationId' },
        };
        const bodies = [];
        const transport = ({ body }) => {
            bodies.push(body);
            return { answer: 'OK' };
        };
        await executeTurn(candidate, { ...input, messages }, { transport });
        await executeTurn(candidate, { ...input, requestId: 'request-2', messages }, { transport });
        expect(bodies).toEqual(Array(2).fill({ message: 'second', history, sessionId: input.conversationKey }));
    });
});
