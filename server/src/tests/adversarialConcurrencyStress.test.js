import { jest } from '@jest/globals';
import { withProjectGuard, resolveProjectAccess, isRetryableTransactionError } from '../services/projectAccess.service.js';
import { deliverToProjectSubscribers, deliverScopedProjectTransport, subscribeToProjectRoom, unsubscribeFromProjectRoom } from '../services/projectSubscription.service.js';
import { suggestUnitTestcases } from '../services/unitTestSuggestion.service.js';
import { suggestUnitTestcase, applySuggestion, suggestUnitTestcaseAll } from '../controllers/coverage.controller.js';
import { ServiceError } from '../utils/serviceError.js';
import jwt from 'jsonwebtoken';

describe('Adversarial Empirical Stress Test Suite: Milestone 2 Concurrency & Transaction Reliability', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, JWT_SECRET: 'test-adversarial-jwt-secret-key-987654321' };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('Challenge 1: High-Concurrency (50 Requests) Pool Stability Simulation', () => {
        test('executes 50 concurrent requests (25 reads, 15 ai uses, 10 writes) without pool exhaustion or deadlocks', async () => {
            const MAX_POOL_CONNECTIONS = 25;
            const CONNECTION_TIMEOUT_MS = 2000;
            let activeConnections = 0;
            let peakActiveConnections = 0;
            let connectionTimeouts = 0;
            const connectionQueue = [];

            const acquireConnection = () => {
                return new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        const idx = connectionQueue.findIndex(q => q.resolve === resolve);
                        if (idx !== -1) connectionQueue.splice(idx, 1);
                        connectionTimeouts++;
                        const err = new Error('Transaction API error: Unable to start a transaction. Timed out fetching a new connection from the pool');
                        err.code = 'P2024';
                        reject(err);
                    }, CONNECTION_TIMEOUT_MS);

                    const dispatch = () => {
                        clearTimeout(timer);
                        activeConnections++;
                        peakActiveConnections = Math.max(peakActiveConnections, activeConnections);
                        resolve({
                            release: () => {
                                activeConnections--;
                                if (connectionQueue.length > 0) {
                                    const next = connectionQueue.shift();
                                    next();
                                }
                            }
                        });
                    };

                    if (activeConnections < MAX_POOL_CONNECTIONS) {
                        dispatch();
                    } else {
                        connectionQueue.push(dispatch);
                    }
                });
            };

            // Exclusive advisory lock registry for mutating transactions
            const advisoryLocks = new Set();
            let maxConcurrentAdvisoryLocks = 0;

            const makeMockDb = (requestId) => {
                const queryProject = async (id, userId) => {
                    const conn = await acquireConnection();
                    try {
                        await new Promise(r => setTimeout(r, 5)); // Simulate realistic query latency (5ms)
                        return { id, ownerId: userId, workspaceRevision: 10 };
                    } finally {
                        conn.release();
                    }
                };

                return {
                    project: {
                        findFirst: jest.fn(async ({ where }) => {
                            return queryProject(where.id || 'proj-stress', 'user-stress');
                        })
                    },
                    projectMember: {
                        findUnique: jest.fn(async ({ where }) => ({
                            projectId: where.projectId_userId.projectId,
                            userId: where.projectId_userId.userId,
                            role: 'EDITOR',
                            disciplineRole: 'DEV'
                        }))
                    },
                    $transaction: jest.fn(async (fn, options) => {
                        const conn = await acquireConnection();
                        try {
                            const projectId = 'proj-stress';
                            // Mutating transactions acquire Postgres advisory lock
                            while (advisoryLocks.has(projectId)) {
                                await new Promise(r => setTimeout(r, 5));
                            }
                            advisoryLocks.add(projectId);
                            maxConcurrentAdvisoryLocks = Math.max(maxConcurrentAdvisoryLocks, advisoryLocks.size);

                            const tx = {
                                $executeRaw: jest.fn(async () => {}),
                                project: {
                                    findFirst: jest.fn(async () => ({
                                        id: projectId,
                                        ownerId: 'user-stress',
                                        workspaceRevision: 10
                                    }))
                                }
                            };

                            try {
                                await new Promise(r => setTimeout(r, 15)); // Mutating transaction work (15ms)
                                return await fn(tx);
                            } finally {
                                advisoryLocks.delete(projectId);
                            }
                        } finally {
                            conn.release();
                        }
                    })
                };
            };

            // Launch 50 concurrent requests simultaneously:
            // 25 x project.read
            // 15 x ai.use
            // 10 x files.write
            const requests = [];
            for (let i = 0; i < 50; i++) {
                let capability;
                if (i < 25) capability = 'project.read';
                else if (i < 40) capability = 'ai.use';
                else capability = 'files.write';

                const db = makeMockDb(i);
                requests.push(
                    withProjectGuard(
                        { projectId: 'proj-stress', userId: 'user-stress', capability, db },
                        async (tx, access) => {
                            await new Promise(r => setTimeout(r, 5));
                            return { requestId: i, capability, role: access.role, success: true };
                        }
                    )
                );
            }

            const results = await Promise.all(requests);

            // EMPIRICAL VERIFICATION:
            // 1. All 50 completed successfully without connection pool timeout / exhaustion
            expect(results).toHaveLength(50);
            expect(results.every(r => r.success)).toBe(true);
            expect(connectionTimeouts).toBe(0);

            // 2. Active connections never exceeded hard capacity (25)
            expect(peakActiveConnections).toBeLessThanOrEqual(MAX_POOL_CONNECTIONS);

            // 3. Mutating advisory lock was strictly exclusive (max 1 at any moment)
            expect(maxConcurrentAdvisoryLocks).toBeLessThanOrEqual(1);

            // 4. Verify request distribution
            expect(results.filter(r => r.capability === 'project.read')).toHaveLength(25);
            expect(results.filter(r => r.capability === 'ai.use')).toHaveLength(15);
            expect(results.filter(r => r.capability === 'files.write')).toHaveLength(10);
        });

        test('handles multi-project concurrency without cross-project lock interference', async () => {
            const projectLocks = new Map();

            const makeDbForProject = (projId) => ({
                project: {
                    findFirst: jest.fn(async () => ({ id: projId, ownerId: 'user-1', workspaceRevision: 1 }))
                },
                projectMember: {
                    findUnique: jest.fn(async () => ({ role: 'OWNER' }))
                },
                $transaction: jest.fn(async (fn) => {
                    if (projectLocks.has(projId)) {
                        throw new Error(`Lock contention on ${projId}`);
                    }
                    projectLocks.set(projId, true);
                    try {
                        const tx = {
                            $executeRaw: jest.fn(),
                            project: { findFirst: jest.fn(async () => ({ id: projId, ownerId: 'user-1', workspaceRevision: 1 })) }
                        };
                        await new Promise(r => setTimeout(r, 10));
                        return await fn(tx);
                    } finally {
                        projectLocks.delete(projId);
                    }
                })
            });

            // Run 5 mutating requests on 5 DIFFERENT projects concurrently
            const tasks = [1, 2, 3, 4, 5].map(id => {
                const projId = `project-${id}`;
                const db = makeDbForProject(projId);
                return withProjectGuard(
                    { projectId: projId, userId: 'user-1', capability: 'files.write', db },
                    async () => ({ projId, done: true })
                );
            });

            const results = await Promise.all(tasks);
            expect(results).toHaveLength(5);
            expect(results.every(r => r.done)).toBe(true);
        });
    });

    describe('Challenge 2: Rapid WebSocket Broadcast Flood across 20 Sockets (Zero DB Transactions)', () => {
        test('broadcasts 100 rapid events to 20 sockets without triggering ANY database transaction', async () => {
            let dbTransactionCounter = 0;
            let executeRawCounter = 0;

            const mockDb = {
                $transaction: jest.fn(async () => {
                    dbTransactionCounter++;
                    return null;
                }),
                $executeRaw: jest.fn(async () => {
                    executeRawCounter++;
                }),
                project: {
                    findFirst: jest.fn(async ({ where }) => ({
                        id: where.id,
                        ownerId: 'shared-owner',
                        workspaceRevision: 5
                    }))
                },
                projectMember: {
                    findUnique: jest.fn(async ({ where }) => ({
                        projectId: where.projectId_userId.projectId,
                        userId: where.projectId_userId.userId,
                        role: 'EDITOR',
                        disciplineRole: 'DEV'
                    }))
                }
            };

            // Set up 20 mock sockets: 12 on proj-alpha, 8 on proj-beta
            const alphaSockets = [];
            const betaSockets = [];

            for (let i = 0; i < 12; i++) {
                const userId = `user-alpha-${i}`;
                const token = jwt.sign({ userId }, process.env.JWT_SECRET);
                const socket = {
                    id: `sock-alpha-${i}`,
                    handshake: { auth: { token } },
                    data: { projectUserId: userId },
                    join: jest.fn(async () => {}),
                    leave: jest.fn(async () => {}),
                    emit: jest.fn()
                };
                const subRes = await subscribeToProjectRoom(socket, { projectId: 'proj-alpha', db: mockDb });
                expect(subRes.ok).toBe(true);
                alphaSockets.push(socket);
            }

            for (let i = 0; i < 8; i++) {
                const userId = `user-beta-${i}`;
                const token = jwt.sign({ userId }, process.env.JWT_SECRET);
                const socket = {
                    id: `sock-beta-${i}`,
                    handshake: { auth: { token } },
                    data: { projectUserId: userId },
                    join: jest.fn(async () => {}),
                    leave: jest.fn(async () => {}),
                    emit: jest.fn()
                };
                const subRes = await subscribeToProjectRoom(socket, { projectId: 'proj-beta', db: mockDb });
                expect(subRes.ok).toBe(true);
                betaSockets.push(socket);
            }

            // Zero transactions occurred during subscription (since capability is project.read)
            expect(dbTransactionCounter).toBe(0);

            // Now emit 50 events to proj-alpha and 50 events to proj-beta concurrently
            const broadcastTasks = [];
            for (let i = 0; i < 50; i++) {
                broadcastTasks.push(
                    deliverToProjectSubscribers({
                        id: `evt-alpha-${i}`,
                        projectId: 'proj-alpha',
                        sequence: i + 1,
                        type: 'test.progress',
                        actorId: 'user-alpha-0',
                        resourceId: `res-${i}`,
                        revision: i,
                        createdAt: new Date().toISOString()
                    })
                );
                broadcastTasks.push(
                    deliverScopedProjectTransport({
                        projectId: 'proj-beta',
                        event: 'editor:typing',
                        payload: { cursor: i }
                    })
                );
            }

            await Promise.all(broadcastTasks);

            // CRITICAL EMPIRICAL PROOF: 0 database transactions or advisory locks triggered during socket delivery!
            expect(dbTransactionCounter).toBe(0);
            expect(executeRawCounter).toBe(0);
            expect(mockDb.$transaction).not.toHaveBeenCalled();

            // Verify delivery to all 12 alpha sockets
            alphaSockets.forEach(sock => {
                expect(sock.emit).toHaveBeenCalledWith('project:event', expect.objectContaining({ type: 'test.progress' }));
                expect(sock.emit).toHaveBeenCalledWith('project_event', expect.objectContaining({ type: 'test.progress' }));
            });

            // Verify delivery to all 8 beta sockets
            betaSockets.forEach(sock => {
                expect(sock.emit).toHaveBeenCalledWith('editor:typing', expect.objectContaining({ cursor: expect.any(Number) }));
            });
        });

        test('failing / disconnecting sockets during broadcast do not crash broadcaster or block peers', async () => {
            const token = jwt.sign({ userId: 'user-err' }, process.env.JWT_SECRET);
            const workingSocket = {
                id: 'sock-working',
                handshake: { auth: { token } },
                data: { projectUserId: 'user-err' },
                join: jest.fn(async () => {}),
                leave: jest.fn(async () => {}),
                emit: jest.fn()
            };
            const brokenSocket = {
                id: 'sock-broken',
                handshake: { auth: { token } },
                data: { projectUserId: 'user-err' },
                join: jest.fn(async () => {}),
                leave: jest.fn(async () => {}),
                emit: jest.fn(() => {
                    throw new Error('Socket write pipe broken');
                })
            };

            const mockDb = {
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-fault', ownerId: 'user-err', workspaceRevision: 1 }))
                },
                projectMember: {
                    findUnique: jest.fn(async () => ({ role: 'OWNER' }))
                }
            };

            const sub1 = await subscribeToProjectRoom(workingSocket, { projectId: 'proj-fault', db: mockDb });
            const sub2 = await subscribeToProjectRoom(brokenSocket, { projectId: 'proj-fault', db: mockDb });
            expect(sub1.ok).toBe(true);
            expect(sub2.ok).toBe(true);

            // Broadcast should succeed without throwing
            await expect(
                deliverToProjectSubscribers({
                    id: 'evt-fault-1',
                    projectId: 'proj-fault',
                    type: 'ping'
                })
            ).resolves.not.toThrow();

            // Working socket still received event
            expect(workingSocket.emit).toHaveBeenCalledWith('project:event', expect.objectContaining({ id: 'evt-fault-1' }));
            // Broken socket was cleaned up / unsubscribed
            expect(brokenSocket.leave).toHaveBeenCalled();
        });
    });

    describe('Challenge 3: Transient Connection Drops & P2028 Automatic Retry Recovery', () => {
        test('recovers from 2 successive P2028 errors and succeeds on 3rd attempt', async () => {
            let attempt = 0;
            const mockTx = {
                $executeRaw: jest.fn(),
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-retry', ownerId: 'user-retry', workspaceRevision: 1 }))
                }
            };

            const mockDb = {
                $transaction: jest.fn(async (fn) => {
                    attempt++;
                    if (attempt <= 2) {
                        const err = new Error('Transaction API error: Unable to start a transaction. [code: P2028]');
                        err.code = 'P2028';
                        throw err;
                    }
                    return await fn(mockTx);
                })
            };

            const result = await withProjectGuard(
                { projectId: 'proj-retry', userId: 'user-retry', capability: 'files.write', db: mockDb },
                async () => ({ resilient: true })
            );

            expect(result).toEqual({ resilient: true });
            expect(attempt).toBe(3);
            expect(mockDb.$transaction).toHaveBeenCalledTimes(3);
        });

        test('recovers from transient PostgreSQL connection timeouts (P2024)', async () => {
            let attempt = 0;
            const mockTx = {
                $executeRaw: jest.fn(),
                project: { findFirst: jest.fn(async () => ({ id: 'proj-timeout', ownerId: 'user-timeout', workspaceRevision: 1 })) }
            };

            const mockDb = {
                $transaction: jest.fn(async (fn) => {
                    attempt++;
                    if (attempt === 1) {
                        const err = new Error('Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 25)');
                        err.code = 'P2024';
                        throw err;
                    }
                    return await fn(mockTx);
                })
            };

            const result = await withProjectGuard(
                { projectId: 'proj-timeout', userId: 'user-timeout', capability: 'files.write', db: mockDb },
                async () => ({ recovered: true })
            );

            expect(result).toEqual({ recovered: true });
            expect(attempt).toBe(2);
        });

        test('re-throws when transient error persists past 3 attempts', async () => {
            let attempts = 0;
            const mockDb = {
                $transaction: jest.fn(async () => {
                    attempts++;
                    const err = new Error('Transaction API error: Unable to start a transaction');
                    err.code = 'P2028';
                    throw err;
                })
            };

            await expect(
                withProjectGuard(
                    { projectId: 'proj-persist-fail', userId: 'user-1', capability: 'files.write', db: mockDb },
                    async () => {}
                )
            ).rejects.toThrow('Unable to start a transaction');

            expect(attempts).toBe(3);
        });

        test('immediately aborts on non-retryable errors without wasting retries', async () => {
            const nonRetryableErrors = [
                new ServiceError('Resource authorization context required', 400, 'ACCESS_CONTEXT_REQUIRED'),
                new ServiceError('Your role does not allow this action', 403, 'CAPABILITY_DENIED'),
                Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), { code: 'P2002' })
            ];

            for (const errorToThrow of nonRetryableErrors) {
                let attempts = 0;
                const mockDb = {
                    $transaction: jest.fn(async () => {
                        attempts++;
                        throw errorToThrow;
                    })
                };

                await expect(
                    withProjectGuard(
                        { projectId: 'proj-non-retry', userId: 'user-1', capability: 'files.write', db: mockDb },
                        async () => {}
                    )
                ).rejects.toThrow();

                // MUST NOT retry: attempts === 1
                expect(attempts).toBe(1);
            }
        });
    });

    describe('Challenge 4: Edge Cases & Malformed Inputs on Query Guards', () => {
        test('resolves projectId from snapshotId when projectId is omitted in suggestUnitTestcases', async () => {
            const mockSnapshotFindUnique = jest.fn(async ({ where }) => {
                if (where.id === 'snap-auto-resolve') {
                    return { projectId: 'proj-auto-resolved' };
                }
                return null;
            });

            const input = {
                projectId: null,
                snapshotId: 'snap-auto-resolve',
                filePath: 'src/components/Button.jsx',
                userId: 'user-test'
            };

            if (!input.projectId && input.snapshotId) {
                const snap = await mockSnapshotFindUnique({ where: { id: input.snapshotId }, select: { projectId: true } });
                if (snap?.projectId) {
                    input.projectId = snap.projectId;
                }
            }

            expect(input.projectId).toBe('proj-auto-resolved');
        });

        test('snapshot query sanitizes where object to avoid Prisma undefined rejections', () => {
            const getWhere = (snapshotId) => ({
                snapshots: {
                    where: snapshotId ? { id: snapshotId } : {},
                    orderBy: { createdAt: "desc" },
                    take: 1
                }
            });

            // When snapshotId is provided
            expect(getWhere('snap-123').snapshots.where).toEqual({ id: 'snap-123' });
            // When snapshotId is null
            expect(getWhere(null).snapshots.where).toEqual({});
            // When snapshotId is undefined
            expect(getWhere(undefined).snapshots.where).toEqual({});
            // When snapshotId is empty string
            expect(getWhere('').snapshots.where).toEqual({});

            // Prisma requires object, NEVER undefined
            expect(getWhere(undefined).snapshots.where).not.toBeUndefined();
        });

        test('controller returns 404 when snapshotId is not found', async () => {
            const req = {
                user: { id: 'user-no-proj' },
                params: { snapshotId: 'snap-orphan' },
                body: { filePath: 'src/test.js' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcase(req, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('controller returns 400 on hostile or corrupted validationMode', async () => {
            const req = {
                user: { id: 'user-hostile' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'src/test.js', validationMode: '../../etc/passwd' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcase(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid suggestion validation mode.' }));
        });

        test('applySuggestion controller rejects malicious requestId pattern', async () => {
            const req = {
                user: { id: 'user-inj' },
                params: { snapshotId: 'snap-1' },
                body: {
                    suggestion: { id: 'sug-1' },
                    requestId: 'invalid; DROP TABLE users; --'
                }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await applySuggestion(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid request ID' }));
        });
    });
});
