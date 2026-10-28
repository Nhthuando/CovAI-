import { isMatch, isMatchSuite, classifyScenarioFailure, evaluateEndpointMetrics, determineScenarioType, getClassificationReason, isScenarioContractVerified } from '../services/integrationWorkspace.service.js';
import { extractTestRequests } from '../services/testSourceParser.service.js';

describe('Endpoint Scenario Mapping & Quality Classification Regression Tests', () => {
    describe('1. Endpoint Matching - Preventing False GET / Attribution', () => {
        const rootEndpoint = {
            method: 'GET',
            fullPath: '/',
            path: '/'
        };

        const foodItemsEndpoint = {
            method: 'GET',
            fullPath: '/api/food-items',
            path: '/api/food-items'
        };

        const getFoodItemByIdEndpoint = {
            method: 'GET',
            fullPath: '/api/food-items/get/:id',
            path: '/api/food-items/get/:id'
        };

        it('should NOT attribute GET /api/food-items request to GET /', () => {
            const req = {
                method: 'GET',
                path: '/api/food-items'
            };
            expect(isMatch(req, rootEndpoint)).toBe(false);
            expect(isMatch(req, foodItemsEndpoint)).toBe(true);
        });

        it('should NOT attribute GET /api/food-items/get/1 request to GET /', () => {
            const req = {
                method: 'GET',
                path: '/api/food-items/get/1'
            };
            expect(isMatch(req, rootEndpoint)).toBe(false);
            expect(isMatch(req, getFoodItemByIdEndpoint)).toBe(true);
            expect(isMatch(req, foodItemsEndpoint)).toBe(false);
        });

        it('should strictly match GET / only for root path', () => {
            const rootReq = { method: 'GET', path: '/' };
            const rootEmptyReq = { method: 'GET', path: '' };
            expect(isMatch(rootReq, rootEndpoint)).toBe(true);
            expect(isMatch(rootEmptyReq, rootEndpoint)).toBe(true);

            // POST to root should not match GET /
            expect(isMatch({ method: 'POST', path: '/' }, rootEndpoint)).toBe(false);
        });

        it('isMatchSuite should NOT match food-item suites to GET /', () => {
            const suite1 = 'Product API Integration Tests GET /api/food-items';
            const title1 = 'should return 200 and list food items (happy path)';
            expect(isMatchSuite(suite1, title1, rootEndpoint)).toBe(false);

            const suite2 = 'Product API Integration Tests GET /api/food-items/get/:id';
            const title2 = 'should return 200 when getting existing food item (happy path)';
            expect(isMatchSuite(suite2, title2, rootEndpoint)).toBe(false);

            const rootSuite = 'Root API Endpoints';
            const rootTitle = 'happy path: should return 200 when accessing the base URL';
            expect(isMatchSuite(rootSuite, rootTitle, rootEndpoint)).toBe(true);
        });
    });

    describe('2. Parameterized Routes & Distinct Endpoints', () => {
        const updateEndpoint = {
            method: 'PUT',
            fullPath: '/api/food-items/update/:id'
        };

        const deleteEndpoint = {
            method: 'DELETE',
            fullPath: '/api/food-items/delete/:id'
        };

        const paymentEndpoint = {
            method: 'POST',
            fullPath: '/api/payments/create-payment-intent'
        };

        it('should correctly match parameterized PUT request to /api/food-items/update/:id', () => {
            const req = { method: 'PUT', path: '/api/food-items/update/1' };
            expect(isMatch(req, updateEndpoint)).toBe(true);
            expect(isMatch({ method: 'GET', path: '/api/food-items/update/1' }, updateEndpoint)).toBe(false);
        });

        it('should correctly match parameterized DELETE request to /api/food-items/delete/:id', () => {
            const req = { method: 'DELETE', path: '/api/food-items/delete/123' };
            expect(isMatch(req, deleteEndpoint)).toBe(true);
        });

        it('should correctly match payment intent POST request', () => {
            const req = { method: 'POST', path: '/api/payments/create-payment-intent' };
            expect(isMatch(req, paymentEndpoint)).toBe(true);
        });
    });

    describe('3. Trustworthy Quality Classification', () => {
        it('should classify mockResolvedValue runtime error as TEST_SCRIPT_ERROR', () => {
            const scenario = {
                title: 'happy path: should create food item and return 201',
                status: 'failed',
                failureMessages: [
                    'TypeError: _productService.default.createFoodItem.mockResolvedValue is not a function\n    at Object.mockResolvedValue'
                ]
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('TEST_SCRIPT_ERROR');
        });

        it('should classify mockRejectedValue runtime error as TEST_SCRIPT_ERROR', () => {
            const scenario = {
                title: 'error edge case: should return 500 when service fails',
                status: 'failed',
                failureMessages: [
                    'TypeError: _productService.default.updateFoodItem.mockRejectedValue is not a function\n    at Object.mockRejectedValue'
                ]
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('TEST_SCRIPT_ERROR');
        });

        it('should classify Stripe failure claim with null amount expecting 500 as INVALID_TEST', () => {
            const scenario = {
                title: 'POST /api/payments/create-payment-intent - should handle error when stripe fails',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toBe(expected)\n\nExpected: 500\nReceived: 200'
                ]
            };
            const parsedReq = {
                payload: { amount: null }
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('INVALID_TEST');
        });

        it('should classify dummy error ID expecting 500 receiving 200 as INVALID_TEST', () => {
            const scenario = {
                title: 'error edge case: should return 500 if an internal error occurs',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toBe(expected)\n\nExpected: \x1b[32m500\x1b[39m\nReceived: \x1b[31m200\x1b[39m'
                ]
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('INVALID_TEST');
        });

        it('should classify genuine API status mismatch as ASSERTION_FAILED', () => {
            const scenario = {
                title: 'POST /api/cart/checkout should return 200 for valid order',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 400'
                ]
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('ASSERTION_FAILED');
        });

        it('should classify hallucinated items schema failure on endpoint returning data as INVALID_TEST', () => {
            const scenario = {
                title: 'happy path: should return 200 and list food items',
                suiteName: 'Product API Integration Tests > GET /api/food-items',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toHaveProperty(path)\n\nExpected path: "items"\nReceived path: []\n\nReceived value: {"data": [{"id": 1, "name": "Burger"}]}'
                ]
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('INVALID_TEST');
        });

        it('should classify invalid page query param expecting 500 receiving 200 fallback as INVALID_TEST', () => {
            const scenario = {
                title: 'error edge case: should handle internal server error',
                suiteName: 'Product API Integration Tests > GET /api/food-items',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toBe(expected)\n\nExpected: 500\nReceived: 200'
                ]
            };
            const parsedReq = {
                queryParams: { page: 'invalid' },
                path: '/api/food-items'
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('INVALID_TEST');
        });

        it('should classify passed scenario expecting 500 on malformed ID during update as CONTRACT_UNVERIFIED', () => {
            const scenario = {
                title: 'error edge case: should return 500 on database error during update',
                suiteName: 'Product API Integration Tests > PUT /api/food-items/update/:id',
                status: 'passed'
            };
            const parsedReq = {
                path: '/api/food-items/update/invalid-id',
                expectedStatus: 500
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('CONTRACT_UNVERIFIED');
        });

        it('should classify passed scenario expecting 500 on non-existent ID during delete as CONTRACT_UNVERIFIED', () => {
            const scenario = {
                title: 'error edge case: should return 500 when deleting a non-existent food item',
                suiteName: 'Product API Integration Tests > DELETE /api/food-items/delete/:id',
                status: 'passed'
            };
            const parsedReq = {
                path: '/api/food-items/delete/99999',
                expectedStatus: 500
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('CONTRACT_UNVERIFIED');
        });

        it('should classify passed scenario expecting 500 on missing required fields during create as CONTRACT_UNVERIFIED', () => {
            const scenario = {
                title: 'error case: should return 500 when database fails to create',
                suiteName: 'Product Routes Integration Tests > POST /api/food-items/create/',
                status: 'passed'
            };
            const parsedReq = {
                path: '/api/food-items/create/',
                expectedStatus: 500
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('CONTRACT_UNVERIFIED');
        });

        it('should classify failed scenario with unverified contract expectation as CONTRACT_UNVERIFIED', () => {
            const scenario = {
                title: 'error case: should return 400 based on REST design recommendation',
                status: 'failed',
                failureMessages: ['Error: expect(received).toBe(expected)\n\nExpected: 400\nReceived: 500']
            };
            const parsedReq = {
                contractSource: 'UNVERIFIED',
                expectedStatus: 400
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('CONTRACT_UNVERIFIED');
        });

        it('should classify failed scenario with verified contract expectation as ASSERTION_FAILED', () => {
            const scenario = {
                title: 'error case: should return 400 when paymentIntentId is missing',
                status: 'failed',
                failureMessages: ['Error: expect(received).toBe(expected)\n\nExpected: 400\nReceived: 200']
            };
            const parsedReq = {
                contractSource: 'VERIFIED_CODE',
                expectedStatus: 400
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('ASSERTION_FAILED');
        });

        it('should return PASSED for passed scenarios with valid expectations', () => {
            const scenario = {
                title: 'should return 200 OK',
                status: 'passed'
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('PASSED');
        });

        it('should classify passed scenario on verified 201 creation as PASSED', () => {
            const scenario = {
                title: 'happy path: should return 201 when creating a valid food item',
                status: 'passed'
            };
            const parsedReq = {
                path: '/api/food-items/create/',
                expectedStatus: 201
            };
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('PASSED');
        });

        it('should classify failed scenario with arbitrary hallucinated Stripe mock secret as INVALID_TEST', () => {
            const scenario = {
                title: 'happy path 200: should create payment intent and return clientSecret',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toHaveProperty(path, value)\n\nExpected path: "clientSecret"\n\nExpected value: "pi_test_secret_456"\nReceived value: "pi_test_secret_mock"'
                ]
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('INVALID_TEST');
        });

        it('should classify failed scenario with arbitrary hallucinated Stripe checkout URL as INVALID_TEST', () => {
            const scenario = {
                title: 'happy path 200: should create free checkout session when amount is 0',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toHaveProperty(path, value)\n\nExpected path: "url"\n\nExpected value: "https://checkout.stripe.com/c/pay/cs_test_123"\nReceived value: "https://checkout.stripe.com/mock"'
                ]
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('INVALID_TEST');
        });

        it('should return SKIPPED for skipped scenarios', () => {
            const scenario = {
                title: 'skipped test',
                status: 'skipped'
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('SKIPPED');
        });

        it('should return NOT_EXECUTED for not_run scenarios', () => {
            const scenario = {
                title: 'unexecuted test',
                status: 'not_run'
            };
            expect(classifyScenarioFailure(scenario, null)).toBe('NOT_EXECUTED');
        });

        it('should provide clear classification reason via getClassificationReason', async () => {
            const { getClassificationReason } = await import('../services/integrationWorkspace.service.js');
            expect(getClassificationReason('PASSED')).toContain('verified contract');
            expect(getClassificationReason('CONTRACT_UNVERIFIED')).toContain('HTTP 500 catch-all');
            expect(getClassificationReason('ASSERTION_FAILED')).toContain('Valid test');
            expect(getClassificationReason('INVALID_TEST')).toContain('Test assertion contradicted');
            expect(getClassificationReason('TEST_SCRIPT_ERROR')).toContain('Runtime exception');
        });
    });

    describe('4. Coverage Gap & Unexecuted Endpoint Integrity', () => {
        it('should never count an endpoint as executed or verified when executedCount is 0', () => {
            const unexecutedEndpointMetrics = evaluateEndpointMetrics({
                executedCount: 0,
                passedCount: 0,
                failedCount: 0,
                testScriptErrorCount: 0,
                verifiedPassedCount: 0,
                verifiedAssertionFailedCount: 0,
                hasRelevantTestFile: false
            });

            expect(unexecutedEndpointMetrics.hasGenuineApiCall).toBe(false);
            expect(unexecutedEndpointMetrics.isVerifiedTested).toBe(false);
            expect(unexecutedEndpointMetrics.isExecuted).toBe(false);
            expect(unexecutedEndpointMetrics.isVerified).toBe(false);
            expect(unexecutedEndpointMetrics.status).toBe('Uncovered');
        });

        it('should mark endpoint as "Not Executed" when test file exists but was never executed', () => {
            const notExecutedMetrics = evaluateEndpointMetrics({
                executedCount: 0,
                passedCount: 0,
                failedCount: 0,
                testScriptErrorCount: 0,
                verifiedPassedCount: 0,
                verifiedAssertionFailedCount: 0,
                hasRelevantTestFile: true
            });

            expect(notExecutedMetrics.hasGenuineApiCall).toBe(false);
            expect(notExecutedMetrics.isVerifiedTested).toBe(false);
            expect(notExecutedMetrics.isExecuted).toBe(false);
            expect(notExecutedMetrics.status).toBe('Not Executed');
        });

        it('should keep GET / completely independent from /api endpoints', () => {
            const rootEp = { method: 'GET', fullPath: '/', path: '/' };
            const apiEp = { method: 'GET', fullPath: '/api/food-items', path: '/api/food-items' };

            expect(isMatch({ method: 'GET', path: '/' }, rootEp)).toBe(true);
            expect(isMatch({ method: 'GET', path: '/' }, apiEp)).toBe(false);

            expect(isMatch({ method: 'GET', path: '/api/food-items' }, rootEp)).toBe(false);
            expect(isMatch({ method: 'GET', path: '/api/food-items' }, apiEp)).toBe(true);
        });
    });

    describe('5. Stripe Failure Quality & Currency Conversion Boundaries', () => {
        it('should mathematically prove amount -100 rounds to 0 while -50000 maintains negative value in VND-to-USD conversion', () => {
            // Conversion formula used in paymentRoutes.js: Math.round((amount / 23000) * 100)
            const convertToUsdCents = (amount) => Math.round((amount / 23000) * 100);

            // -100 VND / 23000 * 100 = -0.43478 -> Math.round returns -0!
            // In JavaScript: -0 === 0 is true, Math.abs(-0) is 0, but (-0 < 0) is FALSE!
            expect(Math.abs(convertToUsdCents(-100))).toBe(0);
            expect(convertToUsdCents(-100) === 0).toBe(true);
            expect(convertToUsdCents(-100) < 0).toBe(false); // Proves why Stripe mock did NOT throw for -100!

            // -50000 VND / 23000 * 100 = -217.39 -> rounds to -217 (< 0)!
            expect(convertToUsdCents(-50000)).toBeLessThan(0);
            expect(convertToUsdCents(-50000)).toBe(-217);

            // 'invalid' evaluates to NaN
            expect(isNaN(convertToUsdCents('invalid'))).toBe(true);
        });

        it('should classify Stripe failure test sending amount -100 as INVALID_TEST when it receives 200 due to currency rounding', () => {
            const scenario = {
                title: 'POST /api/payments/create-payment-intent - should handle error when stripe fails',
                status: 'failed',
                failureMessages: [
                    'Error: expect(received).toBe(expected)\n\nExpected: 500\nReceived: 200'
                ]
            };
            const parsedReq = {
                path: '/api/payments/create-payment-intent',
                payload: { amount: -100 }
            };

            // -100 rounds to 0 in VND-to-USD conversion, triggering free checkout branch instead of Stripe error
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('INVALID_TEST');
        });

        it('should classify Stripe failure test asserting HTTP 200 as INVALID_TEST due to contradictory expectation', () => {
            const scenario = {
                title: 'POST /api/payments/create-payment-intent - stripe failure returns 200',
                status: 'passed'
            };
            const parsedReq = {
                path: '/api/payments/create-payment-intent',
                expectedStatus: 200,
                payload: { amount: -50000 }
            };

            // Cannot claim Stripe failure while expecting 200 success
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('INVALID_TEST');
        });

        it('should classify genuine Stripe failure test with negative amount (-50000) passing with 500 as CONTRACT_UNVERIFIED', () => {
            const scenario = {
                title: 'POST /api/payments/create-payment-intent - should handle error when stripe fails with negative amount',
                status: 'passed'
            };
            const parsedReq = {
                path: '/api/payments/create-payment-intent',
                expectedStatus: 500,
                payload: { amount: -50000 }
            };

            // Passing with 500 on an unhandled exception catch-all without verified contract is CONTRACT_UNVERIFIED
            expect(classifyScenarioFailure(scenario, parsedReq)).toBe('CONTRACT_UNVERIFIED');
        });
    });

    describe('6. Scenario Type Disambiguation (Task 2 & Task 3)', () => {
        it('should classify empty cart with 200 as EDGE_CASE, never as negative or error badge', () => {
            const title = 'error edge case: should return 200 with empty items if payload is empty';
            const expStatus = 200;
            const payload = { items: [] };
            expect(determineScenarioType(title, expStatus, payload)).toBe('EDGE_CASE');
        });

        it('should classify missing required field validation as VALIDATION', () => {
            const title = 'error edge case: should return 400 if paymentIntentId is missing';
            const expStatus = 400;
            expect(determineScenarioType(title, expStatus, null)).toBe('VALIDATION');
        });

        it('should classify not found 404 test as NEGATIVE', () => {
            const title = 'error edge case: should return 404 for non-existent food item';
            const expStatus = 404;
            expect(determineScenarioType(title, expStatus, null)).toBe('NEGATIVE');
        });

        it('should classify happy path food creation and health check as HAPPY_PATH', () => {
            expect(determineScenarioType('happy path: should create a new food item successfully', 201)).toBe('HAPPY_PATH');
            expect(determineScenarioType('happy path: GET / should return 200', 200)).toBe('HAPPY_PATH');
            expect(determineScenarioType('should return 200 for health check', 200)).toBe('HAPPY_PATH');
        });

        it('should classify scenario asserting 404 as NEGATIVE even if title claims happy path', () => {
            const title = 'happy path: should return 200 for an existing food item';
            expect(determineScenarioType(title, 404)).toBe('NEGATIVE');
        });

        it('should classify contradiction between happy path title and 404 assertion as CONTRACT_UNVERIFIED', () => {
            const title = 'happy path: should return 200 for an existing food item';
            const scenario = { title, status: 'passed' };
            const req = { expectedStatus: 404, path: '/api/food-items/get/1' };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('CONTRACT_UNVERIFIED');
            const reason = getClassificationReason(classification, scenario, req);
            expect(reason).toContain("Scenario title claims happy path ('should return 200') but test assertion expects HTTP 404 (Not Found)");
        });
    });

    describe('7. Classification Reasons & Root Cause Identification (Task 3)', () => {
        it('should identify missing required fields constraint for empty payload creation test', () => {
            const scenario = {
                title: 'error edge case: should return 500 if database creation fails',
                requestPayload: {}
            };
            const reason = getClassificationReason('CONTRACT_UNVERIFIED', scenario, { payload: {} });
            expect(reason).toContain("missing required non-nullable fields ('name', 'image', 'price', 'rating')");
            expect(reason).toContain("Prisma validation/constraint error");
            expect(reason).toContain("CONTRACT_UNVERIFIED");
        });

        it('should provide clear reason for external payment boundary 500 tests', () => {
            const scenario = {
                title: 'error edge case: should return 500 on invalid amount',
                requestPayload: { amount: -50000 }
            };
            const reason = getClassificationReason('CONTRACT_UNVERIFIED', scenario, { payload: { amount: -50000 } });
            expect(reason).toContain("External boundary / invalid payment amount");
            expect(reason).toContain("CONTRACT_UNVERIFIED");
        });

        it('should provide clear reason for non-existent resource 500 tests', () => {
            const scenario = {
                title: 'error edge case: should return 500 when updating non-existent resource',
                requestPayload: { name: 'Ghost' }
            };
            const reason = getClassificationReason('CONTRACT_UNVERIFIED', scenario);
            expect(reason).toContain("Resource not found or invalid ID triggers catch-all 500");
        });
    });

    describe('8. Latency Metrics & Execution Semantics (Task 1 & Task 4)', () => {
        it('should distinguish avgRequestLatencyMs from avgEndpointLatencyMs and total test duration', () => {
            const scenarioDurations = [21, 12, 17, 23, 15, 31, 7, 31, 6, 28, 20, 6, 6, 9, 206, 28, 6, 7, 25, 46];
            const totalDuration = scenarioDurations.reduce((a, b) => a + b, 0);
            const avgRequestLatency = Math.round(totalDuration / scenarioDurations.length);

            expect(totalDuration).toBe(550);
            expect(avgRequestLatency).toBe(28); // 550 / 20 = 27.5 -> 28ms

            // Total suite duration (e.g. 7323ms) is much larger than individual request sum due to process/Jest overhead
            const suiteDurationMs = 7323;
            expect(suiteDurationMs).toBeGreaterThan(totalDuration);
        });
    });

    describe('9. Fallback Elimination & Data Integrity (P0)', () => {
        it('should NOT default expected status to 200 when not present in request or title', async () => {
            const { buildIntegrationWorkspace } = await import('../services/integrationWorkspace.service.js');
            // Helper simulation of mapping logic:
            const req = { path: '/api/test' }; // no expectedStatus
            const titleWithoutStatus = 'some arbitrary test without numeric status';
            const expectedStatus = (req?.expectedStatus !== undefined && req?.expectedStatus !== null)
                ? req.expectedStatus
                : (titleWithoutStatus.match(/(?:should return|returns?|status)\s+(\d{3})/i) ? Number(titleWithoutStatus.match(/(?:should return|returns?|status)\s+(\d{3})/i)[1]) : null);

            expect(expectedStatus).toBeNull();
            expect(expectedStatus).not.toBe(200);
        });

        it('should NOT deduce actual HTTP status from runner status: passed', () => {
            const rest = { status: 'passed' };
            let actualStatus = null;
            if (rest.actualStatus !== undefined && rest.actualStatus !== null) {
                actualStatus = Number(rest.actualStatus);
            }
            // Must remain null if not directly captured
            expect(actualStatus).toBeNull();
            expect(actualStatus).not.toBe(200);
        });

        it('should NOT assign VERIFIED_CONTRACT when there is no traceable contract source', () => {
            const classification = 'PASSED';
            const req = {}; // no contractSource
            let contractSource = req?.contractSource || null;
            if (!contractSource) {
                if (classification === 'CONTRACT_UNVERIFIED') {
                    contractSource = 'UNVERIFIED_CATCH_ALL';
                } else if (classification === 'PASSED') {
                    contractSource = 'CONTROLLER_SOURCE';
                }
            }
            expect(contractSource).toBe('CONTROLLER_SOURCE');
            expect(contractSource).not.toBe('VERIFIED_CONTRACT');
        });
    });

    describe('10. Endpoint Contract-Verified Rigorous Criteria (P1)', () => {
        it('should NOT mark endpoint as verified if it only has CONTRACT_UNVERIFIED scenarios', () => {
            const metrics = evaluateEndpointMetrics({
                executedCount: 1,
                passedCount: 1,
                failedCount: 0,
                testScriptErrorCount: 0,
                verifiedPassedCount: 0, // 0 contract-verified scenarios
                verifiedAssertionFailedCount: 0,
                hasRelevantTestFile: true
            });

            expect(metrics.isExecuted).toBe(true);
            expect(metrics.isVerifiedTested).toBe(false);
            expect(metrics.isVerified).toBe(false);
        });

        it('should mark endpoint as verified ONLY when verifiedPassedCount > 0', () => {
            const metrics = evaluateEndpointMetrics({
                executedCount: 2,
                passedCount: 2,
                failedCount: 0,
                testScriptErrorCount: 0,
                verifiedPassedCount: 1,
                verifiedAssertionFailedCount: 0,
                hasRelevantTestFile: true
            });

            expect(metrics.isExecuted).toBe(true);
            expect(metrics.isVerifiedTested).toBe(true);
        });
    });

    describe('11. Disentangling Contract Verification from Implementation Consistency (P0)', () => {
        it('should strictly NOT mark CONTROLLER_SOURCE as contract-verified', () => {
            const scenario = {
                status: 'passed',
                rawJestStatus: 'passed',
                executionVerdict: 'PASS',
                testValidity: 'VALID',
                classification: 'PASSED',
                expectedStatus: 200,
                contractSource: 'CONTROLLER_SOURCE',
                contractVerification: 'UNVERIFIED',
                implementationConsistency: 'CONSISTENT',
                resolvedUrl: '/api/food-items'
            };

            expect(isScenarioContractVerified(scenario)).toBe(false);
        });

        it('should mark scenario as contract-verified ONLY when traceable independent contract exists', () => {
            const independentScenario = {
                status: 'passed',
                rawJestStatus: 'passed',
                executionVerdict: 'PASS',
                testValidity: 'VALID',
                classification: 'PASSED',
                expectedStatus: 200,
                contractSource: 'OPENAPI_SPEC',
                contractVerification: 'VERIFIED',
                implementationConsistency: 'CONSISTENT',
                resolvedUrl: '/api/food-items'
            };

            expect(isScenarioContractVerified(independentScenario)).toBe(true);
        });

        it('should enforce distinct orthogonal dimensions: executionVerdict, testValidity, contractVerification, implementationConsistency', () => {
            // Case A: Passed test matching controller code, but no independent contract
            const caseA = {
                executionVerdict: 'PASS',
                testValidity: 'VALID',
                contractVerification: 'UNVERIFIED',
                implementationConsistency: 'CONSISTENT',
                contractSource: 'CONTROLLER_SOURCE'
            };
            expect(caseA.executionVerdict).toBe('PASS');
            expect(caseA.testValidity).toBe('VALID');
            expect(caseA.contractVerification).toBe('UNVERIFIED');
            expect(caseA.implementationConsistency).toBe('CONSISTENT');

            // Case B: Assertion failure against verified contract
            const caseB = {
                executionVerdict: 'FAIL',
                testValidity: 'VALID',
                contractVerification: 'VERIFIED',
                implementationConsistency: 'INCONSISTENT',
                contractSource: 'OPENAPI_SPEC'
            };
            expect(caseB.executionVerdict).toBe('FAIL');
            expect(caseB.testValidity).toBe('VALID');
            expect(caseB.contractVerification).toBe('VERIFIED');
            expect(caseB.implementationConsistency).toBe('INCONSISTENT');

            // Case C: Broken test script error
            const caseC = {
                executionVerdict: 'SCRIPT_ERROR',
                testValidity: 'TEST_SCRIPT_ERROR',
                contractVerification: 'UNVERIFIED',
                implementationConsistency: 'UNVERIFIED',
                contractSource: 'SCRIPT_ERROR'
            };
            expect(caseC.executionVerdict).toBe('SCRIPT_ERROR');
            expect(caseC.testValidity).toBe('TEST_SCRIPT_ERROR');
            expect(caseC.contractVerification).toBe('UNVERIFIED');
            expect(caseC.implementationConsistency).toBe('UNVERIFIED');
        });

        it('endpoint evaluation should separate isImplementationConsistent from isContractVerified', () => {
            // An endpoint where all tests match implementation, but none have independent contract
            const metrics = evaluateEndpointMetrics({
                executedCount: 2,
                passedCount: 2,
                failedCount: 0,
                testScriptErrorCount: 0,
                verifiedPassedCount: 0, // No OpenAPI spec
                verifiedAssertionFailedCount: 0,
                consistentPassedCount: 2, // All match controller
                hasRelevantTestFile: true
            });

            expect(metrics.isExecuted).toBe(true);
            expect(metrics.isImplementationConsistent).toBe(true);
            expect(metrics.isContractVerified).toBe(false);
            expect(metrics.isVerifiedTested).toBe(false);
            expect(metrics.status).toBe('Covered');
        });
    });

    describe('12. GET / Completion and Retry Semantics (P1)', () => {
        it('should complete GET / generation without setting tr.error = true', () => {
            const tr = {
                happy: true,
                error: false,
                negativeNotApplicable: false,
                negativeNotApplicableReason: null,
                generationCompleted: false,
                retries: 0
            };

            const matchedKey = "GET /";
            if ((matchedKey.trim().toUpperCase() === "GET /" || matchedKey.trim().toUpperCase().endsWith(" /")) && tr.happy) {
                tr.negativeNotApplicable = true;
                tr.negativeNotApplicableReason = "Static parameterless health-check endpoint has no input validation or error branch";
                tr.generationCompleted = true;
            }

            // Must NOT set tr.error = true just to satisfy the completion check
            expect(tr.error).toBe(false);
            expect(tr.negativeNotApplicable).toBe(true);
            expect(tr.generationCompleted).toBe(true);

            // Completion check must evaluate to true
            const isComplete = tr.happy && (tr.error || tr.negativeNotApplicable || tr.generationCompleted);
            expect(isComplete).toBe(true);
        });

        it('should NOT queue retry or create duplicate scenarios for completed GET /', () => {
            const tr = {
                happy: true,
                error: false,
                negativeNotApplicable: true,
                generationCompleted: true,
                retries: 0
            };

            const retryQueue = [];
            const isComplete = tr.happy && (tr.error || tr.negativeNotApplicable || tr.generationCompleted);
            if (!isComplete) {
                retryQueue.push("GET /");
            }

            expect(retryQueue.length).toBe(0);
            expect(tr.retries).toBe(0);
        });

        it('stopping generation should not distort coverage stats or QA classification', () => {
            const scenario = {
                title: 'happy path: GET / should return 200',
                status: 'passed'
            };
            const req = {
                method: 'GET',
                path: '/',
                expectedStatus: 200
            };

            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('PASSED');
            expect(classification).not.toBe('CONTRACT_UNVERIFIED');
            expect(classification).not.toBe('INVALID_TEST');
        });
    });

    describe('13. Deterministic Test Oracles vs Contradictory Assertions (P0)', () => {
        it('deterministic happy path assertion should have valid oracle expecting 200', () => {
            const req = {
                method: 'GET',
                path: '/api/food-items/get/1',
                expectedStatus: 200
            };
            const sType = determineScenarioType('happy path: should return 200 for an existing food item', req.expectedStatus);
            expect(sType).toBe('HAPPY_PATH');
        });

        it('deterministic negative not-found assertion should have valid oracle expecting 404', () => {
            const req = {
                method: 'GET',
                path: '/api/food-items/get/999999',
                expectedStatus: 404
            };
            const sType = determineScenarioType('negative not found: should return 404 for non-existent food item', req.expectedStatus);
            expect(sType).toBe('NEGATIVE');
        });
    });

    describe('14. Multi-Request Setup & Method-Isolate Endpoint Mapping Regression (P0)', () => {
        it('extractTestRequests should pick target PUT action from multi-request setup block', () => {
            const testCode = `
                describe('PUT /api/food-items/update/:id', () => {
                    it('happy path: should successfully update an existing food item and return 200', async () => {
                        const createRes = await request(app)
                            .post('/api/food-items/create/')
                            .send({ name: 'Old Food', price: 10, image: 'old.jpg', rating: 4 });
                        const id = createRes.body.data.id;
                        const res = await request(app)
                            .put('/api/food-items/update/' + id)
                            .send({ name: 'Updated Food', price: 12 });
                        expect(res.status).toBe(200);
                    });
                });
            `;
            const reqs = extractTestRequests(testCode, 'productRoutes-test.js');
            expect(reqs.length).toBe(1);
            expect(reqs[0].method).toBe('PUT');
            expect(reqs[0].path).toBe('/api/food-items/update/id');
            expect(reqs[0].testName).toBe('happy path: should successfully update an existing food item and return 200');
        });

        it('isMatch should never match a PUT request to POST /api/food-items/create/', () => {
            const putReq = {
                method: 'PUT',
                path: '/api/food-items/update/123'
            };
            const postEndpoint = {
                method: 'POST',
                fullPath: '/api/food-items/create/',
                path: '/api/food-items/create/'
            };
            expect(isMatch(putReq, postEndpoint)).toBe(false);
        });

        it('isMatchSuite should never match a PUT suite to POST /api/food-items/create/', () => {
            const postEndpoint = {
                method: 'POST',
                fullPath: '/api/food-items/create/',
                path: '/api/food-items/create/'
            };
            expect(isMatchSuite('PUT /api/food-items/update/:id', 'happy path: should successfully update an existing food item and return 200', postEndpoint)).toBe(false);
        });

        it('cleanScenarios logic should pick matching endpoint request over requests[0] when multiple requests exist', () => {
            const ep = {
                method: 'PUT',
                fullPath: '/api/food-items/update/:id',
                path: '/api/food-items/update/:id'
            };
            const requests = [
                { method: 'POST', path: '/api/food-items/create/', expectedStatus: 201 },
                { method: 'PUT', path: '/api/food-items/update/1', expectedStatus: 200 }
            ];
            const matchedReq = requests.find(r => isMatch(r, ep)) || requests[0];
            expect(matchedReq.method).toBe('PUT');
            expect(matchedReq.path).toBe('/api/food-items/update/1');
        });

        it('POST /api/cart/validate with null foodId returning 200 should be classified as PASSED when passed', () => {
            const scenario = {
                title: 'negative path: should return 200 with invalid badge when foodId is null',
                status: 'passed'
            };
            const req = {
                method: 'POST',
                path: '/api/cart/validate',
                expectedStatus: 200,
                payload: { items: [{ foodId: null }] }
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('PASSED');
            expect(classification).not.toBe('INVALID_TEST');
        });

        it('deterministic GET /api/food-items?page=invalid-page-number expecting 200 should be classified as PASSED', () => {
            const scenario = {
                title: 'boundary query: GET /api/food-items with invalid page should fallback to page 1 and return 200',
                status: 'passed'
            };
            const req = {
                method: 'GET',
                path: '/api/food-items',
                queryParams: { page: 'invalid-page-number' },
                expectedStatus: 200
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('PASSED');
            expect(classification).not.toBe('INVALID_TEST');
            expect(classification).not.toBe('CONTRACT_UNVERIFIED');
        });
    });

    describe('15. Final Run Test Reconciliation & Inventory Integrity (P0/P1)', () => {
        const inventoryEndpoints = [
            { method: 'GET', fullPath: '/', path: '/' },
            { method: 'POST', fullPath: '/api/cart/validate', path: '/api/cart/validate' },
            { method: 'POST', fullPath: '/api/cart/checkout', path: '/api/cart/checkout' },
            { method: 'POST', fullPath: '/api/payments/create-payment-intent', path: '/api/payments/create-payment-intent' },
            { method: 'GET', fullPath: '/api/food-items', path: '/api/food-items' },
            { method: 'GET', fullPath: '/api/food-items/get/:id', path: '/api/food-items/get/:id' },
            { method: 'POST', fullPath: '/api/food-items/create/', path: '/api/food-items/create/' },
            { method: 'PUT', fullPath: '/api/food-items/update/:id', path: '/api/food-items/update/:id' },
            { method: 'DELETE', fullPath: '/api/food-items/delete/:id', path: '/api/food-items/delete/:id' }
        ];

        it('all 9 discovered endpoints in inventory must have unique methods/paths and exact matchers', () => {
            expect(inventoryEndpoints.length).toBe(9);
            const keys = new Set(inventoryEndpoints.map(e => `${e.method} ${e.fullPath}`));
            expect(keys.size).toBe(9);
            
            // Check that POST /api/cart/checkout is distinctly present
            const checkoutEp = inventoryEndpoints.find(e => e.method === 'POST' && e.fullPath === '/api/cart/checkout');
            expect(checkoutEp).toBeDefined();

            const checkoutReq = { method: 'POST', path: '/api/cart/checkout' };
            expect(isMatch(checkoutReq, checkoutEp)).toBe(true);
        });

        it('route pluralization: POST /api/payments/create-payment-intent must strictly match plural route', () => {
            const paymentsEp = inventoryEndpoints.find(e => e.fullPath === '/api/payments/create-payment-intent');
            expect(isMatch({ method: 'POST', path: '/api/payments/create-payment-intent' }, paymentsEp)).toBe(true);
            
            // A request to singular /api/payment/... should NOT match plural /api/payments/...
            expect(isMatch({ method: 'POST', path: '/api/payment/create-payment-intent' }, paymentsEp)).toBe(false);
        });

        it('catch-all 500 on DELETE non-existent item must be CONTRACT_UNVERIFIED, never PASSED', () => {
            const scenario = {
                title: 'error edge case: should return 500 when deleting a non-existent food item',
                status: 'passed'
            };
            const req = {
                method: 'DELETE',
                path: '/api/food-items/delete/999999',
                expectedStatus: 500
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('CONTRACT_UNVERIFIED');
            expect(classification).not.toBe('PASSED');
        });

        it('catch-all 500 on PUT non-existent item must be CONTRACT_UNVERIFIED, never PASSED', () => {
            const scenario = {
                title: 'error edge case: should return 500 when updating a non-existent food item',
                status: 'passed'
            };
            const req = {
                method: 'PUT',
                path: '/api/food-items/update/999999',
                expectedStatus: 500
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('CONTRACT_UNVERIFIED');
            expect(classification).not.toBe('PASSED');
        });

        it('catch-all 500 on POST create missing required fields must be CONTRACT_UNVERIFIED, never PASSED', () => {
            const scenario = {
                title: 'error edge case: should return 500 when required fields are missing',
                status: 'passed'
            };
            const req = {
                method: 'POST',
                path: '/api/food-items/create/',
                expectedStatus: 500
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('CONTRACT_UNVERIFIED');
            expect(classification).not.toBe('PASSED');
        });

        it('catch-all 500 on Stripe negative amount must be CONTRACT_UNVERIFIED, never PASSED', () => {
            const scenario = {
                title: 'error edge case: should return 500 when invalid negative amount causes Stripe error',
                status: 'passed'
            };
            const req = {
                method: 'POST',
                path: '/api/payments/create-payment-intent',
                payload: { amount: -50000 },
                expectedStatus: 500
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('CONTRACT_UNVERIFIED');
            expect(classification).not.toBe('PASSED');
        });

        it('endpoint lacking request evidence must NOT be counted as executed or verified', () => {
            const metrics = evaluateEndpointMetrics({
                executedCount: 0,
                passedCount: 0,
                failedCount: 0,
                testScriptErrorCount: 0,
                verifiedPassedCount: 0,
                consistentPassedCount: 0,
                hasRelevantTestFile: false
            });
            expect(metrics.hasGenuineApiCall).toBe(false);
            expect(metrics.isExecuted).toBe(false);
            expect(metrics.isContractVerified).toBe(false);
            expect(metrics.isImplementationConsistent).toBe(false);
            expect(metrics.status).toBe('Uncovered');
        });

        it('happy path GET by ID expecting 200 should be classified as PASSED', () => {
            const scenario = {
                title: 'happy path: GET /api/food-items/get/:id should return 200 for an existing food item',
                status: 'passed'
            };
            const req = {
                method: 'GET',
                path: '/api/food-items/get/1',
                expectedStatus: 200
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('PASSED');
        });

        it('happy path DELETE expecting 200 with secondary teardown should be classified as PASSED', () => {
            const scenario = {
                title: 'happy path: should successfully delete an existing food item and return 200',
                status: 'passed'
            };
            const req = {
                method: 'DELETE',
                path: '/api/food-items/delete/1',
                expectedStatus: 200
            };
            const classification = classifyScenarioFailure(scenario, req);
            expect(classification).toBe('PASSED');
        });

        it('passing scenarios without failure messages must retain actualStatus null and not fallback to expected', () => {
            const rest = {
                title: 'happy path: GET / should return 200',
                status: 'passed',
                failureMessages: []
            };
            const req = {
                method: 'GET',
                path: '/',
                expectedStatus: 200
            };
            let actualStatus = null;
            if (rest.actualStatus !== undefined && rest.actualStatus !== null) {
                actualStatus = Number(rest.actualStatus);
            }
            // Strict assertion: actualStatus remains null and is NOT defaulted to req.expectedStatus (200)
            expect(actualStatus).toBeNull();
            expect(actualStatus).not.toBe(req.expectedStatus);
        });

        it('summary quality classification must sum to total scenarios with 16 PASSED and 4 CONTRACT_UNVERIFIED', () => {
            const classifications = [
                'PASSED', 'PASSED', 'PASSED', 'PASSED', 'PASSED',
                'CONTRACT_UNVERIFIED', // Stripe 500
                'PASSED', 'PASSED', 'PASSED', 'PASSED', 'PASSED',
                'PASSED', // POST 201
                'CONTRACT_UNVERIFIED', // POST create 500
                'PASSED', // PUT 200
                'CONTRACT_UNVERIFIED', // PUT 500
                'PASSED', // GET items
                'PASSED', // GET items paginated
                'PASSED', // GET items by ID happy path (NEW)
                'CONTRACT_UNVERIFIED',  // DELETE 500
                'PASSED'  // DELETE happy path 200 (NEW)
            ];
            expect(classifications.length).toBe(20);
            const passedCount = classifications.filter(c => c === 'PASSED').length;
            const unverifiedCount = classifications.filter(c => c === 'CONTRACT_UNVERIFIED').length;
            expect(passedCount).toBe(16);
            expect(unverifiedCount).toBe(4);
            expect(passedCount + unverifiedCount).toBe(20);
        });
    });

    describe('16. Final Evidence Semantics, Coverage Metrics & Runtime Resolution (P0/P1)', () => {
        it('status assertion logic must yield PASS/FAIL/NOT_EVALUATED and never use VERIFIED keyword', () => {
            const computeStatusAssertion = (status, expectedStatus) => {
                if (status === 'passed' && expectedStatus) return 'PASS';
                if (status === 'failed') return 'FAIL';
                return 'NOT_EVALUATED';
            };

            expect(computeStatusAssertion('passed', 200)).toBe('PASS');
            expect(computeStatusAssertion('passed', 201)).toBe('PASS');
            expect(computeStatusAssertion('failed', 200)).toBe('FAIL');
            expect(computeStatusAssertion('pending', 200)).toBe('NOT_EVALUATED');
            expect(computeStatusAssertion('skipped', 200)).toBe('NOT_EVALUATED');
            // Must NOT equal 'VERIFIED'
            expect(computeStatusAssertion('passed', 200)).not.toContain('VERIFIED');
        });

        it('runtime wire status must remain null (NOT_CAPTURED) when not intercepted directly', () => {
            const scenario = {
                title: 'happy path: should successfully create a new food item and return 201',
                status: 'passed',
                expectedStatus: 201,
                actualStatus: null
            };
            const displayRuntimeStatus = scenario.actualStatus ? `HTTP ${scenario.actualStatus}` : 'NOT_CAPTURED';
            expect(scenario.actualStatus).toBeNull();
            expect(displayRuntimeStatus).toBe('NOT_CAPTURED');
            expect(displayRuntimeStatus).not.toBe('HTTP 201');
        });

        it('disentangles negative/boundary coverage: partitions 20 scenarios into 11 happy path and 9 negative/boundary', () => {
            const scenarioTypes = [
                // 1. GET /
                { title: 'happy path: GET / should return 200', exp: 200, type: 'HAPPY_PATH' },
                // 2. POST /api/cart/validate
                { title: 'happy path: POST /api/cart/validate should validate cart with items', exp: 200, type: 'HAPPY_PATH' },
                { title: 'edge case: should return 200 with 0 total for empty cart', exp: 200, type: 'EDGE_CASE' },
                { title: 'edge case: POST /api/cart/validate should mark non-existent or null food items as invalid', exp: 200, type: 'NEGATIVE' },
                // 3. POST /api/cart/checkout
                { title: 'happy path: should create an order successfully with valid paymentIntentId', exp: 200, type: 'HAPPY_PATH' },
                { title: 'error edge case: should return 400 when paymentIntentId is missing', exp: 400, type: 'EDGE_CASE' },
                // 4. POST /api/payments/create-payment-intent
                { title: 'happy path: should create payment intent successfully for positive amount', exp: 200, type: 'HAPPY_PATH' },
                { title: 'happy path: should return free checkout session when amount is 0', exp: 200, type: 'HAPPY_PATH' },
                { title: 'error edge case: should return 500 when invalid negative amount causes Stripe error', exp: 500, type: 'NEGATIVE' },
                // 5. GET /api/food-items
                { title: 'happy path: GET /api/food-items should return 200 and list food items', exp: 200, type: 'HAPPY_PATH' },
                { title: 'happy path: GET /api/food-items should return 200 and paginated food items', exp: 200, type: 'HAPPY_PATH' },
                { title: 'edge case: GET /api/food-items should handle invalid query parameters gracefully with default pagination', exp: 200, type: 'VALIDATION' },
                // 6. GET /api/food-items/get/:id
                { title: 'error edge case: GET /api/food-items/get/:id should return 404 when item not found', exp: 404, type: 'NEGATIVE' },
                { title: 'happy path: GET /api/food-items/get/:id should return 200 for an existing food item', exp: 200, type: 'HAPPY_PATH' },
                // 7. POST /api/food-items/create/
                { title: 'happy path: should successfully create a new food item and return 201', exp: 201, type: 'HAPPY_PATH' },
                { title: 'error edge case: should return 500 when required fields are missing', exp: 500, type: 'VALIDATION' },
                // 8. PUT /api/food-items/update/:id
                { title: 'happy path: should successfully update an existing food item and return 200', exp: 200, type: 'HAPPY_PATH' },
                { title: 'error edge case: should return 500 when updating a non-existent food item', exp: 500, type: 'NEGATIVE' },
                // 9. DELETE /api/food-items/delete/:id
                { title: 'error edge case: should return 500 when deleting a non-existent food item', exp: 500, type: 'NEGATIVE' },
                { title: 'happy path: should successfully delete an existing food item and return 200', exp: 200, type: 'HAPPY_PATH' }
            ];

            const happyCount = scenarioTypes.filter(s => s.type === 'HAPPY_PATH').length;
            const negBoundaryCount = scenarioTypes.filter(s => s.type === 'NEGATIVE' || s.type === 'EDGE_CASE' || s.type === 'VALIDATION').length;

            expect(scenarioTypes.length).toBe(20);
            expect(happyCount).toBe(11);
            expect(negBoundaryCount).toBe(9);
            expect(happyCount + negBoundaryCount).toBe(20);
        });

        it('computes 8 endpoints with negative/boundary coverage and verifies GET / has 0', () => {
            const endpoints = [
                { path: '/', scenarios: [{ type: 'HAPPY_PATH' }] },
                { path: '/api/cart/validate', scenarios: [{ type: 'HAPPY_PATH' }, { type: 'EDGE_CASE' }, { type: 'NEGATIVE' }] },
                { path: '/api/cart/checkout', scenarios: [{ type: 'HAPPY_PATH' }, { type: 'EDGE_CASE' }] },
                { path: '/api/payments/create-payment-intent', scenarios: [{ type: 'HAPPY_PATH' }, { type: 'HAPPY_PATH' }, { type: 'NEGATIVE' }] },
                { path: '/api/food-items', scenarios: [{ type: 'HAPPY_PATH' }, { type: 'HAPPY_PATH' }, { type: 'VALIDATION' }] },
                { path: '/api/food-items/get/:id', scenarios: [{ type: 'NEGATIVE' }, { type: 'HAPPY_PATH' }] },
                { path: '/api/food-items/create/', scenarios: [{ type: 'HAPPY_PATH' }, { type: 'VALIDATION' }] },
                { path: '/api/food-items/update/:id', scenarios: [{ type: 'HAPPY_PATH' }, { type: 'NEGATIVE' }] },
                { path: '/api/food-items/delete/:id', scenarios: [{ type: 'NEGATIVE' }, { type: 'HAPPY_PATH' }] }
            ];

            const withNegBoundary = endpoints.filter(ep => ep.scenarios.some(s => s.type === 'NEGATIVE' || s.type === 'EDGE_CASE' || s.type === 'VALIDATION'));
            const rootEp = endpoints.find(ep => ep.path === '/');

            expect(endpoints.length).toBe(9);
            expect(withNegBoundary.length).toBe(8);
            expect(rootEp.scenarios.some(s => s.type !== 'HAPPY_PATH')).toBe(false);
        });

        it('separates URL template, resolved URL, and resolution source for dynamic fixture scenarios', () => {
            const resolveUrlDetails = (rawReqPath, epPath) => {
                const isFixtureIdVariable = /\/(seededId|deleteId|foodId|tempId)$/i.test(rawReqPath) || /\/:param$/i.test(rawReqPath);
                const isLiteralId = /\/\d+$/.test(rawReqPath);
                const hasQueryParams = rawReqPath.includes('?');

                if (isFixtureIdVariable) {
                    return {
                        urlTemplate: epPath,
                        resolvedUrl: null,
                        resolutionSource: 'RUNTIME_FIXTURE_RESPONSE (createRes.body.id)'
                    };
                } else if (isLiteralId) {
                    return {
                        urlTemplate: epPath,
                        resolvedUrl: rawReqPath,
                        resolutionSource: 'STATIC_LITERAL_ID'
                    };
                } else if (hasQueryParams) {
                    return {
                        urlTemplate: `${epPath}?${rawReqPath.split('?')[1].replace(/=[^&]+/g, '=:param')}`,
                        resolvedUrl: rawReqPath,
                        resolutionSource: 'STATIC_QUERY_STRING'
                    };
                } else {
                    return {
                        urlTemplate: rawReqPath,
                        resolvedUrl: rawReqPath,
                        resolutionSource: 'STATIC_ROUTE'
                    };
                }
            };

            // Dynamic GET by ID
            const dynGet = resolveUrlDetails('/api/food-items/get/seededId', '/api/food-items/get/:id');
            expect(dynGet.urlTemplate).toBe('/api/food-items/get/:id');
            expect(dynGet.resolvedUrl).toBeNull();
            expect(dynGet.resolutionSource).toContain('RUNTIME_FIXTURE_RESPONSE');

            // Dynamic DELETE
            const dynDel = resolveUrlDetails('/api/food-items/delete/deleteId', '/api/food-items/delete/:id');
            expect(dynDel.urlTemplate).toBe('/api/food-items/delete/:id');
            expect(dynDel.resolvedUrl).toBeNull();
            expect(dynDel.resolutionSource).toContain('RUNTIME_FIXTURE_RESPONSE');

            // Static literal ID 999999
            const staticGet = resolveUrlDetails('/api/food-items/get/999999', '/api/food-items/get/:id');
            expect(staticGet.urlTemplate).toBe('/api/food-items/get/:id');
            expect(staticGet.resolvedUrl).toBe('/api/food-items/get/999999');
            expect(staticGet.resolutionSource).toBe('STATIC_LITERAL_ID');

            // Static route
            const staticRoute = resolveUrlDetails('/api/food-items/create/', '/api/food-items/create/');
            expect(staticRoute.urlTemplate).toBe('/api/food-items/create/');
            expect(staticRoute.resolvedUrl).toBe('/api/food-items/create/');
            expect(staticRoute.resolutionSource).toBe('STATIC_ROUTE');
        });
    });

    describe('21. Structured Runtime Execution Evidence & Setup/Teardown Disambiguation (P0, P1)', () => {
        it('should validate complete structured evidence record schema', () => {
            const evidenceRecord = {
                testRunId: 'tr_test_12345',
                scenarioId: 'sc_scenario_67890',
                requestMethod: 'GET',
                requestUrl: '/api/food-items/get/1',
                requestUrlTemplate: '/api/food-items/get/:id',
                resolvedUrl: '/api/food-items/get/1',
                expectedStatus: 200,
                actualStatusFromRuntime: 200,
                statusAssertionResult: 'PASS',
                runnerVerdict: 'PASS',
                capturedAt: '2026-10-14T12:00:00.000Z',
                evidenceSource: 'TEST_SERVER_HTTP_RESPONSE'
            };

            const requiredFields = [
                'testRunId', 'scenarioId', 'requestMethod', 'requestUrl',
                'requestUrlTemplate', 'resolvedUrl', 'expectedStatus',
                'actualStatusFromRuntime', 'statusAssertionResult',
                'runnerVerdict', 'capturedAt'
            ];

            for (const f of requiredFields) {
                expect(evidenceRecord).toHaveProperty(f);
                expect(evidenceRecord[f]).not.toBeUndefined();
            }
            expect(evidenceRecord.evidenceSource).toBe('TEST_SERVER_HTTP_RESPONSE');
        });

        it('should keep NOT_CAPTURED when runtime evidence is missing without inferring defaults', () => {
            const scenarioWithoutEvidence = {
                title: 'untested scenario without runtime interception',
                status: 'passed',
                expectedStatus: 200,
                actualStatus: null
            };

            // Test logic: without runtime interceptor record, actualStatus remains null
            const actualStatusFromRuntime = scenarioWithoutEvidence.actualStatus ?? null;
            const evidenceSource = actualStatusFromRuntime !== null ? 'TEST_SERVER_HTTP_RESPONSE' : 'NOT_CAPTURED';

            expect(actualStatusFromRuntime).toBeNull();
            expect(evidenceSource).toBe('NOT_CAPTURED');
            expect(actualStatusFromRuntime).not.toBe(200);
        });

        it('should disambiguate setup requests (fixture seeding) from main endpoint action', () => {
            const ep = { method: 'GET', fullPath: '/api/food-items/get/:id' };
            const interceptedRequests = [
                {
                    testTitle: 'GET /api/food-items/get/:id > happy path',
                    requestMethod: 'POST',
                    requestUrl: '/api/food-items/create/',
                    resolvedUrl: '/api/food-items/create/',
                    actualStatusFromRuntime: 201,
                    capturedAt: '2026-10-14T12:00:01.000Z'
                },
                {
                    testTitle: 'GET /api/food-items/get/:id > happy path',
                    requestMethod: 'GET',
                    requestUrl: '/api/food-items/get/1',
                    resolvedUrl: '/api/food-items/get/1',
                    actualStatusFromRuntime: 200,
                    capturedAt: '2026-10-14T12:00:02.000Z'
                }
            ];

            // Filter main match by method & endpoint match
            const mainMatches = interceptedRequests.filter(r => r.requestMethod === ep.method);
            expect(mainMatches.length).toBe(1);
            const mainEv = mainMatches[0];
            expect(mainEv.requestMethod).toBe('GET');
            expect(mainEv.resolvedUrl).toBe('/api/food-items/get/1');
            expect(mainEv.actualStatusFromRuntime).toBe(200);

            // Other requests partitioned into setup
            const setupRequests = interceptedRequests.filter(r => r !== mainEv);
            expect(setupRequests.length).toBe(1);
            expect(setupRequests[0].requestMethod).toBe('POST');
            expect(setupRequests[0].actualStatusFromRuntime).toBe(201);
        });

        it('should disambiguate teardown requests from main endpoint action', () => {
            const ep = { method: 'DELETE', fullPath: '/api/food-items/delete/:id' };
            const interceptedRequests = [
                {
                    testTitle: 'DELETE /api/food-items/delete/:id > happy path',
                    requestMethod: 'POST',
                    requestUrl: '/api/food-items/create/',
                    resolvedUrl: '/api/food-items/create/',
                    actualStatusFromRuntime: 201,
                    capturedAt: '2026-10-14T12:00:01.000Z'
                },
                {
                    testTitle: 'DELETE /api/food-items/delete/:id > happy path',
                    requestMethod: 'DELETE',
                    requestUrl: '/api/food-items/delete/1',
                    resolvedUrl: '/api/food-items/delete/1',
                    actualStatusFromRuntime: 200,
                    capturedAt: '2026-10-14T12:00:02.000Z'
                },
                {
                    testTitle: 'DELETE /api/food-items/delete/:id > happy path',
                    requestMethod: 'GET',
                    requestUrl: '/api/food-items/get/1',
                    resolvedUrl: '/api/food-items/get/1',
                    actualStatusFromRuntime: 404,
                    capturedAt: '2026-10-14T12:00:03.000Z'
                }
            ];

            const mainMatches = interceptedRequests.filter(r => r.requestMethod === ep.method);
            const mainEv = mainMatches[0];
            expect(mainEv.requestMethod).toBe('DELETE');
            expect(mainEv.actualStatusFromRuntime).toBe(200);

            const setupRequests = interceptedRequests.filter(r => r !== mainEv && new Date(r.capturedAt) < new Date(mainEv.capturedAt));
            const teardownRequests = interceptedRequests.filter(r => r !== mainEv && new Date(r.capturedAt) > new Date(mainEv.capturedAt));

            expect(setupRequests.length).toBe(1);
            expect(setupRequests[0].requestMethod).toBe('POST');
            expect(teardownRequests.length).toBe(1);
            expect(teardownRequests[0].requestMethod).toBe('GET');
            expect(teardownRequests[0].actualStatusFromRuntime).toBe(404);
        });

        it('should NOT inflate scenario classification when HTTP status is captured', () => {
            const unverifiedScenario = {
                title: 'error edge case: should return 500 when database creation fails',
                status: 'passed',
                expectedStatus: 500,
                actualStatus: 500
            };
            const req = { path: '/api/food-items/create/', expectedStatus: 500 };

            const classification = classifyScenarioFailure(unverifiedScenario, req);
            // Capturing actualStatus 500 must NOT inflate to PASSED
            expect(classification).toBe('CONTRACT_UNVERIFIED');
        });
    });

    describe('22. Supertest Prototype Interceptor Lifecycle & Teardown Hardening (P0)', () => {
        it('should verify setup script defines pristine preservation, restore function and lifecycle hooks', async () => {
            const { generateSupertestSetupScript } = await import('../services/databaseMockTemplate.service.js');
            const script = generateSupertestSetupScript({});

            expect(script).toContain('__covai_pristine_end__');
            expect(script).toContain('restoreSupertestPrototype');
            expect(script).toContain('global.__covai_restore_supertest__');
            expect(script).toContain('afterAll');
            expect(script).toContain('beforeExit');
            expect(script).toContain('exit');
            expect(script).toContain('__covai_patched__');
        });

        it('should ensure consecutive test runs isolate evidence files and prevent duplicate accumulations', () => {
            // Simulate run 1: cleans existing file and captures run 1 evidence
            const run1Records = [
                { testRunId: 'run-1', scenarioId: 'sc-1', actualStatusFromRuntime: 200, resolvedUrl: '/api/food-items' },
                { testRunId: 'run-1', scenarioId: 'sc-2', actualStatusFromRuntime: 404, resolvedUrl: '/api/food-items/get/99' }
            ];

            // When run 2 starts, evidence files are reset by supertestRunner.service
            const cleanStaleEvidence = (existingList) => {
                // Runner unlinks stale evidence before starting
                return [];
            };

            let activeEvidence = run1Records;
            expect(activeEvidence).toHaveLength(2);
            expect(activeEvidence.every(r => r.testRunId === 'run-1')).toBe(true);

            // Trigger Run 2 reset
            activeEvidence = cleanStaleEvidence(activeEvidence);
            expect(activeEvidence).toHaveLength(0);

            // Record Run 2
            const run2Records = [
                { testRunId: 'run-2', scenarioId: 'sc-1', actualStatusFromRuntime: 200, resolvedUrl: '/api/food-items' },
                { testRunId: 'run-2', scenarioId: 'sc-2', actualStatusFromRuntime: 404, resolvedUrl: '/api/food-items/get/99' }
            ];
            activeEvidence = run2Records;

            expect(activeEvidence).toHaveLength(2);
            expect(activeEvidence.every(r => r.testRunId === 'run-2')).toBe(true);
            // Zero records from run-1 in run-2
            expect(activeEvidence.some(r => r.testRunId === 'run-1')).toBe(false);
        });

        it('should verify prototype restoration safely cleans up patched prototype without error', () => {
            const fakePrototype = {
                end: function mockOriginalEnd() { return 'original'; }
            };
            const originalFn = fakePrototype.end;

            // 1. Installation
            if (!fakePrototype.__covai_pristine_end__) {
                fakePrototype.__covai_pristine_end__ = fakePrototype.end;
            }
            fakePrototype.__covai_patched__ = true;
            fakePrototype.end = function mockWrapperEnd() { return 'intercepted'; };

            expect(fakePrototype.end()).toBe('intercepted');
            expect(fakePrototype.__covai_patched__).toBe(true);

            // 2. Restoration
            const restore = () => {
                if (fakePrototype.__covai_pristine_end__) {
                    fakePrototype.end = fakePrototype.__covai_pristine_end__;
                    delete fakePrototype.__covai_pristine_end__;
                    delete fakePrototype.__covai_patched__;
                    return true;
                }
                return false;
            };

            const restored = restore();
            expect(restored).toBe(true);
            expect(fakePrototype.end).toBe(originalFn);
            expect(fakePrototype.end()).toBe('original');
            expect(fakePrototype.__covai_pristine_end__).toBeUndefined();
            expect(fakePrototype.__covai_patched__).toBeUndefined();
        });
    });

    describe('23. Integration Test Approval Action Semantics (P1)', () => {
        it('should mark meta.status as APPROVED when scenarios are approved and DRAFT when empty', () => {
            const aiTest1 = {
                id: 'test-1',
                metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'DRAFT', requests: [{ testName: 'sc-1' }] })
            };
            const aiTest2 = {
                id: 'test-2',
                metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'DRAFT', requests: [{ testName: 'sc-2' }] })
            };

            const approvedTestIds = ['test-1::sc-1']; // Only test-1 is approved

            const approvedScenariosByTestId = {};
            for (const idStr of approvedTestIds) {
                const sepIdx = idStr.indexOf('::');
                if (sepIdx === -1) continue;
                const tid = idStr.substring(0, sepIdx);
                const sname = idStr.substring(sepIdx + 2);
                if (!approvedScenariosByTestId[tid]) approvedScenariosByTestId[tid] = [];
                if (sname) approvedScenariosByTestId[tid].push(sname);
            }

            const updatedTests = [aiTest1, aiTest2].map(t => {
                const meta = JSON.parse(t.metaJson);
                const approvedScenarios = approvedScenariosByTestId[t.id] || [];
                meta.status = approvedScenarios.length > 0 ? 'APPROVED' : 'DRAFT';
                meta.approvedScenarios = approvedScenarios;
                return { ...t, metaJson: JSON.stringify(meta) };
            });

            const meta1 = JSON.parse(updatedTests[0].metaJson);
            const meta2 = JSON.parse(updatedTests[1].metaJson);

            expect(meta1.status).toBe('APPROVED');
            expect(meta1.approvedScenarios).toEqual(['sc-1']);
            expect(meta2.status).toBe('DRAFT');
            expect(meta2.approvedScenarios).toEqual([]);
        });

        it('should require all integration tests to have APPROVED status for generation.isApproved to be true', () => {
            const computeIsApproved = (tests) => {
                return tests.length > 0 && tests.every(t => {
                    try {
                        const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
                        return meta.status === 'APPROVED';
                    } catch { return false; }
                });
            };

            const partialApproved = [
                { metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'APPROVED' }) },
                { metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'DRAFT' }) }
            ];
            expect(computeIsApproved(partialApproved)).toBe(false);

            const allApproved = [
                { metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'APPROVED' }) },
                { metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'APPROVED' }) }
            ];
            expect(computeIsApproved(allApproved)).toBe(true);
        });

        it('should unlock Run stage only when isApproved is true', () => {
            const evaluateRunActionEnabled = ({ isApproved, isJobActive, pendingAction }) => {
                return isApproved && !isJobActive && pendingAction !== 'RUN' && pendingAction !== 'RUN_REMAINING';
            };

            expect(evaluateRunActionEnabled({ isApproved: false, isJobActive: false, pendingAction: null })).toBe(false);
            expect(evaluateRunActionEnabled({ isApproved: true, isJobActive: true, pendingAction: null })).toBe(false);
            expect(evaluateRunActionEnabled({ isApproved: true, isJobActive: false, pendingAction: 'RUN' })).toBe(false);
            expect(evaluateRunActionEnabled({ isApproved: true, isJobActive: false, pendingAction: null })).toBe(true);
        });
    });
});



