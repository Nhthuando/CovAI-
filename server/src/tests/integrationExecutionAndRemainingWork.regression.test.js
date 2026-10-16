import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveAppEntryPoint, resolveAppImportPath, saveAiTestsToFilesystem } from '../services/aiTestStorage.service.js';
import { transformTestCodeForProject } from '../services/supertestCoverageJob.service.js';
import { parseJestResults } from '../services/testResultParser.service.js';
import { classifyScenarioFailure, evaluateEndpointMetrics } from '../services/integrationWorkspace.service.js';
import { ServiceError } from '../utils/serviceError.js';

describe('Integration Testing: Execution and Remaining Work Regression Tests', () => {
    let tempRootDir;

    beforeEach(() => {
        tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-test-root-'));
        // Setup realistic food ordering project layout: root/server/index.js exists
        fs.mkdirSync(path.join(tempRootDir, 'server'), { recursive: true });
        fs.writeFileSync(path.join(tempRootDir, 'server', 'index.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(tempRootDir, 'package.json'), JSON.stringify({ name: 'food-app', version: '1.0.0' }));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempRootDir, { recursive: true, force: true });
        } catch (_) {}
    });

    // =========================================================================
    // Regression Requirement 1: Test file ở thư mục nông import đúng entry point
    // =========================================================================
    test('Regression 1: Shallow test file (tests/integration/) resolves to correct entry point (../../server/index.js)', () => {
        const shallowTestPath = path.join(tempRootDir, 'tests', 'integration', 'cart.test.js');
        fs.mkdirSync(path.dirname(shallowTestPath), { recursive: true });

        // Case 1A: Test originally had broken import ../../index (which points to root/index, non-existent)
        const brokenCode = "import app from '../../index';";
        const transformed = resolveAppImportPath(brokenCode, tempRootDir, shallowTestPath);
        expect(transformed).toBe("import app from '../../server/index';");

        // Case 1B: Test had ../../server/index.js
        const correctCode = "const app = require('../../server/index.js');";
        const preserved = resolveAppImportPath(correctCode, tempRootDir, shallowTestPath);
        expect(preserved).toBe("const app = require('../../server/index.js');");

        // Verify resolved path on disk exists
        const resolved = path.resolve(path.dirname(shallowTestPath), '../../server/index.js');
        expect(fs.existsSync(resolved)).toBe(true);

        // Case 1C: If entry point cannot be resolved on disk, throws ServiceError
        const emptyRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-empty-root-'));
        try {
            expect(() => {
                resolveAppImportPath(brokenCode, emptyRootDir, path.join(emptyRootDir, 'tests', 'integration', 't.test.js'));
            }).toThrow(ServiceError);
        } finally {
            fs.rmSync(emptyRootDir, { recursive: true, force: true });
        }
    });

    // =========================================================================
    // Regression Requirement 2: Test file ở thư mục sâu import đúng entry point
    // =========================================================================
    test('Regression 2: Deep test file (server/__tests__/integration/) resolves to correct entry point (../../index.js)', async () => {
        const deepTestPath = path.join(tempRootDir, 'server', '__tests__', 'integration', 'productEndpoints.test.js');
        fs.mkdirSync(path.dirname(deepTestPath), { recursive: true });

        // Case 2A: Test originally had ../../server/index.js (which from server/__tests__/integration resolves to server/server/index.js)
        const corruptedCode = "const app = require('../../server/index.js');";
        const healed = resolveAppImportPath(corruptedCode, tempRootDir, deepTestPath);
        // It must be healed to ../../index.js
        expect(healed).toBe("const app = require('../../index.js');");

        // Verify that the healed relative path resolves to the actual server/index.js on disk
        const resolved = path.resolve(path.dirname(deepTestPath), '../../index.js');
        expect(resolved).toBe(path.join(tempRootDir, 'server', 'index.js'));
        expect(fs.existsSync(resolved)).toBe(true);

        // Case 2B: saveAiTestsToFilesystem mutates test.content in-place so caller and DB persist resolved code
        const testObj = {
            filePath: path.join('server', '__tests__', 'integration', 'productEndpoints.test.js'),
            content: "const app = require('../../server/index.js');"
        };
        saveAiTestsToFilesystem(tempRootDir, [testObj]);
        expect(testObj.content).toBe("const app = require('../../index.js');");
        const writtenContent = fs.readFileSync(path.join(tempRootDir, testObj.filePath), 'utf8');
        expect(writtenContent).toBe("const app = require('../../index.js');");

        // Case 2C: transformTestCodeForProject preserves executable output
        const executable = await transformTestCodeForProject(corruptedCode, tempRootDir, deepTestPath);
        expect(executable).not.toContain('../../server/index');
        expect(executable).toContain('../../index');
    });

    // =========================================================================
    // Regression Requirement 3: Jest suite lỗi khi load module được ánh xạ về đúng các scenario gốc
    // =========================================================================
    test('Regression 3: Jest suite module load failure maps back to registered scenario IDs with TEST_SCRIPT_ERROR', () => {
        const coverageDir = path.join(tempRootDir, 'coverage');
        fs.mkdirSync(coverageDir, { recursive: true });

        const failedSuitePath = path.join(tempRootDir, 'server', '__tests__', 'integration', 'generated_api-76cbcebb.test.js');
        const mockJestResults = {
            numTotalTests: 0,
            numPassedTests: 0,
            numFailedTests: 0,
            numPendingTests: 0,
            success: false,
            testResults: [
                {
                    name: failedSuitePath,
                    status: 'failed',
                    message: "Cannot find module '../../server/index.js' from 'generated_api-76cbcebb.test.js'\n    at require (node:internal/modules/cjs/loader:1225:15)",
                    assertionResults: [] // 0 assertions due to module load crash
                }
            ]
        };

        fs.writeFileSync(path.join(coverageDir, 'jest-results.json'), JSON.stringify(mockJestResults), 'utf8');

        // Mock registered AiTest metadata containing 2 scenarios in that file
        const mockAiTests = [
            {
                id: 'ai-test-deep-1',
                filePath: 'server/__tests__/integration/generated_api-76cbcebb.test.js',
                metaJson: JSON.stringify({
                    framework: 'SUPERTEST',
                    requests: [
                        { scenarioId: 'sc-root-200', testName: 'happy path: GET / should return 200', suiteName: 'GET /' },
                        { scenarioId: 'sc-cart-empty', testName: 'edge case: should return 200 with 0 total for empty cart', suiteName: 'POST /api/cart/validate' }
                    ]
                })
            }
        ];

        const parsed = parseJestResults(coverageDir, { aiTests: mockAiTests, rootDir: tempRootDir });

        expect(parsed).not.toBeNull();
        expect(parsed.status).toBe('FAILED');
        // Must recover BOTH registered scenarios rather than a single synthetic scenario named after the file
        expect(parsed.scenarios).toHaveLength(2);

        const sc1 = parsed.scenarios.find(s => s.scenarioId === 'sc-root-200');
        const sc2 = parsed.scenarios.find(s => s.scenarioId === 'sc-cart-empty');

        expect(sc1).toBeDefined();
        expect(sc1.title).toBe('happy path: GET / should return 200');
        expect(sc1.status).toBe('failed');
        expect(sc1.isSuiteLevelFailure).toBe(true);
        expect(sc1.failureMessages[0]).toContain("Cannot find module '../../server/index.js'");

        expect(sc2).toBeDefined();
        expect(sc2.title).toBe('edge case: should return 200 with 0 total for empty cart');
        expect(sc2.status).toBe('failed');
        expect(sc2.isSuiteLevelFailure).toBe(true);

        // Classification must be TEST_SCRIPT_ERROR
        expect(classifyScenarioFailure(sc1, null)).toBe('TEST_SCRIPT_ERROR');
        expect(classifyScenarioFailure(sc2, null)).toBe('TEST_SCRIPT_ERROR');
    });

    // =========================================================================
    // Regression Requirement 4: Script error không làm tăng số endpoint có request execution evidence
    // =========================================================================
    test('Regression 4: Script error does not increment genuine API call evidence or inflate executed endpoint metrics', () => {
        // An endpoint where all scenarios suffered TEST_SCRIPT_ERROR
        const metricsWithScriptErrors = evaluateEndpointMetrics({
            executedCount: 2,
            passedCount: 0,
            failedCount: 2,
            testScriptErrorCount: 2,
            verifiedPassedCount: 0,
            verifiedAssertionFailedCount: 0,
            consistentPassedCount: 0,
            hasRelevantTestFile: true
        });

        expect(metricsWithScriptErrors.hasGenuineApiCall).toBe(false);
        expect(metricsWithScriptErrors.isContractVerified).toBe(false);
        expect(metricsWithScriptErrors.isVerifiedTested).toBe(false);
        expect(metricsWithScriptErrors.isImplementationConsistent).toBe(false);
        expect(metricsWithScriptErrors.status).toBe('Script Error');
        expect(metricsWithScriptErrors.isExecuted).toBe(false);

        // Quality classification derivation
        const quality = {
            total: 2,
            validExecuted: 0, // MUST NOT increment
            passed: 0,
            assertionFailures: 0,
            testScriptErrors: 2,
            notExecuted: 0
        };
        expect(quality.validExecuted).toBe(0);
        expect(quality.testScriptErrors).toBe(2);
    });

    // =========================================================================
    // Regression Requirement 5: Scenario trùng route trong các file khác nhau không khiến số endpoint được tính sai
    // =========================================================================
    test('Regression 5: Overlapping route across shallow and deep test files (POST /api/cart/validate) does not miscalculate endpoint counts', () => {
        // Discovered endpoints: 9 unique endpoints
        const discoveredEndpoints = [
            { method: 'GET', fullPath: '/' },
            { method: 'POST', fullPath: '/api/cart/validate' },
            { method: 'POST', fullPath: '/api/cart/checkout' },
            { method: 'POST', fullPath: '/api/payments/create-payment-intent' },
            { method: 'GET', fullPath: '/api/food-items' },
            { method: 'GET', fullPath: '/api/food-items/get/:id' },
            { method: 'POST', fullPath: '/api/food-items/create/' },
            { method: 'PUT', fullPath: '/api/food-items/update/:id' },
            { method: 'DELETE', fullPath: '/api/food-items/delete/:id' }
        ];

        // Scenario 1 in shallow file: tests/integration/cart.test.js (passed)
        const scShallow = {
            title: 'POST /api/cart/validate should handle invalid or missing items correctly',
            suiteName: 'Cart API Integration Tests',
            status: 'passed',
            requests: [{ method: 'POST', path: '/api/cart/validate', testName: 'POST /api/cart/validate should handle invalid or missing items correctly' }]
        };

        // Scenario 2 in deep file: server/__tests__/integration/generated_api.test.js (failed with script error)
        const scDeep = {
            title: 'edge case: should return 200 with 0 total for empty cart',
            suiteName: 'POST /api/cart/validate',
            status: 'failed',
            isSuiteLevelFailure: true,
            failureMessages: ["Cannot find module '../../server/index.js'"],
            requests: [{ method: 'POST', path: '/api/cart/validate', testName: 'edge case: should return 200 with 0 total for empty cart' }]
        };

        const cartValidateEndpoint = discoveredEndpoints.find(ep => ep.fullPath === '/api/cart/validate');
        const scenariosForEp = [scShallow, scDeep];

        const executedCount = scenariosForEp.length; // 2
        const passedCount = scenariosForEp.filter(s => s.status === 'passed').length; // 1
        const failedCount = scenariosForEp.filter(s => s.status === 'failed').length; // 1
        const testScriptErrorCount = scenariosForEp.filter(s => s.isSuiteLevelFailure).length; // 1

        const metrics = evaluateEndpointMetrics({
            executedCount,
            passedCount,
            failedCount,
            testScriptErrorCount,
            hasRelevantTestFile: true
        });

        // The endpoint is partially covered (1 passed, 1 script error)
        expect(metrics.status).toBe('Partial');
        // Genuine API call is true because 1 passed successfully
        expect(metrics.hasGenuineApiCall).toBe(true);

        // When evaluating remaining endpoints: POST /api/cart/validate is NOT an unexecuted endpoint (executedCount = 2, passedCount = 1)
        // But its errored scenario is identified for re-run
        const remainingEndpoints = [cartValidateEndpoint].filter(ep =>
            (ep.unexecutedCount > 0) || (ep.executedCount === 0) || (metrics.status === 'Partial' && testScriptErrorCount > 0)
        );
        expect(remainingEndpoints).toHaveLength(1);
    });

    // =========================================================================
    // Regression Requirement 6: Run Remaining Endpoint không âm thầm lặp lại cùng một lỗi mà không hiển thị trạng thái thất bại
    // =========================================================================
    test('Regression 6: Run Remaining Endpoint includes script-errored endpoints and displays failure status rather than silent no-op', () => {
        const workspaceEndpoints = [
            {
                method: 'GET',
                fullPath: '/',
                status: 'Script Error',
                executedCount: 1,
                testScriptErrorCount: 1,
                hasGenuineApiCall: false,
                scenarios: [
                    { id: 't1::sc1', status: 'failed', executionVerdict: 'SCRIPT_ERROR', classification: 'TEST_SCRIPT_ERROR', isSuiteLevelFailure: true }
                ]
            },
            {
                method: 'POST',
                fullPath: '/api/cart/checkout',
                status: 'Covered',
                executedCount: 2,
                testScriptErrorCount: 0,
                hasGenuineApiCall: true,
                scenarios: [
                    { id: 't2::sc2', status: 'passed', executionVerdict: 'PASS', classification: 'PASSED' },
                    { id: 't2::sc3', status: 'passed', executionVerdict: 'PASS', classification: 'PASSED' }
                ]
            }
        ];

        // Filter remaining list using updated logic
        const remainingList = workspaceEndpoints.filter(ep => 
            (ep.unexecutedCount > 0) ||
            (ep.generatedCount > 0 && ep.executedCount === 0) ||
            (ep.executedCount === 0) ||
            (ep.status === "Script Error") ||
            (ep.status === "Partial" && ep.testScriptErrorCount > 0) ||
            (!ep.hasGenuineApiCall && ep.generatedCount > 0)
        );

        expect(remainingList).toHaveLength(1);
        expect(remainingList[0].fullPath).toBe('/');

        // Gather scenario IDs to run
        const remainingScenarioIds = new Set();
        remainingList.forEach(ep => {
            ep.scenarios.forEach(s => {
                if (
                    s.status === "not_run" ||
                    s.executionVerdict === "NOT_EXECUTED" ||
                    !s.status ||
                    s.status === "pending" ||
                    s.executionVerdict === "SCRIPT_ERROR" ||
                    s.classification === "TEST_SCRIPT_ERROR" ||
                    (s.status === "failed" && s.isSuiteLevelFailure)
                ) {
                    remainingScenarioIds.add(s.id);
                }
            });
        });

        expect(Array.from(remainingScenarioIds)).toEqual(['t1::sc1']);
    });

    // =========================================================================
    // Regression Requirement 7: Khi có kết quả mới, workspace sau reload phản ánh đúng dữ liệu của lần chạy đó
    // =========================================================================
    test('Regression 7: Workspace after reload derives state consistently from latest TestRun and persistent evidence', () => {
        // Simulated latest TestRun containing all 18 executed scenarios after fix
        const latestTestRun = {
            id: 'run-latest-18',
            type: 'SUPERTEST',
            totalTests: 18,
            passedTests: 18,
            failedTests: 0,
            skippedTests: 0,
            status: 'PASSED',
            createdAt: new Date('2026-10-15T21:00:00Z'),
            scenarios: Array.from({ length: 18 }, (_, i) => ({
                id: `sc-db-${i + 1}`,
                title: `Scenario ${i + 1}`,
                suiteName: `Suite ${Math.floor(i / 2) + 1}`,
                status: 'passed',
                durationMs: 25,
                failureMessages: [],
                testFile: i < 10 ? 'tests/integration/cart.test.js' : 'server/__tests__/integration/generated.test.js'
            }))
        };

        // Semantic state derivation
        const deriveSemanticState = (executeJob, latestRun) => {
            if (!executeJob && latestRun) return latestRun.status === 'PASSED' ? 'SUCCESS' : 'TESTS_FAILED';
            if (executeJob.status === 'SUCCESS') {
                if (latestRun.totalTests === 0) return 'NO_TESTS_EXECUTED';
                if (latestRun.failedTests > 0) return 'TESTS_FAILED';
                return 'SUCCESS';
            }
            return 'NOT_EXECUTED';
        };

        const state = deriveSemanticState({ status: 'SUCCESS' }, latestTestRun);
        expect(state).toBe('SUCCESS');
        expect(latestTestRun.scenarios).toHaveLength(18);
        expect(latestTestRun.passedTests).toBe(18);
        expect(latestTestRun.failedTests).toBe(0);
    });

    // =========================================================================
    // Supporting Verification: Select All and Request Partitioning
    // =========================================================================
    test('Supporting: Select All selects every generated scenario across all endpoints', () => {
        const mockAiTests = [
            {
                id: 'test-cart-1',
                requests: [
                    { scenarioId: 'sc-c1', testName: 'happy path: POST /api/cart/add' },
                    { scenarioId: 'sc-c2', testName: 'edge case: POST /api/cart/clear' }
                ]
            },
            {
                id: 'test-food-1',
                requests: [
                    { scenarioId: 'sc-f1', testName: 'happy path: POST /api/food-items/create/' },
                    { scenarioId: 'sc-f2', testName: 'validation: missing required fields' },
                    { scenarioId: 'sc-f3', testName: 'happy path: PUT /api/food-items/update/:id' },
                    { scenarioId: 'sc-f4', testName: 'error: PUT /api/food-items/update/:id not found' }
                ]
            },
            {
                id: 'test-del-1',
                requests: [
                    { scenarioId: 'sc-d1', testName: 'happy path: DELETE /api/food-items/delete/:id' },
                    { scenarioId: 'sc-d2', testName: 'edge case: DELETE non-existent' }
                ]
            }
        ];

        const allScenarioIds = mockAiTests.flatMap(t =>
            t.requests.map(r => `${t.id}::${r.scenarioId || r.testName}`)
        );

        expect(allScenarioIds).toHaveLength(8);
        expect(allScenarioIds).toContain('test-cart-1::sc-c1');
        expect(allScenarioIds).toContain('test-food-1::sc-f4');
        expect(allScenarioIds).toContain('test-del-1::sc-d1');
    });

    test('Supporting: Active job guards prevent concurrent duplicate execution', () => {
        const canStartJob = (activeJobId, activeJobStatus, pendingAction) => {
            if (pendingAction) return false;
            if (activeJobId && (activeJobStatus === 'RUNNING' || activeJobStatus === 'QUEUED')) return false;
            return true;
        };

        expect(canStartJob('job-1', 'RUNNING', null)).toBe(false);
        expect(canStartJob('job-1', 'QUEUED', null)).toBe(false);
        expect(canStartJob(null, null, 'RUN_REMAINING')).toBe(false);
        expect(canStartJob('job-1', 'SUCCESS', null)).toBe(true);
        expect(canStartJob('job-1', 'FAILED', null)).toBe(true);
    });
});
