/**
 * simulationRoutes.test.js
 *
 * Comprehensive Integration Test Suite for Unit Test Execution Simulation Endpoints
 * Verifies:
 * 1. GET /api/coverage/:snapshotId/simulation/sources (200 with source files, functions, test cases, virtual scenarios)
 * 2. POST /api/coverage/:snapshotId/simulation/trace (200 with discrete steps, branches, mocks, assertions)
 * 3. 400 Bad Request validation when sourceFilePath is omitted from POST /simulation/trace
 * 4. 404 Not Found when non-existent snapshotId is queried
 * 5. In-memory simulation with inline testCode and sourceCode (zero disk writes)
 * 6. Storage Immutability Guard (strictly 0 disk writes to storage/ or uploads/)
 * 7. Controller unit-level edge cases and error handling (next(err) and missing snapshotId)
 * 8. Client service integration contracts (getUnitTestSimulationSources, getUnitTestSimulationTrace)
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Mocks Setup ──────────────────────────────────────────────────────────────

const mockPrisma = {
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn()
    },
    project: {
        findUnique: jest.fn(),
        findFirst: jest.fn()
    },
    projectMember: {
        findUnique: jest.fn(),
        findFirst: jest.fn()
    }
};

await jest.unstable_mockModule('../config/prisma.js', () => ({
    default: mockPrisma
}));

await jest.unstable_mockModule('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req, res, next) => {
        req.user = { id: 'test-user-id', email: 'tester@example.com' };
        next();
    }
}));

if (typeof global.localStorage === "undefined") {
    global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
}

await jest.unstable_mockModule('../../../client/src/hooks/useCoverageQuery.js', () => ({
    invalidateCoverageQueries: jest.fn()
}));


// Import routes and controllers after mocks
const coverageRoute = (await import('../routes/coverage.route.js')).default;
const {
    getSimulationSources,
    getSimulationTrace
} = await import('../controllers/coverage.controller.js');

// Setup Express App
const app = express();
app.use(express.json());
app.use('/api/coverage', coverageRoute);

// Express Error Handler for unhandled errors
app.use((err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

describe('Milestone 2: Simulation Endpoints & Client Service Integration', () => {
    let tempDir;
    const validSnapshotId = 'snap-valid-123';
    const validProjectId = 'proj-valid-456';
    const nonExistentSnapshotId = 'snap-non-existent-999';

    // Snapshot storage state before running tests
    let initialStorageState = [];
    const getStorageListing = () => {
        const root = process.cwd();
        const targets = [
            path.join(root, 'storage'),
            path.join(root, 'uploads'),
            path.join(root, 'server', 'storage'),
            path.join(root, 'server', 'uploads')
        ];
        const files = [];
        for (const dir of targets) {
            if (fs.existsSync(dir)) {
                try {
                    const entries = fs.readdirSync(dir, { recursive: true });
                    files.push(...entries.map(e => path.join(dir, String(e))));
                } catch (_) {}
            }
        }
        return files.sort();
    };

    beforeAll(() => {
        initialStorageState = getStorageListing();
    });

    afterAll(() => {
        const finalStorageState = getStorageListing();
        expect(finalStorageState).toEqual(initialStorageState);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-sim-routes-'));

        // Seed project fixture files in tempDir
        const servicesDir = path.join(tempDir, 'src', 'services');
        fs.mkdirSync(servicesDir, { recursive: true });

        // 1. Tested business logic file
        const calcSource = `
export function calculateDiscount(price, userType) {
    if (price <= 0) {
        throw new Error("Invalid price");
    }
    if (userType === "VIP") {
        return price * 0.8;
    }
    return price * 0.95;
}

export function internalBonus(points) {
    if (points > 100) {
        return points * 2;
    }
    return points;
}
`;
        fs.writeFileSync(path.join(servicesDir, 'calculator.service.js'), calcSource, 'utf8');

        // Associated test file
        const calcTest = `
import { calculateDiscount } from './calculator.service';

describe('Calculator Service', () => {
    it('applies VIP discount for VIP users', () => {
        const result = calculateDiscount(100, 'VIP');
        expect(result).toBe(80);
    });

    it('throws error on non-positive price', () => {
        expect(() => calculateDiscount(-10, 'VIP')).toThrow();
    });
});
`;
        fs.writeFileSync(path.join(servicesDir, 'calculator.service.test.js'), calcTest, 'utf8');

        // 2. Untested business logic file (virtual scenario synthesis)
        const orderServiceSource = `
export function processOrder(order) {
    if (!order) {
        return null;
    }
    if (order.status === "PAID") {
        return "PROCESSING";
    }
    return "PENDING";
}
`;
        fs.writeFileSync(path.join(servicesDir, 'order.service.js'), orderServiceSource, 'utf8');

        // Configure default Prisma mock behaviors for valid snapshot
        mockPrisma.projectSnapshot.findFirst.mockImplementation(async ({ where }) => {
            if (where?.id === validSnapshotId || where?.projectId === validProjectId) {
                return {
                    id: validSnapshotId,
                    projectId: validProjectId,
                    rootDir: tempDir
                };
            }
            return null;
        });

        mockPrisma.project.findFirst.mockImplementation(async ({ where }) => {
            if (where?.id === validProjectId) {
                return {
                    id: validProjectId,
                    ownerId: 'test-user-id'
                };
            }
            return null;
        });

        mockPrisma.projectSnapshot.findUnique.mockImplementation(async ({ where }) => {
            if (where?.id === validSnapshotId) {
                return {
                    id: validSnapshotId,
                    projectId: validProjectId,
                    rootDir: tempDir,
                    project: {
                        id: validProjectId,
                        ownerId: 'test-user-id'
                    }
                };
            }
            return null;
        });
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // =========================================================================
    // 1. GET /api/coverage/:snapshotId/simulation/sources
    // =========================================================================

    describe('GET /api/coverage/:snapshotId/simulation/sources', () => {
        it('returns 200 with source files, functions, tests, and synthesized virtual scenarios', async () => {
            const res = await request(app)
                .get(`/api/coverage/${validSnapshotId}/simulation/sources`)
                .expect('Content-Type', /json/)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();

            const { sourceFiles, totalFiles, snapshotId } = res.body.data;
            expect(snapshotId).toBe(validSnapshotId);
            expect(totalFiles).toBeGreaterThanOrEqual(2);
            expect(Array.isArray(sourceFiles)).toBe(true);

            // Verify calculator.service.js record
            const calcFile = sourceFiles.find(f => f.fileName === 'calculator.service.js');
            expect(calcFile).toBeDefined();
            expect(calcFile.isBusinessLogic).toBe(true);
            expect(calcFile.functions.length).toBeGreaterThanOrEqual(1);

            const calcFn = calcFile.functions.find(fn => fn.name === 'calculateDiscount');
            expect(calcFn).toBeDefined();
            expect(calcFn.startLine).toBeGreaterThan(0);
            expect(calcFn.endLine).toBeGreaterThanOrEqual(calcFn.startLine);
            expect(Array.isArray(calcFn.params)).toBe(true);

            // Verify associated tests
            expect(calcFile.availableTests.length).toBeGreaterThanOrEqual(1);
            const testFile = calcFile.availableTests[0];
            expect(testFile.fileName).toBe('calculator.service.test.js');
            expect(testFile.testCases.length).toBeGreaterThanOrEqual(2);
            expect(testFile.testCases[0].title).toContain('VIP');

            // Verify order.service.js virtual scenarios
            const orderFile = sourceFiles.find(f => f.fileName === 'order.service.js');
            expect(orderFile).toBeDefined();
            expect(orderFile.virtualScenariosCount).toBeGreaterThan(0);
            expect(Array.isArray(orderFile.virtualScenarios)).toBe(true);
            expect(orderFile.virtualScenarios[0].isVirtual).toBe(true);
        });

        it('supports filePath filtering query parameter', async () => {
            const res = await request(app)
                .get(`/api/coverage/${validSnapshotId}/simulation/sources?filePath=src/services/calculator.service.js`)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.sourceFiles.length).toBe(1);
            expect(res.body.data.sourceFiles[0].fileName).toBe('calculator.service.js');
        });
    });

    // =========================================================================
    // 2. POST /api/coverage/:snapshotId/simulation/trace
    // =========================================================================

    describe('POST /api/coverage/:snapshotId/simulation/trace', () => {
        it('returns 200 with discrete simulation steps, branch evaluations, and assertions for on-disk files', async () => {
            const payload = {
                sourceFilePath: 'src/services/calculator.service.js',
                testFilePath: 'src/services/calculator.service.test.js',
                functionName: 'calculateDiscount',
                testCaseTitle: 'applies VIP discount for VIP users'
            };

            const res = await request(app)
                .post(`/api/coverage/${validSnapshotId}/simulation/trace`)
                .send(payload)
                .expect('Content-Type', /json/)
                .expect(200);

            expect(res.body.success).toBe(true);
            const trace = res.body.data;
            expect(trace).toBeDefined();
            expect(trace.sourceFilePath).toBe('src/services/calculator.service.js');
            expect(Array.isArray(trace.steps)).toBe(true);
            expect(trace.steps.length).toBeGreaterThanOrEqual(3);

            // Verify 7-Step Taxonomy structure across steps
            const stepPhases = trace.steps.map(s => s.phase);
            expect(stepPhases).toContain('CALL_ENTRY');

            // Verify educationalGuidance
            for (const step of trace.steps) {
                expect(step.educationalGuidance).toBeDefined();
                expect(step.educationalGuidance.category).toBeDefined();
                expect(step.educationalGuidance.stepNarrative).toBeTruthy();
                expect(step.educationalGuidance.developerTakeaway).toBeTruthy();
                expect(typeof step.line).toBe('number');
                expect(step.codeSnippet).toBeTruthy();
            }

            // Verify summary
            expect(trace.summary).toBeDefined();
            expect(trace.summary.totalSteps).toBe(trace.steps.length);
        });

        it('executes in-memory simulation with inline testCode and sourceCode (zero disk writes)', async () => {
            const inlinePayload = {
                sourceFilePath: 'virtual/math.service.js',
                sourceCode: `
export function divideNumbers(a, b) {
    if (b === 0) {
        throw new Error("Division by zero");
    }
    return a / b;
}
`,
                testCode: `
import { divideNumbers } from './math.service';

describe('Math Service', () => {
    it('divides numbers accurately', () => {
        const result = divideNumbers(10, 2);
        expect(result).toBe(5);
    });
});
`
            };

            const res = await request(app)
                .post(`/api/coverage/${validSnapshotId}/simulation/trace`)
                .send(inlinePayload)
                .expect(200);

            expect(res.body.success).toBe(true);
            const trace = res.body.data;
            expect(trace.sourceFilePath).toBe('virtual/math.service.js');
            expect(trace.steps.length).toBeGreaterThanOrEqual(2);

            // Verify assertion outcome in steps
            const assertionStep = trace.steps.find(s => s.phase === 'ASSERTION' || s.assertionResult);
            if (assertionStep) {
                expect(assertionStep.assertionResult).toBeDefined();
                expect(assertionStep.assertionResult.expected).toBe(5);
            }
        });
    });

    // =========================================================================
    // 3. Validation: 400 Bad Request
    // =========================================================================

    describe('Validation (400 Bad Request)', () => {
        it('returns 400 when sourceFilePath is omitted from POST /simulation/trace', async () => {
            const res = await request(app)
                .post(`/api/coverage/${validSnapshotId}/simulation/trace`)
                .send({
                    testCode: 'it("dummy", () => {});'
                })
                .expect(400);

            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('sourceFilePath is required');
        });

        it('returns 400 when empty body is sent to POST /simulation/trace', async () => {
            const res = await request(app)
                .post(`/api/coverage/${validSnapshotId}/simulation/trace`)
                .send({})
                .expect(400);

            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('sourceFilePath is required');
        });
    });

    // =========================================================================
    // 4. Error Handling: 404 Not Found
    // =========================================================================

    describe('Resource Not Found (404 Not Found)', () => {
        it('returns 404 when non-existent snapshotId is queried on GET /simulation/sources', async () => {
            mockPrisma.projectSnapshot.findFirst.mockResolvedValue(null);
            mockPrisma.projectSnapshot.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .get(`/api/coverage/${nonExistentSnapshotId}/simulation/sources`)
                .expect(404);

            expect(res.body.success).toBe(false);
            expect(res.body.message || res.body.code).toBeTruthy();
        });

        it('returns 404 when non-existent snapshotId is queried on POST /simulation/trace for on-disk file', async () => {
            mockPrisma.projectSnapshot.findFirst.mockResolvedValue(null);
            mockPrisma.projectSnapshot.findUnique.mockResolvedValue(null);

            const res = await request(app)
                .post(`/api/coverage/${nonExistentSnapshotId}/simulation/trace`)
                .send({
                    sourceFilePath: 'src/services/nonExistent.js'
                })
                .expect(404);

            expect(res.body.success).toBe(false);
        });

        it('returns 404 when source file does not exist on disk and no sourceCode is provided', async () => {
            const res = await request(app)
                .post(`/api/coverage/${validSnapshotId}/simulation/trace`)
                .send({
                    sourceFilePath: 'src/services/missingFile.js'
                })
                .expect(404);

            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Source file not found');
        });
    });

    // =========================================================================
    // 5. Storage Immutability Guard (Rule 8)
    // =========================================================================

    describe('Storage Immutability Guard (Rule 8)', () => {
        it('strictly maintains 0 disk modifications to storage/ and uploads/ across multiple requests', async () => {
            const beforeStorage = getStorageListing();

            // Run multiple discovery and trace simulation operations
            await request(app)
                .get(`/api/coverage/${validSnapshotId}/simulation/sources`)
                .expect(200);

            await request(app)
                .post(`/api/coverage/${validSnapshotId}/simulation/trace`)
                .send({
                    sourceFilePath: 'src/services/calculator.service.js',
                    functionName: 'calculateDiscount'
                })
                .expect(200);

            await request(app)
                .post(`/api/coverage/${validSnapshotId}/simulation/trace`)
                .send({
                    sourceFilePath: 'virtual/sample.js',
                    sourceCode: 'export function square(x) { return x * x; }',
                    testCode: 'it("squares", () => { expect(square(4)).toBe(16); });'
                })
                .expect(200);

            const afterStorage = getStorageListing();
            expect(afterStorage).toEqual(beforeStorage);
        });
    });

    // =========================================================================
    // 6. Controller Unit Direct Edge Cases
    // =========================================================================

    describe('Controller Direct Unit Edge Cases', () => {
        it('getSimulationSources returns 400 when snapshotId is missing from params', async () => {
            const mockReq = { params: {}, query: {} };
            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const mockNext = jest.fn();

            await getSimulationSources(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'snapshotId is required.'
            }));
        });

        it('getSimulationTrace returns 400 when snapshotId is missing from params', async () => {
            const mockReq = { params: {}, body: { sourceFilePath: 'src/app.js' } };
            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const mockNext = jest.fn();

            await getSimulationTrace(mockReq, mockRes, mockNext);
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'snapshotId is required.'
            }));
        });

        it('getSimulationSources calls next(err) on unhandled non-ServiceError exceptions', async () => {
            const mockReq = { params: { snapshotId: validSnapshotId }, query: {} };
            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const mockNext = jest.fn();

            // Force an unexpected TypeError in mock
            mockPrisma.projectSnapshot.findUnique.mockImplementationOnce(() => {
                throw new TypeError('Unexpected DB corruption');
            });

            await getSimulationSources(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            const passedErr = mockNext.mock.calls[0][0];
            expect(passedErr).toBeDefined();
            expect(passedErr.message).toBeTruthy();
        });

        it('getSimulationTrace calls next(err) on unhandled non-ServiceError exceptions', async () => {
            const mockReq = {
                params: { snapshotId: validSnapshotId },
                body: { sourceFilePath: 'src/services/calculator.service.js' }
            };
            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const mockNext = jest.fn();

            mockPrisma.projectSnapshot.findUnique.mockImplementationOnce(() => {
                throw new TypeError('Unexpected execution fault');
            });

            await getSimulationTrace(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            const passedErr = mockNext.mock.calls[0][0];
            expect(passedErr).toBeDefined();
            expect(passedErr.message).toBeTruthy();
        });
    });

    // =========================================================================
    // 7. Client Service Contract Verification
    // =========================================================================

    describe('Client Service Contract Verification', () => {
        let originalFetch;
        let clientCoverageService;

        beforeAll(async () => {
            originalFetch = global.fetch;
            clientCoverageService = await import('../../../client/src/services/coverage.service.js');
        });

        afterAll(() => {
            global.fetch = originalFetch;
        });

        it('getUnitTestSimulationSources makes GET request with correct URL and options query', async () => {
            const mockResult = {
                success: true,
                data: { snapshotId: 'snap-1', totalFiles: 1, sourceFiles: [] }
            };

            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockResult
            });

            const res = await clientCoverageService.getUnitTestSimulationSources('snap-1', {
                filePath: 'src/services/calc.js',
                limit: 10
            });

            expect(global.fetch).toHaveBeenCalledTimes(1);
            const [url, reqOpts] = global.fetch.mock.calls[0];
            expect(url).toContain('/coverage/snap-1/simulation/sources?');
            expect(url).toContain('filePath=src%2Fservices%2Fcalc.js');
            expect(url).toContain('limit=10');
            expect(reqOpts.headers).toBeDefined();
            expect(res).toEqual(mockResult);
        });

        it('getUnitTestSimulationTrace makes POST request with payload body', async () => {
            const mockTraceResult = {
                success: true,
                data: { sourceFilePath: 'src/calc.js', steps: [] }
            };

            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockTraceResult
            });

            const payload = {
                sourceFilePath: 'src/calc.js',
                functionName: 'add'
            };

            const res = await clientCoverageService.getUnitTestSimulationTrace('snap-1', payload);

            expect(global.fetch).toHaveBeenCalledTimes(1);
            const [url, reqOpts] = global.fetch.mock.calls[0];
            expect(url).toContain('/coverage/snap-1/simulation/trace');
            expect(reqOpts.method).toBe('POST');
            expect(reqOpts.body).toBe(JSON.stringify(payload));
            expect(res).toEqual(mockTraceResult);
        });
    });
});
