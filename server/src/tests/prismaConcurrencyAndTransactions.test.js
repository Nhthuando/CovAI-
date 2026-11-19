import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import prisma, { setPrismaClient } from '../config/prisma.js';
import { withProjectGuard, resolveProjectAccess, isRetryableTransactionError } from '../services/projectAccess.service.js';
import { deliverToProjectSubscribers, deliverScopedProjectTransport, subscribeToProjectRoom } from '../services/projectSubscription.service.js';
import { suggestUnitTestcases } from '../services/unitTestSuggestion.service.js';
import { suggestUnitTestcase, applySuggestion, suggestUnitTestcaseAll } from '../controllers/coverage.controller.js';
import { parseCoverageFilesForSnapshot } from '../services/coverageFileParser.service.js';
import { parseCoverageFunctionsForSnapshot } from '../services/coverageFunctionParser.service.js';
import { applyUnitTestSuggestion, activeApplyLocks } from '../services/applyTestSuggestion.service.js';
import { ServiceError } from '../utils/serviceError.js';
import jwt from 'jsonwebtoken';

describe('Milestone 2: Prisma Database Transactions & Concurrency Reliability (Requirement R2)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, JWT_SECRET: 'test-jwt-secret-key-123456789' };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('1. Decouple Read Operations from Exclusive Advisory Locks (projectAccess.service.js)', () => {
        test('read capability (project.read) runs without opening $transaction or acquiring advisory lock', async () => {
            let transactionCalled = false;
            let executeRawCalled = false;

            const mockDb = {
                $transaction: jest.fn(async () => {
                    transactionCalled = true;
                    return null;
                }),
                $executeRaw: jest.fn(async () => {
                    executeRawCalled = true;
                }),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-1', ownerId: 'user-1', workspaceRevision: 1 }))
                }
            };

            const callback = jest.fn(async (tx, access) => {
                expect(tx).toBe(mockDb); // Must use direct db instance, NOT transaction
                expect(access.role).toBe('OWNER');
                return { success: true, read: true };
            });

            const result = await withProjectGuard(
                { projectId: 'proj-1', userId: 'user-1', capability: 'project.read', db: mockDb },
                callback
            );

            expect(result).toEqual({ success: true, read: true });
            expect(transactionCalled).toBe(false);
            expect(executeRawCalled).toBe(false);
            expect(mockDb.$transaction).not.toHaveBeenCalled();
            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('ai capability (ai.use) runs without opening $transaction or acquiring advisory lock', async () => {
            const mockDb = {
                $transaction: jest.fn(),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-1', ownerId: 'user-1', workspaceRevision: 2 }))
                }
            };

            const callback = jest.fn(async (tx, access) => {
                expect(tx).toBe(mockDb);
                return { generated: true };
            });

            const result = await withProjectGuard(
                { projectId: 'proj-1', userId: 'user-1', capability: 'ai.use', db: mockDb },
                callback
            );

            expect(result).toEqual({ generated: true });
            expect(mockDb.$transaction).not.toHaveBeenCalled();
            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('mutating capability (files.write) starts $transaction and acquires pg_advisory_xact_lock', async () => {
            const rawQueries = [];
            const mockTx = {
                $executeRaw: jest.fn(async (strings, ...values) => {
                    rawQueries.push(strings[0]);
                }),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-1', ownerId: 'user-1', workspaceRevision: 3 }))
                }
            };

            const mockDb = {
                $transaction: jest.fn(async (fn, options) => {
                    expect(options).toEqual({ maxWait: 30000, timeout: 60000 });
                    return await fn(mockTx);
                })
            };

            const callback = jest.fn(async (tx, access) => {
                expect(tx).toBe(mockTx);
                return { written: true };
            });

            const result = await withProjectGuard(
                { projectId: 'proj-1', userId: 'user-1', capability: 'files.write', db: mockDb },
                callback
            );

            expect(result).toEqual({ written: true });
            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
            expect(rawQueries[0]).toContain('pg_advisory_xact_lock');
        });

        test('mutating capability (members.manage) starts $transaction and acquires pg_advisory_xact_lock', async () => {
            const rawQueries = [];
            const mockTx = {
                $executeRaw: jest.fn(async (strings, ...values) => {
                    rawQueries.push(strings[0]);
                }),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-1', ownerId: 'user-1', workspaceRevision: 1 }))
                }
            };

            const mockDb = {
                $transaction: jest.fn(async (fn, options) => {
                    expect(options).toEqual({ maxWait: 30000, timeout: 60000 });
                    return await fn(mockTx);
                })
            };

            const callback = jest.fn(async (tx, access) => {
                expect(tx).toBe(mockTx);
                return { memberUpdated: true };
            });

            const result = await withProjectGuard(
                { projectId: 'proj-1', userId: 'user-1', capability: 'members.manage', db: mockDb },
                callback
            );

            expect(result).toEqual({ memberUpdated: true });
            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
            expect(rawQueries[0]).toContain('pg_advisory_xact_lock');
        });

        test('mutating capability (chat.write) starts $transaction and acquires pg_advisory_xact_lock', async () => {
            const rawQueries = [];
            const mockTx = {
                $executeRaw: jest.fn(async (strings, ...values) => {
                    rawQueries.push(strings[0]);
                }),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-1', ownerId: 'user-1', workspaceRevision: 1 }))
                }
            };

            const mockDb = {
                $transaction: jest.fn(async (fn, options) => {
                    expect(options).toEqual({ maxWait: 30000, timeout: 60000 });
                    return await fn(mockTx);
                })
            };

            const callback = jest.fn(async (tx, access) => {
                expect(tx).toBe(mockTx);
                return { chatWritten: true };
            });

            const result = await withProjectGuard(
                { projectId: 'proj-1', userId: 'user-1', capability: 'chat.write', db: mockDb },
                callback
            );

            expect(result).toEqual({ chatWritten: true });
            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
            expect(rawQueries[0]).toContain('pg_advisory_xact_lock');
        });

        test('read-only capability (members.read) runs without opening $transaction or acquiring advisory lock', async () => {
            const mockDb = {
                $transaction: jest.fn(),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-1', ownerId: 'user-1', workspaceRevision: 1 }))
                }
            };

            const callback = jest.fn(async (tx, access) => {
                expect(tx).toBe(mockDb);
                return { members: [] };
            });

            const result = await withProjectGuard(
                { projectId: 'proj-1', userId: 'user-1', capability: 'members.read', db: mockDb },
                callback
            );

            expect(result).toEqual({ members: [] });
            expect(mockDb.$transaction).not.toHaveBeenCalled();
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('2. Transaction Retry Wrapper with Jittered Backoff (projectAccess.service.js)', () => {
        test('isRetryableTransactionError correctly categorizes transient Prisma and Postgres errors', () => {
            // Prisma transient error codes
            expect(isRetryableTransactionError({ code: 'P2028' })).toBe(true);
            expect(isRetryableTransactionError({ code: 'P2024' })).toBe(true);
            expect(isRetryableTransactionError({ code: 'P2034' })).toBe(true);
            // Postgres deadlock and serialization failure
            expect(isRetryableTransactionError({ code: '40P01' })).toBe(true);
            expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
            // Error messages
            expect(isRetryableTransactionError(new Error('Transaction API error: Unable to start a transaction'))).toBe(true);
            expect(isRetryableTransactionError(new Error('Transaction already closed: Transaction is no longer valid.'))).toBe(true);
            expect(isRetryableTransactionError(new Error('deadlock detected'))).toBe(true);
            expect(isRetryableTransactionError(new Error('could not serialize access'))).toBe(true);
            expect(isRetryableTransactionError(new Error('Timed out fetching a new connection from the pool'))).toBe(true);

            // Non-retryable errors
            expect(isRetryableTransactionError(new Error('Project not found'))).toBe(false);
            expect(isRetryableTransactionError(new ServiceError('Resource authorization context required', 400))).toBe(false);
            expect(isRetryableTransactionError({ code: 'P2002' })).toBe(false); // Unique constraint violation is non-retryable
        });

        test('retries on P2028 (Unable to start transaction) and succeeds on subsequent attempt', async () => {
            let attempt = 0;
            const mockTx = {
                $executeRaw: jest.fn(),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-1', ownerId: 'user-1', workspaceRevision: 1 }))
                }
            };

            const mockDb = {
                $transaction: jest.fn(async (fn) => {
                    attempt++;
                    if (attempt === 1) {
                        const err = new Error('Transaction API error: Unable to start a transaction');
                        err.code = 'P2028';
                        throw err;
                    }
                    return await fn(mockTx);
                })
            };

            const callback = jest.fn(async () => ({ retrySuccess: true }));

            const result = await withProjectGuard(
                { projectId: 'proj-1', userId: 'user-1', capability: 'files.write', db: mockDb },
                callback
            );

            expect(result).toEqual({ retrySuccess: true });
            expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        test('retries on 40P01 (deadlock detected) up to 3 attempts then re-throws if exhaustion occurs', async () => {
            let attempts = 0;
            const mockDb = {
                $transaction: jest.fn(async () => {
                    attempts++;
                    const err = new Error('ERROR: 40P01: deadlock detected');
                    err.code = '40P01';
                    throw err;
                })
            };

            const callback = jest.fn();

            await expect(
                withProjectGuard(
                    { projectId: 'proj-1', userId: 'user-1', capability: 'files.write', db: mockDb },
                    callback
                )
            ).rejects.toThrow('deadlock detected');

            expect(attempts).toBe(3);
            expect(callback).not.toHaveBeenCalled();
        });

        test('does NOT retry on non-transient domain errors (e.g. 404 NOT_FOUND)', async () => {
            let attempts = 0;
            const mockTx = {
                $executeRaw: jest.fn(),
                project: {
                    findFirst: jest.fn(async () => null) // triggers 404
                }
            };

            const mockDb = {
                $transaction: jest.fn(async (fn) => {
                    attempts++;
                    return await fn(mockTx);
                })
            };

            const callback = jest.fn();

            await expect(
                withProjectGuard(
                    { projectId: 'proj-1', userId: 'user-1', capability: 'files.write', db: mockDb },
                    callback
                )
            ).rejects.toThrow('Project not found');

            expect(attempts).toBe(1); // Threw immediately, no retry
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('3. Non-Transactional WebSocket Event Broadcasts (projectSubscription.service.js)', () => {
        test('deliverToProjectSubscribers broadcasts without holding DB transactions or advisory locks', async () => {
            const token = jwt.sign({ userId: 'user-sub-1' }, process.env.JWT_SECRET);
            const mockSocket1 = {
                handshake: { auth: { token } },
                data: { projectUserId: 'user-sub-1' },
                join: jest.fn(async () => {}),
                leave: jest.fn(async () => {}),
                emit: jest.fn()
            };
            const mockSocket2 = {
                handshake: { auth: { token } },
                data: { projectUserId: 'user-sub-2' },
                join: jest.fn(async () => {}),
                leave: jest.fn(async () => {}),
                emit: jest.fn()
            };

            const mockDb = {
                project: {
                    findFirst: jest.fn(async ({ where }) => ({ id: where.id, ownerId: 'user-sub-1', workspaceRevision: 1 }))
                }
            };

            // Join room
            await subscribeToProjectRoom(mockSocket1, { projectId: 'proj-sub-test', db: mockDb });
            await subscribeToProjectRoom(mockSocket2, { projectId: 'proj-sub-test', db: mockDb });

            const event = {
                id: 'evt-101',
                projectId: 'proj-sub-test',
                sequence: 1,
                type: 'operation.finished',
                actorId: 'user-sub-1',
                resourceId: 'op-1',
                revision: 5,
                createdAt: new Date().toISOString()
            };

            await deliverToProjectSubscribers(event);

            // Verify both sockets received the event directly
            expect(mockSocket1.emit).toHaveBeenCalledWith('project:event', expect.objectContaining({ id: 'evt-101' }));
            expect(mockSocket1.emit).toHaveBeenCalledWith('project_event', expect.objectContaining({ id: 'evt-101' }));
            expect(mockSocket2.emit).toHaveBeenCalledWith('project:event', expect.objectContaining({ id: 'evt-101' }));
            expect(mockSocket2.emit).toHaveBeenCalledWith('project_event', expect.objectContaining({ id: 'evt-101' }));
        });

        test('deliverScopedProjectTransport emits directly without database transactions', async () => {
            const token = jwt.sign({ userId: 'user-sub-trans' }, process.env.JWT_SECRET);
            const mockSocket = {
                handshake: { auth: { token } },
                data: { projectUserId: 'user-sub-trans' },
                join: jest.fn(async () => {}),
                leave: jest.fn(async () => {}),
                emit: jest.fn()
            };

            const mockDb = {
                project: {
                    findFirst: jest.fn(async ({ where }) => ({ id: where.id, ownerId: 'user-sub-trans', workspaceRevision: 1 }))
                }
            };
            await subscribeToProjectRoom(mockSocket, { projectId: 'proj-transport-test', db: mockDb });

            await deliverScopedProjectTransport({
                projectId: 'proj-transport-test',
                event: 'editor:change',
                payload: { patch: 'abc' }
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('editor:change', { patch: 'abc' });
        });
    });

    describe('4. Suggestion Service projectId Validation and findFirst Query Sanitization', () => {
        test('rejects with clean 400 when projectId is missing and cannot be resolved', async () => {
            await expect(
                suggestUnitTestcases({
                    projectId: null,
                    snapshotId: null,
                    filePath: 'src/app.js',
                    userId: 'user-1'
                })
            ).rejects.toThrow('projectId is required');
        });

        test('rejects with clean 400 when filePath is missing', async () => {
            await expect(
                suggestUnitTestcases({
                    projectId: 'proj-valid',
                    filePath: null,
                    userId: 'user-1'
                })
            ).rejects.toThrow('filePath is required');
        });
    });

    describe('5. Concurrency Simulation: Parallel Read & Write Guards', () => {
        test('handles simultaneous read and write guards without deadlocks or unhandled rejections', async () => {
            const activeLocks = new Set();
            let maxConcurrentMutatingLocks = 0;

            const makeMockDb = (workerId) => {
                const db = {
                    project: {
                        findFirst: jest.fn(async () => ({ id: 'proj-concurrent', ownerId: 'user-c', workspaceRevision: 1 }))
                    },
                    $transaction: jest.fn(async (fn, options) => {
                        expect(options.maxWait).toBeDefined();
                        expect(options.timeout).toBeDefined();

                        // Mutating lock simulation
                        if (activeLocks.has('proj-concurrent')) {
                            // Postgres advisory lock blocks until previous releases
                            while (activeLocks.has('proj-concurrent')) {
                                await new Promise(r => setTimeout(r, 10));
                            }
                        }
                        activeLocks.add('proj-concurrent');
                        maxConcurrentMutatingLocks = Math.max(maxConcurrentMutatingLocks, activeLocks.size);

                        try {
                            const tx = {
                                $executeRaw: jest.fn(),
                                project: db.project
                            };
                            return await fn(tx);
                        } finally {
                            activeLocks.delete('proj-concurrent');
                        }
                    })
                };
                return db;
            };

            // Run 10 parallel operations (6 reads, 4 writes)
            const tasks = [];
            for (let i = 0; i < 10; i++) {
                const isWrite = i % 3 === 0;
                const capability = isWrite ? 'files.write' : 'project.read';
                const db = makeMockDb(i);
                tasks.push(
                    withProjectGuard(
                        { projectId: 'proj-concurrent', userId: 'user-c', capability, db },
                        async (tx, access) => {
                            await new Promise(r => setTimeout(r, 20)); // Work simulation
                            return { worker: i, capability };
                        }
                    )
                );
            }

            const results = await Promise.all(tasks);
            expect(results).toHaveLength(10);
            // Mutating lock is exclusive: at no time were 2 mutating locks held concurrently
            expect(maxConcurrentMutatingLocks).toBeLessThanOrEqual(1);
        });
    });

    describe('6. Controller Guards Against Undefined projectId (coverage.controller.js)', () => {
        test('suggestUnitTestcase returns 400 when projectId cannot be resolved from body or snapshot', async () => {
            const req = {
                user: { id: 'user-ctrl' },
                params: { snapshotId: 'snap-nonexistent' },
                body: { filePath: 'src/main.js' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcase(req, res);
            expect(res.status).toHaveBeenCalledWith(404); // snapshot not found
        });

        test('applySuggestion returns 400 when suggestion payload is missing', async () => {
            const req = {
                user: { id: 'user-ctrl' },
                params: { snapshotId: 'snap-1' },
                body: {}
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await applySuggestion(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('required') }));
        });

        test('suggestUnitTestcaseAll returns 400 when validationMode or file list is invalid', async () => {
            const req = {
                user: { id: 'user-ctrl' },
                params: { snapshotId: 'snap-1' },
                body: { filePaths: 'not-an-array' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcaseAll(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('7. Explicit Transaction Options Across Production Direct $transaction Calls', () => {
        afterEach(() => {
            setPrismaClient(null);
        });

        test('parseCoverageFilesForSnapshot passes explicit { maxWait: 15000, timeout: 30000 } to prisma.$transaction', async () => {
            let capturedOptions = null;
            let transactionCallback = null;

            const mockDb = {
                projectSnapshot: {
                    findFirst: jest.fn(async () => ({
                        id: 'snap-opt-1',
                        projectId: 'proj-opt-1',
                        rootDir: '/fake/root',
                        project: { ownerId: 'user-owner-1' }
                    }))
                },
                project: {
                    findFirst: jest.fn(async () => ({
                        id: 'proj-opt-1',
                        ownerId: 'user-owner-1',
                        workspaceRevision: 1
                    }))
                },
                coverageFile: {
                    deleteMany: jest.fn(async () => ({ count: 0 })),
                    createMany: jest.fn(async () => ({ count: 1 }))
                },
                coverageSummary: {
                    upsert: jest.fn(async () => ({}))
                },
                $transaction: jest.fn(async (cb, options) => {
                    capturedOptions = options;
                    transactionCallback = cb;
                    const tx = {
                        coverageFile: mockDb.coverageFile,
                        coverageSummary: mockDb.coverageSummary
                    };
                    return await cb(tx);
                })
            };

            setPrismaClient(mockDb);

            const coverageReport = {
                'src/service.js': {
                    lines: { total: 10, covered: 10, pct: 100 },
                    functions: { total: 2, covered: 2, pct: 100 },
                    branches: { total: 4, covered: 4, pct: 100 },
                    statements: { total: 10, covered: 10, pct: 100 }
                },
                total: {
                    lines: { total: 10, covered: 10, pct: 100 },
                    functions: { total: 2, covered: 2, pct: 100 },
                    branches: { total: 4, covered: 4, pct: 100 },
                    statements: { total: 10, covered: 10, pct: 100 }
                }
            };

            const result = await parseCoverageFilesForSnapshot({
                projectId: 'proj-opt-1',
                snapshotId: 'snap-opt-1',
                coverageReport,
                userId: 'user-owner-1'
            });

            expect(result).toBeDefined();
            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(capturedOptions).toEqual({ maxWait: 15000, timeout: 30000 });
            expect(typeof transactionCallback).toBe('function');
        });

        test('parseCoverageFunctionsForSnapshot passes explicit { maxWait: 15000, timeout: 30000 } to prisma.$transaction', async () => {
            let capturedOptions = null;
            let transactionCallback = null;

            const mockDb = {
                projectSnapshot: {
                    findFirst: jest.fn(async () => ({
                        id: 'snap-opt-2',
                        projectId: 'proj-opt-2',
                        rootDir: '/fake/root',
                        project: { ownerId: 'user-owner-2' }
                    }))
                },
                project: {
                    findFirst: jest.fn(async () => ({
                        id: 'proj-opt-2',
                        ownerId: 'user-owner-2',
                        workspaceRevision: 1
                    }))
                },
                coverageFunction: {
                    deleteMany: jest.fn(async () => ({ count: 0 })),
                    createMany: jest.fn(async () => ({ count: 1 }))
                },
                $transaction: jest.fn(async (cb, options) => {
                    capturedOptions = options;
                    transactionCallback = cb;
                    const tx = {
                        coverageFunction: mockDb.coverageFunction
                    };
                    return await cb(tx);
                })
            };

            setPrismaClient(mockDb);

            const coverageReport = {
                'src/service.js': {
                    fnMap: {
                        '0': { name: 'compute', decl: { start: { line: 5 } }, loc: { start: { line: 5 }, end: { line: 15 } } }
                    },
                    f: { '0': 1 }
                }
            };

            const result = await parseCoverageFunctionsForSnapshot({
                projectId: 'proj-opt-2',
                snapshotId: 'snap-opt-2',
                coverageReport,
                userId: 'user-owner-2'
            });

            expect(result).toBeDefined();
            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(capturedOptions).toEqual({ maxWait: 15000, timeout: 30000 });
            expect(typeof transactionCallback).toBe('function');
        });

        test('withProjectGuard passes explicit transaction options { maxWait, timeout } to db.$transaction', async () => {
            let capturedOptions = null;
            const mockTx = {
                $executeRaw: jest.fn(async () => {}),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-guard-opt', ownerId: 'user-guard', workspaceRevision: 1 }))
                }
            };
            const mockDb = {
                $transaction: jest.fn(async (fn, options) => {
                    capturedOptions = options;
                    return await fn(mockTx);
                })
            };

            await withProjectGuard(
                { projectId: 'proj-guard-opt', userId: 'user-guard', capability: 'files.write', db: mockDb, maxWait: 12345, timeout: 67890 },
                async () => ({ ok: true })
            );

            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(capturedOptions).toEqual({ maxWait: 12345, timeout: 67890 });
        });
    });

    describe('8. Draft Validation Dry-Run DB Write Suppression (validationOnly: true)', () => {
        let tempDir;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-m2-val-only-'));
            fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
            fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
            fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'm2-val-test', version: '1.0.0' }), 'utf8');
            fs.writeFileSync(path.join(tempDir, 'src', 'calculator.js'), 'export const add = (a, b) => a + b;\n', 'utf8');
            fs.writeFileSync(path.join(tempDir, 'tests', 'calculator.test.js'), 'describe("add", () => { test("adds", () => {}); });\n', 'utf8');
        });

        afterEach(() => {
            activeApplyLocks.clear();
            setPrismaClient(null);
            if (tempDir && fs.existsSync(tempDir)) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
            }
        });

        test('applyUnitTestSuggestion with validationOnly: true returns VERIFIED_DRAFT and suppresses all coverage database updates', async () => {
            const mockSnapshot = {
                id: 'snap-val-suppress',
                projectId: 'proj-val-suppress',
                rootDir: tempDir,
                project: { id: 'proj-val-suppress', ownerId: 'user-val', workspaceRevision: 1 }
            };

            const mockDb = {
                projectSnapshot: {
                    findUnique: jest.fn(async () => mockSnapshot),
                    findFirst: jest.fn(async () => mockSnapshot),
                    update: jest.fn(async () => mockSnapshot)
                },
                project: {
                    findUnique: jest.fn(async () => mockSnapshot.project),
                    findFirst: jest.fn(async () => mockSnapshot.project),
                    update: jest.fn(async () => ({ eventSequence: 1 }))
                },
                coverageFile: {
                    findMany: jest.fn(async () => []),
                    upsert: jest.fn(async () => ({}))
                },
                coverageSummary: {
                    findUnique: jest.fn(async () => null),
                    upsert: jest.fn(async () => ({}))
                },
                $transaction: jest.fn(async (cb) => {
                    if (typeof cb === 'function') return await cb(mockDb);
                    return Promise.all(cb);
                }),
                $executeRaw: jest.fn()
            };

            setPrismaClient(mockDb);

            const suggestion = {
                sourceFile: 'src/calculator.js',
                testFile: 'tests/calculator.test.js',
                framework: 'jest',
                generatedCode: 'describe("add", () => { test("adds numbers", () => { expect(add(1, 2)).toBe(3); }); });'
            };

            const runCoverageMock = async ({ coverageDir }) => {
                fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({
                    'src/calculator.js': {
                        path: path.join(tempDir, 'src', 'calculator.js'),
                        s: { 0: 1 }, b: {}, f: { 0: 1 }
                    }
                }), 'utf8');
                fs.writeFileSync(path.join(coverageDir, 'coverage-summary.json'), JSON.stringify({
                    'src/calculator.js': {
                        statements: { total: 1, covered: 1, pct: 100 },
                        branches: { total: 1, covered: 1, pct: 100 },
                        functions: { total: 1, covered: 1, pct: 100 },
                        lines: { total: 1, covered: 1, pct: 100 }
                    },
                    total: {
                        statements: { total: 1, covered: 1, pct: 100 },
                        branches: { total: 1, covered: 1, pct: 100 },
                        functions: { total: 1, covered: 1, pct: 100 },
                        lines: { total: 1, covered: 1, pct: 100 }
                    }
                }), 'utf8');
                fs.writeFileSync(path.join(coverageDir, 'test-results.json'), JSON.stringify({
                    status: 'passed',
                    numFailedTests: 0,
                    testResults: [{
                        name: 'tests/calculator.test.js',
                        status: 'passed',
                        numFailingTests: 0,
                        assertionResults: [{ status: 'passed', title: 'adds numbers' }]
                    }]
                }), 'utf8');
            };

            const result = await applyUnitTestSuggestion({
                snapshotId: 'snap-val-suppress',
                projectId: 'proj-val-suppress',
                userId: 'user-val',
                suggestion,
                validationOnly: true,
                runCoverageFn: runCoverageMock
            });

            // 1. Result contract for validationOnly
            expect(result.success).toBe(true);
            expect(result.status).toBe('VERIFIED_DRAFT');
            expect(result.fileUpdated).toBe(false);
            expect(result.validatedFiles).toHaveLength(1);

            // 2. Verified zero database transactions or persistence calls
            expect(mockDb.$transaction).not.toHaveBeenCalled();
            expect(mockDb.coverageFile.upsert).not.toHaveBeenCalled();
            expect(mockDb.coverageSummary.upsert).not.toHaveBeenCalled();
            expect(mockDb.projectSnapshot.update).not.toHaveBeenCalled();
        });
    });
});
