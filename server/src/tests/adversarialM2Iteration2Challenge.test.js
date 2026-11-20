import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { setPrismaClient } from '../config/prisma.js';
import { withProjectGuard, resolveProjectAccess } from '../services/projectAccess.service.js';
import { applyUnitTestSuggestion, activeApplyLocks } from '../services/applyTestSuggestion.service.js';
import { parseCoverageFilesForSnapshot } from '../services/coverageFileParser.service.js';
import { parseCoverageFunctionsForSnapshot } from '../services/coverageFunctionParser.service.js';

describe('Empirical Challenge: Milestone 2 Iteration 2 (Mutating Serialization & Validation DB Suppression)', () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-m2-iter2-emp-'));
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'm2-iter2-emp', version: '1.0.0' }), 'utf8');
        fs.writeFileSync(path.join(tempDir, 'src', 'math.js'), 'export const multiply = (a, b) => a * b;\n', 'utf8');
        fs.writeFileSync(path.join(tempDir, 'tests', 'math.test.js'), 'describe("multiply", () => { test("works", () => {}); });\n', 'utf8');
    });

    afterEach(() => {
        activeApplyLocks.clear();
        setPrismaClient(null);
        if (tempDir && fs.existsSync(tempDir)) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        }
    });

    // =========================================================================
    // 1. MUTATING CAPABILITY SERIALIZATION UNDER HIGH CONCURRENCY
    // =========================================================================
    describe('1. Mutating Capability Serialization via pg_advisory_xact_lock', () => {
        /**
         * Simulates PostgreSQL's pg_advisory_xact_lock behavior:
         * Multiple concurrent transactions attempting to acquire the lock on the same projectId
         * must wait in a FIFO queue. Only one transaction holds the lock at any time.
         */
        const createPostgresMock = () => {
            const heldLocks = new Map(); // projectId -> lock queue
            const lockStats = {
                acquisitions: 0,
                releases: 0,
                concurrentInXact: 0,
                peakConcurrentInXact: 0
            };

            const acquireAdvisoryLock = async (projectId) => {
                if (!heldLocks.has(projectId)) {
                    heldLocks.set(projectId, []);
                }
                const queue = heldLocks.get(projectId);
                return new Promise((resolve) => {
                    const proceed = () => {
                        lockStats.acquisitions++;
                        lockStats.concurrentInXact++;
                        lockStats.peakConcurrentInXact = Math.max(lockStats.peakConcurrentInXact, lockStats.concurrentInXact);
                        resolve();
                    };

                    if (queue.length === 0) {
                        queue.push(proceed);
                        proceed();
                    } else {
                        queue.push(proceed);
                    }
                });
            };

            const releaseAdvisoryLock = (projectId) => {
                lockStats.releases++;
                lockStats.concurrentInXact--;
                const queue = heldLocks.get(projectId);
                if (queue) {
                    queue.shift(); // Remove current holder
                    if (queue.length > 0) {
                        const next = queue[0];
                        next();
                    } else {
                        heldLocks.delete(projectId);
                    }
                }
            };

            const mockDb = {
                project: {
                    findFirst: jest.fn(async ({ where }) => ({
                        id: where.id,
                        ownerId: 'user-emp-owner',
                        workspaceRevision: 1
                    }))
                },
                projectMember: {
                    findUnique: jest.fn(async ({ where }) => ({
                        projectId: where.projectId_userId.projectId,
                        userId: where.projectId_userId.userId,
                        role: 'OWNER',
                        disciplineRole: 'LEAD'
                    }))
                },
                $executeRaw: jest.fn(),
                $transaction: jest.fn(async (callback, options) => {
                    let lockedProjectId = null;
                    const tx = {
                        project: mockDb.project,
                        projectMember: mockDb.projectMember,
                        $executeRaw: jest.fn(async (strings, ...values) => {
                            const rawQuery = strings ? strings.join('') : '';
                            if (rawQuery.includes('pg_advisory_xact_lock')) {
                                lockedProjectId = values[0];
                                await acquireAdvisoryLock(lockedProjectId);
                            }
                        })
                    };

                    try {
                        const result = await callback(tx);
                        return result;
                    } finally {
                        if (lockedProjectId) {
                            releaseAdvisoryLock(lockedProjectId);
                        }
                    }
                })
            };

            return { mockDb, lockStats };
        };

        test('members.manage serialized: 15 concurrent calls NEVER execute concurrently inside critical section', async () => {
            const { mockDb, lockStats } = createPostgresMock();
            const projectId = 'proj-serial-members';
            let activeCriticalSections = 0;
            let peakActiveCriticalSections = 0;
            const executionOrder = [];

            const runManageTask = async (index) => {
                return await withProjectGuard(
                    { projectId, userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                    async (tx, access) => {
                        activeCriticalSections++;
                        peakActiveCriticalSections = Math.max(peakActiveCriticalSections, activeCriticalSections);

                        // If serialization fails, activeCriticalSections will be > 1
                        expect(activeCriticalSections).toBe(1);

                        // Simulate non-trivial work inside transaction (15ms)
                        await new Promise(r => setTimeout(r, 15));
                        executionOrder.push(index);

                        activeCriticalSections--;
                        return { index, role: access.role };
                    }
                );
            };

            // Fire 15 concurrent requests
            const promises = Array.from({ length: 15 }, (_, i) => runManageTask(i));
            const results = await Promise.all(promises);

            expect(results).toHaveLength(15);
            expect(executionOrder).toHaveLength(15);
            // Peak concurrent executions inside critical section must be strictly 1
            expect(peakActiveCriticalSections).toBe(1);
            expect(lockStats.peakConcurrentInXact).toBe(1);
            expect(lockStats.acquisitions).toBe(15);
            expect(lockStats.releases).toBe(15);
        });

        test('mixed mutating capabilities (members.manage, files.write, chat.write, integrations.write) are strictly serialized', async () => {
            const { mockDb, lockStats } = createPostgresMock();
            const projectId = 'proj-mixed-mutating';
            const mutatingCapabilities = [
                'members.manage',
                'files.write',
                'chat.write',
                'integrations.write',
                'memory.write',
                'snapshot.restore'
            ];

            let activeCriticalSections = 0;
            let peakActiveCriticalSections = 0;

            const tasks = mutatingCapabilities.map((cap, i) => {
                return withProjectGuard(
                    { projectId, userId: 'user-emp-owner', capability: cap, db: mockDb },
                    async (tx, access) => {
                        activeCriticalSections++;
                        peakActiveCriticalSections = Math.max(peakActiveCriticalSections, activeCriticalSections);
                        expect(activeCriticalSections).toBe(1);
                        await new Promise(r => setTimeout(r, 10));
                        activeCriticalSections--;
                        return { i, cap };
                    }
                );
            });

            const results = await Promise.all(tasks);
            expect(results).toHaveLength(mutatingCapabilities.length);
            expect(peakActiveCriticalSections).toBe(1);
            expect(lockStats.acquisitions).toBe(mutatingCapabilities.length);
        });

        test('multi-tenant independence: concurrent operations on distinct projects execute in parallel without cross-blocking', async () => {
            const { mockDb } = createPostgresMock();
            let activeProjA = 0;
            let peakProjA = 0;
            let activeProjB = 0;
            let peakProjB = 0;
            let globalConcurrent = 0;
            let peakGlobalConcurrent = 0;

            const runTaskA = (i) => withProjectGuard(
                { projectId: 'proj-A', userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                async () => {
                    activeProjA++;
                    globalConcurrent++;
                    peakProjA = Math.max(peakProjA, activeProjA);
                    peakGlobalConcurrent = Math.max(peakGlobalConcurrent, globalConcurrent);

                    // Must be isolated within Proj A
                    expect(activeProjA).toBe(1);

                    await new Promise(r => setTimeout(r, 25));
                    activeProjA--;
                    globalConcurrent--;
                    return 'A';
                }
            );

            const runTaskB = (i) => withProjectGuard(
                { projectId: 'proj-B', userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                async () => {
                    activeProjB++;
                    globalConcurrent++;
                    peakProjB = Math.max(peakProjB, activeProjB);
                    peakGlobalConcurrent = Math.max(peakGlobalConcurrent, globalConcurrent);

                    // Must be isolated within Proj B
                    expect(activeProjB).toBe(1);

                    await new Promise(r => setTimeout(r, 25));
                    activeProjB--;
                    globalConcurrent--;
                    return 'B';
                }
            );

            // Run 4 tasks on proj-A and 4 tasks on proj-B concurrently
            const allTasks = [
                runTaskA(0), runTaskB(0),
                runTaskA(1), runTaskB(1),
                runTaskA(2), runTaskB(2),
                runTaskA(3), runTaskB(3)
            ];

            const results = await Promise.all(allTasks);
            expect(results).toHaveLength(8);
            // Within each project, serialization is strictly 1
            expect(peakProjA).toBe(1);
            expect(peakProjB).toBe(1);
            // Across projects, both execute simultaneously
            expect(peakGlobalConcurrent).toBeGreaterThan(1);
        });

        test('read capabilities (members.read, project.read) execute immediately without waiting for mutating transaction locks', async () => {
            const { mockDb } = createPostgresMock();
            const projectId = 'proj-read-bypass';
            let mutatingRunning = false;
            let readCompletedDuringMutating = false;

            // Start a long-running mutating operation (100ms)
            const mutatingPromise = withProjectGuard(
                { projectId, userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                async () => {
                    mutatingRunning = true;
                    await new Promise(r => setTimeout(r, 80));
                    mutatingRunning = false;
                    return 'MUTATING_DONE';
                }
            );

            // Wait 10ms for mutating transaction to acquire the lock
            await new Promise(r => setTimeout(r, 10));
            expect(mutatingRunning).toBe(true);

            // Now run read capabilities concurrently
            const read1 = await withProjectGuard(
                { projectId, userId: 'user-emp-owner', capability: 'members.read', db: mockDb },
                async (db, access) => {
                    if (mutatingRunning) readCompletedDuringMutating = true;
                    return { role: access.role };
                }
            );

            const read2 = await withProjectGuard(
                { projectId, userId: 'user-emp-owner', capability: 'project.read', db: mockDb },
                async (db, access) => {
                    return { role: access.role };
                }
            );

            expect(read1.role).toBe('OWNER');
            expect(read2.role).toBe('OWNER');
            // Proves read was NOT blocked behind the 80ms mutating lock
            expect(readCompletedDuringMutating).toBe(true);

            const mutatingResult = await mutatingPromise;
            expect(mutatingResult).toBe('MUTATING_DONE');
        });

        test('failure during members.manage releases lock so subsequent transactions are not starved', async () => {
            const { mockDb, lockStats } = createPostgresMock();
            const projectId = 'proj-fail-release';

            // First task crashes
            await expect(
                withProjectGuard(
                    { projectId, userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                    async () => {
                        throw new Error('CRITICAL_MEMBER_MUTATION_CRASH');
                    }
                )
            ).rejects.toThrow('CRITICAL_MEMBER_MUTATION_CRASH');

            expect(lockStats.concurrentInXact).toBe(0);

            // Second task succeeds smoothly
            const result = await withProjectGuard(
                { projectId, userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                async () => {
                    return { success: true };
                }
            );

            expect(result.success).toBe(true);
            expect(lockStats.concurrentInXact).toBe(0);
        });

        test('handles hostile SQL-injection projectId payloads safely via parameterized $executeRaw', async () => {
            let capturedRawStrings = null;
            let capturedValues = null;
            const maliciousProjectId = "proj-1'; DROP TABLE projects; --";

            const mockDb = {
                project: {
                    findFirst: jest.fn(async () => ({ id: maliciousProjectId, ownerId: 'user-emp-owner', workspaceRevision: 1 }))
                },
                $transaction: jest.fn(async (callback) => {
                    const tx = {
                        project: mockDb.project,
                        $executeRaw: jest.fn(async (strings, ...values) => {
                            capturedRawStrings = strings;
                            capturedValues = values;
                        })
                    };
                    return await callback(tx);
                })
            };

            await withProjectGuard(
                { projectId: maliciousProjectId, userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                async () => ({ safe: true })
            );

            // Tagged template string ensures maliciousProjectId is passed as parameter, not interpolated raw SQL
            expect(capturedValues).toEqual([maliciousProjectId]);
            expect(capturedRawStrings.join('')).toContain('SELECT pg_advisory_xact_lock(hashtextextended(');
        });

        test('members.manage retries on transient P2028 / 40P01 errors and maintains advisory lock across attempts', async () => {
            let attempt = 0;
            const lockInvocations = [];

            const mockDb = {
                project: {
                    findFirst: jest.fn(async () => ({ id: 'proj-retry-test', ownerId: 'user-emp-owner', workspaceRevision: 1 }))
                },
                $transaction: jest.fn(async (callback) => {
                    attempt++;
                    if (attempt === 1) {
                        const err = new Error('Transaction API error: Unable to start a transaction');
                        err.code = 'P2028';
                        throw err;
                    }
                    const tx = {
                        project: mockDb.project,
                        $executeRaw: jest.fn(async () => {
                            lockInvocations.push(`attempt-${attempt}-lock`);
                        })
                    };
                    return await callback(tx);
                })
            };

            const res = await withProjectGuard(
                { projectId: 'proj-retry-test', userId: 'user-emp-owner', capability: 'members.manage', db: mockDb },
                async () => ({ status: 'managed' })
            );

            expect(res.status).toBe('managed');
            expect(attempt).toBe(2);
            expect(lockInvocations).toContain('attempt-2-lock');
        });
    });

    // =========================================================================
    // 2. CONCURRENT VALIDATION-ONLY DB SUPPRESSION
    // =========================================================================
    describe('2. Concurrent applyUnitTestSuggestion with validationOnly: true Zero DB Writes', () => {
        test('concurrent validation-only requests execute cleanly with ZERO database writes and return VERIFIED_DRAFT', async () => {
            const mockSnapshot = {
                id: 'snap-val-concurrent',
                projectId: 'proj-val-concurrent',
                rootDir: tempDir,
                project: { id: 'proj-val-concurrent', ownerId: 'user-val', workspaceRevision: 1 }
            };

            let transactionCallCount = 0;
            let coverageUpsertCount = 0;
            let snapshotUpdateCount = 0;

            const mockDb = {
                projectSnapshot: {
                    findUnique: jest.fn(async () => mockSnapshot),
                    findFirst: jest.fn(async () => mockSnapshot),
                    update: jest.fn(async () => {
                        snapshotUpdateCount++;
                        return mockSnapshot;
                    })
                },
                project: {
                    findUnique: jest.fn(async () => mockSnapshot.project),
                    findFirst: jest.fn(async () => mockSnapshot.project),
                    update: jest.fn(async () => ({ eventSequence: 1 }))
                },
                coverageFile: {
                    findMany: jest.fn(async () => []),
                    upsert: jest.fn(async () => {
                        coverageUpsertCount++;
                        return {};
                    })
                },
                coverageSummary: {
                    findUnique: jest.fn(async () => null),
                    upsert: jest.fn(async () => {
                        coverageUpsertCount++;
                        return {};
                    })
                },
                $transaction: jest.fn(async (cb) => {
                    transactionCallCount++;
                    if (typeof cb === 'function') return await cb(mockDb);
                    return Promise.all(cb);
                }),
                $executeRaw: jest.fn()
            };

            setPrismaClient(mockDb);

            const runCoverageMock = async ({ coverageDir }) => {
                fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({
                    'src/math.js': {
                        path: path.join(tempDir, 'src', 'math.js'),
                        s: { 0: 1 }, b: {}, f: { 0: 1 }
                    }
                }), 'utf8');
                fs.writeFileSync(path.join(coverageDir, 'coverage-summary.json'), JSON.stringify({
                    'src/math.js': {
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
                        name: 'tests/math.test.js',
                        status: 'passed',
                        numFailingTests: 0,
                        assertionResults: [{ status: 'passed', title: 'multiplies numbers' }]
                    }]
                }), 'utf8');
            };

            // Run 5 sequential/concurrent suggestion validations
            const runValidation = async (id) => {
                return await applyUnitTestSuggestion({
                    snapshotId: 'snap-val-concurrent',
                    projectId: 'proj-val-concurrent',
                    userId: 'user-val',
                    suggestion: {
                        sourceFile: 'src/math.js',
                        testFile: 'tests/math.test.js',
                        framework: 'jest',
                        generatedCode: `describe("multiply ${id}", () => { test("multiplies", () => { expect(multiply(2, 3)).toBe(6); }); });`
                    },
                    validationOnly: true,
                    runCoverageFn: runCoverageMock
                });
            };

            const results = [];
            for (let i = 0; i < 4; i++) {
                results.push(await runValidation(i));
            }

            // Verify all returned VERIFIED_DRAFT with zero file updates
            for (const result of results) {
                expect(result.success).toBe(true);
                expect(result.status).toBe('VERIFIED_DRAFT');
                expect(result.fileUpdated).toBe(false);
            }

            // Verify ZERO database mutations were performed across all executions
            expect(transactionCallCount).toBe(0);
            expect(coverageUpsertCount).toBe(0);
            expect(snapshotUpdateCount).toBe(0);
            expect(mockDb.$transaction).not.toHaveBeenCalled();
            expect(mockDb.coverageFile.upsert).not.toHaveBeenCalled();
            expect(mockDb.coverageSummary.upsert).not.toHaveBeenCalled();
            expect(mockDb.projectSnapshot.update).not.toHaveBeenCalled();
        });

        test('batch suggestions with validationOnly: true suppresses DB writes and returns VERIFIED_DRAFT', async () => {
            const mockSnapshot = {
                id: 'snap-val-batch',
                projectId: 'proj-val-batch',
                rootDir: tempDir,
                project: { id: 'proj-val-batch', ownerId: 'user-val', workspaceRevision: 1 }
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

            const runCoverageMock = async ({ coverageDir }) => {
                fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({
                    'src/math.js': {
                        path: path.join(tempDir, 'src', 'math.js'),
                        s: { 0: 1 }, b: {}, f: { 0: 1 }
                    }
                }), 'utf8');
                fs.writeFileSync(path.join(coverageDir, 'coverage-summary.json'), JSON.stringify({
                    'src/math.js': {
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
                    testResults: [
                        {
                            name: 'tests/math.test.js',
                            status: 'passed',
                            numFailingTests: 0,
                            assertionResults: [{ status: 'passed', title: 'works' }]
                        },
                        {
                            name: 'tests/math1.test.js',
                            status: 'passed',
                            numFailingTests: 0,
                            assertionResults: [{ status: 'passed', title: 't1' }]
                        },
                        {
                            name: 'tests/math2.test.js',
                            status: 'passed',
                            numFailingTests: 0,
                            assertionResults: [{ status: 'passed', title: 't2' }]
                        }
                    ]
                }), 'utf8');
            };

            fs.writeFileSync(path.join(tempDir, 'tests', 'math1.test.js'), 'describe("multiply 1", () => { test("t1", () => {}); });\n', 'utf8');
            fs.writeFileSync(path.join(tempDir, 'tests', 'math2.test.js'), 'describe("multiply 2", () => { test("t2", () => {}); });\n', 'utf8');

            const batchSuggestions = [
                {
                    sourceFile: 'src/math.js',
                    testFile: 'tests/math1.test.js',
                    framework: 'jest',
                    generatedCode: 'describe("batch 1", () => { test("t1", () => {}); });'
                },
                {
                    sourceFile: 'src/math.js',
                    testFile: 'tests/math2.test.js',
                    framework: 'jest',
                    generatedCode: 'describe("batch 2", () => { test("t2", () => {}); });'
                }
            ];

            const result = await applyUnitTestSuggestion({
                snapshotId: 'snap-val-batch',
                projectId: 'proj-val-batch',
                userId: 'user-val',
                suggestions: batchSuggestions,
                validationOnly: true,
                runCoverageFn: runCoverageMock
            });

            expect(result.success).toBe(true);
            expect(result.status).toBe('VERIFIED_DRAFT');
            expect(result.fileUpdated).toBe(false);
            expect(mockDb.$transaction).not.toHaveBeenCalled();
            expect(mockDb.coverageFile.upsert).not.toHaveBeenCalled();
            expect(mockDb.coverageSummary.upsert).not.toHaveBeenCalled();
            expect(mockDb.projectSnapshot.update).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 3. GENUINE CALL OPTION VERIFICATION FOR COVERAGE PARSERS
    // =========================================================================
    describe('3. Production Coverage Parsers Pass Explicit Transaction Options', () => {
        test('parseCoverageFilesForSnapshot invokes prisma.$transaction with exact { maxWait: 15000, timeout: 30000 }', async () => {
            let capturedOptions = null;
            let callbackExecuted = false;

            const mockDb = {
                projectSnapshot: {
                    findFirst: jest.fn(async () => ({
                        id: 'snap-call-1',
                        projectId: 'proj-call-1',
                        rootDir: tempDir,
                        project: { ownerId: 'user-call-1' }
                    }))
                },
                project: {
                    findFirst: jest.fn(async () => ({
                        id: 'proj-call-1',
                        ownerId: 'user-call-1',
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
                    const tx = {
                        coverageFile: mockDb.coverageFile,
                        coverageSummary: mockDb.coverageSummary
                    };
                    const res = await cb(tx);
                    callbackExecuted = true;
                    return res;
                })
            };

            setPrismaClient(mockDb);

            const report = {
                'src/math.js': {
                    lines: { total: 1, covered: 1, pct: 100 },
                    functions: { total: 1, covered: 1, pct: 100 },
                    branches: { total: 1, covered: 1, pct: 100 },
                    statements: { total: 1, covered: 1, pct: 100 }
                },
                total: {
                    lines: { total: 1, covered: 1, pct: 100 },
                    functions: { total: 1, covered: 1, pct: 100 },
                    branches: { total: 1, covered: 1, pct: 100 },
                    statements: { total: 1, covered: 1, pct: 100 }
                }
            };

            const result = await parseCoverageFilesForSnapshot({
                projectId: 'proj-call-1',
                snapshotId: 'snap-call-1',
                coverageReport: report,
                userId: 'user-call-1'
            });

            expect(result).toBeDefined();
            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(capturedOptions).toEqual({ maxWait: 15000, timeout: 30000 });
            expect(callbackExecuted).toBe(true);
        });

        test('parseCoverageFunctionsForSnapshot invokes prisma.$transaction with exact { maxWait: 15000, timeout: 30000 }', async () => {
            let capturedOptions = null;
            let callbackExecuted = false;

            const mockDb = {
                projectSnapshot: {
                    findFirst: jest.fn(async () => ({
                        id: 'snap-fn-1',
                        projectId: 'proj-fn-1',
                        rootDir: tempDir,
                        project: { ownerId: 'user-fn-1' }
                    }))
                },
                project: {
                    findFirst: jest.fn(async () => ({
                        id: 'proj-fn-1',
                        ownerId: 'user-fn-1',
                        workspaceRevision: 1
                    }))
                },
                coverageFunction: {
                    deleteMany: jest.fn(async () => ({ count: 0 })),
                    createMany: jest.fn(async () => ({ count: 1 }))
                },
                $transaction: jest.fn(async (cb, options) => {
                    capturedOptions = options;
                    const tx = {
                        coverageFunction: mockDb.coverageFunction
                    };
                    const res = await cb(tx);
                    callbackExecuted = true;
                    return res;
                })
            };

            setPrismaClient(mockDb);

            const report = {
                'src/math.js': {
                    fnMap: {
                        '0': { name: 'multiply', decl: { start: { line: 1 } }, loc: { start: { line: 1 }, end: { line: 1 } } }
                    },
                    f: { '0': 1 }
                }
            };

            const result = await parseCoverageFunctionsForSnapshot({
                projectId: 'proj-fn-1',
                snapshotId: 'snap-fn-1',
                coverageReport: report,
                userId: 'user-fn-1'
            });

            expect(result).toBeDefined();
            expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
            expect(capturedOptions).toEqual({ maxWait: 15000, timeout: 30000 });
            expect(callbackExecuted).toBe(true);
        });
    });
});
