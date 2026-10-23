import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { runPlaywrightApiTests, parsePlaywrightApiJsonResults } from '../services/playwrightApiRunner.service.js';
import { traceApiEndpointCoverage, diagnoseApiFailureLayer, buildApiCoverageReport } from '../services/apiCoverageTracer.service.js';
import { classifyScenarioFailure } from '../services/integrationWorkspace.service.js';

describe('Phase 3: Execution & Tracing Engine Test Suite', () => {
    describe('Task 3.1 & 3.2: Playwright API Runner & Test Results Parser', () => {
        it('should correctly parse Playwright JSON report into standardized scenarios', () => {
            const mockPlaywrightReport = {
                suites: [
                    {
                        title: 'api.spec.js',
                        file: 'tests/api.spec.js',
                        specs: [
                            {
                                title: 'GET /api/users - returns list of users',
                                tests: [
                                    {
                                        status: 'expected',
                                        results: [
                                            {
                                                status: 'passed',
                                                duration: 125,
                                                errors: []
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                title: 'POST /api/users - fails when email is missing',
                                tests: [
                                    {
                                        status: 'unexpected',
                                        results: [
                                            {
                                                status: 'failed',
                                                duration: 45,
                                                errors: [
                                                    {
                                                        message: 'Error: expect(received).toBe(expected)\n\nExpected: 400\nReceived: 500'
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ],
                stats: {
                    expected: 1,
                    unexpected: 1,
                    skipped: 0,
                    duration: 170
                }
            };

            const parsed = parsePlaywrightApiJsonResults(mockPlaywrightReport);
            expect(parsed).toBeDefined();
            expect(parsed.totalTests).toBe(2);
            expect(parsed.passedTests).toBe(1);
            expect(parsed.failedTests).toBe(1);
            expect(parsed.scenarios).toHaveLength(2);

            const passedSc = parsed.scenarios[0];
            expect(passedSc.title).toContain('GET /api/users - returns list of users');
            expect(passedSc.status).toBe('PASSED');
            expect(passedSc.durationMs).toBe(125);

            const failedSc = parsed.scenarios[1];
            expect(failedSc.title).toContain('POST /api/users - fails when email is missing');
            expect(failedSc.status).toBe('FAILED');
            expect(failedSc.failureMessages[0]).toContain('Expected: 400');
        });

        it('should handle empty or malformed Playwright JSON output safely', () => {
            const emptyResult = parsePlaywrightApiJsonResults(null);
            expect(emptyResult.totalTests).toBe(0);
            expect(emptyResult.scenarios).toEqual([]);

            const emptyObjResult = parsePlaywrightApiJsonResults({});
            expect(emptyObjResult.totalTests).toBe(0);
            expect(emptyObjResult.scenarios).toEqual([]);
        });
    });

    describe('Task 3.3: Unified Line Coverage & Reverse API Mapping', () => {
        const mockEndpoints = [
            {
                method: 'GET',
                path: '/api/products',
                controllerFile: 'server/controllers/product.controller.js',
                controllerLineStart: 10,
                controllerLineEnd: 25,
                middlewares: []
            },
            {
                method: 'POST',
                path: '/api/products',
                controllerFile: 'server/controllers/product.controller.js',
                controllerLineStart: 30,
                controllerLineEnd: 50,
                middlewares: [{ name: 'authMiddleware' }]
            },
            {
                method: 'DELETE',
                path: '/api/products/:id',
                controllerFile: 'server/controllers/untested.controller.js',
                controllerLineStart: 5,
                controllerLineEnd: 15,
                middlewares: []
            }
        ];

        const mockFileCoverageMap = {
            'server/controllers/product.controller.js': {
                path: 'server/controllers/product.controller.js',
                lineHits: {
                    10: 2,
                    11: 2,
                    12: 2,
                    13: 2,
                    14: 2,
                    20: 2,
                    25: 2,
                    30: 0,
                    31: 0,
                    32: 0,
                    50: 0
                },
                lines: { total: 11, covered: 7, pct: 63.64 },
                statements: { total: 11, covered: 7, pct: 63.64 },
                branches: { total: 4, covered: 3, pct: 75.0 },
                functions: { total: 2, covered: 1, pct: 50.0 },
                uncoveredBranches: []
            }
        };

        it('should correctly mark covered and uncovered endpoints via traceApiEndpointCoverage', () => {
            const traceResult = traceApiEndpointCoverage({
                endpoints: mockEndpoints,
                fileCoverageMap: mockFileCoverageMap
            });

            expect(traceResult).toBeDefined();
            expect(traceResult.summary.totalEndpoints).toBe(3);
            expect(traceResult.summary.coveredEndpoints).toBe(1);
            expect(traceResult.summary.uncoveredEndpoints).toBe(2);
            expect(traceResult.summary.endpointCoveragePct).toBeCloseTo(33.33, 1);

            const getEp = traceResult.endpointsTraceability.find(e => e.path === '/api/products' && e.method === 'GET');
            expect(getEp).toBeDefined();
            expect(getEp.status).toBe('COVERED');
            expect(getEp.coveragePct).toBe(100);

            const postEp = traceResult.endpointsTraceability.find(e => e.path === '/api/products' && e.method === 'POST');
            expect(postEp).toBeDefined();
            expect(postEp.status).toBe('UNCOVERED');
            expect(postEp.coveragePct).toBe(0);

            const deleteEp = traceResult.endpointsTraceability.find(e => e.path === '/api/products/:id');
            expect(deleteEp).toBeDefined();
            expect(deleteEp.status).toBe('UNCOVERED');
            expect(deleteEp.coveragePct).toBe(0);
        });

        it('should generate a comprehensive API coverage report', () => {
            const traceResult = traceApiEndpointCoverage({
                endpoints: mockEndpoints,
                fileCoverageMap: mockFileCoverageMap
            });

            const report = buildApiCoverageReport({
                traceabilityResult: traceResult,
                scenarios: [
                    { title: 'GET /api/products returns 200', status: 'passed' },
                    { title: 'POST /api/products fails validation', status: 'failed' }
                ],
                testFramework: 'SUPERTEST'
            });

            expect(report).toBeDefined();
            expect(report.metadata.testFramework).toBe('SUPERTEST');
            expect(report.metrics.totalEndpoints).toBe(3);
            expect(report.metrics.coveredEndpoints).toBe(1);
            expect(report.metrics.uncoveredEndpoints).toBe(2);
            expect(report.uncoveredList).toHaveLength(2);
            expect(report.recommendations).toHaveLength(2);
        });
    });

    describe('Task 3.4: Dynamic Failure Layer Diagnostics', () => {
        const mockEndpoint = {
            method: 'POST',
            path: '/api/orders',
            controllerFile: 'server/controllers/order.controller.js',
            controllerLineStart: 10,
            controllerLineEnd: 40,
            routeFile: 'server/routes/order.route.js',
            middlewares: [{ name: 'verifyJwtToken' }]
        };

        it('should diagnose ROUTER_NOT_FOUND when actual status is 404 and route was never reached', () => {
            const diagnosis = diagnoseApiFailureLayer({
                endpoint: mockEndpoint,
                scenario: {
                    title: 'POST /api/orders create order',
                    actualStatus: 404,
                    expectedStatus: 201,
                    status: 'failed'
                },
                failureMessages: ['Cannot POST /api/orders', 'Status expected 201 received 404']
            });

            expect(diagnosis.failureLayer).toBe('ROUTER_NOT_FOUND');
            expect(diagnosis.failingComponent).toBe('server/routes/order.route.js');
            expect(diagnosis.diagnosticsDetails.controllerEntered).toBe(false);
        });

        it('should diagnose MIDDLEWARE_REJECTED when request is rejected with 401/403 or JWT expired', () => {
            const diagnosis = diagnoseApiFailureLayer({
                endpoint: mockEndpoint,
                scenario: {
                    title: 'POST /api/orders without token',
                    actualStatus: 401,
                    expectedStatus: 201,
                    status: 'failed'
                },
                failureMessages: ['Unauthorized: jwt expired or missing token']
            });

            expect(diagnosis.failureLayer).toBe('MIDDLEWARE_REJECTED');
            expect(diagnosis.failingComponent).toBe('verifyJwtToken');
            expect(diagnosis.diagnosticsDetails.controllerEntered).toBe(false);
        });

        it('should diagnose DATABASE_FAILURE when Prisma or SQL error is detected', () => {
            const diagnosis = diagnoseApiFailureLayer({
                endpoint: mockEndpoint,
                scenario: {
                    title: 'POST /api/orders save order',
                    actualStatus: 500,
                    expectedStatus: 201,
                    status: 'failed'
                },
                failureMessages: [
                    'PrismaClientKnownRequestError: Unique constraint failed on the fields: (`order_number`)',
                    'at PrismaClient._executeRequest'
                ]
            });

            expect(diagnosis.failureLayer).toBe('DATABASE_FAILURE');
            expect(diagnosis.explanation.toLowerCase()).toContain('cơ sở dữ liệu');
        });

        it('should diagnose CONTROLLER_CRASH when uncaught TypeError happens in controller', () => {
            const diagnosis = diagnoseApiFailureLayer({
                endpoint: mockEndpoint,
                scenario: {
                    title: 'POST /api/orders calculate totals',
                    actualStatus: 500,
                    expectedStatus: 201,
                    status: 'failed'
                },
                failureMessages: [
                    'TypeError: Cannot read properties of undefined (reading \'reduce\')',
                    'at createOrder (server/controllers/order.controller.js:24:18)'
                ]
            });

            expect(diagnosis.failureLayer).toBe('CONTROLLER_CRASH');
            expect(diagnosis.explanation.toLowerCase()).toContain('crash');
            expect(diagnosis.diagnosticsDetails.actualStatus).toBe(500);
        });

        it('should diagnose ASSERTION_FAILED when controller succeeds with 200/201 but assertion fails on schema', () => {
            const diagnosis = diagnoseApiFailureLayer({
                endpoint: mockEndpoint,
                scenario: {
                    title: 'POST /api/orders return new order',
                    actualStatus: 200,
                    expectedStatus: 201,
                    status: 'failed'
                },
                failureMessages: [
                    'Error: expect(received).toBe(expected)\n\nExpected: 201\nReceived: 200'
                ]
            });

            expect(diagnosis.failureLayer).toBe('ASSERTION_FAILED');
            expect(diagnosis.diagnosticsDetails.controllerEntered).toBe(true);
        });
    });
});
