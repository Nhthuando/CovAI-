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

export const createSafeDatabaseFallbackProxy = () => {
    const modelCache = new Map();
    const handler = {
        get(target, prop) {
            if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') {
                return undefined;
            }
            if (prop === '$connect' || prop === '$disconnect') {
                return typeof jest !== 'undefined' && jest.fn ? jest.fn().mockResolvedValue(undefined) : async () => {};
            }
            if (prop === '$transaction') {
                const txHandler = async (callbackOrArray) => {
                    if (typeof callbackOrArray === 'function') {
                        return callbackOrArray(createSafeDatabaseFallbackProxy());
                    }
                    if (Array.isArray(callbackOrArray)) {
                        return Promise.all(callbackOrArray);
                    }
                    return [];
                };
                return typeof jest !== 'undefined' && jest.fn ? jest.fn(txHandler) : txHandler;
            }
            if (prop === '$queryRaw' || prop === '$executeRaw' || prop === '$queryRawUnsafe' || prop === '$executeRawUnsafe') {
                return typeof jest !== 'undefined' && jest.fn ? jest.fn().mockResolvedValue([]) : async () => [];
            }
            if (prop === '$extends') {
                return () => createSafeDatabaseFallbackProxy();
            }
            if (typeof prop === 'string') {
                if (modelCache.has(prop)) return modelCache.get(prop);
                const methodCache = new Map();
                const modelProxy = new Proxy({}, {
                    get(mTarget, method) {
                        if (method === 'then' || method === 'catch' || method === 'finally' || typeof method === 'symbol') {
                            return undefined;
                        }
                        if (methodCache.has(method)) return methodCache.get(method);
                        let fnImpl;
                        if (method === 'findMany' || method === 'findRaw') {
                            fnImpl = async () => [];
                        } else if (method === 'count') {
                            fnImpl = async () => 0;
                        } else {
                            fnImpl = async (args) => ({
                                id: args?.where?.id ?? 1,
                                status: 'ACTIVE',
                                createdAt: new Date(),
                                updatedAt: new Date(),
                                ...(args?.data || {})
                            });
                        }
                        const fn = typeof jest !== 'undefined' && jest.fn ? jest.fn(fnImpl) : fnImpl;
                        methodCache.set(method, fn);
                        return fn;
                    }
                });
                modelCache.set(prop, modelProxy);
                return modelProxy;
            }
            return target[prop];
        }
    };
    return new Proxy({}, handler);
};

if (!process.env.DATABASE_URL || process.env.COVAI_TEST_DATABASE_REJECTED === 'true') {
    try {
        const { setPrismaClient } = await import('../../config/prisma.js');
        if (typeof setPrismaClient === 'function') {
            setPrismaClient(createSafeDatabaseFallbackProxy());
        }
    } catch (_) {}
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
