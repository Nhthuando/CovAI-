import { jest } from '@jest/globals';

const prismaMock = {
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
    },
    project: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
    },
    coverageSummary: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
    },
    coverageFile: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
    },
    coverageFunction: {
        findMany: jest.fn().mockResolvedValue([]),
    },
    testRun: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
    job: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
    aiTest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ai-1' }),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
}));

const mockSuggestUnitTestcases = jest.fn();
jest.unstable_mockModule('../services/unitTestSuggestion.service.js', () => ({
    suggestUnitTestcases: mockSuggestUnitTestcases,
    detectCoverageFrameworks: jest.fn().mockReturnValue({ supported: { unit: ['jest'] } }),
    findExistingTestFile: jest.fn().mockReturnValue({ found: true, relativePath: 'src/tests/order.service.test.js' }),
    findAssociatedSourceFile: jest.fn().mockReturnValue('src/services/order.service.js'),
    extractAstMetadata: jest.fn().mockReturnValue({ exportedSymbols: ['processOrder'], unexportedFunctions: [], decisionPoints: [] }),
}));

const mockApplyUnitTestSuggestion = jest.fn();
jest.unstable_mockModule('../services/applyTestSuggestion.service.js', () => ({
    applyUnitTestSuggestion: mockApplyUnitTestSuggestion,
    applyCodeToTestFile: jest.fn().mockReturnValue({ success: true, fileUpdated: true, testFilePath: 'src/tests/order.service.test.js' }),
    cleanAndDeduplicateTestContent: jest.fn().mockImplementation(code => code),
    healImportPathsInTestCode: jest.fn().mockImplementation(code => code),
}));

// Import controllers after mocks are registered
const { suggestUnitTestcase, applySuggestion } = await import('../controllers/coverage.controller.js');

describe('Section 3: Data Contracts & Detailed APIs Verification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('3.1 API Yêu Cầu Gợi Ý Test Case (POST /api/coverage/:snapshotId/suggest-testcase)', () => {
        const mockSection31Response = {
            suggestionId: 'sug-1791389000-1',
            sourceFile: 'src/services/order.service.js',
            testFile: 'src/tests/order.service.test.js',
            targetTestFile: 'src/tests/order.service.test.js',
            framework: 'jest',
            targetLines: [45, 46, 82, 83],
            targetBranches: ['if:45', 'conditional:82'],
            explanation: 'Đã tạo 6 test cases bao phủ Happy Path, phân vùng giá trị biên của voucher, và trường hợp huỷ đơn hàng khi không đủ tồn kho.',
            suggestedTestCode: "describe('OrderService - Business Logic Coverage', () => { test('happy path', () => {}); });",
            fullUpdatedContent: "const { processOrder } = require('../services/order.service');\ndescribe('OrderService', () => {});",
            summary: {
                linesPct: 65.4,
                branchesPct: 52.0,
                functionsPct: 80.0,
                statementsPct: 66.2,
            },
        };

        test('returns exact Section 3.1 payload schema on valid request with explicit projectId', async () => {
            mockSuggestUnitTestcases.mockResolvedValueOnce(mockSection31Response);

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: {
                    projectId: 'proj-uuid',
                    filePath: 'src/services/order.service.js',
                    framework: 'jest',
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(mockSuggestUnitTestcases).toHaveBeenCalledWith({
                projectId: 'proj-uuid',
                snapshotId: 'snap-uuid',
                filePath: 'src/services/order.service.js',
                userId: 'user-uuid',
                framework: 'jest',
            });
            expect(res.status).toHaveBeenCalledWith(200);

            const responseBody = res.json.mock.calls[0][0];
            expect(responseBody.success).toBe(true);
            const { data } = responseBody;

            // Strict Section 3.1 Contract Assertion
            expect(data).toBeDefined();
            expect(typeof data.suggestionId).toBe('string');
            expect(data.suggestionId).toMatch(/^sug-/);
            expect(data.sourceFile).toBe('src/services/order.service.js');
            expect(data.testFile).toBe('src/tests/order.service.test.js');
            expect(data.framework).toBe('jest');
            expect(Array.isArray(data.targetLines)).toBe(true);
            expect(data.targetLines).toEqual([45, 46, 82, 83]);
            expect(Array.isArray(data.targetBranches)).toBe(true);
            expect(data.targetBranches).toEqual(['if:45', 'conditional:82']);
            expect(typeof data.explanation).toBe('string');
            expect(data.explanation.length).toBeGreaterThan(0);
            expect(typeof data.suggestedTestCode).toBe('string');
            expect(typeof data.fullUpdatedContent).toBe('string');

            // Summary percentages assertion
            expect(data.summary).toBeDefined();
            expect(typeof data.summary.linesPct).toBe('number');
            expect(typeof data.summary.branchesPct).toBe('number');
            expect(typeof data.summary.functionsPct).toBe('number');
            expect(typeof data.summary.statementsPct).toBe('number');
            expect(data.summary.linesPct).toBe(65.4);
            expect(data.summary.branchesPct).toBe(52.0);
            expect(data.summary.functionsPct).toBe(80.0);
            expect(data.summary.statementsPct).toBe(66.2);
        });

        test('infers projectId from snapshot when omitted from request body', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({ projectId: 'inferred-proj-123' });
            mockSuggestUnitTestcases.mockResolvedValueOnce(mockSection31Response);

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: {
                    filePath: 'src/services/order.service.js',
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(prismaMock.projectSnapshot.findUnique).toHaveBeenCalledWith({
                where: { id: 'snap-uuid' },
                select: { projectId: true },
            });
            expect(mockSuggestUnitTestcases).toHaveBeenCalledWith(expect.objectContaining({
                projectId: 'inferred-proj-123',
                filePath: 'src/services/order.service.js',
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('returns 401 when unauthorized (no user)', async () => {
            const req = {
                user: null,
                params: { snapshotId: 'snap-uuid' },
                body: { filePath: 'src/services/order.service.js' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'Unauthorized.',
            }));
        });

        test('returns 400 when filePath is missing', async () => {
            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: { projectId: 'proj-uuid' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'filePath is required in body.',
            }));
        });

        test('handles service failure with appropriate status code', async () => {
            const err = new Error('File not found in project');
            err.statusCode = 404;
            mockSuggestUnitTestcases.mockRejectedValueOnce(err);

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: { filePath: 'src/services/missing.js' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'File not found in project',
            }));
        });
    });

    describe('3.2 API Áp Dụng Test Case & Chạy Lại (POST /api/coverage/:snapshotId/apply-suggestion)', () => {
        const mockSection32Response = {
            success: true,
            fileUpdated: true,
            status: 'PASSED',
            previousCoverage: {
                statements: 66.2,
                branches: 52.0,
                functions: 80.0,
                lines: 65.4,
            },
            newCoverage: {
                statements: 97.5,
                branches: 94.2,
                functions: 100.0,
                lines: 98.1,
            },
            perFileResults: {
                'src/services/order.service.js': {
                    oldCoverage: { lines: 65.4, branches: 52.0, functions: 80.0, statements: 66.2 },
                    newCoverage: { lines: 98.1, branches: 94.2, functions: 100.0, statements: 97.5 },
                    hasIncreased: true,
                },
            },
            testResults: {
                totalTests: 12,
                passedTests: 12,
                failedTests: 0,
                status: 'passed',
            },
        };

        test('returns exact Section 3.2 payload schema on valid single suggestion apply', async () => {
            mockApplyUnitTestSuggestion.mockResolvedValueOnce(mockSection32Response);

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: {
                    projectId: 'proj-uuid',
                    suggestion: {
                        sourceFile: 'src/services/order.service.js',
                        testFile: 'src/tests/order.service.test.js',
                        generatedCode: "describe('OrderService - Business Logic Coverage', () => { test('happy path', () => {}); });",
                        fullUpdatedContent: 'const { processOrder } = require("../services/order.service");',
                    },
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await applySuggestion(req, res);

            expect(mockApplyUnitTestSuggestion).toHaveBeenCalledWith({
                snapshotId: 'snap-uuid',
                projectId: 'proj-uuid',
                userId: 'user-uuid',
                suggestion: req.body.suggestion,
                suggestions: undefined,
            });
            expect(res.status).toHaveBeenCalledWith(200);

            const responseBody = res.json.mock.calls[0][0];
            expect(responseBody.success).toBe(true);
            const { data } = responseBody;

            // Strict Section 3.2 Contract Assertion
            expect(data.success).toBe(true);
            expect(data.fileUpdated).toBe(true);
            expect(data.status).toBe('PASSED');

            // Previous coverage metrics
            expect(data.previousCoverage).toEqual({
                statements: 66.2,
                branches: 52.0,
                functions: 80.0,
                lines: 65.4,
            });

            // New coverage metrics
            expect(data.newCoverage).toEqual({
                statements: 97.5,
                branches: 94.2,
                functions: 100.0,
                lines: 98.1,
            });

            // Per-file breakdown
            expect(data.perFileResults).toBeDefined();
            const fileRes = data.perFileResults['src/services/order.service.js'];
            expect(fileRes).toBeDefined();
            expect(fileRes.hasIncreased).toBe(true);
            expect(fileRes.oldCoverage).toEqual({ lines: 65.4, branches: 52.0, functions: 80.0, statements: 66.2 });
            expect(fileRes.newCoverage).toEqual({ lines: 98.1, branches: 94.2, functions: 100.0, statements: 97.5 });

            // Execution Test results
            expect(data.testResults).toEqual({
                totalTests: 12,
                passedTests: 12,
                failedTests: 0,
                status: 'passed',
            });
        });

        test('supports batch suggestions array in request payload', async () => {
            mockApplyUnitTestSuggestion.mockResolvedValueOnce(mockSection32Response);

            const batchSuggestions = [
                {
                    sourceFile: 'src/services/order.service.js',
                    testFile: 'src/tests/order.service.test.js',
                    generatedCode: 'test("a", () => {})',
                },
                {
                    sourceFile: 'src/services/payment.service.js',
                    testFile: 'src/tests/payment.service.test.js',
                    generatedCode: 'test("b", () => {})',
                },
            ];

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: {
                    projectId: 'proj-uuid',
                    suggestions: batchSuggestions,
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await applySuggestion(req, res);

            expect(mockApplyUnitTestSuggestion).toHaveBeenCalledWith(expect.objectContaining({
                suggestions: batchSuggestions,
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('returns 400 when neither suggestion nor suggestions array is provided', async () => {
            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: {
                    projectId: 'proj-uuid',
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await applySuggestion(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'suggestion or suggestions array is required.',
            }));
        });

        test('returns Section 3.1 contract when file already has 100% coverage', async () => {
            const fullyCoveredResponse = {
                suggestionId: 'sug-1791389999-1',
                isFullyCovered: true,
                sourceFile: 'src/services/order.service.js',
                testFile: 'src/tests/order.service.test.js',
                targetTestFile: 'src/tests/order.service.test.js',
                framework: 'jest',
                targetLines: [],
                targetBranches: [],
                explanation: 'File `src/services/order.service.js` has reached 100% test coverage with 0 assertion errors.',
                suggestedTestCode: '',
                fullUpdatedContent: '',
                uncoveredLines: [],
                failedLines: [],
                summary: {
                    linesPct: 100,
                    branchesPct: 100,
                    functionsPct: 100,
                    statementsPct: 100,
                },
                suggestions: [],
            };
            mockSuggestUnitTestcases.mockResolvedValueOnce(fullyCoveredResponse);

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: { filePath: 'src/services/order.service.js' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await suggestUnitTestcase(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const { data } = res.json.mock.calls[0][0];
            expect(data.isFullyCovered).toBe(true);
            expect(data.targetLines).toEqual([]);
            expect(data.targetBranches).toEqual([]);
            expect(data.summary.linesPct).toBe(100);
            expect(data.summary.branchesPct).toBe(100);
            expect(data.summary.functionsPct).toBe(100);
            expect(data.summary.statementsPct).toBe(100);
        });

        test('returns 401 when unauthorized (no user)', async () => {
            const req = {
                user: null,
                params: { snapshotId: 'snap-uuid' },
                body: {
                    suggestion: { sourceFile: 'src/services/order.service.js' },
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await applySuggestion(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'Unauthorized.',
            }));
        });

        test('handles test run failure and returns FAILED status according to Section 3.2 schema', async () => {
            const failedResponse = {
                success: false,
                fileUpdated: true,
                status: 'FAILED',
                message: 'Test execution failed after applying suggestion.',
                appliedSuggestions: [{ status: 'FAILED', error: 'AssertionError: expected 5 to be 10' }],
                previousCoverage: { statements: 60.0, branches: 50.0, functions: 70.0, lines: 60.0 },
                newCoverage: { statements: 60.0, branches: 50.0, functions: 70.0, lines: 60.0 },
                perFileResults: {
                    'src/services/order.service.js': {
                        oldCoverage: { lines: 60.0, branches: 50.0, functions: 70.0, statements: 60.0 },
                        newCoverage: { lines: 60.0, branches: 50.0, functions: 70.0, statements: 60.0 },
                        hasIncreased: false,
                    },
                },
                testResults: {
                    totalTests: 12,
                    passedTests: 11,
                    failedTests: 1,
                    status: 'failed',
                },
            };
            mockApplyUnitTestSuggestion.mockResolvedValueOnce(failedResponse);

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: {
                    suggestion: { sourceFile: 'src/services/order.service.js', testFile: 'src/tests/order.service.test.js' },
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await applySuggestion(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const { data } = res.json.mock.calls[0][0];
            expect(data.success).toBe(false);
            expect(data.status).toBe('FAILED');
            expect(data.testResults.status).toBe('failed');
            expect(data.testResults.failedTests).toBe(1);
            expect(data.perFileResults['src/services/order.service.js'].hasIncreased).toBe(false);
        });

        test('handles service exceptions with 500 status code', async () => {
            mockApplyUnitTestSuggestion.mockRejectedValueOnce(new Error('Disk write error'));

            const req = {
                user: { id: 'user-uuid' },
                params: { snapshotId: 'snap-uuid' },
                body: {
                    suggestion: { sourceFile: 'src/services/order.service.js' },
                },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await applySuggestion(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'Disk write error',
            }));
        });
    });
});
