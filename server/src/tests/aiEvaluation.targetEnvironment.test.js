import { describe, test, expect } from '@jest/globals';
import http from 'node:http';

const { parse, targetSchema } = await import('../services/aiEvaluation/contracts.js');
const { targetErrorSnippet, createManagedLoopbackLease, requestManagedLoopbackJson } = await import('../services/aiEvaluation/httpJson.adapter.js');
const { lastLogLines } = await import('../services/aiEvaluation/management.service.js');
const { lastLogLines: commonLastLogLines } = await import('../services/aiEvaluation/common.js');

const managedConfig = {
    executionMode: 'MANAGED_PROJECT',
    endpointPath: '/api/chat',
    response: { format: 'json', answer: '/answer', metadata: '/metadata' },
};

describe('Target extra environment', () => {
    test('accepts a managed model setting and defaults to no settings', () => {
        expect(parse(targetSchema, { ...managedConfig, environment: { GEMINI_MODEL: 'gemini-3.1-flash-lite' } }).environment)
            .toEqual({ GEMINI_MODEL: 'gemini-3.1-flash-lite' });
        expect(parse(targetSchema, managedConfig).environment).toEqual({});
    });

    test.each(['OPENAI_API_KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASSWD', 'CREDENTIAL', 'PRIVATE', 'PORT', 'HOST', 'HOSTNAME', 'NODE_OPTIONS', 'PATH', 'NODE_PATH', 'COVAI_X', 'port', 'covai_x'])(
        'rejects secret or reserved setting %s', name => {
            const result = targetSchema.safeParse({ ...managedConfig, environment: { [name]: 'value' } });
            expect(result.success).toBe(false);
            expect(result.error.issues.some(issue => issue.path.join('.') === `environment.${name}`)).toBe(true);
        },
    );

    test('rejects a detected LLM variable without regard to case', () => {
        expect(() => parse(targetSchema, { ...managedConfig, llmEnvVars: ['LLM_AUTH'], environment: { llm_auth: 'value' } }))
            .toThrow('Enter the API key in the key field, not as a setting');
    });

    test('rejects newlines in setting values', () => {
        expect(() => parse(targetSchema, { ...managedConfig, environment: { GEMINI_MODEL: 'one\ntwo' } })).toThrow();
    });

    test('rejects more than 20 settings', () => {
        const environment = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`SETTING_${index}`, 'value']));
        expect(() => parse(targetSchema, { ...managedConfig, environment })).toThrow('Use at most 20 extra settings');
    });

    test('rejects settings for an external URL', () => {
        expect(() => parse(targetSchema, {
            ...managedConfig, executionMode: 'EXTERNAL_URL', endpoint: 'https://example.com/chat', environment: { GEMINI_MODEL: 'model' },
        })).toThrow('Extra settings only apply when CovAI starts your chatbot');
    });
});

describe('Chatbot log tails', () => {
    test('exports the same log formatter from common', () => {
        expect(commonLastLogLines).toBe(lastLogLines);
    });

    test('removes ANSI codes and joins only the last six non-empty lines', () => {
        expect(lastLogLines('old\n\n\x1b[31mone\x1b[0m\n \n two\t words\nthree\nfour\nfive\nsix\n'))
            .toBe('one | two words | three | four | five | six');
    });

    test('keeps the last 400 characters with an ellipsis when cut', () => {
        const text = `discard${'x'.repeat(399)}z`;
        const result = lastLogLines(text);
        expect(result.startsWith('…')).toBe(true);
        expect(result.length).toBeLessThanOrEqual(401);
        expect(result.slice(1)).toBe(text.slice(-400));
    });
});

describe('Target HTTP error snippets', () => {
    test('reports a timeout from a real managed loopback POST', async () => {
        const sockets = new Set();
        const server = http.createServer(request => request.resume());
        server.on('connection', socket => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const lease = createManagedLoopbackLease({ port: server.address().port, pid: process.pid });
        try {
            await expect(requestManagedLoopbackJson({
                lease, endpointPath: '/api/chat', body: {}, timeoutMs: 1000,
            })).rejects.toMatchObject({
                code: 'TARGET_TIMEOUT',
                message: 'Your chatbot did not answer within 1 s',
            });
        } finally {
            lease.revoke();
            await new Promise(resolve => {
                server.close(resolve);
                for (const socket of sockets) socket.destroy();
            });
        }
    });

    test('joins JSON error and details', () => {
        expect(targetErrorSnippet(JSON.stringify({ error: 'Une erreur', details: '404 model gone' })))
            .toBe('Une erreur — 404 model gone');
    });

    test('extracts nested error messages in field order', () => {
        expect(targetErrorSnippet(JSON.stringify({ error: { message: 'boom' }, message: 'failed', details: ' ', detail: 'gone' })))
            .toBe('boom — failed — gone');
    });

    test('cuts long text to 200 characters plus ellipsis', () => {
        expect(targetErrorSnippet('x'.repeat(201))).toBe(`${'x'.repeat(200)}…`);
    });

    test('collapses whitespace in plain text', () => {
        expect(targetErrorSnippet('  model\n unavailable\t now  ')).toBe('model unavailable now');
    });

    test.each([[500, 'TARGET_HTTP_ERROR'], [429, 'TARGET_RATE_LIMIT']])('reports HTTP %s from a real managed loopback POST', async (status, code) => {
        const server = http.createServer((request, response) => {
            request.resume();
            response.writeHead(status, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'boom', details: 'model unavailable' }));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const lease = createManagedLoopbackLease({ port: server.address().port, pid: process.pid });
        try {
            const result = requestManagedLoopbackJson({ lease, endpointPath: '/api/chat', body: {} });
            await expect(result).rejects.toMatchObject({
                message: `Your chatbot returned HTTP ${status}: boom — model unavailable`,
                code,
                statusCode: 502,
                details: { targetStatus: status },
            });
            await expect(result).rejects.toHaveProperty('message', expect.not.stringContaining('redirects'));
        } finally {
            lease.revoke();
            await new Promise(resolve => server.close(resolve));
        }
    });
});
