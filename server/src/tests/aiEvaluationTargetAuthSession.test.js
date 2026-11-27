import { describe, it, expect, afterEach } from '@jest/globals';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
    createManagedAuthSession,
    findSeededAccounts,
    pickAuthRoutes,
    registerBodies,
    withAuthSession,
} from '../services/aiEvaluation/targetAuthSession.service.js';
import { createManagedLoopbackLease } from '../services/aiEvaluation/httpJson.adapter.js';

const servers = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

function readJson(request) {
    return new Promise(resolve => {
        let text = '';
        request.on('data', chunk => { text += chunk; });
        request.on('end', () => { try { resolve(JSON.parse(text || '{}')); } catch { resolve(null); } });
    });
}

async function serve(handler) {
    const server = http.createServer(async (request, response) => {
        const body = request.method === 'POST' ? await readJson(request) : null;
        const reply = (status, json, headers = {}) => {
            response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
            response.end(JSON.stringify(json));
        };
        handler({ request, body, reply });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const { port } = server.address();
    return createManagedLoopbackLease({ port, pid: process.pid });
}

const cookie = (request, name) => (request.headers.cookie || '').split('; ').find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);

describe('Managed chatbot automatic sign-in', () => {
    it('registers through a strict CSRF-protected API, keeps the session cookie and renews it after 401', async () => {
        const users = new Map();
        let lease;
        const sessions = new Set();
        let issued = 0;
        lease = await serve(({ request, body, reply }) => {
            const origin = `http://127.0.0.1:${lease.port}`;
            if (request.url === '/api/v1/auth/csrf') return reply(200, { csrfToken: 'preauth-token' }, { 'Set-Cookie': 'preauth=preauth-token; HttpOnly' });
            if (request.headers.origin !== origin) return reply(403, { error: 'ORIGIN_FORBIDDEN' });
            if (request.url === '/api/v1/auth/register') {
                if (request.headers['x-csrf-token'] !== 'preauth-token' || cookie(request, 'preauth') !== 'preauth-token') return reply(403, { error: 'CSRF' });
                const keys = Object.keys(body).sort().join(',');
                if (keys !== 'displayName,email,password') return reply(400, { error: 'strict schema' });
                users.set(body.email, body.password);
                return reply(201, { ok: true });
            }
            if (request.url === '/api/v1/auth/login') {
                if (users.get(body.email) !== body.password) return reply(401, { error: 'bad credentials' });
                const session = `s${++issued}`;
                sessions.add(session);
                return reply(200, { user: { email: body.email } }, { 'Set-Cookie': `sid=${session}; HttpOnly` });
            }
            if (request.url === '/api/v1/support/messages') {
                if (!sessions.has(cookie(request, 'sid'))) return reply(401, { error: 'login required' });
                return reply(200, { answer: 'OK' });
            }
            return reply(404, {});
        });
        // Parsed without the router mount prefix, as with factory-mounted Express routers.
        const endpoints = [
            { method: 'GET', path: '/csrf' },
            { method: 'POST', path: '/register', requestBodySchema: [] },
            { method: 'POST', path: '/login' },
            { method: 'GET', path: '/google' },
        ];
        const logs = [];
        const secrets = [];
        const session = await createManagedAuthSession({ lease, endpoints, apiPath: '/api/v1/support/messages', log: async message => logs.push(message), secretSink: secrets });
        expect(session.method).toBe('registered');
        expect(session.headers.Cookie).toContain('sid=s1');
        expect(secrets.join(' ')).toContain('sid=s1');
        expect(logs[0]).toMatch(/new CovAI test account/);

        let calls = 0;
        const executor = async (config, input, options) => {
            calls += 1;
            if (calls === 1) {
                sessions.clear();
                const error = new Error('Your chatbot returned HTTP 401');
                error.code = 'TARGET_HTTP_ERROR';
                error.details = { targetStatus: 401 };
                throw error;
            }
            return { headers: options.authHeaders };
        };
        executor.closeConversation = async () => 'closed';
        const wrapped = withAuthSession(executor, session);
        const result = await wrapped({}, {}, {});
        expect(result.headers.Cookie).toContain('sid=s2');
        expect(await wrapped.closeConversation()).toBe('closed');
    });

    it('returns a bearer token from the login reply and falls back to seeded accounts when register is missing', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-auth-'));
        fs.mkdirSync(path.join(root, 'prisma'));
        fs.writeFileSync(path.join(root, 'prisma', 'seed.js'), "await prisma.user.create({ data: { email: 'demo@shop.test', password: await hash('Demo@123') } });\nconst admin = { email: 'admin@shop.test', password: 'Admin@123' };");
        const lease = await serve(({ request, body, reply }) => {
            if (request.url === '/api/auth/login') {
                if (body.email === 'admin@shop.test' && body.password === 'Admin@123') return reply(200, { data: { accessToken: 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl' } });
                return reply(401, {});
            }
            return reply(404, {});
        });
        const session = await createManagedAuthSession({ lease, rootDir: root, endpoints: [{ method: 'POST', path: '/api/auth/login' }] });
        expect(session.method).toBe('seeded');
        expect(session.credential).toBe('eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl');
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('continues without credentials when nothing can sign in', async () => {
        const lease = await serve(({ reply }) => reply(404, {}));
        const session = await createManagedAuthSession({ lease, endpoints: [] });
        expect(session.method).toBe('anonymous');
        expect(session.headers).toEqual({});
        expect(await session.refresh()).toBe(false);
    });

    it('picks local auth routes, skips OAuth/reset routes and builds bodies from detected fields', () => {
        const routes = pickAuthRoutes([
            { method: 'POST', path: '/api/auth/google/login' },
            { method: 'POST', path: '/api/auth/forgot-password' },
            { method: 'POST', path: '/api/users/signup', requestBodySchema: ['fullName', 'email', 'password', 'confirmPassword'] },
            { method: 'POST', path: '/api/users/signin' },
        ]);
        expect(routes.register).toEqual([{ path: '/api/users/signup', fields: ['fullName', 'email', 'password', 'confirmPassword'] }]);
        expect(routes.login.map(route => route.path)).toEqual(['/api/users/signin']);
        const account = { email: 'a@example.com', password: 'Pw1!', username: 'user', name: 'CovAI Evaluator' };
        expect(registerBodies(routes.register[0].fields, account)[0]).toEqual({ fullName: 'CovAI Evaluator', email: 'a@example.com', password: 'Pw1!', confirmPassword: 'Pw1!' });
        expect(pickAuthRoutes([]).login.length).toBeGreaterThan(0);
    });

    it('skips hashed or environment passwords in seed files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-seed-'));
        fs.writeFileSync(path.join(root, 'seed.js'), "{ email: 'a@x.test', password: '$2b$10$abcdefghijk' }\n{ email: 'b@x.test', password: process.env.ADMIN_PASSWORD }");
        expect(findSeededAccounts(root)).toEqual([]);
        fs.rmSync(root, { recursive: true, force: true });
    });
});
