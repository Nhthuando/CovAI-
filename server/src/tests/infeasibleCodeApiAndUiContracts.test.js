import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// 1. Prisma & Service Mocks for Controller Testing
// ---------------------------------------------------------------------------
const mockSnapshot = {
    id: 'snap-milestone3-test',
    projectId: 'proj-milestone3-test',
    source: 'github',
    commitSha: 'c0ffeebabe',
    rootDir: process.cwd(),
    createdAt: new Date(),
    project: {
        id: 'proj-milestone3-test',
        name: 'Mock Infeasible Project',
        ownerId: 'user-milestone3',
    }
};

const mockProjectWithSnapshots = {
    ...mockSnapshot.project,
    ownerId: 'user-milestone3',
    workspaceRevision: 1,
    snapshots: [mockSnapshot]
};

const prismaMock = {
    projectSnapshot: {
        findUnique: jest.fn().mockResolvedValue({
            ...mockSnapshot,
            project: mockProjectWithSnapshots
        }),
        findFirst: jest.fn().mockResolvedValue({
            ...mockSnapshot,
            project: mockProjectWithSnapshots
        }),
    },
    project: {
        findUnique: jest.fn().mockResolvedValue(mockProjectWithSnapshots),
        findFirst: jest.fn().mockResolvedValue(mockProjectWithSnapshots),
    },
    projectMember: {
        findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
        findFirst: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
    },
    coverageSummary: {
        findUnique: jest.fn().mockResolvedValue({
            id: 'summary-1',
            snapshotId: 'snap-milestone3-test',
            linesPct: 100,
            branchesPct: 87.5,
            functionsPct: 100,
            statementsPct: 100,
        }),
    },
    coverageFile: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
    },
    coverageFunction: {
        findMany: jest.fn().mockResolvedValue([
            {
                id: 'func-1',
                filePath: 'src/services/logger.service.js',
                functionName: 'configureLogging',
                startLine: 1,
                endLine: 20,
                hit: 5,
            },
            {
                id: 'func-2',
                filePath: 'src/services/logger.service.js',
                functionName: 'unreachableBranchHelper',
                startLine: 22,
                endLine: 40,
                hit: 2,
            }
        ]),
        count: jest.fn().mockResolvedValue(2),
    },
    cyclomatic: {
        findMany: jest.fn().mockResolvedValue([
            { id: 'cyc-1', filePath: 'src/services/logger.service.js', functionName: 'configureLogging', value: 3 }
        ]),
    },
    cfg: {
        findMany: jest.fn().mockResolvedValue([
            { id: 'cfg-1', filePath: 'src/services/logger.service.js', functionName: 'configureLogging', startLine: 1 }
        ]),
    },
    testRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
    },
    job: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
    aiTest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ai-test-1' }),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
}));

// Import services and controllers after mocks
const {
    classifyFeasibleCoverage,
    suggestUnitTestcases
} = await import('../services/unitTestSuggestion.service.js');

const {
    getFileCoverage,
    suggestUnitTestcase,
    getCoverageFunctions,
    getCoverageTestSuites
} = await import('../controllers/coverage.controller.js');

describe('Milestone 3: Infeasible Code API Payloads, UI Contracts & Mathematical Soundness', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // =========================================================================
    // 1. classifyFeasibleCoverage Unit Tests
    // =========================================================================
    describe('1. Feasible Coverage Mathematical Classification (classifyFeasibleCoverage)', () => {
        test('correctly flags isFeasibleLogicCovered: true when uncovered branch is inside an infeasible block', () => {
            const coverageData = {
                metrics: {
                    lines: { total: 10, covered: 10, pct: 100 },
                    branches: { total: 8, covered: 7, pct: 87.5 },
                    functions: { total: 2, covered: 2, pct: 100 },
                    statements: { total: 12, covered: 12, pct: 100 }
                },
                uncoveredBranches: [
                    {
                        line: 15,
                        branchIndex: 0,
                        taken: false
                    }
                ],
                uncoveredLines: [],
                uncoveredFunctions: []
            };

            const infeasibleBlocks = [
                {
                    type: 'ENVIRONMENT_GUARD',
                    category: 'ENVIRONMENT',
                    affectsBranch: 'TRUE_BRANCH',
                    line: 15,
                    startLine: 15,
                    endLine: 17,
                    justification: "process.env.NODE_ENV === 'production' is unreachable in unit test environment",
                    actionableJustification: "Defensive guard verified as unreachable"
                }
            ];

            const result = classifyFeasibleCoverage(coverageData, infeasibleBlocks);

            // Invariant: Raw coverage remains authentic (87.5%), feasible coverage is 100%
            expect(result.isFeasibleLogicCovered).toBe(true);
            expect(result.rawCoverage.branches).toBe(87.5);
            expect(result.feasibleCoverage.branches).toBe(100);
            expect(result.actionableGaps.branches).toBe(0);
            expect(result.infeasibleBranches.length).toBe(1);
            expect(result.infeasibleSummaries.length).toBe(1);
            expect(result.infeasibleSummaries[0].justification).toContain("process.env.NODE_ENV === 'production'");
        });

        test('flags isFeasibleLogicCovered: false when actionable uncovered branch exists outside infeasible blocks', () => {
            const coverageData = {
                metrics: {
                    lines: { total: 10, covered: 9, pct: 90 },
                    branches: { total: 8, covered: 6, pct: 75 },
                    functions: { total: 2, covered: 2, pct: 100 },
                    statements: { total: 12, covered: 11, pct: 91.7 }
                },
                uncoveredBranches: [
                    { line: 15, branchIndex: 0 }, // Infeasible guard
                    { line: 42, branchIndex: 1 }  // Real business logic branch (actionable!)
                ],
                uncoveredLines: [42],
                uncoveredFunctions: []
            };

            const infeasibleBlocks = [
                {
                    type: 'ENVIRONMENT_GUARD',
                    line: 15,
                    startLine: 15,
                    endLine: 17,
                    affectsBranch: 'TRUE_BRANCH',
                    justification: 'Guard'
                }
            ];

            const result = classifyFeasibleCoverage(coverageData, infeasibleBlocks);

            expect(result.isFeasibleLogicCovered).toBe(false);
            expect(result.rawCoverage.branches).toBe(75);
            expect(result.feasibleCoverage.branches).toBeLessThan(100);
            expect(result.actionableGaps.branches).toBe(1);
            expect(result.actionableGaps.lines).toBe(1);
        });

        test('handles files with zero branch total gracefully (100% linear execution)', () => {
            const coverageData = {
                metrics: {
                    lines: { total: 5, covered: 5, pct: 100 },
                    branches: { total: 0, covered: 0, pct: 100 },
                    functions: { total: 1, covered: 1, pct: 100 },
                    statements: { total: 5, covered: 5, pct: 100 }
                },
                uncoveredBranches: [],
                uncoveredLines: [],
                uncoveredFunctions: []
            };

            const result = classifyFeasibleCoverage(coverageData, []);
            expect(result.isFeasibleLogicCovered).toBe(true);
            expect(result.feasibleCoverage.branches).toBe(100);
            expect(result.actionableGaps.branches).toBe(0);
        });

        test('returns safe fallback without throwing on empty or null coverage data', () => {
            const resultNull = classifyFeasibleCoverage(null, []);
            expect(resultNull.isFeasibleLogicCovered).toBe(false);
            expect(resultNull.feasibleCoverage.lines).toBe(0);

            const resultEmpty = classifyFeasibleCoverage({}, null);
            expect(resultEmpty.isFeasibleLogicCovered).toBe(false);
        });
    });

    // =========================================================================
    // 2. Unit Test Suggestion Service Payload Enrichment & Early Termination
    // =========================================================================
    describe('2. Suggestion Service Contract & Early Loop Termination', () => {
        test('terminates early with FEASIBLE_LOGIC_COVERED status when all remaining gaps are justified guards', async () => {
            const sourceCode = `
function getLogDestination() {
    if (process.env.NODE_ENV === 'production') {
        return 's3://app-logs';
    }
    return 'stdout';
}
module.exports = { getLogDestination };
`;
            const res = await suggestUnitTestcases({
                projectId: 'proj-milestone3-test',
                snapshotId: 'snap-milestone3-test',
                filePath: 'src/services/logger.js',
                userId: 'user-milestone3',
                mockCoverage: {
                    metrics: {
                        lines: { total: 5, covered: 5, pct: 100 },
                        branches: { total: 2, covered: 1, pct: 50 },
                        functions: { total: 1, covered: 1, pct: 100 },
                        statements: { total: 5, covered: 5, pct: 100 }
                    },
                    uncoveredBranches: [
                        { line: 3, branchIndex: 0, isInfeasible: true }
                    ]
                },
                mockSourceCode: sourceCode,
                infeasibleBlocks: [
                    {
                        type: 'ENVIRONMENT_GUARD',
                        category: 'ENVIRONMENT',
                        affectsBranch: 'TRUE_BRANCH',
                        line: 3,
                        startLine: 3,
                        endLine: 5,
                        justification: "process.env.NODE_ENV === 'production' cannot be reached in test env"
                    }
                ]
            });

            expect(res).toBeDefined();
            expect(res.isFeasibleLogicCovered).toBe(true);
            expect(res.infeasibleCode).toBeDefined();
            expect(Array.isArray(res.infeasibleCode)).toBe(true);
            expect(res.infeasibleBranches).toBeDefined();
            expect(res.infeasibleSummaries).toBeDefined();
            expect(res.status).toBe('FEASIBLE_LOGIC_COVERED');
            expect(res.suggestedTestCode).toBe('');
            expect(res.explanation).toContain('Feasible Logic Covered');
        });
    });

    // =========================================================================
    // 3. Controller API Contracts (Section 3.1, file-coverage, functions, test-suites)
    // =========================================================================
    describe('3. Coverage Controller API Contracts', () => {
        test('GET /file-coverage returns infeasibleCode, infeasibleBranches, and isFeasibleLogicCovered', async () => {
            const req = {
                user: { id: 'user-milestone3' },
                params: { snapshotId: 'snap-milestone3-test' },
                query: { filePath: 'src/services/logger.service.js' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await getFileCoverage(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const body = res.json.mock.calls[0][0];
            expect(body.success).toBe(true);
            expect(body.data).toBeDefined();
            expect(body.data).toHaveProperty('infeasibleCode');
            expect(body.data).toHaveProperty('infeasibleBranches');
            expect(body.data).toHaveProperty('isFeasibleLogicCovered');
        });

        test('POST /suggest-testcase guarantees infeasible metadata and isFeasibleLogicCovered in payload', async () => {
            const req = {
                user: { id: 'user-milestone3' },
                params: { snapshotId: 'snap-milestone3-test' },
                body: {
                    projectId: 'proj-milestone3-test',
                    filePath: 'src/services/logger.service.js',
                    framework: 'jest'
                }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await suggestUnitTestcase(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const body = res.json.mock.calls[0][0];
            expect(body.success).toBe(true);
            expect(body.data).toHaveProperty('infeasibleCode');
            expect(body.data).toHaveProperty('infeasibleBranches');
            expect(body.data).toHaveProperty('infeasibleSummaries');
            expect(body.data).toHaveProperty('isFeasibleLogicCovered');
        });

        test('GET /functions payload contract contains infeasibleCode and isFeasibleLogicCovered', async () => {
            const req = {
                user: { id: 'user-milestone3' },
                params: { snapshotId: 'snap-milestone3-test' },
                query: { page: 1, limit: 10 }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await getCoverageFunctions(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const body = res.json.mock.calls[0][0];
            expect(body.success).toBe(true);
            expect(body.data).toHaveProperty('infeasibleCode');
            expect(body.data).toHaveProperty('isFeasibleLogicCovered');
            expect(body.data.functions[0]).toHaveProperty('infeasibleCode');
            expect(body.data.functions[0]).toHaveProperty('isFeasibleLogicCovered');
        });

        test('GET /test-suites payload contract contains infeasibleCode and infeasibleBranches', async () => {
            const req = {
                user: { id: 'user-milestone3' },
                params: { snapshotId: 'snap-milestone3-test' },
                query: { type: 'unit' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            await getCoverageTestSuites(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const body = res.json.mock.calls[0][0];
            expect(body.success).toBe(true);
            expect(body.data).toHaveProperty('infeasibleCode');
            expect(body.data).toHaveProperty('infeasibleBranches');
        });
    });

    // =========================================================================
    // 4. Test Generator Service Invariant (No Fake/Tautological Assertions)
    // =========================================================================
    describe('4. Test Generator Service Invariant Protection', () => {
        test('verifies that generator prompt forbids fake/tautological assertions for unreachable code', () => {
            const generatorPath = path.resolve(process.cwd(), 'src/services/unitTestGenerator.service.js');
            const generatorSource = fs.readFileSync(generatorPath, 'utf8');

            // Invariant: Prompt must forbid tautological assertions
            expect(generatorSource).toContain('Never generate fake or tautological assertions for unreachable or environment-dependent code.');
        });
    });

    // =========================================================================
    // 5. Frontend UI Component Contract Safeguards
    // =========================================================================
    describe('5. Frontend UI Component Contract Safeguards', () => {
        test('UnitTestGuidedWorkflow.jsx defines isFeasibleLogicCovered and displays distinctive maximum feasible coverage banner', () => {
            const workflowPath = path.resolve(process.cwd(), '../client/src/components/dashboard/UnitTestGuidedWorkflow.jsx');
            const workflowSource = fs.readFileSync(workflowPath, 'utf8');

            expect(workflowSource).toContain('isFeasibleLogicCovered');
            expect(workflowSource).toContain('✓ Maximum Feasible Coverage Reached — All Remaining Gaps are Justified Guards');
            expect(workflowSource).toContain('!is100Percent && !isFeasibleLogicCovered');
        });

        test('UnitTestTraceabilityMatrix.jsx renders Guard Justified Explanation Badges and Feasible Logic Covered status pill', () => {
            const matrixPath = path.resolve(process.cwd(), '../client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx');
            const matrixSource = fs.readFileSync(matrixPath, 'utf8');

            expect(matrixSource).toContain('Guard Justified');
            expect(matrixSource).toContain('✓ Feasible Logic Covered');
            expect(matrixSource).toContain('isFeasibleLogicCovered');
        });

        test('FileBranchCFGView.jsx renders [🛡️ INFEASIBLE GUARD] with amber dashed border and suppresses uncovered warning when justified', () => {
            const cfgViewPath = path.resolve(process.cwd(), '../client/src/components/dashboard/FileBranchCFGView.jsx');
            const cfgSource = fs.readFileSync(cfgViewPath, 'utf8');

            expect(cfgSource).toContain('[🛡️ INFEASIBLE GUARD]');
            expect(cfgSource).toContain('border: "1.5px dashed #f59e0b"');
            expect(cfgSource).toContain('Remaining branch is a mathematically verified defensive guard');
        });
    });
});
