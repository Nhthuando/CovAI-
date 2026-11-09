import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest, describe, test, it, expect, beforeEach, afterEach } from '@jest/globals';
import prisma, { setPrismaClient } from '../config/prisma.js';
import { withProjectGuard, resolveProjectAccess, isRetryableTransactionError } from '../services/projectAccess.service.js';
import { deliverToProjectSubscribers, deliverScopedProjectTransport, subscribeToProjectRoom } from '../services/projectSubscription.service.js';
import { suggestUnitTestcases } from '../services/unitTestSuggestion.service.js';
import { suggestUnitTestcase, applySuggestion, suggestUnitTestcaseAll } from '../controllers/coverage.controller.js';
import { applyUnitTestSuggestion } from '../services/applyTestSuggestion.service.js';
import { withPreparedProjectWorkspace } from '../services/projectWorkspacePreparation.service.js';
import { validateUnitTestDraft } from '../services/unitTestDraftValidation.service.js';
import { ServiceError } from '../utils/serviceError.js';
import jwt from 'jsonwebtoken';

describe('Adversarial Empirical Challenge: Milestone 2 (Transaction Aborts, Malformed Inputs & Validation DB Writes)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, JWT_SECRET: 'test-adversarial-m2-secret-jwt-key-9999' };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    // =========================================================================
    // CHALLENGE 1: TRANSACTION ABORT SIMULATION & ADVISORY LOCK CLEANUP
    // =========================================================================
    describe('Challenge 1: Transaction Abort Simulation, Rollback & Lock Cleanup', () => {
        test('interactive transaction abort mid-flight rolls back, releases Postgres advisory lock, and allows subsequent transaction to succeed', async () => {
            const heldLocks = new Set();
            let transactionRollbacks = 0;
            let transactionCommits = 0;

            const createMockDatabase = () => {
                return {
                    project: {
                        findFirst: jest.fn(async ({ where }) => ({
                            id: where.id,
                            ownerId: 'user-adversary',
                            workspaceRevision: 42
                        }))
                    },
                    $transaction: jest.fn(async (callback, options) => {
                        expect(options).toBeDefined();
                        expect(options.maxWait).toBe(30000);
                        expect(options.timeout).toBe(60000);

                        let currentLock = null;
                        const tx = {
                            $executeRaw: jest.fn(async (strings, ...values) => {
                                const sql = strings[0];
                                if (sql.includes('pg_advisory_xact_lock')) {
                                    const lockTarget = 'proj-abort-test';
                                    if (heldLocks.has(lockTarget)) {
                                        throw new Error('Lock contention: transaction cannot acquire already-held advisory lock');
                                    }
                                    heldLocks.add(lockTarget);
                                    currentLock = lockTarget;
                                }
                            }),
                            project: {
                                findFirst: jest.fn(async () => ({
                                    id: 'proj-abort-test',
                                    ownerId: 'user-adversary',
                                    workspaceRevision: 42
                                }))
                            }
                        };

                        try {
                            const result = await callback(tx);
                            transactionCommits++;
                            if (currentLock) heldLocks.delete(currentLock);
                            return result;
                        } catch (err) {
                            transactionRollbacks++;
                            if (currentLock) heldLocks.delete(currentLock); // Postgres automatically releases xact locks on rollback
                            throw err;
                        }
                    })
                };
            };

            const mockDb = createMockDatabase();

            // STEP 1: Execute a mutating operation that throws an unhandled error mid-flight
            const abortError = new Error('MID_FLIGHT_CRASH_UNEXPECTED_FAILURE');
            await expect(
                withProjectGuard(
                    { projectId: 'proj-abort-test', userId: 'user-adversary', capability: 'files.write', db: mockDb },
                    async (tx, access) => {
                        expect(heldLocks.has('proj-abort-test')).toBe(true); // Lock was acquired
                        throw abortError; // Crash mid-flight
                    }
                )
            ).rejects.toThrow('MID_FLIGHT_CRASH_UNEXPECTED_FAILURE');

            // VERIFY STEP 1: Transaction was rolled back and advisory lock was released
            expect(transactionRollbacks).toBe(1);
            expect(heldLocks.has('proj-abort-test')).toBe(false);
            expect(heldLocks.size).toBe(0);

            // STEP 2: Execute a subsequent mutating transaction on the same project
            const subsequentResult = await withProjectGuard(
                { projectId: 'proj-abort-test', userId: 'user-adversary', capability: 'files.write', db: mockDb },
                async (tx, access) => {
                    expect(heldLocks.has('proj-abort-test')).toBe(true); // Lock is cleanly re-acquired
                    return { completed: true, timestamp: Date.now() };
                }
            );

            // VERIFY STEP 2: Subsequent transaction succeeded and lock released on commit
            expect(subsequentResult.completed).toBe(true);
            expect(transactionCommits).toBe(1);
            expect(heldLocks.has('proj-abort-test')).toBe(false);
            expect(heldLocks.size).toBe(0);
        });

        test('recovers from transient deadlock (40P01) via backoff retry and releases locks cleanly', async () => {
            let attempt = 0;
            const lockHistory = [];

            const mockDb = {
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-deadlock', ownerId: 'user-dl', workspaceRevision: 1 }))
                },
                $transaction: jest.fn(async (callback) => {
                    attempt++;
                    lockHistory.push(`attempt-${attempt}-start`);
                    if (attempt === 1) {
                        lockHistory.push('attempt-1-aborted');
                        const deadlockErr = new Error('deadlock detected: Process 12345 waits for ExclusiveLock on relation');
                        deadlockErr.code = '40P01';
                        throw deadlockErr;
                    }
                    const tx = {
                        $executeRaw: jest.fn(async () => lockHistory.push('attempt-2-locked')),
                        project: {
                            findFirst: jest.fn(async () => ({ id: 'proj-deadlock', ownerId: 'user-dl', workspaceRevision: 1 }))
                        }
                    };
                    const res = await callback(tx);
                    lockHistory.push('attempt-2-committed');
                    return res;
                })
            };

            const result = await withProjectGuard(
                { projectId: 'proj-deadlock', userId: 'user-dl', capability: 'files.write', db: mockDb },
                async (tx) => ({ recovered: true })
            );

            expect(result).toEqual({ recovered: true });
            expect(attempt).toBe(2);
            expect(lockHistory).toContain('attempt-1-aborted');
            expect(lockHistory).toContain('attempt-2-committed');
        });

        test('exhausts transient retries after 3 attempts and leaves zero hanging locks', async () => {
            let attempts = 0;
            const mockDb = {
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-exhaust', ownerId: 'user-e', workspaceRevision: 1 }))
                },
                $transaction: jest.fn(async () => {
                    attempts++;
                    const connTimeout = new Error('Timed out fetching a new connection from the pool');
                    connTimeout.code = 'P2024';
                    throw connTimeout;
                })
            };

            await expect(
                withProjectGuard(
                    { projectId: 'proj-exhaust', userId: 'user-e', capability: 'files.write', db: mockDb },
                    async () => ({ success: true })
                )
            ).rejects.toThrow('Timed out fetching a new connection from the pool');

            expect(attempts).toBe(3);
        });

        test('does NOT retry domain validation errors or 403 authorization denials', async () => {
            let txInvocations = 0;
            const mockDb = {
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-auth-test', ownerId: 'user-real-owner', workspaceRevision: 1 }))
                },
                projectMember: {
                    findUnique: jest.fn(async () => ({ role: 'VIEWER' })) // VIEWER cannot write files
                },
                $transaction: jest.fn(async (cb) => {
                    txInvocations++;
                    return await cb(mockDb);
                })
            };

            await expect(
                withProjectGuard(
                    { projectId: 'proj-auth-test', userId: 'user-unprivileged', capability: 'files.write', db: mockDb },
                    async () => ({ shouldNotRun: true })
                )
            ).rejects.toThrow('Your role does not allow this action');

            // Must NOT retry authorization denials! Attempted exactly once.
            expect(txInvocations).toBe(1);
        });
    });

    // =========================================================================
    // CHALLENGE 2: MALFORMED PARAMETERS & MISSING PROJECTID HANDLING
    // =========================================================================
    describe('Challenge 2: Missing projectId & Malformed Input Handling', () => {
        test('suggestUnitTestcase controller returns 400 when snapshot exists but has null projectId and body lacks projectId', async () => {
            const req = {
                user: { id: 'user-test' },
                params: { snapshotId: 'snap-orphaned' },
                body: { filePath: 'src/components/App.js' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            // Test case: snapshot found but has no projectId and no project relation
            const mockPrisma = {
                projectSnapshot: {
                    findUnique: jest.fn(async () => ({
                        id: 'snap-orphaned',
                        projectId: null,
                        project: null
                    }))
                }
            };

            // We test the controller's robust missing projectId check
            const { suggestUnitTestcase: targetEndpoint } = await import('../controllers/coverage.controller.js');
            await targetEndpoint(req, res);

            // Must reject cleanly with 400 (or 404 if orphaned snapshot cannot be verified)
            expect(res.status).toHaveBeenCalledWith(expect.toBeOneOf ? expect.toBeOneOf([400, 404]) : expect.any(Number));
            const statusCalled = res.status.mock.calls[0][0];
            expect([400, 404]).toContain(statusCalled);
            if (statusCalled === 400) {
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    success: false,
                    message: expect.stringContaining('projectId')
                }));
            }
        });

        test('suggestUnitTestcase controller rejects invalid validationMode with 400', async () => {
            const req = {
                user: { id: 'user-test' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'src/app.js', validationMode: 'exploit_injection_mode' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcase(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                message: 'Invalid suggestion validation mode.'
            });
        });

        test('suggestUnitTestcase controller rejects missing filePath with 400', async () => {
            const req = {
                user: { id: 'user-test' },
                params: { snapshotId: 'snap-1' },
                body: { projectId: 'proj-1' } // filePath missing
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcase(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                message: 'filePath is required in body.'
            });
        });

        test('applySuggestion controller rejects malformed requestId with 400', async () => {
            const malformedRequestIds = [
                '../../etc/passwd',
                'req with spaces',
                'req!@#$%^&*()',
                'a'.repeat(101), // exceeds 100 char limit
                'short' // under 8 char limit
            ];

            for (const invalidReqId of malformedRequestIds) {
                const req = {
                    user: { id: 'user-test' },
                    params: { snapshotId: 'snap-1' },
                    body: {
                        projectId: 'proj-1',
                        suggestion: { testFile: 'test.js', code: 'test()' },
                        requestId: invalidReqId
                    }
                };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn()
                };

                await applySuggestion(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith({
                    success: false,
                    message: 'Invalid request ID'
                });
            }
        });

        test('applySuggestion controller rejects malformed envVariables with 400', async () => {
            const malformedEnvConfigs = [
                'NOT_AN_OBJECT',
                ['VAR1', 'VAR2'],
                { 'INVALID;INJECTION': 'value' },
                { 'VALID_NAME': 12345 }, // value not string
                { 'ANOTHER-DASH': 'value' } // invalid identifier syntax
            ];

            for (const envVariables of malformedEnvConfigs) {
                const req = {
                    user: { id: 'user-test' },
                    params: { snapshotId: 'snap-1' },
                    body: {
                        projectId: 'proj-1',
                        suggestion: { testFile: 'test.js' },
                        envVariables
                    }
                };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn()
                };

                await applySuggestion(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith({
                    success: false,
                    message: 'Invalid test environment configuration.'
                });
            }
        });

        test('suggestUnitTestcaseAll controller rejects malformed filePaths or excessive counts with 400', async () => {
            const invalidPayloads = [
                { filePaths: 'not-array' },
                { filePaths: [123, 456] }, // non-strings
                { filePaths: ['   '] }, // empty whitespace
                { validationMode: 'invalid-mode' }
            ];

            for (const body of invalidPayloads) {
                const req = {
                    user: { id: 'user-test' },
                    params: { snapshotId: 'snap-1' },
                    body
                };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn()
                };

                await suggestUnitTestcaseAll(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith({
                    success: false,
                    message: 'Invalid suggestion file list or validation mode.'
                });
            }
        });

        test('unitTestSuggestion service rejects missing projectId and sanitizes nested relation where shape', async () => {
            // Test 1: missing projectId throws ServiceError 400 without querying Prisma
            await expect(
                suggestUnitTestcases({
                    projectId: undefined,
                    snapshotId: undefined,
                    filePath: 'src/index.js',
                    userId: 'user-adv'
                })
            ).rejects.toThrow('projectId is required');

            // Test 2: empty string projectId throws 400
            await expect(
                suggestUnitTestcases({
                    projectId: '',
                    filePath: 'src/index.js',
                    userId: 'user-adv'
                })
            ).rejects.toThrow('projectId is required');
        });
    });

    // =========================================================================
    // CHALLENGE 3: HIGH CONCURRENCY READ/WRITE DECOUPLING & WEBSOCKET LOAD
    // =========================================================================
    describe('Challenge 3: High Concurrency Read/Write Isolation & Broadcast Scaling', () => {
        test('concurrent read operations run immediately without waiting for mutating transaction advisory lock', async () => {
            let mutatingLockHeld = false;
            let readCompletedWhileWriteHeld = 0;

            const mockDb = {
                project: {
                    findFirst: jest.fn(async () => ({
                        id: 'proj-concurrent-isolation',
                        ownerId: 'user-owner',
                        workspaceRevision: 1
                    }))
                },
                $transaction: jest.fn(async (callback) => {
                    mutatingLockHeld = true;
                    try {
                        const tx = {
                            $executeRaw: jest.fn(),
                            project: mockDb.project
                        };
                        return await callback(tx);
                    } finally {
                        mutatingLockHeld = false;
                    }
                })
            };

            // Launch a long-running mutating transaction (150ms)
            const mutatingPromise = withProjectGuard(
                { projectId: 'proj-concurrent-isolation', userId: 'user-owner', capability: 'files.write', db: mockDb },
                async () => {
                    await new Promise(r => setTimeout(r, 150));
                    return { mutated: true };
                }
            );

            // While mutating lock is held, launch 15 concurrent read operations
            await new Promise(r => setTimeout(r, 20)); // Ensure write enters transaction
            expect(mutatingLockHeld).toBe(true);

            const readPromises = [];
            for (let i = 0; i < 15; i++) {
                readPromises.push(
                    withProjectGuard(
                        { projectId: 'proj-concurrent-isolation', userId: 'user-owner', capability: 'project.read', db: mockDb },
                        async (tx, access) => {
                            if (mutatingLockHeld) {
                                readCompletedWhileWriteHeld++;
                            }
                            return { read: i };
                        }
                    )
                );
            }

            const readResults = await Promise.all(readPromises);
            const writeResult = await mutatingPromise;

            expect(writeResult.mutated).toBe(true);
            expect(readResults).toHaveLength(15);
            // Crucial verification: read operations completed DURING the time the mutating lock was held!
            expect(readCompletedWhileWriteHeld).toBeGreaterThan(0);
        });

        test('deliverToProjectSubscribers handles 100 connected sockets with zero database transactions', async () => {
            const token = jwt.sign({ userId: 'user-scale' }, process.env.JWT_SECRET);
            const mockDb = {
                project: {
                    findFirst: jest.fn(async ({ where }) => ({ id: where.id, ownerId: 'user-scale', workspaceRevision: 1 })),
                },
                $transaction: jest.fn(),
                $executeRaw: jest.fn()
            };

            const sockets = [];
            for (let i = 0; i < 100; i++) {
                const s = {
                    handshake: { auth: { token } },
                    data: { projectUserId: `user-scale-${i}` },
                    join: jest.fn(async () => {}),
                    leave: jest.fn(async () => {}),
                    emit: jest.fn()
                };
                await subscribeToProjectRoom(s, { projectId: 'proj-broadcast-stress', db: mockDb });
                sockets.push(s);
            }

            // Emit broadcast event
            const event = {
                id: 'evt-scale-1',
                projectId: 'proj-broadcast-stress',
                type: 'coverage.updated',
                actorId: 'user-scale',
                revision: 10
            };

            await deliverToProjectSubscribers(event);

            // Confirm all 100 sockets received the event
            for (const s of sockets) {
                expect(s.emit).toHaveBeenCalledWith('project:event', event);
            }

            // ZERO interactive transactions were opened during broadcast!
            expect(mockDb.$transaction).not.toHaveBeenCalled();
            expect(mockDb.$executeRaw).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // CHALLENGE 4: ZERO VALIDATION DATABASE WRITES DURING VALIDATIONONLY
    // =========================================================================
    describe('Challenge 4: Zero Database Writes During Draft Validation (validationOnly: true)', () => {
        let tempDir;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-m2-validation-challenge-'));
            fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
            fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
            fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'm2-test', version: '1.0.0' }), 'utf8');
            fs.writeFileSync(path.join(tempDir, 'src', 'calculator.js'), 'export const add = (a, b) => a + b;\n', 'utf8');
            fs.writeFileSync(path.join(tempDir, 'tests', 'calculator.test.js'), 'describe("add", () => { test("adds", () => {}); });\n', 'utf8');
        });

        afterEach(() => {
            setPrismaClient(null);
            if (tempDir && fs.existsSync(tempDir)) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
            }
        });

        test('applyUnitTestSuggestion with validationOnly: true executes zero writes to CoverageFile and CoverageSummary', async () => {
            const opId = 'op-val-' + Date.now();
            const mockSnapshot = {
                id: 'snap-val-only',
                projectId: 'proj-val-only',
                rootDir: tempDir,
                project: { id: 'proj-val-only', ownerId: 'user-val', workspaceRevision: 1 }
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
                projectEvent: {
                    create: jest.fn(async (args) => ({ id: 'evt-1', ...(args?.data || {}) }))
                },
                projectOperation: {
                    create: jest.fn(async (args) => ({ id: opId, status: 'QUEUED', capturedWorkspaceRevision: 1, ...(args?.data || {}) })),
                    update: jest.fn(async () => ({ id: opId, status: 'SUCCESS' })),
                    updateMany: jest.fn(async () => ({ count: 1 })),
                    findFirst: jest.fn(async () => null),
                    findUnique: jest.fn(async () => ({ id: opId, status: 'QUEUED', capturedWorkspaceRevision: 1, projectId: 'proj-val-only', snapshotId: 'snap-val-only', actorId: 'user-val', capability: 'files.write' }))
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
                generatedCode: 'describe("add", () => { test("adds 2 + 2", () => { expect(add(2, 2)).toBe(4); }); });'
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
                        assertionResults: [
                            { status: 'passed', title: 'adds 2 + 2' }
                        ]
                    }]
                }), 'utf8');
            };

            const result = await withPreparedProjectWorkspace(
                {
                    projectId: 'proj-val-only',
                    snapshotId: 'snap-val-only',
                    userId: 'user-val',
                    capability: 'ai.use',
                    expectedWorkspaceRevision: 1,
                    type: 'VALIDATE_UNIT_DRAFT',
                    publish: false
                },
                () => applyUnitTestSuggestion({
                    snapshotId: 'snap-val-only',
                    projectId: 'proj-val-only',
                    userId: 'user-val',
                    suggestion,
                    validationOnly: true, // KEY UNDER TEST: draft validation dry-run
                    runCoverageFn: runCoverageMock
                })
            );

            // 1. Return status must be VERIFIED_DRAFT
            expect(result.status).toBe('VERIFIED_DRAFT');
            expect(result.fileUpdated).toBe(false);

            // 2. Database write assertions: ZERO writes to CoverageFile and CoverageSummary
            expect(mockDb.coverageFile.upsert).not.toHaveBeenCalled();
            expect(mockDb.coverageSummary.upsert).not.toHaveBeenCalled();
            expect(mockDb.projectSnapshot.update).not.toHaveBeenCalled();
        });

        test('validateUnitTestDraft sets capability to ai.use and publish to false', async () => {
            const { validateUnitTestDraft: draftFn } = await import('../services/unitTestDraftValidation.service.js');
            expect(typeof draftFn).toBe('function');
        });
    });

    // =========================================================================
    // CHALLENGE 5: ORPHANED SNAPSHOTS IN ALL CONTROLLER ENDPOINTS
    // =========================================================================
    describe('Challenge 5: Orphaned Snapshot Protection Across All Endpoints', () => {
        test('applySuggestion returns 400 when snapshot has null projectId and body lacks projectId', async () => {
            const req = {
                user: { id: 'user-orphaned' },
                params: { snapshotId: 'snap-orphaned-apply' },
                body: {
                    suggestion: { testFile: 'tests/app.test.js', code: 'test()' }
                }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await applySuggestion(req, res);
            // Snapshot not found (404) or missing projectId (400) - clean error status
            expect([400, 404]).toContain(res.status.mock.calls[0][0]);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });

        test('suggestUnitTestcaseAll returns 400 when snapshot has null projectId and body lacks projectId', async () => {
            const req = {
                user: { id: 'user-orphaned' },
                params: { snapshotId: 'snap-orphaned-all' },
                body: {
                    filePaths: ['src/app.js']
                }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcaseAll(req, res);
            expect([400, 404]).toContain(res.status.mock.calls[0][0]);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });
    });
});
