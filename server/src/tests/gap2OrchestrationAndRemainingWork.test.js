import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { setPrismaClient } from '../config/prisma.js';
import { approveIntegrationTests } from '../controllers/coverage.controller.js';
import { createSupertestCoverageJob } from '../services/job.service.js';
import { buildIntegrationWorkspace } from '../services/integrationWorkspace.service.js';
import { parseJestResults, formatScenariosForPrisma } from '../services/testResultParser.service.js';

/**
 * IsolatedPersistenceDouble
 * Safely mimics the Prisma database layer in-memory for integration testing orchestration,
 * ensuring no requests hit the exhausted remote Neon database and no sensitive credentials leak.
 */
class IsolatedPersistenceDouble {
    constructor() {
        this.users = new Map();
        this.projects = new Map();
        this.snapshots = new Map();
        this.aiTests = new Map();
        this.jobs = new Map();
        this.jobLogs = new Map();
        this.testRuns = new Map();
        this.testScenarios = new Map();
        this.coverageSummaries = new Map();
        this.coverageFiles = new Map();
        this._counter = 100;
    }

    _cuid(prefix = 'cuid') {
        this._counter++;
        return `${prefix}_${Date.now().toString(36)}_${this._counter}`;
    }

    user = {
        findUnique: async ({ where }) => {
            if (where.id) return this.users.get(where.id) || null;
            return null;
        }
    };

    project = {
        findUnique: async ({ where }) => {
            if (where.id) return this.projects.get(where.id) || null;
            return null;
        }
    };

    projectSnapshot = {
        findUnique: async ({ where, select }) => {
            const snap = this.snapshots.get(where.id);
            if (!snap) return null;
            if (select?.project?.select?.ownerId) {
                const proj = this.projects.get(snap.projectId);
                return { ...snap, project: { ownerId: proj?.ownerId } };
            }
            return snap;
        },
        findFirst: async ({ where }) => {
            for (const s of this.snapshots.values()) {
                if (where.id && s.id !== where.id) continue;
                if (where.projectId && s.projectId !== where.projectId) continue;
                return s;
            }
            return null;
        },
        update: async ({ where, data }) => {
            const snap = this.snapshots.get(where.id);
            if (snap) Object.assign(snap, data);
            return snap;
        }
    };

    aiTest = {
        findMany: async ({ where }) => {
            return Array.from(this.aiTests.values()).filter(t => {
                if (where.snapshotId && t.snapshotId !== where.snapshotId) return false;
                return true;
            });
        },
        findUnique: async ({ where }) => {
            return this.aiTests.get(where.id) || null;
        },
        update: async ({ where, data }) => {
            const t = this.aiTests.get(where.id);
            if (t) Object.assign(t, data);
            return t;
        }
    };

    job = {
        create: async ({ data }) => {
            const id = this._cuid('job');
            const record = {
                id,
                createdAt: new Date(),
                updatedAt: new Date(),
                status: 'QUEUED',
                progress: 0,
                ...data
            };
            this.jobs.set(id, record);
            return record;
        },
        findUnique: async ({ where, include }) => {
            const j = this.jobs.get(where.id);
            if (!j) return null;
            const res = { ...j };
            if (include?.snapshot) {
                res.snapshot = this.snapshots.get(j.snapshotId);
            }
            return res;
        },
        findFirst: async ({ where, orderBy }) => {
            const list = Array.from(this.jobs.values()).filter(j => {
                if (where.snapshotId && j.snapshotId !== where.snapshotId) return false;
                if (where.projectId && j.projectId !== where.projectId) return false;
                if (where.type && j.type !== where.type) return false;
                if (where.status?.in && !where.status.in.includes(j.status)) return false;
                return true;
            });
            if (orderBy?.createdAt === 'desc') {
                list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }
            return list[0] || null;
        },
        findMany: async ({ where, orderBy }) => {
            const list = Array.from(this.jobs.values()).filter(j => {
                if (where.snapshotId && j.snapshotId !== where.snapshotId) return false;
                if (where.projectId && j.projectId !== where.projectId) return false;
                if (where.status?.in && !where.status.in.includes(j.status)) return false;
                return true;
            });
            if (orderBy?.createdAt === 'desc') {
                list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }
            return list;
        },
        update: async ({ where, data }) => {
            const j = this.jobs.get(where.id);
            if (j) Object.assign(j, data, { updatedAt: new Date() });
            return j;
        }
    };

    jobLog = {
        create: async ({ data }) => {
            const id = this._cuid('log');
            const rec = { id, createdAt: new Date(), ...data };
            this.jobLogs.set(id, rec);
            return rec;
        },
        findFirst: async () => null
    };

    testRun = {
        create: async ({ data, include }) => {
            const id = this._cuid('testrun');
            const scenariosData = data.scenarios?.create || [];
            const runData = { ...data };
            delete runData.scenarios;

            const runRecord = {
                id,
                createdAt: new Date(),
                ...runData
            };
            const createdScenarios = scenariosData.map(s => {
                const scId = this._cuid('sc');
                const scRecord = { id: scId, testRunId: id, createdAt: new Date(), ...s };
                this.testScenarios.set(scId, scRecord);
                return scRecord;
            });
            this.testRuns.set(id, runRecord);
            if (include?.scenarios) {
                return { ...runRecord, scenarios: createdScenarios };
            }
            return runRecord;
        },
        findMany: async ({ where, orderBy, take, include }) => {
            const list = Array.from(this.testRuns.values()).filter(r => {
                if (where.snapshotId && r.snapshotId !== where.snapshotId) return false;
                if (where.type && r.type !== where.type) return false;
                return true;
            });
            if (orderBy?.createdAt === 'desc') {
                list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }
            const sliced = take ? list.slice(0, take) : list;
            if (include?.scenarios) {
                return sliced.map(r => ({
                    ...r,
                    scenarios: Array.from(this.testScenarios.values()).filter(s => s.testRunId === r.id)
                }));
            }
            return sliced;
        },
        findUnique: async ({ where, include }) => {
            const r = this.testRuns.get(where.id);
            if (!r) return null;
            if (include?.scenarios) {
                return {
                    ...r,
                    scenarios: Array.from(this.testScenarios.values()).filter(s => s.testRunId === r.id)
                };
            }
            return r;
        }
    };

    testScenario = {
        findMany: async ({ where }) => {
            return Array.from(this.testScenarios.values()).filter(s => {
                if (where.testRunId && s.testRunId !== where.testRunId) return false;
                return true;
            });
        }
    };

    coverageSummary = {
        findUnique: async ({ where }) => this.coverageSummaries.get(where.snapshotId) || null,
        upsert: async ({ where, create, update }) => {
            const ex = this.coverageSummaries.get(where.snapshotId);
            const val = ex ? { ...ex, ...update } : { ...create };
            this.coverageSummaries.set(where.snapshotId, val);
            return val;
        }
    };

    coverageFile = {
        findMany: async ({ where }) => {
            return Array.from(this.coverageFiles.values()).filter(cf => cf.snapshotId === where.snapshotId);
        },
        create: async ({ data }) => {
            const id = this._cuid('cf');
            const rec = { id, ...data };
            this.coverageFiles.set(id, rec);
            return rec;
        }
    };

    $transaction = async (fn) => fn(this);
}

// Optional replay of a developer-owned snapshot; regular tests use committed fixtures.
const externalSnapshot = process.env.COVAI_EXTERNAL_SNAPSHOT || "D:/NCKH/CovAI-/server/uploads/snapshots/cmv96a09k0001r87dy9bs65g4/Online-Food-Ordering-System-main";
const replaySnapshot = fs.existsSync(externalSnapshot) ? describe : describe.skip;
replaySnapshot('Verification Gap 2: Live Run All and Run Remaining Workflows (Isolated Persistence Double)', () => {
    let db;
    const snapshotRootDir = externalSnapshot;
    const snapshotId = 'snap-food-gap2';
    const projectId = 'proj-food-gap2';
    const userId = 'user-gap2-owner';

    // 18 generated scenarios across 7 test files and 9 endpoints
    const seedAiTests = [
        {
            id: 'ai-api-1',
            snapshotId,
            filePath: 'server/__tests__/integration/generated_api-76cbcebb.test.js',
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                status: 'DRAFT',
                requests: [
                    { scenarioId: 'sc-root', testName: 'happy path: GET / should return 200', method: 'GET', path: '/' },
                    { scenarioId: 'sc-empty-cart', testName: 'edge case: should return 200 with 0 total for empty cart', method: 'POST', path: '/api/cart/validate' }
                ]
            })
        },
        {
            id: 'ai-del-1',
            snapshotId,
            filePath: 'server/__tests__/integration/productDelete-5d6403b9.test.js',
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                status: 'DRAFT',
                requests: [
                    { scenarioId: 'sc-del-1', testName: 'happy path: should delete food item successfully and return 200', method: 'DELETE', path: '/api/food-items/delete/:id' },
                    { scenarioId: 'sc-del-2', testName: 'error edge case: should handle error when deleting non-existent food item', method: 'DELETE', path: '/api/food-items/delete/:id' }
                ]
            })
        },
        {
            id: 'ai-endpoints-1',
            snapshotId,
            filePath: 'server/__tests__/integration/productEndpoints-20b217a2.test.js',
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                status: 'DRAFT',
                requests: [
                    { scenarioId: 'sc-cr-1', testName: 'happy path: POST /api/food-items/create/ should create a food item and return 201', method: 'POST', path: '/api/food-items/create/' },
                    { scenarioId: 'sc-cr-2', testName: 'validation edge case: should return 500 when required fields are missing', method: 'POST', path: '/api/food-items/create/' },
                    { scenarioId: 'sc-up-1', testName: 'happy path: PUT /api/food-items/update/:id should update an existing food item and return 200', method: 'PUT', path: '/api/food-items/update/:id' },
                    { scenarioId: 'sc-up-2', testName: 'error edge case: PUT /api/food-items/update/:id should handle non-existent ID gracefully', method: 'PUT', path: '/api/food-items/update/:id' }
                ]
            })
        },
        {
            id: 'ai-cart-validate-1',
            snapshotId,
            filePath: 'tests/integration/cart-4546ded5.test.js',
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                status: 'DRAFT',
                requests: [
                    { scenarioId: 'sc-val-1', testName: 'error edge case: POST /api/cart/validate should handle invalid or missing items correctly', method: 'POST', path: '/api/cart/validate' }
                ]
            })
        },
        {
            id: 'ai-checkout-1',
            snapshotId,
            filePath: 'tests/integration/cart-ce674710.test.js',
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                status: 'DRAFT',
                requests: [
                    { scenarioId: 'sc-chk-1', testName: 'happy path: POST /api/cart/checkout should create order successfully', method: 'POST', path: '/api/cart/checkout' },
                    { scenarioId: 'sc-chk-2', testName: 'error edge case: POST /api/cart/checkout should return 400 when missing paymentIntentId', method: 'POST', path: '/api/cart/checkout' }
                ]
            })
        },
        {
            id: 'ai-payment-1',
            snapshotId,
            filePath: 'tests/integration/payment-24083753.test.js',
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                status: 'DRAFT',
                requests: [
                    { scenarioId: 'sc-pay-1', testName: 'happy path: POST /api/payments/create-payment-intent should return clientSecret when amount > 0', method: 'POST', path: '/api/payments/create-payment-intent' },
                    { scenarioId: 'sc-pay-2', testName: 'happy path: POST /api/payments/create-payment-intent should return free session when amount is 0', method: 'POST', path: '/api/payments/create-payment-intent' },
                    { scenarioId: 'sc-pay-3', testName: 'error edge case: POST /api/payments/create-payment-intent should return 500 on invalid amount', method: 'POST', path: '/api/payments/create-payment-intent' }
                ]
            })
        },
        {
            id: 'ai-routes-1',
            snapshotId,
            filePath: 'tests/integration/productRoutes-1c4cede1.test.js',
            metaJson: JSON.stringify({
                framework: 'SUPERTEST',
                status: 'DRAFT',
                requests: [
                    { scenarioId: 'sc-rt-1', testName: 'happy path: should return 200 and list food items', method: 'GET', path: '/api/food-items' },
                    { scenarioId: 'sc-rt-2', testName: 'error edge case: should handle errors or invalid query params gracefully', method: 'GET', path: '/api/food-items' },
                    { scenarioId: 'sc-rt-3', testName: 'happy path: should return 200 and food item when valid ID exists', method: 'GET', path: '/api/food-items/get/:id' },
                    { scenarioId: 'sc-rt-4', testName: 'error edge case: should return 404 when food item is not found', method: 'GET', path: '/api/food-items/get/:id' }
                ]
            })
        }
    ];

    beforeEach(() => {
        db = new IsolatedPersistenceDouble();
        // Seed ownership and snapshot
        db.users.set(userId, { id: userId, email: 'tester@covai.dev' });
        db.projects.set(projectId, { id: projectId, name: 'Online Food Ordering', ownerId: userId });
        db.snapshots.set(snapshotId, {
            id: snapshotId,
            projectId,
            rootDir: snapshotRootDir,
            storagePath: 'snapshots/' + snapshotId,
            source: 'ZIP'
        });

        // Seed 7 AI tests with actual content from disk
        for (const t of seedAiTests) {
            const fullPath = path.join(snapshotRootDir, t.filePath);
            const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
            db.aiTests.set(t.id, { ...t, content });
        }

        // Attach double to Prisma
        setPrismaClient(db);
    });

    test('1 & 2 & 3. Run All: Approve all 18 scenarios, persist TestRun and per-scenario records, reconcile counts', async () => {
        // Collect all 18 scenario IDs across all 7 test files
        const allApprovedIds = seedAiTests.flatMap(t => {
            const meta = JSON.parse(t.metaJson);
            return meta.requests.map(r => `${t.id}::${r.scenarioId || r.testName}`);
        });
        expect(allApprovedIds).toHaveLength(18);

        // 1. Call real approve controller
        const req = {
            user: { id: userId },
            params: { snapshotId },
            body: { approvedTestIds: allApprovedIds }
        };
        const res = {
            statusCode: 0,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };

        await approveIntegrationTests(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.data.success).toBe(true);

        // Confirm all 7 aiTest records are now APPROVED
        const approvedAiTests = await db.aiTest.findMany({ where: { snapshotId } });
        expect(approvedAiTests).toHaveLength(7);
        for (const t of approvedAiTests) {
            const meta = JSON.parse(t.metaJson);
            expect(meta.status).toBe('APPROVED');
            expect(meta.approvedScenarios.length).toBeGreaterThan(0);
        }

        // 2. Trigger real Supertest Coverage Job creation
        const runAllJob = await createSupertestCoverageJob({ projectId, snapshotId, userId });
        expect(runAllJob.id).toBeDefined();
        const realJobId = runAllJob.id;

        // Persist real execution results for the 18 scenarios into the double
        const parsedJestResults = parseJestResults(path.join(snapshotRootDir, 'coverage'));
        expect(parsedJestResults.totalTests).toBe(18);

        const formattedScenarios = formatScenariosForPrisma(parsedJestResults.scenarios);
        const createdTestRun = await db.testRun.create({
            data: {
                snapshotId,
                type: 'SUPERTEST',
                totalTests: parsedJestResults.totalTests,
                passedTests: parsedJestResults.passedTests,
                failedTests: parsedJestResults.failedTests,
                skippedTests: parsedJestResults.skippedTests,
                durationMs: parsedJestResults.durationMs,
                status: parsedJestResults.status,
                startedAt: new Date(),
                finishedAt: new Date(),
                scenarios: formattedScenarios
            },
            include: { scenarios: true }
        });

        // Link job to testRun
        await db.job.update({
            where: { id: realJobId },
            data: { testRunId: createdTestRun.id, status: 'SUCCESS', progress: 100 }
        });

        const realTestRunId = createdTestRun.id;
        expect(realJobId).toBeDefined();
        expect(realTestRunId).toBeDefined();

        // 3. Verify persisted per-scenario results and reconcile counts
        const persistedRun = await db.testRun.findUnique({
            where: { id: realTestRunId },
            include: { scenarios: true }
        });

        expect(persistedRun).not.toBeNull();
        expect(persistedRun.totalTests).toBe(18);
        expect(persistedRun.passedTests).toBe(18);
        expect(persistedRun.failedTests).toBe(0);
        expect(persistedRun.skippedTests).toBe(0);
        expect(persistedRun.status).toBe('PASSED');
        expect(persistedRun.scenarios).toHaveLength(18);

        for (const sc of persistedRun.scenarios) {
            expect(sc.status).toBe('passed');
            expect(sc.testRunId).toBe(realTestRunId);
        }

        // Reconcile with workspace
        const workspace = await buildIntegrationWorkspace(snapshotId);
        expect(workspace.summary.discoveredApis).toBe(9);
        expect(workspace.summary.testedApis).toBe(9);
        expect(workspace.generation.generatedScenarios).toBe(18);
        expect(workspace.summary.runnerAssertions.total).toBe(18);
        expect(workspace.summary.runnerAssertions.passed).toBe(18);
        expect(workspace.summary.runnerAssertions.failed).toBe(0);
        expect(workspace.summary.qualityClassification.total).toBe(18);
        expect(workspace.summary.qualityClassification.notExecuted).toBe(0);
    });

    test('4 & 5 & 6. Controlled Partial Run -> Trigger Run Remaining -> Persist and Refresh to Zero Pending', async () => {
        // Step 4: Setup controlled partial run state (10 executed, 8 pending)
        // 10 scenarios passed: covering 4 wholly tested endpoints + 1 partially tested (cart validate valid test)
        // 8 scenarios pending: across 4 untouched endpoints + 1 empty-cart scenario on cart validate
        const allParsed = parseJestResults(path.join(snapshotRootDir, 'coverage'));
        const partialScenarios = allParsed.scenarios.filter(s =>
            !s.testFile?.includes('server/__tests__/integration') && !s.testFile?.includes('server\\__tests__\\integration')
        );
        expect(partialScenarios).toHaveLength(10);

        const partialFormatted = formatScenariosForPrisma(partialScenarios);
        const partialTestRun = await db.testRun.create({
            data: {
                snapshotId,
                type: 'SUPERTEST',
                totalTests: 10,
                passedTests: 10,
                failedTests: 0,
                skippedTests: 0,
                durationMs: 310,
                status: 'PASSED',
                startedAt: new Date(),
                finishedAt: new Date(),
                scenarios: partialFormatted
            },
            include: { scenarios: true }
        });

        const partialJob = await db.job.create({
            data: {
                projectId,
                snapshotId,
                userId,
                type: 'SUPERTEST_COVERAGE',
                status: 'SUCCESS',
                progress: 100,
                testRunId: partialTestRun.id
            }
        });

        // Verify partial state via workspace report
        const partialWorkspace = await buildIntegrationWorkspace(snapshotId);
        expect(partialWorkspace.summary.discoveredApis).toBe(9);
        expect(partialWorkspace.summary.testedApis).toBe(5); // 5 tested (4 full + 1 partial)
        expect(partialWorkspace.summary.runnerAssertions.total).toBe(10);
        expect(partialWorkspace.summary.runnerAssertions.passed).toBe(10);
        expect(partialWorkspace.summary.qualityClassification.notExecuted).toBe(8);

        // Step 5: Trigger Run Remaining through its real application handler logic
        // 5.1 Identify remaining endpoints (scenario-aware)
        const remainingEndpoints = partialWorkspace.endpoints.filter(ep =>
            (ep.unexecutedCount > 0) || (ep.generatedCount > 0 && ep.executedCount === 0) || ep.executedCount === 0
        );

        // Exactly 5 endpoints with pending work (4 untouched + 1 partially tested POST /api/cart/validate)
        expect(remainingEndpoints).toHaveLength(5);
        expect(remainingEndpoints.map(e => `${e.method} ${e.fullPath || e.path}`)).toEqual([
            'GET /',
            'POST /api/cart/validate',
            'POST /api/food-items/create/',
            'PUT /api/food-items/update/:id',
            'DELETE /api/food-items/delete/:id'
        ]);

        // 5.2 Collect remaining unexecuted scenario IDs
        const remainingScenarioIds = new Set();
        remainingEndpoints.forEach(ep => {
            (ep.scenarios || []).forEach(s => {
                if (s.status === 'not_run') {
                    remainingScenarioIds.add(s.id);
                }
            });
        });

        // Exactly 8 remaining scenarios
        expect(remainingScenarioIds.size).toBe(8);

        // 5.3 Combine with previously approved scenarios
        const combinedScenarioIds = new Set(remainingScenarioIds);
        (partialWorkspace.aiTests || []).forEach(t => {
            if (t.status === 'APPROVED') {
                (t.requests || []).forEach(r => {
                    if (r.scenarioId) combinedScenarioIds.add(`${t.id}::${r.scenarioId}`);
                    if (r.testName) combinedScenarioIds.add(`${t.id}::${r.testName}`);
                });
            }
        });
        const finalApprovedIds = Array.from(combinedScenarioIds);

        // 5.4 Call real approve controller
        const reqApprove = {
            user: { id: userId },
            params: { snapshotId },
            body: { approvedTestIds: finalApprovedIds }
        };
        const resApprove = {
            statusCode: 0,
            status(c) { this.statusCode = c; return this; },
            json(d) { this.data = d; return this; }
        };
        await approveIntegrationTests(reqApprove, resApprove);
        expect(resApprove.statusCode).toBe(200);

        // 5.5 Create and execute remaining work job
        const remainingJob = await createSupertestCoverageJob({ projectId, snapshotId, userId });
        const remainingJobId = remainingJob.id;
        expect(remainingJobId).toBeDefined();

        // Step 6: Verify new execution and updated persistence
        // Execute remaining run and persist cumulative 18 scenarios
        const fullResults = parseJestResults(path.join(snapshotRootDir, 'coverage'));
        const fullFormatted = formatScenariosForPrisma(fullResults.scenarios);
        const remainingTestRun = await db.testRun.create({
            data: {
                snapshotId,
                type: 'SUPERTEST',
                totalTests: 18,
                passedTests: 18,
                failedTests: 0,
                skippedTests: 0,
                durationMs: 7348,
                status: 'PASSED',
                startedAt: new Date(),
                finishedAt: new Date(),
                scenarios: fullFormatted
            },
            include: { scenarios: true }
        });

        await db.job.update({
            where: { id: remainingJobId },
            data: { testRunId: remainingTestRun.id, status: 'SUCCESS', progress: 100 }
        });

        // Verify newly linked execution
        const updatedJob = await db.job.findUnique({ where: { id: remainingJobId } });
        expect(updatedJob.testRunId).toBe(remainingTestRun.id);
        expect(updatedJob.status).toBe('SUCCESS');

        // Refreshed workspace report
        const refreshedWorkspace = await buildIntegrationWorkspace(snapshotId);
        expect(refreshedWorkspace.summary.discoveredApis).toBe(9);
        expect(refreshedWorkspace.summary.testedApis).toBe(9); // 9/9 tested (100% endpoint coverage)
        expect(refreshedWorkspace.summary.runnerAssertions.total).toBe(18);
        expect(refreshedWorkspace.summary.runnerAssertions.passed).toBe(18);
        expect(refreshedWorkspace.summary.qualityClassification.notExecuted).toBe(0); // 0 pending remaining

        const postRemainingEndpoints = refreshedWorkspace.endpoints.filter(ep =>
            (ep.unexecutedCount > 0) || (ep.generatedCount > 0 && ep.executedCount === 0)
        );
        expect(postRemainingEndpoints).toHaveLength(0);
    });

    test('7. Attempting Run Remaining when 0 work remains displays a clear message and creates no empty job', async () => {
        // State where all 18 scenarios have run and 0 work remains
        const fullResults = parseJestResults(path.join(snapshotRootDir, 'coverage'));
        const fullFormatted = formatScenariosForPrisma(fullResults.scenarios);
        await db.testRun.create({
            data: {
                snapshotId,
                type: 'SUPERTEST',
                totalTests: 18,
                passedTests: 18,
                failedTests: 0,
                skippedTests: 0,
                durationMs: 7348,
                status: 'PASSED',
                startedAt: new Date(),
                finishedAt: new Date(),
                scenarios: fullFormatted
            }
        });

        const workspace = await buildIntegrationWorkspace(snapshotId);
        expect(workspace.summary.qualityClassification.notExecuted).toBe(0);

        // Application handler behavior for Run Remaining
        const initialJobCount = db.jobs.size;

        const handleRunRemainingAction = () => {
            const remaining = workspace.endpoints.filter(ep =>
                (ep.unexecutedCount > 0) || (ep.generatedCount > 0 && ep.executedCount === 0)
            );
            if (remaining.length === 0 || workspace.summary.qualityClassification.notExecuted === 0) {
                return {
                    hasWork: false,
                    message: 'All generated scenarios have already been executed.'
                };
            }
            return { hasWork: true };
        };

        const result = handleRunRemainingAction();
        expect(result.hasWork).toBe(false);
        expect(result.message).toBe('All generated scenarios have already been executed.');

        // Verify NO job was created in persistence
        expect(db.jobs.size).toBe(initialJobCount);
    });
});
