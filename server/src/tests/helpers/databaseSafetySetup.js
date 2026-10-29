import 'dotenv/config';
import { assertCollaborationTestDatabase } from './collaborationDb.js';
import http from 'node:http';
import https from 'node:https';

// Existing integration tests import the application's dotenv-backed Prisma
// config. A normal test command must never borrow a developer/remote database.
if (process.env.DATABASE_URL) {
    try { assertCollaborationTestDatabase(process.env.DATABASE_URL); }
    catch {
        process.env.DATABASE_URL = '';
        process.env.COVAI_TEST_DATABASE_REJECTED = 'true';
    }
}
if (process.env.COVAI_OFFLINE_TESTS === 'true') {
    const local = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    const assertLocal = input => {
        let hostname;
        if (typeof input === 'string' || input instanceof URL) hostname = new URL(input).hostname;
        else hostname = input?.hostname || input?.host || 'localhost';
        if (!local.has(hostname)) throw new Error('External HTTP is disabled in offline test execution');
    };
    for (const transport of [http, https]) {
        const request = transport.request;
        transport.request = function (...args) { assertLocal(args[0]); return request.apply(this, args); };
        const get = transport.get;
        transport.get = function (...args) { assertLocal(args[0]); return get.apply(this, args); };
    }
    const fetch = globalThis.fetch;
    globalThis.fetch = async (input, ...args) => {
        assertLocal(typeof input === 'object' && !(input instanceof URL) ? input.url : input);
        return fetch(input, ...args);
    };
}
