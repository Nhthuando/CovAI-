import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { extractValidEndpoints } from '../apiEndpointParser.service.js';
import { isManagedLoopbackLeaseValid } from './httpJson.adapter.js';

/*
 * Signs CovAI in to a Managed Project chatbot without asking the user for a token.
 * The chatbot runs in an isolated workspace and database that CovAI started, so it is
 * safe to create a throwaway account there:
 *   A. register a new test account through the app's own register route, then log in;
 *   B. otherwise log in with an account the project seeds (seed/fixture/README files);
 *   C. otherwise continue without credentials (many chat routes allow anonymous use).
 * Tokens and cookies stay in memory and are renewed when the chatbot answers 401/403.
 */

const REGISTER_PATH = /(?:^|\/)(?:register|signup|sign-up|sign_up|create-account)(?:\/|$)/i;
const LOGIN_PATH = /(?:^|\/)(?:login|signin|sign-in|sign_in|authenticate)(?:\/|$)/i;
const EXCLUDED_PATH = /google|github|facebook|oauth|sso|saml|magic|otp|verify|refresh|logout|admin|reset|forgot|:\w+/i;
const CSRF_PATH = /csrf|xsrf/i;
const TOKEN_KEY = /^(?:token|accessToken|access_token|jwt|jwtToken|idToken|id_token|authToken|auth_token|sessionToken|session_token|bearerToken)$/i;
const CSRF_KEY = /^(?:csrfToken|csrf_token|csrf|_csrf|xsrfToken|xsrf)$/i;
const JWT_SHAPE = /^[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/;
const GUESS_PREFIXES = ['/api/auth', '/api/v1/auth', '/auth', '/api/users', '/api', '/api/v1/users', '/users'];
const MAX_ATTEMPTS = 14;

export function isTargetAuthFailure(error) {
    const status = error?.details?.targetStatus;
    return error?.code === 'TARGET_HTTP_ERROR' && [401, 403, 419].includes(status);
}

function loopbackRequest(lease, { method = 'POST', requestPath, body, headers = {}, timeoutMs = 10000, signal }) {
    if (!isManagedLoopbackLeaseValid(lease)) return Promise.reject(new Error('Managed chatbot is not running'));
    const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const request = http.request({
            protocol: 'http:', hostname: '127.0.0.1', port: lease.port, path: requestPath, method, agent: false, signal,
            headers: {
                Host: `127.0.0.1:${lease.port}`,
                Accept: 'application/json',
                'Accept-Encoding': 'identity',
                ...(payload === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
                ...headers,
            },
        }, response => {
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size <= 256 * 1024) chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(text); } catch { json = null; }
                const setCookie = response.headers['set-cookie'];
                resolve({ status: response.statusCode, json, cookies: Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [] });
            });
        });
        const timer = setTimeout(() => request.destroy(new Error('Auth request timed out')), timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.on('error', reject);
        request.end(payload ?? undefined);
    });
}

function findValue(value, keyPattern, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 4) return null;
    for (const [key, item] of Object.entries(value)) {
        if (keyPattern.test(key) && typeof item === 'string' && item.length >= 8 && item.length <= 4096) return item;
    }
    for (const item of Object.values(value)) {
        const found = findValue(item, keyPattern, depth + 1);
        if (found) return found;
    }
    return null;
}

class CookieJar {
    constructor() { this.cookies = new Map(); }
    store(setCookies = []) {
        for (const line of setCookies) {
            const pair = String(line).split(';')[0];
            const index = pair.indexOf('=');
            if (index <= 0) continue;
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) this.cookies.delete(name);
            else this.cookies.set(name, value);
        }
    }
    header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
    find(pattern) { return [...this.cookies].find(([name, value]) => pattern(name, value))?.[1] || null; }
    get size() { return this.cookies.size; }
}

export function newTestAccount() {
    const id = crypto.randomBytes(4).toString('hex');
    return {
        email: `covai.eval.${id}@example.com`,
        password: `CovAi!${crypto.randomBytes(6).toString('hex')}9x`,
        username: `covai_eval_${id}`,
        name: 'CovAI Evaluator',
    };
}

function fieldValue(field, account) {
    const name = field.toLowerCase();
    if (/email/.test(name)) return account.email;
    if (/confirm|repeat|again|password2|retype/.test(name)) return account.password;
    if (/password|^pass$|pwd/.test(name)) return account.password;
    if (/user_?name|login|handle|nick/.test(name)) return account.username;
    if (/first/.test(name)) return 'CovAI';
    if (/last|family|surname/.test(name)) return 'Evaluator';
    if (/name/.test(name)) return account.name;
    if (/phone|mobile/.test(name)) return '0912345678';
    if (/terms|agree|accept|consent/.test(name)) return true;
    return undefined;
}

export function registerBodies(fields = [], account) {
    const bodies = [];
    const fromSchema = Object.fromEntries(fields.map(field => [field, fieldValue(field, account)]).filter(([, value]) => value !== undefined));
    if (fromSchema.password && (fromSchema.email || fromSchema.username)) bodies.push(fromSchema);
    const { email, password, username, name } = account;
    bodies.push(
        { email, password, name },
        { email, password, displayName: name },
        { email, password, username },
        { email, password, fullName: name },
        { email, password, firstName: 'CovAI', lastName: 'Evaluator' },
        { email, password, name, confirmPassword: password },
        { email, password, username, name },
        { email, password },
    );
    const seen = new Set();
    return bodies.filter(body => {
        const key = JSON.stringify(Object.keys(body).sort());
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function loginBodies(account) {
    return [
        { email: account.email, password: account.password },
        ...(account.username ? [{ username: account.username, password: account.password }] : []),
        { identifier: account.email, password: account.password },
    ];
}

export function pickAuthRoutes(endpoints = []) {
    const post = endpoints.filter(endpoint => String(endpoint.method || '').toUpperCase() === 'POST');
    const pathOf = endpoint => String(endpoint.fullPath || endpoint.path || endpoint.endpointPath || '');
    const usable = endpoint => !EXCLUDED_PATH.test(pathOf(endpoint));
    const register = post.filter(endpoint => REGISTER_PATH.test(pathOf(endpoint)) && usable(endpoint));
    const login = post.filter(endpoint => LOGIN_PATH.test(pathOf(endpoint)) && usable(endpoint));
    const csrf = endpoints.filter(endpoint => String(endpoint.method || '').toUpperCase() === 'GET' && CSRF_PATH.test(pathOf(endpoint)));
    const fieldsOf = endpoint => Array.isArray(endpoint.requestBodySchema) ? endpoint.requestBodySchema.filter(field => typeof field === 'string') : [];
    const guesses = name => GUESS_PREFIXES.map(prefix => ({ path: `${prefix}/${name}`, fields: [] }));
    return {
        register: register.length ? register.map(endpoint => ({ path: pathOf(endpoint), fields: fieldsOf(endpoint) })) : guesses('register'),
        login: login.length ? login.map(endpoint => ({ path: pathOf(endpoint), fields: fieldsOf(endpoint) })) : guesses('login'),
        csrf: csrf.map(pathOf),
        discovered: register.length > 0 || login.length > 0,
    };
}

/** Paths to try for a parsed auth route, using the chat route's prefix (/api/v1/support/messages -> /api/v1). */
export function authPathCandidates(apiPath = '') {
    const segments = String(apiPath || '').split('?')[0].split('/').filter(Boolean);
    const derived = [];
    for (let length = segments.length - 1; length >= 1; length--) derived.push(`/${segments.slice(0, length).join('/')}`);
    const prefixes = [...derived.flatMap(prefix => [`${prefix}/auth`, prefix]), ...GUESS_PREFIXES];
    return routePath => {
        const normalized = `/${String(routePath || '').replace(/^\/+/, '')}`;
        const options = [normalized, ...prefixes.filter(prefix => !normalized.startsWith(`${prefix}/`)).map(prefix => `${prefix}${normalized}`)];
        return [...new Set(options)].slice(0, 12);
    };
}

const SEED_FILE = /(?:seed|fixture|demo|sample|example)[^/\\]*\.(?:[cm]?[jt]s|json|sql|ya?ml)$|(?:^|[/\\])README[^/\\]*\.md$|\.env\.(?:example|sample)$/i;
const EMAIL_LITERAL = /['"`]([\w.+-]+@[\w-]+(?:\.[\w-]+)+)['"`]|\b([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b/g;
const PASSWORD_NEAR = /pass(?:word)?\w*['"`]?\s*[:=,]\s*['"`]?([^\s'"`,;)]{4,64})/i;

export function findSeededAccounts(rootDir, { maxFiles = 300 } = {}) {
    const accounts = [];
    const files = [];
    const walk = directory => {
        if (files.length >= maxFiles) return;
        let entries = [];
        try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.covai-system-test'].includes(entry.name) || entry.isSymbolicLink()) continue;
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (SEED_FILE.test(file)) files.push(file);
        }
    };
    walk(rootDir);
    for (const file of files) {
        let content;
        try {
            if (fs.statSync(file).size > 300 * 1024) continue;
            content = fs.readFileSync(file, 'utf8');
        } catch { continue; }
        for (const match of content.matchAll(EMAIL_LITERAL)) {
            const email = match[1] || match[2];
            if (/example\.(?:com|org)$/i.test(email) && /noreply|no-reply/i.test(email)) continue;
            const window = content.slice(match.index, match.index + 400);
            const password = window.match(PASSWORD_NEAR)?.[1];
            if (!password || /^\$2[aby]?\$|^process\.env|^env\.|hash/i.test(password)) continue;
            if (!accounts.some(account => account.email === email)) accounts.push({ email, password });
            if (accounts.length >= 5) return accounts;
        }
    }
    return accounts;
}

/**
 * Opens an authenticated session against a Managed Project chatbot.
 * Returns { method, credential, headers, refresh() }. `headers` carries session cookies and a
 * CSRF token for cookie-based apps; `credential` carries a bearer token when the app returns one.
 */
export async function createManagedAuthSession({ lease, rootDir, apiPath = '', log = async () => {}, signal, endpoints, secretSink = null } = {}) {
    let discovered = endpoints;
    if (!discovered && rootDir) {
        try {
            discovered = await extractValidEndpoints(rootDir);
        } catch (error) {
            console.error('[TargetAuth] Route discovery failed:', error?.message || error);
            discovered = [];
        }
    }
    const routes = pickAuthRoutes(discovered || []);
    const candidatesFor = authPathCandidates(apiPath);
    const resolved = new Map();
    const origin = `http://127.0.0.1:${lease?.port}`;
    let attempts = 0;
    const state = { method: 'anonymous', credential: undefined, headers: {}, account: null, loginPath: null };

    const signIn = async (account, { register }) => {
        const jar = new CookieJar();
        let csrf = null;
        const request = async (requestPath, body, method) => {
            const response = await loopbackRequest(lease, {
                method,
                requestPath,
                body,
                signal,
                headers: {
                    Origin: origin,
                    Referer: `${origin}/`,
                    ...(jar.size ? { Cookie: jar.header() } : {}),
                    ...(csrf ? { 'X-CSRF-Token': csrf, 'X-XSRF-Token': csrf } : {}),
                },
            });
            jar.store(response.cookies);
            csrf = findValue(response.json, CSRF_KEY) || jar.find(name => CSRF_PATH.test(name)) || csrf;
            return response;
        };
        // Route parsers can miss a router's mount prefix (/register vs /api/v1/auth/register):
        // try likely prefixes and remember the first path the app answers with anything but 404/405.
        const send = async (routePath, body, method = 'POST') => {
            attempts += 1;
            const known = resolved.get(`${method} ${routePath}`);
            for (const candidate of known ? [known] : candidatesFor(routePath)) {
                const response = await request(candidate, body, method);
                if (response.status === 404 || response.status === 405) continue;
                resolved.set(`${method} ${routePath}`, candidate);
                return { ...response, path: candidate };
            }
            return { status: 404, json: null, cookies: [] };
        };
        for (const csrfPath of routes.csrf.slice(0, 2)) {
            try { await send(csrfPath, undefined, 'GET'); } catch (error) { console.error('[TargetAuth] CSRF request failed:', error?.message || error); }
        }
        if (register) {
            let registered = false;
            for (const route of routes.register) {
                if (registered || attempts >= MAX_ATTEMPTS) break;
                for (const body of registerBodies(route.fields, account)) {
                    if (attempts >= MAX_ATTEMPTS) break;
                    const response = await send(route.path, body);
                    if (response.status >= 200 && response.status < 300 || response.status === 409) { registered = true; break; }
                    if (response.status === 404 || response.status === 429 || response.status === 403) break;
                }
            }
            if (!registered) return null;
        }
        for (const route of routes.login) {
            for (const body of loginBodies(account)) {
                if (attempts >= MAX_ATTEMPTS * 2) return null;
                const response = await send(route.path, body);
                if (response.status === 404) break;
                if (response.status < 200 || response.status >= 300) continue;
                const token = findValue(response.json, TOKEN_KEY) || jar.find((name, value) => JWT_SHAPE.test(value) && !CSRF_PATH.test(name));
                if (!token && !jar.size) continue;
                return {
                    credential: token || undefined,
                    headers: { ...(jar.size ? { Cookie: jar.header() } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
                    loginPath: response.path,
                };
            }
        }
        return null;
    };

    const apply = (signed, method, account) => {
        Object.assign(state, { method, credential: signed.credential, headers: signed.headers, account, loginPath: signed.loginPath });
        // Every token or cookie issued, including renewals, is redacted from stored evidence.
        if (Array.isArray(secretSink)) secretSink.push(...[signed.credential, account.password, signed.headers.Cookie, signed.headers['X-CSRF-Token']].filter(Boolean));
    };

    try {
        const account = newTestAccount();
        const signed = await signIn(account, { register: true });
        if (signed) apply(signed, 'registered', account);
        else {
            for (const seeded of rootDir ? findSeededAccounts(rootDir) : []) {
                attempts = 0;
                const seededSession = await signIn(seeded, { register: false });
                if (seededSession) { apply(seededSession, 'seeded', seeded); break; }
            }
        }
    } catch (error) {
        console.error('[TargetAuth] Automatic sign-in failed:', error?.message || error);
    }
    await log(state.method === 'registered'
        ? 'Signed in to the chatbot with a new CovAI test account.'
        : state.method === 'seeded'
            ? 'Signed in to the chatbot with a test account from the project seed data.'
            : 'No test account could sign in; calling the chatbot without credentials.');

    return {
        get method() { return state.method; },
        get credential() { return state.credential; },
        get headers() { return state.headers; },
        get secrets() {
            return [state.credential, state.account?.password, state.headers.Cookie, state.headers['X-CSRF-Token']].filter(Boolean);
        },
        async refresh() {
            if (!state.account) return false;
            attempts = 0;
            try {
                const signed = await signIn(state.account, { register: false });
                if (!signed) return false;
                apply(signed, state.method, state.account);
                return true;
            } catch (error) {
                console.error('[TargetAuth] Session refresh failed:', error?.message || error);
                return false;
            }
        },
    };
}

/** Wraps a turn executor so each call carries the current session and signs in again once after 401/403. */
export function withAuthSession(executor, session) {
    const wrapped = async (config, input, options = {}) => {
        const call = () => executor(config, input, { ...options, credential: options.credential ?? session.credential, authHeaders: session.headers });
        try {
            return await call();
        } catch (error) {
            if (!isTargetAuthFailure(error) || !(await session.refresh())) throw error;
            return call();
        }
    };
    if (executor.closeConversation) wrapped.closeConversation = executor.closeConversation;
    return wrapped;
}
