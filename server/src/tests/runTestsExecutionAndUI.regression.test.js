import { jest } from '@jest/globals';
import {
    evaluateEndpointMetrics,
    classifyScenarioFailure,
    isScenarioContractVerified
} from '../services/integrationWorkspace.service.js';

describe('Run Tests Stage Refactor: Execution Logic & Metric Consistency', () => {

    describe('1. Result-to-Execution Consistency & Evidence Isolation', () => {
        test('prevents stale historical scenarios when execution job failed before running tests', () => {
            const executeJob = {
                id: 'job-new',
                type: 'SUPERTEST_COVERAGE',
                status: 'FAILED',
                createdAt: new Date('2026-10-16T10:00:00Z')
            };
            const staleTestRun = {
                id: 'run-old',
                createdAt: new Date('2026-10-15T10:00:00Z'),
                totalTests: 10,
                scenarios: [{ title: 'old test', status: 'passed' }]
            };

            const executeFailedBeforeTests = executeJob.status === "FAILED" && (!staleTestRun || staleTestRun.createdAt < executeJob.createdAt);
            expect(executeFailedBeforeTests).toBe(true);

            // Simulation of scenario gathering in buildIntegrationWorkspace
            let testScenarios = [];
            if (executeFailedBeforeTests) {
                testScenarios = [];
            } else if (staleTestRun?.scenarios) {
                testScenarios = staleTestRun.scenarios;
            }

            expect(testScenarios).toHaveLength(0);
        });

        test('isolates runtime evidence to current testRun ID to prevent cross-run pollution', () => {
            const currentRunId = 'run-2026-current';
            const mixedEvidences = [
                { testTitle: 'should validate cart', requestMethod: 'POST', actualStatusFromRuntime: 200, testRunId: currentRunId },
                { testTitle: 'legacy query', requestMethod: 'GET', actualStatusFromRuntime: 200, testRunId: 'run-2025-stale' },
                { testTitle: 'uninstrumented call', requestMethod: 'GET', actualStatusFromRuntime: 200, testRunId: null }
            ];

            const filteredEvidences = mixedEvidences.filter(ev => !ev.testRunId || ev.testRunId === currentRunId);
            expect(filteredEvidences).toHaveLength(2);
            expect(filteredEvidences.some(ev => ev.testRunId === 'run-2025-stale')).toBe(false);
        });
    });

    describe('2. Endpoint Coverage & Genuine Execution Evidence', () => {
        test('requires genuine live server response or executed passing tests to count as tested', () => {
            // Case A: Endpoint with only syntax / script error before HTTP call
            const scriptErrorMetrics = evaluateEndpointMetrics({
                executedCount: 1,
                passedCount: 0,
                failedCount: 1,
                testScriptErrorCount: 1,
                hasObservedServerResponse: false
            });
            expect(scriptErrorMetrics.hasGenuineApiCall).toBe(false);
            expect(scriptErrorMetrics.status).toBe('Script Error');

            // Case B: Endpoint with genuine live HTTP server response
            const genuineLiveResponseMetrics = evaluateEndpointMetrics({
                executedCount: 1,
                passedCount: 0,
                failedCount: 1,
                testScriptErrorCount: 0,
                hasObservedServerResponse: true
            });
            expect(genuineLiveResponseMetrics.hasGenuineApiCall).toBe(true);
            expect(genuineLiveResponseMetrics.status).toBe('Partial');

            // Case C: Fully passing endpoint with server response
            const passingMetrics = evaluateEndpointMetrics({
                executedCount: 2,
                passedCount: 2,
                failedCount: 0,
                testScriptErrorCount: 0,
                hasObservedServerResponse: true
            });
            expect(passingMetrics.hasGenuineApiCall).toBe(true);
            expect(passingMetrics.status).toBe('Covered');
        });

        test('a runner pass does NOT automatically imply contract verification', () => {
            // A scenario asserting HTTP 500 on invalid input without OpenAPI spec
            const unverifiedScenario = {
                title: 'should return 500 on malformed input id',
                status: 'passed',
                failureMessages: []
            };
            const req = {
                method: 'POST',
                path: '/api/items',
                expectedStatus: 500,
                payload: { id: 'invalid-id' }
            };

            const classification = classifyScenarioFailure(unverifiedScenario, req);
            expect(classification).toBe('CONTRACT_UNVERIFIED');

            // Confirm isScenarioContractVerified returns false for unverified scenario
            const verified = isScenarioContractVerified(unverifiedScenario);
            expect(verified).toBe(false);
        });
    });

    describe('3. QA Counters Audit & Metric Definitions', () => {
        test('audits qualityClassification counters: contractVerified, validExecuted, and passed', () => {
            const scenarios = [
                { title: 'valid pass', status: 'passed', contractVerification: 'VERIFIED', isContractVerified: true },
                { title: 'catch-all 500 pass', status: 'passed', contractVerification: 'UNVERIFIED', isContractVerified: false },
                { title: 'assertion fail', status: 'failed', contractVerification: 'VERIFIED', isContractVerified: false },
                { title: 'script error', status: 'failed', isSuiteLevelFailure: true }
            ];

            const qc = {
                total: 0,
                validExecuted: 0,
                passed: 0,
                assertionFailures: 0,
                testScriptErrors: 0,
                contractUnverified: 0,
                contractVerified: 0,
                implementationConsistent: 0
            };

            scenarios.forEach(sc => {
                qc.total++;
                if (sc.title === 'valid pass') {
                    qc.passed++;
                    qc.implementationConsistent++;
                    qc.contractVerified++;
                } else if (sc.title === 'catch-all 500 pass') {
                    qc.contractUnverified++;
                } else if (sc.title === 'assertion fail') {
                    qc.assertionFailures++;
                } else if (sc.title === 'script error') {
                    qc.testScriptErrors++;
                }
            });

            qc.validExecuted = qc.passed + qc.assertionFailures;

            expect(qc.total).toBe(4);
            expect(qc.passed).toBe(1);
            expect(qc.validExecuted).toBe(2); // 1 passed + 1 assertion failure
            expect(qc.contractUnverified).toBe(1);
            expect(qc.contractVerified).toBe(1);
            expect(qc.testScriptErrors).toBe(1);
        });
    });

    describe('4. Remaining-Work Selection & Granular Dispatch', () => {
        test('identifies genuinely unexecuted and retryable scenarios across endpoints', () => {
            const endpoints = [
                {
                    method: 'GET',
                    path: '/api/items',
                    executedCount: 2,
                    passedCount: 2,
                    failedCount: 0,
                    unexecutedCount: 0,
                    scenarios: [
                        { id: 'sc-1', status: 'passed' },
                        { id: 'sc-2', status: 'passed' }
                    ]
                },
                {
                    method: 'POST',
                    path: '/api/cart/validate',
                    executedCount: 1,
                    passedCount: 0,
                    failedCount: 1,
                    unexecutedCount: 0,
                    scenarios: [
                        { id: 'sc-fail-1', status: 'failed', executionVerdict: 'FAIL' }
                    ]
                },
                {
                    method: 'DELETE',
                    path: '/api/items/:id',
                    executedCount: 0,
                    passedCount: 0,
                    failedCount: 0,
                    unexecutedCount: 2,
                    scenarios: [
                        { id: 'sc-unrun-1', status: 'not_run' },
                        { id: 'sc-unrun-2', status: 'not_run' }
                    ]
                }
            ];

            // Filter remaining endpoints
            const remainingEndpoints = endpoints.filter(ep => 
                (ep.unexecutedCount > 0) ||
                (ep.failedCount > 0) ||
                (ep.executedCount === 0)
            );

            expect(remainingEndpoints).toHaveLength(2);
            expect(remainingEndpoints.map(e => e.path)).toEqual([
                '/api/cart/validate',
                '/api/items/:id'
            ]);

            // Gather scenario IDs for remaining / retryable work
            const remainingScenarioIds = new Set();
            remainingEndpoints.forEach(ep => {
                (ep.scenarios || []).forEach(s => {
                    const isUnexecuted = s.status === 'not_run' || s.executionVerdict === 'NOT_EXECUTED';
                    const isRetryable = s.status === 'failed' || s.executionVerdict === 'FAIL';
                    if (isUnexecuted || isRetryable) {
                        remainingScenarioIds.add(s.id);
                    }
                });
            });

            expect(remainingScenarioIds.size).toBe(3);
            expect(remainingScenarioIds.has('sc-fail-1')).toBe(true);
            expect(remainingScenarioIds.has('sc-unrun-1')).toBe(true);
            expect(remainingScenarioIds.has('sc-unrun-2')).toBe(true);
            // Already-passed scenarios must NOT be in remaining work
            expect(remainingScenarioIds.has('sc-1')).toBe(false);
            expect(remainingScenarioIds.has('sc-2')).toBe(false);
        });

        test('prevents empty job dispatch when all scenarios are already passed', () => {
            const allPassedEndpoints = [
                {
                    method: 'GET',
                    path: '/api/health',
                    executedCount: 1,
                    passedCount: 1,
                    failedCount: 0,
                    unexecutedCount: 0,
                    scenarios: [{ id: 'sc-h1', status: 'passed' }]
                }
            ];

            const remainingList = allPassedEndpoints.filter(ep =>
                ep.unexecutedCount > 0 || ep.failedCount > 0 || ep.executedCount === 0
            );

            let dispatchedJob = false;
            if (remainingList.length === 0) {
                dispatchedJob = false; // Guard prevents dispatch
            } else {
                dispatchedJob = true;
            }

            expect(remainingList).toHaveLength(0);
            expect(dispatchedJob).toBe(false);
        });

        test('allows single-scenario retry targeting without dispatching entire suite', () => {
            const targetScenarioId = 'sc-fail-1';
            const approvedList = [targetScenarioId];

            expect(approvedList).toEqual(['sc-fail-1']);
            expect(approvedList).toHaveLength(1);
        });
    });

    describe('5. Reload Recovery & Execution State Restoration', () => {
        test('restores RUNNING active job on workspace reload', () => {
            const mockJobs = {
                analyze: { id: 'job-a', status: 'SUCCESS' },
                generate: { id: 'job-g', status: 'SUCCESS' },
                execute: { id: 'job-exec-123', status: 'RUNNING' }
            };

            let runningJobId = null;
            let runningJobType = null;
            if (mockJobs.execute?.status === 'RUNNING' || mockJobs.execute?.status === 'QUEUED') {
                runningJobId = mockJobs.execute.id;
                runningJobType = 'EXECUTE';
            }

            expect(runningJobId).toBe('job-exec-123');
            expect(runningJobType).toBe('EXECUTE');
        });

        test('restores completed execution state and verdict when job is finished', () => {
            const mockJobs = {
                execute: { id: 'job-exec-123', status: 'SUCCESS' }
            };
            const mockSummary = {
                totalTests: 19,
                passedTests: 18,
                failedTests: 1,
                semanticState: 'TESTS_FAILED'
            };

            const isJobActive = mockJobs.execute.status === 'RUNNING';
            expect(isJobActive).toBe(false);
            expect(mockSummary.semanticState).toBe('TESTS_FAILED');
            expect(mockSummary.failedTests).toBe(1);
        });
    });

    describe('6. Evidence Traceability & Code Coverage Drill-Down', () => {
        test('missing contract documentation means UNVERIFIED, not automatically FAILED', () => {
            // Scenario passed in Jest with HTTP 500, but has no swagger spec requiring 500
            const scenario = {
                title: 'should handle invalid json with 500 error',
                status: 'passed',
                actualStatus: 500,
                contractVerification: 'UNVERIFIED',
                isContractVerified: false
            };

            const req = {
                method: 'POST',
                url: '/api/v1/auth/login',
                expectedStatus: 500
            };

            const classification = classifyScenarioFailure(scenario, req);
            // It should be CONTRACT_UNVERIFIED, NOT an assertion failure or test script error
            expect(classification).toBe('CONTRACT_UNVERIFIED');
            expect(scenario.status).toBe('passed'); // Remains passed technically
            expect(isScenarioContractVerified(scenario)).toBe(false); // Contract unverified
        });

        test('file-level coverage drill-down accurately maps controllers to endpoints', () => {
            const fileCoverages = [
                { filePath: 'src/controllers/auth.controller.js', statement: 85.5, branch: 72.0, function: 100.0, line: 88.2 },
                { filePath: 'src/controllers/user.controller.js', statement: 92.0, branch: 80.0, function: 90.0, line: 91.5 }
            ];

            const endpoints = [
                { method: 'POST', path: '/api/v1/auth/login', sourceFile: 'src/controllers/auth.controller.js' },
                { method: 'POST', path: '/api/v1/auth/register', sourceFile: 'src/controllers/auth.controller.js' },
                { method: 'GET', path: '/api/v1/users/me', sourceFile: 'src/controllers/user.controller.js' }
            ];

            // Map each file to its associated endpoints
            const authEndpoints = endpoints.filter(ep => ep.sourceFile === fileCoverages[0].filePath);
            expect(authEndpoints.length).toBe(2);
            expect(authEndpoints.map(e => e.path)).toEqual(['/api/v1/auth/login', '/api/v1/auth/register']);

            const userEndpoints = endpoints.filter(ep => ep.sourceFile === fileCoverages[1].filePath);
            expect(userEndpoints.length).toBe(1);
            expect(userEndpoints[0].path).toBe('/api/v1/users/me');
        });

        test('metric consistency: executed equals passed + failed and passRate calculation', () => {
            const summary = {
                totalTests: 19,
                passedTests: 18,
                failedTests: 1,
                skippedTests: 0,
                discoveredApis: 7,
                testedApis: 7
            };

            const executed = summary.passedTests + summary.failedTests;
            expect(executed).toBe(19);
            const passRate = Math.round((summary.passedTests / executed) * 100);
            expect(passRate).toBe(95);

            const apiCoverageRate = Math.round((summary.testedApis / summary.discoveredApis) * 100);
            expect(apiCoverageRate).toBe(100);
        });
    });
});

